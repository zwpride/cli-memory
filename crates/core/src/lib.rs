//! cli-memory-core
//!
//! 该 crate 提供与 UI 无关的核心业务封装，供 Web 服务器等复用。
//! 当前实现基于现有的 `cli_memory`（src-tauri）进行轻量封装，
//! 后续可以逐步将纯业务逻辑下沉到本 crate。

mod claude_auth;
mod terminal_launcher;

use std::str::FromStr;
use std::sync::Arc;
use std::{collections::HashMap, path::Path, path::PathBuf};

use cli_memory::{
    default_sql_export_file_name, export_database_sql, export_database_to_file,
    get_all_usage_data_sources, import_database_with_sync, sync_all_session_usage, AppError,
    AppSettings, AppState, AppType, DataSourceSummary, Database, SessionSyncResult,
    EndpointLatency, McpServer, Provider, ProviderService, SkillService, SpeedtestService,
};
use chrono::Utc;
use indexmap::IndexMap;

/// 对外暴露的核心类型别名，便于直接使用
pub use cli_memory::{
    AppSettings as CoreAppSettings, AppType as CoreAppType, BackupEntry, ConfigStatus, DailyStats,
    DataSourceSummary as CoreDataSourceSummary, DiscoverableSkill, HealthStatus, LogConfig,
    LogFilters, McpServer as CoreMcpServer, ModelPricingInfo as CoreModelPricingInfo, ModelStats,
    OmoLocalFileData, OpenClawAgentsDefaults, OpenClawDefaultModel, OpenClawEnvConfig,
    OpenClawModelCatalogEntry, OpenClawToolsConfig, OptimizerConfig, PaginatedLogs,
    Provider as CoreProvider, ProviderLimitStatus, ProviderStats, RectifierConfig,
    RequestLogDetail, SessionSyncResult as CoreSessionSyncResult, SkillRepo,
    StreamCheckConfig, StreamCheckResult, StreamCheckService, UniversalProvider, UsageSummary,
    WebDavSyncSettings, WslShellPreferenceInput,
    WEB_COMPAT_TAURI_COMMANDS,
};
pub use claude_auth::ClaudeOfficialAuthStatus;

/// 核心上下文
///
/// - 管理共享的数据库连接
/// - 管理 SkillService 等长生命周期服务
pub struct CoreContext {
    app_state: AppState,
    skill_service: Option<Arc<SkillService>>,
}

impl CoreContext {
    /// 初始化核心上下文
    ///
    /// - 打开/初始化 `~/.cli-memory/cli-memory.db`
    /// - 构造 `AppState`
    /// - 尝试初始化 `SkillService`（失败时只记录为 None，不阻塞其它功能）
    pub fn new() -> Result<Self, AppError> {
        let db = Arc::new(Database::init()?);
        let app_state = AppState::new(db);

        let skill_service = Some(Arc::new(SkillService::new()));

        Ok(Self {
            app_state,
            skill_service,
        })
    }

    /// 获取应用状态（包含数据库）
    pub fn app_state(&self) -> &AppState {
        &self.app_state
    }

    pub fn from_app_state(app_state: AppState) -> Self {
        let skill_service = Some(Arc::new(SkillService::new()));
        Self {
            app_state,
            skill_service,
        }
    }

    /// 获取 SkillService（如果初始化成功）
    pub fn skill_service(&self) -> Option<&Arc<SkillService>> {
        self.skill_service.as_ref()
    }
}

// ========================
// Provider 相关 API
// ========================

/// 获取指定应用下的所有供应商
pub fn get_providers(ctx: &CoreContext, app: &str) -> Result<IndexMap<String, Provider>, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    ProviderService::list(ctx.app_state(), app_type).map_err(|e| e.to_string())
}

/// 获取指定应用的当前供应商 ID
pub fn get_current_provider(ctx: &CoreContext, app: &str) -> Result<String, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    ProviderService::current(ctx.app_state(), app_type).map_err(|e| e.to_string())
}

/// 添加供应商
pub fn add_provider(ctx: &CoreContext, app: &str, provider: Provider) -> Result<bool, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    ProviderService::add(ctx.app_state(), app_type, provider, false).map_err(|e| e.to_string())
}

/// 更新供应商
pub fn update_provider(ctx: &CoreContext, app: &str, provider: Provider) -> Result<bool, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    ProviderService::update(ctx.app_state(), app_type, None, provider).map_err(|e| e.to_string())
}

/// 删除供应商
pub fn delete_provider(ctx: &CoreContext, app: &str, id: &str) -> Result<bool, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    ProviderService::delete(ctx.app_state(), app_type, id)
        .map(|_| true)
        .map_err(|e| e.to_string())
}

/// 切换供应商
pub fn switch_provider(ctx: &CoreContext, app: &str, id: &str) -> Result<bool, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    ProviderService::switch(ctx.app_state(), app_type, id)
        .map(|_| true)
        .map_err(|e| e.to_string())
}

/// 导入当前配置为默认供应商
pub fn import_default_config(ctx: &CoreContext, app: &str) -> Result<bool, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    ProviderService::import_default_config(ctx.app_state(), app_type).map_err(|e| e.to_string())
}

/// 更新多个供应商的排序
pub fn update_providers_sort_order(
    ctx: &CoreContext,
    app: &str,
    updates: &serde_json::Value,
) -> Result<bool, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    let updates = serde_json::from_value(updates.clone()).map_err(|e| e.to_string())?;
    ProviderService::update_sort_order(ctx.app_state(), app_type, updates)
        .map_err(|e| e.to_string())
}

/// 查询供应商用量
pub async fn query_provider_usage(
    ctx: &CoreContext,
    app: &str,
    provider_id: &str,
) -> Result<serde_json::Value, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    let result = ProviderService::query_usage(ctx.app_state(), app_type, provider_id)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

/// 测试用量脚本（使用当前编辑器中的脚本，不保存）
#[allow(clippy::too_many_arguments)]
pub async fn test_usage_script(
    ctx: &CoreContext,
    app: &str,
    provider_id: &str,
    script_code: &str,
    timeout: Option<u64>,
    api_key: Option<&str>,
    base_url: Option<&str>,
    access_token: Option<&str>,
    user_id: Option<&str>,
    template_type: Option<&str>,
) -> Result<serde_json::Value, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    let result = ProviderService::test_usage_script(
        ctx.app_state(),
        app_type,
        provider_id,
        script_code,
        timeout.unwrap_or(10),
        api_key,
        base_url,
        access_token,
        user_id,
        template_type,
    )
    .await
    .map_err(|e| e.to_string())?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

/// 读取当前生效的配置内容
pub fn read_live_provider_settings(app: &str) -> Result<serde_json::Value, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    ProviderService::read_live_settings(app_type).map_err(|e| e.to_string())
}

/// Helper: try to read a file, returning a JSON object with metadata
fn read_config_file_entry(
    rel_path: &str,
    full_path: &Path,
    file_type: &str,
    level: &str,
) -> Option<serde_json::Value> {
    use serde_json::json;

    if !full_path.exists() || !full_path.is_file() {
        return None;
    }

    match std::fs::read_to_string(full_path) {
        Ok(content) => Some(json!({
            "path": rel_path,
            "fullPath": full_path.to_string_lossy(),
            "fileType": file_type,
            "level": level,
            "content": content,
            "exists": true,
        })),
        Err(e) => Some(json!({
            "path": rel_path,
            "fullPath": full_path.to_string_lossy(),
            "fileType": file_type,
            "level": level,
            "content": null,
            "exists": true,
            "error": e.to_string(),
        })),
    }
}

/// Helper: scan a directory for files matching a pattern, returning config entries
fn scan_config_dir(
    dir: &Path,
    prefix: &str,
    file_type: &str,
    level: &str,
) -> Vec<serde_json::Value> {
    let mut entries = Vec::new();
    if let Ok(read_dir) = std::fs::read_dir(dir) {
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_file() {
                let rel = format!("{}/{}", prefix, entry.file_name().to_string_lossy());
                if let Some(val) = read_config_file_entry(&rel, &path, file_type, level) {
                    entries.push(val);
                }
            }
        }
    }
    entries
}

/// 读取项目级别的配置文件
pub fn read_project_configs(app: &str, project_dir: &str) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let _app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    let base = PathBuf::from(project_dir);
    if !base.is_dir() {
        return Err(format!("Project directory not found: {project_dir}"));
    }

    let mut files: Vec<serde_json::Value> = Vec::new();

    // Define candidate project-level config files per app
    let candidates: Vec<(&str, &str)> = match app {
        "claude" => vec![
            ("CLAUDE.md", "markdown"),
            (".claude/settings.json", "json"),
            (".claude/settings.local.json", "json"),
            (".claude/CLAUDE.md", "markdown"),
        ],
        "codex" => vec![
            ("AGENTS.md", "markdown"),
            ("codex.md", "markdown"),
            (".codex/config.toml", "toml"),
            (".codex/instructions.md", "markdown"),
        ],
        "gemini" => vec![
            ("GEMINI.md", "markdown"),
            (".gemini/settings.json", "json"),
            (".gemini/.env", "env"),
        ],
        "opencode" => vec![
            ("OPENCODE.md", "markdown"),
            (".opencode/config.json", "json"),
            (".opencode/instructions.md", "markdown"),
        ],
        _ => vec![],
    };

    for (rel_path, file_type) in candidates {
        let full_path = base.join(rel_path);
        if let Some(entry) = read_config_file_entry(rel_path, &full_path, file_type, "project") {
            files.push(entry);
        }
    }

    // Scan for custom commands/slash commands
    match app {
        "claude" => {
            let cmds_dir = base.join(".claude/commands");
            files.extend(scan_config_dir(&cmds_dir, ".claude/commands", "markdown", "project"));
        }
        "codex" => {
            let cmds_dir = base.join(".codex/commands");
            files.extend(scan_config_dir(&cmds_dir, ".codex/commands", "markdown", "project"));
        }
        _ => {}
    }

    Ok(json!({ "projectDir": project_dir, "files": files }))
}

