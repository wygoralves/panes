use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
};

use tauri::State;

use crate::{
    db, fs_ops,
    models::{FileTreeEntryDto, ReadFileResultDto, TrustLevelDto},
    state::AppState,
};

#[tauri::command]
pub async fn list_dir(
    repo_path: String,
    dir_path: String,
) -> Result<Vec<FileTreeEntryDto>, String> {
    tokio::task::spawn_blocking(move || {
        fs_ops::list_dir(&repo_path, &dir_path).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn read_file(repo_path: String, file_path: String) -> Result<ReadFileResultDto, String> {
    tokio::task::spawn_blocking(move || {
        fs_ops::read_file(&repo_path, &file_path).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn write_file(
    state: State<'_, AppState>,
    repo_path: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || {
        // Trust level check for user-initiated writes from the editor:
        // - Restricted: blocked — explicit opt-in required (must change trust level first)
        // - Standard/Trusted: allowed — these are direct user actions, not agent-initiated,
        //   so they don't require approval flow (approval is for agent operations)
        if let Some(repo) = db::repos::find_repo_by_path(&db, &repo_path).map_err(err_to_string)? {
            if matches!(repo.trust_level, TrustLevelDto::Restricted) {
                return Err(
                    "cannot write to a restricted repository; change the trust level first"
                        .to_string(),
                );
            }
        }
        fs_ops::write_file(&repo_path, &file_path, &content).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn reveal_path(path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        reveal_path_impl(PathBuf::from(path)).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct RevealCommandPlan {
    program: OsString,
    args: Vec<OsString>,
    display_target: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
enum RevealPlatform {
    Macos,
    Windows,
    Linux,
    Unsupported,
}

fn reveal_path_impl(path: PathBuf) -> anyhow::Result<()> {
    if !path.exists() {
        anyhow::bail!("path does not exist: {}", path.display());
    }

    let platform = reveal_platform();
    let (xdg_open, gio) = if platform == RevealPlatform::Linux {
        (
            crate::runtime_env::resolve_executable("xdg-open"),
            crate::runtime_env::resolve_executable("gio"),
        )
    } else {
        (None, None)
    };

    let Some(plan) = build_reveal_command_plan(&path, platform, xdg_open, gio)? else {
        return Ok(());
    };

    let mut command = Command::new(&plan.program);
    command.args(&plan.args);
    spawn_command(command, &plan.display_target)
}

fn reveal_platform() -> RevealPlatform {
    #[cfg(target_os = "macos")]
    {
        return RevealPlatform::Macos;
    }

    #[cfg(target_os = "windows")]
    {
        return RevealPlatform::Windows;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return RevealPlatform::Linux;
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    {
        RevealPlatform::Unsupported
    }
}

fn build_reveal_command_plan(
    path: &Path,
    platform: RevealPlatform,
    xdg_open: Option<PathBuf>,
    gio: Option<PathBuf>,
) -> anyhow::Result<Option<RevealCommandPlan>> {
    let path_arg = path.as_os_str().to_os_string();

    match platform {
        RevealPlatform::Macos => {
            let mut args = Vec::with_capacity(2);
            if path.is_file() {
                args.push(OsString::from("-R"));
            }
            args.push(path_arg);
            Ok(Some(RevealCommandPlan {
                program: OsString::from("open"),
                args,
                display_target: path.to_path_buf(),
            }))
        }
        RevealPlatform::Windows => {
            let args = if path.is_file() {
                let mut select_arg = OsString::from("/select,");
                select_arg.push(path.as_os_str());
                vec![select_arg]
            } else {
                vec![path_arg]
            };

            Ok(Some(RevealCommandPlan {
                program: OsString::from("explorer"),
                args,
                display_target: path.to_path_buf(),
            }))
        }
        RevealPlatform::Linux => {
            let target = if path.is_dir() {
                path.to_path_buf()
            } else {
                path.parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| path.to_path_buf())
            };

            if let Some(program) = xdg_open {
                return Ok(Some(RevealCommandPlan {
                    program: program.into_os_string(),
                    args: vec![target.as_os_str().to_os_string()],
                    display_target: target,
                }));
            }

            if let Some(program) = gio {
                return Ok(Some(RevealCommandPlan {
                    program: program.into_os_string(),
                    args: vec![OsString::from("open"), target.as_os_str().to_os_string()],
                    display_target: target,
                }));
            }

            anyhow::bail!(
                "failed to reveal {}: neither xdg-open nor gio open is available",
                target.display()
            );
        }
        RevealPlatform::Unsupported => Ok(None),
    }
}

fn spawn_command(mut command: Command, path: &std::path::Path) -> anyhow::Result<()> {
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| anyhow::anyhow!("failed to reveal {}: {error}", path.display()))
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{build_reveal_command_plan, RevealPlatform};
    use uuid::Uuid;

    fn with_temp_path<T>(f: impl FnOnce(PathBuf, PathBuf) -> T) -> T {
        let root = std::env::temp_dir().join(format!("panes-reveal-path-{}", Uuid::new_v4()));
        let dir = root.join("nested");
        let file = dir.join("file.txt");
        fs::create_dir_all(&dir).expect("temp dir should exist");
        fs::write(&file, "hello").expect("temp file should exist");
        let result = f(dir.clone(), file.clone());
        let _ = fs::remove_dir_all(&root);
        result
    }

    #[test]
    fn windows_files_use_explorer_select_args() {
        with_temp_path(|_dir, file| {
            let plan = build_reveal_command_plan(&file, RevealPlatform::Windows, None, None)
                .expect("plan should build")
                .expect("plan should exist");

            assert_eq!(plan.program.to_string_lossy(), "explorer");
            assert_eq!(plan.args.len(), 1);
            assert_eq!(
                plan.args[0].to_string_lossy(),
                format!("/select,{}", file.display())
            );
            assert_eq!(plan.display_target, file);
        });
    }

    #[test]
    fn windows_directories_open_in_explorer() {
        with_temp_path(|dir, _file| {
            let plan = build_reveal_command_plan(&dir, RevealPlatform::Windows, None, None)
                .expect("plan should build")
                .expect("plan should exist");

            assert_eq!(plan.program.to_string_lossy(), "explorer");
            assert_eq!(plan.args, vec![dir.as_os_str().to_os_string()]);
            assert_eq!(plan.display_target, dir);
        });
    }

    #[test]
    fn mac_files_use_open_reveal_flag() {
        with_temp_path(|_dir, file| {
            let plan = build_reveal_command_plan(&file, RevealPlatform::Macos, None, None)
                .expect("plan should build")
                .expect("plan should exist");

            assert_eq!(plan.program.to_string_lossy(), "open");
            assert_eq!(
                plan.args,
                vec![
                    std::ffi::OsString::from("-R"),
                    file.as_os_str().to_os_string()
                ]
            );
        });
    }

    #[test]
    fn linux_prefers_xdg_open_for_parent_directory() {
        with_temp_path(|dir, file| {
            let plan = build_reveal_command_plan(
                &file,
                RevealPlatform::Linux,
                Some(PathBuf::from("/usr/bin/xdg-open")),
                Some(PathBuf::from("/usr/bin/gio")),
            )
            .expect("plan should build")
            .expect("plan should exist");

            assert_eq!(plan.program.to_string_lossy(), "/usr/bin/xdg-open");
            assert_eq!(plan.args, vec![dir.as_os_str().to_os_string()]);
            assert_eq!(plan.display_target, dir);
        });
    }

    #[test]
    fn linux_falls_back_to_gio_when_xdg_open_is_missing() {
        with_temp_path(|dir, _file| {
            let plan = build_reveal_command_plan(
                &dir,
                RevealPlatform::Linux,
                None,
                Some(PathBuf::from("/usr/bin/gio")),
            )
            .expect("plan should build")
            .expect("plan should exist");

            assert_eq!(plan.program.to_string_lossy(), "/usr/bin/gio");
            assert_eq!(
                plan.args,
                vec![
                    std::ffi::OsString::from("open"),
                    dir.as_os_str().to_os_string()
                ]
            );
            assert_eq!(plan.display_target, dir);
        });
    }

    #[test]
    fn linux_returns_a_clear_error_without_openers() {
        with_temp_path(|dir, _file| {
            let error = build_reveal_command_plan(&dir, RevealPlatform::Linux, None, None)
                .expect_err("missing openers should fail");

            assert!(error
                .to_string()
                .contains("neither xdg-open nor gio open is available"));
        });
    }
}
