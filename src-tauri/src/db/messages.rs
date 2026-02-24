use anyhow::Context;
use std::collections::HashMap;

use rusqlite::{params, OptionalExtension, Row};
use serde_json::Value;
use uuid::Uuid;

use crate::models::{
    ActionOutputChunkDto, ActionOutputDto, MessageDto, MessageStatusDto, MessageWindowCursorDto,
    MessageWindowDto, SearchResultDto, TokenUsageDto,
};

use super::Database;

pub fn insert_user_message(
    db: &Database,
    thread_id: &str,
    content: &str,
    blocks: Option<Value>,
    turn_engine_id: Option<&str>,
    turn_model_id: Option<&str>,
    turn_reasoning_effort: Option<&str>,
) -> anyhow::Result<MessageDto> {
    insert_message(
        db,
        thread_id,
        "user",
        Some(content.to_string()),
        blocks,
        MessageStatusDto::Completed,
        turn_engine_id,
        turn_model_id,
        turn_reasoning_effort,
    )
}

pub fn insert_assistant_placeholder(
    db: &Database,
    thread_id: &str,
    turn_engine_id: Option<&str>,
    turn_model_id: Option<&str>,
    turn_reasoning_effort: Option<&str>,
) -> anyhow::Result<MessageDto> {
    insert_message(
        db,
        thread_id,
        "assistant",
        None,
        Some(serde_json::json!([])),
        MessageStatusDto::Streaming,
        turn_engine_id,
        turn_model_id,
        turn_reasoning_effort,
    )
}

pub fn update_assistant_blocks(
    db: &Database,
    message_id: &str,
    blocks: &Value,
    status: MessageStatusDto,
) -> anyhow::Result<()> {
    let conn = db.connect()?;
    conn.execute(
        "UPDATE messages
     SET blocks_json = ?1, status = ?2
     WHERE id = ?3",
        params![blocks.to_string(), status.as_str(), message_id],
    )
    .context("failed to update assistant blocks")?;
    Ok(())
}

pub fn complete_assistant_message(
    db: &Database,
    message_id: &str,
    status: MessageStatusDto,
    token_usage: Option<(u64, u64)>,
) -> anyhow::Result<()> {
    let (input, output) = token_usage.unwrap_or((0, 0));
    let conn = db.connect()?;
    conn.execute(
        "UPDATE messages
     SET status = ?1,
         token_input = ?2,
         token_output = ?3
     WHERE id = ?4",
        params![status.as_str(), input as i64, output as i64, message_id],
    )
    .context("failed to complete assistant message")?;
    Ok(())
}

pub fn get_thread_messages(db: &Database, thread_id: &str) -> anyhow::Result<Vec<MessageDto>> {
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
        "SELECT id, thread_id, role, content, blocks_json, schema_version, status,
            token_input, token_output, turn_engine_id, turn_model_id, turn_reasoning_effort, created_at
     FROM messages
     WHERE thread_id = ?1
     ORDER BY created_at ASC",
    )?;

    let rows = stmt.query_map(params![thread_id], map_message_row)?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }

    Ok(out)
}

pub fn get_thread_messages_window(
    db: &Database,
    thread_id: &str,
    cursor: Option<&MessageWindowCursorDto>,
    limit: usize,
) -> anyhow::Result<MessageWindowDto> {
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
        "SELECT id, thread_id, role, content, blocks_json, schema_version, status,
            token_input, token_output, turn_engine_id, turn_model_id, turn_reasoning_effort, created_at, rowid
     FROM messages
     WHERE thread_id = ?1
       AND (
         ?2 IS NULL
         OR created_at < ?2
         OR (
           created_at = ?2
           AND (
             (?3 IS NOT NULL AND rowid < ?3)
             OR (?3 IS NULL AND ?4 IS NOT NULL AND id < ?4)
           )
         )
       )
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?5",
    )?;

    let cursor_created_at = cursor.map(|value| value.created_at.as_str());
    let cursor_row_id = cursor.and_then(|value| value.row_id);
    let cursor_id = cursor.map(|value| value.id.as_str());
    let query_limit = limit.max(1).saturating_add(1) as i64;
    let rows = stmt.query_map(
        params![
            thread_id,
            cursor_created_at,
            cursor_row_id,
            cursor_id,
            query_limit
        ],
        |row| {
            let message = map_message_row(row)?;
            let row_id: i64 = row.get(13)?;
            Ok((message, row_id))
        },
    )?;

    let mut messages_desc: Vec<(MessageDto, i64)> = Vec::new();
    for row in rows {
        messages_desc.push(row?);
    }

    let page_limit = limit.max(1);
    let has_more = messages_desc.len() > page_limit;
    if has_more {
        messages_desc.pop();
    }

    let next_cursor = if has_more {
        messages_desc
            .last()
            .map(|(message, row_id)| MessageWindowCursorDto {
                created_at: message.created_at.clone(),
                id: message.id.clone(),
                row_id: Some(*row_id),
            })
    } else {
        None
    };

    messages_desc.reverse();
    let messages = messages_desc
        .into_iter()
        .map(|(message, _)| message)
        .collect();
    Ok(MessageWindowDto {
        messages,
        next_cursor,
    })
}

