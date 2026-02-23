use std::{
    env,
    ffi::OsString,
    path::{Path, PathBuf},
};

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::engines::codex::resolve_codex_executable;
use crate::models::{DepStatus, DependencyReport, InstallProgressEvent, InstallResult};

// ---------------------------------------------------------------------------
// check_dependencies
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn check_dependencies() -> Result<DependencyReport, String> {
    let (node, git, codex) = tokio::join!(detect_node(), detect_git(), detect_codex(),);

    let has_homebrew = which::which("brew").is_ok()
        || Path::new("/opt/homebrew/bin/brew").exists()
        || Path::new("/usr/local/bin/brew").exists();

    let mut package_managers = Vec::new();
    if has_homebrew {
        package_managers.push("homebrew".to_string());
    }
    if node.found {
        package_managers.push("npm".to_string());
    }

    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };

    Ok(DependencyReport {
        node,
        codex,
        git,
        platform: platform.to_string(),
        package_managers,
    })
}

// ---------------------------------------------------------------------------
// install_dependency
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn install_dependency(
    app: AppHandle,
    dependency: String,
    method: String,
) -> Result<InstallResult, String> {
    let (program, args) = match (dependency.as_str(), method.as_str()) {
        ("node", "homebrew") => {
            let brew = resolve_brew_path();
            (brew, vec!["install".to_string(), "node".to_string()])
        }
        ("codex", "npm_global") => {
            let npm = resolve_npm_path().await;
            (
                npm,
                vec![
                    "install".to_string(),
                    "-g".to_string(),
                    "@openai/codex".to_string(),
                ],
            )
        }
        _ => {
            return Err(format!(
                "unsupported dependency/method combination: {dependency}/{method}"
            ));
        }
    };

    run_install_process(&app, &dependency, &program, &args).await
}

// ---------------------------------------------------------------------------
// Dependency detection helpers
// ---------------------------------------------------------------------------

async fn detect_node() -> DepStatus {
    // Try which first (will only work if node is in the app's minimal PATH)
    if let Ok(path) = which::which("node") {
        if let Some(version) = get_command_version(&path, &["--version"]).await {
            return DepStatus {
                found: true,
                version: Some(version),
                path: Some(path.display().to_string()),
                can_auto_install: false,
                install_method: None,
            };
        }
    }

    // Well-known paths — covers Homebrew, system, Volta, fnm, nvm
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(&home);
        candidates.push(home.join(".volta/bin/node"));
        candidates.push(home.join(".local/share/fnm/aliases/default/bin/node"));
        candidates.push(home.join(".local/bin/node"));
        // nvm: scan all installed versions
        let nvm_dir = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(nvm_dir) {
            for entry in entries.filter_map(Result::ok) {
                candidates.push(entry.path().join("bin/node"));
            }
        }
    }

    for path in &candidates {
        if path.exists() {
            if let Some(version) = get_command_version(path, &["--version"]).await {
                return DepStatus {
                    found: true,
                    version: Some(version),
                    path: Some(path.display().to_string()),
                    can_auto_install: false,
                    install_method: None,
                };
            }
        }
    }

    // Login shell probe — the most reliable way on macOS .app bundles
    // since the app inherits a minimal PATH
    if let Some((path, version)) = detect_via_login_shell("node", "--version").await {
        return DepStatus {
            found: true,
            version: Some(version),
            path: Some(path),
            can_auto_install: false,
            install_method: None,
        };
    }

    // Not found — check if we can auto-install
    let has_homebrew = which::which("brew").is_ok()
        || Path::new("/opt/homebrew/bin/brew").exists()
        || Path::new("/usr/local/bin/brew").exists();

    DepStatus {
        found: false,
        version: None,
        path: None,
        can_auto_install: has_homebrew,
        install_method: if has_homebrew {
            Some("homebrew".to_string())
        } else {
            None
        },
    }
}

