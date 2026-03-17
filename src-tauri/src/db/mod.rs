use std::{
    collections::HashMap,
    fs,
    ops::{Deref, DerefMut},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::Context;
use rusqlite::{params, Connection, Transaction};

use crate::{path_utils, runtime_env};

pub mod actions;
pub mod messages;
pub mod remote;
pub mod repos;
pub mod threads;
pub mod workspaces;

const SQLITE_POOL_MAX_IDLE: usize = 8;

#[derive(Clone)]
pub struct Database {
    path: PathBuf,
    pool: Arc<ConnectionPool>,
}

struct ConnectionPool {
    idle: Mutex<Vec<Connection>>,
    max_idle: usize,
}

pub struct PooledConnection {
    conn: Option<Connection>,
    pool: Arc<ConnectionPool>,
}

impl Deref for PooledConnection {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        self.conn
            .as_ref()
            .expect("pooled sqlite connection missing inner value")
    }
}

impl DerefMut for PooledConnection {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.conn
            .as_mut()
            .expect("pooled sqlite connection missing inner value")
    }
}

impl Drop for PooledConnection {
    fn drop(&mut self) {
        let Some(conn) = self.conn.take() else {
            return;
        };

        let mut idle = match self.pool.idle.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };

        if idle.len() < self.pool.max_idle {
            idle.push(conn);
        }
    }
}

impl Database {
    pub fn init() -> anyhow::Result<Self> {
        runtime_env::migrate_legacy_app_data_dir()
            .context("failed to migrate legacy app data dir")?;
        let base_dir = runtime_env::app_data_dir();
        fs::create_dir_all(base_dir.join("logs")).context("failed to create app data dir")?;

        let path = base_dir.join("workspaces.db");
        Self::open(path)
    }

    pub fn open(path: PathBuf) -> anyhow::Result<Self> {
        let db = Self {
            path,
            pool: Arc::new(ConnectionPool {
                idle: Mutex::new(Vec::new()),
                max_idle: SQLITE_POOL_MAX_IDLE,
            }),
        };
        db.run_migrations()?;

        Ok(db)
    }

    pub fn connect(&self) -> anyhow::Result<PooledConnection> {
        if let Some(conn) = self.take_idle_connection() {
            return Ok(PooledConnection {
                conn: Some(conn),
                pool: self.pool.clone(),
            });
        }

        let conn = Connection::open(&self.path).context("failed to open sqlite database")?;
        configure_connection(&conn)?;
        Ok(PooledConnection {
            conn: Some(conn),
            pool: self.pool.clone(),
        })
    }

    fn take_idle_connection(&self) -> Option<Connection> {
        let mut idle = match self.pool.idle.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        idle.pop()
    }

    fn run_migrations(&self) -> anyhow::Result<()> {
        let mut conn = self.connect()?;
        conn.execute_batch(include_str!("migrations/001_initial.sql"))
            .context("failed to apply migrations")?;
        ensure_archived_columns(&conn)?;
        ensure_workspace_git_columns(&conn)?;
        ensure_repo_columns(&conn)?;
        ensure_workspace_startup_columns(&conn)?;
        ensure_runtime_columns(&conn)?;
        ensure_messages_audit_columns(&conn)?;
        ensure_remote_session_tables(&conn)?;
        repair_normalized_workspace_and_repo_paths(&mut conn)?;
        Ok(())
    }
}

fn configure_connection(conn: &Connection) -> anyhow::Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")
        .context("failed to enable sqlite foreign keys")?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .context("failed to enable sqlite WAL mode")?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .context("failed to set sqlite synchronous mode")?;
    conn.pragma_update(None, "temp_store", "MEMORY")
        .context("failed to set sqlite temp_store mode")?;
    conn.busy_timeout(Duration::from_millis(5_000))
        .context("failed to set sqlite busy timeout")?;
    Ok(())
}

fn ensure_archived_columns(conn: &Connection) -> anyhow::Result<()> {
    ensure_column(conn, "workspaces", "archived_at", "TEXT")?;
    ensure_column(conn, "threads", "archived_at", "TEXT")?;
    Ok(())
}

