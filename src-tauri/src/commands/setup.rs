use std::{ffi::OsString, path::Path};

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::engines::codex::resolve_codex_executable;
use crate::models::{DepStatus, DependencyReport, InstallProgressEvent, InstallResult};
use crate::process_utils;
use crate::runtime_env;

// ---------------------------------------------------------------------------
// check_dependencies
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn check_dependencies() -> Result<DependencyReport, String> {
    let (node, git, codex) = tokio::join!(detect_node(), detect_git(), detect_codex(),);

    let package_managers = detect_package_managers(node.found).await;

    Ok(DependencyReport {
        node,
        codex,
        git,
        platform: runtime_env::platform_id().to_string(),
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
            let brew =
                resolve_brew_path().ok_or_else(|| "homebrew executable not found".to_string())?;
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
    if let Some(path) = runtime_env::resolve_executable("node") {
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
    let has_homebrew = resolve_brew_path().is_some();

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
    if let Some(path) = runtime_env::resolve_executable("git") {
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
    let npm_available = runtime_env::resolve_executable("npm").is_some()
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

async fn get_command_version_with_augmented_path(path: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(path);
    process_utils::configure_tokio_command(&mut command);
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
    runtime_env::augmented_path_with_prepend(
        executable
            .parent()
            .into_iter()
            .map(|value| value.to_path_buf()),
    )
}

#[cfg(not(target_os = "windows"))]
async fn detect_via_login_shell(command: &str, version_flag: &str) -> Option<(String, String)> {
    for shell in runtime_env::login_probe_shells() {
        let probe_cmd = format!("command -v {command} && {command} {version_flag}");
        let output = match Command::new(&shell)
            .args(runtime_env::login_probe_shell_args(&shell, &probe_cmd))
            .output()
            .await
        {
            Ok(output) if output.status.success() => output,
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
async fn detect_via_login_shell(_command: &str, _version_flag: &str) -> Option<(String, String)> {
    None
}

fn resolve_brew_path() -> Option<String> {
    runtime_env::resolve_executable("brew").map(|path| path.display().to_string())
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

async fn detect_package_managers(node_found: bool) -> Vec<String> {
    let mut package_managers = Vec::new();

    if node_found {
        package_managers.push("npm".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        for manager in ["winget", "choco", "scoop"] {
            if runtime_env::resolve_executable(manager).is_some() {
                package_managers.push(manager.to_string());
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if resolve_brew_path().is_some() {
            package_managers.push("homebrew".to_string());
        }
        if cfg!(target_os = "linux") {
            for manager in ["apt", "dnf", "pacman", "zypper", "apk"] {
                if runtime_env::resolve_executable(manager).is_some() {
                    package_managers.push(manager.to_string());
                }
            }
        }
    }

    package_managers
}