async fn detect_git() -> DepStatus {
    if let Ok(path) = which::which("git") {
        if let Some(version) = get_command_version(&path, &["--version"]).await {
            return DepStatus {
                found: true,
                version: Some(version),
                path: Some(path.display().to_string()),
                can_auto_install: false,
                install_method: None,
            };
        }
    }

    if Path::new("/usr/bin/git").exists() {
        if let Some(version) = get_command_version(Path::new("/usr/bin/git"), &["--version"]).await
        {
            return DepStatus {
                found: true,
                version: Some(version),
                path: Some("/usr/bin/git".to_string()),
                can_auto_install: false,
                install_method: None,
            };
        }
    }

    if let Some((path, version)) = detect_via_login_shell("git", "--version").await {
        return DepStatus {
            found: true,
            version: Some(version),
            path: Some(path),
            can_auto_install: false,
            install_method: None,
        };
    }

    DepStatus {
        found: false,
        version: None,
        path: None,
        can_auto_install: false,
        install_method: None,
    }
}

async fn detect_codex() -> DepStatus {
    let resolution = resolve_codex_executable().await;

    if let Some(executable) = &resolution.executable {
        let version = get_command_version_with_augmented_path(executable, &["--version"]).await;
        return DepStatus {
            found: true,
            version,
            path: Some(executable.display().to_string()),
            can_auto_install: false,
            install_method: None,
        };
    }

    // Not found — check if npm is available for auto-install.
    // On macOS .app, `which` won't find npm since the process PATH is minimal,
    // so check well-known paths and login shell too.
    let npm_available = which::which("npm").is_ok()
        || resolve_npm_from_well_known().is_some()
        || detect_via_login_shell("npm", "--version").await.is_some();

    DepStatus {
        found: false,
        version: None,
        path: None,
        can_auto_install: npm_available,
        install_method: if npm_available {
            Some("npm_global".to_string())
        } else {
            None
        },
    }
}

// ---------------------------------------------------------------------------
// Install process runner
// ---------------------------------------------------------------------------

async fn run_install_process(
    app: &AppHandle,
    dependency: &str,
    program: &str,
    args: &[String],
) -> Result<InstallResult, String> {
    let emit_progress = |dep: String, line: String, stream: String, finished: bool| {
        let event = InstallProgressEvent {
            dependency: dep,
            line,
            stream,
            finished,
        };
        let _ = app.emit("setup-install-progress", &event);
    };

    emit_progress(
        dependency.to_string(),
        format!("$ {} {}", program, args.join(" ")),
        "status".to_string(),
        false,
    );

    let mut child = build_login_shell_command(program, args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {program}: {e}"))?;

    let dep = dependency.to_string();
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
        format!("{dependency} installed successfully")
    } else {
        format!(
            "{dependency} installation failed (exit code {})",
            status.code().unwrap_or(-1)
        )
    };

    emit_progress(dep, message.clone(), "status".to_string(), true);

    Ok(InstallResult { success, message })
}

// ---------------------------------------------------------------------------
// Utility helpers
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

async fn get_command_version_with_augmented_path(path: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(path);
    if let Some(augmented_path) = executable_augmented_path(path) {
        command.env("PATH", augmented_path);
    }
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

fn executable_augmented_path(executable: &Path) -> Option<OsString> {
    let executable_dir = executable.parent()?.to_path_buf();
    let mut entries = vec![executable_dir.clone()];

    if let Some(current_path) = env::var_os("PATH") {
        for path in env::split_paths(&current_path) {
            if path != executable_dir {
                entries.push(path);
            }
        }
    } else {
        for fallback in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            let fallback_path = PathBuf::from(fallback);
            if fallback_path != executable_dir {
                entries.push(fallback_path);
            }
        }
    }

    env::join_paths(entries).ok()
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

fn resolve_brew_path() -> String {
    if let Ok(path) = which::which("brew") {
        return path.display().to_string();
    }
    if Path::new("/opt/homebrew/bin/brew").exists() {
        return "/opt/homebrew/bin/brew".to_string();
    }
    if Path::new("/usr/local/bin/brew").exists() {
        return "/usr/local/bin/brew".to_string();
    }
    "brew".to_string()
}

async fn resolve_npm_path() -> String {
    if let Ok(path) = which::which("npm") {
        return path.display().to_string();
    }
    if let Some(path) = resolve_npm_from_well_known() {
        return path;
    }
    // Try login shell
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
        // nvm: scan all installed versions
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
