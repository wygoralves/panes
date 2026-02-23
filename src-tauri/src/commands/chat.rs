use std::{
    collections::HashMap,
    path::Path,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, State};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::{
    db,
    engines::{
        EngineEvent, OutputStream, SandboxPolicy, ThreadScope, TurnAttachment,
        TurnCompletionStatus, TurnInput,
    },
    models::{
        MessageDto, MessageStatusDto, RepoDto, SearchResultDto, ThreadDto, ThreadStatusDto,
        TrustLevelDto,
    },
    state::AppState,
};

const MAX_THREAD_TITLE_CHARS: usize = 72;
const STREAM_EVENT_COALESCE_MAX_CHARS: usize = 8_192;
const STREAM_DB_FLUSH_INTERVAL: Duration = Duration::from_millis(180);
const ACTION_OUTPUT_MAX_CHUNKS: usize = 240;
const MAX_ATTACHMENTS_PER_TURN: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text {
        content: String,
        #[serde(rename = "planMode", skip_serializing_if = "Option::is_none")]
        plan_mode: Option<bool>,
    },

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

    #[serde(rename = "attachment")]
    Attachment {
        #[serde(rename = "fileName")]
        file_name: String,
        #[serde(rename = "filePath")]
        file_path: String,
        #[serde(rename = "sizeBytes")]
        size_bytes: u64,
        #[serde(rename = "mimeType", skip_serializing_if = "Option::is_none")]
        mime_type: Option<String>,
    },
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
    blocks_changed: bool,
    force_persist: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadUpdatedEvent {
    thread_id: String,
    workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachmentPayload {
    pub file_name: String,
    pub file_path: String,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub mime_type: Option<String>,
}

async fn run_db<T, F>(db: crate::db::Database, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&crate::db::Database) -> anyhow::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || operation(&db))
        .await
        .map_err(|error| error.to_string())?
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    message: String,
    model_id: Option<String>,
    attachments: Option<Vec<ChatAttachmentPayload>>,
    plan_mode: Option<bool>,
) -> Result<String, String> {
    if state.turns.get(&thread_id).await.is_some() {
        return Err(
            "A turn is already running for this thread. Cancel it before sending another message."
                .to_string(),
        );
    }

    let db = state.db.clone();
    let mut thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;
    let requested_model_id = model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let attachments = normalize_attachments(attachments)?;
    let plan_mode = plan_mode.unwrap_or(false);
    let turn_input = TurnInput {
        message: message.clone(),
        attachments: attachments.clone(),
        plan_mode,
    };
    let effective_model_id =
        resolve_turn_model_id(state.inner(), &thread, requested_model_id).await?;

    let (workspace, repos, selected_repo) = run_db(db.clone(), {
        let workspace_id = thread.workspace_id.clone();
        let thread_id = thread.id.clone();
        let repo_id = thread.repo_id.clone();
        move |db| {
            let workspace = db::workspaces::list_workspaces(db)?
                .into_iter()
                .find(|item| item.id == workspace_id)
                .ok_or_else(|| anyhow::anyhow!("workspace not found for thread {thread_id}"))?;
            let repos = db::repos::get_repos(db, &workspace_id)?;
            let selected_repo = if let Some(repo_id) = repo_id.as_deref() {
                db::repos::find_repo_by_id(db, repo_id)?
            } else {
                None
            };
            Ok((workspace, repos, selected_repo))
        }
    })
    .await?;

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
        run_db(db.clone(), {
            let thread_id = thread.id.clone();
            let metadata = metadata.clone();
            move |db| db::threads::update_engine_metadata(db, &thread_id, &metadata)
        })
        .await?;
        thread.engine_metadata = Some(metadata);
    }

    let assistant_message = run_db(db.clone(), {
        let thread_id = thread.id.clone();
        let message = message.clone();
        let attachments = attachments.clone();
        let plan_mode_enabled = plan_mode;
        let engine_id = thread.engine_id.clone();
        let model_id = effective_model_id.clone();
        let reasoning_effort = reasoning_effort.clone();
        move |db| {
            let mut user_blocks = Vec::with_capacity(attachments.len().saturating_add(1));
            for attachment in &attachments {
                user_blocks.push(ContentBlock::Attachment {
                    file_name: attachment.file_name.clone(),
                    file_path: attachment.file_path.clone(),
                    size_bytes: attachment.size_bytes,
                    mime_type: attachment.mime_type.clone(),
                });
            }
            user_blocks.push(ContentBlock::Text {
                content: message.clone(),
                plan_mode: if plan_mode_enabled { Some(true) } else { None },
            });
            db::messages::insert_user_message(
                db,
                &thread_id,
                &message,
                Some(serde_json::to_value(&user_blocks)?),
                Some(engine_id.as_str()),
                Some(model_id.as_str()),
                reasoning_effort.as_deref(),
            )?;
            let assistant_message = db::messages::insert_assistant_placeholder(
                db,
                &thread_id,
                Some(engine_id.as_str()),
                Some(model_id.as_str()),
                reasoning_effort.as_deref(),
            )?;
            db::threads::update_thread_status(db, &thread_id, ThreadStatusDto::Streaming)?;
            Ok(assistant_message)
        }
    })
    .await?;

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
        allow_network: allow_network_for_trust_level(&trust_level),
        approval_policy: Some(approval_policy_for_trust_level(&trust_level).to_string()),
        reasoning_effort,
    };

    let engine_thread_id = state
        .engines
        .ensure_engine_thread(&thread, Some(effective_model_id.as_str()), scope, sandbox)
        .await
        .map_err(err_to_string)?;

    if thread.engine_thread_id.as_deref() != Some(&engine_thread_id) {
        run_db(db.clone(), {
            let thread_id = thread.id.clone();
            let engine_thread_id = engine_thread_id.clone();
            move |db| db::threads::set_engine_thread_id(db, &thread_id, &engine_thread_id)
        })
        .await?;
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
    let turn_input_for_task = turn_input.clone();
    let thread_for_task = thread.clone();

    tokio::spawn(async move {
        run_turn(
            app_handle,
            state_cloned,
            thread_for_task,
            engine_thread_id,
            assistant_message_id,
            turn_input_for_task,
            cancellation,
        )
        .await;
    });

    Ok(assistant_message.id)
}