/// 读取全局级别的所有配置文件（比 read_live_provider_settings 更全面，含 auth/credentials）
pub fn read_global_configs(app: &str) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let _app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    let mut files: Vec<serde_json::Value> = Vec::new();

    match app {
        "claude" => {
            let dir = cli_memory::get_claude_config_dir();
            let candidates = vec![
                ("settings.json", "json"),
                ("claude.json", "json"),
                (".credentials.json", "json"),
                ("credentials.json", "json"),
            ];
            for (name, ft) in candidates {
                let full = dir.join(name);
                if let Some(entry) = read_config_file_entry(name, &full, ft, "global") {
                    files.push(entry);
                }
            }
            // Scan ~/.claude/commands/
            let cmds_dir = dir.join("commands");
            files.extend(scan_config_dir(&cmds_dir, "commands", "markdown", "global"));
            // Scan ~/.claude/agents/
            let agents_dir = dir.join("agents");
            files.extend(scan_config_dir(&agents_dir, "agents", "markdown", "global"));
        }
        "codex" => {
            let dir = cli_memory::get_codex_config_dir();
            let candidates = vec![
                ("auth.json", "json"),
                ("config.toml", "toml"),
                ("instructions.md", "markdown"),
            ];
            for (name, ft) in candidates {
                let full = dir.join(name);
                if let Some(entry) = read_config_file_entry(name, &full, ft, "global") {
                    files.push(entry);
                }
            }
        }
        "gemini" => {
            let dir = cli_memory::get_gemini_dir();
            let candidates = vec![
                (".env", "env"),
                ("settings.json", "json"),
            ];
            for (name, ft) in candidates {
                let full = dir.join(name);
                if let Some(entry) = read_config_file_entry(name, &full, ft, "global") {
                    files.push(entry);
                }
            }
        }
        "opencode" => {
            let dir = cli_memory::get_opencode_dir();
            let candidates = vec![
                ("opencode.json", "json"),
                ("instructions.md", "markdown"),
            ];
            for (name, ft) in candidates {
                let full = dir.join(name);
                if let Some(entry) = read_config_file_entry(name, &full, ft, "global") {
                    files.push(entry);
                }
            }
        }
        _ => {}
    }

    Ok(json!({ "app": app, "files": files }))
}

/// 写入配置文件（全局或项目级别）
pub fn write_config_file(file_path: &str, content: &str) -> Result<bool, String> {
    let path = PathBuf::from(file_path);

    // Safety: only allow writing to known config locations
    let path_str = path.to_string_lossy();
    let allowed = path_str.contains("/.claude/")
        || path_str.contains("/.codex/")
        || path_str.contains("/.gemini/")
        || path_str.contains("/.config/opencode/")
        || path_str.contains("/.opencode/")
        || path_str.ends_with("/CLAUDE.md")
        || path_str.ends_with("/AGENTS.md")
        || path_str.ends_with("/codex.md")
        || path_str.ends_with("/GEMINI.md")
        || path_str.ends_with("/OPENCODE.md")
        || path_str.ends_with("/OPENCLAW.md");

    if !allowed {
        return Err(format!("Writing to this path is not allowed: {file_path}"));
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(true)
}

/// 检查并返回 symlink 状态（家目录 config dir <-> 持久化目录）
pub fn get_symlink_status(
    persistent_base: &str,
) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
    let home_path = PathBuf::from(&home);
    let persist_path = PathBuf::from(persistent_base);

    let apps: Vec<(&str, &str)> = vec![
        ("claude", ".claude"),
        ("codex", ".codex"),
        ("gemini", ".gemini"),
    ];

    let mut items: Vec<serde_json::Value> = Vec::new();

    for (app, dir_name) in apps {
        let home_dir = home_path.join(dir_name);
        let persist_dir = persist_path.join(dir_name);
        let persist_exists = persist_dir.is_dir();

        let (status, link_target) = if home_dir.is_symlink() {
            match std::fs::read_link(&home_dir) {
                Ok(target) => {
                    if target == persist_dir {
                        ("linked", target.to_string_lossy().to_string())
                    } else {
                        ("linked_other", target.to_string_lossy().to_string())
                    }
                }
                Err(_) => ("error", String::new()),
            }
        } else if home_dir.is_dir() {
            ("local_dir", String::new())
        } else {
            ("missing", String::new())
        };

        items.push(json!({
            "app": app,
            "dirName": dir_name,
            "homePath": home_dir.to_string_lossy(),
            "persistPath": persist_dir.to_string_lossy(),
            "persistExists": persist_exists,
            "status": status,
            "linkTarget": link_target,
        }));
    }

    Ok(json!({ "home": home, "persistentBase": persistent_base, "items": items }))
}

/// 创建 symlink：把家目录的 config dir 链接到持久化目录
pub fn create_config_symlink(
    app: &str,
    persistent_base: &str,
) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_string());
    let home_path = PathBuf::from(&home);
    let persist_path = PathBuf::from(persistent_base);

    let dir_name = match app {
        "claude" => ".claude",
        "codex" => ".codex",
        "gemini" => ".gemini",
        other => return Err(format!("Unsupported app for symlink: {other}")),
    };

    let home_dir = home_path.join(dir_name);
    let persist_dir = persist_path.join(dir_name);

    // Ensure persistent dir exists
    if !persist_dir.exists() {
        std::fs::create_dir_all(&persist_dir).map_err(|e| e.to_string())?;
    }

    // If home dir exists and is a real directory (not symlink), merge contents first
    if home_dir.is_dir() && !home_dir.is_symlink() {
        // Copy all contents from home dir to persistent dir (don't overwrite existing)
        if let Ok(entries) = std::fs::read_dir(&home_dir) {
            for entry in entries.flatten() {
                let src = entry.path();
                let dst = persist_dir.join(entry.file_name());
                if !dst.exists() {
                    if src.is_dir() {
                        let _ = copy_dir_recursive(&src, &dst);
                    } else {
                        let _ = std::fs::copy(&src, &dst);
                    }
                }
            }
        }
        // Remove the original directory
        std::fs::remove_dir_all(&home_dir).map_err(|e| {
            format!("Failed to remove original dir {}: {e}", home_dir.display())
        })?;
    } else if home_dir.is_symlink() {
        // Remove existing symlink
        std::fs::remove_file(&home_dir).map_err(|e| e.to_string())?;
    }

    // Create symlink: home_dir -> persist_dir
    std::os::unix::fs::symlink(&persist_dir, &home_dir).map_err(|e| {
        format!(
            "Failed to create symlink {} -> {}: {e}",
            home_dir.display(),
            persist_dir.display()
        )
    })?;

    Ok(json!({
        "success": true,
        "app": app,
        "homePath": home_dir.to_string_lossy(),
        "persistPath": persist_dir.to_string_lossy(),
    }))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    if let Ok(entries) = std::fs::read_dir(src) {
        for entry in entries.flatten() {
            let s = entry.path();
            let d = dst.join(entry.file_name());
            if s.is_dir() {
                copy_dir_recursive(&s, &d)?;
            } else {
                std::fs::copy(&s, &d).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// 获取自定义端点列表
pub fn get_custom_endpoints(
    ctx: &CoreContext,
    app: &str,
    provider_id: &str,
) -> Result<serde_json::Value, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    let endpoints = ProviderService::get_custom_endpoints(ctx.app_state(), app_type, provider_id)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(endpoints).map_err(|e| e.to_string())
}

/// 添加自定义端点
pub fn add_custom_endpoint(
    ctx: &CoreContext,
    app: &str,
    provider_id: &str,
    url: String,
) -> Result<(), String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    ProviderService::add_custom_endpoint(ctx.app_state(), app_type, provider_id, url)
        .map_err(|e| e.to_string())
}

/// 删除自定义端点
pub fn remove_custom_endpoint(
    ctx: &CoreContext,
    app: &str,
    provider_id: &str,
    url: String,
) -> Result<(), String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    ProviderService::remove_custom_endpoint(ctx.app_state(), app_type, provider_id, url)
        .map_err(|e| e.to_string())
}

/// 更新端点最后使用时间
pub fn update_endpoint_last_used(
    ctx: &CoreContext,
    app: &str,
    provider_id: &str,
    url: String,
) -> Result<(), String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    ProviderService::update_endpoint_last_used(ctx.app_state(), app_type, provider_id, url)
        .map_err(|e| e.to_string())
}

pub async fn stream_check_provider(
    ctx: &CoreContext,
    app_type: &str,
    provider_id: &str,
) -> Result<StreamCheckResult, String> {
    let app_type = AppType::from_str(app_type).map_err(|e| e.to_string())?;
    let config = ctx
        .app_state()
        .db
        .get_stream_check_config()
        .map_err(|e| e.to_string())?;

    let providers = ctx
        .app_state()
        .db
        .get_all_providers(app_type.as_str())
        .map_err(|e| e.to_string())?;
    let provider = providers
        .get(provider_id)
        .ok_or_else(|| format!("供应商 {provider_id} 不存在"))?;

    let result = StreamCheckService::check_with_retry(&app_type, provider, &config, None, None, None)
        .await
        .map_err(|e| e.to_string())?;

    let _ = ctx.app_state().db.save_stream_check_log(
        provider_id,
        &provider.name,
        app_type.as_str(),
        &result,
    );

    Ok(result)
}

pub async fn stream_check_all_providers(
    ctx: &CoreContext,
    app_type: &str,
    proxy_targets_only: bool,
) -> Result<Vec<(String, StreamCheckResult)>, String> {
    let app_type = AppType::from_str(app_type).map_err(|e| e.to_string())?;
    let config = ctx
        .app_state()
        .db
        .get_stream_check_config()
        .map_err(|e| e.to_string())?;
    let providers = ctx
        .app_state()
        .db
        .get_all_providers(app_type.as_str())
        .map_err(|e| e.to_string())?;

    let allowed_ids = if proxy_targets_only {
        let mut ids = std::collections::HashSet::new();
        if let Ok(Some(current_id)) = ctx.app_state().db.get_current_provider(app_type.as_str()) {
            ids.insert(current_id);
        }
        if let Ok(queue) = ctx.app_state().db.get_failover_queue(app_type.as_str()) {
            for item in queue {
                ids.insert(item.provider_id);
            }
        }
        Some(ids)
    } else {
        None
    };

    let mut results = Vec::new();
    for (id, provider) in providers {
        if let Some(ids) = &allowed_ids {
            if !ids.contains(&id) {
                continue;
            }
        }

        let result = StreamCheckService::check_with_retry(&app_type, &provider, &config, None, None, None)
            .await
            .unwrap_or_else(|e| StreamCheckResult {
                status: HealthStatus::Failed,
                success: false,
                message: e.to_string(),
                response_time_ms: None,
                http_status: None,
                model_used: String::new(),
                tested_at: Utc::now().timestamp(),
                retry_count: 0,
            });

        let _ = ctx.app_state().db.save_stream_check_log(
            &id,
            &provider.name,
            app_type.as_str(),
            &result,
        );

        results.push((id, result));
    }

    Ok(results)
}

