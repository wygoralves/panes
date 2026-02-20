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

async fn run_db<T, F>(db: crate::db::Database, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&crate::db::Database) -> anyhow::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || operation(&db))
        .await
        .map_err(|error| error.to_string())?
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn open_workspace(
    state: State<'_, AppState>,
    path: String,
    scan_depth: Option<i64>,
) -> Result<WorkspaceDto, String> {
    let scan_depth = normalize_scan_depth(scan_depth);
    run_db(state.db.clone(), move |db| {
        let workspace = db::workspaces::upsert_workspace(db, &path, scan_depth)?;
        let repos =
            multi_repo::scan_git_repositories(&workspace.root_path, workspace.scan_depth as usize)?;
        let selection_configured =
            db::workspaces::is_git_repo_selection_configured(db, &workspace.id)?;

        for repo in repos {
            let _ = db::repos::upsert_repo(
                db,
                &workspace.id,
                &repo.name,
                &repo.path,
                &repo.default_branch,
                !selection_configured,
            );
        }

        Ok(workspace)
    })
    .await
}

#[tauri::command]
pub async fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<WorkspaceDto>, String> {
    run_db(state.db.clone(), db::workspaces::list_workspaces).await
}

#[tauri::command]
pub async fn list_archived_workspaces(
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceDto>, String> {
    run_db(state.db.clone(), db::workspaces::list_archived_workspaces).await
}

#[tauri::command]
pub async fn get_repos(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<RepoDto>, String> {
    run_db(state.db.clone(), move |db| {
        db::repos::get_repos(db, &workspace_id)
    })
    .await
}

#[tauri::command]
pub async fn set_repo_trust_level(
    state: State<'_, AppState>,
    repo_id: String,
    trust_level: TrustLevelDto,
) -> Result<(), String> {
    run_db(state.db.clone(), move |db| {
        db::repos::set_repo_trust_level(db, &repo_id, trust_level)
    })
    .await
}

#[tauri::command]
pub async fn set_repo_git_active(
    state: State<'_, AppState>,
    repo_id: String,
    is_active: bool,
) -> Result<(), String> {
    run_db(state.db.clone(), move |db| {
        db::repos::set_repo_active(db, &repo_id, is_active)?;

        if let Some(repo) = db::repos::find_repo_by_id(db, &repo_id)? {
            db::workspaces::set_git_repo_selection_configured(db, &repo.workspace_id, true)?;
        }

        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_workspace_git_active_repos(
    state: State<'_, AppState>,
    workspace_id: String,
    repo_ids: Vec<String>,
) -> Result<(), String> {
    run_db(state.db.clone(), move |db| {
        db::repos::set_workspace_active_repos(db, &workspace_id, &repo_ids)?;
        db::workspaces::set_git_repo_selection_configured(db, &workspace_id, true)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn has_workspace_git_selection(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceGitSelectionStatusDto, String> {
    let configured = run_db(state.db.clone(), move |db| {
        db::workspaces::is_git_repo_selection_configured(db, &workspace_id)
    })
    .await?;
    Ok(WorkspaceGitSelectionStatusDto { configured })
}

#[tauri::command]
pub async fn delete_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    run_db(state.db.clone(), move |db| {
        db::workspaces::delete_workspace(db, &workspace_id)
    })
    .await
}

#[tauri::command]
pub async fn archive_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    run_db(state.db.clone(), move |db| {
        db::workspaces::archive_workspace(db, &workspace_id)
    })
    .await
}

#[tauri::command]
pub async fn restore_workspace(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<WorkspaceDto, String> {
    run_db(state.db.clone(), move |db| {
        db::workspaces::restore_workspace(db, &workspace_id)
    })
    .await
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn normalize_scan_depth(value: Option<i64>) -> i64 {
    value
        .unwrap_or(DEFAULT_SCAN_DEPTH)
        .clamp(MIN_SCAN_DEPTH, MAX_SCAN_DEPTH)
}