fn normalize_attachments(
    attachments: Option<Vec<ChatAttachmentPayload>>,
) -> Result<Vec<TurnAttachment>, String> {
    let attachments = attachments.unwrap_or_default();
    if attachments.len() > MAX_ATTACHMENTS_PER_TURN {
        return Err(format!(
            "You can attach at most {MAX_ATTACHMENTS_PER_TURN} files per turn."
        ));
    }

    let mut normalized = Vec::with_capacity(attachments.len());
    for attachment in attachments {
        let file_path = attachment.file_path.trim().to_string();
        if file_path.is_empty() {
            return Err("Attachment path cannot be empty.".to_string());
        }

        let file_name = if attachment.file_name.trim().is_empty() {
            Path::new(&file_path)
                .file_name()
                .and_then(|value| value.to_str())
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| file_path.clone())
        } else {
            attachment.file_name.trim().to_string()
        };

        normalized.push(TurnAttachment {
            file_name,
            file_path,
            size_bytes: attachment.size_bytes,
            mime_type: attachment.mime_type,
        });
    }

    Ok(normalized)
}

#[tauri::command]
pub async fn cancel_turn(state: State<'_, AppState>, thread_id: String) -> Result<(), String> {
    state.turns.cancel(&thread_id).await;

    let db = state.db.clone();
    if let Some(thread) = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    {
        state
            .engines
            .interrupt(&thread)
            .await
            .map_err(err_to_string)?;
    }

    run_db(db, {
        let thread_id = thread_id.clone();
        move |db| db::threads::update_thread_status(db, &thread_id, ThreadStatusDto::Idle)
    })
    .await?;
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

    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
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
    run_db(db, {
        let approval_id = approval_id.clone();
        let thread_id = thread_id.clone();
        let decision = decision.to_string();
        move |db| {
            db::actions::answer_approval(db, &approval_id, &decision)?;
            if let Some(message_id) = db::actions::find_approval_message_id(db, &approval_id)? {
                let _ = db::messages::mark_approval_block_answered(
                    db,
                    &message_id,
                    &approval_id,
                    &decision,
                );
            }
            db::threads::update_thread_status(db, &thread_id, ThreadStatusDto::Streaming)?;
            Ok(())
        }
    })
    .await?;

    Ok(())
}

