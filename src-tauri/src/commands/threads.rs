use chrono::Utc;
use serde_json::json;
use tauri::State;

use crate::{db, models::ThreadDto, state::AppState};

const MAX_THREAD_TITLE_CHARS: usize = 120;

#[tauri::command]
pub async fn list_threads(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<ThreadDto>, String> {
    db::threads::list_threads_for_workspace(&state.db, &workspace_id).map_err(err_to_string)
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
    db::threads::create_thread(
        &state.db,
        &workspace_id,
        repo_id.as_deref(),
        &engine_id,
        &model_id,
        &title,
    )
    .map_err(err_to_string)
}

#[tauri::command]
pub async fn confirm_workspace_thread(
    state: State<'_, AppState>,
    thread_id: String,
    writable_roots: Vec<String>,
) -> Result<(), String> {
    let thread = db::threads::get_thread(&state.db, &thread_id)
        .map_err(err_to_string)?
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

    db::threads::update_engine_metadata(&state.db, &thread_id, &metadata).map_err(err_to_string)
}

#[tauri::command]
pub async fn set_thread_reasoning_effort(
    state: State<'_, AppState>,
    thread_id: String,
    reasoning_effort: Option<String>,
) -> Result<(), String> {
    let thread = db::threads::get_thread(&state.db, &thread_id)
        .map_err(err_to_string)?
        .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    let normalized_effort = reasoning_effort
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);

    let validated_effort = if let Some(value) = normalized_effort.as_deref() {
        Some(validate_reasoning_effort(state.inner(), &thread, value).await?)
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

    db::threads::update_engine_metadata(&state.db, &thread_id, &metadata).map_err(err_to_string)
}

#[tauri::command]
pub async fn rename_thread(
    state: State<'_, AppState>,
    thread_id: String,
    title: String,
) -> Result<ThreadDto, String> {
    let thread = db::threads::get_thread(&state.db, &thread_id)
        .map_err(err_to_string)?
        .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    let normalized_title = normalize_thread_title(&title)?;

    db::threads::update_thread_title(&state.db, &thread_id, &normalized_title)
        .map_err(err_to_string)?;

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

    db::threads::update_engine_metadata(&state.db, &thread_id, &metadata).map_err(err_to_string)?;

    db::threads::get_thread(&state.db, &thread_id)
        .map_err(err_to_string)?
        .ok_or_else(|| format!("thread not found after rename: {thread_id}"))
}

#[tauri::command]
pub async fn delete_thread(state: State<'_, AppState>, thread_id: String) -> Result<(), String> {
    state.turns.cancel(&thread_id).await;

    if let Some(thread) = db::threads::get_thread(&state.db, &thread_id).map_err(err_to_string)? {
        if let Err(error) = state.engines.interrupt(&thread).await {
            log::warn!("failed to interrupt thread before deletion: {error}");
        }
    } else {
        state.turns.finish(&thread_id).await;
        return Err(format!("thread not found: {thread_id}"));
    }

    db::threads::delete_thread(&state.db, &thread_id).map_err(err_to_string)?;
    state.turns.finish(&thread_id).await;
    Ok(())
}

async fn validate_reasoning_effort(
    state: &AppState,
    thread: &ThreadDto,
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
        if let Some(engine) = engines.iter().find(|engine| engine.id == thread.engine_id) {
            if let Some(model) = engine
                .models
                .iter()
                .find(|model| model.id == thread.model_id)
            {
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

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
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
