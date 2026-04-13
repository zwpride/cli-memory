//! 本地代理/接管兼容壳。
//!
//! Web 维护线已经移除了本地代理、接管和故障转移服务。
//! 这里仅保留最小 API，避免旧调用点在完全清理前编译失败。

use crate::app_config::AppType;
use crate::database::Database;
use crate::provider::Provider;
use crate::proxy::types::ProxyServerInfo;
use crate::ui_runtime::UiAppHandle;
use std::sync::Arc;

const REMOVED_MESSAGE: &str = "Local proxy / failover has been removed";

#[derive(Clone)]
pub struct ProxyService {
    _db: Arc<Database>,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct HotSwitchOutcome {
    pub logical_target_changed: bool,
}

impl ProxyService {
    pub fn new(db: Arc<Database>) -> Self {
        Self { _db: db }
    }

    pub fn set_app_handle(&self, _handle: UiAppHandle) {}

    pub async fn start(&self) -> Result<ProxyServerInfo, String> {
        Err(REMOVED_MESSAGE.to_string())
    }

    pub async fn start_with_takeover(&self) -> Result<ProxyServerInfo, String> {
        Err(REMOVED_MESSAGE.to_string())
    }

    pub async fn set_takeover_for_app(&self, _app_type: &str, _enabled: bool) -> Result<(), String> {
        Err(REMOVED_MESSAGE.to_string())
    }

    pub async fn switch_proxy_target(&self, _app_type: &str, _provider_id: &str) -> Result<(), String> {
        Err(REMOVED_MESSAGE.to_string())
    }

    pub async fn hot_switch_provider(
        &self,
        _app_type: &str,
        _provider_id: &str,
    ) -> Result<HotSwitchOutcome, String> {
        Ok(HotSwitchOutcome::default())
    }

    pub async fn is_running(&self) -> bool {
        false
    }

    pub fn detect_takeover_in_live_configs(&self) -> bool {
        false
    }

    pub fn detect_takeover_in_live_config_for_app(&self, _app_type: &AppType) -> bool {
        false
    }

    pub async fn recover_from_crash(&self) -> Result<(), String> {
        Ok(())
    }

    pub async fn update_live_backup_from_provider(
        &self,
        _app_type: &str,
        _provider: &Provider,
    ) -> Result<(), String> {
        Ok(())
    }

    pub async fn sync_claude_live_from_provider_while_proxy_active(
        &self,
        _provider: &Provider,
    ) -> Result<(), String> {
        Ok(())
    }
}