pub fn get_stream_check_config(ctx: &CoreContext) -> Result<StreamCheckConfig, String> {
    ctx.app_state()
        .db
        .get_stream_check_config()
        .map_err(|e| e.to_string())
}

pub fn save_stream_check_config(
    ctx: &CoreContext,
    config: StreamCheckConfig,
) -> Result<(), String> {
    ctx.app_state()
        .db
        .save_stream_check_config(&config)
        .map_err(|e| e.to_string())
}

pub fn get_usage_summary(
    ctx: &CoreContext,
    start_date: Option<i64>,
    end_date: Option<i64>,
    app_type: Option<&str>,
) -> Result<UsageSummary, String> {
    ctx.app_state()
        .db
        .get_usage_summary(start_date, end_date, app_type)
        .map_err(|e| e.to_string())
}

pub fn get_usage_trends(
    ctx: &CoreContext,
    start_date: Option<i64>,
    end_date: Option<i64>,
    app_type: Option<&str>,
) -> Result<Vec<DailyStats>, String> {
    ctx.app_state()
        .db
        .get_daily_trends(start_date, end_date, app_type)
        .map_err(|e| e.to_string())
}

pub fn get_provider_stats(
    ctx: &CoreContext,
    app_type: Option<&str>,
) -> Result<Vec<ProviderStats>, String> {
    ctx.app_state()
        .db
        .get_provider_stats(app_type)
        .map_err(|e| e.to_string())
}

pub fn get_model_stats(
    ctx: &CoreContext,
    app_type: Option<&str>,
) -> Result<Vec<ModelStats>, String> {
    ctx.app_state()
        .db
        .get_model_stats(app_type)
        .map_err(|e| e.to_string())
}

pub fn sync_session_usage(ctx: &CoreContext) -> Result<SessionSyncResult, String> {
    sync_all_session_usage(&ctx.app_state().db).map_err(|e| e.to_string())
}

pub fn get_usage_data_sources(ctx: &CoreContext) -> Result<Vec<DataSourceSummary>, String> {
    get_all_usage_data_sources(&ctx.app_state().db).map_err(|e| e.to_string())
}

pub fn get_request_logs(
    ctx: &CoreContext,
    filters: LogFilters,
    page: u32,
    page_size: u32,
) -> Result<PaginatedLogs, String> {
    ctx.app_state()
        .db
        .get_request_logs(&filters, page, page_size)
        .map_err(|e| e.to_string())
}

pub fn get_request_detail(
    ctx: &CoreContext,
    request_id: &str,
) -> Result<Option<RequestLogDetail>, String> {
    ctx.app_state()
        .db
        .get_request_detail(request_id)
        .map_err(|e| e.to_string())
}

pub fn get_model_pricing(ctx: &CoreContext) -> Result<Vec<CoreModelPricingInfo>, String> {
    cli_memory::list_model_pricing(&ctx.app_state().db).map_err(|e| e.to_string())
}

pub fn update_model_pricing(
    ctx: &CoreContext,
    model_id: String,
    display_name: String,
    input_cost: String,
    output_cost: String,
    cache_read_cost: String,
    cache_creation_cost: String,
) -> Result<(), String> {
    cli_memory::upsert_model_pricing(
        &ctx.app_state().db,
        model_id,
        display_name,
        input_cost,
        output_cost,
        cache_read_cost,
        cache_creation_cost,
    )
    .map_err(|e| e.to_string())
}

pub fn delete_model_pricing(ctx: &CoreContext, model_id: String) -> Result<(), String> {
    cli_memory::remove_model_pricing(&ctx.app_state().db, model_id).map_err(|e| e.to_string())
}

pub fn check_provider_limits(
    ctx: &CoreContext,
    provider_id: &str,
    app_type: &str,
) -> Result<ProviderLimitStatus, String> {
    ctx.app_state()
        .db
        .check_provider_limits(provider_id, app_type)
        .map_err(|e| e.to_string())
}

/// 测试第三方/自定义供应商端点的网络延迟
pub async fn test_api_endpoints(
    urls: Vec<String>,
    timeout_secs: Option<u64>,
) -> Result<Vec<EndpointLatency>, String> {
    SpeedtestService::test_endpoints(urls, timeout_secs)
        .await
        .map_err(|e| e.to_string())
}

/// Web / 服务器模式下更新托盘菜单（无操作，返回 true 以兼容前端调用）
pub fn update_tray_menu(_ctx: &CoreContext) -> Result<bool, String> {
    Ok(true)
}

// ========================
// Settings 相关 API
// ========================

/// 获取应用设置
pub fn get_settings() -> AppSettings {
    cli_memory::get_settings()
}

/// 保存应用设置
pub fn save_settings(settings: AppSettings) -> Result<bool, String> {
    cli_memory::update_settings(settings).map_err(|e| e.to_string())?;
    Ok(true)
}

/// 获取整流器配置
pub fn get_rectifier_config(ctx: &CoreContext) -> Result<RectifierConfig, String> {
    ctx.app_state()
        .db
        .get_rectifier_config()
        .map_err(|e| e.to_string())
}

/// 设置整流器配置
pub fn set_rectifier_config(ctx: &CoreContext, config: RectifierConfig) -> Result<bool, String> {
    ctx.app_state()
        .db
        .set_rectifier_config(&config)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// 获取优化器配置
pub fn get_optimizer_config(ctx: &CoreContext) -> Result<OptimizerConfig, String> {
    ctx.app_state()
        .db
        .get_optimizer_config()
        .map_err(|e| e.to_string())
}

/// 设置优化器配置
pub fn set_optimizer_config(ctx: &CoreContext, config: OptimizerConfig) -> Result<bool, String> {
    match config.cache_ttl.as_str() {
        "5m" | "1h" => {}
        other => {
            return Err(format!(
                "Invalid cache_ttl value: '{other}'. Allowed values: '5m', '1h'"
            ));
        }
    }

    ctx.app_state()
        .db
        .set_optimizer_config(&config)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// 获取日志配置
pub fn get_log_config(ctx: &CoreContext) -> Result<LogConfig, String> {
    ctx.app_state()
        .db
        .get_log_config()
        .map_err(|e| e.to_string())
}

/// 设置日志配置
pub fn set_log_config(ctx: &CoreContext, config: LogConfig) -> Result<bool, String> {
    ctx.app_state()
        .db
        .set_log_config(&config)
        .map_err(|e| e.to_string())?;
    log::set_max_level(config.to_level_filter());
    log::info!(
        "日志配置已更新: enabled={}, level={}",
        config.enabled,
        config.level
    );
    Ok(true)
}

/// 获取 Claude Code 配置状态
pub fn get_claude_config_status() -> ConfigStatus {
    cli_memory::get_claude_config_status_sync()
}

/// 获取指定应用配置状态
pub fn get_config_status(app: &str) -> Result<ConfigStatus, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    let status = match app_type {
        AppType::Claude => cli_memory::get_claude_config_status_sync(),
        AppType::Codex => {
            let auth_path = cli_memory::get_codex_auth_path();
            ConfigStatus {
                exists: auth_path.exists(),
                path: cli_memory::get_codex_config_dir()
                    .to_string_lossy()
                    .to_string(),
            }
        }
        AppType::Gemini => {
            let env_path = cli_memory::get_gemini_env_path();
            ConfigStatus {
                exists: env_path.exists(),
                path: cli_memory::get_gemini_dir().to_string_lossy().to_string(),
            }
        }
        AppType::OpenCode => {
            let config_path = cli_memory::get_opencode_config_path();
            ConfigStatus {
                exists: config_path.exists(),
                path: cli_memory::get_opencode_dir().to_string_lossy().to_string(),
            }
        }
        AppType::OpenClaw => {
            let config_path = cli_memory::get_openclaw_config_path();
            ConfigStatus {
                exists: config_path.exists(),
                path: cli_memory::get_openclaw_dir().to_string_lossy().to_string(),
            }
        }
    };

    Ok(status)
}

/// 重启应用 (stub - not applicable for web server)
pub fn restart_app() -> Result<bool, String> {
    // Web server mode does not support app restart
    // Return true to indicate the request was received
    Ok(true)
}

/// 获取配置目录路径
pub fn get_config_dir(app: &str) -> Result<String, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    let dir = match app_type {
        AppType::Claude => cli_memory::get_claude_config_dir(),
        AppType::Codex => cli_memory::get_codex_config_dir(),
        AppType::Gemini => cli_memory::get_gemini_dir(),
        AppType::OpenCode => cli_memory::get_opencode_dir(),
        AppType::OpenClaw => cli_memory::get_openclaw_dir(),
    };
    Ok(dir.to_string_lossy().to_string())
}

fn get_home_dir() -> PathBuf {
    if let Ok(home) = std::env::var("CLI_MEMORY_TEST_HOME") {
        let trimmed = home.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }

    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn get_default_config_dir(app: &str) -> Result<String, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    let home = get_home_dir();
    let dir = match app_type {
        AppType::Claude => home.join(".claude"),
        AppType::Codex => home.join(".codex"),
        AppType::Gemini => home.join(".gemini"),
        AppType::OpenCode => home.join(".config").join("opencode"),
        AppType::OpenClaw => home.join(".openclaw"),
    };
    Ok(dir.to_string_lossy().to_string())
}

/// 打开配置文件夹 (stub - not applicable for web server)
/// Returns the path for the client to handle
pub fn open_config_folder(app: &str) -> Result<String, String> {
    get_config_dir(app)
}

/// 选择目录 (stub - not applicable for web server)
/// Returns None as directory picking requires native dialog
pub fn pick_directory() -> Result<Option<String>, String> {
    Ok(None)
}

/// 获取 Claude Code 配置文件路径
pub fn get_claude_code_config_path() -> String {
    cli_memory::get_claude_settings_path()
        .to_string_lossy()
        .to_string()
}

/// 获取应用配置文件路径
pub fn get_app_config_path() -> String {
    cli_memory::get_app_config_path()
        .to_string_lossy()
        .to_string()
}

/// 获取应用配置目录路径
pub fn get_app_config_dir() -> String {
    cli_memory::get_app_config_dir()
        .to_string_lossy()
        .to_string()
}

