use chrono::Utc;
use serde_json::json;
use tauri::State;

use crate::{
    db,
    models::{ThreadDto, ThreadStatusDto},
    state::AppState,
};

const MAX_THREAD_TITLE_CHARS: usize = 120;

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
pub async fn list_threads(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<ThreadDto>, String> {
    run_db(state.db.clone(), move |db| {
        db::threads::list_threads_for_workspace(db, &workspace_id)
    })
    .await
}

#[tauri::command]
pub async fn list_archived_threads(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<ThreadDto>, String> {
    run_db(state.db.clone(), move |db| {
        db::threads::list_archived_threads_for_workspace(db, &workspace_id)
    })
    .await
}

#[tauri::command]
pub async fn create_thread(
    state: State<'_, AppState>,
    workspace_id: String,
    repo_id: Option<String>,
    engine_id: String,
    model_id: String,
    title: String,
) -> Result<ThreadDto, String> {
    run_db(state.db.clone(), move |db| {
        db::threads::create_thread(
            db,
            &workspace_id,
            repo_id.as_deref(),
            &engine_id,
            &model_id,
            &title,
        )
    })
    .await
}

#[tauri::command]
pub async fn confirm_workspace_thread(
    state: State<'_, AppState>,
    thread_id: String,
    writable_roots: Vec<String>,
) -> Result<(), String> {
    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    if thread.repo_id.is_some() {
        return Err("confirmation only applies to workspace threads".to_string());
    }

    let mut metadata = thread.engine_metadata.unwrap_or_else(|| json!({}));
    if !metadata.is_object() {
        metadata = json!({});
    }

    if let Some(object) = metadata.as_object_mut() {
        object.insert("workspaceWriteOptIn".to_string(), json!(true));
        object.insert("workspaceWritableRoots".to_string(), json!(writable_roots));
        object.insert(
            "workspaceWriteConfirmedAt".to_string(),
            json!(Utc::now().to_rfc3339()),
        );
    }

    run_db(db, move |db| {
        db::threads::update_engine_metadata(db, &thread_id, &metadata)
    })
    .await
}

#[tauri::command]
pub async fn set_thread_reasoning_effort(
    state: State<'_, AppState>,
    thread_id: String,
    reasoning_effort: Option<String>,
    model_id: Option<String>,
) -> Result<(), String> {
    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;
    let normalized_model_id = model_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let effective_model_id = match normalized_model_id {
        Some(model_id) => {
            validate_model_for_thread_engine(state.inner(), &thread, model_id).await?
        }
        None => thread.model_id.clone(),
    };

    let normalized_effort = reasoning_effort
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);

    let validated_effort = if let Some(value) = normalized_effort.as_deref() {
        Some(
            validate_reasoning_effort(
                state.inner(),
                &thread.engine_id,
                effective_model_id.as_str(),
                value,
            )
            .await?,
        )
    } else {
        None
    };

    let mut metadata = thread.engine_metadata.unwrap_or_else(|| json!({}));
    if !metadata.is_object() {
        metadata = json!({});
    }

    if let Some(object) = metadata.as_object_mut() {
        match validated_effort {
            Some(value) => {
                object.insert("reasoningEffort".to_string(), json!(value));
            }
            None => {
                object.remove("reasoningEffort");
            }
        };
    }

    run_db(db, move |db| {
        db::threads::update_engine_metadata(db, &thread_id, &metadata)
    })
    .await
}

#[tauri::command]
pub async fn rename_thread(
    state: State<'_, AppState>,
    thread_id: String,
    title: String,
) -> Result<ThreadDto, String> {
    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    let normalized_title = normalize_thread_title(&title)?;

    run_db(db.clone(), {
        let thread_id = thread_id.clone();
        let normalized_title = normalized_title.clone();
        move |db| db::threads::update_thread_title(db, &thread_id, &normalized_title)
    })
    .await?;

    let mut metadata = thread.engine_metadata.unwrap_or_else(|| json!({}));
    if !metadata.is_object() {
        metadata = json!({});
    }

    if let Some(object) = metadata.as_object_mut() {
        object.insert("manualTitle".to_string(), json!(true));
        object.insert(
            "manualTitleUpdatedAt".to_string(),
            json!(Utc::now().to_rfc3339()),
        );
    }

    run_db(db.clone(), {
        let thread_id = thread_id.clone();
        let metadata = metadata.clone();
        move |db| db::threads::update_engine_metadata(db, &thread_id, &metadata)
    })
    .await?;

    run_db(db, {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found after rename: {thread_id}"))
}

#[tauri::command]
pub async fn delete_thread(state: State<'_, AppState>, thread_id: String) -> Result<(), String> {
    state.turns.cancel(&thread_id).await;

    let db = state.db.clone();
    if let Some(thread) = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    {
        if let Err(error) = state.engines.interrupt(&thread).await {
            log::warn!("failed to interrupt thread before deletion: {error}");
        }
    } else {
        state.turns.finish(&thread_id).await;
        return Err(format!("thread not found: {thread_id}"));
    }

    run_db(db, {
        let thread_id = thread_id.clone();
        move |db| db::threads::delete_thread(db, &thread_id)
    })
    .await?;
    state.turns.finish(&thread_id).await;
    Ok(())
}

#[tauri::command]
pub async fn archive_thread(state: State<'_, AppState>, thread_id: String) -> Result<(), String> {
    state.turns.cancel(&thread_id).await;

    let db = state.db.clone();
    let result = async {
        let thread = run_db(db.clone(), {
            let thread_id = thread_id.clone();
            move |db| db::threads::get_thread(db, &thread_id)
        })
        .await?
        .ok_or_else(|| format!("thread not found: {thread_id}"))?;

        if let Err(error) = state.engines.interrupt(&thread).await {
            log::warn!("failed to interrupt thread before archive: {error}");
        }

        state
            .engines
            .archive_thread(&thread)
            .await
            .map_err(err_to_string)?;

        run_db(db, {
            let thread_id = thread_id.clone();
            move |db| db::threads::archive_thread(db, &thread_id)
        })
        .await?;

        Ok(())
    }
    .await;

    state.turns.finish(&thread_id).await;
    result
}

#[tauri::command]
pub async fn restore_thread(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<ThreadDto, String> {
    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    state
        .engines
        .unarchive_thread(&thread)
        .await
        .map_err(err_to_string)?;

    let restored = run_db(db, move |db| db::threads::restore_thread(db, &thread_id)).await?;

    Ok(restored)
}

#[tauri::command]
pub async fn sync_thread_from_engine(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<ThreadDto, String> {
    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    if thread.engine_id != "codex" {
        return Ok(thread);
    }

    let Some(snapshot) = state
        .engines
        .read_thread_sync_snapshot(&thread)
        .await
        .map_err(err_to_string)?
    else {
        return Ok(thread);
    };

    let has_local_turn = state.turns.get(&thread_id).await.is_some();
    let metadata = merge_codex_runtime_metadata(
        thread.engine_metadata.clone(),
        snapshot.raw_status.as_deref(),
        &snapshot.active_flags,
        snapshot.preview.as_deref(),
        false,
        None,
    );
    let next_status = map_codex_thread_status_to_local(
        snapshot.raw_status.as_deref(),
        &snapshot.active_flags,
        has_local_turn,
    );

    run_db(db, {
        let thread_id = thread_id.clone();
        let title = snapshot.title.clone();
        let metadata = metadata.clone();
        let next_status = next_status.clone();
        move |db| {
            db::threads::update_thread_runtime_snapshot(
                db,
                &thread_id,
                title.as_deref(),
                next_status,
                Some(&metadata),
            )
        }
    })
    .await
}

#[tauri::command]
pub async fn set_thread_execution_policy(
    state: State<'_, AppState>,
    thread_id: String,
    update_approval_policy: bool,
    approval_policy: Option<String>,
    update_sandbox_mode: bool,
    sandbox_mode: Option<String>,
    update_allow_network: bool,
    allow_network: Option<bool>,
) -> Result<ThreadDto, String> {
    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    let normalized_approval_policy = if update_approval_policy {
        normalize_thread_approval_policy_for_engine(thread.engine_id.as_str(), approval_policy)?
    } else {
        None
    };
    let normalized_sandbox_mode = if update_sandbox_mode {
        if thread.engine_id != "codex" {
            return Err(
                "sandbox mode overrides are currently only supported for Codex threads".to_string(),
            );
        }
        normalize_thread_sandbox_mode(sandbox_mode)?
    } else {
        None
    };
    let external_sandbox_active = state.engines.codex_uses_external_sandbox().await;

    if external_sandbox_active
        && matches!(
            normalized_sandbox_mode.as_deref(),
            Some("read-only" | "workspace-write")
        )
    {
        return Err(
            "Codex read-only and workspace-write sandbox overrides are unavailable while Panes is using external sandbox mode."
                .to_string(),
        );
    }

    let mut metadata = thread.engine_metadata.unwrap_or_else(|| json!({}));
    if !metadata.is_object() {
        metadata = json!({});
    }

    if let Some(object) = metadata.as_object_mut() {
        if update_approval_policy {
            let approval_policy_key = approval_policy_metadata_key(thread.engine_id.as_str());
            match normalized_approval_policy {
                Some(value) => {
                    object.insert(approval_policy_key.to_string(), json!(value));
                }
                None => {
                    object.remove(approval_policy_key);
                }
            }
        }

        if update_sandbox_mode {
            match normalized_sandbox_mode {
                Some(value) => {
                    object.insert("sandboxMode".to_string(), json!(value));
                }
                None => {
                    object.remove("sandboxMode");
                }
            }
        }

        if update_allow_network {
            match allow_network {
                Some(value) => {
                    object.insert("sandboxAllowNetwork".to_string(), json!(value));
                }
                None => {
                    object.remove("sandboxAllowNetwork");
                }
            }
        }
    }

    run_db(db.clone(), {
        let thread_id = thread_id.clone();
        let metadata = metadata.clone();
        move |db| db::threads::update_engine_metadata(db, &thread_id, &metadata)
    })
    .await?;

    run_db(db, {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found after execution policy update: {thread_id}"))
}

async fn validate_reasoning_effort(
    state: &AppState,
    engine_id: &str,
    model_id: &str,
    requested_effort: &str,
) -> Result<String, String> {
    const KNOWN_REASONING_EFFORTS: &[&str] = &["none", "minimal", "low", "medium", "high", "xhigh"];
    if !KNOWN_REASONING_EFFORTS.contains(&requested_effort) {
        return Err(format!(
            "invalid reasoning effort `{requested_effort}`. expected one of: {}",
            KNOWN_REASONING_EFFORTS.join(", ")
        ));
    }

    if let Ok(engines) = state.engines.list_engines().await {
        if let Some(engine) = engines.iter().find(|engine| engine.id == engine_id) {
            if let Some(model) = engine.models.iter().find(|model| model.id == model_id) {
                if let Some(option) = model
                    .supported_reasoning_efforts
                    .iter()
                    .find(|option| option.reasoning_effort == requested_effort)
                {
                    return Ok(option.reasoning_effort.clone());
                }

                let supported = model
                    .supported_reasoning_efforts
                    .iter()
                    .map(|option| option.reasoning_effort.clone())
                    .collect::<Vec<_>>()
                    .join(", ");

                return Err(format!(
                    "reasoning effort `{requested_effort}` is not supported by model `{}`. supported values: {}",
                    model.id, supported
                ));
            }
        }
    }

    Ok(requested_effort.to_string())
}

async fn validate_model_for_thread_engine(
    state: &AppState,
    thread: &ThreadDto,
    requested_model_id: &str,
) -> Result<String, String> {
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

fn merge_codex_runtime_metadata(
    existing: Option<serde_json::Value>,
    raw_status: Option<&str>,
    active_flags: &[String],
    preview: Option<&str>,
    sync_required: bool,
    sync_reason: Option<&str>,
) -> serde_json::Value {
    let mut metadata = existing.unwrap_or_else(|| json!({}));
    if !metadata.is_object() {
        metadata = json!({});
    }

    if let Some(object) = metadata.as_object_mut() {
        match raw_status.map(str::trim).filter(|value| !value.is_empty()) {
            Some(status) => {
                object.insert("codexThreadStatus".to_string(), json!(status));
            }
            None => {
                object.remove("codexThreadStatus");
            }
        }

        if active_flags.is_empty() {
            object.remove("codexThreadActiveFlags");
        } else {
            object.insert("codexThreadActiveFlags".to_string(), json!(active_flags));
        }

        match preview.map(str::trim).filter(|value| !value.is_empty()) {
            Some(preview) => {
                object.insert("codexPreview".to_string(), json!(preview));
            }
            None => {
                object.remove("codexPreview");
            }
        }

        object.insert("codexSyncRequired".to_string(), json!(sync_required));
        if sync_required {
            object.insert(
                "codexSyncUpdatedAt".to_string(),
                json!(Utc::now().to_rfc3339()),
            );
            if let Some(reason) = sync_reason.map(str::trim).filter(|value| !value.is_empty()) {
                object.insert("codexSyncReason".to_string(), json!(reason));
            }
        } else {
            object.insert(
                "codexSyncUpdatedAt".to_string(),
                json!(Utc::now().to_rfc3339()),
            );
            object.insert("codexSyncReason".to_string(), serde_json::Value::Null);
        }
    }

    metadata
}

fn map_codex_thread_status_to_local(
    raw_status: Option<&str>,
    active_flags: &[String],
    has_local_turn: bool,
) -> Option<ThreadStatusDto> {
    if has_local_turn {
        return None;
    }

    match raw_status.map(str::trim).filter(|value| !value.is_empty()) {
        Some("systemError") => Some(ThreadStatusDto::Error),
        Some("idle") | Some("notLoaded") => Some(ThreadStatusDto::Idle),
        Some("active") => {
            if active_flags
                .iter()
                .any(|flag| matches!(flag.as_str(), "waitingOnApproval" | "waitingOnUserInput"))
            {
                Some(ThreadStatusDto::AwaitingApproval)
            } else {
                Some(ThreadStatusDto::Streaming)
            }
        }
        _ => None,
    }
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn approval_policy_metadata_key(engine_id: &str) -> &'static str {
    match engine_id {
        "claude" => "claudePermissionMode",
        _ => "sandboxApprovalPolicy",
    }
}

fn normalize_thread_approval_policy_for_engine(
    engine_id: &str,
    value: Option<String>,
) -> Result<Option<String>, String> {
    let normalized = value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);

    let Some(normalized) = normalized else {
        return Ok(None);
    };

    match engine_id {
        "claude" => match normalized.as_str() {
            "restricted" | "standard" | "trusted" => Ok(Some(normalized)),
            _ => Err(format!(
                "invalid Claude permission mode `{normalized}`. expected one of: restricted, standard, trusted"
            )),
        },
        _ => match normalized.as_str() {
            "untrusted" | "on-failure" | "on-request" | "never" => Ok(Some(normalized)),
            _ => Err(format!(
                "invalid approval policy `{normalized}`. expected one of: untrusted, on-failure, on-request, never"
            )),
        },
    }
}

fn normalize_thread_sandbox_mode(value: Option<String>) -> Result<Option<String>, String> {
    let normalized = value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase());

    let Some(normalized) = normalized else {
        return Ok(None);
    };

    let canonical = match normalized.as_str() {
        "readonly" | "read-only" | "read_only" => "read-only",
        "workspacewrite" | "workspace-write" | "workspace_write" => "workspace-write",
        "dangerfullaccess" | "danger-full-access" | "danger_full_access" => {
            "danger-full-access"
        }
        _ => {
            return Err(format!(
                "invalid sandbox mode `{normalized}`. expected one of: read-only, workspace-write, danger-full-access"
            ))
        }
    };

    Ok(Some(canonical.to_string()))
}

#[cfg(test)]
fn thread_allow_network(metadata: Option<&serde_json::Value>) -> Option<bool> {
    metadata
        .and_then(serde_json::Value::as_object)
        .and_then(|value| value.get("sandboxAllowNetwork"))
        .and_then(serde_json::Value::as_bool)
}

fn normalize_thread_title(raw: &str) -> Result<String, String> {
    let compact = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = compact.trim();
    if trimmed.is_empty() {
        return Err("thread title cannot be empty".to_string());
    }

    let title = if trimmed.chars().count() > MAX_THREAD_TITLE_CHARS {
        trimmed
            .chars()
            .take(MAX_THREAD_TITLE_CHARS)
            .collect::<String>()
    } else {
        trimmed.to_string()
    };

    Ok(title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_allow_network_reads_explicit_override_in_full_access_mode() {
        let metadata = json!({
            "sandboxMode": "danger-full-access",
            "sandboxAllowNetwork": false,
        });

        assert_eq!(thread_allow_network(Some(&metadata)), Some(false));
    }

    #[test]
    fn normalize_thread_sandbox_mode_accepts_aliases() {
        assert_eq!(
            normalize_thread_sandbox_mode(Some("danger_full_access".to_string())).unwrap(),
            Some("danger-full-access".to_string())
        );
        assert_eq!(
            normalize_thread_sandbox_mode(Some("read_only".to_string())).unwrap(),
            Some("read-only".to_string())
        );
    }

    #[test]
    fn normalize_thread_approval_policy_accepts_claude_modes() {
        assert_eq!(
            normalize_thread_approval_policy_for_engine("claude", Some("trusted".to_string()))
                .unwrap(),
            Some("trusted".to_string())
        );
        assert_eq!(
            normalize_thread_approval_policy_for_engine("claude", Some("STANDARD".to_string()))
                .unwrap(),
            Some("standard".to_string())
        );
    }

    #[test]
    fn normalize_thread_approval_policy_rejects_codex_values_for_claude() {
        assert!(normalize_thread_approval_policy_for_engine(
            "claude",
            Some("on-request".to_string())
        )
        .is_err());
    }

    #[test]
    fn merge_codex_runtime_metadata_sets_runtime_fields() {
        let metadata = merge_codex_runtime_metadata(
            Some(json!({
                "existing": true,
                "codexSyncRequired": true,
                "codexSyncReason": "stale",
            })),
            Some("active"),
            &["waitingOnApproval".to_string()],
            Some("Preview"),
            false,
            None,
        );

        assert_eq!(metadata.get("existing"), Some(&json!(true)));
        assert_eq!(metadata.get("codexThreadStatus"), Some(&json!("active")));
        assert_eq!(
            metadata.get("codexThreadActiveFlags"),
            Some(&json!(["waitingOnApproval"]))
        );
        assert_eq!(metadata.get("codexPreview"), Some(&json!("Preview")));
        assert_eq!(metadata.get("codexSyncRequired"), Some(&json!(false)));
        assert_eq!(
            metadata.get("codexSyncReason"),
            Some(&serde_json::Value::Null)
        );
    }

    #[test]
    fn map_codex_thread_status_to_local_honors_waiting_flags() {
        assert_eq!(
            map_codex_thread_status_to_local(
                Some("active"),
                &["waitingOnApproval".to_string()],
                false,
            ),
            Some(ThreadStatusDto::AwaitingApproval)
        );
        assert_eq!(
            map_codex_thread_status_to_local(Some("systemError"), &[], false),
            Some(ThreadStatusDto::Error)
        );
        assert_eq!(
            map_codex_thread_status_to_local(Some("active"), &[], true),
            None
        );
    }
}
