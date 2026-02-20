use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, State};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::{
    db,
    engines::{EngineEvent, OutputStream, SandboxPolicy, ThreadScope, TurnCompletionStatus},
    models::{
        MessageDto, MessageStatusDto, RepoDto, SearchResultDto, ThreadDto, ThreadStatusDto,
        TrustLevelDto,
    },
    state::AppState,
};

const MAX_THREAD_TITLE_CHARS: usize = 72;
const STREAM_EVENT_COALESCE_MAX_CHARS: usize = 8_192;

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadUpdatedEvent {
    thread_id: String,
    workspace_id: String,
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    message: String,
    model_id: Option<String>,
) -> Result<String, String> {
    if state.turns.get(&thread_id).await.is_some() {
        return Err(
            "A turn is already running for this thread. Cancel it before sending another message."
                .to_string(),
        );
    }

    let mut thread = db::threads::get_thread(&state.db, &thread_id)
        .map_err(err_to_string)?
        .ok_or_else(|| format!("thread not found: {thread_id}"))?;
    let requested_model_id = model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let effective_model_id =
        resolve_turn_model_id(state.inner(), &thread, requested_model_id).await?;

    let workspace = db::workspaces::list_workspaces(&state.db)
        .map_err(err_to_string)?
        .into_iter()
        .find(|item| item.id == thread.workspace_id)
        .ok_or_else(|| format!("workspace not found for thread {}", thread.id))?;

    let repos = db::repos::get_repos(&state.db, &thread.workspace_id).map_err(err_to_string)?;
    let selected_repo = if let Some(repo_id) = &thread.repo_id {
        db::repos::find_repo_by_id(&state.db, repo_id).map_err(err_to_string)?
    } else {
        None
    };

    let workspace_root = workspace.root_path.clone();
    let scope = if let Some(repo) = selected_repo.as_ref() {
        ThreadScope::Repo {
            repo_path: repo.path.clone(),
        }
    } else {
        ThreadScope::Workspace {
            root_path: workspace_root,
            writable_roots: repos.iter().map(|repo| repo.path.clone()).collect(),
        }
    };

    if let ThreadScope::Workspace { writable_roots, .. } = &scope {
        if writable_roots.len() > 1
            && !workspace_write_opt_in_enabled(thread.engine_metadata.as_ref())
        {
            return Err(
                "Workspace thread with multiple writable repositories requires explicit confirmation before execution.".to_string(),
            );
        }
    }

    let trust_level = selected_repo
        .as_ref()
        .map(|repo| repo.trust_level.clone())
        .unwrap_or_else(|| aggregate_workspace_trust_level(&repos));
    let reasoning_effort = thread_reasoning_effort(thread.engine_metadata.as_ref());

    if requested_model_id.is_some() {
        let mut metadata = thread
            .engine_metadata
            .clone()
            .unwrap_or_else(|| serde_json::json!({}));
        if !metadata.is_object() {
            metadata = serde_json::json!({});
        }
        if let Some(object) = metadata.as_object_mut() {
            object.insert(
                "lastModelId".to_string(),
                Value::String(effective_model_id.clone()),
            );
        }
        db::threads::update_engine_metadata(&state.db, &thread.id, &metadata)
            .map_err(err_to_string)?;
        thread.engine_metadata = Some(metadata);
    }

    db::messages::insert_user_message(
        &state.db,
        &thread.id,
        &message,
        Some(thread.engine_id.as_str()),
        Some(effective_model_id.as_str()),
        reasoning_effort.as_deref(),
    )
    .map_err(err_to_string)?;
    let assistant_message = db::messages::insert_assistant_placeholder(
        &state.db,
        &thread.id,
        Some(thread.engine_id.as_str()),
        Some(effective_model_id.as_str()),
        reasoning_effort.as_deref(),
    )
    .map_err(err_to_string)?;
    db::threads::update_thread_status(&state.db, &thread.id, ThreadStatusDto::Streaming)
        .map_err(err_to_string)?;

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
        approval_policy: Some(approval_policy_for_trust_level(&trust_level).to_string()),
        reasoning_effort,
    };

    let engine_thread_id = state
        .engines
        .ensure_engine_thread(&thread, Some(effective_model_id.as_str()), scope, sandbox)
        .await
        .map_err(err_to_string)?;

    if thread.engine_thread_id.as_deref() != Some(&engine_thread_id) {
        db::threads::set_engine_thread_id(&state.db, &thread.id, &engine_thread_id)
            .map_err(err_to_string)?;
        thread.engine_thread_id = Some(engine_thread_id.clone());
    }

    let cancellation = CancellationToken::new();
    if !state
        .turns
        .try_register(&thread.id, cancellation.clone())
        .await
    {
        return Err(
            "A turn is already running for this thread. Cancel it before sending another message."
                .to_string(),
        );
    }

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
    if let Some(message_id) =
        db::actions::find_approval_message_id(&state.db, &approval_id).map_err(err_to_string)?
    {
        let _ = db::messages::mark_approval_block_answered(
            &state.db,
            &message_id,
            &approval_id,
            decision,
        );
    }

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
    let stream_event_topic = format!("stream-event-{}", thread.id);
    let approval_event_topic = format!("approval-request-{}", thread.id);
    let mut pending_event: Option<EngineEvent> = None;

    while let Some(incoming_event) = event_rx.recv().await {
        let mut current_event = incoming_event;

        loop {
            if let Some(previous_event) = pending_event.take() {
                match try_coalesce_stream_events(previous_event, current_event) {
                    Ok(merged_event) => {
                        if coalesced_event_content_len(&merged_event)
                            >= STREAM_EVENT_COALESCE_MAX_CHARS
                        {
                            process_stream_event(
                                &app,
                                &state,
                                &thread,
                                &assistant_message_id,
                                &stream_event_topic,
                                &approval_event_topic,
                                &merged_event,
                                &mut blocks,
                                &mut action_index,
                                &mut approval_index,
                                &mut message_status,
                                &mut thread_status,
                                &mut token_usage,
                                max_output_chars,
                            );
                        } else {
                            pending_event = Some(merged_event);
                        }
                        break;
                    }
                    Err((unmerged_previous_event, unmerged_current_event)) => {
                        process_stream_event(
                            &app,
                            &state,
                            &thread,
                            &assistant_message_id,
                            &stream_event_topic,
                            &approval_event_topic,
                            &unmerged_previous_event,
                            &mut blocks,
                            &mut action_index,
                            &mut approval_index,
                            &mut message_status,
                            &mut thread_status,
                            &mut token_usage,
                            max_output_chars,
                        );
                        current_event = unmerged_current_event;
                    }
                }
            } else if is_coalescable_stream_event(&current_event) {
                pending_event = Some(current_event);
                break;
            } else {
                process_stream_event(
                    &app,
                    &state,
                    &thread,
                    &assistant_message_id,
                    &stream_event_topic,
                    &approval_event_topic,
                    &current_event,
                    &mut blocks,
                    &mut action_index,
                    &mut approval_index,
                    &mut message_status,
                    &mut thread_status,
                    &mut token_usage,
                    max_output_chars,
                );
                break;
            }
        }
    }

    if let Some(event) = pending_event.take() {
        process_stream_event(
            &app,
            &state,
            &thread,
            &assistant_message_id,
            &stream_event_topic,
            &approval_event_topic,
            &event,
            &mut blocks,
            &mut action_index,
            &mut approval_index,
            &mut message_status,
            &mut thread_status,
            &mut token_usage,
            max_output_chars,
        );
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
                &stream_event_topic,
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

    if maybe_update_thread_title(&state, &thread, &engine_thread_id, &message)
        .await
        .is_some()
    {
        let _ = app.emit(
            "thread-updated",
            ThreadUpdatedEvent {
                thread_id: thread.id.clone(),
                workspace_id: thread.workspace_id.clone(),
            },
        );
    }

    state.turns.finish(&thread.id).await;
}