pub fn get_default_app_config_dir() -> String {
    get_home_dir().join(".cli-memory").to_string_lossy().to_string()
}

/// 打开应用配置文件夹 (stub - not applicable for web server)
/// Returns the path for the client to handle
pub fn open_app_config_folder() -> Result<String, String> {
    Ok(get_app_config_dir())
}

/// 获取 app_config_dir 覆盖配置
/// In web mode, we read from environment variable or return None
pub fn get_app_config_dir_override() -> Option<String> {
    std::env::var("CLI_MEMORY_CONFIG_DIR").ok()
}

/// 设置 app_config_dir 覆盖配置 (stub - not fully applicable for web server)
/// In web mode, this would require server restart to take effect
pub fn set_app_config_dir_override(_path: Option<&str>) -> Result<bool, String> {
    // Web server mode does not support runtime config dir changes
    // The config dir is determined at startup
    Ok(true)
}

/// 应用 Claude 插件配置
pub fn apply_claude_plugin_config(official: bool) -> Result<bool, String> {
    if official {
        cli_memory::clear_claude_config().map_err(|e| e.to_string())
    } else {
        cli_memory::write_claude_config().map_err(|e| e.to_string())
    }
}

/// 保存文件对话框 (stub - not applicable for web server)
/// Returns None as file dialogs require native UI
pub fn save_file_dialog() -> Result<Option<String>, String> {
    Ok(None)
}

/// 打开文件对话框 (stub - not applicable for web server)
/// Returns None as file dialogs require native UI
pub fn open_file_dialog() -> Result<Option<String>, String> {
    Ok(None)
}

/// 导出配置到文件
pub fn export_config_to_file(
    ctx: &CoreContext,
    file_path: &str,
) -> Result<serde_json::Value, String> {
    let target_path = std::path::PathBuf::from(file_path);
    export_database_to_file(ctx.app_state().db.clone(), &target_path)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "success": true,
        "message": "SQL exported successfully",
        "filePath": file_path
    }))
}

pub fn export_config_as_sql(ctx: &CoreContext) -> Result<(String, Vec<u8>), String> {
    let file_name = default_sql_export_file_name();
    let sql = export_database_sql(ctx.app_state().db.clone()).map_err(|e| e.to_string())?;
    Ok((file_name, sql.into_bytes()))
}

/// 从文件导入配置
pub fn import_config_from_file(
    ctx: &CoreContext,
    file_path: &str,
) -> Result<serde_json::Value, String> {
    let path_buf = std::path::PathBuf::from(file_path);
    import_database_with_sync(ctx.app_state().db.clone(), |db| db.import_sql(&path_buf))
        .map_err(|e| e.to_string())
}

pub fn import_config_from_sql_bytes(
    ctx: &CoreContext,
    sql_bytes: &[u8],
) -> Result<serde_json::Value, String> {
    let sql_content =
        std::str::from_utf8(sql_bytes).map_err(|e| format!("SQL 文件编码无效: {e}"))?;
    import_database_with_sync(ctx.app_state().db.clone(), |db| db.import_sql_string(sql_content))
        .map_err(|e| e.to_string())
}

/// 同步当前供应商到 live 配置
pub fn sync_current_providers_live(ctx: &CoreContext) -> Result<serde_json::Value, String> {
    ProviderService::sync_current_to_live(ctx.app_state()).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "success": true,
        "message": "Live configuration synchronized"
    }))
}

/// 打开 ZIP 文件对话框 (stub - not applicable for web server)
pub fn open_zip_file_dialog() -> Result<Option<String>, String> {
    Ok(None)
}

/// 创建数据库备份
pub fn create_db_backup(ctx: &CoreContext) -> Result<String, String> {
    match ctx
        .app_state()
        .db
        .backup_database_file()
        .map_err(|e| e.to_string())?
    {
        Some(path) => Ok(path
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default()),
        None => Err("Database file not found, backup skipped".to_string()),
    }
}

/// 列出数据库备份
pub fn list_db_backups() -> Result<Vec<BackupEntry>, String> {
    cli_memory::Database::list_backups().map_err(|e| e.to_string())
}

/// 恢复数据库备份
pub fn restore_db_backup(ctx: &CoreContext, filename: &str) -> Result<String, String> {
    ctx.app_state()
        .db
        .restore_from_backup(filename)
        .map_err(|e| e.to_string())
}

/// 重命名数据库备份
pub fn rename_db_backup(old_filename: &str, new_name: &str) -> Result<String, String> {
    cli_memory::Database::rename_backup(old_filename, new_name).map_err(|e| e.to_string())
}

/// 删除数据库备份
pub fn delete_db_backup(filename: &str) -> Result<(), String> {
    cli_memory::Database::delete_backup(filename).map_err(|e| e.to_string())
}

fn webdav_not_configured_error() -> String {
    cli_memory::AppError::localized(
        "webdav.sync.not_configured",
        "未配置 WebDAV 同步",
        "WebDAV sync is not configured.",
    )
    .to_string()
}

fn webdav_sync_disabled_error() -> String {
    cli_memory::AppError::localized(
        "webdav.sync.disabled",
        "WebDAV 同步未启用",
        "WebDAV sync is disabled.",
    )
    .to_string()
}

fn require_enabled_webdav_settings() -> Result<WebDavSyncSettings, String> {
    let settings = cli_memory::get_webdav_sync_settings().ok_or_else(webdav_not_configured_error)?;
    if !settings.enabled {
        return Err(webdav_sync_disabled_error());
    }
    Ok(settings)
}

fn resolve_password_for_request(
    mut incoming: WebDavSyncSettings,
    existing: Option<WebDavSyncSettings>,
    preserve_empty_password: bool,
) -> WebDavSyncSettings {
    if let Some(existing_settings) = existing {
        if preserve_empty_password && incoming.password.is_empty() {
            incoming.password = existing_settings.password;
        }
    }
    incoming
}

fn persist_sync_error(
    settings: &mut WebDavSyncSettings,
    error: &cli_memory::AppError,
    source: &str,
) {
    settings.status.last_error = Some(error.to_string());
    settings.status.last_error_source = Some(source.to_string());
    let _ = cli_memory::update_webdav_sync_status(settings.status.clone());
}

fn post_sync_warning(err: impl std::fmt::Display) -> String {
    cli_memory::AppError::localized(
        "sync.post_operation_sync_failed",
        format!("后置同步状态失败: {err}"),
        format!("Post-operation synchronization failed: {err}"),
    )
    .to_string()
}

fn attach_warning(mut value: serde_json::Value, warning: Option<String>) -> serde_json::Value {
    if let Some(message) = warning {
        if let Some(obj) = value.as_object_mut() {
            obj.insert("warning".to_string(), serde_json::Value::String(message));
        }
    }
    value
}

/// 测试 WebDAV 连接
pub async fn webdav_test_connection(
    settings: WebDavSyncSettings,
    preserve_empty_password: Option<bool>,
) -> Result<serde_json::Value, String> {
    let preserve_empty = preserve_empty_password.unwrap_or(true);
    let resolved = resolve_password_for_request(
        settings,
        cli_memory::get_webdav_sync_settings(),
        preserve_empty,
    );
    cli_memory::webdav_check_connection(&resolved)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "success": true,
        "message": "WebDAV connection ok"
    }))
}

/// 上传 WebDAV 同步快照
pub async fn webdav_sync_upload(ctx: &CoreContext) -> Result<serde_json::Value, String> {
    let db = ctx.app_state().db.clone();
    let mut settings = require_enabled_webdav_settings()?;

    let result =
        cli_memory::webdav_run_with_sync_lock(cli_memory::webdav_upload(&db, &mut settings)).await;
    match result {
        Ok(value) => Ok(value),
        Err(err) => {
            persist_sync_error(&mut settings, &err, "manual");
            Err(err.to_string())
        }
    }
}

/// 下载 WebDAV 同步快照
pub async fn webdav_sync_download(ctx: &CoreContext) -> Result<serde_json::Value, String> {
    let db = ctx.app_state().db.clone();
    let mut settings = require_enabled_webdav_settings()?;

    let result =
        cli_memory::webdav_run_with_sync_lock(cli_memory::webdav_download(&db, &mut settings)).await;
    let mut value = match result {
        Ok(value) => value,
        Err(err) => {
            persist_sync_error(&mut settings, &err, "manual");
            return Err(err.to_string());
        }
    };

    let warning = match ProviderService::sync_current_to_live(ctx.app_state()) {
        Ok(()) => match cli_memory::reload_settings() {
            Ok(()) => None,
            Err(err) => Some(post_sync_warning(err)),
        },
        Err(err) => Some(post_sync_warning(err)),
    };
    if let Some(msg) = warning.as_ref() {
        log::warn!("[WebDAV] post-download sync warning: {msg}");
    }
    value = attach_warning(value, warning);
    Ok(value)
}

/// 保存 WebDAV 同步设置
pub fn webdav_sync_save_settings(
    settings: WebDavSyncSettings,
    password_touched: Option<bool>,
) -> Result<serde_json::Value, String> {
    let password_touched = password_touched.unwrap_or(false);
    let existing = cli_memory::get_webdav_sync_settings();
    let mut sync_settings =
        resolve_password_for_request(settings, existing.clone(), !password_touched);

    if let Some(existing_settings) = existing {
        sync_settings.status = existing_settings.status;
    }

    sync_settings.normalize();
    sync_settings.validate().map_err(|e| e.to_string())?;
    cli_memory::set_webdav_sync_settings(Some(sync_settings)).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "success": true }))
}

/// 获取 WebDAV 远端信息
pub async fn webdav_sync_fetch_remote_info() -> Result<serde_json::Value, String> {
    let settings = require_enabled_webdav_settings()?;
    let info = cli_memory::webdav_fetch_remote_info(&settings)
        .await
        .map_err(|e| e.to_string())?;
    Ok(info.unwrap_or_else(|| serde_json::json!({ "empty": true })))
}

/// 获取统一供应商列表
pub fn get_universal_providers(
    ctx: &CoreContext,
) -> Result<std::collections::HashMap<String, UniversalProvider>, String> {
    ProviderService::list_universal(ctx.app_state()).map_err(|e| e.to_string())
}

/// 获取单个统一供应商
pub fn get_universal_provider(
    ctx: &CoreContext,
    id: &str,
) -> Result<Option<UniversalProvider>, String> {
    ProviderService::get_universal(ctx.app_state(), id).map_err(|e| e.to_string())
}

