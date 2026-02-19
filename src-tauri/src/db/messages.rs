use anyhow::Context;
use rusqlite::params;
use serde_json::Value;
use uuid::Uuid;

use crate::models::{MessageDto, MessageStatusDto, SearchResultDto, TokenUsageDto};

use super::Database;

pub fn insert_user_message(
    db: &Database,
    thread_id: &str,
    content: &str,
) -> anyhow::Result<MessageDto> {
    insert_message(
        db,
        thread_id,
        "user",
        Some(content.to_string()),
        None,
        MessageStatusDto::Completed,
    )
}

pub fn insert_assistant_placeholder(db: &Database, thread_id: &str) -> anyhow::Result<MessageDto> {
    insert_message(
        db,
        thread_id,
        "assistant",
        None,
        Some(serde_json::json!([])),
        MessageStatusDto::Streaming,
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
            token_input, token_output, created_at
     FROM messages
     WHERE thread_id = ?1
     ORDER BY created_at ASC",
    )?;

    let rows = stmt.query_map(params![thread_id], |row| {
        let blocks_raw: Option<String> = row.get(4)?;
        let token_input: i64 = row.get(7)?;
        let token_output: i64 = row.get(8)?;

        Ok(MessageDto {
            id: row.get(0)?,
            thread_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            blocks: blocks_raw.and_then(|raw| serde_json::from_str(&raw).ok()),
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
            created_at: row.get(9)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
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

fn insert_message(
    db: &Database,
    thread_id: &str,
    role: &str,
    content: Option<String>,
    blocks: Option<Value>,
    status: MessageStatusDto,
) -> anyhow::Result<MessageDto> {
    let id = Uuid::new_v4().to_string();
    let conn = db.connect()?;
    conn.execute(
        "INSERT INTO messages (id, thread_id, role, content, blocks_json, schema_version, status)
     VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
        params![
            id,
            thread_id,
            role,
            content,
            blocks.map(|value| value.to_string()),
            status.as_str()
        ],
    )
    .context("failed to insert message")?;

    let conn = db.connect()?;
    conn.query_row(
        "SELECT id, thread_id, role, content, blocks_json, schema_version, status,
            token_input, token_output, created_at
     FROM messages
     WHERE id = ?1",
        params![id],
        |row| {
            let blocks_raw: Option<String> = row.get(4)?;
            Ok(MessageDto {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                blocks: blocks_raw.and_then(|raw| serde_json::from_str(&raw).ok()),
                schema_version: row.get(5)?,
                status: MessageStatusDto::from_str(&row.get::<_, String>(6)?),
                token_usage: None,
                created_at: row.get(9)?,
            })
        },
    )
    .context("failed to load inserted message")
}
