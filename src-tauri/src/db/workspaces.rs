use std::path::Path;

use anyhow::Context;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::models::WorkspaceDto;

use super::Database;

pub fn upsert_workspace(db: &Database, root_path: &str, scan_depth: i64) -> anyhow::Result<WorkspaceDto> {
  let mut conn = db.connect()?;
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
      "UPDATE workspaces SET last_opened_at = datetime('now') WHERE id = ?1",
      params![id],
    )
    .context("failed to update workspace last_opened_at")?;
  } else {
    let id = Uuid::new_v4().to_string();
    let name = workspace_name_from_path(&canonical);
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
     ORDER BY last_opened_at DESC",
  )?;

  let rows = stmt.query_map([], map_workspace_row)?;
  let mut out = Vec::new();

  for item in rows {
    out.push(item?);
  }

  Ok(out)
}

pub fn ensure_default_workspace(db: &Database) -> anyhow::Result<WorkspaceDto> {
  if let Some(first) = list_workspaces(db)?.into_iter().next() {
    return Ok(first);
  }

  let cwd = std::env::current_dir()
    .unwrap_or_else(|_| std::path::PathBuf::from("."))
    .to_string_lossy()
    .to_string();
  upsert_workspace(db, &cwd, 3)
}

fn get_workspace_by_root(conn: &rusqlite::Connection, root_path: &str) -> anyhow::Result<WorkspaceDto> {
  conn.query_row(
    "SELECT id, name, root_path, scan_depth, created_at, last_opened_at
     FROM workspaces
     WHERE root_path = ?1",
    params![root_path],
    map_workspace_row,
  )
  .context("failed to load workspace by root")
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
