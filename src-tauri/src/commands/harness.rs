use std::collections::BTreeMap;
use std::path::Path;

use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use crate::config::app_config::AppConfig;
use crate::models::{HarnessInfo, HarnessReport, InstallProgressEvent, InstallResult};
use crate::process_utils;
use crate::runtime_env;
use crate::state::AppState;

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

const LOGIN_SHELL_PROBE_TIMEOUT: Duration = Duration::from_secs(2);
const VERSION_PROBE_TIMEOUT: Duration = Duration::from_secs(5);

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
    /// PowerShell expression from the tool's official Windows instructions.
    /// Windows terminals start in cmd.exe, where the Unix curl-pipe scripts
    /// fail or install into WSL, so Windows uses this instead.
    install_script_windows: Option<&'static str>,
    website: &'static str,
    native: bool,
    /// Oldest Node.js major release the npm package supports (its
    /// `engines.node`). The npm install is offered only on a Node.js that
    /// meets it.
    min_node_major: Option<u32>,
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
        install_script_windows: None,
        website: "https://github.com/openai/codex",
        native: true,
        min_node_major: None,
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
        install_script_windows: Some("irm https://claude.ai/install.ps1 | iex"),
        website: "https://code.claude.com/docs/en/overview",
        native: false,
        min_node_major: None,
    },
    HarnessDef {
        id: "gemini-cli",
        name: "Gemini CLI",
        description: "Google's AI-powered command-line coding agent (Enterprise/Cloud licenses only, discontinued for free tier)",
        command: "gemini",
        version_flag: "--version",
        install_command: Some("npm"),
        install_args: &["install", "-g", "@google/gemini-cli"],
        install_script: None,
        install_script_windows: None,
        website: "https://github.com/google-gemini/gemini-cli",
        native: false,
        min_node_major: None,
    },
    HarnessDef {
        id: "antigravity",
        name: "Antigravity CLI",
        description: "Google's terminal agent CLI, the successor to Gemini CLI for free and individual accounts",
        command: "agy",
        version_flag: "--version",
        install_command: None,
        install_args: &[],
        install_script: Some("curl -fsSL https://antigravity.google/cli/install.sh | bash"),
        install_script_windows: Some("irm https://antigravity.google/cli/install.ps1 | iex"),
        website: "https://antigravity.google",
        native: false,
        min_node_major: None,
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
        install_script_windows: Some("irm https://cli.kiro.dev/install.ps1 | iex"),
        website: "https://kiro.dev",
        native: false,
        min_node_major: None,
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
        install_script_windows: None,
        website: "https://opencode.ai",
        native: false,
        min_node_major: None,
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
        install_script_windows: None,
        website: "https://kilo.ai",
        native: false,
        min_node_major: None,
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
        install_script_windows: Some("irm https://app.factory.ai/cli/windows | iex"),
        website: "https://factory.com",
        native: false,
        min_node_major: None,
    },
    HarnessDef {
        id: "cursor-cli",
        name: "Cursor CLI",
        description: "Cursor's coding agent in the terminal",
        // The installer links both `agent` and `cursor-agent`; the longer name
        // avoids matching an unrelated `agent` binary on PATH.
        command: "cursor-agent",
        version_flag: "--version",
        install_command: None,
        install_args: &[],
        install_script: Some("curl https://cursor.com/install -fsS | bash"),
        install_script_windows: None,
        website: "https://cursor.com/cli",
        native: false,
        min_node_major: None,
    },
    HarnessDef {
        id: "copilot-cli",
        name: "GitHub Copilot CLI",
        description: "GitHub's coding agent in the terminal",
        command: "copilot",
        version_flag: "--version",
        install_command: Some("npm"),
        install_args: &["install", "-g", "@github/copilot"],
        install_script: None,
        install_script_windows: None,
        website: "https://github.com/github/copilot-cli",
        native: false,
        min_node_major: None,
    },
    HarnessDef {
        id: "amp",
        name: "Amp",
        description: "Agentic coding tool by Amp",
        command: "amp",
        version_flag: "--version",
        install_command: None,
        install_args: &[],
        install_script: Some("curl -fsSL https://ampcode.com/install.sh | bash"),
        install_script_windows: None,
        website: "https://ampcode.com",
        native: false,
        min_node_major: None,
    },
    HarnessDef {
        id: "qwen-code",
        name: "Qwen Code",
        description: "Open-source coding agent for Qwen models",
        command: "qwen",
        version_flag: "--version",
        install_command: Some("npm"),
        install_args: &["install", "-g", "@qwen-code/qwen-code"],
        install_script: None,
        install_script_windows: None,
        website: "https://github.com/QwenLM/qwen-code",
        native: false,
        min_node_major: Some(22),
    },
    HarnessDef {
        id: "crush",
        name: "Crush",
        description: "Terminal coding agent by Charm",
        command: "crush",
        version_flag: "--version",
        install_command: Some("npm"),
        install_args: &["install", "-g", "@charmland/crush"],
        install_script: None,
        install_script_windows: None,
        website: "https://github.com/charmbracelet/crush",
        native: false,
        min_node_major: None,
    },
];

