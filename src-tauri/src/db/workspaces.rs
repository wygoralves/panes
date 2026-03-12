use std::path::Path;

use anyhow::Context;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::models::WorkspaceDto;
use crate::runtime_env;

use super::Database;

const DEFAULT_SCAN_DEPTH: i64 = 3;

pub fn upsert_workspace(
    db: &Database,
    root_path: &str,
    scan_depth: Option<i64>,
) -> anyhow::Result<WorkspaceDto> {
    let conn = db.connect()?;
    let canonical = Path::new(root_path)
        .canonicalize()
        .unwrap_or_else(|_| Path::new(root_path).to_path_buf());
    let canonical = canonical.to_string_lossy().to_string();

    let existing = conn
        .query_row(
            "SELECT id FROM workspaces WHERE root_path = ?1",
            params![canonical],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .context("failed to query workspace")?;

    if let Some(id) = existing {
        conn.execute(
            "UPDATE workspaces
       SET last_opened_at = datetime('now'),
           scan_depth = COALESCE(?2, scan_depth),
           archived_at = NULL
       WHERE id = ?1",
            params![id, scan_depth],
        )
        .context("failed to update workspace last_opened_at")?;
    } else {
        let id = Uuid::new_v4().to_string();
        let name = workspace_name_from_path(&canonical);
        let scan_depth = scan_depth.unwrap_or(DEFAULT_SCAN_DEPTH);
        conn.execute(
            "INSERT INTO workspaces (id, name, root_path, scan_depth) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, canonical, scan_depth],
        )
        .context("failed to insert workspace")?;
    }

    get_workspace_by_root(&conn, &canonical)
}

pub fn list_workspaces(db: &Database) -> anyhow::Result<Vec<WorkspaceDto>> {
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, root_path, scan_depth, created_at, last_opened_at
     FROM workspaces
     WHERE archived_at IS NULL
     ORDER BY last_opened_at DESC",
    )?;

    let rows = stmt.query_map([], map_workspace_row)?;
    let mut out = Vec::new();

    for item in rows {
        out.push(item?);
    }

    Ok(out)
}

pub fn list_archived_workspaces(db: &Database) -> anyhow::Result<Vec<WorkspaceDto>> {
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
        "SELECT id, name, root_path, scan_depth, created_at, last_opened_at
     FROM workspaces
     WHERE archived_at IS NOT NULL
     ORDER BY archived_at DESC",
    )?;

    let rows = stmt.query_map([], map_workspace_row)?;
    let mut out = Vec::new();

    for item in rows {
        out.push(item?);
    }

    Ok(out)
}

pub fn ensure_default_workspace(db: &Database) -> anyhow::Result<WorkspaceDto> {
    let current_exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let temp_dir = std::env::temp_dir();
    let windows_dir = windows_system_dir();
    if let Some(first) = list_workspaces(db)?.into_iter().find(|workspace| {
        is_viable_workspace_root(
            Path::new(&workspace.root_path),
            current_exe_dir.as_deref(),
            cfg!(target_os = "windows"),
            Some(temp_dir.as_path()),
            windows_dir.as_deref(),
        )
    }) {
        return Ok(first);
    }

    let root = preferred_default_workspace_root();
    let root = root.to_string_lossy().to_string();
    upsert_workspace(db, &root, None)
}

fn preferred_default_workspace_root() -> std::path::PathBuf {
    let cwd = std::env::current_dir().ok();
    let home = runtime_env::home_dir();
    let current_exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let temp_dir = std::env::temp_dir();
    let windows_dir = windows_system_dir();
    preferred_default_workspace_root_for(
        cwd.as_deref(),
        home.as_deref(),
        current_exe_dir.as_deref(),
        cfg!(target_os = "windows"),
        Some(temp_dir.as_path()),
        windows_dir.as_deref(),
    )
}

fn preferred_default_workspace_root_for(
    cwd: Option<&Path>,
    home: Option<&Path>,
    current_exe_dir: Option<&Path>,
    is_windows: bool,
    temp_dir: Option<&Path>,
    windows_dir: Option<&Path>,
) -> std::path::PathBuf {
    cwd.filter(|path| {
        is_viable_workspace_root(path, current_exe_dir, is_windows, temp_dir, windows_dir)
    })
    .or_else(|| {
        home.filter(|path| {
            is_viable_workspace_root(path, current_exe_dir, is_windows, temp_dir, windows_dir)
        })
    })
    .map(Path::to_path_buf)
    .unwrap_or_else(|| std::path::PathBuf::from("."))
}

fn is_viable_workspace_root(
    path: &Path,
    current_exe_dir: Option<&Path>,
    is_windows: bool,
    temp_dir: Option<&Path>,
    windows_dir: Option<&Path>,
) -> bool {
    path.is_dir()
        && !is_transient_appimage_mount(path)
        && !is_current_executable_tree(path, current_exe_dir)
        && !is_unsafe_windows_default_root(path, is_windows, temp_dir, windows_dir)
}

