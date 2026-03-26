use std::path::Path;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::models::{HarnessInfo, HarnessReport, InstallProgressEvent, InstallResult};
use crate::process_utils;
use crate::runtime_env;

const LOGIN_SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(2);

// ---------------------------------------------------------------------------
// Harness definitions
// ---------------------------------------------------------------------------

struct HarnessDef {
    id: &'static str,
    name: &'static str,
    description: &'static str,
    command: &'static str,
    version_flag: &'static str,
    install_command: Option<&'static str>,
    install_args: &'static [&'static str],
    /// Raw shell script for install (used for curl-pipe installers).
    /// Takes precedence over `install_command` when set.
    install_script: Option<&'static str>,
    website: &'static str,
    native: bool,
}

const HARNESSES: &[HarnessDef] = &[
    HarnessDef {
        id: "codex",
        name: "Codex CLI",
        description: "Natively integrated — powers the Panes chat engine",
        command: "codex",
        version_flag: "--version",
        install_command: Some("npm"),
        install_args: &["install", "-g", "@openai/codex"],
        install_script: None,
        website: "https://github.com/openai/codex",
        native: true,
    },
    HarnessDef {
        id: "claude-code",
        name: "Claude Code",
        description: "Anthropic's agentic coding tool",
        command: "claude",
        version_flag: "--version",
        install_command: Some("npm"),
        install_args: &["install", "-g", "@anthropic-ai/claude-code"],
        install_script: Some("curl -fsSL https://claude.ai/install.sh | bash"),
        website: "https://docs.anthropic.com/en/docs/claude-code",
        native: false,
    },
    HarnessDef {
        id: "gemini-cli",
        name: "Gemini CLI",
        description: "Google's AI-powered command-line coding agent",
        command: "gemini",
        version_flag: "--version",
        install_command: Some("npm"),
        install_args: &["install", "-g", "@google/gemini-cli"],
        install_script: None,
        website: "https://github.com/google-gemini/gemini-cli",
        native: false,
    },
    HarnessDef {
        id: "kiro",
        name: "Kiro",
        description: "AI-powered CLI coding agent by AWS",
        command: "kiro-cli",
        version_flag: "--version",
        install_command: None,
        install_args: &[],
        install_script: Some("curl -fsSL https://cli.kiro.dev/install | bash"),
        website: "https://kiro.dev",
        native: false,
    },
    HarnessDef {
        id: "opencode",
        name: "OpenCode",
        description: "Open-source AI coding assistant",
        command: "opencode",
        version_flag: "--version",
        install_command: Some("npm"),
        install_args: &["install", "-g", "opencode-ai"],
        install_script: None,
        website: "https://opencode.ai",
        native: false,
    },
    HarnessDef {
        id: "kilo-code",
        name: "Kilo Code",
        description: "AI-powered code assistant",
        command: "kilo",
        version_flag: "--version",
        install_command: Some("npm"),
        install_args: &["install", "-g", "@kilocode/cli"],
        install_script: None,
        website: "https://kilocode.ai",
        native: false,
    },
    HarnessDef {
        id: "factory-droid",
        name: "Factory Droid",
        description: "Autonomous coding agent by Factory",
        command: "droid",
        version_flag: "--version",
        install_command: None,
        install_args: &[],
        install_script: Some("curl -fsSL https://app.factory.ai/cli | sh"),
        website: "https://factory.ai",
        native: false,
    },
];

// ---------------------------------------------------------------------------
// check_harnesses
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn check_harnesses() -> Result<HarnessReport, String> {
    let mut harnesses = Vec::new();

    for def in HARNESSES {
        let status = detect_harness(def).await;
        harnesses.push(status);
    }

    let npm_available = runtime_env::resolve_executable("npm").is_some()
        || detect_via_login_shell("npm", "--version").await.is_some();

    Ok(HarnessReport {
        harnesses,
        npm_available,
    })
}

// ---------------------------------------------------------------------------
// install_harness
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn install_harness(app: AppHandle, harness_id: String) -> Result<InstallResult, String> {
    let def = HARNESSES
        .iter()
        .find(|h| h.id == harness_id)
        .ok_or_else(|| format!("unknown harness: {harness_id}"))?;

    // Prefer install_script (curl-pipe installers) over install_command (npm).
    // On Windows, curl-pipe installers are not supported — fall through to
    // install_command when available instead of hard-erroring.
    if let Some(script) = def.install_script {
        #[cfg(not(target_os = "windows"))]
        {
            return run_harness_install_script(&app, &harness_id, script).await;
        }
        #[cfg(target_os = "windows")]
        {
            let _ = script;
            if def.install_command.is_none() {
                return Err(format!(
                    "{} must be installed manually from {} on Windows \
                     (the automated installer requires a Unix shell)",
                    def.name, def.website
                ));
            }
            // Fall through to install_command below
        }
    }

    let install_cmd = def.install_command.ok_or_else(|| {
        format!(
            "{} must be installed manually from {}",
            def.name, def.website
        )
    })?;

    let npm = if install_cmd == "npm" {
        resolve_npm_path().await
    } else {
        install_cmd.to_string()
    };

    let args: Vec<String> = def.install_args.iter().map(|s| s.to_string()).collect();

    run_harness_install(&app, &harness_id, &npm, &args).await
}