fn is_coalescable_stream_event(event: &EngineEvent) -> bool {
    matches!(
        event,
        EngineEvent::TextDelta { .. }
            | EngineEvent::ThinkingDelta { .. }
            | EngineEvent::ActionOutputDelta { .. }
    )
}

fn coalesced_event_content_len(event: &EngineEvent) -> usize {
    match event {
        EngineEvent::TextDelta { content }
        | EngineEvent::ThinkingDelta { content }
        | EngineEvent::ActionOutputDelta { content, .. } => content.len(),
        _ => 0,
    }
}

fn same_output_stream(left: &OutputStream, right: &OutputStream) -> bool {
    matches!(
        (left, right),
        (OutputStream::Stdout, OutputStream::Stdout) | (OutputStream::Stderr, OutputStream::Stderr)
    )
}

fn try_coalesce_stream_events(
    previous: EngineEvent,
    next: EngineEvent,
) -> Result<EngineEvent, (EngineEvent, EngineEvent)> {
    match (previous, next) {
        (
            EngineEvent::TextDelta { mut content },
            EngineEvent::TextDelta {
                content: next_content,
            },
        ) => {
            content.push_str(&next_content);
            Ok(EngineEvent::TextDelta { content })
        }
        (
            EngineEvent::ThinkingDelta { mut content },
            EngineEvent::ThinkingDelta {
                content: next_content,
            },
        ) => {
            content.push_str(&next_content);
            Ok(EngineEvent::ThinkingDelta { content })
        }
        (
            EngineEvent::ActionOutputDelta {
                action_id,
                stream,
                mut content,
            },
            EngineEvent::ActionOutputDelta {
                action_id: next_action_id,
                stream: next_stream,
                content: next_content,
            },
        ) => {
            if action_id == next_action_id && same_output_stream(&stream, &next_stream) {
                content.push_str(&next_content);
                Ok(EngineEvent::ActionOutputDelta {
                    action_id,
                    stream,
                    content,
                })
            } else {
                Err((
                    EngineEvent::ActionOutputDelta {
                        action_id,
                        stream,
                        content,
                    },
                    EngineEvent::ActionOutputDelta {
                        action_id: next_action_id,
                        stream: next_stream,
                        content: next_content,
                    },
                ))
            }
        }
        (previous, next) => Err((previous, next)),
    }
}

