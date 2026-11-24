use anyhow::Context;
use rusqlite::{params, OptionalExtension};
use serde_json::Value;

use crate::engines::events::{ActionResult, ActionType};

use super::Database;

#[allow(clippy::too_many_arguments)]
pub fn insert_action_started(
    db: &Database,
    action_id: &str,
    thread_id: &str,
    message_id: &str,
    engine_action_id: Option<&str>,
    action_type: &ActionType,
    summary: &str,
    details: &Value,
    agent_id: Option<&str>,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "INSERT OR REPLACE INTO actions (
      id, thread_id, message_id, engine_action_id, action_type, summary, details_json, status, agent_id
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', ?8)",
        params![
            action_id,
            thread_id,
            message_id,
            engine_action_id,
            action_type.as_str(),
            summary,
            details.to_string(),
            agent_id
        ],
    )
    .context("failed to insert action")?;
    Ok(())
}

pub fn update_action_completed(
    db: &Database,
    action_id: &str,
    result: &ActionResult,
) -> anyhow::Result<()> {
    let status = if result.success { "done" } else { "error" };
    let conn = db.connect()?;
    conn.execute(
        "UPDATE actions
     SET status = ?1, result_json = ?2, duration_ms = ?3
     WHERE id = ?4",
        params![
            status,
            serde_json::to_string(result)?,
            result.duration_ms as i64,
            action_id
        ],
    )
    .context("failed to complete action")?;
    Ok(())
}

pub fn insert_approval(
    db: &Database,
    approval_id: &str,
    thread_id: &str,
    message_id: &str,
    action_type: &ActionType,
    summary: &str,
    details: &Value,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "INSERT OR REPLACE INTO approvals (
      id, thread_id, message_id, action_type, summary, details_json, status
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending')",
        params![
            approval_id,
            thread_id,
            message_id,
            action_type.as_str(),
            summary,
            details.to_string()
        ],
    )
    .context("failed to insert approval")?;
    Ok(())
}

/// Error text for an answer that arrives after its approval left 'pending'.
/// The frontend matches on "no longer pending" to retire the card.
pub const APPROVAL_NOT_PENDING_ERROR: &str =
    "This approval is no longer pending: the turn that asked for it has ended.";

/// Claims a pending approval of `thread_id` for the user's decision. The row
/// reads 'answering' until the engine took the answer: a second answer loses
/// to the claim, turn-end expiry leaves the in-flight answer to its caller,
/// and crash recovery expires an undelivered claim.
pub fn answer_approval(
    db: &Database,
    approval_id: &str,
    thread_id: &str,
    decision: &str,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let changed = conn
        .execute(
            "UPDATE approvals
     SET status = 'answering', decision = ?1, answered_at = datetime('now')
     WHERE id = ?2
       AND thread_id = ?3
       AND status = 'pending'
       AND EXISTS (
         SELECT 1 FROM messages m WHERE m.id = approvals.message_id AND m.status = 'streaming'
       )",
            params![decision, approval_id, thread_id],
        )
        .context("failed to answer approval")?;
    if changed == 0 {
        anyhow::bail!(APPROVAL_NOT_PENDING_ERROR);
    }
    Ok(())
}

/// Records that the engine took the claimed answer. Fails when the turn
/// ended first and expired the claim.
pub fn confirm_approval_answer(
    db: &Database,
    approval_id: &str,
    decision: &str,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let changed = conn
        .execute(
            "UPDATE approvals
     SET status = 'answered'
     WHERE id = ?1
       AND decision = ?2
       AND status IN ('answering', 'answered')",
            params![approval_id, decision],
        )
        .context("failed to confirm approval answer")?;
    if changed == 0 {
        anyhow::bail!(APPROVAL_NOT_PENDING_ERROR);
    }
    Ok(())
}

