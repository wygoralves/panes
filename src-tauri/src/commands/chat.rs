use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, State};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::{
    db,
    engines::{EngineEvent, OutputStream, SandboxPolicy, ThreadScope},
    models::{MessageDto, MessageStatusDto, SearchResultDto, ThreadStatusDto},
    state::AppState,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text { content: String },

    #[serde(rename = "diff")]
    Diff { diff: String, scope: String },

    #[serde(rename = "action")]
    Action {
        #[serde(rename = "actionId")]
        action_id: String,
        #[serde(rename = "engineActionId", skip_serializing_if = "Option::is_none")]
        engine_action_id: Option<String>,
        #[serde(rename = "actionType")]
        action_type: String,
        summary: String,
        details: Value,
        #[serde(rename = "outputChunks")]
        output_chunks: Vec<ActionOutputChunk>,
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<ActionBlockResult>,
    },

    #[serde(rename = "approval")]
    Approval {
        #[serde(rename = "approvalId")]
        approval_id: String,
        #[serde(rename = "actionType")]
        action_type: String,
        summary: String,
        details: Value,
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        decision: Option<String>,
    },

    #[serde(rename = "thinking")]
    Thinking { content: String },

    #[serde(rename = "error")]
    Error { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ActionOutputChunk {
    stream: String,
    content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionBlockResult {
    success: bool,
    output: Option<String>,
    error: Option<String>,
    diff: Option<String>,
    duration_ms: u64,
}

#[derive(Default)]
struct EventProgress {
    message_status: Option<MessageStatusDto>,
    thread_status: Option<ThreadStatusDto>,
    token_usage: Option<(u64, u64)>,
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    message: String,
) -> Result<String, String> {
    let mut thread = db::threads::get_thread(&state.db, &thread_id)
        .map_err(err_to_string)?
        .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    let workspace = db::workspaces::list_workspaces(&state.db)
        .map_err(err_to_string)?
        .into_iter()
        .find(|item| item.id == thread.workspace_id)
        .ok_or_else(|| format!("workspace not found for thread {}", thread.id))?;

    db::messages::insert_user_message(&state.db, &thread.id, &message).map_err(err_to_string)?;
    let assistant_message =
        db::messages::insert_assistant_placeholder(&state.db, &thread.id).map_err(err_to_string)?;
    db::threads::update_thread_status(&state.db, &thread.id, ThreadStatusDto::Streaming)
        .map_err(err_to_string)?;

    let repos = db::repos::get_repos(&state.db, &thread.workspace_id).map_err(err_to_string)?;
    let workspace_root = workspace.root_path.clone();
    let scope = if let Some(repo_id) = &thread.repo_id {
        if let Some(repo) = db::repos::find_repo_by_id(&state.db, repo_id).map_err(err_to_string)? {
            ThreadScope::Repo {
                repo_path: repo.path.clone(),
            }
        } else {
            ThreadScope::Workspace {
                root_path: workspace_root.clone(),
                writable_roots: repos.iter().map(|repo| repo.path.clone()).collect(),
            }
        }
    } else {
        ThreadScope::Workspace {
            root_path: workspace_root,
            writable_roots: repos.iter().map(|repo| repo.path.clone()).collect(),
        }
    };

    let writable_roots = match &scope {
        ThreadScope::Repo { repo_path } => vec![repo_path.clone()],
        ThreadScope::Workspace {
            writable_roots,
            root_path,
        } => {
            if writable_roots.is_empty() {
                vec![root_path.clone()]
            } else {
                writable_roots.clone()
            }
        }
    };

    let sandbox = SandboxPolicy {
        writable_roots,
        allow_network: false,
    };

    let engine_thread_id = state
        .engines
        .ensure_engine_thread(&thread, scope, sandbox)
        .await
        .map_err(err_to_string)?;

    if thread.engine_thread_id.as_deref() != Some(&engine_thread_id) {
        db::threads::set_engine_thread_id(&state.db, &thread.id, &engine_thread_id)
            .map_err(err_to_string)?;
        thread.engine_thread_id = Some(engine_thread_id.clone());
    }

    let cancellation = CancellationToken::new();
    state.turns.register(&thread.id, cancellation.clone()).await;

    let state_cloned = state.inner().clone();
    let app_handle = app.clone();
    let assistant_message_id = assistant_message.id.clone();
    let message_to_send = message.clone();
    let thread_for_task = thread.clone();

    tokio::spawn(async move {
        run_turn(
            app_handle,
            state_cloned,
            thread_for_task,
            engine_thread_id,
            assistant_message_id,
            message_to_send,
            cancellation,
        )
        .await;
    });

    Ok(assistant_message.id)
}

#[tauri::command]
pub async fn cancel_turn(state: State<'_, AppState>, thread_id: String) -> Result<(), String> {
    state.turns.cancel(&thread_id).await;

    if let Some(thread) = db::threads::get_thread(&state.db, &thread_id).map_err(err_to_string)? {
        state
            .engines
            .interrupt(&thread)
            .await
            .map_err(err_to_string)?;
    }

    db::threads::update_thread_status(&state.db, &thread_id, ThreadStatusDto::Idle)
        .map_err(err_to_string)?;
    state.turns.finish(&thread_id).await;
    Ok(())
}

#[tauri::command]
pub async fn respond_to_approval(
    state: State<'_, AppState>,
    thread_id: String,
    approval_id: String,
    response: Value,
) -> Result<(), String> {
    if !response.is_object() {
        return Err("approval response must be a JSON object".to_string());
    }

    let thread = db::threads::get_thread(&state.db, &thread_id)
        .map_err(err_to_string)?
        .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    state
        .engines
        .respond_to_approval(&thread, &approval_id, response.clone())
        .await
        .map_err(err_to_string)?;

    let decision = response
        .get("decision")
        .and_then(|value| value.as_str())
        .unwrap_or("custom");
    db::actions::answer_approval(&state.db, &approval_id, decision).map_err(err_to_string)?;

    db::threads::update_thread_status(&state.db, &thread_id, ThreadStatusDto::Streaming)
        .map_err(err_to_string)?;

    Ok(())
}

#[tauri::command]
pub async fn get_thread_messages(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<Vec<MessageDto>, String> {
    db::messages::get_thread_messages(&state.db, &thread_id).map_err(err_to_string)
}

#[tauri::command]
pub async fn search_messages(
    state: State<'_, AppState>,
    workspace_id: String,
    query: String,
) -> Result<Vec<SearchResultDto>, String> {
    db::messages::search_messages(&state.db, &workspace_id, &query).map_err(err_to_string)
}

async fn run_turn(
    app: tauri::AppHandle,
    state: AppState,
    thread: crate::models::ThreadDto,
    engine_thread_id: String,
    assistant_message_id: String,
    message: String,
    cancellation: CancellationToken,
) {
    let max_output_chars = state.config.debug.max_action_output_chars;
    let (event_tx, mut event_rx) = mpsc::channel::<EngineEvent>(128);

    let engines = state.engines.clone();
    let thread_for_engine = thread.clone();
    let message_for_engine = message.clone();
    let engine_thread_for_engine = engine_thread_id.clone();
    let cancellation_for_engine = cancellation.clone();

    let engine_task = tokio::spawn(async move {
        engines
            .send_message(
                &thread_for_engine,
                &engine_thread_for_engine,
                &message_for_engine,
                event_tx,
                cancellation_for_engine,
            )
            .await
    });

    let mut blocks: Vec<ContentBlock> = Vec::new();
    let mut action_index: HashMap<String, usize> = HashMap::new();
    let mut approval_index: HashMap<String, usize> = HashMap::new();
    let mut message_status = MessageStatusDto::Streaming;
    let mut thread_status = ThreadStatusDto::Streaming;
    let mut token_usage: Option<(u64, u64)> = None;

    while let Some(event) = event_rx.recv().await {
        let _ = app.emit(&format!("stream-event-{}", thread.id), &event);
        if matches!(event, EngineEvent::ApprovalRequested { .. }) {
            let _ = app.emit(&format!("approval-request-{}", thread.id), &event);
        }

        if state.config.debug.persist_engine_event_logs {
            if let Ok(value) = serde_json::to_value(&event) {
                let _ = db::actions::append_event_log(
                    &state.db,
                    &thread.id,
                    &assistant_message_id,
                    &value,
                );
            }
        }

        match &event {
            EngineEvent::ActionStarted {
                action_id,
                engine_action_id,
                action_type,
                summary,
                details,
            } => {
                let _ = db::actions::insert_action_started(
                    &state.db,
                    action_id,
                    &thread.id,
                    &assistant_message_id,
                    engine_action_id.as_deref(),
                    action_type,
                    summary,
                    details,
                );
            }
            EngineEvent::ActionCompleted { action_id, result } => {
                let _ = db::actions::update_action_completed(&state.db, action_id, result);
            }
            EngineEvent::ApprovalRequested {
                approval_id,
                action_type,
                summary,
                details,
            } => {
                let _ = db::actions::insert_approval(
                    &state.db,
                    approval_id,
                    &thread.id,
                    &assistant_message_id,
                    action_type,
                    summary,
                    details,
                );
            }
            _ => {}
        }

        let progress = apply_event_to_blocks(
            &mut blocks,
            &mut action_index,
            &mut approval_index,
            &event,
            max_output_chars,
        );

        if let Some(status) = progress.message_status {
            message_status = status;
        }

        if let Some(status) = progress.thread_status {
            thread_status = status;
            let _ = db::threads::update_thread_status(&state.db, &thread.id, thread_status.clone());
        }

        if let Some(tokens) = progress.token_usage {
            token_usage = Some(tokens);
        }

        if let Ok(blocks_json) = serde_json::to_value(&blocks) {
            let _ = db::messages::update_assistant_blocks(
                &state.db,
                &assistant_message_id,
                &blocks_json,
                message_status.clone(),
            );
        }
    }

    match engine_task.await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            blocks.push(ContentBlock::Error {
                message: format!("Engine error: {error}"),
            });
            message_status = MessageStatusDto::Error;
            thread_status = ThreadStatusDto::Error;
            let _ = app.emit(
                &format!("stream-event-{}", thread.id),
                EngineEvent::Error {
                    message: format!("{error}"),
                    recoverable: false,
                },
            );
        }
        Err(error) => {
            blocks.push(ContentBlock::Error {
                message: format!("Engine task join error: {error}"),
            });
            message_status = MessageStatusDto::Error;
            thread_status = ThreadStatusDto::Error;
        }
    }

    if cancellation.is_cancelled() && matches!(message_status, MessageStatusDto::Streaming) {
        message_status = MessageStatusDto::Interrupted;
        thread_status = ThreadStatusDto::Idle;
    }

    if let Ok(blocks_json) = serde_json::to_value(&blocks) {
        let _ = db::messages::update_assistant_blocks(
            &state.db,
            &assistant_message_id,
            &blocks_json,
            message_status.clone(),
        );
    }

    let _ = db::messages::complete_assistant_message(
        &state.db,
        &assistant_message_id,
        message_status.clone(),
        token_usage,
    );
    let _ = db::threads::update_thread_status(&state.db, &thread.id, thread_status.clone());

    if matches!(message_status, MessageStatusDto::Completed) {
        let _ = db::threads::bump_message_counters(&state.db, &thread.id, token_usage);
    }

    state.turns.finish(&thread.id).await;
}

fn apply_event_to_blocks(
    blocks: &mut Vec<ContentBlock>,
    action_index: &mut HashMap<String, usize>,
    approval_index: &mut HashMap<String, usize>,
    event: &EngineEvent,
    max_output_chars: usize,
) -> EventProgress {
    let mut progress = EventProgress::default();

    match event {
        EngineEvent::TurnStarted => {
            progress.thread_status = Some(ThreadStatusDto::Streaming);
        }
        EngineEvent::TurnCompleted { token_usage } => {
            progress.message_status = Some(MessageStatusDto::Completed);
            progress.thread_status = Some(ThreadStatusDto::Completed);
            progress.token_usage = token_usage
                .as_ref()
                .map(|usage| (usage.input, usage.output));
        }
        EngineEvent::TextDelta { content } => {
            append_text_delta(blocks, content);
        }
        EngineEvent::ThinkingDelta { content } => {
            blocks.push(ContentBlock::Thinking {
                content: content.to_string(),
            });
        }
        EngineEvent::ActionStarted {
            action_id,
            engine_action_id,
            action_type,
            summary,
            details,
        } => {
            let block = ContentBlock::Action {
                action_id: action_id.to_string(),
                engine_action_id: engine_action_id.clone(),
                action_type: action_type.as_str().to_string(),
                summary: summary.to_string(),
                details: details.clone(),
                output_chunks: Vec::new(),
                status: "running".to_string(),
                result: None,
            };
            upsert_action_block(blocks, action_index, action_id, block);
        }
        EngineEvent::ActionOutputDelta {
            action_id,
            stream,
            content,
        } => {
            if let Some(index) = action_index.get(action_id).copied() {
                if let Some(ContentBlock::Action { output_chunks, .. }) = blocks.get_mut(index) {
                    output_chunks.push(ActionOutputChunk {
                        stream: match stream {
                            OutputStream::Stdout => "stdout".to_string(),
                            OutputStream::Stderr => "stderr".to_string(),
                        },
                        content: truncate_chars(content, max_output_chars),
                    });
                }
            }
        }
        EngineEvent::ActionCompleted { action_id, result } => {
            if let Some(index) = action_index.get(action_id).copied() {
                if let Some(ContentBlock::Action {
                    status,
                    result: block_result,
                    ..
                }) = blocks.get_mut(index)
                {
                    *status = if result.success { "done" } else { "error" }.to_string();
                    *block_result = Some(ActionBlockResult {
                        success: result.success,
                        output: result.output.clone(),
                        error: result.error.clone(),
                        diff: result.diff.clone(),
                        duration_ms: result.duration_ms,
                    });
                }
            }
        }
        EngineEvent::DiffUpdated { diff, scope } => {
            let scope = match scope {
                crate::engines::DiffScope::Turn => "turn",
                crate::engines::DiffScope::File => "file",
                crate::engines::DiffScope::Workspace => "workspace",
            }
            .to_string();

            blocks.push(ContentBlock::Diff {
                diff: diff.to_string(),
                scope,
            });
        }
        EngineEvent::ApprovalRequested {
            approval_id,
            action_type,
            summary,
            details,
        } => {
            let block = ContentBlock::Approval {
                approval_id: approval_id.to_string(),
                action_type: action_type.as_str().to_string(),
                summary: summary.to_string(),
                details: details.clone(),
                status: "pending".to_string(),
                decision: None,
            };
            upsert_approval_block(blocks, approval_index, approval_id, block);
            progress.thread_status = Some(ThreadStatusDto::AwaitingApproval);
        }
        EngineEvent::Error { message, .. } => {
            blocks.push(ContentBlock::Error {
                message: message.to_string(),
            });
            progress.message_status = Some(MessageStatusDto::Error);
            progress.thread_status = Some(ThreadStatusDto::Error);
        }
    }

    progress
}

fn append_text_delta(blocks: &mut Vec<ContentBlock>, content: &str) {
    if let Some(ContentBlock::Text { content: current }) = blocks.last_mut() {
        current.push_str(content);
        return;
    }

    blocks.push(ContentBlock::Text {
        content: content.to_string(),
    });
}

fn upsert_action_block(
    blocks: &mut Vec<ContentBlock>,
    action_index: &mut HashMap<String, usize>,
    action_id: &str,
    block: ContentBlock,
) {
    if let Some(index) = action_index.get(action_id).copied() {
        if let Some(existing) = blocks.get_mut(index) {
            *existing = block;
            return;
        }
    }

    let index = blocks.len();
    blocks.push(block);
    action_index.insert(action_id.to_string(), index);
}

fn upsert_approval_block(
    blocks: &mut Vec<ContentBlock>,
    approval_index: &mut HashMap<String, usize>,
    approval_id: &str,
    block: ContentBlock,
) {
    if let Some(index) = approval_index.get(approval_id).copied() {
        if let Some(existing) = blocks.get_mut(index) {
            *existing = block;
            return;
        }
    }

    let index = blocks.len();
    blocks.push(block);
    approval_index.insert(approval_id.to_string(), index);
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }

    let mut output = value.chars().take(max_chars).collect::<String>();
    output.push_str("\n... [truncated]");
    output
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