fn is_transient_appimage_mount(path: &Path) -> bool {
    let rendered = path.to_string_lossy();
    rendered.starts_with("/tmp/.mount_") || rendered.starts_with("/var/tmp/.mount_")
}

fn is_current_executable_tree(path: &Path, current_exe_dir: Option<&Path>) -> bool {
    current_exe_dir.is_some_and(|dir| path == dir || path.starts_with(dir) || dir.starts_with(path))
}

fn is_unsafe_windows_default_root(
    path: &Path,
    is_windows: bool,
    temp_dir: Option<&Path>,
    windows_dir: Option<&Path>,
) -> bool {
    if !is_windows {
        return false;
    }

    temp_dir.is_some_and(|dir| path.starts_with(dir))
        || windows_dir.is_some_and(|dir| path.starts_with(dir))
}

fn windows_system_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("WINDIR")
        .or_else(|| std::env::var_os("SystemRoot"))
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
}

pub fn delete_workspace(db: &Database, workspace_id: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let affected = conn
        .execute(
            "DELETE FROM workspaces WHERE id = ?1",
            params![workspace_id],
        )
        .context("failed to delete workspace")?;

    if affected == 0 {
        anyhow::bail!("workspace not found: {workspace_id}");
    }

    Ok(())
}

pub fn archive_workspace(db: &Database, workspace_id: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let affected = conn
        .execute(
            "UPDATE workspaces
       SET archived_at = datetime('now')
       WHERE id = ?1
         AND archived_at IS NULL",
            params![workspace_id],
        )
        .context("failed to archive workspace")?;

    if affected == 0 {
        anyhow::bail!("workspace not found or already archived: {workspace_id}");
    }

    Ok(())
}

pub fn restore_workspace(db: &Database, workspace_id: &str) -> anyhow::Result<WorkspaceDto> {
    let conn = db.connect()?;
    let affected = conn
        .execute(
            "UPDATE workspaces
       SET archived_at = NULL,
           last_opened_at = datetime('now')
       WHERE id = ?1
         AND archived_at IS NOT NULL",
            params![workspace_id],
        )
        .context("failed to restore workspace")?;

    if affected == 0 {
        anyhow::bail!("workspace not found or not archived: {workspace_id}");
    }

    get_workspace_by_id(&conn, workspace_id)
}

pub fn find_workspace_by_id(
    db: &Database,
    workspace_id: &str,
) -> anyhow::Result<Option<WorkspaceDto>> {
    let conn = db.connect()?;
    get_workspace_by_id_optional(&conn, workspace_id)
}

