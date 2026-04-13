//! 故障转移切换模块
//!
//! 处理故障转移成功后的供应商切换逻辑，包括：
//! - 去重控制（避免多个请求同时触发）
//! - 数据库更新
//! - 托盘菜单更新
//! - 前端事件发射
//! - Live 备份更新

use crate::database::Database;
use crate::error::AppError;
use crate::proxy::provider_router::ProviderRouter;
use crate::ui_runtime::UiAppHandle;
use serde_json::json;
use std::collections::HashSet;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 故障转移切换管理器
///
/// 负责处理故障转移成功后的供应商切换，确保 UI 能够直观反映当前使用的供应商。
#[derive(Clone)]
pub struct FailoverSwitchManager {
    /// 正在处理中的切换（key = "app_type:provider_id"）
    pending_switches: Arc<RwLock<HashSet<String>>>,
    db: Arc<Database>,
    /// ProviderRouter 引用，用于在切换前验证目标 provider 的熔断器状态
    router: Option<Arc<ProviderRouter>>,
}

impl FailoverSwitchManager {
    pub fn new(db: Arc<Database>) -> Self {
        Self {
            pending_switches: Arc::new(RwLock::new(HashSet::new())),
            db,
            router: None,
        }
    }

    /// 设置 ProviderRouter 引用（延迟注入，避免循环依赖）
    pub fn set_router(&mut self, router: Arc<ProviderRouter>) {
        self.router = Some(router);
    }

    async fn update_live_backup_for_provider(
        &self,
        app_type: &str,
        provider_id: &str,
    ) -> Result<(), AppError> {
        let Some(provider) = self.db.get_provider_by_id(provider_id, app_type)? else {
            return Ok(());
        };

        let backup_json = match app_type {
            "claude" | "codex" => serde_json::to_string(&provider.settings_config)
                .map_err(|e| AppError::Message(format!("序列化 {app_type} 备份失败: {e}")))?,
            "gemini" => {
                let env_backup = if let Some(env) = provider.settings_config.get("env") {
                    json!({ "env": env })
                } else {
                    json!({ "env": {} })
                };
                serde_json::to_string(&env_backup)
                    .map_err(|e| AppError::Message(format!("序列化 {app_type} 备份失败: {e}")))?
            }
            _ => return Ok(()),
        };

        self.db.save_live_backup(app_type, &backup_json).await?;
        Ok(())
    }

    /// 尝试执行故障转移切换
    ///
    /// 如果相同的切换已在进行中，则跳过；否则执行切换逻辑。
    ///
    /// # Returns
    /// - `Ok(true)` - 切换成功执行
    /// - `Ok(false)` - 切换已在进行中，跳过
    /// - `Err(e)` - 切换过程中发生错误
    pub async fn try_switch(
        &self,
        app_handle: Option<&UiAppHandle>,
        app_type: &str,
        provider_id: &str,
        provider_name: &str,
    ) -> Result<bool, AppError> {
        let switch_key = format!("{app_type}:{provider_id}");

        // 去重检查：如果相同切换已在进行中，跳过
        {
            let mut pending = self.pending_switches.write().await;
            if pending.contains(&switch_key) {
                log::debug!("[Failover] 切换已在进行中，跳过: {app_type} -> {provider_id}");
                return Ok(false);
            }
            pending.insert(switch_key.clone());
        }

        // 执行切换（确保最后清理 pending 标记）
        let result = self
            .do_switch(app_handle, app_type, provider_id, provider_name)
            .await;

        // 清理 pending 标记
        {
            let mut pending = self.pending_switches.write().await;
            pending.remove(&switch_key);
        }

        result
    }