/// 新增或更新统一供应商
pub fn upsert_universal_provider(
    ctx: &CoreContext,
    provider: UniversalProvider,
) -> Result<bool, String> {
    ProviderService::upsert_universal(ctx.app_state(), provider).map_err(|e| e.to_string())
}

/// 删除统一供应商
pub fn delete_universal_provider(ctx: &CoreContext, id: &str) -> Result<bool, String> {
    ProviderService::delete_universal(ctx.app_state(), id).map_err(|e| e.to_string())
}

/// 同步统一供应商到各应用 live 配置
pub fn sync_universal_provider(ctx: &CoreContext, id: &str) -> Result<bool, String> {
    ProviderService::sync_universal_to_apps(ctx.app_state(), id).map_err(|e| e.to_string())
}

const ALLOWED_WORKSPACE_FILES: &[&str] = &[
    "AGENTS.md",
    "SOUL.md",
    "USER.md",
    "IDENTITY.md",
    "TOOLS.md",
    "MEMORY.md",
    "HEARTBEAT.md",
    "BOOTSTRAP.md",
    "BOOT.md",
];

fn validate_workspace_filename(filename: &str) -> Result<(), String> {
    if !ALLOWED_WORKSPACE_FILES.contains(&filename) {
        return Err(format!(
            "Invalid workspace filename: {filename}. Allowed: {}",
            ALLOWED_WORKSPACE_FILES.join(", ")
        ));
    }
    Ok(())
}

fn validate_daily_memory_filename(filename: &str) -> Result<(), String> {
    let bytes = filename.as_bytes();
    let valid = bytes.len() == 13
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && filename.ends_with(".md")
        && bytes[..4].iter().all(u8::is_ascii_digit)
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[8..10].iter().all(u8::is_ascii_digit);
    if !valid {
        return Err(format!(
            "Invalid daily memory filename: {filename}. Expected: YYYY-MM-DD.md"
        ));
    }
    Ok(())
}

fn floor_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

fn ceil_char_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

fn workspace_root() -> std::path::PathBuf {
    cli_memory::get_openclaw_dir().join("workspace")
}

fn memory_root() -> std::path::PathBuf {
    workspace_root().join("memory")
}

/// 读取工作区文件
pub fn read_workspace_file(filename: &str) -> Result<Option<String>, String> {
    validate_workspace_filename(filename)?;
    let path = workspace_root().join(filename);
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Failed to read workspace file {filename}: {e}"))
}

/// 写入工作区文件
pub fn write_workspace_file(filename: &str, content: &str) -> Result<(), String> {
    validate_workspace_filename(filename)?;
    let root = workspace_root();
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create workspace directory: {e}"))?;
    let path = root.join(filename);
    cli_memory::write_text_file(&path, content).map_err(|e| e.to_string())
}

/// 列出 daily memory 文件
pub fn list_daily_memory_files() -> Result<Vec<serde_json::Value>, String> {
    let root = memory_root();
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in
        std::fs::read_dir(&root).map_err(|e| format!("Failed to read memory directory: {e}"))?
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".md") {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(meta) if meta.is_file() => meta,
            _ => continue,
        };
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let preview = std::fs::read_to_string(entry.path())
            .unwrap_or_default()
            .chars()
            .take(200)
            .collect::<String>();
        files.push(serde_json::json!({
            "filename": name,
            "date": name.trim_end_matches(".md"),
            "sizeBytes": meta.len(),
            "modifiedAt": modified_at,
            "preview": preview,
        }));
    }

    files.sort_by(|a, b| {
        b.get("filename")
            .and_then(|v| v.as_str())
            .cmp(&a.get("filename").and_then(|v| v.as_str()))
    });
    Ok(files)
}

/// 读取 daily memory 文件
pub fn read_daily_memory_file(filename: &str) -> Result<Option<String>, String> {
    validate_daily_memory_filename(filename)?;
    let path = memory_root().join(filename);
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Failed to read daily memory file {filename}: {e}"))
}

/// 写入 daily memory 文件
pub fn write_daily_memory_file(filename: &str, content: &str) -> Result<(), String> {
    validate_daily_memory_filename(filename)?;
    let root = memory_root();
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create memory directory: {e}"))?;
    let path = root.join(filename);
    cli_memory::write_text_file(&path, content).map_err(|e| e.to_string())
}

/// 删除 daily memory 文件
pub fn delete_daily_memory_file(filename: &str) -> Result<(), String> {
    validate_daily_memory_filename(filename)?;
    let path = memory_root().join(filename);
    if path.exists() {
        std::fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete daily memory file {filename}: {e}"))?;
    }
    Ok(())
}

/// 搜索 daily memory 文件
pub fn search_daily_memory_files(query: &str) -> Result<Vec<serde_json::Value>, String> {
    let root = memory_root();
    if !root.exists() || query.is_empty() {
        return Ok(Vec::new());
    }

    let query_lower = query.to_lowercase();
    let mut results = Vec::new();
    for entry in
        std::fs::read_dir(&root).map_err(|e| format!("Failed to read memory directory: {e}"))?
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".md") {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(meta) if meta.is_file() => meta,
            _ => continue,
        };
        let date = name.trim_end_matches(".md").to_string();
        let content = std::fs::read_to_string(entry.path()).unwrap_or_default();
        let content_lower = content.to_lowercase();
        let content_matches: Vec<usize> = content_lower
            .match_indices(&query_lower)
            .map(|(i, _)| i)
            .collect();
        let date_matches = date.to_lowercase().contains(&query_lower);
        if content_matches.is_empty() && !date_matches {
            continue;
        }
        let snippet = if let Some(&first_pos) = content_matches.first() {
            let start = if first_pos > 50 {
                floor_char_boundary(&content, first_pos - 50)
            } else {
                0
            };
            let end = ceil_char_boundary(&content, (first_pos + 70).min(content.len()));
            let mut s = String::new();
            if start > 0 {
                s.push_str("...");
            }
            s.push_str(&content[start..end]);
            if end < content.len() {
                s.push_str("...");
            }
            s
        } else {
            let end = ceil_char_boundary(&content, 120.min(content.len()));
            let mut s = content[..end].to_string();
            if end < content.len() {
                s.push_str("...");
            }
            s
        };
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);
        results.push(serde_json::json!({
            "filename": name,
            "date": date,
            "sizeBytes": meta.len(),
            "modifiedAt": modified_at,
            "snippet": snippet,
            "matchCount": content_matches.len(),
        }));
    }

    results.sort_by(|a, b| {
        b.get("filename")
            .and_then(|v| v.as_str())
            .cmp(&a.get("filename").and_then(|v| v.as_str()))
    });
    Ok(results)
}

/// 打开工作区目录 (web-safe stub)
pub fn open_workspace_directory(subdir: &str) -> Result<String, String> {
    let dir = match subdir {
        "memory" => memory_root(),
        _ => workspace_root(),
    };
    if !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create directory: {e}"))?;
    }
    Ok(dir.to_string_lossy().to_string())
}

/// 打开外部链接 (stub - not applicable for web server)
/// Returns the URL for the client to handle
pub fn open_external(url: &str) -> Result<String, String> {
    let url = if url.starts_with("http://") || url.starts_with("https://") {
        url.to_string()
    } else {
        format!("https://{url}")
    };
    Ok(url)
}

/// 设置开机自启 (stub - not applicable for web server)
pub fn set_auto_launch(_enabled: bool) -> Result<bool, String> {
    // Web server mode does not support auto launch
    Ok(true)
}

/// 获取开机自启状态 (stub - returns false for web server)
pub fn get_auto_launch_status() -> Result<bool, String> {
    // Web server mode does not support auto launch
    Ok(false)
}

fn unsupported_in_web(command: &str) -> String {
    format!("{command} is not supported in web server mode")
}

fn get_skill_service(ctx: &CoreContext) -> Result<&Arc<SkillService>, String> {
    ctx.skill_service()
        .ok_or_else(|| "SkillService 未初始化".to_string())
}

fn parse_skill_app_type(app: &str) -> Result<AppType, String> {
    match app.to_lowercase().as_str() {
        "claude" => Ok(AppType::Claude),
        "codex" => Ok(AppType::Codex),
        "gemini" => Ok(AppType::Gemini),
        "opencode" => Ok(AppType::OpenCode),
        _ => Err(format!("不支持的 app 类型: {app}")),
    }
}

// ========================
// Skill 相关 API
// ========================

/// 获取所有技能（返回 JSON 值，避免直接依赖内部 Skill 类型）
pub async fn get_skills(ctx: &CoreContext) -> Result<serde_json::Value, String> {
    let service = ctx
        .skill_service()
        .ok_or_else(|| "SkillService 未初始化".to_string())?;

    let repos = ctx
        .app_state()
        .db
        .get_skill_repos()
        .map_err(|e| e.to_string())?;

    let skills = service
        .list_skills(repos, &ctx.app_state().db)
        .await
        .map_err(|e| e.to_string())?;

    serde_json::to_value(skills).map_err(|e| e.to_string())
}

/// 获取所有已安装的 Skills
pub fn get_installed_skills(ctx: &CoreContext) -> Result<serde_json::Value, String> {
    let skills = SkillService::get_all_installed(&ctx.app_state().db).map_err(|e| e.to_string())?;
    serde_json::to_value(skills).map_err(|e| e.to_string())
}

/// 安装 Skill（新版统一安装）
pub async fn install_skill_unified(
    ctx: &CoreContext,
    skill: DiscoverableSkill,
    current_app: &str,
) -> Result<serde_json::Value, String> {
    let app_type = parse_skill_app_type(current_app)?;
    let installed = get_skill_service(ctx)?
        .install(&ctx.app_state().db, &skill, &app_type)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(installed).map_err(|e| e.to_string())
}

/// 卸载 Skill（新版统一卸载）
pub fn uninstall_skill_unified(ctx: &CoreContext, id: &str) -> Result<bool, String> {
    SkillService::uninstall(&ctx.app_state().db, id).map_err(|e| e.to_string())?;
    Ok(true)
}