#[allow(clippy::too_many_arguments)]
fn process_stream_event(
    app: &tauri::AppHandle,
    state: &AppState,
    thread: &ThreadDto,
    assistant_message_id: &str,
    stream_event_topic: &str,
    approval_event_topic: &str,
    event: &EngineEvent,
    blocks: &mut Vec<ContentBlock>,
    action_index: &mut HashMap<String, usize>,
    approval_index: &mut HashMap<String, usize>,
    message_status: &mut MessageStatusDto,
    thread_status: &mut ThreadStatusDto,
    token_usage: &mut Option<(u64, u64)>,
    max_output_chars: usize,
) {
    let _ = app.emit(stream_event_topic, event);
    if matches!(event, EngineEvent::ApprovalRequested { .. }) {
        let _ = app.emit(approval_event_topic, event);
    }

    if state.config.debug.persist_engine_event_logs {
        if let Ok(value) = serde_json::to_value(event) {
            let _ =
                db::actions::append_event_log(&state.db, &thread.id, assistant_message_id, &value);
        }
    }

    match event {
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
                assistant_message_id,
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
                assistant_message_id,
                action_type,
                summary,
                details,
            );
        }
        _ => {}
    }

    let progress = apply_event_to_blocks(
        blocks,
        action_index,
        approval_index,
        event,
        max_output_chars,
    );

    if let Some(status) = progress.message_status {
        *message_status = status;
    }

    if let Some(status) = progress.thread_status {
        *thread_status = status;
        let _ = db::threads::update_thread_status(&state.db, &thread.id, thread_status.clone());
    }

    if let Some(tokens) = progress.token_usage {
        *token_usage = Some(tokens);
    }

    if let Ok(blocks_json) = serde_json::to_value(blocks) {
        let _ = db::messages::update_assistant_blocks(
            &state.db,
            assistant_message_id,
            &blocks_json,
            message_status.clone(),
        );
    }
}

async fn maybe_update_thread_title(
    state: &AppState,
    thread: &ThreadDto,
    engine_thread_id: &str,
    user_message: &str,
) -> Option<String> {
    if !should_autotitle_thread(thread) {
        return None;
    }

    let candidate = state
        .engines
        .read_thread_preview(thread, engine_thread_id)
        .await
        .as_deref()
        .and_then(normalize_thread_title)
        .or_else(|| normalize_thread_title(user_message))?;

    if candidate == thread.title {
        return None;
    }

    if let Err(error) = db::threads::update_thread_title(&state.db, &thread.id, &candidate) {
        log::warn!("failed to update thread title: {error}");
        return None;
    }

    if let Err(error) = state
        .engines
        .set_thread_name(thread, engine_thread_id, &candidate)
        .await
    {
        log::debug!("failed to sync thread name with engine: {error}");
    }

    Some(candidate)
}

fn should_autotitle_thread(thread: &ThreadDto) -> bool {
    thread.message_count == 0 && !thread_manual_title_locked(thread.engine_metadata.as_ref())
}