// ---------------------------------------------------------------------------
// check_harnesses
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn check_harnesses() -> Result<HarnessReport, String> {
    // Probes run concurrently so one slow CLI costs one timeout, not one per harness.
    let node_probe = async {
        if HARNESSES.iter().any(|def| def.min_node_major.is_some()) {
            detect_node_major().await
        } else {
            None
        }
    };
    let npm_probe = async {
        runtime_env::resolve_executable("npm").is_some()
            || detect_via_login_shell("npm", "--version").await.is_some()
    };
    let harness_probes = futures::future::join_all(HARNESSES.iter().map(locate_harness));
    let (node_major, npm_available, located) = tokio::join!(node_probe, npm_probe, harness_probes);

    let harnesses = HARNESSES
        .iter()
        .zip(located)
        .map(|(def, located)| harness_info(def, located, node_major))
        .collect();

    let mise_preferred =
        runtime_env::is_flatpak() && runtime_env::resolve_executable("mise").is_some();
    let preferred_install_method = if mise_preferred {
        Some("mise".to_string())
    } else if npm_available {
        Some("npm".to_string())
    } else {
        None
    };

    Ok(HarnessReport {
        harnesses,
        npm_available,
        preferred_install_method,
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

    if let Some(min_major) = def.min_node_major {
        if !node_meets_minimum(Some(min_major), detect_node_major().await) {
            return Err(format!(
                "{} needs Node.js {min_major} or later. Update Node.js and try again, \
                 or install it manually from {}",
                def.name, def.website
            ));
        }
    }

    // On Windows, run the official PowerShell installer directly (no cmd.exe),
    // the same command the Harnesses panel shows and types into a terminal.
    #[cfg(target_os = "windows")]
    if let Some(expression) = def.install_script_windows {
        let args: Vec<String> = windows_powershell_install_args(expression)
            .iter()
            .map(|arg| arg.to_string())
            .collect();
        return run_harness_install(&app, &harness_id, &windows_powershell_program(), &args).await;
    }

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

    // Inside a Flatpak sandbox, /app is read-only at runtime, so `npm
    // install -g` has nowhere to write to. Prefer the bundled `mise`
    // instead, which installs into the user's writable data dir.
    if install_cmd == "npm" && runtime_env::is_flatpak() {
        if let Some(package) = npm_package_from_install_args(def.install_args) {
            if runtime_env::resolve_executable("mise").is_some() {
                let mise = resolve_mise_path().await;
                let args = vec![
                    "use".to_string(),
                    "-g".to_string(),
                    format!("npm:{package}"),
                ];
                return run_harness_install(&app, &harness_id, &mise, &args).await;
            }
        }
    }

    let npm = if install_cmd == "npm" {
        resolve_npm_path().await
    } else {
        install_cmd.to_string()
    };

    let args: Vec<String> = def.install_args.iter().map(|s| s.to_string()).collect();

    run_harness_install(&app, &harness_id, &npm, &args).await
}

/// Extracts the npm package name from an `["install", "-g", "<package>"]`
/// style install-args slice, which is the shape every npm-installed
/// harness in `HARNESSES` uses.
fn npm_package_from_install_args<'a>(install_args: &[&'a str]) -> Option<&'a str> {
    match install_args {
        ["install", "-g", package] => Some(package),
        _ => None,
    }
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
    let base_command = def.command;

    // Return the command line so the frontend can write it into a terminal session
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let config = AppConfig::load_or_create().map_err(err_to_string)?;
        compose_launch_command(base_command, config.harness_launch_args(&harness_id))
    })
    .await
    .map_err(err_to_string)?
}

