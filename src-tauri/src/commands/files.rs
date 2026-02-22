use tauri::State;

use crate::{
    db,
    fs_ops,
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
pub async fn read_file(
    repo_path: String,
    file_path: String,
) -> Result<ReadFileResultDto, String> {
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
                return Err("cannot write to a restricted repository; change the trust level first".to_string());
            }
        }
        fs_ops::write_file(&repo_path, &file_path, &content).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