// ---------------------------------------------------------------------------
// launch_harness
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn launch_harness(harness_id: String) -> Result<String, String> {
    let def = HARNESSES
        .iter()
        .find(|h| h.id == harness_id)
        .ok_or_else(|| format!("unknown harness: {harness_id}"))?;

    // Return the command name so the frontend can write it into a terminal session
    Ok(def.command.to_string())
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

async fn detect_harness(def: &HarnessDef) -> HarnessInfo {
    if let Some(path) = runtime_env::resolve_executable(def.command) {
        if let Some(version) = get_command_version(&path, &[def.version_flag]).await {
            return HarnessInfo {
                id: def.id.to_string(),
                name: def.name.to_string(),
                description: def.description.to_string(),
                command: def.command.to_string(),
                found: true,
                version: Some(version),
                path: Some(path.display().to_string()),
                can_auto_install: harness_can_auto_install(def),
                website: def.website.to_string(),
                native: def.native,
            };
        }
    }

    if let Some((path, version)) = detect_via_login_shell(def.command, def.version_flag).await {
        return HarnessInfo {
            id: def.id.to_string(),
            name: def.name.to_string(),
            description: def.description.to_string(),
            command: def.command.to_string(),
            found: true,
            version: Some(version),
            path: Some(path),
            can_auto_install: harness_can_auto_install(def),
            website: def.website.to_string(),
            native: def.native,
        };
    }

    HarnessInfo {
        id: def.id.to_string(),
        name: def.name.to_string(),
        description: def.description.to_string(),
        command: def.command.to_string(),
        found: false,
        version: None,
        path: None,
        can_auto_install: harness_can_auto_install(def),
        website: def.website.to_string(),
        native: def.native,
    }
}

fn harness_can_auto_install(def: &HarnessDef) -> bool {
    #[cfg(target_os = "windows")]
    if def.install_script.is_some() {
        return def.install_command.is_some();
    }

    def.install_command.is_some() || def.install_script.is_some()
}

// ---------------------------------------------------------------------------
// Install runner
// ---------------------------------------------------------------------------

async fn run_harness_install(
    app: &AppHandle,
    harness_id: &str,
    program: &str,
    args: &[String],
) -> Result<InstallResult, String> {
    let emit = |line: String, stream: String, finished: bool| {
        let event = InstallProgressEvent {
            dependency: harness_id.to_string(),
            line,
            stream,
            finished,
        };
        let _ = app.emit("setup-install-progress", &event);
    };

    emit(
        format!("$ {} {}", program, args.join(" ")),
        "status".to_string(),
        false,
    );

    let mut command = Command::new(program);
    process_utils::configure_tokio_command(&mut command);
    command.args(args);
    if let Some(augmented_path) = runtime_env::augmented_path_with_prepend(
        Path::new(program)
            .parent()
            .into_iter()
            .map(|value| value.to_path_buf()),
    ) {
        command.env("PATH", augmented_path);
    }

    let mut child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {program}: {e}"))?;

    let dep = harness_id.to_string();
    let app_clone = app.clone();

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let dep_stdout = dep.clone();
    let app_stdout = app_clone.clone();
    let stdout_task = tokio::spawn(async move {
        if let Some(stdout) = stdout {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_stdout.emit(
                    "setup-install-progress",
                    &InstallProgressEvent {
                        dependency: dep_stdout.clone(),
                        line,
                        stream: "stdout".to_string(),
                        finished: false,
                    },
                );
            }
        }
    });

    let dep_stderr = dep.clone();
    let app_stderr = app_clone.clone();
    let stderr_task = tokio::spawn(async move {
        if let Some(stderr) = stderr {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_stderr.emit(
                    "setup-install-progress",
                    &InstallProgressEvent {
                        dependency: dep_stderr.clone(),
                        line,
                        stream: "stderr".to_string(),
                        finished: false,
                    },
                );
            }
        }
    });

    let _ = tokio::join!(stdout_task, stderr_task);

    let status = child
        .wait()
        .await
        .map_err(|e| format!("failed to wait for {program}: {e}"))?;

    let success = status.success();
    let message = if success {
        format!("{harness_id} installed successfully")
    } else {
        format!(
            "{harness_id} installation failed (exit code {})",
            status.code().unwrap_or(-1)
        )
    };

    emit(message.clone(), "status".to_string(), true);

    Ok(InstallResult { success, message })
}