fn ensure_workspace_git_columns(conn: &Connection) -> anyhow::Result<()> {
    ensure_column(
        conn,
        "workspaces",
        "git_repo_selection_configured",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    Ok(())
}

fn ensure_repo_columns(conn: &Connection) -> anyhow::Result<()> {
    ensure_column(conn, "repos", "is_discovered", "INTEGER NOT NULL DEFAULT 1")?;
    Ok(())
}

fn ensure_workspace_startup_columns(conn: &Connection) -> anyhow::Result<()> {
    ensure_column(conn, "workspaces", "startup_preset_json", "TEXT")?;
    ensure_column(conn, "workspaces", "startup_preset_updated_at", "TEXT")?;
    Ok(())
}

fn ensure_runtime_columns(conn: &Connection) -> anyhow::Result<()> {
    ensure_column(conn, "threads", "engine_capabilities_json", "TEXT")?;
    ensure_column(conn, "messages", "stream_seq", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "actions", "truncated", "INTEGER NOT NULL DEFAULT 0")?;
    Ok(())
}

fn ensure_messages_audit_columns(conn: &Connection) -> anyhow::Result<()> {
    let mut has_turn_engine_id = false;
    let mut has_turn_model_id = false;
    let mut has_turn_reasoning_effort = false;

    let mut stmt = conn
        .prepare("PRAGMA table_info(messages)")
        .context("failed to inspect messages table schema")?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .context("failed to read messages table columns")?;

    for row in rows {
        let column_name = row.context("failed to decode messages table column")?;
        if column_name == "turn_engine_id" {
            has_turn_engine_id = true;
        } else if column_name == "turn_model_id" {
            has_turn_model_id = true;
        } else if column_name == "turn_reasoning_effort" {
            has_turn_reasoning_effort = true;
        }
    }

    if !has_turn_engine_id {
        conn.execute("ALTER TABLE messages ADD COLUMN turn_engine_id TEXT", [])
            .context("failed to add messages.turn_engine_id column")?;
    }
    if !has_turn_model_id {
        conn.execute("ALTER TABLE messages ADD COLUMN turn_model_id TEXT", [])
            .context("failed to add messages.turn_model_id column")?;
    }
    if !has_turn_reasoning_effort {
        conn.execute(
            "ALTER TABLE messages ADD COLUMN turn_reasoning_effort TEXT",
            [],
        )
        .context("failed to add messages.turn_reasoning_effort column")?;
    }

    Ok(())
}

fn ensure_remote_session_tables(conn: &Connection) -> anyhow::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS remote_device_grants (
            id TEXT PRIMARY KEY,
            token_hash TEXT NOT NULL,
            label TEXT NOT NULL,
            scopes_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at TEXT,
            revoked_at TEXT,
            last_used_at TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_device_grants_token_hash
            ON remote_device_grants(token_hash);

        CREATE TABLE IF NOT EXISTS remote_controller_leases (
            id TEXT PRIMARY KEY,
            scope_type TEXT NOT NULL,
            scope_id TEXT NOT NULL,
            device_grant_id TEXT NOT NULL,
            acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at TEXT NOT NULL,
            released_at TEXT,
            FOREIGN KEY(device_grant_id) REFERENCES remote_device_grants(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_remote_controller_leases_scope
            ON remote_controller_leases(scope_type, scope_id);
        CREATE INDEX IF NOT EXISTS idx_remote_controller_leases_device_grant
            ON remote_controller_leases(device_grant_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_remote_controller_leases_active_scope
            ON remote_controller_leases(scope_type, scope_id)
            WHERE released_at IS NULL;

        CREATE TABLE IF NOT EXISTS remote_audit_events (
            id TEXT PRIMARY KEY,
            device_grant_id TEXT,
            action_type TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT,
            payload_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY(device_grant_id) REFERENCES remote_device_grants(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_remote_audit_events_device_grant
            ON remote_audit_events(device_grant_id);
        CREATE INDEX IF NOT EXISTS idx_remote_audit_events_created_at
            ON remote_audit_events(created_at);
        "#,
    )
    .context("failed to ensure remote session tables")?;

    Ok(())
}

#[derive(Clone)]
struct WorkspacePathRow {
    id: String,
    name: String,
    root_path: String,
    scan_depth: i64,
    startup_preset_json: Option<String>,
    startup_preset_updated_at: Option<String>,
    archived_at: Option<String>,
    created_at: String,
    last_opened_at: String,
    git_repo_selection_configured: bool,
}

#[derive(Clone)]
struct RepoPathRow {
    id: String,
    workspace_id: String,
    name: String,
    path: String,
    default_branch: String,
    is_active: bool,
    is_discovered: bool,
    trust_level: String,
}

fn repair_normalized_workspace_and_repo_paths(conn: &mut Connection) -> anyhow::Result<()> {
    let tx = conn
        .transaction()
        .context("failed to start path normalization transaction")?;
    merge_duplicate_workspaces(&tx)?;
    merge_duplicate_repos(&tx)?;
    tx.commit()
        .context("failed to commit path normalization transaction")?;
    Ok(())
}

fn merge_duplicate_workspaces(tx: &Transaction<'_>) -> anyhow::Result<()> {
    let workspaces = load_workspace_rows(tx)?;
    let mut groups = HashMap::<String, Vec<WorkspacePathRow>>::new();
    for workspace in workspaces {
        groups
            .entry(path_utils::normalize_windows_path_string(
                &workspace.root_path,
            ))
            .or_default()
            .push(workspace);
    }

    for (normalized_root, group) in groups {
        if group.is_empty() {
            continue;
        }

        let canonical = choose_canonical_workspace(&group, &normalized_root).clone();
        for duplicate in group
            .iter()
            .filter(|workspace| workspace.id != canonical.id)
        {
            move_workspace_references(tx, duplicate, &canonical.id)?;
        }

        let merged = merge_workspace_metadata(&group, canonical.clone(), &normalized_root);
        update_workspace_row(tx, &merged)?;
    }

    Ok(())
}

fn merge_duplicate_repos(tx: &Transaction<'_>) -> anyhow::Result<()> {
    let repos = load_repo_rows(tx)?;
    let mut groups = HashMap::<(String, String), Vec<RepoPathRow>>::new();
    for repo in repos {
        groups
            .entry((
                repo.workspace_id.clone(),
                path_utils::normalize_windows_path_string(&repo.path),
            ))
            .or_default()
            .push(repo);
    }

    for ((_, normalized_path), group) in groups {
        if group.is_empty() {
            continue;
        }

        let canonical = choose_canonical_repo(&group, &normalized_path).clone();
        for duplicate in group.iter().filter(|repo| repo.id != canonical.id) {
            tx.execute(
                "UPDATE threads SET repo_id = ?1 WHERE repo_id = ?2",
                params![canonical.id, duplicate.id],
            )
            .context("failed to remap duplicate repo threads")?;
            tx.execute("DELETE FROM repos WHERE id = ?1", params![duplicate.id])
                .context("failed to delete duplicate repo row")?;
        }

        let merged = merge_repo_metadata(&group, canonical.clone(), &normalized_path);
        update_repo_row(tx, &merged)?;
    }

    Ok(())
}

fn move_workspace_references(
    tx: &Transaction<'_>,
    duplicate: &WorkspacePathRow,
    canonical_workspace_id: &str,
) -> anyhow::Result<()> {
    let duplicate_repos = load_repo_rows_for_workspace(tx, &duplicate.id)?;
    let canonical_repos = load_repo_rows_for_workspace(tx, canonical_workspace_id)?;
    let mut canonical_repos_by_path = canonical_repos
        .iter()
        .map(|repo| {
            (
                path_utils::normalize_windows_path_string(&repo.path),
                repo.clone(),
            )
        })
        .collect::<HashMap<_, _>>();

    for duplicate_repo in duplicate_repos {
        let normalized_path = path_utils::normalize_windows_path_string(&duplicate_repo.path);
        if let Some(canonical_repo) = canonical_repos_by_path.get_mut(&normalized_path) {
            let merged = merge_repo_metadata(
                &[canonical_repo.clone(), duplicate_repo.clone()],
                canonical_repo.clone(),
                &normalized_path,
            );
            update_repo_row(tx, &merged)?;
            *canonical_repo = merged.clone();
            tx.execute(
                "UPDATE threads SET repo_id = ?1 WHERE repo_id = ?2",
                params![canonical_repo.id, duplicate_repo.id],
            )
            .context("failed to remap duplicate workspace repo threads")?;
            tx.execute(
                "DELETE FROM repos WHERE id = ?1",
                params![duplicate_repo.id],
            )
            .context("failed to delete duplicate workspace repo row")?;
        } else {
            tx.execute(
                "UPDATE repos
                 SET workspace_id = ?1,
                     path = ?2
                 WHERE id = ?3",
                params![canonical_workspace_id, normalized_path, duplicate_repo.id],
            )
            .context("failed to move repo into canonical workspace")?;
            canonical_repos_by_path.insert(
                normalized_path.clone(),
                RepoPathRow {
                    workspace_id: canonical_workspace_id.to_string(),
                    path: normalized_path,
                    ..duplicate_repo
                },
            );
        }
    }

    tx.execute(
        "UPDATE threads SET workspace_id = ?1 WHERE workspace_id = ?2",
        params![canonical_workspace_id, duplicate.id],
    )
    .context("failed to remap duplicate workspace threads")?;
    tx.execute(
        "DELETE FROM workspaces WHERE id = ?1",
        params![duplicate.id],
    )
    .context("failed to delete duplicate workspace row")?;
    Ok(())
}

fn update_workspace_row(tx: &Transaction<'_>, workspace: &WorkspacePathRow) -> anyhow::Result<()> {
    tx.execute(
        "UPDATE workspaces
         SET name = ?1,
             root_path = ?2,
             scan_depth = ?3,
             startup_preset_json = ?4,
             startup_preset_updated_at = ?5,
             archived_at = ?6,
             created_at = ?7,
             last_opened_at = ?8,
             git_repo_selection_configured = ?9
         WHERE id = ?10",
        params![
            workspace.name,
            workspace.root_path,
            workspace.scan_depth,
            workspace.startup_preset_json,
            workspace.startup_preset_updated_at,
            workspace.archived_at,
            workspace.created_at,
            workspace.last_opened_at,
            if workspace.git_repo_selection_configured {
                1
            } else {
                0
            },
            workspace.id,
        ],
    )
    .context("failed to update canonical workspace row")?;
    Ok(())
}

fn update_repo_row(tx: &Transaction<'_>, repo: &RepoPathRow) -> anyhow::Result<()> {
    tx.execute(
        "UPDATE repos
         SET workspace_id = ?1,
             name = ?2,
             path = ?3,
             default_branch = ?4,
             is_active = ?5,
             is_discovered = ?6,
             trust_level = ?7
         WHERE id = ?8",
        params![
            repo.workspace_id,
            repo.name,
            repo.path,
            repo.default_branch,
            if repo.is_active { 1 } else { 0 },
            if repo.is_discovered { 1 } else { 0 },
            repo.trust_level,
            repo.id,
        ],
    )
    .context("failed to update canonical repo row")?;
    Ok(())
}

fn load_workspace_rows(conn: &Connection) -> anyhow::Result<Vec<WorkspacePathRow>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, root_path, scan_depth, startup_preset_json,
                    startup_preset_updated_at, archived_at, created_at, last_opened_at,
                    git_repo_selection_configured
             FROM workspaces",
        )
        .context("failed to prepare workspace path repair query")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(WorkspacePathRow {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                scan_depth: row.get(3)?,
                startup_preset_json: row.get(4)?,
                startup_preset_updated_at: row.get(5)?,
                archived_at: row.get(6)?,
                created_at: row.get(7)?,
                last_opened_at: row.get(8)?,
                git_repo_selection_configured: row.get::<_, i64>(9)? > 0,
            })
        })
        .context("failed to query workspace rows for path repair")?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.context("failed to decode workspace row for path repair")?);
    }
    Ok(out)
}

