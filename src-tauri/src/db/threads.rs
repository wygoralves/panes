use anyhow::Context;
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::models::{ThreadDto, ThreadStatusDto};

use super::Database;

#[derive(Debug, Default, Clone, Copy)]
pub struct RuntimeRecoveryReport {
    pub messages_marked_interrupted: usize,
    pub thread_status_updates: usize,
    pub message_counts_repaired: usize,
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
            COALESCE(title, ''), status, message_count, total_tokens, created_at, last_activity_at,
            settled_at, unsettled_at, turn_started_at
     FROM threads WHERE id = ?1",
    params![thread_id],
    map_thread_row,
  )
  .optional()
  .context("failed to query thread")
}

pub fn find_thread_by_engine_thread_id(
    db: &Database,
    engine_id: &str,
    engine_thread_id: &str,
) -> anyhow::Result<Option<ThreadDto>> {
    let conn = db.connect()?;
    conn.query_row(
        "SELECT id, workspace_id, repo_id, engine_id, model_id, engine_thread_id, engine_metadata_json,
                COALESCE(title, ''), status, message_count, total_tokens, created_at, last_activity_at,
                settled_at, unsettled_at, turn_started_at
         FROM threads
         WHERE engine_id = ?1
           AND engine_thread_id = ?2
         LIMIT 1",
        params![engine_id, engine_thread_id],
        map_thread_row,
    )
    .optional()
    .context("failed to query thread by engine thread id")
}

pub fn list_threads_for_workspace(
    db: &Database,
    workspace_id: &str,
) -> anyhow::Result<Vec<ThreadDto>> {
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
    "SELECT id, workspace_id, repo_id, engine_id, model_id, engine_thread_id, engine_metadata_json,
            COALESCE(title, ''), status, message_count, total_tokens, created_at, last_activity_at,
            settled_at, unsettled_at, turn_started_at
     FROM threads
     WHERE workspace_id = ?1
       AND archived_at IS NULL
       AND (
         engine_thread_id IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM messages
           WHERE messages.thread_id = threads.id
         )
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
            COALESCE(title, ''), status, message_count, total_tokens, created_at, last_activity_at,
            settled_at, unsettled_at, turn_started_at
     FROM threads
     WHERE workspace_id = ?1
       AND archived_at IS NOT NULL
       AND (
         engine_thread_id IS NOT NULL
         OR EXISTS (
           SELECT 1 FROM messages
           WHERE messages.thread_id = threads.id
         )
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

/// Every thread whose engine metadata carries a worktree binding, archived ones
/// included. The stored path is compared by the caller, which knows how to match
/// worktree paths across canonical and trailing-separator forms.
pub fn list_threads_with_worktree_binding(db: &Database) -> anyhow::Result<Vec<ThreadDto>> {
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
    "SELECT id, workspace_id, repo_id, engine_id, model_id, engine_thread_id, engine_metadata_json,
            COALESCE(title, ''), status, message_count, total_tokens, created_at, last_activity_at,
            settled_at, unsettled_at, turn_started_at
     FROM threads
     WHERE engine_metadata_json IS NOT NULL
       AND engine_metadata_json LIKE '%worktreePath%'",
  )?;

    let rows = stmt.query_map([], map_thread_row)?;
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

pub fn start_thread_turn(db: &Database, thread_id: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "UPDATE threads
         SET status = 'streaming',
             unsettled_at = CASE
               WHEN settled_at IS NOT NULL
                 THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
               ELSE unsettled_at
             END,
             settled_at = NULL,
             turn_started_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
             last_activity_at = datetime('now')
         WHERE id = ?1",
        params![thread_id],
    )
    .context("failed to start thread turn")?;
    Ok(())
}

/// How a settlement write picks its timestamp. `Now` is the user acting;
/// `Restore` is an undo putting the exact prior stamp back, so undoing never
/// invents a new time (and `Restore(None)` clears the column again).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettlementStamp {
    Now,
    Restore(Option<String>),
}

