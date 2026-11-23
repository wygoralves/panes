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

/// Records the user's decision. Only a pending row, or one the Codex runtime
/// already resolved without a decision, can take it: an expired approval must
/// never read as accepted in the audit trail.
pub fn answer_approval(db: &Database, approval_id: &str, decision: &str) -> anyhow::Result<()> {
    let conn = db.connect()?;
    let changed = conn
        .execute(
            "UPDATE approvals
     SET status = 'answered', decision = ?1, answered_at = datetime('now')
     WHERE id = ?2
       AND (status = 'pending' OR (status = 'answered' AND decision IS NULL))",
            params![decision, approval_id],
        )
        .context("failed to answer approval")?;
    if changed == 0 {
        anyhow::bail!(APPROVAL_NOT_PENDING_ERROR);
    }
    Ok(())
}

pub fn find_approval_status(db: &Database, approval_id: &str) -> anyhow::Result<Option<String>> {
    let conn = db.connect()?;
    let status = conn
        .query_row(
            "SELECT status FROM approvals WHERE id = ?1",
            params![approval_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to load approval status")?;
    Ok(status)
}

/// Marks every approval of a finished turn that nobody answered as expired
/// and returns their ids. No engine is waiting on them anymore.
pub fn expire_pending_approvals_for_message(
    db: &Database,
    message_id: &str,
) -> anyhow::Result<Vec<String>> {
    let mut conn = db.connect()?;
    let tx = conn
        .transaction()
        .context("failed to start approval expiry transaction")?;
    let expired = {
        let mut stmt = tx
            .prepare(
                "SELECT id FROM approvals
                 WHERE message_id = ?1
                   AND status = 'pending'",
            )
            .context("failed to prepare pending approval lookup")?;
        let rows = stmt
            .query_map(params![message_id], |row| row.get::<_, String>(0))
            .context("failed to query pending approvals")?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row.context("failed to decode pending approval id")?);
        }
        out
    };
    if !expired.is_empty() {
        tx.execute(
            "UPDATE approvals
             SET status = 'expired', answered_at = COALESCE(answered_at, datetime('now'))
             WHERE message_id = ?1
               AND status = 'pending'",
            params![message_id],
        )
        .context("failed to expire pending approvals")?;
    }
    tx.commit()
        .context("failed to commit approval expiry transaction")?;
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
