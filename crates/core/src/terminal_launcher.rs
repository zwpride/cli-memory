use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn unique_suffix() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}_{}", std::process::id(), now)
}

fn write_file(path: &PathBuf, content: &str) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn make_executable(path: &PathBuf) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let perms = std::fs::Permissions::from_mode(0o755);
    std::fs::set_permissions(path, perms)
        .map_err(|e| format!("Failed to chmod {}: {e}", path.display()))
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn make_executable(_path: &PathBuf) -> Result<(), String> {
    Ok(())
}

fn shell_escape(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn build_cd_line(cwd: Option<&str>) -> String {
    match cwd {
        Some(dir) if !dir.trim().is_empty() => format!("cd {}\n", shell_escape(dir)),
        _ => String::new(),
    }
}

fn write_command_script(command: &str, cwd: Option<&str>) -> Result<PathBuf, String> {
    let script_path = std::env::temp_dir().join(format!(
        "cc_switch_terminal_command_{}.sh",
        unique_suffix()
    ));
    let content = format!(
        r#"#!/bin/bash
set +e
{cd_line}{command}
status=$?
rm -f "{script_path}"
exec bash --norc --noprofile
"#,
        cd_line = build_cd_line(cwd),
        command = command,
        script_path = script_path.display(),
    );
    write_file(&script_path, &content)?;
    make_executable(&script_path)?;
    Ok(script_path)
}

fn write_handoff_bridge(command: &str, initial_input: &str, cwd: Option<&str>) -> Result<PathBuf, String> {
    #[derive(serde::Serialize)]
    struct HandoffSpec<'a> {
        command: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        cwd: Option<&'a str>,
        initial_input: &'a str,
    }

    let suffix = unique_suffix();
    let temp_dir = std::env::temp_dir();
    let spec_path = temp_dir.join(format!("cc_switch_handoff_spec_{suffix}.json"));
    let bridge_path = temp_dir.join(format!("cc_switch_handoff_bridge_{suffix}.py"));
    let wrapper_path = temp_dir.join(format!("cc_switch_handoff_wrapper_{suffix}.sh"));

    let spec = serde_json::to_string(&HandoffSpec {
        command,
        cwd,
        initial_input,
    })
    .map_err(|e| format!("Failed to serialize handoff spec: {e}"))?;

    const BRIDGE_SCRIPT: &str = r#"#!/usr/bin/env python3
import json
import os
import pty
import select
import sys
import termios
import threading
import time
import tty

def main():
    if len(sys.argv) < 2:
        raise SystemExit("missing spec path")

    with open(sys.argv[1], "r", encoding="utf-8") as fh:
        spec = json.load(fh)

    command = spec["command"]
    cwd = spec.get("cwd")
    initial_input = spec.get("initial_input") or ""
    shell = os.environ.get("SHELL") or "/bin/bash"

    pid, fd = pty.fork()
    if pid == 0:
        if cwd:
            os.chdir(cwd)
        os.execvp(shell, [shell, "-lc", command])

    def inject_input():
        if not initial_input:
            return
        time.sleep(1.2)
        try:
            os.write(fd, initial_input.encode("utf-8"))
            os.write(fd, b"\n")
        except OSError:
            pass

    threading.Thread(target=inject_input, daemon=True).start()

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()
    old_settings = None
    try:
        old_settings = termios.tcgetattr(stdin_fd)
        tty.setraw(stdin_fd)
    except Exception:
        old_settings = None

    try:
        while True:
            ready, _, _ = select.select([fd, stdin_fd], [], [])
            if fd in ready:
                try:
                    chunk = os.read(fd, 4096)
                except OSError:
                    break
                if not chunk:
                    break
                os.write(stdout_fd, chunk)
            if stdin_fd in ready:
                try:
                    chunk = os.read(stdin_fd, 4096)
                except OSError:
                    break
                if not chunk:
                    break
                os.write(fd, chunk)
    finally:
        if old_settings is not None:
            try:
                termios.tcsetattr(stdin_fd, termios.TCSADRAIN, old_settings)
            except Exception:
                pass

if __name__ == "__main__":
    main()
"#;

    let wrapper = format!(
        r#"#!/bin/bash
set +e
PYTHON_BIN="$(command -v python3 || command -v python)"
if [ -z "$PYTHON_BIN" ]; then
  echo "python3 is required for cross-tool handoff"
  rm -f "{bridge_path}" "{spec_path}" "$0"
  exec bash --norc --noprofile
fi
"$PYTHON_BIN" "{bridge_path}" "{spec_path}"
status=$?
rm -f "{bridge_path}" "{spec_path}" "$0"
exec bash --norc --noprofile
"#,
        bridge_path = bridge_path.display(),
        spec_path = spec_path.display(),
    );

    write_file(&spec_path, &spec)?;
    write_file(&bridge_path, BRIDGE_SCRIPT)?;
    write_file(&wrapper_path, &wrapper)?;
    make_executable(&bridge_path)?;
    make_executable(&wrapper_path)?;
    Ok(wrapper_path)
}