fn load_repo_rows(conn: &Connection) -> anyhow::Result<Vec<RepoPathRow>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, name, path, default_branch, is_active, is_discovered, trust_level
             FROM repos",
        )
        .context("failed to prepare repo path repair query")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RepoPathRow {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                name: row.get(2)?,
                path: row.get(3)?,
                default_branch: row.get(4)?,
                is_active: row.get::<_, i64>(5)? > 0,
                is_discovered: row.get::<_, i64>(6)? > 0,
                trust_level: row.get(7)?,
            })
        })
        .context("failed to query repo rows for path repair")?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.context("failed to decode repo row for path repair")?);
    }
    Ok(out)
}

fn load_repo_rows_for_workspace(
    conn: &Connection,
    workspace_id: &str,
) -> anyhow::Result<Vec<RepoPathRow>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, workspace_id, name, path, default_branch, is_active, is_discovered, trust_level
             FROM repos
             WHERE workspace_id = ?1",
        )
        .context("failed to prepare workspace repo path repair query")?;
    let rows = stmt
        .query_map(params![workspace_id], |row| {
            Ok(RepoPathRow {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                name: row.get(2)?,
                path: row.get(3)?,
                default_branch: row.get(4)?,
                is_active: row.get::<_, i64>(5)? > 0,
                is_discovered: row.get::<_, i64>(6)? > 0,
                trust_level: row.get(7)?,
            })
        })
        .context("failed to query workspace repo rows for path repair")?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row.context("failed to decode workspace repo row for path repair")?);
    }
    Ok(out)
}