#[tauri::command]
pub async fn get_thread_messages(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<Vec<MessageDto>, String> {
    run_db(state.db.clone(), move |db| {
        db::messages::get_thread_messages(db, &thread_id)
    })
    .await
}

#[tauri::command]
pub async fn search_messages(
    state: State<'_, AppState>,
    workspace_id: String,
    query: String,
) -> Result<Vec<SearchResultDto>, String> {
    run_db(state.db.clone(), move |db| {
        db::messages::search_messages(db, &workspace_id, &query)
    })
    .await
}

async fn run_turn(
    app: tauri::AppHandle,
    state: AppState,
    thread: crate::models::ThreadDto,
    engine_thread_id: String,
    assistant_message_id: String,
    turn_input: TurnInput,
    cancellation: CancellationToken,
) {
    let max_output_chars = state.config.debug.max_action_output_chars;
    let (event_tx, mut event_rx) = mpsc::channel::<EngineEvent>(128);

    let engines = state.engines.clone();
    let thread_for_engine = thread.clone();
    let input_for_engine = turn_input.clone();
    let engine_thread_for_engine = engine_thread_id.clone();
    let cancellation_for_engine = cancellation.clone();

    let engine_task = tokio::spawn(async move {
        engines
            .send_message(
                &thread_for_engine,
                &engine_thread_for_engine,
                input_for_engine,
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
    let mut blocks_dirty = false;
    let mut message_state_dirty = false;
    let mut thread_status_dirty = false;
    let mut last_persist_at = Instant::now();
    let mut last_persisted_thread_status = thread_status.clone();
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
                            let progress = process_stream_event(
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
                                max_output_chars,
                            )
                            .await;
                            let force_persist = apply_stream_progress(
                                progress,
                                &mut message_status,
                                &mut thread_status,
                                &mut token_usage,
                                &mut blocks_dirty,
                                &mut message_state_dirty,
                                &mut thread_status_dirty,
                            );
                            flush_stream_state(
                                &state,
                                &thread,
                                &assistant_message_id,
                                &blocks,
                                &message_status,
                                &thread_status,
                                &mut blocks_dirty,
                                &mut message_state_dirty,
                                &mut thread_status_dirty,
                                &mut last_persisted_thread_status,
                                &mut last_persist_at,
                                force_persist,
                            )
                            .await;
                        } else {
                            pending_event = Some(merged_event);
                        }
                        break;
                    }
                    Err((unmerged_previous_event, unmerged_current_event)) => {
                        let progress = process_stream_event(
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
                            max_output_chars,
                        )
                        .await;
                        let force_persist = apply_stream_progress(
                            progress,
                            &mut message_status,
                            &mut thread_status,
                            &mut token_usage,
                            &mut blocks_dirty,
                            &mut message_state_dirty,
                            &mut thread_status_dirty,
                        );
                        flush_stream_state(
                            &state,
                            &thread,
                            &assistant_message_id,
                            &blocks,
                            &message_status,
                            &thread_status,
                            &mut blocks_dirty,
                            &mut message_state_dirty,
                            &mut thread_status_dirty,
                            &mut last_persisted_thread_status,
                            &mut last_persist_at,
                            force_persist,
                        )
                        .await;
                        current_event = unmerged_current_event;
                    }
                }
            } else if is_coalescable_stream_event(&current_event) {
                pending_event = Some(current_event);
                break;
            } else {
                let progress = process_stream_event(
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
                    max_output_chars,
                )
                .await;
                let force_persist = apply_stream_progress(
                    progress,
                    &mut message_status,
                    &mut thread_status,
                    &mut token_usage,
                    &mut blocks_dirty,
                    &mut message_state_dirty,
                    &mut thread_status_dirty,
                );
                flush_stream_state(
                    &state,
                    &thread,
                    &assistant_message_id,
                    &blocks,
                    &message_status,
                    &thread_status,
                    &mut blocks_dirty,
                    &mut message_state_dirty,
                    &mut thread_status_dirty,
                    &mut last_persisted_thread_status,
                    &mut last_persist_at,
                    force_persist,
                )
                .await;
                break;
            }
        }
    }

    if let Some(event) = pending_event.take() {
        let progress = process_stream_event(
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
            max_output_chars,
        )
        .await;
        let force_persist = apply_stream_progress(
            progress,
            &mut message_status,
            &mut thread_status,
            &mut token_usage,
            &mut blocks_dirty,
            &mut message_state_dirty,
            &mut thread_status_dirty,
        );
        flush_stream_state(
            &state,
            &thread,
            &assistant_message_id,
            &blocks,
            &message_status,
            &thread_status,
            &mut blocks_dirty,
            &mut message_state_dirty,
            &mut thread_status_dirty,
            &mut last_persisted_thread_status,
            &mut last_persist_at,
            force_persist,
        )
        .await;
    }

    match engine_task.await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            blocks.push(ContentBlock::Error {
                message: format!("Engine error: {error}"),
            });
            blocks_dirty = true;
            if message_status != MessageStatusDto::Error {
                message_status = MessageStatusDto::Error;
                message_state_dirty = true;
            }
            if thread_status != ThreadStatusDto::Error {
                thread_status = ThreadStatusDto::Error;
                thread_status_dirty = true;
            }
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
            blocks_dirty = true;
            if message_status != MessageStatusDto::Error {
                message_status = MessageStatusDto::Error;
                message_state_dirty = true;
            }
            if thread_status != ThreadStatusDto::Error {
                thread_status = ThreadStatusDto::Error;
                thread_status_dirty = true;
            }
        }
    }

    if cancellation.is_cancelled() && matches!(message_status, MessageStatusDto::Streaming) {
        message_status = MessageStatusDto::Interrupted;
        message_state_dirty = true;
        thread_status = ThreadStatusDto::Idle;
        thread_status_dirty = true;
    }

    flush_stream_state(
        &state,
        &thread,
        &assistant_message_id,
        &blocks,
        &message_status,
        &thread_status,
        &mut blocks_dirty,
        &mut message_state_dirty,
        &mut thread_status_dirty,
        &mut last_persisted_thread_status,
        &mut last_persist_at,
        true,
    )
    .await;

    if let Err(error) = run_db(state.db.clone(), {
        let assistant_message_id = assistant_message_id.clone();
        let message_status = message_status.clone();
        let token_usage = token_usage;
        move |db| {
            db::messages::complete_assistant_message(
                db,
                &assistant_message_id,
                message_status,
                token_usage,
            )
        }
    })
    .await
    {
        log::warn!("failed to complete assistant message: {error}");
    }

    if matches!(message_status, MessageStatusDto::Completed) {
        if let Err(error) = run_db(state.db.clone(), {
            let thread_id = thread.id.clone();
            let token_usage = token_usage;
            move |db| db::threads::bump_message_counters(db, &thread_id, token_usage)
        })
        .await
        {
            log::warn!("failed to bump thread counters: {error}");
        }
    }

    if maybe_update_thread_title(&state, &thread, &engine_thread_id, &turn_input.message)
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
async fn process_stream_event(
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
    max_output_chars: usize,
) -> EventProgress {
    let _ = app.emit(stream_event_topic, event);
    if matches!(event, EngineEvent::ApprovalRequested { .. }) {
        let _ = app.emit(approval_event_topic, event);
    }

    if state.config.debug.persist_engine_event_logs {
        if let Ok(value) = serde_json::to_value(event) {
            if let Err(error) = run_db(state.db.clone(), {
                let thread_id = thread.id.clone();
                let assistant_message_id = assistant_message_id.to_string();
                let value = value.clone();
                move |db| {
                    db::actions::append_event_log(db, &thread_id, &assistant_message_id, &value)
                }
            })
            .await
            {
                log::warn!("failed to append engine event log: {error}");
            }
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
            if let Err(error) = run_db(state.db.clone(), {
                let action_id = action_id.clone();
                let thread_id = thread.id.clone();
                let assistant_message_id = assistant_message_id.to_string();
                let engine_action_id = engine_action_id.clone();
                let action_type = action_type.clone();
                let summary = summary.clone();
                let details = details.clone();
                move |db| {
                    db::actions::insert_action_started(
                        db,
                        &action_id,
                        &thread_id,
                        &assistant_message_id,
                        engine_action_id.as_deref(),
                        &action_type,
                        &summary,
                        &details,
                    )
                }
            })
            .await
            {
                log::warn!("failed to persist action start: {error}");
            }
        }
        EngineEvent::ActionCompleted { action_id, result } => {
            if let Err(error) = run_db(state.db.clone(), {
                let action_id = action_id.clone();
                let result = result.clone();
                move |db| db::actions::update_action_completed(db, &action_id, &result)
            })
            .await
            {
                log::warn!("failed to persist action completion: {error}");
            }
        }
        EngineEvent::ApprovalRequested {
            approval_id,
            action_type,
            summary,
            details,
        } => {
            if let Err(error) = run_db(state.db.clone(), {
                let approval_id = approval_id.clone();
                let thread_id = thread.id.clone();
                let assistant_message_id = assistant_message_id.to_string();
                let action_type = action_type.clone();
                let summary = summary.clone();
                let details = details.clone();
                move |db| {
                    db::actions::insert_approval(
                        db,
                        &approval_id,
                        &thread_id,
                        &assistant_message_id,
                        &action_type,
                        &summary,
                        &details,
                    )
                }
            })
            .await
            {
                log::warn!("failed to persist approval: {error}");
            }
        }
        _ => {}
    }

    apply_event_to_blocks(
        blocks,
        action_index,
        approval_index,
        event,
        max_output_chars,
    )
}

