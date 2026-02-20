use chrono::Utc;
use serde_json::json;
use tauri::State;

use crate::{db, models::ThreadDto, state::AppState};

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
    if let Some(thread) = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    {
        if let Err(error) = state.engines.interrupt(&thread).await {
            log::warn!("failed to interrupt thread before archive: {error}");
        }
    } else {
        state.turns.finish(&thread_id).await;
        return Err(format!("thread not found: {thread_id}"));
    }

    run_db(db, {
        let thread_id = thread_id.clone();
        move |db| db::threads::archive_thread(db, &thread_id)
    })
    .await?;
    state.turns.finish(&thread_id).await;
    Ok(())
}

#[tauri::command]
pub async fn restore_thread(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<ThreadDto, String> {
    run_db(state.db.clone(), move |db| {
        db::threads::restore_thread(db, &thread_id)
    })
    .await
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