fn choose_canonical_workspace<'a>(
    group: &'a [WorkspacePathRow],
    normalized_root: &str,
) -> &'a WorkspacePathRow {
    group
        .iter()
        .min_by(|left, right| {
            workspace_sort_key(left, normalized_root)
                .cmp(&workspace_sort_key(right, normalized_root))
        })
        .expect("workspace group should not be empty")
}

fn workspace_sort_key(
    workspace: &WorkspacePathRow,
    normalized_root: &str,
) -> (u8, u8, String, String, String) {
    (
        if workspace.archived_at.is_none() {
            0
        } else {
            1
        },
        if workspace.root_path == normalized_root {
            0
        } else {
            1
        },
        invert_timestamp(&workspace.last_opened_at),
        workspace.created_at.clone(),
        workspace.id.clone(),
    )
}

fn merge_workspace_metadata(
    group: &[WorkspacePathRow],
    canonical: WorkspacePathRow,
    normalized_root: &str,
) -> WorkspacePathRow {
    let startup = group
        .iter()
        .filter_map(|workspace| {
            workspace
                .startup_preset_json
                .as_ref()
                .map(|json| (workspace.startup_preset_updated_at.clone(), json.clone()))
        })
        .max_by(|left, right| left.0.cmp(&right.0));

    WorkspacePathRow {
        root_path: normalized_root.to_string(),
        scan_depth: group
            .iter()
            .map(|workspace| workspace.scan_depth)
            .max()
            .unwrap_or(canonical.scan_depth),
        startup_preset_json: startup
            .as_ref()
            .map(|(_, json)| json.clone())
            .or(canonical.startup_preset_json.clone()),
        startup_preset_updated_at: startup
            .as_ref()
            .and_then(|(updated_at, _)| updated_at.clone())
            .or(canonical.startup_preset_updated_at.clone()),
        archived_at: if group
            .iter()
            .any(|workspace| workspace.archived_at.is_none())
        {
            None
        } else {
            group
                .iter()
                .filter_map(|workspace| workspace.archived_at.clone())
                .max()
        },
        created_at: group
            .iter()
            .map(|workspace| workspace.created_at.clone())
            .min()
            .unwrap_or(canonical.created_at.clone()),
        last_opened_at: group
            .iter()
            .map(|workspace| workspace.last_opened_at.clone())
            .max()
            .unwrap_or(canonical.last_opened_at.clone()),
        git_repo_selection_configured: group
            .iter()
            .any(|workspace| workspace.git_repo_selection_configured),
        ..canonical
    }
}