/// 切换 Skill 的应用启用状态
pub fn toggle_skill_app(
    ctx: &CoreContext,
    id: &str,
    app: &str,
    enabled: bool,
) -> Result<bool, String> {
    let app_type = parse_skill_app_type(app)?;
    SkillService::toggle_app(&ctx.app_state().db, id, &app_type, enabled)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// 扫描未管理的 Skills
pub fn scan_unmanaged_skills(ctx: &CoreContext) -> Result<serde_json::Value, String> {
    let skills = SkillService::scan_unmanaged(&ctx.app_state().db).map_err(|e| e.to_string())?;
    serde_json::to_value(skills).map_err(|e| e.to_string())
}

/// 从应用目录导入 Skills
pub fn import_skills_from_apps(
    ctx: &CoreContext,
    directories: Vec<String>,
) -> Result<serde_json::Value, String> {
    let imports = directories
        .into_iter()
        .map(|directory| cli_memory::ImportSkillSelection {
            directory,
            apps: cli_memory::SkillApps::default(),
        })
        .collect();
    let installed = SkillService::import_from_apps(&ctx.app_state().db, imports)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(installed).map_err(|e| e.to_string())
}

/// 发现可安装的 Skills
pub async fn discover_available_skills(ctx: &CoreContext) -> Result<serde_json::Value, String> {
    let repos = ctx
        .app_state()
        .db
        .get_skill_repos()
        .map_err(|e| e.to_string())?;
    let skills = get_skill_service(ctx)?
        .discover_available(repos)
        .await
        .map_err(|e| e.to_string())?;
    serde_json::to_value(skills).map_err(|e| e.to_string())
}

/// 获取指定应用的技能列表
pub async fn get_skills_for_app(ctx: &CoreContext, app: &str) -> Result<serde_json::Value, String> {
    let _ = parse_skill_app_type(app)?;
    get_skills(ctx).await
}

/// 安装技能（兼容旧 API）
pub async fn install_skill(ctx: &CoreContext, directory: &str) -> Result<bool, String> {
    install_skill_for_app(ctx, "claude", directory).await
}

/// 安装指定应用的技能（兼容旧 API）
pub async fn install_skill_for_app(
    ctx: &CoreContext,
    app: &str,
    directory: &str,
) -> Result<bool, String> {
    let app_type = parse_skill_app_type(app)?;
    let repos = ctx
        .app_state()
        .db
        .get_skill_repos()
        .map_err(|e| e.to_string())?;
    let skills = get_skill_service(ctx)?
        .discover_available(repos)
        .await
        .map_err(|e| e.to_string())?;

    let skill = skills
        .into_iter()
        .find(|skill| {
            let install_name = Path::new(&skill.directory)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| skill.directory.clone());
            install_name.eq_ignore_ascii_case(directory)
                || skill.directory.eq_ignore_ascii_case(directory)
        })
        .ok_or_else(|| format!("未找到可安装的 Skill: {directory}"))?;

    get_skill_service(ctx)?
        .install(&ctx.app_state().db, &skill, &app_type)
        .await
        .map_err(|e| e.to_string())?;

    Ok(true)
}

/// 卸载技能（兼容旧 API）
pub fn uninstall_skill(ctx: &CoreContext, directory: &str) -> Result<bool, String> {
    uninstall_skill_for_app(ctx, "claude", directory)
}

/// 卸载指定应用的技能（兼容旧 API）
pub fn uninstall_skill_for_app(
    ctx: &CoreContext,
    app: &str,
    directory: &str,
) -> Result<bool, String> {
    let _ = parse_skill_app_type(app)?;
    let skills = SkillService::get_all_installed(&ctx.app_state().db).map_err(|e| e.to_string())?;

    let skill = skills
        .into_iter()
        .find(|skill| skill.directory.eq_ignore_ascii_case(directory))
        .ok_or_else(|| format!("未找到已安装的 Skill: {directory}"))?;

    SkillService::uninstall(&ctx.app_state().db, &skill.id).map_err(|e| e.to_string())?;
    Ok(true)
}

/// 获取技能仓库列表
pub fn get_skill_repos(ctx: &CoreContext) -> Result<Vec<SkillRepo>, String> {
    ctx.app_state()
        .db
        .get_skill_repos()
        .map_err(|e| e.to_string())
}