pub fn get_message_blocks(db: &Database, message_id: &str) -> anyhow::Result<Option<Value>> {
    let conn = db.connect()?;
    let raw_blocks: Option<Option<String>> = conn
        .query_row(
            "SELECT blocks_json FROM messages WHERE id = ?1",
            params![message_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to load message blocks")?;

    let Some(raw_blocks) = raw_blocks else {
        return Ok(None);
    };

    let blocks = raw_blocks
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| serde_json::json!([]));
    Ok(Some(blocks))
}

pub fn get_action_output(
    db: &Database,
    message_id: &str,
    action_id: &str,
) -> anyhow::Result<ActionOutputDto> {
    let Some(blocks) = get_message_blocks(db, message_id)? else {
        return Ok(ActionOutputDto {
            found: false,
            output_chunks: Vec::new(),
            truncated: false,
        });
    };

    let Some(items) = blocks.as_array() else {
        return Ok(ActionOutputDto {
            found: false,
            output_chunks: Vec::new(),
            truncated: false,
        });
    };

    for block in items {
        let Some(object) = block.as_object() else {
            continue;
        };

        if object.get("type").and_then(Value::as_str) != Some("action") {
            continue;
        }

        let candidate_id = object
            .get("actionId")
            .and_then(Value::as_str)
            .or_else(|| object.get("action_id").and_then(Value::as_str));
        if candidate_id != Some(action_id) {
            continue;
        }

        let output_chunks = object
            .get("outputChunks")
            .or_else(|| object.get("output_chunks"))
            .and_then(Value::as_array)
            .map(|chunks| {
                chunks
                    .iter()
                    .filter_map(|chunk| {
                        let object = chunk.as_object()?;
                        let stream = object
                            .get("stream")
                            .and_then(Value::as_str)
                            .unwrap_or("stdout")
                            .to_string();
                        let content = match object.get("content") {
                            Some(Value::String(value)) => value.to_string(),
                            Some(value) => value.to_string(),
                            None => String::new(),
                        };
                        Some(ActionOutputChunkDto { stream, content })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let truncated = object
            .get("details")
            .and_then(Value::as_object)
            .and_then(|details| {
                details
                    .get("outputTruncated")
                    .or_else(|| details.get("output_truncated"))
                    .and_then(Value::as_bool)
            })
            .unwrap_or(false);

        return Ok(ActionOutputDto {
            found: true,
            output_chunks,
            truncated,
        });
    }

    Ok(ActionOutputDto {
        found: false,
        output_chunks: Vec::new(),
        truncated: false,
    })
}

pub fn mark_approval_block_answered(
    db: &Database,
    message_id: &str,
    approval_id: &str,
    decision: &str,
) -> anyhow::Result<bool> {
    let conn = db.connect()?;
    let Some(raw_blocks): Option<String> = conn
        .query_row(
            "SELECT blocks_json FROM messages WHERE id = ?1",
            params![message_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to load message blocks for approval update")?
    else {
        return Ok(false);
    };

    let mut blocks_value: Value =
        serde_json::from_str(&raw_blocks).unwrap_or_else(|_| serde_json::json!([]));
    let mut answered = HashMap::new();
    answered.insert(approval_id.to_string(), decision.to_string());
    let changed = apply_answered_approvals_to_blocks(&mut blocks_value, &answered);
    if !changed {
        return Ok(false);
    }

    conn.execute(
        "UPDATE messages SET blocks_json = ?1 WHERE id = ?2",
        params![blocks_value.to_string(), message_id],
    )
    .context("failed to persist answered approval in message blocks")?;

    Ok(true)
}

pub fn search_messages(
    db: &Database,
    workspace_id: &str,
    query: &str,
) -> anyhow::Result<Vec<SearchResultDto>> {
    let conn = db.connect()?;
    let mut stmt = conn.prepare(
        "SELECT m.thread_id,
            m.id,
            snippet(messages_fts, 2, '[', ']', ' … ', 12)
     FROM messages_fts
     JOIN messages m ON m.rowid = messages_fts.rowid
     JOIN threads t ON t.id = m.thread_id
     WHERE t.workspace_id = ?1 AND messages_fts MATCH ?2
     ORDER BY rank
     LIMIT 50",
    )?;

    let rows = stmt.query_map(params![workspace_id, query], |row| {
        Ok(SearchResultDto {
            thread_id: row.get(0)?,
            message_id: row.get(1)?,
            snippet: row.get(2)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }

    Ok(out)
}

#[allow(clippy::too_many_arguments)]
fn insert_message(
    db: &Database,
    thread_id: &str,
    role: &str,
    content: Option<String>,
    blocks: Option<Value>,
    status: MessageStatusDto,
    turn_engine_id: Option<&str>,
    turn_model_id: Option<&str>,
    turn_reasoning_effort: Option<&str>,
) -> anyhow::Result<MessageDto> {
    let id = Uuid::new_v4().to_string();
    let conn = db.connect()?;
    conn.execute(
        "INSERT INTO messages (
            id, thread_id, role, content, blocks_json, schema_version, status, turn_engine_id, turn_model_id, turn_reasoning_effort
        )
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, ?9)",
        params![
            id,
            thread_id,
            role,
            content,
            blocks.map(|value| value.to_string()),
            status.as_str(),
            turn_engine_id,
            turn_model_id,
            turn_reasoning_effort
        ],
    )
    .context("failed to insert message")?;

    let conn = db.connect()?;
    conn.query_row(
        "SELECT id, thread_id, role, content, blocks_json, schema_version, status,
            token_input, token_output, turn_engine_id, turn_model_id, turn_reasoning_effort, created_at
     FROM messages
     WHERE id = ?1",
        params![id],
        map_message_row,
    )
    .context("failed to load inserted message")
}

fn map_message_row(row: &Row<'_>) -> rusqlite::Result<MessageDto> {
    let blocks_raw: Option<String> = row.get(4)?;
    let token_input: i64 = row.get(7)?;
    let token_output: i64 = row.get(8)?;
    Ok(MessageDto {
        id: row.get(0)?,
        thread_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        blocks: blocks_raw.and_then(|raw| serde_json::from_str(&raw).ok()),
        turn_engine_id: row.get(9)?,
        turn_model_id: row.get(10)?,
        turn_reasoning_effort: row.get(11)?,
        schema_version: row.get(5)?,
        status: MessageStatusDto::from_str(&row.get::<_, String>(6)?),
        token_usage: if token_input > 0 || token_output > 0 {
            Some(TokenUsageDto {
                input: token_input as u64,
                output: token_output as u64,
            })
        } else {
            None
        },
        created_at: row.get(12)?,
    })
}

fn apply_answered_approvals_to_blocks(
    blocks: &mut Value,
    answered: &HashMap<String, String>,
) -> bool {
    let Some(items) = blocks.as_array_mut() else {
        return false;
    };

    let mut changed = false;
    for block in items.iter_mut() {
        let Some(object) = block.as_object_mut() else {
            continue;
        };

        if object.get("type").and_then(Value::as_str) != Some("approval") {
            continue;
        }

        let approval_id = object
            .get("approvalId")
            .and_then(Value::as_str)
            .or_else(|| object.get("approval_id").and_then(Value::as_str));
        let Some(approval_id) = approval_id else {
            continue;
        };

        let Some(decision) = answered.get(approval_id) else {
            continue;
        };

        let should_update_status = object
            .get("status")
            .and_then(Value::as_str)
            .map(|value| value != "answered")
            .unwrap_or(true);
        let should_update_decision = object
            .get("decision")
            .and_then(Value::as_str)
            .map(|value| value != decision)
            .unwrap_or(true);

        if should_update_status {
            object.insert("status".to_string(), Value::String("answered".to_string()));
            changed = true;
        }
        if should_update_decision {
            object.insert("decision".to_string(), Value::String(decision.to_string()));
            changed = true;
        }
    }

    changed
}