fn choose_canonical_repo<'a>(group: &'a [RepoPathRow], normalized_path: &str) -> &'a RepoPathRow {
    group
        .iter()
        .min_by(|left, right| {
            repo_sort_key(left, normalized_path).cmp(&repo_sort_key(right, normalized_path))
        })
        .expect("repo group should not be empty")
}

fn repo_sort_key(repo: &RepoPathRow, normalized_path: &str) -> (u8, u8, u8, String) {
    (
        if repo.is_active { 0 } else { 1 },
        if repo.is_discovered { 0 } else { 1 },
        if repo.path == normalized_path { 0 } else { 1 },
        repo.id.clone(),
    )
}

fn merge_repo_metadata(
    group: &[RepoPathRow],
    canonical: RepoPathRow,
    normalized_path: &str,
) -> RepoPathRow {
    RepoPathRow {
        path: normalized_path.to_string(),
        is_active: group.iter().any(|repo| repo.is_active),
        is_discovered: group.iter().any(|repo| repo.is_discovered),
        trust_level: group
            .iter()
            .map(|repo| repo.trust_level.clone())
            .max_by_key(|trust| trust_level_rank(trust))
            .unwrap_or(canonical.trust_level.clone()),
        ..canonical
    }
}

fn trust_level_rank(value: &str) -> u8 {
    match value {
        "restricted" => 2,
        "standard" => 1,
        _ => 0,
    }
}

