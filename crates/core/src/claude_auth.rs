use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
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

fn credentials_path() -> std::path::PathBuf {
    cc_switch::get_claude_config_dir().join(".credentials.json")
}

fn settings_path() -> std::path::PathBuf {
    cc_switch::get_claude_settings_path()
}

fn cli_available() -> bool {
    std::process::Command::new("sh")
        .arg("-c")
        .arg("command -v claude >/dev/null 2>&1")
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn parse_claude_credentials(
    content: &str,
) -> (bool, &'static str, Option<String>) {
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

    let expires_at = entry.get("expiresAt");
    if expires_at.is_some() && token_is_expired(expires_at.unwrap()) {
        return (
            false,
            "expired",
            Some("Claude OAuth token has expired".to_string()),
        );
    }

    (true, "valid", None)
}

fn token_is_expired(expires_at: &serde_json::Value) -> bool {
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    match expires_at {
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
    }
}

pub fn get_claude_official_auth_status() -> ClaudeOfficialAuthStatus {
    let config_dir = cc_switch::get_claude_config_dir();
    let settings_path = settings_path();
    let credentials_path = credentials_path();
    let credentials_file_exists = credentials_path.exists();
    let cli_available = cli_available();

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

    ClaudeOfficialAuthStatus {
        config_dir: config_dir.to_string_lossy().to_string(),
        settings_path: settings_path.to_string_lossy().to_string(),
        credentials_path: credentials_path.to_string_lossy().to_string(),
        credentials_file_exists,
        cli_available,
        authenticated,
        credential_status: credential_status.to_string(),
        detail,
        login_command: "claude login".to_string(),
        logout_command: "claude logout".to_string(),
        doctor_command: "claude doctor".to_string(),
    }
}

pub fn run_claude_official_auth_command(action: &str) -> Result<bool, String> {
    let command = match action {
        "login" => "claude login",
        "logout" => "claude logout",
        "doctor" => "claude doctor",
        other => return Err(format!("Unsupported Claude auth action: {other}")),
    };

    crate::terminal_launcher::launch_terminal_command(command, None, None, None)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_claude_credentials() {
        let (authenticated, status, detail) = parse_claude_credentials(
            r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat-test","expiresAt":4102444800}}"#,
        );

        assert!(authenticated);
        assert_eq!(status, "valid");
        assert!(detail.is_none());
    }

    #[test]
    fn marks_expired_claude_credentials() {
        let (authenticated, status, detail) = parse_claude_credentials(
            r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat-test","expiresAt":1}}"#,
        );

        assert!(!authenticated);
        assert_eq!(status, "expired");
        assert!(detail.unwrap().contains("expired"));
    }
}
