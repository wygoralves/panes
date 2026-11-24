use tauri::State;

use crate::{
    db, fs_ops,
    git::{multi_repo, repo},
    models::{
        FileTreeEntryDto, FileTreePageDto, RepoDto, TrustLevelDto, WorkspaceDto,
        WorkspaceGitSelectionStatusDto,
    },
    state::AppState,
    workspace_startup::{
        normalize_workspace_startup_preset as normalize_preset,
        parse_persisted_workspace_startup_preset_json, parse_workspace_startup_preset_raw,
        resolve_workspace_path, serialize_workspace_startup_preset as serialize_preset,
        WorkspaceStartupPreset, WorkspaceStartupPresetFormat,
    },
};

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
        scan_workspace_repos(db, &workspace)?;
        Ok(workspace)
    })
    .await
}

/// Scans the workspace root for git repositories and stores them as its repo rows.
fn scan_workspace_repos(db: &crate::db::Database, workspace: &WorkspaceDto) -> anyhow::Result<()> {
    let repos =
        multi_repo::scan_git_repositories(&workspace.root_path, workspace.scan_depth as usize)?;
    let repo_paths = repos
        .iter()
        .map(|repo| repo.path.clone())
        .collect::<Vec<_>>();
    db::repos::reconcile_workspace_repos(db, &workspace.id, &repo_paths)?;
    let selection_configured = db::workspaces::is_git_repo_selection_configured(db, &workspace.id)?;

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

    Ok(())
}