pub fn settle_thread(
    db: &Database,
    thread_id: &str,
    stamp: SettlementStamp,
) -> anyhow::Result<ThreadDto> {
    let conn = db.connect()?;
    // A thread the engine still owns cannot be settled, so the caller gets the
    // same "not settled" error it already handles.
    let affected = match &stamp {
        SettlementStamp::Now => conn.execute(
            "UPDATE threads
             SET settled_at = COALESCE(settled_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             WHERE id = ?1
               AND archived_at IS NULL
               AND status NOT IN ('streaming', 'awaiting_approval')",
            params![thread_id],
        ),
        SettlementStamp::Restore(settled_at) => conn.execute(
            "UPDATE threads
             SET settled_at = COALESCE(settled_at, ?2)
             WHERE id = ?1
               AND archived_at IS NULL
               AND status NOT IN ('streaming', 'awaiting_approval')",
            params![thread_id, settled_at],
        ),
    }
    .context("failed to settle thread")?;

    if affected == 0 {
        anyhow::bail!("thread not found, archived or still running: {thread_id}");
    }

    get_thread(db, thread_id)?
        .ok_or_else(|| anyhow::anyhow!("thread not found after settle: {thread_id}"))
}

pub fn unsettle_thread(
    db: &Database,
    thread_id: &str,
    stamp: SettlementStamp,
) -> anyhow::Result<ThreadDto> {
    let conn = db.connect()?;
    let affected = match &stamp {
        SettlementStamp::Now => conn.execute(
            "UPDATE threads
             SET unsettled_at = CASE
                   WHEN settled_at IS NOT NULL
                     THEN strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
                   ELSE unsettled_at
                 END,
                 settled_at = NULL
             WHERE id = ?1
               AND archived_at IS NULL",
            params![thread_id],
        ),
        SettlementStamp::Restore(unsettled_at) => conn.execute(
            "UPDATE threads
             SET unsettled_at = ?2,
                 settled_at = NULL
             WHERE id = ?1
               AND archived_at IS NULL",
            params![thread_id, unsettled_at],
        ),
    }
    .context("failed to unsettle thread")?;

    if affected == 0 {
        anyhow::bail!("thread not found or archived: {thread_id}");
    }

    get_thread(db, thread_id)?
        .ok_or_else(|| anyhow::anyhow!("thread not found after unsettle: {thread_id}"))
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

pub fn set_thread_repo_id(
    db: &Database,
    thread_id: &str,
    repo_id: Option<&str>,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "UPDATE threads SET repo_id = ?1 WHERE id = ?2",
        params![repo_id, thread_id],
    )
    .context("failed to set thread repo")?;
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
     SET message_count = (SELECT COUNT(*) FROM messages WHERE thread_id = ?3),
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

pub fn refresh_thread_message_stats(db: &Database, thread_id: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let (message_count, total_tokens, latest_message_at): (i64, i64, Option<String>) = conn
        .query_row(
            "SELECT
                COUNT(*),
                COALESCE(SUM(COALESCE(token_input, 0) + COALESCE(token_output, 0)), 0),
                MAX(created_at)
             FROM messages
             WHERE thread_id = ?1",
            params![thread_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .context("failed to recalculate thread message stats")?;

    conn.execute(
        "UPDATE threads
         SET message_count = ?1,
             total_tokens = ?2,
             last_activity_at = COALESCE(?3, datetime('now'))
         WHERE id = ?4",
        params![message_count, total_tokens, latest_message_at, thread_id],
    )
    .context("failed to persist recalculated thread message stats")?;

    Ok(())
}

pub fn update_thread_runtime_snapshot(
    db: &Database,
    thread_id: &str,
    title: Option<&str>,
    status: Option<ThreadStatusDto>,
    metadata: Option<&serde_json::Value>,
) -> anyhow::Result<ThreadDto> {
    let existing = get_thread(db, thread_id)?
        .ok_or_else(|| anyhow::anyhow!("thread not found: {thread_id}"))?;

    if let Some(title) =
        title.filter(|_| !thread_manual_title_locked(existing.engine_metadata.as_ref()))
    {
        update_thread_title(db, thread_id, title)?;
    }
    if let Some(status) = status {
        update_thread_status(db, thread_id, status)?;
    }
    if let Some(metadata) = metadata {
        update_engine_metadata(db, thread_id, metadata)?;
    }
    get_thread(db, thread_id)?.ok_or_else(|| {
        anyhow::anyhow!("thread not found after runtime snapshot update: {thread_id}")
    })
}

fn thread_manual_title_locked(metadata: Option<&serde_json::Value>) -> bool {
    metadata
        .and_then(serde_json::Value::as_object)
        .and_then(|object| object.get("manualTitle"))
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
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

    // Counts written by older builds only moved on completed replies, so
    // threads that were interrupted or errored on their first turn still say
    // zero. Bring every row back in line with its messages.
    let message_counts_repaired = tx
        .execute(
            "UPDATE threads
       SET message_count = (SELECT COUNT(*) FROM messages WHERE messages.thread_id = threads.id)
       WHERE message_count != (SELECT COUNT(*) FROM messages WHERE messages.thread_id = threads.id)",
            [],
        )
        .context("failed to repair thread message counts")?;

    tx.commit()
        .context("failed to commit runtime recovery transaction")?;

    Ok(RuntimeRecoveryReport {
        messages_marked_interrupted,
        thread_status_updates,
        message_counts_repaired,
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
        settled_at: row.get(13)?,
        unsettled_at: row.get(14)?,
        turn_started_at: row.get(15)?,
    })
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{Arc, Mutex},
    };

    use serde_json::json;
    use uuid::Uuid;

    use crate::db::{messages, workspaces, ConnectionPool, SQLITE_POOL_MAX_IDLE};

    use super::*;

    fn test_db() -> Database {
        let path = std::env::temp_dir().join(format!("panes-threads-{}.db", Uuid::new_v4()));
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

    fn test_thread(db: &Database, title: &str) -> ThreadDto {
        let root = std::env::temp_dir().join(format!("panes-workspace-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("failed to create temp workspace root");
        let workspace =
            workspaces::upsert_workspace(db, root.to_string_lossy().as_ref(), Some(1)).unwrap();
        create_thread(db, &workspace.id, None, "codex", "gpt-5.3-codex", title).unwrap()
    }

    #[test]
    fn update_thread_runtime_snapshot_preserves_manual_title() {
        let db = test_db();
        let thread = test_thread(&db, "Manual title");
        let manual_metadata = json!({
            "manualTitle": true,
            "manualTitleUpdatedAt": "2026-03-06T12:00:00Z",
        });
        update_engine_metadata(&db, &thread.id, &manual_metadata).unwrap();

        let updated = update_thread_runtime_snapshot(
            &db,
            &thread.id,
            Some("Engine renamed title"),
            Some(ThreadStatusDto::Idle),
            Some(&json!({
                "manualTitle": true,
                "codexThreadStatus": "idle",
                "codexSyncRequired": false,
            })),
        )
        .unwrap();

        assert_eq!(updated.title, "Manual title");
        assert_eq!(updated.status, ThreadStatusDto::Idle);
        assert_eq!(
            updated
                .engine_metadata
                .as_ref()
                .and_then(|value| value.get("codexThreadStatus"))
                .and_then(serde_json::Value::as_str),
            Some("idle")
        );
        assert_eq!(
            updated
                .engine_metadata
                .as_ref()
                .and_then(|value| value.get("manualTitle"))
                .and_then(serde_json::Value::as_bool),
            Some(true)
        );
    }

    #[test]
    fn refresh_thread_message_stats_recomputes_counters_from_messages() {
        let db = test_db();
        let thread = test_thread(&db, "Stats");
        messages::insert_user_message(
            &db,
            &thread.id,
            "Count this turn",
            None,
            Some("codex"),
            Some("gpt-5.3-codex"),
            Some("low"),
        )
        .unwrap();
        let assistant = messages::insert_assistant_placeholder(
            &db,
            &thread.id,
            Some("codex"),
            Some("gpt-5.3-codex"),
            Some("low"),
        )
        .unwrap();
        messages::complete_assistant_message(
            &db,
            &assistant.id,
            crate::models::MessageStatusDto::Completed,
            Some((13, 21)),
            Some("gpt-5.3-codex"),
        )
        .unwrap();

        refresh_thread_message_stats(&db, &thread.id).unwrap();

        let refreshed = get_thread(&db, &thread.id).unwrap().unwrap();
        assert_eq!(refreshed.message_count, 2);
        assert_eq!(refreshed.total_tokens, 34);
        assert!(!refreshed.last_activity_at.is_empty());
    }

    #[test]
    fn message_count_follows_inserted_rows_even_without_a_completed_reply() {
        let db = test_db();
        let thread = test_thread(&db, "Interrupted first turn");

        messages::insert_user_message(&db, &thread.id, "hello", None, None, None, None).unwrap();
        assert_eq!(
            get_thread(&db, &thread.id).unwrap().unwrap().message_count,
            1
        );

        let assistant =
            messages::insert_assistant_placeholder(&db, &thread.id, None, None, None).unwrap();
        messages::complete_assistant_message(
            &db,
            &assistant.id,
            crate::models::MessageStatusDto::Interrupted,
            None,
            None,
        )
        .unwrap();
        assert_eq!(
            get_thread(&db, &thread.id).unwrap().unwrap().message_count,
            2
        );

        bump_message_counters(&db, &thread.id, Some((1, 1))).unwrap();
        assert_eq!(
            get_thread(&db, &thread.id).unwrap().unwrap().message_count,
            2
        );
    }

    #[test]
    fn reconcile_runtime_state_repairs_stale_message_counts() {
        let db = test_db();
        let thread = test_thread(&db, "Stale count");
        messages::insert_user_message(&db, &thread.id, "hello", None, None, None, None).unwrap();
        db.connect()
            .unwrap()
            .execute(
                "UPDATE threads SET message_count = 0 WHERE id = ?1",
                params![thread.id],
            )
            .unwrap();

        let report = reconcile_runtime_state(&db).unwrap();

        assert_eq!(report.message_counts_repaired, 1);
        assert_eq!(
            get_thread(&db, &thread.id).unwrap().unwrap().message_count,
            1
        );
    }

    #[test]
    fn list_threads_for_workspace_includes_engine_backed_threads_without_messages() {
        let db = test_db();
        let visible = test_thread(&db, "Remote");
        let hidden = test_thread(&db, "Hidden");
        set_engine_thread_id(&db, &visible.id, "codex-thread-123").unwrap();

        let listed = list_threads_for_workspace(&db, &visible.workspace_id).unwrap();
        let listed_ids = listed
            .into_iter()
            .map(|thread| thread.id)
            .collect::<Vec<_>>();

        assert!(listed_ids.contains(&visible.id));
        assert!(!listed_ids.contains(&hidden.id));
    }

    #[test]
    fn list_archived_threads_for_workspace_includes_engine_backed_threads_without_messages() {
        let db = test_db();
        let visible = test_thread(&db, "Archived remote");
        let hidden = test_thread(&db, "Archived hidden");
        set_engine_thread_id(&db, &visible.id, "codex-thread-archived").unwrap();
        archive_thread(&db, &visible.id).unwrap();
        archive_thread(&db, &hidden.id).unwrap();

        let listed = list_archived_threads_for_workspace(&db, &visible.workspace_id).unwrap();
        let listed_ids = listed
            .into_iter()
            .map(|thread| thread.id)
            .collect::<Vec<_>>();

        assert!(listed_ids.contains(&visible.id));
        assert!(!listed_ids.contains(&hidden.id));
    }

    #[test]
    fn settlement_is_manual_and_opening_does_not_change_it() {
        let db = test_db();
        let thread = test_thread(&db, "Settle me");

        let settled = settle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();
        assert!(settled.settled_at.is_some());

        let opened = get_thread(&db, &thread.id).unwrap().unwrap();
        assert_eq!(opened.settled_at, settled.settled_at);

        let unsettled = unsettle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();
        assert!(unsettled.settled_at.is_none());
    }

    #[test]
    fn unsettling_stamps_the_sidebar_anchor() {
        let db = test_db();
        let thread = test_thread(&db, "Re-anchor me");
        assert!(thread.unsettled_at.is_none());

        // Un-settling a thread that never settled must not re-anchor it.
        let never_settled = unsettle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();
        assert!(never_settled.unsettled_at.is_none());

        settle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();
        let unsettled = unsettle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();
        let anchor = unsettled.unsettled_at.expect("expected an unsettle anchor");
        assert!(anchor.ends_with('Z'), "expected a UTC stamp, got {anchor}");

        // A later turn on an active thread keeps the anchor where it was, so
        // rows do not move while a thread streams.
        start_thread_turn(&db, &thread.id).unwrap();
        let streaming = get_thread(&db, &thread.id).unwrap().unwrap();
        assert_eq!(streaming.unsettled_at.as_deref(), Some(anchor.as_str()));
    }

    #[test]
    fn settling_writes_a_utc_timestamp() {
        let db = test_db();
        let thread = test_thread(&db, "Stamp me");

        let settled = settle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();
        let settled_at = settled.settled_at.expect("expected a settle stamp");

        assert!(
            settled_at.ends_with('Z') && settled_at.contains('T'),
            "expected an ISO UTC stamp, got {settled_at}"
        );
    }

    #[test]
    fn sending_a_new_turn_unsettles_the_thread() {
        let db = test_db();
        let thread = test_thread(&db, "Resume me");
        settle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();

        start_thread_turn(&db, &thread.id).unwrap();

        let resumed = get_thread(&db, &thread.id).unwrap().unwrap();
        assert!(resumed.settled_at.is_none());
        assert!(resumed.unsettled_at.is_some());
        assert_eq!(resumed.status, ThreadStatusDto::Streaming);
    }

    #[test]
    fn undoing_a_settle_restores_the_previous_anchor() {
        let db = test_db();
        let thread = test_thread(&db, "Undo my settle");
        settle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();
        let unsettled = unsettle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();
        let original_anchor = unsettled.unsettled_at.clone();
        assert!(original_anchor.is_some());

        // Settle again, then undo with the anchor the row carried before.
        settle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();
        let undone = unsettle_thread(
            &db,
            &thread.id,
            SettlementStamp::Restore(original_anchor.clone()),
        )
        .unwrap();

        assert!(undone.settled_at.is_none());
        assert_eq!(undone.unsettled_at, original_anchor);
    }

    #[test]
    fn undoing_a_settle_clears_an_anchor_that_was_never_set() {
        let db = test_db();
        let thread = test_thread(&db, "Never un-settled");
        settle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();

        let undone = unsettle_thread(&db, &thread.id, SettlementStamp::Restore(None)).unwrap();

        assert!(undone.settled_at.is_none());
        assert!(undone.unsettled_at.is_none());
    }

    #[test]
    fn undoing_an_unsettle_restores_the_previous_settle_stamp() {
        let db = test_db();
        let thread = test_thread(&db, "Undo my un-settle");
        let settled = settle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();
        let original_settled_at = settled.settled_at.clone();
        unsettle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();

        let undone = settle_thread(
            &db,
            &thread.id,
            SettlementStamp::Restore(original_settled_at.clone()),
        )
        .unwrap();

        assert_eq!(undone.settled_at, original_settled_at);
    }

    #[test]
    fn settling_refuses_a_thread_the_engine_still_owns() {
        let db = test_db();
        let thread = test_thread(&db, "Still running");
        start_thread_turn(&db, &thread.id).unwrap();

        assert!(settle_thread(&db, &thread.id, SettlementStamp::Now).is_err());

        update_thread_status(&db, &thread.id, ThreadStatusDto::AwaitingApproval).unwrap();
        assert!(settle_thread(&db, &thread.id, SettlementStamp::Now).is_err());

        update_thread_status(&db, &thread.id, ThreadStatusDto::Completed).unwrap();
        assert!(settle_thread(&db, &thread.id, SettlementStamp::Now).is_ok());
    }

    #[test]
    fn starting_a_turn_stamps_the_working_anchor() {
        let db = test_db();
        let thread = test_thread(&db, "Time me");
        assert!(thread.turn_started_at.is_none());

        start_thread_turn(&db, &thread.id).unwrap();

        let started = get_thread(&db, &thread.id).unwrap().unwrap();
        let stamp = started
            .turn_started_at
            .expect("expected a turn start stamp");
        assert!(
            stamp.ends_with('Z') && stamp.contains('T'),
            "expected an ISO UTC stamp, got {stamp}"
        );
    }

    #[test]
    fn archive_and_restore_preserve_settlement() {
        let db = test_db();
        let thread = test_thread(&db, "Archive me");
        settle_thread(&db, &thread.id, SettlementStamp::Now).unwrap();

        archive_thread(&db, &thread.id).unwrap();
        let restored = restore_thread(&db, &thread.id).unwrap();

        assert!(restored.settled_at.is_some());
    }
}
