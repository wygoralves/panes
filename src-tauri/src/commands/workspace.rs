use tauri::State;

use crate::{
    db,
    git::multi_repo,
    models::{RepoDto, TrustLevelDto, WorkspaceDto, WorkspaceGitSelectionStatusDto},
    state::AppState,
};

const DEFAULT_SCAN_DEPTH: i64 = 3;
const MIN_SCAN_DEPTH: i64 = 0;
const MAX_SCAN_DEPTH: i64 = 12;

#[tauri::command]
pub async fn open_workspace(
    state: State<'_, AppState>,
    path: String,
    scan_depth: Option<i64>,
) -> Result<WorkspaceDto, String> {
    let scan_depth = normalize_scan_depth(scan_depth);
    let workspace =
        db::workspaces::upsert_workspace(&state.db, &path, scan_depth).map_err(err_to_string)?;

    let repos =
        multi_repo::scan_git_repositories(&workspace.root_path, workspace.scan_depth as usize)
            .map_err(err_to_string)?;
    let selection_configured =
        db::workspaces::is_git_repo_selection_configured(&state.db, &workspace.id)
            .map_err(err_to_string)?;

    for repo in repos {
        let _ = db::repos::upsert_repo(
            &state.db,
            &workspace.id,
            &repo.name,
            &repo.path,
            &repo.default_branch,
            !selection_configured,
        );
    }

    Ok(workspace)
}

#[tauri::command]
pub async fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<WorkspaceDto>, String> {
    db::workspaces::list_workspaces(&state.db).map_err(err_to_string)
}

#[tauri::command]
pub async fn list_archived_workspaces(
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceDto>, String> {
    db::workspaces::list_archived_workspaces(&state.db).map_err(err_to_string)
}

#[tauri::command]
pub async fn get_repos(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<RepoDto>, String> {
    db::repos::get_repos(&state.db, &workspace_id).map_err(err_to_string)
}

#[tauri::command]
pub async fn set_repo_trust_level(
    state: State<'_, AppState>,
    repo_id: String,
    trust_level: TrustLevelDto,
) -> Result<(), String> {
    db::repos::set_repo_trust_level(&state.db, &repo_id, trust_level).map_err(err_to_string)
}

#[tauri::command]
pub async fn set_repo_git_active(
    state: State<'_, AppState>,
    repo_id: String,
    is_active: bool,
) -> Result<(), String> {
    db::repos::set_repo_active(&state.db, &repo_id, is_active).map_err(err_to_string)?;

    if let Some(repo) = db::repos::find_repo_by_id(&state.db, &repo_id).map_err(err_to_string)? {
        db::workspaces::set_git_repo_selection_configured(&state.db, &repo.workspace_id, true)
            .map_err(err_to_string)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn set_workspace_git_active_repos(
    state: State<'_, AppState>,
    workspace_id: String,
    repo_ids: Vec<String>,
) -> Result<(), String> {
    db::repos::set_workspace_active_repos(&state.db, &workspace_id, &repo_ids)
        .map_err(err_to_string)?;
    db::workspaces::set_git_repo_selection_configured(&state.db, &workspace_id, true)
        .map_err(err_to_string)?;
    Ok(())
}

#[tauri::command]
pub async fn has_workspace_git_selection(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceGitSelectionStatusDto, String> {
    let configured = db::workspaces::is_git_repo_selection_configured(&state.db, &workspace_id)
        .map_err(err_to_string)?;
    Ok(WorkspaceGitSelectionStatusDto { configured })
}

#[tauri::command]
pub async fn delete_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    db::workspaces::delete_workspace(&state.db, &workspace_id).map_err(err_to_string)
}

#[tauri::command]
pub async fn archive_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    db::workspaces::archive_workspace(&state.db, &workspace_id).map_err(err_to_string)
}

#[tauri::command]
pub async fn restore_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceDto, String> {
    db::workspaces::restore_workspace(&state.db, &workspace_id).map_err(err_to_string)
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn normalize_scan_depth(value: Option<i64>) -> i64 {
    value
        .unwrap_or(DEFAULT_SCAN_DEPTH)
        .clamp(MIN_SCAN_DEPTH, MAX_SCAN_DEPTH)
}
