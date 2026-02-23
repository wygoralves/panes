use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::models::{HarnessInfo, HarnessReport, InstallProgressEvent, InstallResult};

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
        website: "https://docs.anthropic.com/en/docs/claude-code",
        native: false,
    },
    HarnessDef {
        id: "kiro",
        name: "Kiro",
        description: "AI-powered development environment by AWS",
        command: "kiro",
        version_flag: "--version",
        install_command: None,
        install_args: &[],
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
        install_args: &["install", "-g", "opencode"],
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
        install_args: &["install", "-g", "kilo-code"],
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

    let npm_available = which::which("npm").is_ok()
        || resolve_npm_from_well_known().is_some()
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
pub async fn install_harness(
    app: AppHandle,
    harness_id: String,
) -> Result<InstallResult, String> {
    let def = HARNESSES
        .iter()
        .find(|h| h.id == harness_id)
        .ok_or_else(|| format!("unknown harness: {harness_id}"))?;

    let install_cmd = def
        .install_command
        .ok_or_else(|| format!("{} must be installed manually from {}", def.name, def.website))?;

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
    // Try `which` first
    if let Ok(path) = which::which(def.command) {
        if let Some(version) = get_command_version(&path, &[def.version_flag]).await {
            return HarnessInfo {
                id: def.id.to_string(),
                name: def.name.to_string(),
                description: def.description.to_string(),
                found: true,
                version: Some(version),
                path: Some(path.display().to_string()),
                can_auto_install: def.install_command.is_some(),
                website: def.website.to_string(),
                native: def.native,
            };
        }
    }

    // Well-known paths
    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from(format!("/opt/homebrew/bin/{}", def.command)),
        PathBuf::from(format!("/usr/local/bin/{}", def.command)),
    ];
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(&home);
        candidates.push(home.join(format!(".local/bin/{}", def.command)));
        candidates.push(home.join(format!(".volta/bin/{}", def.command)));
        // npm global bin
        candidates.push(home.join(format!(".npm-global/bin/{}", def.command)));
    }

    for path in &candidates {
        if path.exists() {
            if let Some(version) = get_command_version(path, &[def.version_flag]).await {
                return HarnessInfo {
                    id: def.id.to_string(),
                    name: def.name.to_string(),
                    description: def.description.to_string(),
                    found: true,
                    version: Some(version),
                    path: Some(path.display().to_string()),
                    can_auto_install: def.install_command.is_some(),
                    website: def.website.to_string(),
                    native: def.native,
                };
            }
        }
    }

    // Login shell probe
    if let Some((path, version)) = detect_via_login_shell(def.command, def.version_flag).await {
        return HarnessInfo {
            id: def.id.to_string(),
            name: def.name.to_string(),
            description: def.description.to_string(),
            found: true,
            version: Some(version),
            path: Some(path),
            can_auto_install: def.install_command.is_some(),
            website: def.website.to_string(),
            native: def.native,
        };
    }

    HarnessInfo {
        id: def.id.to_string(),
        name: def.name.to_string(),
        description: def.description.to_string(),
        found: false,
        version: None,
        path: None,
        can_auto_install: def.install_command.is_some(),
        website: def.website.to_string(),
        native: def.native,
    }
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

    let mut child = build_login_shell_command(program, args)
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
// Utility helpers (same patterns as setup.rs)
// ---------------------------------------------------------------------------

async fn get_command_version(path: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new(path).args(args).output().await.ok()?;
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
    for shell in &["/bin/zsh", "/bin/bash"] {
        if !Path::new(shell).exists() {
            continue;
        }

        let probe_cmd = format!("command -v {command} && {command} {version_flag}");
        let output = match Command::new(shell)
            .args(["-lic", &probe_cmd])
            .output()
            .await
        {
            Ok(output) if output.status.success() => output,
            _ => continue,
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut lines = stdout.lines().map(str::trim).filter(|l| !l.is_empty());

        let path = match lines.next() {
            Some(p) if p.starts_with('/') => p.to_string(),
            _ => continue,
        };
        let version = lines.next().unwrap_or("").to_string();

        return Some((path, version));
    }
    None
}

#[cfg(target_os = "windows")]
async fn detect_via_login_shell(_command: &str, _version_flag: &str) -> Option<(String, String)> {
    None
}

async fn resolve_npm_path() -> String {
    if let Ok(path) = which::which("npm") {
        return path.display().to_string();
    }
    if let Some(path) = resolve_npm_from_well_known() {
        return path;
    }
    #[cfg(not(target_os = "windows"))]
    {
        for shell in &["/bin/zsh", "/bin/bash"] {
            if !Path::new(shell).exists() {
                continue;
            }
            if let Ok(output) = Command::new(shell)
                .args(["-lic", "command -v npm"])
                .output()
                .await
            {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if path.starts_with('/') {
                        return path;
                    }
                }
            }
        }
    }
    "npm".to_string()
}

fn resolve_npm_from_well_known() -> Option<String> {
    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin/npm"),
        PathBuf::from("/usr/local/bin/npm"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(&home);
        candidates.push(home.join(".volta/bin/npm"));
        candidates.push(home.join(".local/share/fnm/aliases/default/bin/npm"));
        candidates.push(home.join(".local/bin/npm"));
        let nvm_dir = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(nvm_dir) {
            for entry in entries.filter_map(Result::ok) {
                candidates.push(entry.path().join("bin/npm"));
            }
        }
    }
    for path in &candidates {
        if path.exists() {
            return Some(path.display().to_string());
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn build_login_shell_command(program: &str, args: &[String]) -> Command {
    let shell = if Path::new("/bin/zsh").exists() {
        "/bin/zsh"
    } else if Path::new("/bin/bash").exists() {
        "/bin/bash"
    } else {
        "/bin/sh"
    };

    let full_command = format!(
        "{} {}",
        shell_escape(program),
        args.iter()
            .map(|a| shell_escape(a))
            .collect::<Vec<_>>()
            .join(" ")
    );

    let mut cmd = Command::new(shell);
    cmd.arg("-lc").arg(full_command);
    cmd
}

#[cfg(target_os = "windows")]
fn build_login_shell_command(program: &str, args: &[String]) -> Command {
    let mut cmd = Command::new(program);
    cmd.args(args);
    cmd
}

fn shell_escape(s: &str) -> String {
    if s.contains(' ') || s.contains('"') || s.contains('\'') || s.contains('$') {
        format!("'{}'", s.replace('\'', "'\\''"))
    } else {
        s.to_string()
    }
}
