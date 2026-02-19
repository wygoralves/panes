use anyhow::Context;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::models::{RepoDto, TrustLevelDto};

use super::Database;

pub fn upsert_repo(
  db: &Database,
  workspace_id: &str,
  name: &str,
  path: &str,
  default_branch: &str,
) -> anyhow::Result<RepoDto> {
  let mut conn = db.connect()?;

  let existing = conn
    .query_row(
      "SELECT id FROM repos WHERE workspace_id = ?1 AND path = ?2",
      params![workspace_id, path],
      |row| row.get::<_, String>(0),
    )
    .optional()
    .context("failed to query repo")?;

  match existing {
    Some(id) => {
      conn.execute(
        "UPDATE repos
         SET name = ?1, default_branch = ?2, is_active = 1
         WHERE id = ?3",
        params![name, default_branch, id],
      )
      .context("failed to update repo")?;
    }
    None => {
      conn.execute(
        "INSERT INTO repos (id, workspace_id, name, path, default_branch, is_active, trust_level)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, 'standard')",
        params![Uuid::new_v4().to_string(), workspace_id, name, path, default_branch],
      )
      .context("failed to insert repo")?;
    }
  }

  let conn = db.connect()?;
  conn.query_row(
    "SELECT id, workspace_id, name, path, default_branch, is_active, trust_level
     FROM repos
     WHERE workspace_id = ?1 AND path = ?2",
    params![workspace_id, path],
    map_repo_row,
  )
  .context("failed to fetch upserted repo")
}

pub fn get_repos(db: &Database, workspace_id: &str) -> anyhow::Result<Vec<RepoDto>> {
  let conn = db.connect()?;
  let mut stmt = conn.prepare(
    "SELECT id, workspace_id, name, path, default_branch, is_active, trust_level
     FROM repos
     WHERE workspace_id = ?1
     ORDER BY name ASC",
  )?;

  let rows = stmt.query_map(params![workspace_id], map_repo_row)?;
  let mut repos = Vec::new();

  for row in rows {
    repos.push(row?);
  }

  Ok(repos)
}

pub fn set_repo_trust_level(
  db: &Database,
  repo_id: &str,
  trust_level: TrustLevelDto,
) -> anyhow::Result<()> {
  let conn = db.connect()?;
  conn.execute(
    "UPDATE repos SET trust_level = ?1 WHERE id = ?2",
    params![trust_level.as_str(), repo_id],
  )
  .context("failed to update repo trust level")?;
  Ok(())
}

pub fn find_repo_by_id(db: &Database, repo_id: &str) -> anyhow::Result<Option<RepoDto>> {
  let conn = db.connect()?;
  conn.query_row(
    "SELECT id, workspace_id, name, path, default_branch, is_active, trust_level
     FROM repos WHERE id = ?1",
    params![repo_id],
    map_repo_row,
  )
  .optional()
  .context("failed to load repo by id")
}

fn map_repo_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RepoDto> {
  Ok(RepoDto {
    id: row.get(0)?,
    workspace_id: row.get(1)?,
    name: row.get(2)?,
    path: row.get(3)?,
    default_branch: row.get(4)?,
    is_active: row.get::<_, i64>(5)? > 0,
    trust_level: TrustLevelDto::from_str(&row.get::<_, String>(6)?),
  })
}
