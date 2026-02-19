use tauri::State;

use crate::{
    db,
    git::multi_repo,
    models::{RepoDto, TrustLevelDto, WorkspaceDto},
    state::AppState,
};

#[tauri::command]
pub async fn open_workspace(
    state: State<'_, AppState>,
    path: String,
) -> Result<WorkspaceDto, String> {
    let workspace = db::workspaces::upsert_workspace(&state.db, &path, 3).map_err(err_to_string)?;

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

    let _ = db::threads::ensure_workspace_thread(
        &state.db,
        &workspace.id,
        &state.config.general.default_engine,
        &state.config.general.default_model,
    );
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

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
