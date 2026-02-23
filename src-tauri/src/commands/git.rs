use serde::Serialize;
use tauri::Emitter;
use tauri::State;

use crate::{
    git::repo,
    models::{
        FileTreeEntryDto, FileTreePageDto, GitBranchPageDto, GitBranchScopeDto, GitCommitPageDto,
        GitStashDto, GitStatusDto, GitTagDto,
    },
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
pub async fn discard_files(
    _state: State<'_, AppState>,
    repo_path: String,
    files: Vec<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::discard_files(&repo_path, &files).map_err(err_to_string)
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
pub async fn fetch_git(_state: State<'_, AppState>, repo_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo::fetch_repo(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pull_git(_state: State<'_, AppState>, repo_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo::pull_repo(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn push_git(_state: State<'_, AppState>, repo_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo::push_repo(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_git_branches(
    _state: State<'_, AppState>,
    repo_path: String,
    scope: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<GitBranchPageDto, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(200);
    let scope = GitBranchScopeDto::from_str(&scope);

    tokio::task::spawn_blocking(move || {
        repo::list_git_branches(&repo_path, scope, offset, limit).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn checkout_git_branch(
    _state: State<'_, AppState>,
    repo_path: String,
    branch_name: String,
    is_remote: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::checkout_git_branch(&repo_path, &branch_name, is_remote).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn create_git_branch(
    _state: State<'_, AppState>,
    repo_path: String,
    branch_name: String,
    from_ref: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::create_git_branch(&repo_path, &branch_name, from_ref.as_deref())
            .map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn rename_git_branch(
    _state: State<'_, AppState>,
    repo_path: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::rename_git_branch(&repo_path, &old_name, &new_name).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn delete_git_branch(
    _state: State<'_, AppState>,
    repo_path: String,
    branch_name: String,
    force: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::delete_git_branch(&repo_path, &branch_name, force).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_git_commits(
    _state: State<'_, AppState>,
    repo_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<GitCommitPageDto, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(100);

    tokio::task::spawn_blocking(move || {
        repo::list_git_commits(&repo_path, offset, limit).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_git_stashes(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<GitStashDto>, String> {
    tokio::task::spawn_blocking(move || repo::list_git_stashes(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn push_git_stash(
    _state: State<'_, AppState>,
    repo_path: String,
    message: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::push_git_stash(&repo_path, message.as_deref()).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn apply_git_stash(
    _state: State<'_, AppState>,
    repo_path: String,
    stash_index: usize,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::apply_git_stash(&repo_path, stash_index).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pop_git_stash(
    _state: State<'_, AppState>,
    repo_path: String,
    stash_index: usize,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::pop_git_stash(&repo_path, stash_index).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_commit_diff(
    _state: State<'_, AppState>,
    repo_path: String,
    commit_hash: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        repo::get_commit_diff(&repo_path, &commit_hash).map_err(err_to_string)
    })
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

#[tauri::command]
pub async fn get_file_tree_page(
    _state: State<'_, AppState>,
    repo_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<FileTreePageDto, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(2000);
    tokio::task::spawn_blocking(move || {
        repo::get_file_tree_page(&repo_path, offset, limit).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn drop_git_stash(
    _state: State<'_, AppState>,
    repo_path: String,
    stash_index: usize,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::drop_git_stash(&repo_path, stash_index).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn merge_branch(
    _state: State<'_, AppState>,
    repo_path: String,
    branch_name: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        repo::merge_branch(&repo_path, &branch_name).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn revert_commit(
    _state: State<'_, AppState>,
    repo_path: String,
    commit_hash: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::revert_commit(&repo_path, &commit_hash).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn cherry_pick_commit(
    _state: State<'_, AppState>,
    repo_path: String,
    commit_hash: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::cherry_pick_commit(&repo_path, &commit_hash).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn reset_to_commit(
    _state: State<'_, AppState>,
    repo_path: String,
    commit_hash: String,
    mode: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::reset_to_commit(&repo_path, &commit_hash, &mode).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_git_tags(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<GitTagDto>, String> {
    tokio::task::spawn_blocking(move || repo::list_git_tags(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn create_git_tag(
    _state: State<'_, AppState>,
    repo_path: String,
    tag_name: String,
    commit_hash: Option<String>,
    message: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::create_git_tag(
            &repo_path,
            &tag_name,
            commit_hash.as_deref(),
            message.as_deref(),
        )
        .map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn delete_git_tag(
    _state: State<'_, AppState>,
    repo_path: String,
    tag_name: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::delete_git_tag(&repo_path, &tag_name).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitRepoChangedEvent {
    repo_path: String,
}

#[tauri::command]
pub async fn watch_git_repo(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<(), String> {
    let callback = std::sync::Arc::new(move |changed_repo_path: String| {
        let payload = GitRepoChangedEvent {
            repo_path: changed_repo_path,
        };
        let _ = app.emit("git-repo-changed", payload);
    });

    state
        .git_watchers
        .watch_repo(repo_path, callback)
        .await
        .map_err(err_to_string)
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