#[cfg(target_os = "linux")]
fn launch_linux_terminal(command_line: &str, custom_config: Option<&str>) -> Result<(), String> {
    let preferred = cc_switch::get_settings().preferred_terminal;
    let default_terminals = [
        ("gnome-terminal", vec!["--"]),
        ("konsole", vec!["-e"]),
        ("xfce4-terminal", vec!["-e"]),
        ("mate-terminal", vec!["--"]),
        ("lxterminal", vec!["-e"]),
        ("alacritty", vec!["-e"]),
        ("kitty", vec!["-e"]),
        ("ghostty", vec!["-e"]),
        ("wezterm", vec!["start", "--"]),
    ];

    if let Some(template) = custom_config.filter(|value| !value.trim().is_empty()) {
        let final_cmd = template
            .replace("{command}", command_line)
            .replace("{cwd}", ".");
        let status = Command::new("sh")
            .arg("-c")
            .arg(final_cmd)
            .status()
            .map_err(|e| format!("Failed to execute custom terminal command: {e}"))?;
        if status.success() {
            return Ok(());
        }
        return Err("Custom terminal command exited with failure".to_string());
    }

    let terminals_to_try: Vec<(String, Vec<&str>)> = if let Some(pref) = preferred {
        let pref_args = default_terminals
            .iter()
            .find(|(name, _)| *name == pref.as_str())
            .map(|(_, args)| args.to_vec())
            .unwrap_or_else(|| vec!["-e"]);
        let mut list = vec![(pref.clone(), pref_args)];
        for (name, args) in &default_terminals {
            if *name != pref.as_str() {
                list.push(((*name).to_string(), args.to_vec()));
            }
        }
        list
    } else {
        default_terminals
            .iter()
            .map(|(name, args)| ((*name).to_string(), args.to_vec()))
            .collect()
    };

    let mut last_error = String::from("No supported terminal emulator found");
    for (terminal, args) in terminals_to_try {
        let terminal_exists = which_command(&terminal);
        if !terminal_exists {
            continue;
        }

        let result = Command::new(&terminal)
            .args(args)
            .arg("bash")
            .arg("-lc")
            .arg(command_line)
            .spawn();

        match result {
            Ok(_) => return Ok(()),
            Err(error) => {
                last_error = format!("Failed to launch {terminal}: {error}");
            }
        }
    }

    Err(last_error)
}

#[cfg(target_os = "linux")]
fn which_command(command: &str) -> bool {
    Command::new("which")
        .arg(command)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn launch_macos_terminal(command_line: &str, _custom_config: Option<&str>) -> Result<(), String> {
    let escaped = command_line.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        r#"tell application "Terminal"
    activate
    do script "{escaped}"
end tell"#
    );
    let status = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .status()
        .map_err(|e| format!("Failed to launch Terminal.app: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Terminal.app launch failed".to_string())
    }
}

pub fn launch_terminal_command(
    command: &str,
    cwd: Option<String>,
    custom_config: Option<String>,
    initial_input: Option<String>,
) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("Terminal command is empty".to_string());
    }

    let script = if let Some(initial_input) = initial_input.filter(|value| !value.trim().is_empty()) {
        write_handoff_bridge(command, &initial_input, cwd.as_deref())?
    } else {
        write_command_script(command, cwd.as_deref())?
    };

    let command_line = format!("bash {}", shell_escape(&script.to_string_lossy()));

    #[cfg(target_os = "linux")]
    {
        return launch_linux_terminal(&command_line, custom_config.as_deref());
    }

    #[cfg(target_os = "macos")]
    {
        return launch_macos_terminal(&command_line, custom_config.as_deref());
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = (command_line, custom_config);
        Err("Terminal launch is not supported on this platform".to_string())
    }
}
