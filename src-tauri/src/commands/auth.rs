use tauri::State;

use crate::commands::codex_oauth::CodexOAuthState;
use crate::commands::copilot::CopilotAuthState;
use crate::proxy::providers::codex_oauth_auth::CodexOAuthError;
use crate::proxy::providers::copilot_auth::{
    CopilotAuthError, GitHubAccount, GitHubDeviceCodeResponse,
};

const AUTH_PROVIDER_GITHUB_COPILOT: &str = "github_copilot";
const AUTH_PROVIDER_CODEX_OAUTH: &str = "codex_oauth";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeOfficialAuthStatus {
    pub config_dir: String,
    pub settings_path: String,
    pub credentials_path: String,
    pub credentials_file_exists: bool,
    pub cli_available: bool,
    pub authenticated: bool,
    pub credential_status: String,
    pub detail: Option<String>,
    pub login_command: String,
    pub logout_command: String,
    pub doctor_command: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ManagedAuthAccount {
    pub id: String,
    pub provider: String,
    pub login: String,
    pub avatar_url: Option<String>,
    pub authenticated_at: i64,
    pub is_default: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ManagedAuthStatus {
    pub provider: String,
    pub authenticated: bool,
    pub default_account_id: Option<String>,
    pub migration_error: Option<String>,
    pub accounts: Vec<ManagedAuthAccount>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ManagedAuthDeviceCodeResponse {
    pub provider: String,
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

fn ensure_auth_provider(auth_provider: &str) -> Result<&'static str, String> {
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => Ok(AUTH_PROVIDER_GITHUB_COPILOT),
        AUTH_PROVIDER_CODEX_OAUTH => Ok(AUTH_PROVIDER_CODEX_OAUTH),
        _ => Err(format!("Unsupported auth provider: {auth_provider}")),
    }
}

fn map_account(
    provider: &str,
    account: GitHubAccount,
    default_account_id: Option<&str>,
) -> ManagedAuthAccount {
    ManagedAuthAccount {
        is_default: default_account_id == Some(account.id.as_str()),
        id: account.id,
        provider: provider.to_string(),
        login: account.login,
        avatar_url: account.avatar_url,
        authenticated_at: account.authenticated_at,
    }
}

fn map_device_code_response(
    provider: &str,
    response: GitHubDeviceCodeResponse,
) -> ManagedAuthDeviceCodeResponse {
    ManagedAuthDeviceCodeResponse {
        provider: provider.to_string(),
        device_code: response.device_code,
        user_code: response.user_code,
        verification_uri: response.verification_uri,
        expires_in: response.expires_in,
        interval: response.interval,
    }
}

fn parse_claude_credentials(content: &str) -> (bool, &'static str, Option<String>) {
    let parsed: serde_json::Value = match serde_json::from_str(content) {
        Ok(value) => value,
        Err(error) => {
            return (
                false,
                "parse_error",
                Some(format!("Failed to parse credentials JSON: {error}")),
            )
        }
    };

    let entry = match parsed
        .get("claudeAiOauth")
        .or_else(|| parsed.get("claude.ai_oauth"))
    {
        Some(value) => value,
        None => {
            return (
                false,
                "parse_error",
                Some("No Claude OAuth entry found in credentials".to_string()),
            )
        }
    };

    let token = entry
        .get("accessToken")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let Some(_token) = token else {
        return (
            false,
            "parse_error",
            Some("accessToken is empty or missing".to_string()),
        );
    };

    if let Some(expires_at) = entry.get("expiresAt") {
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let expired = match expires_at {
            serde_json::Value::Number(value) => value
                .as_u64()
                .map(|timestamp| {
                    let timestamp_secs = if timestamp > 1_000_000_000_000 {
                        timestamp / 1000
                    } else {
                        timestamp
                    };
                    timestamp_secs <= now_secs
                })
                .unwrap_or(false),
            serde_json::Value::String(value) => chrono::DateTime::parse_from_rfc3339(value)
                .map(|timestamp| timestamp.timestamp() <= now_secs as i64)
                .unwrap_or(false),
            _ => false,
        };

        if expired {
            return (
                false,
                "expired",
                Some("Claude OAuth token has expired".to_string()),
            );
        }
    }

    (true, "valid", None)
}

fn claude_cli_available() -> bool {
    std::process::Command::new("sh")
        .arg("-c")
        .arg("command -v claude >/dev/null 2>&1")
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn get_claude_official_auth_status() -> Result<ClaudeOfficialAuthStatus, String> {
    let config_dir = crate::config::get_claude_config_dir();
    let settings_path = crate::config::get_claude_settings_path();
    let credentials_path = config_dir.join(".credentials.json");
    let credentials_file_exists = credentials_path.exists();

    let (authenticated, credential_status, detail) = if credentials_file_exists {
        match std::fs::read_to_string(&credentials_path) {
            Ok(content) => parse_claude_credentials(&content),
            Err(error) => (
                false,
                "parse_error",
                Some(format!("Failed to read credentials file: {error}")),
            ),
        }
    } else {
        (false, "not_found", None)
    };

    Ok(ClaudeOfficialAuthStatus {
        config_dir: config_dir.to_string_lossy().to_string(),
        settings_path: settings_path.to_string_lossy().to_string(),
        credentials_path: credentials_path.to_string_lossy().to_string(),
        credentials_file_exists,
        cli_available: claude_cli_available(),
        authenticated,
        credential_status: credential_status.to_string(),
        detail,
        login_command: "claude login".to_string(),
        logout_command: "claude logout".to_string(),
        doctor_command: "claude doctor".to_string(),
    })
}

#[tauri::command(rename_all = "camelCase")]
pub async fn run_claude_official_auth_command(action: String) -> Result<bool, String> {
    let command = match action.as_str() {
        "login" => "claude login",
        "logout" => "claude logout",
        "doctor" => "claude doctor",
        other => return Err(format!("Unsupported Claude auth action: {other}")),
    };

    crate::commands::launch_session_terminal(command.to_string(), None, None)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn auth_start_login(
    auth_provider: String,
    copilot_state: State<'_, CopilotAuthState>,
    codex_state: State<'_, CodexOAuthState>,
) -> Result<ManagedAuthDeviceCodeResponse, String> {
    let auth_provider = ensure_auth_provider(&auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.0.read().await;
            let response = auth_manager
                .start_device_flow()
                .await
                .map_err(|e| e.to_string())?;
            Ok(map_device_code_response(auth_provider, response))
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.0.read().await;
            let response = auth_manager
                .start_device_flow()
                .await
                .map_err(|e| e.to_string())?;
            Ok(map_device_code_response(auth_provider, response))
        }
        _ => unreachable!(),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn auth_poll_for_account(
    auth_provider: String,
    device_code: String,
    copilot_state: State<'_, CopilotAuthState>,
    codex_state: State<'_, CodexOAuthState>,
) -> Result<Option<ManagedAuthAccount>, String> {
    let auth_provider = ensure_auth_provider(&auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.0.write().await;
            match auth_manager.poll_for_token(&device_code).await {
                Ok(account) => {
                    let default_account_id = auth_manager.get_status().await.default_account_id;
                    Ok(account.map(|account| {
                        map_account(auth_provider, account, default_account_id.as_deref())
                    }))
                }
                Err(CopilotAuthError::AuthorizationPending) => Ok(None),
                Err(e) => Err(e.to_string()),
            }
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.0.write().await;
            match auth_manager.poll_for_token(&device_code).await {
                Ok(account) => {
                    let default_account_id = auth_manager.get_status().await.default_account_id;
                    Ok(account.map(|account| {
                        map_account(auth_provider, account, default_account_id.as_deref())
                    }))
                }
                Err(CodexOAuthError::AuthorizationPending) => Ok(None),
                Err(e) => Err(e.to_string()),
            }
        }
        _ => unreachable!(),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn auth_list_accounts(
    auth_provider: String,
    copilot_state: State<'_, CopilotAuthState>,
    codex_state: State<'_, CodexOAuthState>,
) -> Result<Vec<ManagedAuthAccount>, String> {
    let auth_provider = ensure_auth_provider(&auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.0.read().await;
            let status = auth_manager.get_status().await;
            let default_account_id = status.default_account_id.clone();
            Ok(status
                .accounts
                .into_iter()
                .map(|account| map_account(auth_provider, account, default_account_id.as_deref()))
                .collect())
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.0.read().await;
            let status = auth_manager.get_status().await;
            let default_account_id = status.default_account_id.clone();
            Ok(status
                .accounts
                .into_iter()
                .map(|account| map_account(auth_provider, account, default_account_id.as_deref()))
                .collect())
        }
        _ => unreachable!(),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn auth_get_status(
    auth_provider: String,
    copilot_state: State<'_, CopilotAuthState>,
    codex_state: State<'_, CodexOAuthState>,
) -> Result<ManagedAuthStatus, String> {
    let auth_provider = ensure_auth_provider(&auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.0.read().await;
            let status = auth_manager.get_status().await;
            let default_account_id = status.default_account_id.clone();
            Ok(ManagedAuthStatus {
                provider: auth_provider.to_string(),
                authenticated: status.authenticated,
                default_account_id: default_account_id.clone(),
                migration_error: status.migration_error,
                accounts: status
                    .accounts
                    .into_iter()
                    .map(|account| {
                        map_account(auth_provider, account, default_account_id.as_deref())
                    })
                    .collect(),
            })
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.0.read().await;
            let status = auth_manager.get_status().await;
            let default_account_id = status.default_account_id.clone();
            Ok(ManagedAuthStatus {
                provider: auth_provider.to_string(),
                authenticated: status.authenticated,
                default_account_id: default_account_id.clone(),
                migration_error: None,
                accounts: status
                    .accounts
                    .into_iter()
                    .map(|account| {
                        map_account(auth_provider, account, default_account_id.as_deref())
                    })
                    .collect(),
            })
        }
        _ => unreachable!(),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn auth_remove_account(
    auth_provider: String,
    account_id: String,
    copilot_state: State<'_, CopilotAuthState>,
    codex_state: State<'_, CodexOAuthState>,
) -> Result<(), String> {
    let auth_provider = ensure_auth_provider(&auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.0.write().await;
            auth_manager
                .remove_account(&account_id)
                .await
                .map_err(|e| e.to_string())
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.0.write().await;
            auth_manager
                .remove_account(&account_id)
                .await
                .map_err(|e| e.to_string())
        }
        _ => unreachable!(),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn auth_set_default_account(
    auth_provider: String,
    account_id: String,
    copilot_state: State<'_, CopilotAuthState>,
    codex_state: State<'_, CodexOAuthState>,
) -> Result<(), String> {
    let auth_provider = ensure_auth_provider(&auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.0.write().await;
            auth_manager
                .set_default_account(&account_id)
                .await
                .map_err(|e| e.to_string())
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.0.write().await;
            auth_manager
                .set_default_account(&account_id)
                .await
                .map_err(|e| e.to_string())
        }
        _ => unreachable!(),
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn auth_logout(
    auth_provider: String,
    copilot_state: State<'_, CopilotAuthState>,
    codex_state: State<'_, CodexOAuthState>,
) -> Result<(), String> {
    let auth_provider = ensure_auth_provider(&auth_provider)?;
    match auth_provider {
        AUTH_PROVIDER_GITHUB_COPILOT => {
            let auth_manager = copilot_state.0.write().await;
            auth_manager.clear_auth().await.map_err(|e| e.to_string())
        }
        AUTH_PROVIDER_CODEX_OAUTH => {
            let auth_manager = codex_state.0.write().await;
            auth_manager.clear_auth().await.map_err(|e| e.to_string())
        }
        _ => unreachable!(),
    }
}