    async fn do_switch(
        &self,
        app_handle: Option<&UiAppHandle>,
        app_type: &str,
        provider_id: &str,
        provider_name: &str,
    ) -> Result<bool, AppError> {
        // 在持久化之前，验证目标 provider 的熔断器未处于 Open 状态
        // 防止 try_switch 异步执行间隙中 provider 已故障但仍被写入 is_current
        if let Some(router) = &self.router {
            let circuit_key = format!("{app_type}:{provider_id}");
            let breaker = router.get_or_create_circuit_breaker(&circuit_key).await;
            if !breaker.is_available().await {
                log::warn!(
                    "[FO-004] 目标 provider {} 的熔断器已 Open，取消切换",
                    provider_name
                );
                return Ok(false);
            }
        }

        // 检查该应用是否已被代理接管（enabled=true）
        // 只有被接管的应用才允许执行故障转移切换
        let app_enabled = match self.db.get_proxy_config_for_app(app_type).await {
            Ok(config) => config.enabled,
            Err(e) => {
                log::warn!("[FO-002] 无法读取 {app_type} 配置: {e}，跳过切换");
                return Ok(false);
            }
        };

        if !app_enabled {
            log::debug!("[Failover] {app_type} 未启用代理，跳过切换");
            return Ok(false);
        }

        log::info!("[FO-001] 切换: {app_type} → {provider_name}");

        let app_type_enum = crate::app_config::AppType::from_str(app_type)
            .map_err(|_| AppError::Message(format!("无效的应用类型: {app_type}")))?;
        let switched = true;

        // 4. 更新托盘菜单和发射事件
        #[cfg(feature = "desktop")]
        if let Some(app) = app_handle {
            if let Some(app_state) = app.try_state::<crate::store::AppState>() {
                switched = app_state
                    .proxy_service
                    .hot_switch_provider(app_type, provider_id)
                    .await
                    .map_err(AppError::Message)?
                    .logical_target_changed;

                if !switched {
                    return Ok(false);
                }
                if let Ok(new_menu) = crate::tray::create_tray_menu(app, app_state.inner()) {
                    if let Some(tray) = app.tray_by_id("main") {
                        if let Err(e) = tray.set_menu(Some(new_menu)) {
                            log::error!("[Failover] 更新托盘菜单失败: {e}");
                        }
                    }
                }
            }

            // 发射事件到前端
            let event_data = serde_json::json!({
                "appType": app_type,
                "providerId": provider_id,
                "source": "failover"
            });
            if let Err(e) = app.emit("provider-switched", event_data) {
                log::error!("[Failover] 发射事件失败: {e}");
            }
        }

        #[cfg(not(feature = "desktop"))]
        {
            let _ = app_handle;
        }

        if switched {
            self.db.set_current_provider(app_type, provider_id)?;
            crate::settings::set_current_provider(&app_type_enum, Some(provider_id))?;

            if let Err(e) = self
                .update_live_backup_for_provider(app_type, provider_id)
                .await
            {
                log::warn!("[FO-003] Live 备份更新失败: {e}");
            }
        }

        Ok(switched)
    }
}

#[cfg(test)]
mod tests {
    use super::FailoverSwitchManager;
    use crate::app_config::AppType;
    use crate::database::Database;
    use crate::provider::Provider;
    use crate::proxy::circuit_breaker::CircuitBreakerConfig;
    use crate::proxy::provider_router::ProviderRouter;
    use serde_json::json;
    use serial_test::serial;
    use std::env;
    use std::sync::Arc;
    use tempfile::TempDir;

    struct TempHome {
        #[allow(dead_code)]
        dir: TempDir,
        original_home: Option<String>,
        original_userprofile: Option<String>,
    }

    impl TempHome {
        fn new() -> Self {
            let dir = TempDir::new().expect("failed to create temp home");
            let original_home = env::var("HOME").ok();
            let original_userprofile = env::var("USERPROFILE").ok();

            env::set_var("HOME", dir.path());
            env::set_var("USERPROFILE", dir.path());

            Self {
                dir,
                original_home,
                original_userprofile,
            }
        }
    }

    impl Drop for TempHome {
        fn drop(&mut self) {
            match &self.original_home {
                Some(value) => env::set_var("HOME", value),
                None => env::remove_var("HOME"),
            }

            match &self.original_userprofile {
                Some(value) => env::set_var("USERPROFILE", value),
                None => env::remove_var("USERPROFILE"),
            }
        }
    }