fn thread_manual_title_locked(metadata: Option<&Value>) -> bool {
    metadata
        .and_then(|value| value.get("manualTitle"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn normalize_thread_title(raw: &str) -> Option<String> {
    let compact = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut title = compact.trim_matches(|c| c == '"' || c == '\'').to_string();
    if title.is_empty() {
        return None;
    }

    if title.chars().count() > MAX_THREAD_TITLE_CHARS {
        title = truncate_title(title, MAX_THREAD_TITLE_CHARS);
    }

    Some(title)
}

fn truncate_title(value: String, max_chars: usize) -> String {
    let count = value.chars().count();
    if count <= max_chars {
        return value;
    }

    if max_chars <= 3 {
        return value.chars().take(max_chars).collect::<String>();
    }

    let mut output = value.chars().take(max_chars - 3).collect::<String>();
    output.push_str("...");
    output
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
        EngineEvent::TurnCompleted {
            token_usage,
            status,
        } => {
            match status {
                TurnCompletionStatus::Completed => {
                    progress.message_status = Some(MessageStatusDto::Completed);
                    progress.thread_status = Some(ThreadStatusDto::Completed);
                }
                TurnCompletionStatus::Interrupted => {
                    progress.message_status = Some(MessageStatusDto::Interrupted);
                    progress.thread_status = Some(ThreadStatusDto::Idle);
                }
                TurnCompletionStatus::Failed => {
                    progress.message_status = Some(MessageStatusDto::Error);
                    progress.thread_status = Some(ThreadStatusDto::Error);
                }
            }
            progress.token_usage = token_usage
                .as_ref()
                .map(|usage| (usage.input, usage.output));
        }
        EngineEvent::TextDelta { content } => {
            append_text_delta(blocks, content);
        }
        EngineEvent::ThinkingDelta { content } => {
            append_thinking_delta(blocks, content);
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
        EngineEvent::Error {
            message,
            recoverable,
        } => {
            blocks.push(ContentBlock::Error {
                message: message.to_string(),
            });
            if !recoverable {
                progress.message_status = Some(MessageStatusDto::Error);
                progress.thread_status = Some(ThreadStatusDto::Error);
            }
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

fn append_thinking_delta(blocks: &mut Vec<ContentBlock>, content: &str) {
    if let Some(ContentBlock::Thinking { content: current }) = blocks.last_mut() {
        current.push_str(content);
        return;
    }

    blocks.push(ContentBlock::Thinking {
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

fn workspace_write_opt_in_enabled(metadata: Option<&Value>) -> bool {
    metadata
        .and_then(|value| value.get("workspaceWriteOptIn"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn aggregate_workspace_trust_level(repos: &[RepoDto]) -> TrustLevelDto {
    if repos
        .iter()
        .any(|repo| matches!(repo.trust_level, TrustLevelDto::Restricted))
    {
        return TrustLevelDto::Restricted;
    }

    if !repos.is_empty()
        && repos
            .iter()
            .all(|repo| matches!(repo.trust_level, TrustLevelDto::Trusted))
    {
        return TrustLevelDto::Trusted;
    }

    TrustLevelDto::Standard
}

fn approval_policy_for_trust_level(trust_level: &TrustLevelDto) -> &'static str {
    match trust_level {
        TrustLevelDto::Trusted => "on-failure",
        TrustLevelDto::Standard => "on-request",
        TrustLevelDto::Restricted => "untrusted",
    }
}

fn thread_reasoning_effort(metadata: Option<&Value>) -> Option<String> {
    metadata
        .and_then(|value| value.get("reasoningEffort"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

async fn resolve_turn_model_id(
    state: &AppState,
    thread: &ThreadDto,
    requested_model_id: Option<&str>,
) -> Result<String, String> {
    let Some(requested_model_id) = requested_model_id else {
        return Ok(thread.model_id.clone());
    };

    if requested_model_id == thread.model_id {
        return Ok(thread.model_id.clone());
    }

    if let Ok(engines) = state.engines.list_engines().await {
        if let Some(engine) = engines.iter().find(|engine| engine.id == thread.engine_id) {
            if engine
                .models
                .iter()
                .any(|model| model.id == requested_model_id)
            {
                return Ok(requested_model_id.to_string());
            }

            let available = engine
                .models
                .iter()
                .map(|model| model.id.clone())
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!(
                "model `{requested_model_id}` is not supported by engine `{}`. available models: {available}",
                thread.engine_id
            ));
        }
    }

    Ok(requested_model_id.to_string())
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