/// 添加技能仓库
pub fn add_skill_repo(ctx: &CoreContext, repo: SkillRepo) -> Result<bool, String> {
    ctx.app_state()
        .db
        .save_skill_repo(&repo)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// 删除技能仓库
pub fn remove_skill_repo(ctx: &CoreContext, owner: &str, name: &str) -> Result<bool, String> {
    ctx.app_state()
        .db
        .delete_skill_repo(owner, name)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// 从 ZIP 文件安装 Skills
pub fn install_skills_from_zip(
    ctx: &CoreContext,
    file_path: &str,
    current_app: &str,
) -> Result<serde_json::Value, String> {
    let app_type = parse_skill_app_type(current_app)?;
    let installed =
        SkillService::install_from_zip(&ctx.app_state().db, Path::new(file_path), &app_type)
            .map_err(|e| e.to_string())?;
    serde_json::to_value(installed).map_err(|e| e.to_string())
}

/// 获取工具版本信息
pub async fn get_tool_versions(
    tools: Option<Vec<String>>,
    wsl_shell_by_tool: Option<HashMap<String, WslShellPreferenceInput>>,
) -> Result<serde_json::Value, String> {
    let versions = cli_memory::get_tool_versions(tools, wsl_shell_by_tool).await?;
    serde_json::to_value(versions).map_err(|e| e.to_string())
}

/// 获取会话列表
pub async fn list_sessions() -> Result<serde_json::Value, String> {
    let sessions = cli_memory::list_sessions().await?;
    serde_json::to_value(sessions).map_err(|e| e.to_string())
}

/// 搜索会话列表，包含完整 transcript 内容
pub async fn search_sessions(
    query: &str,
    provider_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    let sessions =
        cli_memory::search_sessions(query.to_string(), provider_id.map(str::to_string)).await?;
    serde_json::to_value(sessions).map_err(|e| e.to_string())
}

/// 读取会话消息
pub async fn get_session_messages(
    provider_id: &str,
    source_path: &str,
) -> Result<serde_json::Value, String> {
    let messages =
        cli_memory::get_session_messages(provider_id.to_string(), source_path.to_string()).await?;
    serde_json::to_value(messages).map_err(|e| e.to_string())
}

/// 启动会话终端（web 不支持）
pub async fn launch_session_terminal(
    command: &str,
    cwd: Option<String>,
    custom_config: Option<String>,
    initial_input: Option<String>,
) -> Result<bool, String> {
    terminal_launcher::launch_terminal_command(command, cwd, custom_config, initial_input)?;
    Ok(true)
}

/// 删除会话
pub async fn delete_session(
    provider_id: &str,
    session_id: &str,
    source_path: &str,
) -> Result<bool, String> {
    cli_memory::delete_session(
        provider_id.to_string(),
        session_id.to_string(),
        source_path.to_string(),
    )
    .await
}

/// 获取 Claude 插件配置状态
pub async fn get_claude_plugin_status() -> Result<ConfigStatus, String> {
    cli_memory::get_claude_plugin_status().await
}

/// 读取 Claude 插件配置
pub async fn read_claude_plugin_config() -> Result<Option<String>, String> {
    cli_memory::read_claude_plugin_config().await
}

/// Claude 插件是否已应用
pub async fn is_claude_plugin_applied() -> Result<bool, String> {
    cli_memory::is_claude_plugin_applied().await
}

/// 跳过 Claude onboarding
pub async fn apply_claude_onboarding_skip() -> Result<bool, String> {
    cli_memory::apply_claude_onboarding_skip().await
}

/// 清除 Claude onboarding 跳过状态
pub async fn clear_claude_onboarding_skip() -> Result<bool, String> {
    cli_memory::clear_claude_onboarding_skip().await
}

/// 获取 Claude 官方认证状态
pub fn get_claude_official_auth_status() -> Result<ClaudeOfficialAuthStatus, String> {
    Ok(claude_auth::get_claude_official_auth_status())
}

/// 运行 Claude 官方认证命令
pub fn run_claude_official_auth_command(action: &str) -> Result<bool, String> {
    claude_auth::run_claude_official_auth_command(action)
}

/// 提取通用配置片段
pub fn extract_common_config_snippet(
    ctx: &CoreContext,
    app_type: &str,
    settings_config: Option<&str>,
) -> Result<String, String> {
    let app = AppType::from_str(app_type).map_err(|e| e.to_string())?;

    if let Some(settings_config) = settings_config.filter(|value| !value.trim().is_empty()) {
        let settings: serde_json::Value =
            serde_json::from_str(settings_config).map_err(|e| format!("无效的 JSON 格式: {e}"))?;

        return ProviderService::extract_common_config_snippet_from_settings(app, &settings)
            .map_err(|e| e.to_string());
    }

    ProviderService::extract_common_config_snippet(ctx.app_state(), app).map_err(|e| e.to_string())
}

/// 从 live 配置移除 provider
pub fn remove_provider_from_live_config(
    ctx: &CoreContext,
    app: &str,
    id: &str,
) -> Result<bool, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    ProviderService::remove_from_live_config(ctx.app_state(), app_type, id)
        .map(|_| true)
        .map_err(|e| e.to_string())
}

/// 从各应用导入 MCP
pub fn import_mcp_from_apps(ctx: &CoreContext) -> Result<usize, String> {
    let mut total = 0;
    total += cli_memory::McpService::import_from_claude(ctx.app_state()).unwrap_or(0);
    total += cli_memory::McpService::import_from_codex(ctx.app_state()).unwrap_or(0);
    total += cli_memory::McpService::import_from_gemini(ctx.app_state()).unwrap_or(0);
    total += cli_memory::McpService::import_from_opencode(ctx.app_state()).unwrap_or(0);
    Ok(total)
}

/// 从 deep link 导入 provider（兼容旧 API）
pub fn import_from_deeplink(
    ctx: &CoreContext,
    request: cli_memory::DeepLinkImportRequest,
) -> Result<String, String> {
    cli_memory::import_provider_from_deeplink(ctx.app_state(), request).map_err(|e| e.to_string())
}

/// 导入 OpenClaw live providers
pub fn import_openclaw_providers_from_live(ctx: &CoreContext) -> Result<usize, String> {
    cli_memory::import_openclaw_providers_from_live(ctx.app_state()).map_err(|e| e.to_string())
}

/// 获取 OpenClaw live provider IDs
pub fn get_openclaw_live_provider_ids() -> Result<Vec<String>, String> {
    cli_memory::get_openclaw_live_provider_ids().map_err(|e| e.to_string())
}

/// 获取单个 OpenClaw live provider
pub fn get_openclaw_live_provider(provider_id: &str) -> Result<Option<serde_json::Value>, String> {
    cli_memory::get_openclaw_live_provider(provider_id.to_string()).map_err(|e| e.to_string())
}

/// 扫描 OpenClaw 配置健康状态
pub fn scan_openclaw_config_health() -> Result<serde_json::Value, String> {
    let warnings = cli_memory::scan_openclaw_config_health().map_err(|e| e.to_string())?;
    serde_json::to_value(warnings).map_err(|e| e.to_string())
}

/// 获取 OpenClaw 默认模型
pub fn get_openclaw_default_model() -> Result<serde_json::Value, String> {
    let model = cli_memory::get_openclaw_default_model().map_err(|e| e.to_string())?;
    serde_json::to_value(model).map_err(|e| e.to_string())
}

/// 设置 OpenClaw 默认模型
pub fn set_openclaw_default_model(
    model: OpenClawDefaultModel,
) -> Result<serde_json::Value, String> {
    let outcome = cli_memory::set_openclaw_default_model(model).map_err(|e| e.to_string())?;
    serde_json::to_value(outcome).map_err(|e| e.to_string())
}

/// 获取 OpenClaw 模型目录
pub fn get_openclaw_model_catalog() -> Result<serde_json::Value, String> {
    let catalog = cli_memory::get_openclaw_model_catalog().map_err(|e| e.to_string())?;
    serde_json::to_value(catalog).map_err(|e| e.to_string())
}

/// 设置 OpenClaw 模型目录
pub fn set_openclaw_model_catalog(
    catalog: HashMap<String, OpenClawModelCatalogEntry>,
) -> Result<serde_json::Value, String> {
    let outcome = cli_memory::set_openclaw_model_catalog(catalog).map_err(|e| e.to_string())?;
    serde_json::to_value(outcome).map_err(|e| e.to_string())
}

/// 获取 OpenClaw agents defaults
pub fn get_openclaw_agents_defaults() -> Result<serde_json::Value, String> {
    let defaults = cli_memory::get_openclaw_agents_defaults().map_err(|e| e.to_string())?;
    serde_json::to_value(defaults).map_err(|e| e.to_string())
}

/// 设置 OpenClaw agents defaults
pub fn set_openclaw_agents_defaults(
    defaults: OpenClawAgentsDefaults,
) -> Result<serde_json::Value, String> {
    let outcome = cli_memory::set_openclaw_agents_defaults(defaults).map_err(|e| e.to_string())?;
    serde_json::to_value(outcome).map_err(|e| e.to_string())
}

/// 获取 OpenClaw env 配置
pub fn get_openclaw_env() -> Result<serde_json::Value, String> {
    let env = cli_memory::get_openclaw_env().map_err(|e| e.to_string())?;
    serde_json::to_value(env).map_err(|e| e.to_string())
}

/// 设置 OpenClaw env 配置
pub fn set_openclaw_env(env: OpenClawEnvConfig) -> Result<serde_json::Value, String> {
    let outcome = cli_memory::set_openclaw_env(env).map_err(|e| e.to_string())?;
    serde_json::to_value(outcome).map_err(|e| e.to_string())
}

/// 获取 OpenClaw tools 配置
pub fn get_openclaw_tools() -> Result<serde_json::Value, String> {
    let tools = cli_memory::get_openclaw_tools().map_err(|e| e.to_string())?;
    serde_json::to_value(tools).map_err(|e| e.to_string())
}

/// 设置 OpenClaw tools 配置
pub fn set_openclaw_tools(tools: OpenClawToolsConfig) -> Result<serde_json::Value, String> {
    let outcome = cli_memory::set_openclaw_tools(tools).map_err(|e| e.to_string())?;
    serde_json::to_value(outcome).map_err(|e| e.to_string())
}

/// 获取全局代理 URL
pub fn get_global_proxy_url(ctx: &CoreContext) -> Result<Option<String>, String> {
    ctx.app_state()
        .db
        .get_global_proxy_url()
        .map_err(|e| e.to_string())
}

/// 设置全局代理 URL
pub fn set_global_proxy_url(ctx: &CoreContext, url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    let url_opt = (!trimmed.is_empty()).then_some(trimmed);
    cli_memory::validate_global_proxy(url_opt).map_err(|e| e.to_string())?;
    ctx.app_state()
        .db
        .set_global_proxy_url(url_opt)
        .map_err(|e| e.to_string())?;
    cli_memory::apply_global_proxy(url_opt).map_err(|e| e.to_string())
}

/// 测试全局代理 URL
pub async fn test_proxy_url(url: &str) -> Result<serde_json::Value, String> {
    let result = cli_memory::test_proxy_url(url.to_string()).await?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

/// 获取当前上游代理状态
pub fn get_upstream_proxy_status() -> Result<serde_json::Value, String> {
    let status = cli_memory::get_upstream_proxy_status();
    serde_json::to_value(status).map_err(|e| e.to_string())
}

/// 扫描本地代理
pub async fn scan_local_proxies() -> Result<serde_json::Value, String> {
    let proxies = cli_memory::scan_local_proxies().await;
    serde_json::to_value(proxies).map_err(|e| e.to_string())
}

/// 设置窗口主题（web no-op）
pub fn set_window_theme(_theme: &str) -> Result<(), String> {
    Ok(())
}

/// 读取 OMO 本地文件
pub async fn read_omo_local_file() -> Result<serde_json::Value, String> {
    let data = cli_memory::read_omo_local_file().await?;
    serde_json::to_value(data).map_err(|e| e.to_string())
}

/// 获取当前 OMO provider ID
pub fn get_current_omo_provider_id(ctx: &CoreContext) -> Result<String, String> {
    let provider = ctx
        .app_state()
        .db
        .get_current_omo_provider("opencode", "omo")
        .map_err(|e| e.to_string())?;
    Ok(provider.map(|value| value.id).unwrap_or_default())
}

/// 禁用当前 OMO
pub fn disable_current_omo(ctx: &CoreContext) -> Result<(), String> {
    let providers = ctx
        .app_state()
        .db
        .get_all_providers("opencode")
        .map_err(|e| e.to_string())?;
    for (id, provider) in &providers {
        if provider.category.as_deref() == Some("omo") {
            ctx.app_state()
                .db
                .clear_omo_provider_current("opencode", id, "omo")
                .map_err(|e| e.to_string())?;
        }
    }
    cli_memory::OmoService::delete_config_file(&cli_memory::OMO_STANDARD).map_err(|e| e.to_string())
}

/// 读取 OMO Slim 本地文件
pub async fn read_omo_slim_local_file() -> Result<serde_json::Value, String> {
    let data = cli_memory::read_omo_slim_local_file().await?;
    serde_json::to_value(data).map_err(|e| e.to_string())
}

/// 获取当前 OMO Slim provider ID
pub fn get_current_omo_slim_provider_id(ctx: &CoreContext) -> Result<String, String> {
    let provider = ctx
        .app_state()
        .db
        .get_current_omo_provider("opencode", "omo-slim")
        .map_err(|e| e.to_string())?;
    Ok(provider.map(|value| value.id).unwrap_or_default())
}

/// 禁用当前 OMO Slim
pub fn disable_current_omo_slim(ctx: &CoreContext) -> Result<(), String> {
    let providers = ctx
        .app_state()
        .db
        .get_all_providers("opencode")
        .map_err(|e| e.to_string())?;
    for (id, provider) in &providers {
        if provider.category.as_deref() == Some("omo-slim") {
            ctx.app_state()
                .db
                .clear_omo_provider_current("opencode", id, "omo-slim")
                .map_err(|e| e.to_string())?;
        }
    }
    cli_memory::OmoService::delete_config_file(&cli_memory::OMO_SLIM).map_err(|e| e.to_string())
}

/// 导入 OpenCode live providers
pub fn import_opencode_providers_from_live(ctx: &CoreContext) -> Result<usize, String> {
    cli_memory::import_opencode_providers_from_live(ctx.app_state()).map_err(|e| e.to_string())
}

/// 获取 OpenCode live provider IDs
pub fn get_opencode_live_provider_ids() -> Result<Vec<String>, String> {
    cli_memory::get_opencode_live_provider_ids().map_err(|e| e.to_string())
}

/// 打开 provider terminal（web 不支持）
pub async fn open_provider_terminal(
    _ctx: &CoreContext,
    _app: &str,
    _provider_id: &str,
) -> Result<bool, String> {
    Err(unsupported_in_web("open_provider_terminal"))
}

// ========================
// MCP 相关 API
// ========================

/// MCP 状态信息
pub use cli_memory::McpStatus;

/// 获取 Claude MCP 状态
pub fn get_claude_mcp_status() -> Result<McpStatus, String> {
    cli_memory::get_claude_mcp_status_raw().map_err(|e| e.to_string())
}

/// 读取 Claude MCP 配置文件内容
pub fn read_claude_mcp_config() -> Result<Option<String>, String> {
    cli_memory::read_claude_mcp_config_raw().map_err(|e| e.to_string())
}

/// 在 Claude MCP 配置中添加或更新服务器
pub fn upsert_claude_mcp_server(id: &str, spec: serde_json::Value) -> Result<bool, String> {
    cli_memory::upsert_claude_mcp_server_raw(id, spec).map_err(|e| e.to_string())
}

/// 在 Claude MCP 配置中删除服务器
pub fn delete_claude_mcp_server(id: &str) -> Result<bool, String> {
    cli_memory::delete_claude_mcp_server_raw(id).map_err(|e| e.to_string())
}

/// 校验命令是否在 PATH 中可用
pub fn validate_mcp_command(cmd: &str) -> Result<bool, String> {
    cli_memory::validate_mcp_command_raw(cmd).map_err(|e| e.to_string())
}

/// MCP 配置响应（用于兼容旧 API）
#[derive(serde::Serialize)]
pub struct McpConfigResponse {
    pub config_path: String,
    pub servers: std::collections::HashMap<String, serde_json::Value>,
}

/// 获取 MCP 配置（来自 ~/.cli-memory/config.json）
#[allow(deprecated)]
pub fn get_mcp_config(ctx: &CoreContext, app: &str) -> Result<McpConfigResponse, String> {
    let config_path = cli_memory::get_app_config_path()
        .to_string_lossy()
        .to_string();
    let app_ty = AppType::from_str(app).map_err(|e| e.to_string())?;
    let servers =
        cli_memory::McpService::get_servers(ctx.app_state(), app_ty).map_err(|e| e.to_string())?;
    Ok(McpConfigResponse {
        config_path,
        servers,
    })
}

/// 在 config.json 中新增或更新一个 MCP 服务器定义（兼容旧 API）
pub fn upsert_mcp_server_in_config(
    ctx: &CoreContext,
    app: &str,
    id: &str,
    spec: serde_json::Value,
    sync_other_side: Option<bool>,
) -> Result<bool, String> {
    use cli_memory::McpApps;

    let app_ty = AppType::from_str(app).map_err(|e| e.to_string())?;

    // 读取现有的服务器（如果存在）
    let existing_server = {
        let servers = ctx
            .app_state()
            .db
            .get_all_mcp_servers()
            .map_err(|e| e.to_string())?;
        servers.get(id).cloned()
    };

    // 构建新的统一服务器结构
    let mut new_server = if let Some(mut existing) = existing_server {
        // 更新现有服务器
        existing.server = spec.clone();
        existing.apps.set_enabled_for(&app_ty, true);
        existing
    } else {
        // 创建新服务器
        let mut apps = McpApps::default();
        apps.set_enabled_for(&app_ty, true);

        // 尝试从 spec 中提取 name，否则使用 id
        let name = spec
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(id)
            .to_string();

        McpServer {
            id: id.to_string(),
            name,
            server: spec,
            apps,
            description: None,
            homepage: None,
            docs: None,
            tags: Vec::new(),
        }
    };

    // 如果 sync_other_side 为 true，也启用其他应用
    if sync_other_side.unwrap_or(false) {
        new_server.apps.claude = true;
        new_server.apps.codex = true;
        new_server.apps.gemini = true;
    }

    cli_memory::McpService::upsert_server(ctx.app_state(), new_server)
        .map(|_| true)
        .map_err(|e| e.to_string())
}

/// 在 config.json 中删除一个 MCP 服务器定义
pub fn delete_mcp_server_in_config(ctx: &CoreContext, id: &str) -> Result<bool, String> {
    cli_memory::McpService::delete_server(ctx.app_state(), id).map_err(|e| e.to_string())
}

/// 设置启用状态并同步到客户端配置
#[allow(deprecated)]
pub fn set_mcp_enabled(
    ctx: &CoreContext,
    app: &str,
    id: &str,
    enabled: bool,
) -> Result<bool, String> {
    let app_ty = AppType::from_str(app).map_err(|e| e.to_string())?;
    cli_memory::McpService::set_enabled(ctx.app_state(), app_ty, id, enabled)
        .map_err(|e| e.to_string())
}

/// 获取所有 MCP 服务器（统一结构）
pub fn get_mcp_servers(ctx: &CoreContext) -> Result<IndexMap<String, McpServer>, String> {
    cli_memory::McpService::get_all_servers(ctx.app_state()).map_err(|e| e.to_string())
}

/// 添加或更新 MCP 服务器（统一结构）
pub fn upsert_mcp_server(ctx: &CoreContext, server: McpServer) -> Result<(), String> {
    cli_memory::McpService::upsert_server(ctx.app_state(), server).map_err(|e| e.to_string())
}

/// 删除 MCP 服务器
pub fn delete_mcp_server(ctx: &CoreContext, id: &str) -> Result<bool, String> {
    cli_memory::McpService::delete_server(ctx.app_state(), id).map_err(|e| e.to_string())
}

/// 切换 MCP 服务器在指定应用的启用状态
pub fn toggle_mcp_app(
    ctx: &CoreContext,
    server_id: &str,
    app: &str,
    enabled: bool,
) -> Result<(), String> {
    let app_ty = AppType::from_str(app).map_err(|e| e.to_string())?;
    cli_memory::McpService::toggle_app(ctx.app_state(), server_id, app_ty, enabled)
        .map_err(|e| e.to_string())
}

// ========================
// Prompt 相关 API
// ========================

/// 导出 Prompt 类型
pub use cli_memory::Prompt;

/// 获取所有提示词
pub fn get_prompts(
    ctx: &CoreContext,
    app: &str,
) -> Result<IndexMap<String, cli_memory::Prompt>, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    cli_memory::PromptService::get_prompts(ctx.app_state(), app_type).map_err(|e| e.to_string())
}

/// 添加或更新提示词
pub fn upsert_prompt(
    ctx: &CoreContext,
    app: &str,
    id: &str,
    prompt: cli_memory::Prompt,
) -> Result<(), String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    cli_memory::PromptService::upsert_prompt(ctx.app_state(), app_type, id, prompt)
        .map_err(|e| e.to_string())
}

