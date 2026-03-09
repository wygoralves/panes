use std::{path::PathBuf, process::Command};

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

fn reveal_path_impl(path: PathBuf) -> anyhow::Result<()> {
    if !path.exists() {
        anyhow::bail!("path does not exist: {}", path.display());
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        if path.is_file() {
            command.arg("-R");
        }
        command.arg(&path);
        return spawn_command(command, &path);
    }

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer");
        if path.is_file() {
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(&path);
        }
        return spawn_command(command, &path);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let target = if path.is_dir() {
            path.clone()
        } else {
            path.parent()
                .map(|parent| parent.to_path_buf())
                .unwrap_or_else(|| path.clone())
        };

        if let Some(program) = crate::runtime_env::resolve_executable("xdg-open") {
            let mut command = Command::new(program);
            command.arg(&target);
            spawn_command(command, &target)?;
            return Ok(());
        }

        if let Some(program) = crate::runtime_env::resolve_executable("gio") {
            let mut command = Command::new(program);
            command.arg("open").arg(&target);
            spawn_command(command, &target)?;
            return Ok(());
        }

        anyhow::bail!(
            "failed to reveal {}: neither xdg-open nor gio open is available",
            target.display()
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", unix)))]
    Ok(())
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
