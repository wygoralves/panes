use anyhow::Context;
use rusqlite::params;
use serde_json::Value;

use crate::engines::events::{ActionResult, ActionType};

use super::Database;

pub fn insert_action_started(
  db: &Database,
  action_id: &str,
  thread_id: &str,
  message_id: &str,
  engine_action_id: Option<&str>,
  action_type: &ActionType,
  summary: &str,
  details: &Value,
) -> anyhow::Result<()> {
  let conn = db.connect()?;
  conn.execute(
    "INSERT OR REPLACE INTO actions (
      id, thread_id, message_id, engine_action_id, action_type, summary, details_json, status
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running')",
    params![
      action_id,
      thread_id,
      message_id,
      engine_action_id,
      action_type.as_str(),
      summary,
      details.to_string()
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
    params![status, serde_json::to_string(result)?, result.duration_ms as i64, action_id],
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

pub fn answer_approval(
  db: &Database,
  approval_id: &str,
  decision: &str,
) -> anyhow::Result<()> {
  let conn = db.connect()?;
  conn.execute(
    "UPDATE approvals
     SET status = 'answered', decision = ?1, answered_at = datetime('now')
     WHERE id = ?2",
    params![decision, approval_id],
  )
  .context("failed to answer approval")?;
  Ok(())
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