#[allow(clippy::too_many_arguments)]
fn apply_stream_progress(
    progress: EventProgress,
    message_status: &mut MessageStatusDto,
    thread_status: &mut ThreadStatusDto,
    token_usage: &mut Option<(u64, u64)>,
    blocks_dirty: &mut bool,
    message_state_dirty: &mut bool,
    thread_status_dirty: &mut bool,
) -> bool {
    if progress.blocks_changed {
        *blocks_dirty = true;
    }

    if let Some(status) = progress.message_status {
        if *message_status != status {
            *message_status = status;
            *message_state_dirty = true;
        }
    }

    if let Some(status) = progress.thread_status {
        if *thread_status != status {
            *thread_status = status;
            *thread_status_dirty = true;
        }
    }

    if let Some(tokens) = progress.token_usage {
        *token_usage = Some(tokens);
    }

    progress.force_persist
}

#[allow(clippy::too_many_arguments)]
async fn flush_stream_state(
    state: &AppState,
    thread: &ThreadDto,
    assistant_message_id: &str,
    blocks: &[ContentBlock],
    message_status: &MessageStatusDto,
    thread_status: &ThreadStatusDto,
    blocks_dirty: &mut bool,
    message_state_dirty: &mut bool,
    thread_status_dirty: &mut bool,
    last_persisted_thread_status: &mut ThreadStatusDto,
    last_persist_at: &mut Instant,
    force: bool,
) {
    if !*blocks_dirty && !*message_state_dirty && !*thread_status_dirty {
        return;
    }

    let now = Instant::now();
    if !force && now.duration_since(*last_persist_at) < STREAM_DB_FLUSH_INTERVAL {
        return;
    }

    if *blocks_dirty || *message_state_dirty {
        if let Err(error) = run_db(state.db.clone(), {
            let assistant_message_id = assistant_message_id.to_string();
            let blocks = blocks.to_vec();
            let message_status = message_status.clone();
            move |db| {
                let blocks_json = serde_json::to_value(&blocks)?;
                db::messages::update_assistant_blocks(
                    db,
                    &assistant_message_id,
                    &blocks_json,
                    message_status,
                )
            }
        })
        .await
        {
            log::warn!("failed to persist assistant stream blocks: {error}");
        }
        *blocks_dirty = false;
        *message_state_dirty = false;
    }

    if *thread_status_dirty && *last_persisted_thread_status != *thread_status {
        if let Err(error) = run_db(state.db.clone(), {
            let thread_id = thread.id.clone();
            let thread_status = thread_status.clone();
            move |db| db::threads::update_thread_status(db, &thread_id, thread_status)
        })
        .await
        {
            log::warn!("failed to persist thread status during stream: {error}");
        }
        *last_persisted_thread_status = thread_status.clone();
    }
    *thread_status_dirty = false;
    *last_persist_at = now;
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

    if let Err(error) = run_db(state.db.clone(), {
        let thread_id = thread.id.clone();
        let candidate = candidate.clone();
        move |db| db::threads::update_thread_title(db, &thread_id, &candidate)
    })
    .await
    {
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
            progress.force_persist = true;
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
            progress.blocks_changed = append_text_delta(blocks, content);
        }
        EngineEvent::ThinkingDelta { content } => {
            progress.blocks_changed = append_thinking_delta(blocks, content);
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
            progress.blocks_changed = upsert_action_block(blocks, action_index, action_id, block);
        }
        EngineEvent::ActionOutputDelta {
            action_id,
            stream,
            content,
        } => {
            if let Some(index) = action_index.get(action_id).copied() {
                if let Some(ContentBlock::Action {
                    output_chunks,
                    details,
                    ..
                }) = blocks.get_mut(index)
                {
                    let stream_name = match stream {
                        OutputStream::Stdout => "stdout",
                        OutputStream::Stderr => "stderr",
                    };
                    let chunk_content = truncate_chars(content, max_output_chars);
                    if chunk_content.is_empty() {
                        return progress;
                    }

                    if let Some(previous_chunk) = output_chunks.last_mut() {
                        if previous_chunk.stream == stream_name {
                            previous_chunk.content.push_str(&chunk_content);
                        } else {
                            output_chunks.push(ActionOutputChunk {
                                stream: stream_name.to_string(),
                                content: chunk_content,
                            });
                        }
                    } else {
                        output_chunks.push(ActionOutputChunk {
                            stream: stream_name.to_string(),
                            content: chunk_content,
                        });
                    }

                    if trim_action_output_chunks(output_chunks, max_output_chars) {
                        mark_output_truncated(details);
                    }
                    progress.blocks_changed = true;
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
                    progress.blocks_changed = true;
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
            progress.blocks_changed = true;
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
            progress.blocks_changed =
                upsert_approval_block(blocks, approval_index, approval_id, block);
            progress.thread_status = Some(ThreadStatusDto::AwaitingApproval);
            progress.force_persist = true;
        }
        EngineEvent::Error {
            message,
            recoverable,
        } => {
            blocks.push(ContentBlock::Error {
                message: message.to_string(),
            });
            progress.blocks_changed = true;
            if !recoverable {
                progress.message_status = Some(MessageStatusDto::Error);
                progress.thread_status = Some(ThreadStatusDto::Error);
                progress.force_persist = true;
            }
        }
        EngineEvent::UsageLimitsUpdated { .. } => {}
    }

    progress
}

fn append_text_delta(blocks: &mut Vec<ContentBlock>, content: &str) -> bool {
    if content.is_empty() {
        return false;
    }

    if let Some(ContentBlock::Text {
        content: current, ..
    }) = blocks.last_mut()
    {
        current.push_str(content);
        return true;
    }

    blocks.push(ContentBlock::Text {
        content: content.to_string(),
        plan_mode: None,
    });
    true
}

fn append_thinking_delta(blocks: &mut Vec<ContentBlock>, content: &str) -> bool {
    if content.is_empty() {
        return false;
    }

    if let Some(ContentBlock::Thinking { content: current }) = blocks.last_mut() {
        current.push_str(content);
        return true;
    }

    blocks.push(ContentBlock::Thinking {
        content: content.to_string(),
    });
    true
}

fn upsert_action_block(
    blocks: &mut Vec<ContentBlock>,
    action_index: &mut HashMap<String, usize>,
    action_id: &str,
    block: ContentBlock,
) -> bool {
    if let Some(index) = action_index.get(action_id).copied() {
        if let Some(existing) = blocks.get_mut(index) {
            *existing = block;
            return true;
        }
    }

    let index = blocks.len();
    blocks.push(block);
    action_index.insert(action_id.to_string(), index);
    true
}

fn upsert_approval_block(
    blocks: &mut Vec<ContentBlock>,
    approval_index: &mut HashMap<String, usize>,
    approval_id: &str,
    block: ContentBlock,
) -> bool {
    if let Some(index) = approval_index.get(approval_id).copied() {
        if let Some(existing) = blocks.get_mut(index) {
            *existing = block;
            return true;
        }
    }

    let index = blocks.len();
    blocks.push(block);
    approval_index.insert(approval_id.to_string(), index);
    true
}

fn trim_action_output_chunks(
    output_chunks: &mut Vec<ActionOutputChunk>,
    max_output_chars: usize,
) -> bool {
    let mut truncated = false;

    if output_chunks.len() > ACTION_OUTPUT_MAX_CHUNKS {
        let overflow = output_chunks.len() - ACTION_OUTPUT_MAX_CHUNKS;
        output_chunks.drain(0..overflow);
        truncated = true;
    }

    let max_chars = max_output_chars.max(1);
    let total_chars: usize = output_chunks.iter().map(|chunk| chunk.content.len()).sum();
    if total_chars <= max_chars {
        return truncated;
    }

    let target_chars = max_chars.saturating_mul(2) / 3;
    let chars_to_trim = total_chars.saturating_sub(target_chars.max(1));
    if chars_to_trim == 0 {
        return truncated;
    }

    let mut remaining_to_trim = chars_to_trim;
    let mut remove_count = 0usize;
    for chunk in output_chunks.iter() {
        if remaining_to_trim == 0 {
            break;
        }
        remaining_to_trim = remaining_to_trim.saturating_sub(chunk.content.len());
        remove_count += 1;
    }

    if remove_count > 0 {
        output_chunks.drain(0..remove_count);
        truncated = true;
    }

    truncated
}

fn mark_output_truncated(details: &mut Value) {
    if !details.is_object() {
        *details = Value::Object(serde_json::Map::new());
    }

    if let Some(details_object) = details.as_object_mut() {
        details_object.insert("outputTruncated".to_string(), Value::Bool(true));
    }
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
        TrustLevelDto::Trusted => "on-request",
        TrustLevelDto::Standard => "on-request",
        TrustLevelDto::Restricted => "untrusted",
    }
}

fn allow_network_for_trust_level(trust_level: &TrustLevelDto) -> bool {
    matches!(trust_level, TrustLevelDto::Trusted)
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