// ---------------------------------------------------------------------------
// Script-based install runner (curl-pipe installers)
// ---------------------------------------------------------------------------

async fn run_harness_install_script(
    app: &AppHandle,
    harness_id: &str,
    script: &str,
) -> Result<InstallResult, String> {
    let emit = |line: String, stream: String, finished: bool| {
        let event = InstallProgressEvent {
            dependency: harness_id.to_string(),
            line,
            stream,
            finished,
        };
        let _ = app.emit("setup-install-progress", &event);
    };

    emit(format!("$ {script}"), "status".to_string(), false);

    let spec = runtime_env::command_shell_for_string(script);
    let mut command = Command::new(&spec.program);
    process_utils::configure_tokio_command(&mut command);
    command.args(&spec.args);
    if let Some(augmented_path) = runtime_env::augmented_path_with_prepend(
        spec.program
            .parent()
            .into_iter()
            .map(|value| value.to_path_buf()),
    ) {
        command.env("PATH", augmented_path);
    }

    let mut child = command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn install script: {e}"))?;

    let dep = harness_id.to_string();
    let app_clone = app.clone();

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let dep_stdout = dep.clone();
    let app_stdout = app_clone.clone();
    let stdout_task = tokio::spawn(async move {
        if let Some(stdout) = stdout {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_stdout.emit(
                    "setup-install-progress",
                    &InstallProgressEvent {
                        dependency: dep_stdout.clone(),
                        line,
                        stream: "stdout".to_string(),
                        finished: false,
                    },
                );
            }
        }
    });

    let dep_stderr = dep.clone();
    let app_stderr = app_clone.clone();
    let stderr_task = tokio::spawn(async move {
        if let Some(stderr) = stderr {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_stderr.emit(
                    "setup-install-progress",
                    &InstallProgressEvent {
                        dependency: dep_stderr.clone(),
                        line,
                        stream: "stderr".to_string(),
                        finished: false,
                    },
                );
            }
        }
    });

    let _ = tokio::join!(stdout_task, stderr_task);

    let status = child
        .wait()
        .await
        .map_err(|e| format!("failed to wait for install script: {e}"))?;

    let success = status.success();
    let message = if success {
        format!("{harness_id} installed successfully")
    } else {
        format!(
            "{harness_id} installation failed (exit code {})",
            status.code().unwrap_or(-1)
        )
    };

    emit(message.clone(), "status".to_string(), true);

    Ok(InstallResult { success, message })
}

// ---------------------------------------------------------------------------
// Utility helpers (same patterns as setup.rs)
// ---------------------------------------------------------------------------

async fn get_command_version(path: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(path);
    process_utils::configure_tokio_command(&mut command);
    let output = command.args(args).output().await.ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

#[cfg(not(target_os = "windows"))]
async fn detect_via_login_shell(command: &str, version_flag: &str) -> Option<(String, String)> {
    for shell in runtime_env::login_probe_shells() {
        let probe_cmd = format!("command -v {command} && {command} {version_flag}");
        let output = match timeout(
            LOGIN_SHELL_PROBE_TIMEOUT,
            Command::new(&shell)
                .args(runtime_env::login_probe_shell_args(&shell, &probe_cmd))
                .output(),
        )
        .await
        {
            Err(_) => {
                log::warn!(
                    "timed out probing `{command}` via login shell `{}`",
                    shell.display()
                );
                continue;
            }
            Ok(Ok(output)) if output.status.success() => output,
            _ => continue,
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let Some((path, version)) = runtime_env::parse_login_probe_output(&stdout) else {
            continue;
        };

        return Some((path, version));
    }
    None
}

#[cfg(target_os = "windows")]
async fn detect_via_login_shell(command: &str, version_flag: &str) -> Option<(String, String)> {
    let probe_script = format!(
        "$p = (Get-Command {cmd} -ErrorAction SilentlyContinue | Select-Object -First 1).Source; \
         if ($p) {{ Write-Output $p; & $p {flag} }}",
        cmd = command,
        flag = version_flag,
    );

    for powershell in runtime_env::windows_login_probe_shells() {
        let mut cmd = Command::new(&powershell);
        cmd.args(["-NoLogo", "-Command", &probe_script]);
        process_utils::configure_tokio_command(&mut cmd);

        let Ok(Ok(output)) = timeout(Duration::from_secs(10), cmd.output()).await else {
            continue;
        };
        if !output.status.success() {
            continue;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let Some((path, version)) = runtime_env::parse_windows_login_probe_output(&stdout) else {
            continue;
        };

        if !path.is_empty() && Path::new(&path).is_file() {
            return Some((path, version));
        }
    }

    None
}

async fn resolve_npm_path() -> String {
    if let Some(path) = runtime_env::resolve_executable("npm") {
        return path.display().to_string();
    }
    if let Some((path, _version)) = detect_via_login_shell("npm", "--version").await {
        return path;
    }
    "npm".to_string()
}
