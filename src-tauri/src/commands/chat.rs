use std::{
    collections::HashMap,
    path::Path,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, State};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;

use crate::{
    db,
    engines::{
        normalize_approval_response_for_engine, validate_engine_sandbox_mode, EngineEvent,
        OutputStream, SandboxPolicy, ThreadScope, TurnAttachment, TurnCompletionStatus, TurnInput,
        TurnInputItem,
    },
    models::{
        ActionOutputDto, EngineInfoDto, EngineModelDto, MessageDto, MessageStatusDto,
        MessageWindowCursorDto, MessageWindowDto, RepoDto, SearchResultDto, ThreadDto,
        ThreadStatusDto, TrustLevelDto,
    },
    state::AppState,
};

const MAX_THREAD_TITLE_CHARS: usize = 72;
const STREAM_EVENT_COALESCE_MAX_CHARS: usize = 8_192;
const STREAM_EVENT_COALESCE_IDLE_FLUSH_INTERVAL: Duration = Duration::from_millis(24);
const STREAM_DB_FLUSH_INTERVAL: Duration = Duration::from_millis(250);
const STREAM_DB_BLOCKS_FLUSH_INTERVAL: Duration = Duration::from_millis(900);
const ACTION_OUTPUT_MAX_CHUNKS: usize = 240;
const MAX_ATTACHMENTS_PER_TURN: usize = 10;
const MESSAGE_WINDOW_DEFAULT_LIMIT: usize = 120;
const MESSAGE_WINDOW_MAX_LIMIT: usize = 400;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
enum ContentBlock {
    #[serde(rename = "text")]
    Text {
        content: String,
        #[serde(rename = "planMode", skip_serializing_if = "Option::is_none")]
        plan_mode: Option<bool>,
        #[serde(rename = "isSteer", skip_serializing_if = "Option::is_none")]
        is_steer: Option<bool>,
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

    #[serde(rename = "notice")]
    Notice {
        kind: String,
        level: String,
        title: String,
        message: String,
    },

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

    #[serde(rename = "skill")]
    Skill { name: String, path: String },

    #[serde(rename = "mention")]
    Mention { name: String, path: String },
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
    turn_model_id: Option<String>,
    blocks_changed: bool,
    force_persist: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadUpdatedEvent {
    thread_id: String,
    workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    thread: Option<ThreadDto>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ChatInputItemPayload {
    Text { text: String },
    Skill { name: String, path: String },
    Mention { name: String, path: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CodexReviewTargetPayload {
    #[serde(rename = "uncommittedChanges")]
    UncommittedChanges,
    #[serde(rename = "baseBranch")]
    BaseBranch { branch: String },
    #[serde(rename = "commit")]
    Commit {
        sha: String,
        #[serde(default)]
        title: Option<String>,
    },
    #[serde(rename = "custom")]
    Custom { instructions: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CodexReviewDeliveryPayload {
    Inline,
    Detached,
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
    reasoning_effort: Option<String>,
    attachments: Option<Vec<ChatAttachmentPayload>>,
    input_items: Option<Vec<ChatInputItemPayload>>,
    plan_mode: Option<bool>,
    client_turn_id: Option<String>,
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
    let input_items = normalize_input_items(message.as_str(), input_items)?;
    let plan_mode = plan_mode.unwrap_or(false);
    let turn_input = TurnInput {
        message: message.clone(),
        attachments: attachments.clone(),
        plan_mode,
        input_items: input_items.clone(),
    };
    let current_turn_model_id = thread_last_model_id(thread.engine_metadata.as_ref())
        .unwrap_or_else(|| thread.model_id.clone());
    let model_switch_requested = requested_model_id
        .map(|value| value != current_turn_model_id.as_str())
        .unwrap_or(false);
    let validation_catalog = if model_switch_requested {
        state.engines.list_engines().await.ok()
    } else {
        None
    };
    let effective_model_id =
        resolve_turn_model_id(&thread, requested_model_id, validation_catalog.as_deref())?;

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
    let requested_reasoning_effort = normalize_reasoning_effort_value(reasoning_effort.as_deref());
    let stored_reasoning_effort = thread_reasoning_effort(thread.engine_metadata.as_ref());
    let configured_reasoning_effort = requested_reasoning_effort
        .clone()
        .or_else(|| stored_reasoning_effort.clone());
    let reasoning_effort = if requested_reasoning_effort.is_some() {
        requested_reasoning_effort
    } else if model_switch_requested {
        validation_catalog
            .as_deref()
            .map(|engines| {
                resolve_reasoning_effort_from_catalog(
                    engines,
                    thread.engine_id.as_str(),
                    effective_model_id.as_str(),
                    configured_reasoning_effort.as_deref(),
                )
            })
            .unwrap_or_else(|| {
                normalize_reasoning_effort_value(configured_reasoning_effort.as_deref())
            })
    } else {
        configured_reasoning_effort.clone()
    };
    let sandbox_mode_override = thread_sandbox_mode(thread.engine_metadata.as_ref())?;
    let sandbox_mode = sandbox_mode_override
        .clone()
        .unwrap_or_else(|| "workspace-write".to_string());
    let workspace_writable_roots = if selected_repo.is_some() {
        None
    } else {
        Some(resolve_workspace_writable_roots(
            repos.iter().map(|repo| repo.path.as_str()),
            workspace_root.as_str(),
            thread.engine_metadata.as_ref(),
        )?)
    };
    let scope = if let Some(repo) = selected_repo.as_ref() {
        ThreadScope::Repo {
            repo_path: repo.path.clone(),
        }
    } else {
        ThreadScope::Workspace {
            root_path: workspace_root,
            writable_roots: workspace_writable_roots
                .as_ref()
                .map(|resolution| resolution.roots.clone())
                .unwrap_or_default(),
        }
    };

    let trust_level = selected_repo
        .as_ref()
        .map(|repo| repo.trust_level.clone())
        .unwrap_or_else(|| aggregate_workspace_trust_level(&repos));
    let codex_external_sandbox_active = if thread.engine_id == "codex" {
        state.engines.codex_uses_external_sandbox().await
    } else {
        false
    };

    if unsupported_thread_sandbox_override_for_external_sandbox(
        sandbox_mode_override.as_deref(),
        codex_external_sandbox_active,
    ) {
        return Err(
            "Codex read-only and workspace-write sandbox overrides are unavailable while Panes is using external sandbox mode. Clear the override or restore local Codex sandboxing first.".to_string(),
        );
    }

    validate_engine_sandbox_mode(thread.engine_id.as_str(), Some(sandbox_mode.as_str()))?;

    if workspace_write_confirmation_required(
        workspace_writable_roots.as_ref(),
        sandbox_mode.as_str(),
        workspace_write_opt_in_enabled(thread.engine_metadata.as_ref()),
    ) {
        return Err(
            "Workspace thread with multiple writable repositories requires explicit confirmation before execution.".to_string(),
        );
    }

    if requested_model_id.is_some() || reasoning_effort != stored_reasoning_effort {
        let mut metadata = thread
            .engine_metadata
            .clone()
            .unwrap_or_else(|| serde_json::json!({}));
        if !metadata.is_object() {
            metadata = serde_json::json!({});
        }
        if let Some(object) = metadata.as_object_mut() {
            if requested_model_id.is_some() {
                object.insert(
                    "lastModelId".to_string(),
                    Value::String(effective_model_id.clone()),
                );
            }
            match reasoning_effort.as_ref() {
                Some(value) => {
                    object.insert("reasoningEffort".to_string(), Value::String(value.clone()));
                }
                None => {
                    object.remove("reasoningEffort");
                }
            }
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
        let input_items = input_items.clone();
        let plan_mode_enabled = plan_mode;
        let engine_id = thread.engine_id.clone();
        let model_id = effective_model_id.clone();
        let reasoning_effort = reasoning_effort.clone();
        move |db| {
            let user_blocks = build_user_blocks(
                &message,
                &input_items,
                &attachments,
                plan_mode_enabled,
                false,
            );
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

    let allow_network =
        if thread.engine_id == "codex" && sandbox_mode.eq_ignore_ascii_case("danger-full-access") {
            true
        } else {
            thread_allow_network_override(thread.engine_metadata.as_ref())
                .unwrap_or_else(|| allow_network_for_trust_level(&trust_level))
        };
    let personality = if thread.engine_id == "codex"
        && model_supports_personality(state.inner(), &thread.engine_id, &effective_model_id).await
    {
        thread_personality(thread.engine_metadata.as_ref())
    } else {
        None
    };

    let approval_policy_override = thread_approval_policy_override_value(
        thread.engine_id.as_str(),
        thread.engine_metadata.as_ref(),
    )?;

    let sandbox = SandboxPolicy {
        writable_roots,
        allow_network,
        approval_policy: Some(approval_policy_override.unwrap_or_else(|| {
            Value::String(
                approval_policy_for_engine_and_trust_level(thread.engine_id.as_str(), &trust_level)
                    .to_string(),
            )
        })),
        reasoning_effort,
        sandbox_mode: Some(sandbox_mode),
        service_tier: thread_service_tier(thread.engine_metadata.as_ref()),
        personality,
        output_schema: thread_output_schema(thread.engine_metadata.as_ref()),
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
    let initial_turn_model_id = effective_model_id.clone();

    tokio::spawn(async move {
        run_turn(
            app_handle,
            state_cloned,
            thread_for_task,
            engine_thread_id,
            assistant_message_id,
            initial_turn_model_id,
            turn_input_for_task,
            client_turn_id,
            cancellation,
        )
        .await;
    });

    Ok(assistant_message.id)
}

#[tauri::command]
pub async fn start_codex_review(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    thread_id: String,
    target: CodexReviewTargetPayload,
    delivery: Option<CodexReviewDeliveryPayload>,
) -> Result<ThreadDto, String> {
    if state.turns.get(&thread_id).await.is_some() {
        return Err(
            "A turn is already running for this thread. Cancel it before starting a review."
                .to_string(),
        );
    }

    let db = state.db.clone();
    let source_thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    if source_thread.engine_id != "codex" {
        return Err("Native review is only available for Codex threads.".to_string());
    }

    let source_engine_thread_id = source_thread
        .engine_thread_id
        .clone()
        .ok_or_else(|| "Codex review requires an initialized server-backed thread.".to_string())?;
    let effective_delivery = delivery.unwrap_or(CodexReviewDeliveryPayload::Inline);
    let (target_payload, review_message, review_title) = normalize_codex_review_target(&target)?;
    let initial_turn_model_id = thread_last_model_id(source_thread.engine_metadata.as_ref())
        .unwrap_or_else(|| source_thread.model_id.clone());
    let reasoning_effort = thread_reasoning_effort(source_thread.engine_metadata.as_ref());

    let cancellation = CancellationToken::new();
    if !state
        .turns
        .try_register(&source_thread.id, cancellation.clone())
        .await
    {
        return Err(
            "A turn is already running for this thread. Cancel it before starting a review."
                .to_string(),
        );
    }

    let (review_thread, assistant_message_id) = match run_db(db.clone(), {
        let source_thread = source_thread.clone();
        let review_message = review_message.clone();
        let review_title = review_title.clone();
        let initial_turn_model_id = initial_turn_model_id.clone();
        let reasoning_effort = reasoning_effort.clone();
        let detached = matches!(effective_delivery, CodexReviewDeliveryPayload::Detached);
        move |db| {
            let review_thread = if detached {
                let created = db::threads::create_thread(
                    db,
                    &source_thread.workspace_id,
                    source_thread.repo_id.as_deref(),
                    &source_thread.engine_id,
                    &initial_turn_model_id,
                    &review_title,
                )?;
                if let Some(metadata) = clone_codex_review_metadata(
                    source_thread.engine_metadata.as_ref(),
                    &initial_turn_model_id,
                ) {
                    db::threads::update_engine_metadata(db, &created.id, &metadata)?;
                }
                created
            } else {
                source_thread.clone()
            };

            let user_blocks = build_user_blocks(&review_message, &[], &[], false, false);
            db::messages::insert_user_message(
                db,
                &review_thread.id,
                &review_message,
                Some(serde_json::to_value(&user_blocks)?),
                Some(source_thread.engine_id.as_str()),
                Some(initial_turn_model_id.as_str()),
                reasoning_effort.as_deref(),
            )?;
            let assistant_message = db::messages::insert_assistant_placeholder(
                db,
                &review_thread.id,
                Some(source_thread.engine_id.as_str()),
                Some(initial_turn_model_id.as_str()),
                reasoning_effort.as_deref(),
            )?;
            db::threads::update_thread_status(db, &review_thread.id, ThreadStatusDto::Streaming)?;
            let updated_thread = db::threads::get_thread(db, &review_thread.id)?
                .ok_or_else(|| anyhow::anyhow!("review thread not found after setup"))?;
            Ok((updated_thread, assistant_message.id))
        }
    })
    .await
    {
        Ok(result) => result,
        Err(error) => {
            state.turns.finish(&source_thread.id).await;
            return Err(error);
        }
    };

    if matches!(effective_delivery, CodexReviewDeliveryPayload::Detached) {
        if !state
            .turns
            .try_register(&review_thread.id, cancellation.clone())
            .await
        {
            log::warn!(
                "failed to register cancellation token for detached review thread {}",
                review_thread.id
            );
        }
    }

    let state_cloned = state.inner().clone();
    let app_handle = app.clone();
    let review_thread_for_task = review_thread.clone();
    let review_target_for_task = target_payload.clone();
    let source_engine_thread_id_for_task = source_engine_thread_id.clone();
    let assistant_message_id_for_task = assistant_message_id.clone();
    let delivery_label = match effective_delivery {
        CodexReviewDeliveryPayload::Inline => "inline".to_string(),
        CodexReviewDeliveryPayload::Detached => "detached".to_string(),
    };

    tokio::spawn(async move {
        run_codex_review_turn(
            app_handle,
            state_cloned,
            source_thread,
            review_thread_for_task,
            source_engine_thread_id_for_task,
            assistant_message_id_for_task,
            initial_turn_model_id,
            review_target_for_task,
            delivery_label,
            cancellation,
        )
        .await;
    });

    Ok(review_thread)
}

#[tauri::command]
pub async fn steer_message(
    state: State<'_, AppState>,
    thread_id: String,
    message: String,
    attachments: Option<Vec<ChatAttachmentPayload>>,
    input_items: Option<Vec<ChatInputItemPayload>>,
    plan_mode: Option<bool>,
) -> Result<(), String> {
    if state.turns.get(&thread_id).await.is_none() {
        return Err(
            "No active turn is running for this thread yet. Wait for Codex to start the turn before steering."
                .to_string(),
        );
    }

    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    if thread.engine_id != "codex" {
        return Err("Mid-turn steering is only available for Codex threads.".to_string());
    }

    let engine_thread_id = thread
        .engine_thread_id
        .clone()
        .ok_or_else(|| format!("thread `{thread_id}` has no active engine thread id"))?;
    let attachments = normalize_attachments(attachments)?;
    let input_items = normalize_input_items(message.as_str(), input_items)?;
    let plan_mode = plan_mode.unwrap_or(false);
    let turn_input = TurnInput {
        message: message.clone(),
        attachments: attachments.clone(),
        plan_mode,
        input_items: input_items.clone(),
    };
    let effective_model_id = thread_last_model_id(thread.engine_metadata.as_ref())
        .unwrap_or_else(|| thread.model_id.clone());
    let reasoning_effort = thread_reasoning_effort(thread.engine_metadata.as_ref());
    let user_blocks = build_user_blocks(&message, &input_items, &attachments, plan_mode, true);

    let user_message = run_db(db.clone(), {
        let thread_id = thread.id.clone();
        let message = message.clone();
        let user_blocks = user_blocks.clone();
        let engine_id = thread.engine_id.clone();
        let model_id = effective_model_id.clone();
        let reasoning_effort = reasoning_effort.clone();
        move |db| {
            db::messages::insert_user_message(
                db,
                &thread_id,
                &message,
                Some(serde_json::to_value(&user_blocks)?),
                Some(engine_id.as_str()),
                Some(model_id.as_str()),
                reasoning_effort.as_deref(),
            )
        }
    })
    .await?;

    if let Err(error) = state
        .engines
        .steer_message(&thread, &engine_thread_id, turn_input)
        .await
    {
        let rollback_result = run_db(db, {
            let message_id = user_message.id.clone();
            move |db| db::messages::delete_message(db, &message_id)
        })
        .await;
        if let Err(rollback_error) = rollback_result {
            log::warn!(
                "failed to roll back persisted steer message {} after steer error: {}",
                user_message.id,
                rollback_error
            );
        }

        return Err(err_to_string(error));
    }

    Ok(())
}

fn build_user_blocks(
    message: &str,
    input_items: &[TurnInputItem],
    attachments: &[TurnAttachment],
    plan_mode: bool,
    is_steer: bool,
) -> Vec<ContentBlock> {
    let mut user_blocks = Vec::with_capacity(
        input_items
            .len()
            .saturating_add(attachments.len())
            .saturating_add(1),
    );

    let mut structured_text_parts: Vec<String> = Vec::new();

    for item in input_items {
        match item {
            TurnInputItem::Skill { name, path } => {
                user_blocks.push(ContentBlock::Skill {
                    name: name.clone(),
                    path: path.clone(),
                });
            }
            TurnInputItem::Mention { name, path } => {
                user_blocks.push(ContentBlock::Mention {
                    name: name.clone(),
                    path: path.clone(),
                });
            }
            TurnInputItem::Text { text } => {
                structured_text_parts.push(text.clone());
            }
        }
    }

    for attachment in attachments {
        user_blocks.push(ContentBlock::Attachment {
            file_name: attachment.file_name.clone(),
            file_path: attachment.file_path.clone(),
            size_bytes: attachment.size_bytes,
            mime_type: attachment.mime_type.clone(),
        });
    }

    let final_text = if structured_text_parts.is_empty() {
        message.to_string()
    } else {
        structured_text_parts.join("\n")
    };
    user_blocks.push(ContentBlock::Text {
        content: final_text,
        plan_mode: if plan_mode { Some(true) } else { None },
        is_steer: if is_steer { Some(true) } else { None },
    });

    user_blocks
}

fn normalize_input_items(
    message: &str,
    input_items: Option<Vec<ChatInputItemPayload>>,
) -> Result<Vec<TurnInputItem>, String> {
    let mut normalized = Vec::new();

    for item in input_items.unwrap_or_default() {
        match item {
            ChatInputItemPayload::Text { text } => {
                if !text.is_empty() {
                    normalized.push(TurnInputItem::Text { text });
                }
            }
            ChatInputItemPayload::Skill { name, path } => {
                let name = name.trim();
                let path = path.trim();
                if name.is_empty() || path.is_empty() {
                    return Err("skill input items require non-empty name and path".to_string());
                }
                normalized.push(TurnInputItem::Skill {
                    name: name.to_string(),
                    path: path.to_string(),
                });
            }
            ChatInputItemPayload::Mention { name, path } => {
                let name = name.trim();
                let path = path.trim();
                if name.is_empty() || path.is_empty() {
                    return Err("mention input items require non-empty name and path".to_string());
                }
                normalized.push(TurnInputItem::Mention {
                    name: name.to_string(),
                    path: path.to_string(),
                });
            }
        }
    }

    if normalized.is_empty() {
        normalized.push(TurnInputItem::Text {
            text: message.to_string(),
        });
        return Ok(normalized);
    }

    let has_text_item = normalized
        .iter()
        .any(|item| matches!(item, TurnInputItem::Text { text } if !text.is_empty()));
    if !has_text_item && !message.trim().is_empty() {
        return Err(
            "input items must include at least one text segment when message text is provided"
                .to_string(),
        );
    }

    let mut merged = Vec::with_capacity(normalized.len());
    for item in normalized {
        match item {
            TurnInputItem::Text { text } => {
                if let Some(TurnInputItem::Text { text: current }) = merged.last_mut() {
                    current.push_str(&text);
                } else {
                    merged.push(TurnInputItem::Text { text });
                }
            }
            other => merged.push(other),
        }
    }

    Ok(merged)
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
    Ok(())
}

#[tauri::command]
pub async fn respond_to_approval(
    state: State<'_, AppState>,
    thread_id: String,
    approval_id: String,
    response: Value,
) -> Result<(), String> {
    respond_to_approval_inner(state.inner(), thread_id, approval_id, response).await
}

async fn respond_to_approval_inner(
    state: &AppState,
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
    let normalized_response =
        normalize_approval_response_for_engine(thread.engine_id.as_str(), response)?;

    state
        .engines
        .respond_to_approval(&thread, &approval_id, normalized_response.clone())
        .await
        .map_err(err_to_string)?;

    let decision = approval_response_decision_for_persistence(&normalized_response);
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

fn approval_response_decision_for_persistence(response: &Value) -> &'static str {
    if let Some(decision) = response.get("decision").and_then(Value::as_str) {
        return match decision {
            "deny" => "decline",
            "acceptForSession" => "accept_for_session",
            "accept" => "accept",
            "decline" => "decline",
            "cancel" => "cancel",
            "accept_for_session" => "accept_for_session",
            _ => "custom",
        };
    }

    if let Some(action) = response.get("action").and_then(Value::as_str) {
        return match action {
            "accept" => "accept",
            "decline" => "decline",
            "cancel" => "cancel",
            _ => "custom",
        };
    }

    if response.get("permissions").is_some() {
        if permission_profile_is_empty(response.get("permissions")) {
            return "decline";
        }
        if matches!(
            response.get("scope").and_then(Value::as_str),
            Some("session")
        ) {
            return "accept_for_session";
        }
        return "accept";
    }

    "custom"
}

fn permission_profile_is_empty(value: Option<&Value>) -> bool {
    fn has_granted_permission(value: &Value) -> bool {
        match value {
            Value::Bool(value) => *value,
            Value::String(value) => !value.trim().is_empty() && value != "none",
            Value::Array(items) => items.iter().any(has_granted_permission),
            Value::Object(map) => map.values().any(has_granted_permission),
            _ => false,
        }
    }

    match value {
        Some(value) => !has_granted_permission(value),
        None => true,
    }
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
pub async fn get_thread_messages_window(
    state: State<'_, AppState>,
    thread_id: String,
    cursor: Option<MessageWindowCursorDto>,
    limit: Option<usize>,
) -> Result<MessageWindowDto, String> {
    let requested_limit = limit.unwrap_or(MESSAGE_WINDOW_DEFAULT_LIMIT);
    let clamped_limit = requested_limit.clamp(1, MESSAGE_WINDOW_MAX_LIMIT);

    run_db(state.db.clone(), move |db| {
        db::messages::get_thread_messages_window(db, &thread_id, cursor.as_ref(), clamped_limit)
    })
    .await
}

#[tauri::command]
pub async fn get_message_blocks(
    state: State<'_, AppState>,
    message_id: String,
) -> Result<Option<Value>, String> {
    run_db(state.db.clone(), move |db| {
        db::messages::get_message_blocks(db, &message_id)
    })
    .await
}

#[tauri::command]
pub async fn get_action_output(
    state: State<'_, AppState>,
    message_id: String,
    action_id: String,
) -> Result<ActionOutputDto, String> {
    run_db(state.db.clone(), move |db| {
        db::messages::get_action_output(db, &message_id, &action_id)
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

fn normalize_codex_review_target(
    target: &CodexReviewTargetPayload,
) -> Result<(Value, String, String), String> {
    match target {
        CodexReviewTargetPayload::UncommittedChanges => Ok((
            serde_json::json!({
                "type": "uncommittedChanges",
            }),
            "Review uncommitted changes.".to_string(),
            "Review: Uncommitted changes".to_string(),
        )),
        CodexReviewTargetPayload::BaseBranch { branch } => {
            let branch = branch.trim();
            if branch.is_empty() {
                return Err("Base branch review requires a branch name.".to_string());
            }
            Ok((
                serde_json::json!({
                    "type": "baseBranch",
                    "branch": branch,
                }),
                format!("Review changes against base branch `{branch}`."),
                truncate_title(format!("Review: {branch}"), MAX_THREAD_TITLE_CHARS),
            ))
        }
        CodexReviewTargetPayload::Commit { sha, title } => {
            let sha = sha.trim();
            if sha.is_empty() {
                return Err("Commit review requires a commit SHA.".to_string());
            }
            let short_sha = sha.chars().take(12).collect::<String>();
            let normalized_title = title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
            let message = match normalized_title.as_deref() {
                Some(title) => format!("Review commit `{sha}`: {title}"),
                None => format!("Review commit `{sha}`."),
            };
            let target = match normalized_title {
                Some(title) => serde_json::json!({
                    "type": "commit",
                    "sha": sha,
                    "title": title,
                }),
                None => serde_json::json!({
                    "type": "commit",
                    "sha": sha,
                }),
            };
            Ok((
                target,
                message,
                truncate_title(format!("Review: {short_sha}"), MAX_THREAD_TITLE_CHARS),
            ))
        }
        CodexReviewTargetPayload::Custom { instructions } => {
            let instructions = instructions.trim();
            if instructions.is_empty() {
                return Err("Custom review requires instructions.".to_string());
            }
            Ok((
                serde_json::json!({
                    "type": "custom",
                    "instructions": instructions,
                }),
                instructions.to_string(),
                "Review: Custom".to_string(),
            ))
        }
    }
}

fn clone_codex_review_metadata(existing: Option<&Value>, model_id: &str) -> Option<Value> {
    let mut metadata = existing.cloned().unwrap_or_else(|| serde_json::json!({}));
    if !metadata.is_object() {
        metadata = serde_json::json!({});
    }

    let object = metadata.as_object_mut()?;
    object.remove("manualTitle");
    object.remove("manualTitleUpdatedAt");
    object.remove("codexPreview");
    object.remove("codexThreadStatus");
    object.remove("codexThreadActiveFlags");
    object.remove("codexSyncRequired");
    object.remove("codexSyncReason");
    object.insert(
        "lastModelId".to_string(),
        Value::String(model_id.to_string()),
    );
    Some(metadata)
}

async fn run_turn(
    app: tauri::AppHandle,
    state: AppState,
    thread: crate::models::ThreadDto,
    engine_thread_id: String,
    assistant_message_id: String,
    initial_turn_model_id: String,
    turn_input: TurnInput,
    client_turn_id: Option<String>,
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
    let mut turn_model_id = initial_turn_model_id;
    let mut token_usage: Option<(u64, u64)> = None;
    let mut blocks_dirty = false;
    let mut message_state_dirty = false;
    let mut thread_status_dirty = false;
    let mut turn_model_dirty = false;
    let mut last_persist_at = Instant::now();
    let mut last_blocks_persist_at = Instant::now();
    let mut last_persisted_thread_status = thread_status.clone();
    let stream_event_topic = format!("stream-event-{}", thread.id);
    let approval_event_topic = format!("approval-request-{}", thread.id);
    let mut pending_event: Option<EngineEvent> = None;

    let initial_turn_started_event = EngineEvent::TurnStarted { client_turn_id };
    let initial_progress = process_stream_event(
        &app,
        &state,
        &thread,
        &assistant_message_id,
        &stream_event_topic,
        &approval_event_topic,
        &initial_turn_started_event,
        &mut blocks,
        &mut action_index,
        &mut approval_index,
        max_output_chars,
    )
    .await;
    let initial_force_persist = apply_stream_progress(
        initial_progress,
        &mut message_status,
        &mut thread_status,
        &mut turn_model_id,
        &mut token_usage,
        &mut blocks_dirty,
        &mut message_state_dirty,
        &mut thread_status_dirty,
        &mut turn_model_dirty,
    );
    flush_stream_state(
        &state,
        &thread,
        &assistant_message_id,
        &blocks,
        &message_status,
        &thread_status,
        &turn_model_id,
        &mut blocks_dirty,
        &mut message_state_dirty,
        &mut thread_status_dirty,
        &mut turn_model_dirty,
        &mut last_persisted_thread_status,
        &mut last_persist_at,
        &mut last_blocks_persist_at,
        initial_force_persist,
    )
    .await;

    loop {
        let incoming_event = if pending_event.is_some() {
            match tokio::time::timeout(STREAM_EVENT_COALESCE_IDLE_FLUSH_INTERVAL, event_rx.recv())
                .await
            {
                Ok(event) => event,
                Err(_) => {
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
                            &mut turn_model_id,
                            &mut token_usage,
                            &mut blocks_dirty,
                            &mut message_state_dirty,
                            &mut thread_status_dirty,
                            &mut turn_model_dirty,
                        );
                        flush_stream_state(
                            &state,
                            &thread,
                            &assistant_message_id,
                            &blocks,
                            &message_status,
                            &thread_status,
                            &turn_model_id,
                            &mut blocks_dirty,
                            &mut message_state_dirty,
                            &mut thread_status_dirty,
                            &mut turn_model_dirty,
                            &mut last_persisted_thread_status,
                            &mut last_persist_at,
                            &mut last_blocks_persist_at,
                            force_persist,
                        )
                        .await;
                    }
                    continue;
                }
            }
        } else {
            event_rx.recv().await
        };

        let Some(incoming_event) = incoming_event else {
            break;
        };

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
                                &mut turn_model_id,
                                &mut token_usage,
                                &mut blocks_dirty,
                                &mut message_state_dirty,
                                &mut thread_status_dirty,
                                &mut turn_model_dirty,
                            );
                            flush_stream_state(
                                &state,
                                &thread,
                                &assistant_message_id,
                                &blocks,
                                &message_status,
                                &thread_status,
                                &turn_model_id,
                                &mut blocks_dirty,
                                &mut message_state_dirty,
                                &mut thread_status_dirty,
                                &mut turn_model_dirty,
                                &mut last_persisted_thread_status,
                                &mut last_persist_at,
                                &mut last_blocks_persist_at,
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
                            &mut turn_model_id,
                            &mut token_usage,
                            &mut blocks_dirty,
                            &mut message_state_dirty,
                            &mut thread_status_dirty,
                            &mut turn_model_dirty,
                        );
                        flush_stream_state(
                            &state,
                            &thread,
                            &assistant_message_id,
                            &blocks,
                            &message_status,
                            &thread_status,
                            &turn_model_id,
                            &mut blocks_dirty,
                            &mut message_state_dirty,
                            &mut thread_status_dirty,
                            &mut turn_model_dirty,
                            &mut last_persisted_thread_status,
                            &mut last_persist_at,
                            &mut last_blocks_persist_at,
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
                    &mut turn_model_id,
                    &mut token_usage,
                    &mut blocks_dirty,
                    &mut message_state_dirty,
                    &mut thread_status_dirty,
                    &mut turn_model_dirty,
                );
                flush_stream_state(
                    &state,
                    &thread,
                    &assistant_message_id,
                    &blocks,
                    &message_status,
                    &thread_status,
                    &turn_model_id,
                    &mut blocks_dirty,
                    &mut message_state_dirty,
                    &mut thread_status_dirty,
                    &mut turn_model_dirty,
                    &mut last_persisted_thread_status,
                    &mut last_persist_at,
                    &mut last_blocks_persist_at,
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
            &mut turn_model_id,
            &mut token_usage,
            &mut blocks_dirty,
            &mut message_state_dirty,
            &mut thread_status_dirty,
            &mut turn_model_dirty,
        );
        flush_stream_state(
            &state,
            &thread,
            &assistant_message_id,
            &blocks,
            &message_status,
            &thread_status,
            &turn_model_id,
            &mut blocks_dirty,
            &mut message_state_dirty,
            &mut thread_status_dirty,
            &mut turn_model_dirty,
            &mut last_persisted_thread_status,
            &mut last_persist_at,
            &mut last_blocks_persist_at,
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
        &turn_model_id,
        &mut blocks_dirty,
        &mut message_state_dirty,
        &mut thread_status_dirty,
        &mut turn_model_dirty,
        &mut last_persisted_thread_status,
        &mut last_persist_at,
        &mut last_blocks_persist_at,
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
                Some(turn_model_id.as_str()),
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

    if let Some(updated_thread) =
        maybe_update_thread_title(&state, &thread, &engine_thread_id, &turn_input.message).await
    {
        let _ = app.emit(
            "thread-updated",
            ThreadUpdatedEvent {
                thread_id: thread.id.clone(),
                workspace_id: thread.workspace_id.clone(),
                thread: Some(updated_thread),
            },
        );
    }

    state.turns.finish(&thread.id).await;
}

async fn run_codex_review_turn(
    app: tauri::AppHandle,
    state: AppState,
    source_thread: crate::models::ThreadDto,
    review_thread: crate::models::ThreadDto,
    source_engine_thread_id: String,
    assistant_message_id: String,
    initial_turn_model_id: String,
    target: Value,
    delivery: String,
    cancellation: CancellationToken,
) {
    let max_output_chars = state.config.debug.max_action_output_chars;
    let (event_tx, mut event_rx) = mpsc::channel::<EngineEvent>(128);
    let (started_tx, started_rx) = oneshot::channel();

    let engines = state.engines.clone();
    let source_engine_thread_id_for_engine = source_engine_thread_id.clone();
    let target_for_engine = target.clone();
    let delivery_for_engine = delivery.clone();
    let cancellation_for_engine = cancellation.clone();

    let engine_task = tokio::spawn(async move {
        engines
            .start_codex_review(
                &source_engine_thread_id_for_engine,
                target_for_engine,
                Some(delivery_for_engine.as_str()),
                event_tx,
                cancellation_for_engine,
                started_tx,
            )
            .await
    });

    let state_for_started = state.clone();
    let app_for_started = app.clone();
    let review_thread_for_started = review_thread.clone();
    let started_task = tokio::spawn(async move {
        let Ok(started) = started_rx.await else {
            return;
        };

        let updated_thread = match run_db(state_for_started.db.clone(), {
            let review_thread_id = review_thread_for_started.id.clone();
            let review_thread_engine_id = review_thread_for_started.engine_thread_id.clone();
            let review_thread_model_id = review_thread_for_started.model_id.clone();
            let review_thread_metadata = review_thread_for_started.engine_metadata.clone();
            let review_thread_status = review_thread_for_started.status.clone();
            let review_thread_title = review_thread_for_started.title.clone();
            let review_thread_workspace_id = review_thread_for_started.workspace_id.clone();
            let review_thread_repo_id = review_thread_for_started.repo_id.clone();
            move |db| {
                if review_thread_engine_id.as_deref() == Some(started.review_thread_id.as_str()) {
                    return db::threads::get_thread(db, &review_thread_id)?.ok_or_else(|| {
                        anyhow::anyhow!(
                            "review thread not found after review/start: {review_thread_id}"
                        )
                    });
                }

                db::threads::set_engine_thread_id(db, &review_thread_id, &started.review_thread_id)?;
                let current = db::threads::get_thread(db, &review_thread_id)?.ok_or_else(|| {
                    anyhow::anyhow!("review thread not found after engine thread update")
                })?;
                let metadata = current.engine_metadata.or(review_thread_metadata.clone());
                db::threads::update_thread_runtime_snapshot(
                    db,
                    &review_thread_id,
                    Some(&review_thread_title),
                    Some(review_thread_status.clone()),
                    metadata.as_ref(),
                )?;
                db::threads::get_thread(db, &review_thread_id)?.ok_or_else(|| {
                    anyhow::anyhow!(
                        "review thread not found after runtime snapshot update: {review_thread_workspace_id}:{review_thread_repo_id:?}:{review_thread_model_id}"
                    )
                })
            }
        })
        .await
        {
            Ok(thread) => thread,
            Err(error) => {
                log::warn!("failed to persist codex review thread id: {error}");
                return;
            }
        };

        let _ = app_for_started.emit(
            "thread-updated",
            ThreadUpdatedEvent {
                thread_id: updated_thread.id.clone(),
                workspace_id: updated_thread.workspace_id.clone(),
                thread: Some(updated_thread),
            },
        );
    });

    let mut blocks: Vec<ContentBlock> = Vec::new();
    let mut action_index: HashMap<String, usize> = HashMap::new();
    let mut approval_index: HashMap<String, usize> = HashMap::new();
    let mut message_status = MessageStatusDto::Streaming;
    let mut thread_status = ThreadStatusDto::Streaming;
    let mut turn_model_id = initial_turn_model_id;
    let mut token_usage: Option<(u64, u64)> = None;
    let mut blocks_dirty = false;
    let mut message_state_dirty = false;
    let mut thread_status_dirty = false;
    let mut turn_model_dirty = false;
    let mut last_persist_at = Instant::now();
    let mut last_blocks_persist_at = Instant::now();
    let mut last_persisted_thread_status = thread_status.clone();
    let stream_event_topic = format!("stream-event-{}", review_thread.id);
    let approval_event_topic = format!("approval-request-{}", review_thread.id);
    let mut pending_event: Option<EngineEvent> = None;

    let initial_turn_started_event = EngineEvent::TurnStarted {
        client_turn_id: None,
    };
    let initial_progress = process_stream_event(
        &app,
        &state,
        &review_thread,
        &assistant_message_id,
        &stream_event_topic,
        &approval_event_topic,
        &initial_turn_started_event,
        &mut blocks,
        &mut action_index,
        &mut approval_index,
        max_output_chars,
    )
    .await;
    let initial_force_persist = apply_stream_progress(
        initial_progress,
        &mut message_status,
        &mut thread_status,
        &mut turn_model_id,
        &mut token_usage,
        &mut blocks_dirty,
        &mut message_state_dirty,
        &mut thread_status_dirty,
        &mut turn_model_dirty,
    );
    flush_stream_state(
        &state,
        &review_thread,
        &assistant_message_id,
        &blocks,
        &message_status,
        &thread_status,
        &turn_model_id,
        &mut blocks_dirty,
        &mut message_state_dirty,
        &mut thread_status_dirty,
        &mut turn_model_dirty,
        &mut last_persisted_thread_status,
        &mut last_persist_at,
        &mut last_blocks_persist_at,
        initial_force_persist,
    )
    .await;

    if let Err(error) = started_task.await {
        log::warn!("failed to join codex review start task: {error}");
    }

    loop {
        let incoming_event = if pending_event.is_some() {
            match tokio::time::timeout(STREAM_EVENT_COALESCE_IDLE_FLUSH_INTERVAL, event_rx.recv())
                .await
            {
                Ok(event) => event,
                Err(_) => {
                    if let Some(event) = pending_event.take() {
                        let progress = process_stream_event(
                            &app,
                            &state,
                            &review_thread,
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
                            &mut turn_model_id,
                            &mut token_usage,
                            &mut blocks_dirty,
                            &mut message_state_dirty,
                            &mut thread_status_dirty,
                            &mut turn_model_dirty,
                        );
                        flush_stream_state(
                            &state,
                            &review_thread,
                            &assistant_message_id,
                            &blocks,
                            &message_status,
                            &thread_status,
                            &turn_model_id,
                            &mut blocks_dirty,
                            &mut message_state_dirty,
                            &mut thread_status_dirty,
                            &mut turn_model_dirty,
                            &mut last_persisted_thread_status,
                            &mut last_persist_at,
                            &mut last_blocks_persist_at,
                            force_persist,
                        )
                        .await;
                    }
                    continue;
                }
            }
        } else {
            event_rx.recv().await
        };

        let Some(incoming_event) = incoming_event else {
            break;
        };

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
                                &review_thread,
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
                                &mut turn_model_id,
                                &mut token_usage,
                                &mut blocks_dirty,
                                &mut message_state_dirty,
                                &mut thread_status_dirty,
                                &mut turn_model_dirty,
                            );
                            flush_stream_state(
                                &state,
                                &review_thread,
                                &assistant_message_id,
                                &blocks,
                                &message_status,
                                &thread_status,
                                &turn_model_id,
                                &mut blocks_dirty,
                                &mut message_state_dirty,
                                &mut thread_status_dirty,
                                &mut turn_model_dirty,
                                &mut last_persisted_thread_status,
                                &mut last_persist_at,
                                &mut last_blocks_persist_at,
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
                            &review_thread,
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
                            &mut turn_model_id,
                            &mut token_usage,
                            &mut blocks_dirty,
                            &mut message_state_dirty,
                            &mut thread_status_dirty,
                            &mut turn_model_dirty,
                        );
                        flush_stream_state(
                            &state,
                            &review_thread,
                            &assistant_message_id,
                            &blocks,
                            &message_status,
                            &thread_status,
                            &turn_model_id,
                            &mut blocks_dirty,
                            &mut message_state_dirty,
                            &mut thread_status_dirty,
                            &mut turn_model_dirty,
                            &mut last_persisted_thread_status,
                            &mut last_persist_at,
                            &mut last_blocks_persist_at,
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
                    &review_thread,
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
                    &mut turn_model_id,
                    &mut token_usage,
                    &mut blocks_dirty,
                    &mut message_state_dirty,
                    &mut thread_status_dirty,
                    &mut turn_model_dirty,
                );
                flush_stream_state(
                    &state,
                    &review_thread,
                    &assistant_message_id,
                    &blocks,
                    &message_status,
                    &thread_status,
                    &turn_model_id,
                    &mut blocks_dirty,
                    &mut message_state_dirty,
                    &mut thread_status_dirty,
                    &mut turn_model_dirty,
                    &mut last_persisted_thread_status,
                    &mut last_persist_at,
                    &mut last_blocks_persist_at,
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
            &review_thread,
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
            &mut turn_model_id,
            &mut token_usage,
            &mut blocks_dirty,
            &mut message_state_dirty,
            &mut thread_status_dirty,
            &mut turn_model_dirty,
        );
        flush_stream_state(
            &state,
            &review_thread,
            &assistant_message_id,
            &blocks,
            &message_status,
            &thread_status,
            &turn_model_id,
            &mut blocks_dirty,
            &mut message_state_dirty,
            &mut thread_status_dirty,
            &mut turn_model_dirty,
            &mut last_persisted_thread_status,
            &mut last_persist_at,
            &mut last_blocks_persist_at,
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
        &review_thread,
        &assistant_message_id,
        &blocks,
        &message_status,
        &thread_status,
        &turn_model_id,
        &mut blocks_dirty,
        &mut message_state_dirty,
        &mut thread_status_dirty,
        &mut turn_model_dirty,
        &mut last_persisted_thread_status,
        &mut last_persist_at,
        &mut last_blocks_persist_at,
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
                Some(turn_model_id.as_str()),
            )
        }
    })
    .await
    {
        log::warn!("failed to complete review assistant message: {error}");
    }

    if matches!(message_status, MessageStatusDto::Completed) {
        if let Err(error) = run_db(state.db.clone(), {
            let thread_id = review_thread.id.clone();
            let token_usage = token_usage;
            move |db| db::threads::bump_message_counters(db, &thread_id, token_usage)
        })
        .await
        {
            log::warn!("failed to bump review thread counters: {error}");
        }
    }

    let latest_review_thread = run_db(state.db.clone(), {
        let review_thread_id = review_thread.id.clone();
        move |db| {
            db::threads::get_thread(db, &review_thread_id)?.ok_or_else(|| {
                anyhow::anyhow!("review thread not found before final thread-updated emit")
            })
        }
    })
    .await
    .ok();
    let _ = app.emit(
        "thread-updated",
        ThreadUpdatedEvent {
            thread_id: review_thread.id.clone(),
            workspace_id: review_thread.workspace_id.clone(),
            thread: latest_review_thread,
        },
    );

    state.turns.finish(&source_thread.id).await;
    state.turns.finish(&review_thread.id).await;
}

fn is_coalescable_stream_event(event: &EngineEvent) -> bool {
    matches!(
        event,
        EngineEvent::TextDelta { .. }
            | EngineEvent::ThinkingDelta { .. }
            | EngineEvent::ActionOutputDelta { .. }
            | EngineEvent::ActionProgressUpdated { .. }
    )
}

fn coalesced_event_content_len(event: &EngineEvent) -> usize {
    match event {
        EngineEvent::TextDelta { content }
        | EngineEvent::ThinkingDelta { content }
        | EngineEvent::ActionOutputDelta { content, .. } => content.len(),
        EngineEvent::ActionProgressUpdated { message, .. } => message.len(),
        _ => 0,
    }
}

fn same_output_stream(left: &OutputStream, right: &OutputStream) -> bool {
    matches!(
        (left, right),
        (OutputStream::Stdout, OutputStream::Stdout)
            | (OutputStream::Stderr, OutputStream::Stderr)
            | (OutputStream::Stdin, OutputStream::Stdin)
    )
}

#[allow(clippy::result_large_err)]
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
        (
            EngineEvent::ActionProgressUpdated {
                action_id,
                message: _,
            },
            EngineEvent::ActionProgressUpdated {
                action_id: next_action_id,
                message: next_message,
            },
        ) if action_id == next_action_id => Ok(EngineEvent::ActionProgressUpdated {
            action_id,
            message: next_message,
        }),
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
    let mut normalized_event = event.clone();
    if let EngineEvent::ActionCompleted { result, .. } = &mut normalized_event {
        truncate_action_result_output(result, max_output_chars);
    }

    let _ = app.emit(stream_event_topic, &normalized_event);
    if matches!(&normalized_event, EngineEvent::ApprovalRequested { .. }) {
        let _ = app.emit(approval_event_topic, &normalized_event);
    }

    if state.config.debug.persist_engine_event_logs {
        if let Ok(value) = serde_json::to_value(&normalized_event) {
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

    match &normalized_event {
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
        &normalized_event,
        max_output_chars,
    )
}

#[allow(clippy::too_many_arguments)]
fn apply_stream_progress(
    progress: EventProgress,
    message_status: &mut MessageStatusDto,
    thread_status: &mut ThreadStatusDto,
    turn_model_id: &mut String,
    token_usage: &mut Option<(u64, u64)>,
    blocks_dirty: &mut bool,
    message_state_dirty: &mut bool,
    thread_status_dirty: &mut bool,
    turn_model_dirty: &mut bool,
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

    if let Some(next_turn_model_id) = progress.turn_model_id {
        if *turn_model_id != next_turn_model_id {
            *turn_model_id = next_turn_model_id;
            *turn_model_dirty = true;
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
    turn_model_id: &str,
    blocks_dirty: &mut bool,
    message_state_dirty: &mut bool,
    thread_status_dirty: &mut bool,
    turn_model_dirty: &mut bool,
    last_persisted_thread_status: &mut ThreadStatusDto,
    last_persist_at: &mut Instant,
    last_blocks_persist_at: &mut Instant,
    force: bool,
) {
    if !*blocks_dirty && !*message_state_dirty && !*thread_status_dirty && !*turn_model_dirty {
        return;
    }

    let now = Instant::now();

    if *thread_status_dirty && *last_persisted_thread_status == *thread_status {
        *thread_status_dirty = false;
    }

    let should_flush_state =
        force || now.duration_since(*last_persist_at) >= STREAM_DB_FLUSH_INTERVAL;
    let should_flush_blocks =
        force || now.duration_since(*last_blocks_persist_at) >= STREAM_DB_BLOCKS_FLUSH_INTERVAL;

    if !should_flush_blocks && !should_flush_state {
        return;
    }

    let mut did_flush_state = false;
    let mut did_flush_blocks = false;

    if *blocks_dirty && should_flush_blocks {
        match serde_json::to_string(blocks) {
            Ok(blocks_json) => {
                if let Err(error) = run_db(state.db.clone(), {
                    let assistant_message_id = assistant_message_id.to_string();
                    let message_status = message_status.clone();
                    let turn_model_id = turn_model_id.to_string();
                    move |db| {
                        db::messages::update_assistant_blocks_json(
                            db,
                            &assistant_message_id,
                            &blocks_json,
                            message_status,
                            Some(turn_model_id.as_str()),
                        )
                    }
                })
                .await
                {
                    log::warn!("failed to persist assistant stream blocks: {error}");
                } else {
                    *blocks_dirty = false;
                    *message_state_dirty = false;
                    *turn_model_dirty = false;
                    did_flush_blocks = true;
                    did_flush_state = true;
                }
            }
            Err(error) => {
                log::warn!("failed to serialize assistant stream blocks: {error}");
            }
        }
    } else if *message_state_dirty && should_flush_state {
        if let Err(error) = run_db(state.db.clone(), {
            let assistant_message_id = assistant_message_id.to_string();
            let message_status = message_status.clone();
            move |db| {
                db::messages::update_assistant_status(db, &assistant_message_id, message_status)
            }
        })
        .await
        {
            log::warn!("failed to persist assistant stream status: {error}");
        } else {
            *message_state_dirty = false;
            did_flush_state = true;
        }
    }

    if *turn_model_dirty && should_flush_state {
        if let Err(error) = run_db(state.db.clone(), {
            let assistant_message_id = assistant_message_id.to_string();
            let turn_model_id = turn_model_id.to_string();
            move |db| {
                db::messages::update_assistant_turn_model_id(
                    db,
                    &assistant_message_id,
                    &turn_model_id,
                )
            }
        })
        .await
        {
            log::warn!("failed to persist assistant turn model id during stream: {error}");
        } else {
            *turn_model_dirty = false;
            did_flush_state = true;
        }
    }

    if *thread_status_dirty && should_flush_state && *last_persisted_thread_status != *thread_status
    {
        if let Err(error) = run_db(state.db.clone(), {
            let thread_id = thread.id.clone();
            let thread_status = thread_status.clone();
            move |db| db::threads::update_thread_status(db, &thread_id, thread_status)
        })
        .await
        {
            log::warn!("failed to persist thread status during stream: {error}");
        } else {
            *last_persisted_thread_status = thread_status.clone();
            *thread_status_dirty = false;
            did_flush_state = true;
        }
    }

    if did_flush_blocks {
        *last_blocks_persist_at = now;
    }
    if did_flush_state {
        *last_persist_at = now;
    }
}

async fn maybe_update_thread_title(
    state: &AppState,
    thread: &ThreadDto,
    engine_thread_id: &str,
    user_message: &str,
) -> Option<ThreadDto> {
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

    let updated_thread = match run_db(state.db.clone(), {
        let thread_id = thread.id.clone();
        let candidate = candidate.clone();
        move |db| {
            db::threads::update_thread_title(db, &thread_id, &candidate)?;
            db::threads::get_thread(db, &thread_id)?
                .ok_or_else(|| anyhow::anyhow!("thread not found after title update: {thread_id}"))
        }
    })
    .await
    {
        Ok(updated_thread) => updated_thread,
        Err(error) => {
            log::warn!("failed to update thread title: {error}");
            return None;
        }
    };

    if let Err(error) = state
        .engines
        .set_thread_name(thread, engine_thread_id, &candidate)
        .await
    {
        log::debug!("failed to sync thread name with engine: {error}");
    }

    Some(updated_thread)
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
        EngineEvent::TurnStarted { .. } => {
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
                        OutputStream::Stdin => "stdin",
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
        EngineEvent::ActionProgressUpdated { action_id, message } => {
            if let Some(index) = action_index.get(action_id).copied() {
                if let Some(ContentBlock::Action { details, .. }) = blocks.get_mut(index) {
                    progress.blocks_changed = update_action_progress(details, message);
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
        EngineEvent::ModelRerouted {
            from_model,
            to_model,
            reason,
        } => {
            let block = ContentBlock::Notice {
                kind: "model_rerouted".to_string(),
                level: "info".to_string(),
                title: "Model rerouted".to_string(),
                message: format_model_reroute_notice(from_model, to_model, reason),
            };
            progress.blocks_changed = upsert_notice_block(
                blocks,
                action_index,
                approval_index,
                "model_rerouted",
                block,
            );
            progress.turn_model_id = Some(to_model.to_string());
            progress.force_persist = true;
        }
        EngineEvent::Notice {
            kind,
            level,
            title,
            message,
        } => {
            let block = ContentBlock::Notice {
                kind: kind.to_string(),
                level: level.to_string(),
                title: title.to_string(),
                message: message.to_string(),
            };
            progress.blocks_changed =
                upsert_notice_block(blocks, action_index, approval_index, kind, block);
            progress.force_persist = true;
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
        is_steer: None,
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

fn update_action_progress(details: &mut Value, message: &str) -> bool {
    let current_message = details
        .get("progressMessage")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let current_kind = details
        .get("progressKind")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);

    if current_message.as_deref() == Some(message) && current_kind.as_deref() == Some("mcp") {
        return false;
    }

    if !details.is_object() {
        *details = Value::Object(serde_json::Map::new());
    }

    if let Some(details_object) = details.as_object_mut() {
        details_object.insert("progressKind".to_string(), Value::String("mcp".to_string()));
        details_object.insert(
            "progressMessage".to_string(),
            Value::String(message.to_string()),
        );
        return true;
    }

    false
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

fn upsert_notice_block(
    blocks: &mut Vec<ContentBlock>,
    action_index: &mut HashMap<String, usize>,
    approval_index: &mut HashMap<String, usize>,
    kind: &str,
    block: ContentBlock,
) -> bool {
    if let Some(index) = blocks.iter().position(|existing| {
        matches!(
            existing,
            ContentBlock::Notice {
                kind: existing_kind,
                ..
            } if existing_kind == kind
        )
    }) {
        if let Some(existing) = blocks.get_mut(index) {
            *existing = block;
            return true;
        }
    }

    blocks.insert(0, block);
    rebuild_block_indexes(blocks, action_index, approval_index);
    true
}

fn rebuild_block_indexes(
    blocks: &[ContentBlock],
    action_index: &mut HashMap<String, usize>,
    approval_index: &mut HashMap<String, usize>,
) {
    action_index.clear();
    approval_index.clear();

    for (index, block) in blocks.iter().enumerate() {
        match block {
            ContentBlock::Action { action_id, .. } => {
                action_index.insert(action_id.clone(), index);
            }
            ContentBlock::Approval { approval_id, .. } => {
                approval_index.insert(approval_id.clone(), index);
            }
            _ => {}
        }
    }
}

fn format_model_reroute_notice(from_model: &str, to_model: &str, reason: &str) -> String {
    format!("Switched from {from_model} to {to_model} ({reason}).")
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

fn truncate_action_result_output(
    result: &mut crate::engines::events::ActionResult,
    max_chars: usize,
) {
    let Some(output) = result.output.as_ref() else {
        return;
    };

    let truncated = truncate_chars(output, max_chars.max(1));
    if truncated != *output {
        result.output = Some(truncated);
    }
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

fn approval_policy_for_engine_and_trust_level(
    engine_id: &str,
    trust_level: &TrustLevelDto,
) -> &'static str {
    match engine_id {
        "claude" => match trust_level {
            TrustLevelDto::Trusted => "trusted",
            TrustLevelDto::Standard => "standard",
            TrustLevelDto::Restricted => "restricted",
        },
        _ => match trust_level {
            TrustLevelDto::Trusted => "on-request",
            TrustLevelDto::Standard => "on-request",
            TrustLevelDto::Restricted => "untrusted",
        },
    }
}

fn allow_network_for_trust_level(trust_level: &TrustLevelDto) -> bool {
    matches!(trust_level, TrustLevelDto::Trusted)
}

fn thread_approval_policy_override_value(
    engine_id: &str,
    metadata: Option<&Value>,
) -> Result<Option<Value>, String> {
    match engine_id {
        "claude" => Ok(metadata
            .and_then(|value| value.get("claudePermissionMode"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| matches!(*value, "trusted" | "standard" | "restricted"))
            .map(|value| Value::String(value.to_string()))),
        _ => metadata
            .and_then(|value| value.get("sandboxApprovalPolicy"))
            .map(normalize_codex_approval_policy_value)
            .transpose(),
    }
}

fn thread_allow_network_override(metadata: Option<&Value>) -> Option<bool> {
    metadata
        .and_then(|value| value.get("sandboxAllowNetwork"))
        .and_then(Value::as_bool)
}

fn thread_sandbox_mode(metadata: Option<&Value>) -> Result<Option<String>, String> {
    let value = metadata
        .and_then(|value| value.get("sandboxMode"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    let Some(value) = value else {
        return Ok(None);
    };

    let normalized = match value.to_lowercase().as_str() {
        "readonly" | "read-only" | "read_only" => "read-only",
        "workspacewrite" | "workspace-write" | "workspace_write" => "workspace-write",
        "dangerfullaccess" | "danger-full-access" | "danger_full_access" => {
            "danger-full-access"
        }
        _ => {
            return Err(format!(
                "invalid sandbox mode `{value}` on thread metadata. expected one of: read-only, workspace-write, danger-full-access"
            ))
        }
    };

    Ok(Some(normalized.to_string()))
}

fn workspace_writable_roots_from_metadata(
    metadata: Option<&Value>,
) -> Result<Option<Vec<String>>, String> {
    let Some(raw_roots) = metadata.and_then(|value| value.get("workspaceWritableRoots")) else {
        return Ok(None);
    };

    let roots = raw_roots.as_array().ok_or_else(|| {
        "invalid `workspaceWritableRoots` on thread metadata. expected an array of paths"
            .to_string()
    })?;

    let mut normalized = Vec::with_capacity(roots.len());
    for root in roots {
        let root = root.as_str().map(str::trim).filter(|value| !value.is_empty()).ok_or_else(
            || {
                "invalid `workspaceWritableRoots` on thread metadata. expected non-empty string paths"
                    .to_string()
            },
        )?;
        normalized.push(root.to_string());
    }

    Ok(Some(normalized))
}

struct WorkspaceWritableRootsResolution {
    roots: Vec<String>,
    requires_confirmation: bool,
}

fn resolve_workspace_writable_roots<'a>(
    repo_paths: impl IntoIterator<Item = &'a str>,
    workspace_root: &str,
    metadata: Option<&Value>,
) -> Result<WorkspaceWritableRootsResolution, String> {
    let available_roots: Vec<String> = repo_paths.into_iter().map(ToOwned::to_owned).collect();
    let confirmed_roots = workspace_writable_roots_from_metadata(metadata)?;

    if let Some(confirmed_roots) = confirmed_roots {
        if confirmed_roots.is_empty() {
            return Ok(WorkspaceWritableRootsResolution {
                roots: vec![workspace_root.to_string()],
                requires_confirmation: false,
            });
        }

        let available_set: std::collections::HashSet<&str> =
            available_roots.iter().map(String::as_str).collect();
        let mut filtered_roots = Vec::with_capacity(confirmed_roots.len());
        for root in confirmed_roots {
            if available_set.contains(root.as_str()) {
                filtered_roots.push(root);
            }
        }
        if !filtered_roots.is_empty() {
            return Ok(WorkspaceWritableRootsResolution {
                roots: filtered_roots,
                requires_confirmation: false,
            });
        }

        return Ok(match available_roots.len() {
            0 => WorkspaceWritableRootsResolution {
                roots: vec![workspace_root.to_string()],
                requires_confirmation: false,
            },
            1 => WorkspaceWritableRootsResolution {
                roots: available_roots,
                requires_confirmation: false,
            },
            _ => WorkspaceWritableRootsResolution {
                roots: available_roots,
                requires_confirmation: true,
            },
        });
    }

    if available_roots.is_empty() {
        Ok(WorkspaceWritableRootsResolution {
            roots: vec![workspace_root.to_string()],
            requires_confirmation: false,
        })
    } else {
        Ok(WorkspaceWritableRootsResolution {
            roots: available_roots,
            requires_confirmation: false,
        })
    }
}

fn sandbox_mode_requires_workspace_opt_in(mode: &str) -> bool {
    !mode.eq_ignore_ascii_case("read-only")
}

fn workspace_write_confirmation_required(
    resolution: Option<&WorkspaceWritableRootsResolution>,
    sandbox_mode: &str,
    opt_in_enabled: bool,
) -> bool {
    let Some(resolution) = resolution else {
        return false;
    };

    sandbox_mode_requires_workspace_opt_in(sandbox_mode)
        && (resolution.requires_confirmation || (resolution.roots.len() > 1 && !opt_in_enabled))
}

fn unsupported_thread_sandbox_override_for_external_sandbox(
    sandbox_mode: Option<&str>,
    external_sandbox_active: bool,
) -> bool {
    external_sandbox_active && matches!(sandbox_mode, Some("read-only" | "workspace-write"))
}

fn thread_reasoning_effort(metadata: Option<&Value>) -> Option<String> {
    metadata
        .and_then(|value| value.get("reasoningEffort"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn thread_last_model_id(metadata: Option<&Value>) -> Option<String> {
    metadata
        .and_then(|value| value.get("lastModelId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn thread_service_tier(metadata: Option<&Value>) -> Option<String> {
    metadata
        .and_then(|value| value.get("serviceTier"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| matches!(*value, "fast" | "flex"))
        .map(ToOwned::to_owned)
}

fn thread_personality(metadata: Option<&Value>) -> Option<String> {
    metadata
        .and_then(|value| value.get("personality"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| matches!(*value, "none" | "friendly" | "pragmatic"))
        .map(ToOwned::to_owned)
}

fn thread_output_schema(metadata: Option<&Value>) -> Option<Value> {
    metadata
        .and_then(|value| value.get("outputSchema"))
        .cloned()
}

fn normalize_reasoning_effort_value(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase)
}

fn resolve_reasoning_effort_for_model(
    model: &EngineModelDto,
    requested_effort: Option<&str>,
) -> Option<String> {
    let normalized_requested = normalize_reasoning_effort_value(requested_effort);
    if let Some(requested) = normalized_requested.as_ref() {
        if model
            .supported_reasoning_efforts
            .iter()
            .any(|option| option.reasoning_effort == *requested)
        {
            return Some(requested.clone());
        }
    }

    let normalized_default =
        normalize_reasoning_effort_value(Some(model.default_reasoning_effort.as_str()));
    if let Some(default_effort) = normalized_default.as_ref() {
        if model
            .supported_reasoning_efforts
            .iter()
            .any(|option| option.reasoning_effort == *default_effort)
        {
            return Some(default_effort.clone());
        }
    }

    model
        .supported_reasoning_efforts
        .iter()
        .map(|option| option.reasoning_effort.trim())
        .find(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or(normalized_default)
        .or(normalized_requested)
}

fn resolve_reasoning_effort_from_catalog(
    engines: &[EngineInfoDto],
    engine_id: &str,
    model_id: &str,
    requested_effort: Option<&str>,
) -> Option<String> {
    let normalized_requested = normalize_reasoning_effort_value(requested_effort);
    let Some(model) = engines
        .iter()
        .find(|engine| engine.id == engine_id)
        .and_then(|engine| engine.models.iter().find(|model| model.id == model_id))
    else {
        return normalized_requested;
    };

    resolve_reasoning_effort_for_model(model, normalized_requested.as_deref())
}

fn normalize_codex_approval_policy_value(value: &Value) -> Result<Value, String> {
    match value {
        Value::String(raw) => {
            let normalized = raw.trim().to_lowercase();
            let normalized = normalized.as_str();
            if matches!(
                normalized,
                "untrusted" | "on-failure" | "on-request" | "never"
            ) {
                Ok(Value::String(normalized.to_string()))
            } else {
                Err(format!(
                    "invalid approval policy `{normalized}`. expected one of: untrusted, on-failure, on-request, never"
                ))
            }
        }
        Value::Object(object) => {
            let reject = object
                .get("reject")
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    "invalid structured approval policy. expected a `reject` object".to_string()
                })?;

            for required_key in ["mcp_elicitations", "rules", "sandbox_approval"] {
                if !reject.get(required_key).and_then(Value::as_bool).is_some() {
                    return Err(format!(
                        "invalid structured approval policy. missing boolean reject.{required_key}"
                    ));
                }
            }

            if reject.contains_key("request_permissions")
                && reject
                    .get("request_permissions")
                    .and_then(Value::as_bool)
                    .is_none()
            {
                return Err(
                    "invalid structured approval policy. reject.request_permissions must be a boolean"
                        .to_string(),
                );
            }

            Ok(Value::Object(object.clone()))
        }
        _ => Err(
            "invalid approval policy. expected a string mode or structured reject object"
                .to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc};

    use super::*;
    use crate::{
        config::app_config::AppConfig,
        db,
        engines::EngineManager,
        git::{repo::FileTreeCache, watcher::GitWatcherManager},
        models::{EngineCapabilitiesDto, ReasoningEffortOptionDto},
        power::KeepAwakeManager,
        state::{AppState, TurnManager},
        terminal::TerminalManager,
    };
    use rusqlite::params;
    use uuid::Uuid;

    fn test_app_state() -> AppState {
        let root = std::env::temp_dir().join(format!("panes-chat-cmd-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("failed to create temp root");
        let db = crate::db::Database::open(root.join("workspaces.db"))
            .expect("failed to create test database");
        AppState {
            db,
            config: Arc::new(AppConfig::default()),
            config_write_lock: Arc::new(tokio::sync::Mutex::new(())),
            engines: Arc::new(EngineManager::new()),
            git_watchers: Arc::new(GitWatcherManager::default()),
            terminals: Arc::new(TerminalManager::default()),
            keep_awake: Arc::new(KeepAwakeManager::new()),
            turns: Arc::new(TurnManager::default()),
            file_tree_cache: Arc::new(FileTreeCache::new()),
        }
    }

    fn test_thread(state: &AppState, engine_id: &str, model_id: &str) -> ThreadDto {
        let workspace_root =
            std::env::temp_dir().join(format!("panes-chat-workspace-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_root).expect("failed to create workspace root");
        let workspace = db::workspaces::upsert_workspace(
            &state.db,
            workspace_root.to_string_lossy().as_ref(),
            Some(1),
        )
        .expect("failed to create workspace");
        db::threads::create_thread(
            &state.db,
            &workspace.id,
            None,
            engine_id,
            model_id,
            "Thread",
        )
        .expect("failed to create thread")
    }

    fn insert_pending_approval(state: &AppState, thread: &ThreadDto, approval_id: &str) -> String {
        let assistant_message = db::messages::insert_assistant_placeholder(
            &state.db,
            &thread.id,
            Some(thread.engine_id.as_str()),
            Some(thread.model_id.as_str()),
            None,
        )
        .expect("failed to create assistant message");
        db::actions::insert_approval(
            &state.db,
            approval_id,
            &thread.id,
            &assistant_message.id,
            &crate::engines::events::ActionType::Command,
            "Run command",
            &serde_json::json!({ "command": "touch file.txt" }),
        )
        .expect("failed to insert approval");
        db::threads::update_thread_status(&state.db, &thread.id, ThreadStatusDto::AwaitingApproval)
            .expect("failed to set thread status");

        let blocks = serde_json::json!([
            {
                "type": "approval",
                "approvalId": approval_id,
                "actionType": "command",
                "summary": "Run command",
                "details": { "command": "touch file.txt" },
                "status": "pending"
            }
        ]);
        let conn = state.db.connect().expect("failed to open db connection");
        conn.execute(
            "UPDATE messages SET blocks_json = ?1 WHERE id = ?2",
            params![blocks.to_string(), assistant_message.id],
        )
        .expect("failed to persist approval block");
        assistant_message.id
    }

    #[test]
    fn external_sandbox_allows_default_workspace_write_mode() {
        assert!(!unsupported_thread_sandbox_override_for_external_sandbox(
            None, true,
        ));
    }

    #[test]
    fn normalize_input_items_merges_adjacent_text_and_preserves_typed_items() {
        let normalized = normalize_input_items(
            "fallback",
            Some(vec![
                ChatInputItemPayload::Text {
                    text: "Use ".to_string(),
                },
                ChatInputItemPayload::Text {
                    text: "$lint".to_string(),
                },
                ChatInputItemPayload::Skill {
                    name: "lint".to_string(),
                    path: "/tmp/skills/lint".to_string(),
                },
                ChatInputItemPayload::Mention {
                    name: "Docs".to_string(),
                    path: "app://docs".to_string(),
                },
                ChatInputItemPayload::Text {
                    text: " now".to_string(),
                },
            ]),
        )
        .expect("input items should normalize");

        assert_eq!(
            normalized,
            vec![
                TurnInputItem::Text {
                    text: "Use $lint".to_string(),
                },
                TurnInputItem::Skill {
                    name: "lint".to_string(),
                    path: "/tmp/skills/lint".to_string(),
                },
                TurnInputItem::Mention {
                    name: "Docs".to_string(),
                    path: "app://docs".to_string(),
                },
                TurnInputItem::Text {
                    text: " now".to_string(),
                },
            ]
        );
    }

    #[test]
    fn normalize_input_items_rejects_blank_typed_entries() {
        let error = normalize_input_items(
            "fallback",
            Some(vec![ChatInputItemPayload::Skill {
                name: " ".to_string(),
                path: "/tmp/skills/lint".to_string(),
            }]),
        )
        .expect_err("blank skill names should be rejected");

        assert!(error.contains("skill input items require non-empty name and path"));
    }

    #[test]
    fn normalize_codex_review_target_builds_commit_payload() {
        let (target, message, title) =
            normalize_codex_review_target(&CodexReviewTargetPayload::Commit {
                sha: "abcdef1234567890".to_string(),
                title: Some("Refactor auth flow".to_string()),
            })
            .expect("commit target should normalize");

        assert_eq!(
            target,
            serde_json::json!({
                "type": "commit",
                "sha": "abcdef1234567890",
                "title": "Refactor auth flow",
            })
        );
        assert_eq!(
            message,
            "Review commit `abcdef1234567890`: Refactor auth flow"
        );
        assert_eq!(title, "Review: abcdef123456");
    }

    #[test]
    fn clone_codex_review_metadata_clears_runtime_only_fields() {
        let metadata = clone_codex_review_metadata(
            Some(&serde_json::json!({
                "manualTitle": true,
                "manualTitleUpdatedAt": "2026-03-12T00:00:00Z",
                "codexPreview": "old preview",
                "codexThreadStatus": "active",
                "codexThreadActiveFlags": ["waitingOnApproval"],
                "codexSyncRequired": true,
                "codexSyncReason": "stale",
                "serviceTier": "fast",
            })),
            "gpt-5.4",
        )
        .expect("metadata should clone");

        assert_eq!(metadata.get("manualTitle"), None);
        assert_eq!(metadata.get("codexPreview"), None);
        assert_eq!(metadata.get("codexThreadStatus"), None);
        assert_eq!(metadata.get("codexThreadActiveFlags"), None);
        assert_eq!(metadata.get("codexSyncRequired"), None);
        assert_eq!(metadata.get("codexSyncReason"), None);
        assert_eq!(
            metadata.get("serviceTier"),
            Some(&serde_json::json!("fast"))
        );
        assert_eq!(
            metadata.get("lastModelId"),
            Some(&serde_json::json!("gpt-5.4"))
        );
    }

    #[test]
    fn normalize_input_items_rejects_non_empty_message_without_text_segments() {
        let error = normalize_input_items(
            "Use lint",
            Some(vec![ChatInputItemPayload::Skill {
                name: "lint".to_string(),
                path: "/tmp/skills/lint".to_string(),
            }]),
        )
        .expect_err("non-empty message text requires a text segment");

        assert!(error.contains("input items must include at least one text segment"));
    }

    #[test]
    fn external_sandbox_blocks_explicit_workspace_write_override() {
        assert!(unsupported_thread_sandbox_override_for_external_sandbox(
            Some("workspace-write"),
            true,
        ));
        assert!(unsupported_thread_sandbox_override_for_external_sandbox(
            Some("read-only"),
            true,
        ));
        assert!(!unsupported_thread_sandbox_override_for_external_sandbox(
            Some("danger-full-access"),
            true,
        ));
    }

    #[test]
    fn resolve_workspace_writable_roots_prefers_confirmed_subset() {
        let roots = resolve_workspace_writable_roots(
            ["/workspace/repo-a", "/workspace/repo-b"],
            "/workspace",
            Some(&serde_json::json!({
                "workspaceWritableRoots": ["/workspace/repo-b"]
            })),
        )
        .expect("expected confirmed roots to resolve");

        assert_eq!(roots.roots, vec![String::from("/workspace/repo-b")]);
        assert!(!roots.requires_confirmation);
    }

    #[test]
    fn resolve_workspace_writable_roots_drops_stale_confirmed_paths() {
        let roots = resolve_workspace_writable_roots(
            ["/workspace/repo-a", "/workspace/repo-b"],
            "/workspace",
            Some(&serde_json::json!({
                "workspaceWritableRoots": ["/workspace/repo-b", "/workspace/repo-c"]
            })),
        )
        .expect("expected stale confirmed roots to be ignored");

        assert_eq!(roots.roots, vec![String::from("/workspace/repo-b")]);
        assert!(!roots.requires_confirmation);
    }

    #[test]
    fn resolve_workspace_writable_roots_requires_reconfirmation_when_all_confirmed_roots_are_stale()
    {
        let roots = resolve_workspace_writable_roots(
            ["/workspace/repo-a", "/workspace/repo-b"],
            "/workspace",
            Some(&serde_json::json!({
                "workspaceWritableRoots": ["/workspace/repo-c"]
            })),
        )
        .expect("expected stale confirmed roots to resolve to current repos");

        assert_eq!(
            roots.roots,
            vec![
                String::from("/workspace/repo-a"),
                String::from("/workspace/repo-b")
            ]
        );
        assert!(roots.requires_confirmation);
    }

    #[test]
    fn read_only_workspace_threads_ignore_stale_confirmation_requirements() {
        let resolution = WorkspaceWritableRootsResolution {
            roots: vec![
                String::from("/workspace/repo-a"),
                String::from("/workspace/repo-b"),
            ],
            requires_confirmation: true,
        };

        assert!(!workspace_write_confirmation_required(
            Some(&resolution),
            "read-only",
            true,
        ));
        assert!(workspace_write_confirmation_required(
            Some(&resolution),
            "workspace-write",
            true,
        ));
    }

    #[test]
    fn claude_defaults_follow_trust_level_directly() {
        assert_eq!(
            approval_policy_for_engine_and_trust_level("claude", &TrustLevelDto::Trusted),
            "trusted"
        );
        assert_eq!(
            approval_policy_for_engine_and_trust_level("claude", &TrustLevelDto::Standard),
            "standard"
        );
        assert_eq!(
            approval_policy_for_engine_and_trust_level("claude", &TrustLevelDto::Restricted),
            "restricted"
        );
    }

    #[test]
    fn claude_permission_mode_override_uses_claude_key() {
        let metadata = serde_json::json!({
            "claudePermissionMode": "restricted",
            "sandboxApprovalPolicy": "never",
        });

        assert_eq!(
            thread_approval_policy_override_value("claude", Some(&metadata)).unwrap(),
            Some(Value::String("restricted".to_string()))
        );
        assert_eq!(
            thread_approval_policy_override_value("codex", Some(&metadata)).unwrap(),
            Some(Value::String("never".to_string()))
        );
    }

    #[test]
    fn invalid_structured_codex_approval_policy_is_rejected() {
        let metadata = serde_json::json!({
            "sandboxApprovalPolicy": {
                "reject": {
                    "rules": true,
                    "sandbox_approval": false
                }
            }
        });

        let error = thread_approval_policy_override_value("codex", Some(&metadata))
            .expect_err("expected malformed structured approval policy to fail");

        assert!(error.contains("reject.mcp_elicitations"));
    }

    #[test]
    fn action_progress_coalescing_keeps_latest_message() {
        let merged = try_coalesce_stream_events(
            EngineEvent::ActionProgressUpdated {
                action_id: "action-1".to_string(),
                message: "Connecting".to_string(),
            },
            EngineEvent::ActionProgressUpdated {
                action_id: "action-1".to_string(),
                message: "Fetching results".to_string(),
            },
        )
        .expect("expected coalesced action progress");

        match merged {
            EngineEvent::ActionProgressUpdated { action_id, message } => {
                assert_eq!(action_id, "action-1");
                assert_eq!(message, "Fetching results");
            }
            other => panic!("expected action progress event, got {other:?}"),
        }
    }

    #[test]
    fn model_reroute_notice_reindexes_action_blocks() {
        let mut blocks = Vec::new();
        let mut action_index = HashMap::new();
        let mut approval_index = HashMap::new();

        let started = apply_event_to_blocks(
            &mut blocks,
            &mut action_index,
            &mut approval_index,
            &EngineEvent::ActionStarted {
                action_id: "action-1".to_string(),
                engine_action_id: Some("item-1".to_string()),
                action_type: crate::engines::events::ActionType::Other,
                summary: "search_docs".to_string(),
                details: serde_json::json!({}),
            },
            1000,
        );
        assert!(started.blocks_changed);

        let rerouted = apply_event_to_blocks(
            &mut blocks,
            &mut action_index,
            &mut approval_index,
            &EngineEvent::ModelRerouted {
                from_model: "gpt-5.1-codex-mini".to_string(),
                to_model: "gpt-5.3-codex".to_string(),
                reason: "highRiskCyberActivity".to_string(),
            },
            1000,
        );
        assert!(rerouted.blocks_changed);
        assert_eq!(rerouted.turn_model_id.as_deref(), Some("gpt-5.3-codex"));

        let progress = apply_event_to_blocks(
            &mut blocks,
            &mut action_index,
            &mut approval_index,
            &EngineEvent::ActionProgressUpdated {
                action_id: "action-1".to_string(),
                message: "Fetching results".to_string(),
            },
            1000,
        );
        assert!(progress.blocks_changed);

        assert!(matches!(
            &blocks[0],
            ContentBlock::Notice {
                kind,
                level,
                title,
                ..
            } if kind == "model_rerouted" && level == "info" && title == "Model rerouted"
        ));
        match &blocks[1] {
            ContentBlock::Action { details, .. } => {
                assert_eq!(
                    details
                        .get("progressKind")
                        .and_then(serde_json::Value::as_str),
                    Some("mcp")
                );
                assert_eq!(
                    details
                        .get("progressMessage")
                        .and_then(serde_json::Value::as_str),
                    Some("Fetching results")
                );
            }
            other => panic!("expected action block, got {other:?}"),
        }
    }

    #[test]
    fn generic_notice_blocks_are_upserted_by_kind() {
        let mut blocks = Vec::new();
        let mut action_index = HashMap::new();
        let mut approval_index = HashMap::new();

        let first = apply_event_to_blocks(
            &mut blocks,
            &mut action_index,
            &mut approval_index,
            &EngineEvent::Notice {
                kind: "deprecation_notice".to_string(),
                level: "warning".to_string(),
                title: "Deprecation notice".to_string(),
                message: "Use the newer API.".to_string(),
            },
            1000,
        );
        assert!(first.blocks_changed);

        let second = apply_event_to_blocks(
            &mut blocks,
            &mut action_index,
            &mut approval_index,
            &EngineEvent::Notice {
                kind: "deprecation_notice".to_string(),
                level: "warning".to_string(),
                title: "Deprecation notice".to_string(),
                message: "Use the newer permissions API.".to_string(),
            },
            1000,
        );
        assert!(second.blocks_changed);
        assert_eq!(blocks.len(), 1);
        assert!(matches!(
            &blocks[0],
            ContentBlock::Notice { message, .. } if message == "Use the newer permissions API."
        ));
    }

    #[test]
    fn approval_response_persistence_tracks_permissions_session_scope() {
        let response = serde_json::json!({
            "permissions": {
                "network": {
                    "enabled": true
                }
            },
            "scope": "session"
        });

        assert_eq!(
            approval_response_decision_for_persistence(&response),
            "accept_for_session"
        );
    }

    #[test]
    fn approval_response_persistence_tracks_mcp_elicitation_actions() {
        let response = serde_json::json!({
            "action": "decline"
        });

        assert_eq!(
            approval_response_decision_for_persistence(&response),
            "decline"
        );
    }

    #[test]
    fn approval_response_persistence_treats_empty_permissions_as_decline() {
        let response = serde_json::json!({
            "permissions": {},
            "scope": "turn"
        });

        assert_eq!(
            approval_response_decision_for_persistence(&response),
            "decline"
        );
    }

    #[tokio::test]
    async fn invalid_claude_approval_response_keeps_approval_pending() {
        let state = test_app_state();
        let thread = test_thread(&state, "claude", "claude-sonnet-4-6");
        let approval_id = "approval-invalid";
        let message_id = insert_pending_approval(&state, &thread, approval_id);

        let error = respond_to_approval_inner(
            &state,
            thread.id.clone(),
            approval_id.to_string(),
            serde_json::json!({}),
        )
        .await
        .expect_err("expected invalid approval payload to fail");

        assert!(error.contains("explicit `decision`"));

        let conn = state.db.connect().expect("failed to open db connection");
        let approval_row = conn
            .query_row(
                "SELECT status, decision FROM approvals WHERE id = ?1",
                params![approval_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .expect("failed to load approval row");
        assert_eq!(approval_row.0, "pending");
        assert_eq!(approval_row.1, None);

        let thread_status = conn
            .query_row(
                "SELECT status FROM threads WHERE id = ?1",
                params![thread.id],
                |row| row.get::<_, String>(0),
            )
            .expect("failed to load thread status");
        assert_eq!(thread_status, "awaiting_approval");

        let raw_blocks = conn
            .query_row(
                "SELECT blocks_json FROM messages WHERE id = ?1",
                params![message_id],
                |row| row.get::<_, String>(0),
            )
            .expect("failed to load message blocks");
        let blocks: Value =
            serde_json::from_str(&raw_blocks).expect("message blocks should deserialize");
        assert_eq!(
            blocks
                .as_array()
                .and_then(|items| items.first())
                .and_then(|item| item.get("status"))
                .and_then(Value::as_str),
            Some("pending")
        );
        assert!(blocks
            .as_array()
            .and_then(|items| items.first())
            .and_then(|item| item.get("decision"))
            .is_none());
    }

    #[test]
    fn resolve_reasoning_effort_from_catalog_falls_back_to_model_default() {
        let engines = vec![EngineInfoDto {
            id: "codex".to_string(),
            name: "Codex".to_string(),
            models: vec![EngineModelDto {
                id: "gpt-5.1-codex-mini".to_string(),
                display_name: "GPT-5.1 Codex Mini".to_string(),
                description: String::new(),
                hidden: false,
                is_default: false,
                upgrade: None,
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string()],
                supports_personality: false,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOptionDto {
                        reasoning_effort: "medium".to_string(),
                        description: String::new(),
                    },
                    ReasoningEffortOptionDto {
                        reasoning_effort: "high".to_string(),
                        description: String::new(),
                    },
                ],
            }],
            capabilities: EngineCapabilitiesDto {
                permission_modes: Vec::new(),
                sandbox_modes: Vec::new(),
                approval_decisions: Vec::new(),
            },
        }];

        assert_eq!(
            resolve_reasoning_effort_from_catalog(
                &engines,
                "codex",
                "gpt-5.1-codex-mini",
                Some("xhigh"),
            ),
            Some("medium".to_string())
        );
    }

    #[test]
    fn resolve_reasoning_effort_from_catalog_keeps_supported_effort() {
        let engines = vec![EngineInfoDto {
            id: "codex".to_string(),
            name: "Codex".to_string(),
            models: vec![EngineModelDto {
                id: "gpt-5.1-codex-mini".to_string(),
                display_name: "GPT-5.1 Codex Mini".to_string(),
                description: String::new(),
                hidden: false,
                is_default: false,
                upgrade: None,
                availability_nux: None,
                upgrade_info: None,
                input_modalities: vec!["text".to_string()],
                supports_personality: false,
                default_reasoning_effort: "medium".to_string(),
                supported_reasoning_efforts: vec![
                    ReasoningEffortOptionDto {
                        reasoning_effort: "medium".to_string(),
                        description: String::new(),
                    },
                    ReasoningEffortOptionDto {
                        reasoning_effort: "high".to_string(),
                        description: String::new(),
                    },
                ],
            }],
            capabilities: EngineCapabilitiesDto {
                permission_modes: Vec::new(),
                sandbox_modes: Vec::new(),
                approval_decisions: Vec::new(),
            },
        }];

        assert_eq!(
            resolve_reasoning_effort_from_catalog(
                &engines,
                "codex",
                "gpt-5.1-codex-mini",
                Some("high"),
            ),
            Some("high".to_string())
        );
    }

    #[test]
    fn resolve_turn_model_id_accepts_thread_last_model_without_catalog() {
        let state = test_app_state();
        let mut thread = test_thread(&state, "codex", "gpt-5.5-codex");
        thread.engine_metadata = Some(serde_json::json!({
            "lastModelId": "gpt-5.1-codex-mini"
        }));

        assert_eq!(
            resolve_turn_model_id(&thread, Some("gpt-5.1-codex-mini"), None)
                .expect("last model should resolve without a catalog"),
            "gpt-5.1-codex-mini"
        );
    }
}

fn resolve_turn_model_id(
    thread: &ThreadDto,
    requested_model_id: Option<&str>,
    engines: Option<&[EngineInfoDto]>,
) -> Result<String, String> {
    let Some(requested_model_id) = requested_model_id else {
        return Ok(thread.model_id.clone());
    };

    if requested_model_id == thread.model_id {
        return Ok(thread.model_id.clone());
    }

    if thread_last_model_id(thread.engine_metadata.as_ref()).as_deref() == Some(requested_model_id)
    {
        return Ok(requested_model_id.to_string());
    }

    if let Some(engines) = engines {
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

async fn model_supports_personality(state: &AppState, engine_id: &str, model_id: &str) -> bool {
    let Ok(engines) = state.engines.list_engines().await else {
        return false;
    };

    engines
        .iter()
        .find(|engine| engine.id == engine_id)
        .and_then(|engine| engine.models.iter().find(|model| model.id == model_id))
        .map(|model| model.supports_personality)
        .unwrap_or(false)
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
