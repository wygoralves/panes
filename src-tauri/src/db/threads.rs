use anyhow::Context;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::models::{ThreadDto, ThreadStatusDto};

use super::Database;

pub fn create_thread(
    db: &Database,
    workspace_id: &str,
    repo_id: Option<&str>,
    engine_id: &str,
    model_id: &str,
    title: &str,
) -> anyhow::Result<ThreadDto> {
    let id = Uuid::new_v4().to_string();
    let conn = db.connect()?;
    conn.execute(
        "INSERT INTO threads (id, workspace_id, repo_id, engine_id, model_id, title, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'idle')",
        params![id, workspace_id, repo_id, engine_id, model_id, title],
    )
    .context("failed to create thread")?;

    get_thread(db, &id)?.context("thread not found after insert")
}

pub fn ensure_workspace_thread(
    db: &Database,
    workspace_id: &str,
    engine_id: &str,
    model_id: &str,
) -> anyhow::Result<ThreadDto> {
    if let Some(existing) =
        find_latest_thread_for_scope(db, workspace_id, None, Some(engine_id), Some(model_id))?
    {
        return Ok(existing);
    }

    create_thread(db, workspace_id, None, engine_id, model_id, "General")
}

pub fn get_thread(db: &Database, thread_id: &str) -> anyhow::Result<Option<ThreadDto>> {
    let conn = db.connect()?;
    conn.query_row(
    "SELECT id, workspace_id, repo_id, engine_id, model_id, engine_thread_id, engine_metadata_json,
            COALESCE(title, ''), status, message_count, total_tokens, created_at, last_activity_at
     FROM threads WHERE id = ?1",
    params![thread_id],
    map_thread_row,
  )
  .optional()
  .context("failed to query thread")
}

pub fn list_threads_for_workspace(
    db: &Database,
    workspace_id: &str,
) -> anyhow::Result<Vec<ThreadDto>> {
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
    "SELECT id, workspace_id, repo_id, engine_id, model_id, engine_thread_id, engine_metadata_json,
            COALESCE(title, ''), status, message_count, total_tokens, created_at, last_activity_at
     FROM threads
     WHERE workspace_id = ?1
     ORDER BY last_activity_at DESC",
  )?;

    let rows = stmt.query_map(params![workspace_id], map_thread_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn find_latest_thread_for_scope(
    db: &Database,
    workspace_id: &str,
    repo_id: Option<&str>,
    engine_id: Option<&str>,
    model_id: Option<&str>,
) -> anyhow::Result<Option<ThreadDto>> {
    let conn = db.connect()?;

    let result = match repo_id {
    Some(repo_id) => conn.query_row(
      "SELECT id, workspace_id, repo_id, engine_id, model_id, engine_thread_id, engine_metadata_json,
              COALESCE(title, ''), status, message_count, total_tokens, created_at, last_activity_at
       FROM threads
       WHERE workspace_id = ?1
         AND repo_id = ?2
         AND (?3 IS NULL OR engine_id = ?3)
         AND (?4 IS NULL OR model_id = ?4)
       ORDER BY last_activity_at DESC
       LIMIT 1",
      params![workspace_id, repo_id, engine_id, model_id],
      map_thread_row,
    ),
    None => conn.query_row(
      "SELECT id, workspace_id, repo_id, engine_id, model_id, engine_thread_id, engine_metadata_json,
              COALESCE(title, ''), status, message_count, total_tokens, created_at, last_activity_at
       FROM threads
       WHERE workspace_id = ?1
         AND repo_id IS NULL
         AND (?2 IS NULL OR engine_id = ?2)
         AND (?3 IS NULL OR model_id = ?3)
       ORDER BY last_activity_at DESC
       LIMIT 1",
      params![workspace_id, engine_id, model_id],
      map_thread_row,
    ),
  };

    result.optional().context("failed to query thread scope")
}

pub fn update_thread_status(
    db: &Database,
    thread_id: &str,
    status: ThreadStatusDto,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "UPDATE threads
     SET status = ?1, last_activity_at = datetime('now')
     WHERE id = ?2",
        params![status.as_str(), thread_id],
    )
    .context("failed to update thread status")?;
    Ok(())
}

pub fn set_engine_thread_id(
    db: &Database,
    thread_id: &str,
    engine_thread_id: &str,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "UPDATE threads SET engine_thread_id = ?1 WHERE id = ?2",
        params![engine_thread_id, thread_id],
    )
    .context("failed to set engine thread id")?;
    Ok(())
}

pub fn bump_message_counters(
    db: &Database,
    thread_id: &str,
    tokens: Option<(u64, u64)>,
) -> anyhow::Result<()> {
    let (input, output) = tokens.unwrap_or((0, 0));
    let conn = db.connect()?;
    conn.execute(
        "UPDATE threads
     SET message_count = message_count + 1,
         total_tokens = total_tokens + ?1 + ?2,
         last_activity_at = datetime('now')
     WHERE id = ?3",
        params![input as i64, output as i64, thread_id],
    )
    .context("failed to bump thread counters")?;
    Ok(())
}

fn map_thread_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ThreadDto> {
    let metadata_raw: Option<String> = row.get(6)?;
    let metadata = metadata_raw.and_then(|raw| serde_json::from_str(&raw).ok());

    Ok(ThreadDto {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        repo_id: row.get(2)?,
        engine_id: row.get(3)?,
        model_id: row.get(4)?,
        engine_thread_id: row.get(5)?,
        engine_metadata: metadata,
        title: row.get(7)?,
        status: ThreadStatusDto::from_str(&row.get::<_, String>(8)?),
        message_count: row.get(9)?,
        total_tokens: row.get(10)?,
        created_at: row.get(11)?,
        last_activity_at: row.get(12)?,
    })
}