    #[tokio::test]
    #[serial]
    async fn try_switch_updates_live_backup_in_headless_mode() {
        let _home = TempHome::new();
        crate::settings::reload_settings().expect("reload settings");

        let db = Arc::new(Database::memory().expect("init db"));
        let manager = FailoverSwitchManager::new(db.clone());

        let provider_a = Provider::with_id(
            "a".to_string(),
            "A".to_string(),
            json!({
                "env": {
                    "ANTHROPIC_API_KEY": "a-key"
                }
            }),
            None,
        );
        let provider_b = Provider::with_id(
            "b".to_string(),
            "B".to_string(),
            json!({
                "env": {
                    "ANTHROPIC_API_KEY": "b-key"
                }
            }),
            None,
        );
        db.save_provider("claude", &provider_a)
            .expect("save provider a");
        db.save_provider("claude", &provider_b)
            .expect("save provider b");
        db.set_current_provider("claude", "a")
            .expect("set current provider");

        let mut config = db
            .get_proxy_config_for_app("claude")
            .await
            .expect("get proxy config");
        config.enabled = true;
        db.update_proxy_config_for_app(config)
            .await
            .expect("enable proxy config");

        db.save_live_backup("claude", "{\"env\":{}}")
            .await
            .expect("seed live backup");

        let switched = manager
            .try_switch(None, AppType::Claude.as_str(), "b", "B")
            .await
            .expect("switch should succeed");
        assert!(switched, "switch should execute");

        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            Some("b")
        );

        let backup = db
            .get_live_backup("claude")
            .await
            .expect("get live backup")
            .expect("backup exists");
        let expected = serde_json::to_string(&provider_b.settings_config).expect("serialize");
        assert_eq!(backup.original_config, expected);
    }

    #[tokio::test]
    #[serial]
    async fn try_switch_skips_provider_when_target_breaker_is_open() {
        let _home = TempHome::new();
        crate::settings::reload_settings().expect("reload settings");

        let db = Arc::new(Database::memory().expect("init db"));
        let router = Arc::new(ProviderRouter::new(db.clone()));
        let mut manager = FailoverSwitchManager::new(db.clone());
        manager.set_router(router.clone());

        let provider_a = Provider::with_id(
            "a".to_string(),
            "A".to_string(),
            json!({
                "env": {
                    "ANTHROPIC_API_KEY": "a-key"
                }
            }),
            None,
        );
        let provider_b = Provider::with_id(
            "b".to_string(),
            "B".to_string(),
            json!({
                "env": {
                    "ANTHROPIC_API_KEY": "b-key"
                }
            }),
            None,
        );
        db.save_provider("claude", &provider_a)
            .expect("save provider a");
        db.save_provider("claude", &provider_b)
            .expect("save provider b");
        db.set_current_provider("claude", "a")
            .expect("set current provider");

        let mut config = db
            .get_proxy_config_for_app("claude")
            .await
            .expect("get proxy config");
        config.enabled = true;
        db.update_proxy_config_for_app(config)
            .await
            .expect("enable proxy config");

        db.update_circuit_breaker_config(&CircuitBreakerConfig {
            failure_threshold: 1,
            timeout_seconds: 3600,
            ..Default::default()
        })
        .await
        .expect("update breaker config");

        let breaker = router.get_or_create_circuit_breaker("claude:b").await;
        breaker.record_failure(false).await;
        assert!(
            !breaker.is_available().await,
            "target breaker should be open before switch"
        );

        let switched = manager
            .try_switch(None, AppType::Claude.as_str(), "b", "B")
            .await
            .expect("switch call should succeed");

        assert!(!switched, "open breaker should prevent switch");
        assert_eq!(
            db.get_current_provider("claude")
                .expect("get current provider")
                .as_deref(),
            Some("a")
        );
        assert_eq!(
            crate::settings::get_current_provider(&AppType::Claude).as_deref(),
            None,
            "headless settings should remain untouched when switch is skipped"
        );
    }
}
