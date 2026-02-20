use anyhow::Context;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::models::{ThreadDto, ThreadStatusDto};

use super::Database;

#[derive(Debug, Default, Clone, Copy)]
pub struct RuntimeRecoveryReport {
    pub messages_marked_interrupted: usize,
    pub thread_status_updates: usize,
}

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
       AND archived_at IS NULL
       AND EXISTS (
         SELECT 1 FROM messages
         WHERE messages.thread_id = threads.id
       )
     ORDER BY last_activity_at DESC",
  )?;

    let rows = stmt.query_map(params![workspace_id], map_thread_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn list_archived_threads_for_workspace(
    db: &Database,
    workspace_id: &str,
) -> anyhow::Result<Vec<ThreadDto>> {
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
    "SELECT id, workspace_id, repo_id, engine_id, model_id, engine_thread_id, engine_metadata_json,
            COALESCE(title, ''), status, message_count, total_tokens, created_at, last_activity_at
     FROM threads
     WHERE workspace_id = ?1
       AND archived_at IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM messages
         WHERE messages.thread_id = threads.id
       )
     ORDER BY archived_at DESC",
  )?;

    let rows = stmt.query_map(params![workspace_id], map_thread_row)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
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
     WHERE id = ?2
       AND status != ?1",
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

pub fn delete_thread(db: &Database, thread_id: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let affected = conn
        .execute("DELETE FROM threads WHERE id = ?1", params![thread_id])
        .context("failed to delete thread")?;

    if affected == 0 {
        anyhow::bail!("thread not found: {thread_id}");
    }

    Ok(())
}

pub fn archive_thread(db: &Database, thread_id: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let affected = conn
        .execute(
            "UPDATE threads
       SET archived_at = datetime('now')
       WHERE id = ?1
         AND archived_at IS NULL",
            params![thread_id],
        )
        .context("failed to archive thread")?;

    if affected == 0 {
        anyhow::bail!("thread not found or already archived: {thread_id}");
    }

    Ok(())
}

pub fn restore_thread(db: &Database, thread_id: &str) -> anyhow::Result<ThreadDto> {
    let conn = db.connect()?;
    let affected = conn
        .execute(
            "UPDATE threads
       SET archived_at = NULL
       WHERE id = ?1
         AND archived_at IS NOT NULL",
            params![thread_id],
        )
        .context("failed to restore thread")?;

    if affected == 0 {
        anyhow::bail!("thread not found or not archived: {thread_id}");
    }

    get_thread(db, thread_id)?
        .ok_or_else(|| anyhow::anyhow!("thread not found after restore: {thread_id}"))
}

pub fn update_engine_metadata(
    db: &Database,
    thread_id: &str,
    metadata: &serde_json::Value,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "UPDATE threads SET engine_metadata_json = ?1 WHERE id = ?2",
        params![metadata.to_string(), thread_id],
    )
    .context("failed to update engine metadata")?;
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

pub fn update_thread_title(db: &Database, thread_id: &str, title: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "UPDATE threads SET title = ?1 WHERE id = ?2",
        params![title, thread_id],
    )
    .context("failed to update thread title")?;
    Ok(())
}

pub fn reconcile_runtime_state(db: &Database) -> anyhow::Result<RuntimeRecoveryReport> {
    let mut conn = db.connect()?;
    let tx = conn
        .transaction()
        .context("failed to start runtime recovery transaction")?;

    let messages_marked_interrupted = tx
        .execute(
            "UPDATE messages
       SET status = 'interrupted'
       WHERE role = 'assistant'
         AND status = 'streaming'",
            [],
        )
        .context("failed to normalize stale streaming assistant messages")?;

    let thread_ids = {
        let mut stmt = tx
            .prepare("SELECT id FROM threads")
            .context("failed to load threads for runtime recovery")?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .context("failed to iterate threads for runtime recovery")?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row.context("failed to decode thread id during runtime recovery")?);
        }
        out
    };

    let mut thread_status_updates = 0usize;
    for thread_id in thread_ids {
        let next_status = derive_thread_status_for_recovery(&tx, &thread_id)?;
        let changed = tx
            .execute(
                "UPDATE threads
           SET status = ?1
           WHERE id = ?2
             AND status != ?1",
                params![next_status.as_str(), thread_id],
            )
            .context("failed to apply runtime recovery thread status")?;
        thread_status_updates += changed;
    }

    tx.commit()
        .context("failed to commit runtime recovery transaction")?;

    Ok(RuntimeRecoveryReport {
        messages_marked_interrupted,
        thread_status_updates,
    })
}

fn derive_thread_status_for_recovery(
    conn: &rusqlite::Connection,
    thread_id: &str,
) -> anyhow::Result<ThreadStatusDto> {
    let has_pending_approval = conn
        .query_row(
            "SELECT 1
       FROM approvals
       WHERE thread_id = ?1
         AND status = 'pending'
       LIMIT 1",
            params![thread_id],
            |_| Ok(()),
        )
        .optional()
        .context("failed to inspect pending approvals during runtime recovery")?
        .is_some();

    if has_pending_approval {
        return Ok(ThreadStatusDto::AwaitingApproval);
    }

    let last_assistant_status = conn
        .query_row(
            "SELECT status
       FROM messages
       WHERE thread_id = ?1
         AND role = 'assistant'
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1",
            params![thread_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .context("failed to inspect latest assistant message during runtime recovery")?;

    let status = match last_assistant_status.as_deref() {
        Some("error") => ThreadStatusDto::Error,
        Some("completed") => ThreadStatusDto::Completed,
        Some("streaming") | Some("interrupted") => ThreadStatusDto::Idle,
        _ => ThreadStatusDto::Idle,
    };

    Ok(status)
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