/// Settles a claim the engine refused. While the turn that asked for it still
/// runs (its reply is streaming and `turn_is_live`), the claim goes back to
/// pending so the user can answer again; otherwise it expires, without the
/// decision that never took effect. Returns whether it is pending again.
pub fn release_approval_claim(
    db: &Database,
    approval_id: &str,
    turn_is_live: bool,
) -> anyhow::Result<bool> {
    let conn = db.connect()?;
    let status: Option<String> = conn
        .query_row(
            "UPDATE approvals
     SET status = CASE WHEN ?2 AND EXISTS (
           SELECT 1 FROM messages m WHERE m.id = approvals.message_id AND m.status = 'streaming'
         ) THEN 'pending' ELSE 'expired' END,
         answered_at = CASE WHEN ?2 AND EXISTS (
           SELECT 1 FROM messages m WHERE m.id = approvals.message_id AND m.status = 'streaming'
         ) THEN NULL ELSE COALESCE(answered_at, datetime('now')) END,
         decision = NULL
     WHERE id = ?1
       AND status = 'answering'
     RETURNING status",
            params![approval_id, turn_is_live],
            |row| row.get(0),
        )
        .optional()
        .context("failed to release approval claim")?;
    Ok(status.as_deref() == Some("pending"))
}

/// Marks every approval of a finished turn that nobody answered as expired
/// and returns their ids. No engine is waiting on them anymore.
pub fn expire_pending_approvals_for_message(
    db: &Database,
    message_id: &str,
) -> anyhow::Result<Vec<String>> {
    let conn = db.connect()?;
    let mut stmt = conn
        .prepare(
            "UPDATE approvals
             SET status = 'expired', answered_at = COALESCE(answered_at, datetime('now'))
             WHERE message_id = ?1
               AND status = 'pending'
             RETURNING id",
        )
        .context("failed to prepare approval expiry")?;
    let rows = stmt
        .query_map(params![message_id], |row| row.get::<_, String>(0))
        .context("failed to expire pending approvals")?;
    let mut expired = Vec::new();
    for row in rows {
        expired.push(row.context("failed to decode expired approval id")?);
    }
    Ok(expired)
}

#[cfg(test)]
pub fn resolve_approval(db: &Database, approval_id: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "UPDATE approvals
     SET status = 'answered', answered_at = COALESCE(answered_at, datetime('now'))
     WHERE id = ?1",
        params![approval_id],
    )
    .context("failed to resolve approval")?;
    Ok(())
}

pub fn find_approval_message_id(
    db: &Database,
    approval_id: &str,
) -> anyhow::Result<Option<String>> {
    let conn = db.connect()?;
    let message_id = conn
        .query_row(
            "SELECT message_id FROM approvals WHERE id = ?1",
            params![approval_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to load approval message id")?;
    Ok(message_id)
}

pub fn find_approval_details(db: &Database, approval_id: &str) -> anyhow::Result<Option<Value>> {
    let conn = db.connect()?;
    let raw_details = conn
        .query_row(
            "SELECT details_json FROM approvals WHERE id = ?1",
            params![approval_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .context("failed to load approval details")?;

    let Some(raw_details) = raw_details else {
        return Ok(None);
    };

    match serde_json::from_str::<Value>(&raw_details) {
        Ok(details) => Ok(Some(details)),
        Err(error) => {
            log::warn!("failed to parse approval details for {approval_id}: {error}");
            Ok(None)
        }
    }
}

pub fn find_approval_context(
    db: &Database,
    approval_id: &str,
) -> anyhow::Result<Option<(String, String)>> {
    let conn = db.connect()?;
    let context = conn
        .query_row(
            "SELECT thread_id, message_id
             FROM approvals
             WHERE id = ?1
               AND thread_id IS NOT NULL
               AND message_id IS NOT NULL",
            params![approval_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .context("failed to load approval context")?;
    Ok(context)
}

pub fn append_event_log(
    db: &Database,
    thread_id: &str,
    message_id: &str,
    event: &Value,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "INSERT INTO engine_event_logs (thread_id, message_id, event_json) VALUES (?1, ?2, ?3)",
        params![thread_id, message_id, event.to_string()],
    )
    .context("failed to append engine event log")?;
    Ok(())
}