fn invert_timestamp(value: &str) -> String {
    value
        .bytes()
        .map(|byte| char::from(255_u8.saturating_sub(byte)))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::OptionalExtension;
    use std::sync::{Arc, Mutex};
    use uuid::Uuid;

    fn test_db() -> Database {
        let path = std::env::temp_dir().join(format!("panes-db-mod-{}.db", Uuid::new_v4()));
        let db = Database {
            path,
            pool: Arc::new(ConnectionPool {
                idle: Mutex::new(Vec::new()),
                max_idle: SQLITE_POOL_MAX_IDLE,
            }),
        };
        db.run_migrations().expect("failed to initialize test db");
        db
    }

    #[test]
    fn path_repair_merges_duplicate_workspaces_and_repos() {
        let db = test_db();
        let active_workspace_id = "ws-active";
        let archived_workspace_id = "ws-archived";
        let active_repo_id = "repo-active";
        let archived_repo_id = "repo-archived";
        let thread_id = "thread-1";

        let conn = Connection::open(&db.path).expect("failed to open raw sqlite db");
        conn.execute(
            "INSERT INTO workspaces (
                id, name, root_path, scan_depth, startup_preset_json, startup_preset_updated_at,
                archived_at, created_at, last_opened_at, git_repo_selection_configured
             ) VALUES (?1, 'repo', ?2, 3, NULL, NULL, NULL, '2024-01-01 00:00:00',
                       '2024-01-02 00:00:00', 0)",
            params![active_workspace_id, r"\\?\C:\Users\panes\repo"],
        )
        .expect("failed to insert active workspace");
        conn.execute(
            "INSERT INTO workspaces (
                id, name, root_path, scan_depth, startup_preset_json, startup_preset_updated_at,
                archived_at, created_at, last_opened_at, git_repo_selection_configured
             ) VALUES (?1, 'repo', ?2, 7, '{\"layout\":\"split\"}', '2024-02-01 00:00:00',
                       '2024-02-02 00:00:00', '2024-01-01 00:00:00', '2024-02-03 00:00:00', 1)",
            params![archived_workspace_id, r"C:\Users\panes\repo"],
        )
        .expect("failed to insert archived workspace");
        conn.execute(
            "INSERT INTO repos (
                id, workspace_id, name, path, default_branch, is_active, is_discovered, trust_level
             ) VALUES (?1, ?2, 'repo', ?3, 'main', 0, 1, 'standard')",
            params![
                active_repo_id,
                active_workspace_id,
                r"\\?\C:\Users\panes\repo\app"
            ],
        )
        .expect("failed to insert active workspace repo");
        conn.execute(
            "INSERT INTO repos (
                id, workspace_id, name, path, default_branch, is_active, is_discovered, trust_level
             ) VALUES (?1, ?2, 'repo', ?3, 'main', 1, 1, 'restricted')",
            params![
                archived_repo_id,
                archived_workspace_id,
                r"C:\Users\panes\repo\app"
            ],
        )
        .expect("failed to insert archived workspace repo");
        conn.execute(
            "INSERT INTO threads (
                id, workspace_id, repo_id, engine_id, model_id, title, status,
                created_at, last_activity_at
             ) VALUES (?1, ?2, ?3, 'codex', 'gpt-5', 'thread', 'idle',
                       '2024-02-03 00:00:00', '2024-02-03 00:00:00')",
            params![thread_id, archived_workspace_id, archived_repo_id],
        )
        .expect("failed to insert thread");
        drop(conn);

        db.run_migrations()
            .expect("failed to rerun migrations with duplicate windows paths");

        let workspaces = workspaces::list_workspaces(&db).expect("failed to reload workspaces");
        assert_eq!(workspaces.len(), 1);
        assert_eq!(workspaces[0].id, active_workspace_id);
        assert_eq!(workspaces[0].root_path, r"C:\Users\panes\repo");
        assert_eq!(workspaces[0].scan_depth, 7);

        let startup_preset =
            workspaces::get_workspace_startup_preset_json(&db, active_workspace_id)
                .expect("failed to load migrated startup preset");
        assert_eq!(startup_preset.as_deref(), Some(r#"{"layout":"split"}"#));
        assert!(workspaces::find_workspace_by_id(&db, archived_workspace_id)
            .expect("failed to check archived workspace removal")
            .is_none());

        let repos = repos::get_repos(&db, active_workspace_id).expect("failed to reload repos");
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].path, r"C:\Users\panes\repo\app");
        assert_eq!(repos[0].trust_level.as_str(), "restricted");
        let thread = threads::get_thread(&db, thread_id)
            .expect("failed to reload migrated thread")
            .expect("thread should still exist");
        assert_eq!(thread.workspace_id, active_workspace_id);
        assert_eq!(thread.repo_id.as_deref(), Some(repos[0].id.as_str()));
    }

    #[test]
    fn path_repair_merges_duplicate_repos_inside_one_workspace() {
        let db = test_db();
        let workspace_id = "ws-1";
        let normalized_repo_id = "repo-normalized";
        let legacy_repo_id = "repo-legacy";
        let thread_id = "thread-2";

        let conn = Connection::open(&db.path).expect("failed to open raw sqlite db");
        conn.execute(
            "INSERT INTO workspaces (
                id, name, root_path, scan_depth, created_at, last_opened_at,
                git_repo_selection_configured
             ) VALUES (?1, 'repo', ?2, 3, '2024-01-01 00:00:00', '2024-01-01 00:00:00', 0)",
            params![workspace_id, r"C:\Users\panes\repo"],
        )
        .expect("failed to insert workspace");
        conn.execute(
            "INSERT INTO repos (
                id, workspace_id, name, path, default_branch, is_active, is_discovered, trust_level
             ) VALUES (?1, ?2, 'repo', ?3, 'main', 1, 1, 'standard')",
            params![normalized_repo_id, workspace_id, r"C:\Users\panes\repo\app"],
        )
        .expect("failed to insert normalized repo");
        conn.execute(
            "INSERT INTO repos (
                id, workspace_id, name, path, default_branch, is_active, is_discovered, trust_level
             ) VALUES (?1, ?2, 'repo', ?3, 'main', 0, 1, 'restricted')",
            params![legacy_repo_id, workspace_id, r"\\?\C:\Users\panes\repo\app"],
        )
        .expect("failed to insert legacy repo");
        conn.execute(
            "INSERT INTO threads (
                id, workspace_id, repo_id, engine_id, model_id, title, status,
                created_at, last_activity_at
             ) VALUES (?1, ?2, ?3, 'codex', 'gpt-5', 'thread', 'idle',
                       '2024-01-01 00:00:00', '2024-01-01 00:00:00')",
            params![thread_id, workspace_id, legacy_repo_id],
        )
        .expect("failed to insert thread");
        drop(conn);

        db.run_migrations()
            .expect("failed to rerun migrations for duplicate repo paths");

        let repos = repos::get_repos(&db, workspace_id).expect("failed to reload repos");
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].id, normalized_repo_id);
        assert_eq!(repos[0].path, r"C:\Users\panes\repo\app");
        assert_eq!(repos[0].trust_level.as_str(), "restricted");
        let thread = threads::get_thread(&db, thread_id)
            .expect("failed to reload migrated thread")
            .expect("thread should still exist");
        assert_eq!(thread.repo_id.as_deref(), Some(normalized_repo_id));
    }

    #[test]
    fn path_repair_merges_multiple_duplicate_repos_when_moving_workspaces() {
        let db = test_db();
        let canonical_workspace_id = "ws-canonical";
        let duplicate_workspace_id = "ws-duplicate";
        let first_repo_id = "repo-first";
        let second_repo_id = "repo-second";
        let thread_id = "thread-3";

        let conn = Connection::open(&db.path).expect("failed to open raw sqlite db");
        conn.execute(
            "INSERT INTO workspaces (
                id, name, root_path, scan_depth, created_at, last_opened_at,
                git_repo_selection_configured
             ) VALUES (?1, 'repo', ?2, 3, '2024-01-01 00:00:00', '2024-01-02 00:00:00', 0)",
            params![canonical_workspace_id, r"C:\Users\panes\repo"],
        )
        .expect("failed to insert canonical workspace");
        conn.execute(
            "INSERT INTO workspaces (
                id, name, root_path, scan_depth, created_at, last_opened_at,
                git_repo_selection_configured
             ) VALUES (?1, 'repo', ?2, 3, '2024-01-01 00:00:00', '2024-01-03 00:00:00', 0)",
            params![duplicate_workspace_id, r"\\?\C:\Users\panes\repo"],
        )
        .expect("failed to insert duplicate workspace");
        conn.execute(
            "INSERT INTO repos (
                id, workspace_id, name, path, default_branch, is_active, is_discovered, trust_level
             ) VALUES (?1, ?2, 'repo', ?3, 'main', 0, 1, 'standard')",
            params![
                first_repo_id,
                duplicate_workspace_id,
                r"\\?\C:\Users\panes\repo\app"
            ],
        )
        .expect("failed to insert first duplicate repo");
        conn.execute(
            "INSERT INTO repos (
                id, workspace_id, name, path, default_branch, is_active, is_discovered, trust_level
             ) VALUES (?1, ?2, 'repo', ?3, 'main', 1, 1, 'restricted')",
            params![
                second_repo_id,
                duplicate_workspace_id,
                r"C:\Users\panes\repo\app"
            ],
        )
        .expect("failed to insert second duplicate repo");
        conn.execute(
            "INSERT INTO threads (
                id, workspace_id, repo_id, engine_id, model_id, title, status,
                created_at, last_activity_at
             ) VALUES (?1, ?2, ?3, 'codex', 'gpt-5', 'thread', 'idle',
                       '2024-01-03 00:00:00', '2024-01-03 00:00:00')",
            params![thread_id, duplicate_workspace_id, second_repo_id],
        )
        .expect("failed to insert thread");
        drop(conn);

        db.run_migrations()
            .expect("failed to rerun migrations for duplicate workspace repos");

        let repos = repos::get_repos(&db, canonical_workspace_id).expect("failed to reload repos");
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].path, r"C:\Users\panes\repo\app");
        assert_eq!(repos[0].trust_level.as_str(), "restricted");
        assert!(repos[0].is_active);
        let thread = threads::get_thread(&db, thread_id)
            .expect("failed to reload migrated thread")
            .expect("thread should still exist");
        assert_eq!(thread.workspace_id, canonical_workspace_id);
        assert_eq!(thread.repo_id.as_deref(), Some(repos[0].id.as_str()));
    }

    #[test]
    fn path_repair_merges_repo_metadata_cumulatively_across_workspace_duplicates() {
        let db = test_db();
        let canonical_workspace_id = "ws-canonical-2";
        let duplicate_workspace_id = "ws-duplicate-2";
        let canonical_repo_id = "repo-canonical";
        let first_duplicate_repo_id = "repo-dup-1";
        let second_duplicate_repo_id = "repo-dup-2";

        let conn = Connection::open(&db.path).expect("failed to open raw sqlite db");
        conn.execute(
            "INSERT INTO workspaces (
                id, name, root_path, scan_depth, created_at, last_opened_at,
                git_repo_selection_configured
             ) VALUES (?1, 'repo', ?2, 3, '2024-01-01 00:00:00', '2024-01-02 00:00:00', 0)",
            params![canonical_workspace_id, r"C:\Users\panes\repo"],
        )
        .expect("failed to insert canonical workspace");
        conn.execute(
            "INSERT INTO workspaces (
                id, name, root_path, scan_depth, created_at, last_opened_at,
                git_repo_selection_configured
             ) VALUES (?1, 'repo', ?2, 3, '2024-01-01 00:00:00', '2024-01-03 00:00:00', 0)",
            params![duplicate_workspace_id, r"\\?\C:\Users\panes\repo"],
        )
        .expect("failed to insert duplicate workspace");
        conn.execute(
            "INSERT INTO repos (
                id, workspace_id, name, path, default_branch, is_active, is_discovered, trust_level
             ) VALUES (?1, ?2, 'repo', ?3, 'main', 0, 1, 'standard')",
            params![
                canonical_repo_id,
                canonical_workspace_id,
                r"C:\Users\panes\repo\app"
            ],
        )
        .expect("failed to insert canonical repo");
        conn.execute(
            "INSERT INTO repos (
                id, workspace_id, name, path, default_branch, is_active, is_discovered, trust_level
             ) VALUES (?1, ?2, 'repo', ?3, 'main', 1, 1, 'standard')",
            params![
                first_duplicate_repo_id,
                duplicate_workspace_id,
                r"\\?\C:\Users\panes\repo\app"
            ],
        )
        .expect("failed to insert first duplicate repo");
        conn.execute(
            "INSERT INTO repos (
                id, workspace_id, name, path, default_branch, is_active, is_discovered, trust_level
             ) VALUES (?1, ?2, 'repo', ?3, 'main', 0, 1, 'restricted')",
            params![
                second_duplicate_repo_id,
                duplicate_workspace_id,
                r"C:\Users\panes\repo\app"
            ],
        )
        .expect("failed to insert second duplicate repo");
        drop(conn);

        db.run_migrations()
            .expect("failed to rerun migrations for cumulative repo merge");

        let repos = repos::get_repos(&db, canonical_workspace_id).expect("failed to reload repos");
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0].id, canonical_repo_id);
        assert_eq!(repos[0].path, r"C:\Users\panes\repo\app");
        assert_eq!(repos[0].trust_level.as_str(), "restricted");
        assert!(repos[0].is_active);
    }

    #[test]
    fn creates_remote_session_tables() {
        let db = test_db();
        let conn = Connection::open(&db.path).expect("failed to open raw sqlite db");

        for table in [
            "remote_device_grants",
            "remote_controller_leases",
            "remote_audit_events",
        ] {
            let exists: Option<String> = conn
                .query_row(
                    "SELECT name
                     FROM sqlite_master
                     WHERE type = 'table'
                       AND name = ?1",
                    params![table],
                    |row| row.get(0),
                )
                .optional()
                .expect("failed to inspect sqlite_master");
            assert_eq!(exists.as_deref(), Some(table));
        }

        let active_scope_index: Option<String> = conn
            .query_row(
                "SELECT name
                 FROM sqlite_master
                 WHERE type = 'index'
                   AND name = 'idx_remote_controller_leases_active_scope'",
                [],
                |row| row.get(0),
            )
            .optional()
            .expect("failed to inspect sqlite_master indexes");
        assert_eq!(
            active_scope_index.as_deref(),
            Some("idx_remote_controller_leases_active_scope")
        );
    }
}

fn ensure_column(
    conn: &Connection,
    table: &str,
    column: &str,
    sql_type: &str,
) -> anyhow::Result<()> {
    if table_has_column(conn, table, column)? {
        return Ok(());
    }

    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {sql_type}"),
        [],
    )
    .with_context(|| format!("failed to add {table}.{column} column"))?;

    Ok(())
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> anyhow::Result<bool> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .with_context(|| format!("failed to inspect {table} table schema"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .with_context(|| format!("failed to read {table} table columns"))?;

    for row in rows {
        if row.with_context(|| format!("failed to decode {table} table column"))? == column {
            return Ok(true);
        }
    }

    Ok(false)
}