pub fn get_workspace_startup_preset_json(
    db: &Database,
    workspace_id: &str,
) -> anyhow::Result<Option<String>> {
    let conn = db.connect()?;
    conn.query_row(
        "SELECT startup_preset_json
         FROM workspaces
         WHERE id = ?1",
        params![workspace_id],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .context("failed to load workspace startup preset")
    .map(|value| value.flatten())
}

pub fn set_workspace_startup_preset_json(
    db: &Database,
    workspace_id: &str,
    startup_preset_json: Option<&str>,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let affected = conn
        .execute(
            "UPDATE workspaces
             SET startup_preset_json = ?1,
                 startup_preset_updated_at = CASE
                     WHEN ?1 IS NULL THEN NULL
                     ELSE datetime('now')
                 END
             WHERE id = ?2",
            params![startup_preset_json, workspace_id],
        )
        .context("failed to persist workspace startup preset")?;

    if affected == 0 {
        anyhow::bail!("workspace not found: {workspace_id}");
    }

    Ok(())
}

pub fn is_git_repo_selection_configured(db: &Database, workspace_id: &str) -> anyhow::Result<bool> {
    let conn = db.connect()?;
    let configured = conn
        .query_row(
            "SELECT git_repo_selection_configured
         FROM workspaces
         WHERE id = ?1",
            params![workspace_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .context("failed to load workspace git selection state")?;

    Ok(configured.unwrap_or(0) > 0)
}

pub fn set_git_repo_selection_configured(
    db: &Database,
    workspace_id: &str,
    configured: bool,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let affected = conn
        .execute(
            "UPDATE workspaces
         SET git_repo_selection_configured = ?1
         WHERE id = ?2",
            params![if configured { 1 } else { 0 }, workspace_id],
        )
        .context("failed to update workspace git selection state")?;

    if affected == 0 {
        anyhow::bail!("workspace not found: {workspace_id}");
    }

    Ok(())
}

fn get_workspace_by_root(
    conn: &rusqlite::Connection,
    root_path: &str,
) -> anyhow::Result<WorkspaceDto> {
    conn.query_row(
        "SELECT id, name, root_path, scan_depth, created_at, last_opened_at
     FROM workspaces
     WHERE root_path = ?1",
        params![root_path],
        map_workspace_row,
    )
    .context("failed to load workspace by root")
}

fn get_workspace_by_id(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> anyhow::Result<WorkspaceDto> {
    get_workspace_by_id_optional(conn, workspace_id)?
        .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))
}

fn get_workspace_by_id_optional(
    conn: &rusqlite::Connection,
    workspace_id: &str,
) -> anyhow::Result<Option<WorkspaceDto>> {
    conn.query_row(
        "SELECT id, name, root_path, scan_depth, created_at, last_opened_at
     FROM workspaces
     WHERE id = ?1",
        params![workspace_id],
        map_workspace_row,
    )
    .optional()
    .context("failed to load workspace by id")
}

fn workspace_name_from_path(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "workspace".to_string())
}

fn map_workspace_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorkspaceDto> {
    Ok(WorkspaceDto {
        id: row.get(0)?,
        name: row.get(1)?,
        root_path: row.get(2)?,
        scan_depth: row.get(3)?,
        created_at: row.get(4)?,
        last_opened_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{Arc, Mutex},
    };

    use uuid::Uuid;

    use crate::db::{ConnectionPool, SQLITE_POOL_MAX_IDLE};

    use super::*;

    fn test_db() -> Database {
        let path = std::env::temp_dir().join(format!("panes-workspaces-{}.db", Uuid::new_v4()));
        let db = Database {
            path,
            pool: Arc::new(ConnectionPool {
                idle: Mutex::new(Vec::new()),
                max_idle: SQLITE_POOL_MAX_IDLE,
            }),
        };
        db.run_migrations().expect("failed to run test migrations");
        db
    }

    #[test]
    fn upsert_workspace_preserves_existing_scan_depth_when_none_is_provided() {
        let db = test_db();
        let root = std::env::temp_dir().join(format!("panes-workspace-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("failed to create temp workspace root");
        let root = root.to_string_lossy().to_string();

        let created = upsert_workspace(&db, &root, Some(7)).expect("failed to create workspace");
        let reopened =
            upsert_workspace(&db, &root, None).expect("failed to reopen workspace without depth");

        assert_eq!(created.id, reopened.id);
        assert_eq!(reopened.scan_depth, 7);
    }

    #[test]
    fn preferred_default_workspace_root_skips_transient_appimage_mounts() {
        let home = std::env::temp_dir().join(format!("panes-home-{}", Uuid::new_v4()));
        fs::create_dir_all(&home).expect("failed to create temp home");

        let cwd = std::path::Path::new("/tmp/.mount_PanesTest/usr");
        let selected =
            preferred_default_workspace_root_for(Some(cwd), Some(&home), None, false, None, None);

        assert_eq!(selected, home);
    }

    #[test]
    fn preferred_default_workspace_root_keeps_existing_directory_cwd() {
        let cwd = std::env::temp_dir().join(format!("panes-cwd-{}", Uuid::new_v4()));
        let home = std::env::temp_dir().join(format!("panes-home-{}", Uuid::new_v4()));
        fs::create_dir_all(&cwd).expect("failed to create temp cwd");
        fs::create_dir_all(&home).expect("failed to create temp home");

        let selected =
            preferred_default_workspace_root_for(Some(&cwd), Some(&home), None, false, None, None);

        assert_eq!(selected, cwd);
    }

    #[test]
    fn preferred_default_workspace_root_skips_current_executable_directory() {
        let cwd = std::env::temp_dir().join(format!("panes-install-{}", Uuid::new_v4()));
        let home = std::env::temp_dir().join(format!("panes-home-{}", Uuid::new_v4()));
        fs::create_dir_all(&cwd).expect("failed to create temp install root");
        fs::create_dir_all(&home).expect("failed to create temp home");

        let selected = preferred_default_workspace_root_for(
            Some(&cwd),
            Some(&home),
            Some(&cwd),
            false,
            None,
            None,
        );

        assert_eq!(selected, home);
    }

    #[test]
    fn preferred_default_workspace_root_skips_windows_system_dirs() {
        let windows_dir =
            std::env::temp_dir().join(format!("panes-windows-dir-{}", Uuid::new_v4()));
        let home = std::env::temp_dir().join(format!("panes-home-{}", Uuid::new_v4()));
        let cwd = windows_dir.join("System32");
        fs::create_dir_all(&cwd).expect("failed to create fake windows cwd");
        fs::create_dir_all(&home).expect("failed to create temp home");

        let selected = preferred_default_workspace_root_for(
            Some(&cwd),
            Some(&home),
            None,
            true,
            None,
            Some(&windows_dir),
        );

        assert_eq!(selected, home);
    }

    #[test]
    fn preferred_default_workspace_root_skips_windows_temp_dirs() {
        let temp_dir = std::env::temp_dir().join(format!("panes-temp-{}", Uuid::new_v4()));
        let home = std::env::temp_dir().join(format!("panes-home-{}", Uuid::new_v4()));
        let cwd = temp_dir.join("nsis");
        fs::create_dir_all(&cwd).expect("failed to create fake temp cwd");
        fs::create_dir_all(&home).expect("failed to create temp home");

        let selected = preferred_default_workspace_root_for(
            Some(&cwd),
            Some(&home),
            None,
            true,
            Some(&temp_dir),
            None,
        );

        assert_eq!(selected, home);
    }
}