/// Launch args are submitted to the user's shell. Limit them to a portable
/// argument grammar so the settings field cannot introduce shell operators.
fn normalize_launch_args(args: &str) -> Result<String, String> {
    if let Some(character) = args.chars().find(|character| {
        !(character.is_alphanumeric()
            || matches!(character, ' ' | '\t')
            || matches!(character, '-' | '_' | '.' | '/' | ':' | '=' | ',' | '+'))
    }) {
        return Err(format!(
            "launch arguments contain unsupported shell character: {character:?}"
        ));
    }

    Ok(args.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn compose_launch_command(base: &str, extra_args: Option<&str>) -> Result<String, String> {
    let args = extra_args
        .map(normalize_launch_args)
        .transpose()?
        .unwrap_or_default();
    if args.is_empty() {
        Ok(base.to_string())
    } else {
        Ok(format!("{base} {args}"))
    }
}

#[tauri::command]
pub async fn get_harness_launch_args() -> Result<BTreeMap<String, String>, String> {
    tokio::task::spawn_blocking(|| -> Result<BTreeMap<String, String>, String> {
        let config = AppConfig::load_or_create().map_err(err_to_string)?;
        Ok(config.harnesses.launch_args)
    })
    .await
    .map_err(err_to_string)?
}

#[tauri::command]
pub async fn set_harness_launch_args(
    state: State<'_, AppState>,
    harness_id: String,
    args: String,
) -> Result<String, String> {
    if !HARNESSES.iter().any(|h| h.id == harness_id) {
        return Err(format!("unknown harness: {harness_id}"));
    }

    let config_write_lock = state.config_write_lock.clone();
    let _guard = config_write_lock.lock_owned().await;

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let sanitized = normalize_launch_args(&args)?;
        AppConfig::mutate(|config| {
            if sanitized.is_empty() {
                config.harnesses.launch_args.remove(&harness_id);
            } else {
                config
                    .harnesses
                    .launch_args
                    .insert(harness_id.clone(), sanitized.clone());
            }
            Ok(sanitized)
        })
        .map_err(err_to_string)
    })
    .await
    .map_err(err_to_string)?
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

async fn locate_harness(def: &HarnessDef) -> Option<(String, String)> {
    if let Some(path) = runtime_env::resolve_executable(def.command) {
        if let Some(version) = get_command_version(&path, &[def.version_flag])
            .await
            .filter(|version| version_belongs_to_harness(def, version))
        {
            return Some((path.display().to_string(), version));
        }
    }

    detect_via_login_shell(def.command, def.version_flag)
        .await
        .filter(|(_, version)| version_belongs_to_harness(def, version))
}

fn harness_info(
    def: &HarnessDef,
    located: Option<(String, String)>,
    node_major: Option<u32>,
) -> HarnessInfo {
    let (path, version) = located.unzip();
    HarnessInfo {
        id: def.id.to_string(),
        name: def.name.to_string(),
        description: def.description.to_string(),
        command: def.command.to_string(),
        found: version.is_some(),
        version,
        path,
        can_auto_install: harness_can_auto_install(def, node_major),
        install_command_display: install_command_display(def),
        website: def.website.to_string(),
        native: def.native,
    }
}

/// AWS Copilot also installs a `copilot` binary. Its `--version` prints
/// `copilot version v1.x`, while GitHub Copilot CLI prints a bare version.
fn version_belongs_to_harness(def: &HarnessDef, version: &str) -> bool {
    !(def.id == "copilot-cli" && version.starts_with("copilot version"))
}

fn harness_can_auto_install(def: &HarnessDef, node_major: Option<u32>) -> bool {
    if !node_meets_minimum(def.min_node_major, node_major) {
        return false;
    }

    harness_can_auto_install_on(def, cfg!(target_os = "windows"))
}

fn harness_can_auto_install_on(def: &HarnessDef, is_windows: bool) -> bool {
    if is_windows {
        return def.install_script_windows.is_some() || def.install_command.is_some();
    }

    def.install_command.is_some() || def.install_script.is_some()
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn windows_powershell_install_args(expression: &str) -> [&str; 5] {
    [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        expression,
    ]
}

/// Windows PowerShell from System32. The install command is typed into a
/// terminal that starts in the workspace, where cmd.exe would run a
/// powershell.exe, .bat or .cmd from that folder before the system one.
fn windows_powershell_program() -> String {
    std::env::var_os("SystemRoot")
        .map(|root| {
            Path::new(&root)
                .join("System32")
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe")
        })
        .filter(|path| path.is_file())
        .map(|path| path.display().to_string())
        // Typed unquoted, so it works the same in cmd.exe and PowerShell.
        .filter(|path| !path.contains(char::is_whitespace))
        .unwrap_or_else(|| "powershell".to_string())
}

/// The install command line for this OS, matching what install_harness runs.
/// Shown in the Harnesses panel and typed into a terminal by "Install".
fn install_command_display(def: &HarnessDef) -> Option<String> {
    let windows_powershell = cfg!(target_os = "windows").then(windows_powershell_program);
    install_command_display_on(def, windows_powershell.as_deref())
}

/// `windows_powershell` is the PowerShell program on Windows, None elsewhere.
fn install_command_display_on(
    def: &HarnessDef,
    windows_powershell: Option<&str>,
) -> Option<String> {
    let package_manager_command = || {
        def.install_command
            .map(|program| format!("{program} {}", def.install_args.join(" ")))
    };

    if let Some(powershell) = windows_powershell {
        if let Some(expression) = def.install_script_windows {
            return Some(format!(
                "{powershell} -NoProfile -ExecutionPolicy Bypass -Command \"{expression}\""
            ));
        }
        return package_manager_command();
    }

    def.install_script
        .map(str::to_string)
        .or_else(package_manager_command)
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

/// A Node.js that cannot be found or read does not meet a minimum.
fn node_meets_minimum(min_major: Option<u32>, node_major: Option<u32>) -> bool {
    match min_major {
        None => true,
        Some(min_major) => node_major.is_some_and(|major| major >= min_major),
    }
}

/// Parses the major release from `node --version` output such as `v22.11.0`.
fn parse_node_major(version: &str) -> Option<u32> {
    version
        .trim()
        .trim_start_matches('v')
        .split('.')
        .next()?
        .parse()
        .ok()
}

async fn detect_node_major() -> Option<u32> {
    let version = match runtime_env::resolve_executable("node") {
        Some(path) => get_command_version(&path, &["--version"]).await,
        None => None,
    };
    let version = match version {
        Some(version) => Some(version),
        None => detect_via_login_shell("node", "--version")
            .await
            .map(|(_, version)| version),
    };
    version.as_deref().and_then(parse_node_major)
}

async fn get_command_version(path: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(path);
    process_utils::configure_tokio_command(&mut command);
    command.kill_on_drop(true);
    let output = match timeout(VERSION_PROBE_TIMEOUT, command.args(args).output()).await {
        Ok(result) => result.ok()?,
        Err(_) => {
            log::warn!("timed out probing `{}` for its version", path.display());
            return None;
        }
    };
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
                .kill_on_drop(true)
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
        "$p = {probe}; if ($p) {{ Write-Output $p; & $p {flag} }}",
        probe = runtime_env::windows_application_probe_expression(command),
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

async fn resolve_mise_path() -> String {
    if let Some(path) = runtime_env::resolve_executable("mise") {
        return path.display().to_string();
    }
    if let Some((path, _version)) = detect_via_login_shell("mise", "--version").await {
        return path;
    }
    "mise".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn harness(id: &str) -> &'static HarnessDef {
        HARNESSES.iter().find(|def| def.id == id).unwrap()
    }

    #[test]
    fn parses_the_node_major_release() {
        assert_eq!(parse_node_major("v22.11.0"), Some(22));
        assert_eq!(parse_node_major("v20.19.5\n"), Some(20));
        assert_eq!(parse_node_major("not a version"), None);
    }

    #[test]
    fn qwen_code_offers_npm_install_only_on_node_22_or_later() {
        let qwen = harness("qwen-code");
        assert!(!harness_can_auto_install(qwen, Some(20)));
        assert!(!harness_can_auto_install(qwen, None));
        assert!(harness_can_auto_install(qwen, Some(22)));
        assert!(harness_can_auto_install(qwen, Some(24)));
    }

    #[test]
    fn harnesses_without_a_node_minimum_ignore_the_node_version() {
        // @github/copilot declares no engines; its npm loader starts a native binary.
        let copilot = harness("copilot-cli");
        assert!(harness_can_auto_install(copilot, Some(18)));
        assert!(harness_can_auto_install(copilot, None));
    }

    #[test]
    fn aws_copilot_is_not_detected_as_github_copilot() {
        let copilot = HARNESSES
            .iter()
            .find(|def| def.id == "copilot-cli")
            .unwrap();
        assert!(!version_belongs_to_harness(
            copilot,
            "copilot version v1.34.1"
        ));
        assert!(version_belongs_to_harness(copilot, "1.0.114"));
    }

    #[test]
    fn windows_install_commands_never_pipe_into_a_unix_shell() {
        for id in ["claude-code", "kiro", "antigravity", "factory-droid"] {
            let def = HARNESSES
                .iter()
                .find(|def| def.id == id)
                .expect("harness exists");
            let command = install_command_display_on(
                def,
                Some(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"),
            )
            .expect("windows command");

            assert!(harness_can_auto_install_on(def, true), "{id}");
            assert!(
                command.starts_with(
                    r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile"
                ),
                "{id}: {command}"
            );
            assert!(
                !command.contains("| bash") && !command.contains("| sh"),
                "{id}"
            );
        }
    }

    #[test]
    fn install_command_display_keeps_unix_scripts_and_npm_commands() {
        let claude = HARNESSES
            .iter()
            .find(|def| def.id == "claude-code")
            .unwrap();
        assert_eq!(
            install_command_display_on(claude, None).as_deref(),
            Some("curl -fsSL https://claude.ai/install.sh | bash")
        );
        let codex = HARNESSES.iter().find(|def| def.id == "codex").unwrap();
        for windows_powershell in [None, Some("powershell")] {
            assert_eq!(
                install_command_display_on(codex, windows_powershell).as_deref(),
                Some("npm install -g @openai/codex")
            );
        }
    }

    #[test]
    fn npm_package_from_install_args_matches_every_harness_definition() {
        for def in HARNESSES {
            if def.install_command == Some("npm") {
                assert!(
                    npm_package_from_install_args(def.install_args).is_some(),
                    "expected {} to have an install_args shape of [\"install\", \"-g\", <package>]",
                    def.id
                );
            }
        }
    }

    #[test]
    fn npm_package_from_install_args_rejects_unexpected_shapes() {
        assert_eq!(
            npm_package_from_install_args(&["install", "opencode-ai"]),
            None
        );
        assert_eq!(npm_package_from_install_args(&[]), None);
        assert_eq!(
            npm_package_from_install_args(&["install", "-g", "opencode-ai"]),
            Some("opencode-ai")
        );
    }

    #[test]
    fn compose_launch_command_appends_configured_args() {
        assert_eq!(compose_launch_command("codex", None).unwrap(), "codex");
        assert_eq!(
            compose_launch_command("codex", Some("--yolo")).unwrap(),
            "codex --yolo"
        );
        assert_eq!(
            compose_launch_command("claude", Some("  --dangerously-skip-permissions  ")).unwrap(),
            "claude --dangerously-skip-permissions"
        );
        assert_eq!(
            compose_launch_command("codex", Some("   ")).unwrap(),
            "codex"
        );
    }

    #[test]
    fn normalize_launch_args_accepts_portable_argument_characters() {
        assert_eq!(
            normalize_launch_args("--model=gpt-5 --config /Users/me/file.toml").unwrap(),
            "--model=gpt-5 --config /Users/me/file.toml"
        );
        assert_eq!(normalize_launch_args("--a\t--b").unwrap(), "--a --b");
    }

    #[test]
    fn normalize_launch_args_rejects_shell_syntax() {
        for args in [
            "--yolo; whoami",
            "--flag | whoami",
            "--flag $(whoami)",
            "--flag `whoami`",
            "--flag > output.txt",
            "--flag\nwhoami",
            "--name \"two words\"",
        ] {
            assert!(
                normalize_launch_args(args).is_err(),
                "accepted unsafe args: {args}"
            );
        }
    }

    #[cfg(unix)]
    fn fake_executable(dir: &Path, name: &str, body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn version_probe_gives_up_on_a_cli_that_never_answers() {
        let dir = std::env::temp_dir().join(format!("panes-harness-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let hanging = fake_executable(&dir, "hanging-cli", "exec sleep 600");
        let healthy = fake_executable(&dir, "healthy-cli", "echo 1.2.3");

        let started = std::time::Instant::now();
        let version = get_command_version(&hanging, &["--version"]).await;
        let elapsed = started.elapsed();
        let healthy_version = get_command_version(&healthy, &["--version"]).await;
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(version, None);
        assert!(
            elapsed < VERSION_PROBE_TIMEOUT + Duration::from_secs(2),
            "probe took {elapsed:?}"
        );
        assert_eq!(healthy_version.as_deref(), Some("1.2.3"));
    }
}