/// Registers the workspace root as a repo when the root is itself a git
/// repository root. No other directory is read, so a default workspace in the
/// home folder never walks Documents, Desktop or Downloads.
pub(crate) fn register_workspace_root_repo(
    db: &crate::db::Database,
    workspace: &WorkspaceDto,
) -> anyhow::Result<()> {
    if !std::path::Path::new(&workspace.root_path)
        .join(".git")
        .exists()
    {
        return Ok(());
    }
    // Depth 0 only opens the root itself and never lists a directory.
    let repos = multi_repo::scan_git_repositories(&workspace.root_path, 0)?;
    let selection_configured = db::workspaces::is_git_repo_selection_configured(db, &workspace.id)?;
    for repo in repos {
        db::repos::upsert_repo(
            db,
            &workspace.id,
            &repo.name,
            &repo.path,
            &repo.default_branch,
            !selection_configured,
        )?;
    }
    Ok(())
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

#[tauri::command]
pub async fn get_workspace_startup_preset(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Option<WorkspaceStartupPreset>, String> {
    run_db(state.db.clone(), move |db| {
        load_workspace(db, &workspace_id)?;
        db::workspaces::get_workspace_startup_preset_json(db, &workspace_id)?
            .as_deref()
            .map(parse_persisted_workspace_startup_preset_json)
            .transpose()
    })
    .await
}

#[tauri::command]
pub async fn normalize_workspace_startup_preset(
    state: State<'_, AppState>,
    workspace_id: String,
    preset: WorkspaceStartupPreset,
) -> Result<WorkspaceStartupPreset, String> {
    run_db(state.db.clone(), move |db| {
        let workspace = load_workspace(db, &workspace_id)?;
        let workspace_root = resolve_workspace_path(&workspace.root_path)?;
        normalize_preset(preset, &workspace_root)
    })
    .await
}

#[tauri::command]
pub async fn serialize_workspace_startup_preset(
    state: State<'_, AppState>,
    workspace_id: String,
    preset: WorkspaceStartupPreset,
    format: WorkspaceStartupPresetFormat,
) -> Result<String, String> {
    run_db(state.db.clone(), move |db| {
        let workspace = load_workspace(db, &workspace_id)?;
        let workspace_root = resolve_workspace_path(&workspace.root_path)?;
        let normalized = normalize_preset(preset, &workspace_root)?;
        serialize_preset(&normalized, format)
    })
    .await
}

#[tauri::command]
pub async fn normalize_workspace_startup_preset_raw(
    state: State<'_, AppState>,
    workspace_id: String,
    format: WorkspaceStartupPresetFormat,
    raw_text: String,
) -> Result<WorkspaceStartupPreset, String> {
    run_db(state.db.clone(), move |db| {
        let workspace = load_workspace(db, &workspace_id)?;
        let workspace_root = resolve_workspace_path(&workspace.root_path)?;
        let parsed = parse_workspace_startup_preset_raw(format, &raw_text)?;
        normalize_preset(parsed, &workspace_root)
    })
    .await
}

#[tauri::command]
pub async fn set_workspace_startup_preset(
    state: State<'_, AppState>,
    workspace_id: String,
    preset: WorkspaceStartupPreset,
) -> Result<WorkspaceStartupPreset, String> {
    run_db(state.db.clone(), move |db| {
        let workspace = load_workspace(db, &workspace_id)?;
        let workspace_root = resolve_workspace_path(&workspace.root_path)?;
        let normalized = normalize_preset(preset, &workspace_root)?;
        let raw_json = serde_json::to_string(&normalized)
            .map_err(|error| anyhow::anyhow!("failed to serialize startup preset JSON: {error}"))?;
        db::workspaces::set_workspace_startup_preset_json(db, &workspace_id, Some(&raw_json))?;
        Ok(normalized)
    })
    .await
}

#[tauri::command]
pub async fn set_workspace_startup_preset_raw(
    state: State<'_, AppState>,
    workspace_id: String,
    format: WorkspaceStartupPresetFormat,
    raw_text: String,
) -> Result<WorkspaceStartupPreset, String> {
    run_db(state.db.clone(), move |db| {
        let workspace = load_workspace(db, &workspace_id)?;
        let workspace_root = resolve_workspace_path(&workspace.root_path)?;
        let parsed = parse_workspace_startup_preset_raw(format, &raw_text)?;
        let normalized = normalize_preset(parsed, &workspace_root)?;
        let raw_json = serde_json::to_string(&normalized)
            .map_err(|error| anyhow::anyhow!("failed to serialize startup preset JSON: {error}"))?;
        db::workspaces::set_workspace_startup_preset_json(db, &workspace_id, Some(&raw_json))?;
        Ok(normalized)
    })
    .await
}

#[tauri::command]
pub async fn clear_workspace_startup_preset(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    run_db(state.db.clone(), move |db| {
        db::workspaces::set_workspace_startup_preset_json(db, &workspace_id, None)
    })
    .await
}

#[tauri::command]
pub async fn export_workspace_startup_preset(
    state: State<'_, AppState>,
    workspace_id: String,
    format: WorkspaceStartupPresetFormat,
) -> Result<String, String> {
    run_db(state.db.clone(), move |db| {
        load_workspace(db, &workspace_id)?;
        let raw_json = db::workspaces::get_workspace_startup_preset_json(db, &workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("workspace startup preset is not configured"))?;
        let preset = parse_persisted_workspace_startup_preset_json(&raw_json)?;
        serialize_preset(&preset, format)
    })
    .await
}

#[tauri::command]
pub async fn list_workspace_dirs(
    state: State<'_, AppState>,
    workspace_id: String,
    dir_path: Option<String>,
) -> Result<Vec<FileTreeEntryDto>, String> {
    run_db(state.db.clone(), move |db| {
        let workspace = load_workspace(db, &workspace_id)?;
        let mut entries =
            fs_ops::list_dir(&workspace.root_path, dir_path.as_deref().unwrap_or(""))?;
        entries.retain(|entry| entry.is_dir);
        Ok(entries)
    })
    .await
}

#[tauri::command]
pub async fn get_workspace_file_tree_page(
    state: State<'_, AppState>,
    workspace_id: String,
    offset: Option<usize>,
    limit: Option<usize>,
    refresh: Option<bool>,
) -> Result<FileTreePageDto, String> {
    let cache = state.file_tree_cache.clone();
    run_db(state.db.clone(), move |db| {
        let workspace = load_workspace(db, &workspace_id)?;
        if refresh.unwrap_or(false) {
            cache.invalidate_workspace(&workspace.root_path);
        }
        repo::get_workspace_file_tree_page(
            &workspace.root_path,
            offset.unwrap_or(0),
            limit.unwrap_or(2000),
            &cache,
        )
    })
    .await
}

#[tauri::command]
pub async fn search_workspace_files(
    state: State<'_, AppState>,
    workspace_id: String,
    query: String,
    offset: Option<usize>,
    limit: Option<usize>,
    refresh: Option<bool>,
) -> Result<FileTreePageDto, String> {
    let cache = state.file_tree_cache.clone();
    run_db(state.db.clone(), move |db| {
        let workspace = load_workspace(db, &workspace_id)?;
        if refresh.unwrap_or(false) {
            cache.invalidate_workspace(&workspace.root_path);
        }
        repo::search_workspace_files(
            &workspace.root_path,
            &query,
            offset.unwrap_or(0),
            limit.unwrap_or(80),
            &cache,
        )
    })
    .await
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn load_workspace(db: &crate::db::Database, workspace_id: &str) -> anyhow::Result<WorkspaceDto> {
    db::workspaces::find_workspace_by_id(db, workspace_id)?
        .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))
}

fn normalize_scan_depth(value: Option<i64>) -> Option<i64> {
    value.map(|depth| depth.clamp(MIN_SCAN_DEPTH, MAX_SCAN_DEPTH))
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::*;

    fn fresh_workspace(
        root: &std::path::Path,
        base: &std::path::Path,
    ) -> (crate::db::Database, WorkspaceDto) {
        std::fs::create_dir_all(root).expect("create workspace root");
        let db = crate::db::Database::open(base.join("workspaces.db")).expect("open db");
        let workspace = db::workspaces::upsert_workspace(&db, &root.to_string_lossy(), None)
            .expect("workspace");
        (db, workspace)
    }

    #[test]
    fn registering_a_default_workspace_that_is_a_repo_root_stores_its_repo() {
        let base = std::env::temp_dir().join(format!("panes-default-root-{}", Uuid::new_v4()));
        let root = base.join("project");
        let (db, workspace) = fresh_workspace(&root, &base);
        git2::Repository::init(&root).expect("init repo");

        register_workspace_root_repo(&db, &workspace).expect("register root repo");

        let repos = db::repos::get_repos(&db, &workspace.id).expect("repos");
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].name, "project");
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn registering_a_default_workspace_that_only_contains_repos_stores_none() {
        let base = std::env::temp_dir().join(format!("panes-default-plain-{}", Uuid::new_v4()));
        let root = base.join("home");
        let (db, workspace) = fresh_workspace(&root, &base);
        git2::Repository::init(root.join("Documents").join("nested")).expect("init nested repo");

        register_workspace_root_repo(&db, &workspace).expect("register root repo");

        let repos = db::repos::get_repos(&db, &workspace.id).expect("repos");
        assert!(repos.is_empty());
        let _ = std::fs::remove_dir_all(&base);
    }
}
