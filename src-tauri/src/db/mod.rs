use std::{
    fs,
    ops::{Deref, DerefMut},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::Context;
use rusqlite::Connection;

pub mod actions;
pub mod messages;
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
        let base_dir = dirs_home().join(".agent-workspace");
        fs::create_dir_all(base_dir.join("logs")).context("failed to create app data dir")?;

        let path = base_dir.join("workspaces.db");
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
        let conn = self.connect()?;
        conn.execute_batch(include_str!("migrations/001_initial.sql"))
            .context("failed to apply migrations")?;
        ensure_archived_columns(&conn)?;
        ensure_workspace_git_columns(&conn)?;
        ensure_runtime_columns(&conn)?;
        ensure_messages_audit_columns(&conn)?;
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

fn dirs_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}
