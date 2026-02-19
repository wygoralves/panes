use tauri::State;

use crate::{
    git::repo,
    models::{FileTreeEntryDto, GitStatusDto},
    state::AppState,
};

#[tauri::command]
pub async fn get_git_status(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<GitStatusDto, String> {
    tokio::task::spawn_blocking(move || repo::get_git_status(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_file_diff(
    _state: State<'_, AppState>,
    repo_path: String,
    file_path: String,
    staged: bool,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        repo::get_file_diff(&repo_path, &file_path, staged).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn stage_files(
    _state: State<'_, AppState>,
    repo_path: String,
    files: Vec<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::stage_files(&repo_path, &files).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn unstage_files(
    _state: State<'_, AppState>,
    repo_path: String,
    files: Vec<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::unstage_files(&repo_path, &files).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn commit(
    _state: State<'_, AppState>,
    repo_path: String,
    message: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo::commit(&repo_path, &message).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_file_tree(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<FileTreeEntryDto>, String> {
    tokio::task::spawn_blocking(move || repo::get_file_tree(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