/// 删除提示词
pub fn delete_prompt(ctx: &CoreContext, app: &str, id: &str) -> Result<(), String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    cli_memory::PromptService::delete_prompt(ctx.app_state(), app_type, id)
        .map_err(|e| e.to_string())
}

/// 启用提示词
pub fn enable_prompt(ctx: &CoreContext, app: &str, id: &str) -> Result<(), String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    cli_memory::PromptService::enable_prompt(ctx.app_state(), app_type, id)
        .map_err(|e| e.to_string())
}

/// 从文件导入提示词
pub fn import_prompt_from_file(ctx: &CoreContext, app: &str) -> Result<String, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    cli_memory::PromptService::import_from_file(ctx.app_state(), app_type).map_err(|e| e.to_string())
}

/// 获取当前提示词文件内容
pub fn get_current_prompt_file_content(app: &str) -> Result<Option<String>, String> {
    let app_type = AppType::from_str(app).map_err(|e| e.to_string())?;
    cli_memory::PromptService::get_current_file_content(app_type).map_err(|e| e.to_string())
}

// ========================
// Environment 相关 API
// ========================

/// 导出环境变量相关类型
pub use cli_memory::{BackupInfo, EnvConflict};

/// 检查环境变量冲突
pub fn check_env_conflicts(app: &str) -> Result<Vec<cli_memory::EnvConflict>, String> {
    cli_memory::check_env_conflicts(app)
}

/// 删除环境变量（带备份）
pub fn delete_env_vars(
    conflicts: Vec<cli_memory::EnvConflict>,
) -> Result<cli_memory::BackupInfo, String> {
    cli_memory::delete_env_vars(conflicts)
}

/// 从备份恢复环境变量
pub fn restore_env_backup(backup_path: &str) -> Result<(), String> {
    cli_memory::restore_from_backup(backup_path.to_string())
}

// ========================
// Config Snippet 相关 API
// ========================

/// 获取 Claude 通用配置片段（已废弃，使用 get_common_config_snippet）
pub fn get_claude_common_config_snippet(ctx: &CoreContext) -> Result<Option<String>, String> {
    ctx.app_state()
        .db
        .get_config_snippet("claude")
        .map_err(|e| e.to_string())
}

/// 设置 Claude 通用配置片段（已废弃，使用 set_common_config_snippet）
pub fn set_claude_common_config_snippet(ctx: &CoreContext, snippet: &str) -> Result<(), String> {
    // 验证是否为有效的 JSON（如果不为空）
    if !snippet.trim().is_empty() {
        serde_json::from_str::<serde_json::Value>(snippet)
            .map_err(|e| format!("无效的 JSON 格式: {e}"))?;
    }

    let value = if snippet.trim().is_empty() {
        None
    } else {
        Some(snippet.to_string())
    };

    ctx.app_state()
        .db
        .set_config_snippet("claude", value)
        .map_err(|e| e.to_string())
}

/// 获取通用配置片段（统一接口）
pub fn get_common_config_snippet(
    ctx: &CoreContext,
    app_type: &str,
) -> Result<Option<String>, String> {
    ctx.app_state()
        .db
        .get_config_snippet(app_type)
        .map_err(|e| e.to_string())
}

/// 设置通用配置片段（统一接口）
pub fn set_common_config_snippet(
    ctx: &CoreContext,
    app_type: &str,
    snippet: &str,
) -> Result<(), String> {
    // 验证格式（根据应用类型）
    if !snippet.trim().is_empty() {
        match app_type {
            "claude" | "gemini" => {
                // 验证 JSON 格式
                serde_json::from_str::<serde_json::Value>(snippet)
                    .map_err(|e| format!("无效的 JSON 格式: {e}"))?;
            }
            "codex" => {
                // TOML 格式暂不验证
            }
            _ => {}
        }
    }

    let value = if snippet.trim().is_empty() {
        None
    } else {
        Some(snippet.to_string())
    };

    ctx.app_state()
        .db
        .set_config_snippet(app_type, value)
        .map_err(|e| e.to_string())
}

// ========================
// DeepLink 相关 API
// ========================

/// 导出 DeepLinkImportRequest 类型
pub use cli_memory::DeepLinkImportRequest;

/// 解析深链接 URL
pub fn parse_deeplink(url: &str) -> Result<cli_memory::DeepLinkImportRequest, String> {
    cli_memory::parse_deeplink_url(url).map_err(|e| e.to_string())
}

/// 合并深链接配置（从 Base64/URL 解析并填充完整配置）
pub fn merge_deeplink_config(
    request: cli_memory::DeepLinkImportRequest,
) -> Result<cli_memory::DeepLinkImportRequest, String> {
    cli_memory::parse_and_merge_config(&request).map_err(|e| e.to_string())
}

/// 统一导入深链接资源
pub fn import_from_deeplink_unified(
    ctx: &CoreContext,
    request: cli_memory::DeepLinkImportRequest,
) -> Result<serde_json::Value, String> {
    match request.resource.as_str() {
        "provider" => {
            let provider_id = cli_memory::import_provider_from_deeplink(ctx.app_state(), request)
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!({
                "type": "provider",
                "id": provider_id
            }))
        }
        "prompt" => {
            let prompt_id = cli_memory::import_prompt_from_deeplink(ctx.app_state(), request)
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!({
                "type": "prompt",
                "id": prompt_id
            }))
        }
        "mcp" => {
            let result = cli_memory::import_mcp_from_deeplink(ctx.app_state(), request)
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!({
                "type": "mcp",
                "importedCount": result.imported_count,
                "importedIds": result.imported_ids,
                "failed": result.failed
            }))
        }
        "skill" => {
            let skill_key = cli_memory::import_skill_from_deeplink(ctx.app_state(), request)
                .map_err(|e| e.to_string())?;
            Ok(serde_json::json!({
                "type": "skill",
                "key": skill_key
            }))
        }
        _ => Err(format!("Unsupported resource type: {}", request.resource)),
    }
}
