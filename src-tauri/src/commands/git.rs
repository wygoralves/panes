use serde::Serialize;
use tauri::Emitter;
use tauri::State;

use crate::{
    git::{repo, worktree},
    models::{
        FileTreeEntryDto, FileTreePageDto, GitBranchPageDto, GitBranchScopeDto, GitCommitPageDto,
        GitStashDto, GitStatusDto, GitWorktreeDto,
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
pub async fn soft_reset_last_commit(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::soft_reset_last_commit(&repo_path).map_err(err_to_string)
    })
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
    search: Option<String>,
) -> Result<GitBranchPageDto, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(200);
    let scope = GitBranchScopeDto::from_str(&scope);

    tokio::task::spawn_blocking(move || {
        repo::list_git_branches(&repo_path, scope, offset, limit, search.as_deref())
            .map_err(err_to_string)
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
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<FileTreeEntryDto>, String> {
    let cache = state.file_tree_cache.clone();
    tokio::task::spawn_blocking(move || {
        repo::get_file_tree(&repo_path, &cache).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_file_tree_page(
    state: State<'_, AppState>,
    repo_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<FileTreePageDto, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(2000);
    let cache = state.file_tree_cache.clone();
    tokio::task::spawn_blocking(move || {
        repo::get_file_tree_page(&repo_path, offset, limit, &cache).map_err(err_to_string)
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
    let cache = state.file_tree_cache.clone();
    let callback = std::sync::Arc::new(move |changed_repo_path: String| {
        cache.invalidate(&changed_repo_path);
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

// ── Git Worktrees ──────────────────────────────────────────────

#[tauri::command]
pub async fn add_git_worktree(
    _state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    branch_name: String,
    base_ref: Option<String>,
) -> Result<GitWorktreeDto, String> {
    // Validate branch name
    if branch_name.contains("..")
        || branch_name.starts_with('/')
        || branch_name.ends_with('/')
        || branch_name.contains(' ')
        || branch_name.is_empty()
    {
        return Err(format!("invalid branch name: {branch_name}"));
    }

    tokio::task::spawn_blocking(move || {
        // Ensure parent directory exists
        if let Some(parent) = std::path::Path::new(&worktree_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create worktree parent directory: {e}"))?;
        }

        let created = worktree::add_worktree(
            &repo_path,
            &worktree_path,
            &branch_name,
            base_ref.as_deref(),
        )
        .map_err(err_to_string)?;

        // Keep .panes/ ignored, but don't fail the command after successful creation.
        if let Err(error) = ensure_gitignore_entry(&repo_path, ".panes/") {
            eprintln!(
                "warning: failed to ensure .panes/ in .gitignore for '{}': {}",
                repo_path, error
            );
        }

        Ok(created)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_git_worktrees(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<GitWorktreeDto>, String> {
    tokio::task::spawn_blocking(move || worktree::list_worktrees(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn remove_git_worktree(
    _state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    force: bool,
    branch_name: Option<String>,
    delete_branch: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        worktree::remove_worktree(
            &repo_path,
            &worktree_path,
            force,
            branch_name.as_deref(),
            delete_branch,
        )
        .map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn prune_git_worktrees(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        worktree::prune_worktrees(&repo_path).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Ensures a pattern exists in the repo's .gitignore file.
fn ensure_gitignore_entry(repo_path: &str, pattern: &str) -> Result<(), String> {
    let gitignore_path = std::path::Path::new(repo_path).join(".gitignore");

    if gitignore_path.exists() {
        let content = std::fs::read_to_string(&gitignore_path)
            .map_err(|e| format!("read .gitignore: {e}"))?;
        // Check if pattern is already present (as a whole line)
        if content.lines().any(|line| line.trim() == pattern) {
            return Ok(());
        }
        // Append with newline separator if file doesn't end with one
        let prefix = if content.ends_with('\n') { "" } else { "\n" };
        std::fs::write(&gitignore_path, format!("{content}{prefix}{pattern}\n"))
            .map_err(|e| format!("write .gitignore: {e}"))?;
    } else {
        std::fs::write(&gitignore_path, format!("{pattern}\n"))
            .map_err(|e| format!("create .gitignore: {e}"))?;
    }

    Ok(())
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
