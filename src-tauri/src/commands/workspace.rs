use tauri::State;

use crate::{
    db,
    git::multi_repo,
    models::{RepoDto, TrustLevelDto, WorkspaceDto},
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

    for repo in repos {
        let _ = db::repos::upsert_repo(
            &state.db,
            &workspace.id,
            &repo.name,
            &repo.path,
            &repo.default_branch,
        );
    }

    Ok(workspace)
}

#[tauri::command]
pub async fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<WorkspaceDto>, String> {
    db::workspaces::list_workspaces(&state.db).map_err(err_to_string)
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

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn normalize_scan_depth(value: Option<i64>) -> i64 {
    value
        .unwrap_or(DEFAULT_SCAN_DEPTH)
        .clamp(MIN_SCAN_DEPTH, MAX_SCAN_DEPTH)
}
