use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use tauri::State;

use crate::{
    db,
    engines::validate_engine_sandbox_mode,
    engines::CodexRemoteThreadSummary,
    engines::OpenCodeRemoteSessionSummary,
    engines::SandboxPolicy,
    models::{
        CodexRemoteThreadDto, CodexRemoteThreadPageDto, OpenCodeRemoteSessionDto,
        OpenCodeRemoteSessionPageDto, RepoDto, ThreadDto, ThreadStatusDto, TrustLevelDto,
    },
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
pub async fn list_codex_remote_threads(
    state: State<'_, AppState>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    search_term: Option<String>,
    archived: Option<bool>,
) -> Result<CodexRemoteThreadPageDto, String> {
    let db = state.db.clone();
    let (workspace_root, repos) = run_db(db.clone(), {
        let workspace_id = workspace_id.clone();
        move |db| {
            let workspace = db::workspaces::find_workspace_by_id(db, &workspace_id)?
                .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;
            let repos = db::repos::get_repos(db, &workspace_id)?;
            Ok((workspace.root_path, repos))
        }
    })
    .await?;

    let allowed_roots = collect_remote_thread_roots(&workspace_root, &repos);
    let normalized_search_term = normalize_remote_thread_search_term(search_term);
    let remote_threads = state
        .engines
        .list_codex_remote_threads(normalized_search_term.as_deref(), archived)
        .await
        .map_err(err_to_string)?;
    let matching_threads = remote_threads
        .into_iter()
        .filter(|thread| allowed_roots.contains(thread.cwd.as_str()))
        .collect::<Vec<_>>();

    let offset = parse_codex_remote_thread_cursor(cursor.as_deref())?;
    let page_size = normalize_codex_remote_thread_limit(limit);
    let page_end = offset.saturating_add(page_size).min(matching_threads.len());
    let page_threads = if offset >= matching_threads.len() {
        Vec::new()
    } else {
        matching_threads[offset..page_end].to_vec()
    };
    let next_cursor = (page_end < matching_threads.len()).then(|| page_end.to_string());

    run_db(db, move |db| {
        let threads = page_threads
            .into_iter()
            .map(|thread| {
                let local_thread_id = db::threads::find_thread_by_engine_thread_id(
                    db,
                    "codex",
                    &thread.engine_thread_id,
                )?
                .filter(|local| local.workspace_id == workspace_id)
                .map(|local| local.id);
                Ok(map_codex_remote_thread_dto(thread, local_thread_id))
            })
            .collect::<anyhow::Result<Vec<_>>>()?;

        Ok(CodexRemoteThreadPageDto {
            threads,
            next_cursor,
        })
    })
    .await
}

#[tauri::command]
pub async fn attach_codex_remote_thread(
    state: State<'_, AppState>,
    workspace_id: String,
    engine_thread_id: String,
    model_id: String,
) -> Result<ThreadDto, String> {
    let normalized_model_id =
        validate_model_for_engine(state.inner(), "codex", model_id.trim()).await?;
    let db = state.db.clone();
    let (workspace_root, repos, existing_local_thread) = run_db(db.clone(), {
        let workspace_id = workspace_id.clone();
        let engine_thread_id = engine_thread_id.clone();
        move |db| {
            let workspace = db::workspaces::find_workspace_by_id(db, &workspace_id)?
                .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;
            let repos = db::repos::get_repos(db, &workspace_id)?;
            let existing =
                db::threads::find_thread_by_engine_thread_id(db, "codex", &engine_thread_id)?
                    .filter(|thread| thread.workspace_id == workspace_id);
            Ok((workspace.root_path, repos, existing))
        }
    })
    .await?;

    let mut remote_thread = state
        .engines
        .read_codex_remote_thread(&engine_thread_id)
        .await
        .map_err(err_to_string)?;
    if remote_thread.archived {
        state
            .engines
            .unarchive_codex_remote_thread(&engine_thread_id)
            .await
            .map_err(err_to_string)?;
        remote_thread.archived = false;
    }
    let repo_id = resolve_codex_remote_thread_repo_id(&workspace_root, &repos, &remote_thread.cwd)?;
    let title = build_codex_remote_thread_title(&remote_thread);
    let metadata = build_codex_remote_thread_metadata(&remote_thread, &normalized_model_id);

    if let Some(existing) = existing_local_thread {
        return run_db(db, move |db| {
            let thread = match db::threads::restore_thread(db, &existing.id) {
                Ok(restored) => restored,
                Err(_) => existing,
            };
            db::threads::update_thread_runtime_snapshot(
                db,
                &thread.id,
                Some(&title),
                map_codex_thread_status_to_local(
                    Some(remote_thread.status_type.as_str()),
                    &remote_thread.active_flags,
                    false,
                ),
                Some(&metadata),
            )
        })
        .await;
    }

    run_db(db, move |db| {
        let created = db::threads::create_thread(
            db,
            &workspace_id,
            repo_id.as_deref(),
            "codex",
            &normalized_model_id,
            &title,
        )?;
        db::threads::set_engine_thread_id(db, &created.id, &engine_thread_id)?;
        db::threads::update_thread_runtime_snapshot(
            db,
            &created.id,
            Some(&title),
            map_codex_thread_status_to_local(
                Some(remote_thread.status_type.as_str()),
                &remote_thread.active_flags,
                false,
            ),
            Some(&metadata),
        )
    })
    .await
}

#[tauri::command]
pub async fn list_opencode_remote_sessions(
    state: State<'_, AppState>,
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    search_term: Option<String>,
    archived: Option<bool>,
) -> Result<OpenCodeRemoteSessionPageDto, String> {
    let db = state.db.clone();
    let (workspace_root, repos) = run_db(db.clone(), {
        let workspace_id = workspace_id.clone();
        move |db| {
            let workspace = db::workspaces::find_workspace_by_id(db, &workspace_id)?
                .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;
            let repos = db::repos::get_repos(db, &workspace_id)?;
            Ok((workspace.root_path, repos))
        }
    })
    .await?;

    let allowed_roots = collect_remote_thread_roots(&workspace_root, &repos);
    let normalized_search_term = normalize_remote_thread_search_term(search_term);
    let mut remote_sessions = Vec::new();
    for cwd in allowed_roots.iter() {
        let sessions = state
            .engines
            .list_opencode_remote_sessions(cwd, normalized_search_term.as_deref(), archived)
            .await
            .map_err(err_to_string)?;
        remote_sessions.extend(sessions);
    }
    remote_sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let mut seen_session_ids = std::collections::HashSet::new();
    remote_sessions.retain(|session| seen_session_ids.insert(session.engine_thread_id.clone()));

    let offset = parse_codex_remote_thread_cursor(cursor.as_deref())?;
    let page_size = normalize_codex_remote_thread_limit(limit);
    let page_end = offset.saturating_add(page_size).min(remote_sessions.len());
    let page_sessions = if offset >= remote_sessions.len() {
        Vec::new()
    } else {
        remote_sessions[offset..page_end].to_vec()
    };
    let next_cursor = (page_end < remote_sessions.len()).then(|| page_end.to_string());

    run_db(db, move |db| {
        let sessions = page_sessions
            .into_iter()
            .map(|session| {
                let local_thread_id = db::threads::find_thread_by_engine_thread_id(
                    db,
                    "opencode",
                    &session.engine_thread_id,
                )?
                .filter(|local| local.workspace_id == workspace_id)
                .map(|local| local.id);
                Ok(map_opencode_remote_session_dto(session, local_thread_id))
            })
            .collect::<anyhow::Result<Vec<_>>>()?;

        Ok(OpenCodeRemoteSessionPageDto {
            sessions,
            next_cursor,
        })
    })
    .await
}

#[tauri::command]
pub async fn attach_opencode_remote_session(
    state: State<'_, AppState>,
    workspace_id: String,
    engine_thread_id: String,
    cwd: String,
    model_id: String,
) -> Result<ThreadDto, String> {
    let normalized_model_id =
        validate_model_for_engine(state.inner(), "opencode", model_id.trim()).await?;
    let db = state.db.clone();
    let (workspace_root, repos, existing_local_thread) = run_db(db.clone(), {
        let workspace_id = workspace_id.clone();
        let engine_thread_id = engine_thread_id.clone();
        move |db| {
            let workspace = db::workspaces::find_workspace_by_id(db, &workspace_id)?
                .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))?;
            let repos = db::repos::get_repos(db, &workspace_id)?;
            let existing =
                db::threads::find_thread_by_engine_thread_id(db, "opencode", &engine_thread_id)?
                    .filter(|thread| thread.workspace_id == workspace_id);
            Ok((workspace.root_path, repos, existing))
        }
    })
    .await?;

    let allowed_roots = collect_remote_thread_roots(&workspace_root, &repos);
    if !allowed_roots.contains(cwd.as_str()) {
        return Err(format!(
            "OpenCode session cwd is outside this workspace: {cwd}"
        ));
    }

    let mut remote_session = state
        .engines
        .read_opencode_remote_session(&cwd, &engine_thread_id)
        .await
        .map_err(err_to_string)?;
    if remote_session.archived {
        state
            .engines
            .unarchive_opencode_remote_session(&cwd, &engine_thread_id)
            .await
            .map_err(err_to_string)?;
        remote_session.archived = false;
    }
    let repo_id =
        resolve_codex_remote_thread_repo_id(&workspace_root, &repos, &remote_session.cwd)?;
    let title = build_opencode_remote_session_title(&remote_session);

    if let Some(existing) = existing_local_thread {
        let metadata = build_opencode_remote_session_metadata(
            existing.engine_metadata.as_ref(),
            &remote_session,
            &normalized_model_id,
        );
        return run_db(db, move |db| {
            let thread = match db::threads::restore_thread(db, &existing.id) {
                Ok(restored) => restored,
                Err(_) => existing,
            };
            db::threads::update_thread_runtime_snapshot(
                db,
                &thread.id,
                Some(&title),
                Some(ThreadStatusDto::Idle),
                Some(&metadata),
            )
        })
        .await;
    }

    let metadata =
        build_opencode_remote_session_metadata(None, &remote_session, &normalized_model_id);
    run_db(db, move |db| {
        let created = db::threads::create_thread(
            db,
            &workspace_id,
            repo_id.as_deref(),
            "opencode",
            &normalized_model_id,
            &title,
        )?;
        db::threads::set_engine_thread_id(db, &created.id, &engine_thread_id)?;
        db::threads::update_thread_runtime_snapshot(
            db,
            &created.id,
            Some(&title),
            Some(ThreadStatusDto::Idle),
            Some(&metadata),
        )
    })
    .await
}

async fn validate_model_for_engine(
    state: &AppState,
    engine_id: &str,
    requested_model_id: &str,
) -> Result<String, String> {
    let normalized_model_id = requested_model_id.trim();
    if normalized_model_id.is_empty() {
        return Err("model id cannot be empty".to_string());
    }

    if let Ok(engines) = state.engines.list_engines().await {
        if let Some(engine) = engines.iter().find(|engine| engine.id == engine_id) {
            if engine
                .models
                .iter()
                .any(|model| model.id == normalized_model_id)
            {
                return Ok(normalized_model_id.to_string());
            }

            let available = engine
                .models
                .iter()
                .map(|model| model.id.clone())
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!(
                "model `{normalized_model_id}` is not supported by engine `{engine_id}`. available models: {available}"
            ));
        }
    }

    Ok(normalized_model_id.to_string())
}

async fn resolve_thread_cwd(state: &AppState, thread: &ThreadDto) -> Result<String, String> {
    let workspace_id = thread.workspace_id.clone();
    let repo_id = thread.repo_id.clone();
    let thread_id = thread.id.clone();

    run_db(state.db.clone(), move |db| {
        let workspace = db::workspaces::find_workspace_by_id(db, &workspace_id)?
            .ok_or_else(|| anyhow::anyhow!("workspace not found for thread {thread_id}"))?;
        if let Some(repo_id) = repo_id.as_deref() {
            let repo = db::repos::find_repo_by_id(db, repo_id)?
                .ok_or_else(|| anyhow::anyhow!("repo not found for thread {thread_id}"))?;
            return Ok(repo.path);
        }

        Ok(workspace.root_path)
    })
    .await
}

fn collect_remote_thread_roots(
    workspace_root: &str,
    repos: &[RepoDto],
) -> std::collections::HashSet<String> {
    let mut roots = std::collections::HashSet::with_capacity(repos.len() + 1);
    roots.insert(workspace_root.to_string());
    for repo in repos {
        roots.insert(repo.path.clone());
    }
    roots
}

fn normalize_remote_thread_search_term(search_term: Option<String>) -> Option<String> {
    search_term
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_codex_remote_thread_cursor(cursor: Option<&str>) -> Result<usize, String> {
    let Some(cursor) = cursor.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(0);
    };

    cursor.parse::<usize>().map_err(|_| {
        format!("invalid Codex remote thread cursor `{cursor}`. expected a non-negative offset")
    })
}

fn normalize_codex_remote_thread_limit(limit: Option<u32>) -> usize {
    limit.unwrap_or(20).clamp(1, 100) as usize
}

fn map_codex_remote_thread_dto(
    thread: CodexRemoteThreadSummary,
    local_thread_id: Option<String>,
) -> CodexRemoteThreadDto {
    CodexRemoteThreadDto {
        engine_thread_id: thread.engine_thread_id,
        title: thread.title,
        preview: thread.preview,
        cwd: thread.cwd,
        created_at: codex_remote_thread_timestamp_to_rfc3339(thread.created_at),
        updated_at: codex_remote_thread_timestamp_to_rfc3339(thread.updated_at),
        model_provider: thread.model_provider,
        source_kind: thread.source_kind,
        status_type: thread.status_type,
        active_flags: thread.active_flags,
        archived: thread.archived,
        local_thread_id,
    }
}

fn codex_remote_thread_timestamp_to_rfc3339(timestamp: i64) -> String {
    let (seconds, nanos) = if timestamp > 10_000_000_000 {
        (timestamp / 1000, ((timestamp % 1000) as u32) * 1_000_000)
    } else {
        (timestamp, 0)
    };

    DateTime::<Utc>::from_timestamp(seconds, nanos)
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

fn resolve_codex_remote_thread_repo_id(
    workspace_root: &str,
    repos: &[RepoDto],
    cwd: &str,
) -> Result<Option<String>, String> {
    if cwd == workspace_root {
        return Ok(None);
    }

    if let Some(repo) = repos.iter().find(|repo| repo.path == cwd) {
        return Ok(Some(repo.id.clone()));
    }

    Err(format!(
        "Codex thread cwd `{cwd}` is outside the active workspace and cannot be attached"
    ))
}

fn build_codex_remote_thread_title(thread: &CodexRemoteThreadSummary) -> String {
    if let Some(title) = thread
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return normalize_thread_title(title).unwrap_or_else(|_| {
            format!(
                "Codex thread {}",
                short_thread_label(&thread.engine_thread_id)
            )
        });
    }

    if let Some(preview) = thread
        .preview
        .trim()
        .split('\n')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return normalize_thread_title(preview).unwrap_or_else(|_| {
            format!(
                "Codex thread {}",
                short_thread_label(&thread.engine_thread_id)
            )
        });
    }

    format!(
        "Codex thread {}",
        short_thread_label(&thread.engine_thread_id)
    )
}

fn short_thread_label(engine_thread_id: &str) -> String {
    engine_thread_id.chars().take(8).collect()
}

fn build_codex_remote_thread_metadata(thread: &CodexRemoteThreadSummary, model_id: &str) -> Value {
    let mut metadata = merge_codex_runtime_metadata(
        None,
        Some(thread.status_type.as_str()),
        &thread.active_flags,
        Some(thread.preview.as_str()),
        true,
        Some("remote_thread_attached"),
    );

    if let Some(object) = metadata.as_object_mut() {
        object.insert("lastModelId".to_string(), json!(model_id));
        object.insert("codexTranscriptImported".to_string(), json!(false));
        object.insert(
            "codexModelProvider".to_string(),
            json!(thread.model_provider),
        );
        object.insert("codexSourceKind".to_string(), json!(thread.source_kind));
        object.insert("codexRemoteArchived".to_string(), json!(thread.archived));
        object.insert("codexRemoteCwd".to_string(), json!(thread.cwd));
        object.insert(
            "codexRemoteCreatedAt".to_string(),
            json!(codex_remote_thread_timestamp_to_rfc3339(thread.created_at)),
        );
        object.insert(
            "codexRemoteUpdatedAt".to_string(),
            json!(codex_remote_thread_timestamp_to_rfc3339(thread.updated_at)),
        );
    }

    metadata
}

fn map_opencode_remote_session_dto(
    session: OpenCodeRemoteSessionSummary,
    local_thread_id: Option<String>,
) -> OpenCodeRemoteSessionDto {
    OpenCodeRemoteSessionDto {
        engine_thread_id: session.engine_thread_id,
        title: session.title,
        cwd: session.cwd,
        created_at: codex_remote_thread_timestamp_to_rfc3339(session.created_at),
        updated_at: codex_remote_thread_timestamp_to_rfc3339(session.updated_at),
        archived: session.archived,
        local_thread_id,
    }
}

fn build_opencode_remote_session_title(session: &OpenCodeRemoteSessionSummary) -> String {
    if let Some(title) = session
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return normalize_thread_title(title).unwrap_or_else(|_| {
            format!(
                "OpenCode session {}",
                short_thread_label(&session.engine_thread_id)
            )
        });
    }

    format!(
        "OpenCode session {}",
        short_thread_label(&session.engine_thread_id)
    )
}

fn build_opencode_remote_session_metadata(
    existing: Option<&Value>,
    session: &OpenCodeRemoteSessionSummary,
    model_id: &str,
) -> Value {
    let mut metadata = existing.cloned().unwrap_or_else(|| json!({}));
    if !metadata.is_object() {
        metadata = json!({});
    }

    if let Some(object) = metadata.as_object_mut() {
        object.insert("lastModelId".to_string(), json!(model_id));
        object.insert("opencodeRemoteSessionAttached".to_string(), json!(true));
        object.insert(
            "opencodeRemoteArchived".to_string(),
            json!(session.archived),
        );
        object.insert("opencodeRemoteCwd".to_string(), json!(session.cwd));
        object.insert(
            "opencodeRemoteCreatedAt".to_string(),
            json!(codex_remote_thread_timestamp_to_rfc3339(session.created_at)),
        );
        object.insert(
            "opencodeRemoteUpdatedAt".to_string(),
            json!(codex_remote_thread_timestamp_to_rfc3339(session.updated_at)),
        );
        object.insert("opencodeTranscriptImported".to_string(), json!(false));
    }

    metadata
}

#[tauri::command]
pub async fn create_thread(
    state: State<'_, AppState>,
    workspace_id: String,
    repo_id: Option<String>,
    engine_id: String,
    model_id: String,
    title: String,
    reasoning_effort: Option<String>,
    service_tier: Option<String>,
) -> Result<ThreadDto, String> {
    create_thread_inner(
        state.inner(),
        workspace_id,
        repo_id,
        engine_id,
        model_id,
        title,
        reasoning_effort,
        service_tier,
    )
    .await
}

async fn create_thread_inner(
    state: &AppState,
    workspace_id: String,
    repo_id: Option<String>,
    engine_id: String,
    model_id: String,
    title: String,
    reasoning_effort: Option<String>,
    service_tier: Option<String>,
) -> Result<ThreadDto, String> {
    let effective_model_id = validate_model_for_engine(state, &engine_id, model_id.trim()).await?;
    let normalized_reasoning_effort = reasoning_effort
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let validated_reasoning_effort =
        if let Some(requested_effort) = normalized_reasoning_effort.as_deref() {
            Some(
                validate_reasoning_effort(state, &engine_id, &effective_model_id, requested_effort)
                    .await?,
            )
        } else {
            None
        };
    let normalized_service_tier = if engine_id == "codex" {
        normalize_thread_service_tier(service_tier)?
    } else {
        let candidate = service_tier
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if candidate.is_some() {
            return Err("service tier is only supported for Codex threads".to_string());
        }
        None
    };

    let metadata = if validated_reasoning_effort.is_some() || normalized_service_tier.is_some() {
        let mut object = serde_json::Map::new();
        if let Some(value) = validated_reasoning_effort {
            object.insert("reasoningEffort".to_string(), json!(value));
        }
        if let Some(value) = normalized_service_tier {
            object.insert("serviceTier".to_string(), json!(value));
        }
        Some(Value::Object(object))
    } else {
        None
    };

    run_db(state.db.clone(), move |db| {
        let created = db::threads::create_thread(
            db,
            &workspace_id,
            repo_id.as_deref(),
            &engine_id,
            &effective_model_id,
            &title,
        )?;
        if let Some(metadata) = metadata.as_ref() {
            db::threads::update_engine_metadata(db, &created.id, metadata)?;
        }
        db::threads::get_thread(db, &created.id)?
            .ok_or_else(|| anyhow::anyhow!("thread not found after insert: {}", created.id))
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
    let (thread, workspace_root, repo_paths) = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| {
            let thread = db::threads::get_thread(db, &thread_id)?
                .ok_or_else(|| anyhow::anyhow!("thread not found: {thread_id}"))?;
            let workspace = db::workspaces::list_workspaces(db)?
                .into_iter()
                .find(|item| item.id == thread.workspace_id)
                .ok_or_else(|| anyhow::anyhow!("workspace not found for thread {thread_id}"))?;
            let repo_paths = db::repos::get_repos(db, &thread.workspace_id)?
                .into_iter()
                .map(|repo| repo.path)
                .collect::<Vec<_>>();
            Ok((thread, workspace.root_path, repo_paths))
        }
    })
    .await?;

    if thread.repo_id.is_some() {
        return Err("confirmation only applies to workspace threads".to_string());
    }

    let normalized_writable_roots =
        normalize_workspace_confirmation_roots(&writable_roots, &workspace_root, &repo_paths)?;

    let mut metadata = thread.engine_metadata.unwrap_or_else(|| json!({}));
    if !metadata.is_object() {
        metadata = json!({});
    }

    if let Some(object) = metadata.as_object_mut() {
        object.insert("workspaceWriteOptIn".to_string(), json!(true));
        object.insert(
            "workspaceWritableRoots".to_string(),
            json!(normalized_writable_roots),
        );
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
        if thread.engine_id == "opencode" {
            if let Some(engine_thread_id) = thread.engine_thread_id.as_deref() {
                state
                    .engines
                    .forget_opencode_session(engine_thread_id)
                    .await;
            }
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

        if thread.engine_id == "opencode" {
            if let Some(engine_thread_id) = thread.engine_thread_id.as_deref() {
                let cwd = resolve_thread_cwd(state.inner(), &thread).await?;
                state
                    .engines
                    .archive_opencode_remote_session(&cwd, engine_thread_id)
                    .await
                    .map_err(err_to_string)?;
            }
        } else {
            state
                .engines
                .archive_thread(&thread)
                .await
                .map_err(err_to_string)?;
        }

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

    if thread.engine_id == "opencode" {
        if let Some(engine_thread_id) = thread.engine_thread_id.as_deref() {
            let cwd = resolve_thread_cwd(state.inner(), &thread).await?;
            state
                .engines
                .unarchive_opencode_remote_session(&cwd, engine_thread_id)
                .await
                .map_err(err_to_string)?;
        }
    } else {
        state
            .engines
            .unarchive_thread(&thread)
            .await
            .map_err(err_to_string)?;
    }

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

    if thread.engine_id == "opencode" {
        let Some(engine_thread_id) = thread.engine_thread_id.as_deref() else {
            return Ok(thread);
        };
        let cwd = resolve_thread_cwd(state.inner(), &thread).await?;
        let session = match state
            .engines
            .read_opencode_remote_session(&cwd, engine_thread_id)
            .await
        {
            Ok(session) => session,
            Err(error) => {
                log::debug!("failed to sync OpenCode session {engine_thread_id}: {error}");
                return Ok(thread);
            }
        };
        let title = build_opencode_remote_session_title(&session);
        let metadata = build_opencode_remote_session_metadata(
            thread.engine_metadata.as_ref(),
            &session,
            &thread.model_id,
        );
        return run_db(db, move |db| {
            db::threads::update_thread_runtime_snapshot(
                db,
                &thread_id,
                Some(&title),
                Some(ThreadStatusDto::Idle),
                Some(&metadata),
            )
        })
        .await;
    }

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
pub async fn fork_codex_thread(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<ThreadDto, String> {
    if state.turns.get(&thread_id).await.is_some() {
        return Err("cannot fork a thread while a turn is still active".to_string());
    }

    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    if thread.engine_id != "codex" {
        return Err("native fork is only available for Codex threads".to_string());
    }
    let engine_thread_id = thread
        .engine_thread_id
        .clone()
        .ok_or_else(|| "Codex thread has not been initialized yet".to_string())?;
    let (cwd, model_id, sandbox) = build_codex_branch_context(state.inner(), &thread).await?;

    let forked = state
        .engines
        .fork_codex_thread(&engine_thread_id, &cwd, &model_id, sandbox)
        .await
        .map_err(err_to_string)?;

    create_codex_branch_thread(
        state.inner(),
        &thread,
        &forked.engine_thread_id,
        &forked.model_id,
        forked.title.as_deref(),
        forked.preview.as_deref(),
        forked.raw_status.as_deref(),
        &forked.active_flags,
        None,
    )
    .await
}

#[tauri::command]
pub async fn rollback_codex_thread(
    state: State<'_, AppState>,
    thread_id: String,
    num_turns: u32,
) -> Result<ThreadDto, String> {
    if num_turns == 0 {
        return Err("rollback requires at least one turn".to_string());
    }
    if state.turns.get(&thread_id).await.is_some() {
        return Err("cannot rollback a thread while a turn is still active".to_string());
    }

    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    if thread.engine_id != "codex" {
        return Err("native rollback is only available for Codex threads".to_string());
    }
    let engine_thread_id = thread
        .engine_thread_id
        .clone()
        .ok_or_else(|| "Codex thread has not been initialized yet".to_string())?;
    let (cwd, model_id, sandbox) = build_codex_branch_context(state.inner(), &thread).await?;

    let forked = state
        .engines
        .fork_codex_thread(&engine_thread_id, &cwd, &model_id, sandbox)
        .await
        .map_err(err_to_string)?;
    let rollback_snapshot = match state
        .engines
        .rollback_codex_thread(&forked.engine_thread_id, num_turns)
        .await
    {
        Ok(snapshot) => snapshot,
        Err(rollback_error) => {
            if let Err(cleanup_error) = state
                .engines
                .archive_codex_thread(&forked.engine_thread_id)
                .await
            {
                log::warn!(
                    "failed to clean up forked engine thread {} after rollback failure: {cleanup_error}",
                    forked.engine_thread_id
                );
            }
            return Err(err_to_string(rollback_error));
        }
    };

    create_codex_branch_thread(
        state.inner(),
        &thread,
        &forked.engine_thread_id,
        &forked.model_id,
        rollback_snapshot
            .title
            .as_deref()
            .or(forked.title.as_deref()),
        rollback_snapshot
            .preview
            .as_deref()
            .or(forked.preview.as_deref()),
        rollback_snapshot
            .raw_status
            .as_deref()
            .or(forked.raw_status.as_deref()),
        &rollback_snapshot.active_flags,
        Some(num_turns),
    )
    .await
}

#[tauri::command]
pub async fn compact_codex_thread(
    state: State<'_, AppState>,
    thread_id: String,
) -> Result<ThreadDto, String> {
    if state.turns.get(&thread_id).await.is_some() {
        return Err("cannot compact a thread while a turn is still active".to_string());
    }

    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    if thread.engine_id != "codex" {
        return Err("native compact is only available for Codex threads".to_string());
    }
    let engine_thread_id = thread
        .engine_thread_id
        .clone()
        .ok_or_else(|| "Codex thread has not been initialized yet".to_string())?;

    state
        .engines
        .compact_codex_thread(&engine_thread_id)
        .await
        .map_err(err_to_string)?;

    Ok(thread)
}

#[tauri::command]
pub async fn set_thread_execution_policy(
    state: State<'_, AppState>,
    thread_id: String,
    update_approval_policy: bool,
    approval_policy: Option<Value>,
    update_sandbox_mode: bool,
    sandbox_mode: Option<String>,
    update_allow_network: bool,
    allow_network: Option<bool>,
) -> Result<ThreadDto, String> {
    set_thread_execution_policy_inner(
        state.inner(),
        thread_id,
        update_approval_policy,
        approval_policy,
        update_sandbox_mode,
        sandbox_mode,
        update_allow_network,
        allow_network,
    )
    .await
}

async fn set_thread_execution_policy_inner(
    state: &AppState,
    thread_id: String,
    update_approval_policy: bool,
    approval_policy: Option<Value>,
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
        let normalized = normalize_thread_sandbox_mode(sandbox_mode)?;
        validate_engine_sandbox_mode(thread.engine_id.as_str(), normalized.as_deref())?;
        normalized
    } else {
        None
    };
    let external_sandbox_active = state.engines.codex_uses_external_sandbox().await;

    if external_sandbox_active
        && thread.engine_id == "codex"
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

#[tauri::command]
pub async fn set_thread_codex_config(
    state: State<'_, AppState>,
    thread_id: String,
    update_personality: bool,
    personality: Option<String>,
    update_service_tier: bool,
    service_tier: Option<String>,
    update_output_schema: bool,
    output_schema: Option<Value>,
) -> Result<ThreadDto, String> {
    set_thread_codex_config_inner(
        state.inner(),
        thread_id,
        update_personality,
        personality,
        update_service_tier,
        service_tier,
        update_output_schema,
        output_schema,
    )
    .await
}

async fn set_thread_codex_config_inner(
    state: &AppState,
    thread_id: String,
    update_personality: bool,
    personality: Option<String>,
    update_service_tier: bool,
    service_tier: Option<String>,
    update_output_schema: bool,
    output_schema: Option<Value>,
) -> Result<ThreadDto, String> {
    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    if thread.engine_id != "codex" {
        return Err("Codex thread config is only available for Codex threads".to_string());
    }

    let normalized_personality = if update_personality {
        normalize_thread_personality(personality)?
    } else {
        None
    };
    let normalized_service_tier = if update_service_tier {
        normalize_thread_service_tier(service_tier)?
    } else {
        None
    };
    let normalized_output_schema = if update_output_schema {
        normalize_thread_output_schema(output_schema)?
    } else {
        None
    };

    let mut metadata = thread.engine_metadata.unwrap_or_else(|| json!({}));
    if !metadata.is_object() {
        metadata = json!({});
    }

    if let Some(object) = metadata.as_object_mut() {
        if update_personality {
            match normalized_personality {
                Some(value) => {
                    object.insert("personality".to_string(), json!(value));
                }
                None => {
                    object.remove("personality");
                }
            }
        }

        if update_service_tier {
            match normalized_service_tier {
                Some(value) => {
                    object.insert("serviceTier".to_string(), json!(value));
                }
                None => {
                    object.remove("serviceTier");
                }
            }
        }

        if update_output_schema {
            match normalized_output_schema {
                Some(value) => {
                    object.insert("outputSchema".to_string(), value);
                }
                None => {
                    object.remove("outputSchema");
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
    .ok_or_else(|| format!("thread not found after Codex config update: {thread_id}"))
}

#[tauri::command]
pub async fn set_thread_opencode_config(
    state: State<'_, AppState>,
    thread_id: String,
    update_agent: bool,
    agent: Option<String>,
) -> Result<ThreadDto, String> {
    set_thread_opencode_config_inner(state.inner(), thread_id, update_agent, agent).await
}

async fn set_thread_opencode_config_inner(
    state: &AppState,
    thread_id: String,
    update_agent: bool,
    agent: Option<String>,
) -> Result<ThreadDto, String> {
    let db = state.db.clone();
    let thread = run_db(db.clone(), {
        let thread_id = thread_id.clone();
        move |db| db::threads::get_thread(db, &thread_id)
    })
    .await?
    .ok_or_else(|| format!("thread not found: {thread_id}"))?;

    if thread.engine_id != "opencode" {
        return Err("OpenCode thread config is only available for OpenCode threads".to_string());
    }

    let normalized_agent = if update_agent {
        normalize_thread_opencode_agent(agent)?
    } else {
        None
    };

    let mut metadata = thread.engine_metadata.unwrap_or_else(|| json!({}));
    if !metadata.is_object() {
        metadata = json!({});
    }

    if let Some(object) = metadata.as_object_mut() {
        if update_agent {
            match normalized_agent {
                Some(value) => {
                    object.insert("opencodeAgent".to_string(), json!(value));
                }
                None => {
                    object.remove("opencodeAgent");
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
    .ok_or_else(|| format!("thread not found after OpenCode config update: {thread_id}"))
}

async fn validate_reasoning_effort(
    state: &AppState,
    engine_id: &str,
    model_id: &str,
    requested_effort: &str,
) -> Result<String, String> {
    const KNOWN_REASONING_EFFORTS: &[&str] =
        &["none", "minimal", "low", "medium", "high", "xhigh", "max"];
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

    validate_model_for_engine(state, &thread.engine_id, requested_model_id).await
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

async fn build_codex_branch_context(
    state: &AppState,
    thread: &ThreadDto,
) -> Result<(String, String, SandboxPolicy), String> {
    let db = state.db.clone();
    let (workspace, repos, selected_repo) = run_db(db, {
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
    let trust_level = selected_repo
        .as_ref()
        .map(|repo| repo.trust_level.clone())
        .unwrap_or_else(|| aggregate_workspace_trust_level(&repos));
    let codex_external_sandbox_active = state.engines.codex_uses_external_sandbox().await;

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

    let writable_roots = match selected_repo.as_ref() {
        Some(repo) => vec![repo.path.clone()],
        None => workspace_writable_roots
            .as_ref()
            .map(|resolution| resolution.roots.clone())
            .unwrap_or_else(|| vec![workspace_root.clone()]),
    };
    let allow_network = if sandbox_mode.eq_ignore_ascii_case("danger-full-access") {
        true
    } else {
        thread_allow_network_override(thread.engine_metadata.as_ref())
            .unwrap_or_else(|| allow_network_for_trust_level(&trust_level))
    };
    let approval_policy_override = thread_approval_policy_override_value(
        thread.engine_id.as_str(),
        thread.engine_metadata.as_ref(),
    )?;

    Ok((
        selected_repo
            .as_ref()
            .map(|repo| repo.path.clone())
            .unwrap_or(workspace_root),
        thread_last_model_id(thread.engine_metadata.as_ref())
            .unwrap_or_else(|| thread.model_id.clone()),
        SandboxPolicy {
            writable_roots,
            allow_network,
            approval_policy: Some(approval_policy_override.unwrap_or_else(|| {
                Value::String(
                    approval_policy_for_engine_and_trust_level(
                        thread.engine_id.as_str(),
                        &trust_level,
                    )
                    .to_string(),
                )
            })),
            reasoning_effort: thread_reasoning_effort(thread.engine_metadata.as_ref()),
            sandbox_mode: Some(sandbox_mode),
            service_tier: thread_service_tier(thread.engine_metadata.as_ref()),
            personality: thread_personality(thread.engine_metadata.as_ref()),
            output_schema: thread_output_schema(thread.engine_metadata.as_ref()),
            opencode_agent: thread_opencode_agent(thread.engine_metadata.as_ref()),
        },
    ))
}

async fn create_codex_branch_thread(
    state: &AppState,
    source_thread: &ThreadDto,
    engine_thread_id: &str,
    model_id: &str,
    title: Option<&str>,
    preview: Option<&str>,
    raw_status: Option<&str>,
    active_flags: &[String],
    rollback_turns: Option<u32>,
) -> Result<ThreadDto, String> {
    if !codex_transcript_imported(source_thread.engine_metadata.as_ref()) {
        return Err(
            "native Codex history tools require a locally mirrored transcript. Attached remote threads without imported history cannot be forked or rolled back yet."
                .to_string(),
        );
    }

    let db = state.db.clone();
    run_db(db.clone(), {
        let source_thread = source_thread.clone();
        let engine_thread_id = engine_thread_id.to_string();
        let model_id = model_id.to_string();
        let title = title.map(str::to_string);
        let preview = preview.map(str::to_string);
        let raw_status = raw_status.map(str::to_string);
        let active_flags = active_flags.to_vec();
        move |db| {
            let clone_local_history = should_clone_local_branch_history(&source_thread);
            let created = db::threads::create_thread(
                db,
                &source_thread.workspace_id,
                source_thread.repo_id.as_deref(),
                &source_thread.engine_id,
                &model_id,
                title.as_deref().unwrap_or(&source_thread.title),
            )?;
            db::threads::set_engine_thread_id(db, &created.id, &engine_thread_id)?;
            if clone_local_history {
                db::messages::clone_thread_messages(db, &source_thread.id, &created.id)?;
                if let Some(turns) = rollback_turns {
                    db::messages::drop_last_turns(db, &created.id, turns)?;
                }
            }
            db::threads::refresh_thread_message_stats(db, &created.id)?;

            let metadata = clone_codex_branch_metadata(
                source_thread.engine_metadata.as_ref(),
                &model_id,
                raw_status.as_deref(),
                &active_flags,
                preview.as_deref(),
                !clone_local_history,
                (!clone_local_history).then_some("branch_thread_requires_sync"),
            );
            let next_status =
                map_codex_thread_status_to_local(raw_status.as_deref(), &active_flags, false);
            db::threads::update_thread_runtime_snapshot(
                db,
                &created.id,
                title.as_deref(),
                next_status,
                Some(&metadata),
            )
        }
    })
    .await
}

fn is_codex_thread_sync_required(metadata: Option<&Value>) -> bool {
    metadata
        .and_then(|value| value.get("codexSyncRequired"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn should_clone_local_branch_history(source_thread: &ThreadDto) -> bool {
    !is_codex_thread_sync_required(source_thread.engine_metadata.as_ref())
        && source_thread.message_count > 0
}

fn clone_codex_branch_metadata(
    existing: Option<&Value>,
    model_id: &str,
    raw_status: Option<&str>,
    active_flags: &[String],
    preview: Option<&str>,
    sync_required: bool,
    sync_reason: Option<&str>,
) -> Value {
    let mut metadata = existing.cloned().unwrap_or_else(|| json!({}));
    if !metadata.is_object() {
        metadata = json!({});
    }

    if let Some(object) = metadata.as_object_mut() {
        object.remove("manualTitle");
        object.remove("manualTitleUpdatedAt");
        object.insert("lastModelId".to_string(), json!(model_id));
        object.insert("codexTranscriptImported".to_string(), json!(true));
    }

    merge_codex_runtime_metadata(
        Some(metadata),
        raw_status,
        active_flags,
        preview,
        sync_required,
        sync_reason,
    )
}

fn codex_transcript_imported(metadata: Option<&Value>) -> bool {
    metadata
        .and_then(|value| value.get("codexTranscriptImported"))
        .and_then(Value::as_bool)
        .unwrap_or(true)
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
        "opencode" => match trust_level {
            TrustLevelDto::Trusted | TrustLevelDto::Standard => "ask",
            TrustLevelDto::Restricted => "deny",
        },
        _ => match trust_level {
            TrustLevelDto::Trusted | TrustLevelDto::Standard => "on-request",
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
        "opencode" => Ok(metadata
            .and_then(|value| value.get("opencodePermissionMode"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| matches!(*value, "ask" | "allow" | "deny"))
            .map(|value| Value::String(value.to_string()))),
        _ => metadata
            .and_then(|value| value.get("sandboxApprovalPolicy"))
            .cloned()
            .map(normalize_codex_approval_policy)
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
        "dangerfullaccess" | "danger-full-access" | "danger_full_access" => "danger-full-access",
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
        let root = root
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                "invalid `workspaceWritableRoots` on thread metadata. expected non-empty string paths"
                    .to_string()
            })?;
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

fn thread_opencode_agent(metadata: Option<&Value>) -> Option<String> {
    metadata
        .and_then(|value| value.get("opencodeAgent"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
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
        "opencode" => "opencodePermissionMode",
        _ => "sandboxApprovalPolicy",
    }
}

fn normalize_thread_approval_policy_for_engine(
    engine_id: &str,
    value: Option<Value>,
) -> Result<Option<Value>, String> {
    let Some(value) = value else {
        return Ok(None);
    };

    match engine_id {
        "claude" => {
            let normalized = value
                .as_str()
                .map(str::trim)
                .filter(|candidate| !candidate.is_empty())
                .map(str::to_lowercase)
                .ok_or_else(|| {
                    "invalid Claude permission mode. expected a string value".to_string()
                })?;

            match normalized.as_str() {
                "restricted" | "standard" | "trusted" => {
                    Ok(Some(Value::String(normalized)))
                }
                _ => Err(format!(
                    "invalid Claude permission mode `{normalized}`. expected one of: restricted, standard, trusted"
                )),
            }
        }
        "opencode" => {
            let normalized = value
                .as_str()
                .map(str::trim)
                .filter(|candidate| !candidate.is_empty())
                .map(str::to_lowercase)
                .ok_or_else(|| {
                    "invalid OpenCode permission mode. expected a string value".to_string()
                })?;

            match normalized.as_str() {
                "ask" | "allow" | "deny" => Ok(Some(Value::String(normalized))),
                _ => Err(format!(
                    "invalid OpenCode permission mode `{normalized}`. expected one of: ask, allow, deny"
                )),
            }
        }
        _ => normalize_codex_approval_policy(value).map(Some),
    }
}

fn normalize_codex_approval_policy(value: Value) -> Result<Value, String> {
    match value {
        Value::String(raw) => {
            let normalized = raw.trim().to_lowercase();
            match normalized.as_str() {
                "untrusted" | "on-failure" | "on-request" | "never" => {
                    Ok(Value::String(normalized))
                }
                _ => Err(format!(
                    "invalid approval policy `{normalized}`. expected one of: untrusted, on-failure, on-request, never"
                )),
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

            Ok(Value::Object(object))
        }
        _ => Err(
            "invalid approval policy. expected a string mode or structured reject object"
                .to_string(),
        ),
    }
}

fn normalize_thread_personality(value: Option<String>) -> Result<Option<String>, String> {
    let normalized = value
        .as_deref()
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(str::to_lowercase);

    let Some(normalized) = normalized else {
        return Ok(None);
    };

    match normalized.as_str() {
        "none" | "friendly" | "pragmatic" => Ok(Some(normalized)),
        _ => Err(format!(
            "invalid personality `{normalized}`. expected one of: none, friendly, pragmatic"
        )),
    }
}

fn normalize_thread_service_tier(value: Option<String>) -> Result<Option<String>, String> {
    let normalized = value
        .as_deref()
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty())
        .map(str::to_lowercase);

    let Some(normalized) = normalized else {
        return Ok(None);
    };

    match normalized.as_str() {
        "fast" | "flex" => Ok(Some(normalized)),
        _ => Err(format!(
            "invalid service tier `{normalized}`. expected one of: fast, flex"
        )),
    }
}

fn normalize_thread_output_schema(value: Option<Value>) -> Result<Option<Value>, String> {
    let Some(value) = value else {
        return Ok(None);
    };

    match value {
        Value::Object(_) | Value::Bool(_) => Ok(Some(value)),
        _ => Err("invalid output schema. expected a JSON Schema object or boolean".to_string()),
    }
}

fn normalize_thread_opencode_agent(value: Option<String>) -> Result<Option<String>, String> {
    let normalized = value
        .as_deref()
        .map(str::trim)
        .filter(|candidate| !candidate.is_empty());

    let Some(normalized) = normalized else {
        return Ok(None);
    };

    if normalized.chars().count() > 120 {
        return Err("invalid OpenCode agent. name is too long".to_string());
    }

    if !normalized
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(
            "invalid OpenCode agent. expected letters, numbers, dots, dashes, or underscores"
                .to_string(),
        );
    }

    if normalized == "build" {
        return Ok(None);
    }

    Ok(Some(normalized.to_string()))
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

fn normalize_workspace_confirmation_roots(
    writable_roots: &[String],
    _workspace_root: &str,
    repo_paths: &[String],
) -> Result<Vec<String>, String> {
    if writable_roots.is_empty() {
        return Err(
            "workspace writable roots must include at least one active repository".to_string(),
        );
    }

    let allowed_roots: std::collections::HashSet<&str> =
        repo_paths.iter().map(String::as_str).collect();
    let mut normalized = Vec::with_capacity(writable_roots.len());
    for root in writable_roots {
        let root = root.trim();
        if root.is_empty() {
            return Err("workspace writable roots must be non-empty paths".to_string());
        }
        if !allowed_roots.contains(root) {
            return Err(format!(
                "workspace writable root `{root}` is not an active repository in this workspace"
            ));
        }
        if !normalized.iter().any(|value: &String| value == root) {
            normalized.push(root.to_string());
        }
    }

    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc};

    use super::*;
    use crate::{
        config::app_config::AppConfig,
        engines::EngineManager,
        git::{repo::FileTreeCache, watcher::GitWatcherManager},
        power::KeepAwakeManager,
        state::{AppState, TurnManager},
        terminal::TerminalManager,
        terminal_notifications::TerminalNotificationManager,
    };
    use uuid::Uuid;

    fn test_app_state() -> AppState {
        let root = std::env::temp_dir().join(format!("panes-threads-cmd-{}", Uuid::new_v4()));
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
            notifications: Arc::new(TerminalNotificationManager::default()),
            keep_awake: Arc::new(KeepAwakeManager::new()),
            turns: Arc::new(TurnManager::default()),
            file_tree_cache: Arc::new(FileTreeCache::new()),
        }
    }

    fn test_workspace(state: &AppState) -> crate::models::WorkspaceDto {
        let workspace_root =
            std::env::temp_dir().join(format!("panes-threads-workspace-{}", Uuid::new_v4()));
        fs::create_dir_all(&workspace_root).expect("failed to create workspace root");
        crate::db::workspaces::upsert_workspace(
            &state.db,
            workspace_root.to_string_lossy().as_ref(),
            Some(1),
        )
        .expect("failed to create workspace")
    }

    fn test_thread(state: &AppState, engine_id: &str, model_id: &str) -> ThreadDto {
        let workspace = test_workspace(state);
        crate::db::threads::create_thread(
            &state.db,
            &workspace.id,
            None,
            engine_id,
            model_id,
            "Thread",
        )
        .expect("failed to create thread")
    }

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
            normalize_thread_approval_policy_for_engine("claude", Some(json!("trusted"))).unwrap(),
            Some(json!("trusted"))
        );
        assert_eq!(
            normalize_thread_approval_policy_for_engine("claude", Some(json!("STANDARD"))).unwrap(),
            Some(json!("standard"))
        );
    }

    #[test]
    fn normalize_thread_approval_policy_rejects_codex_values_for_claude() {
        assert!(
            normalize_thread_approval_policy_for_engine("claude", Some(json!("on-request")))
                .is_err()
        );
    }

    #[test]
    fn normalize_thread_approval_policy_accepts_opencode_modes() {
        assert_eq!(
            normalize_thread_approval_policy_for_engine("opencode", Some(json!("ALLOW"))).unwrap(),
            Some(json!("allow"))
        );
        assert_eq!(
            normalize_thread_approval_policy_for_engine("opencode", Some(json!("ask"))).unwrap(),
            Some(json!("ask"))
        );
        assert!(
            normalize_thread_approval_policy_for_engine("opencode", Some(json!("on-request")))
                .is_err()
        );
    }

    #[test]
    fn normalize_thread_approval_policy_accepts_structured_codex_policy() {
        let normalized = normalize_thread_approval_policy_for_engine(
            "codex",
            Some(json!({
                "reject": {
                    "mcp_elicitations": false,
                    "request_permissions": true,
                    "rules": true,
                    "sandbox_approval": false
                }
            })),
        )
        .expect("expected structured policy to validate");

        assert_eq!(
            normalized,
            Some(json!({
                "reject": {
                    "mcp_elicitations": false,
                    "request_permissions": true,
                    "rules": true,
                    "sandbox_approval": false
                }
            }))
        );
    }

    #[test]
    fn normalize_thread_personality_accepts_known_values() {
        assert_eq!(
            normalize_thread_personality(Some("Friendly".to_string())).unwrap(),
            Some("friendly".to_string())
        );
        assert_eq!(
            normalize_thread_service_tier(Some(" FLEX ".to_string())).unwrap(),
            Some("flex".to_string())
        );
        assert_eq!(
            normalize_thread_output_schema(Some(json!(true))).unwrap(),
            Some(json!(true))
        );
    }

    #[test]
    fn normalize_workspace_confirmation_roots_rejects_unknown_paths() {
        let error = normalize_workspace_confirmation_roots(
            &[String::from("/workspace/unknown")],
            "/workspace",
            &[
                String::from("/workspace/repo-a"),
                String::from("/workspace/repo-b"),
            ],
        )
        .expect_err("expected unknown path to be rejected");

        assert!(error.contains("is not an active repository"));
    }

    #[test]
    fn normalize_workspace_confirmation_roots_rejects_empty_lists() {
        let error = normalize_workspace_confirmation_roots(
            &[],
            "/workspace",
            &[
                String::from("/workspace/repo-a"),
                String::from("/workspace/repo-b"),
            ],
        )
        .expect_err("expected empty roots to be rejected");

        assert!(error.contains("must include at least one active repository"));
    }

    #[test]
    fn normalize_workspace_confirmation_roots_deduplicates_confirmed_paths() {
        let roots = normalize_workspace_confirmation_roots(
            &[
                String::from("/workspace/repo-a"),
                String::from("/workspace/repo-a"),
                String::from("/workspace/repo-b"),
            ],
            "/workspace",
            &[
                String::from("/workspace/repo-a"),
                String::from("/workspace/repo-b"),
            ],
        )
        .expect("expected roots to normalize");

        assert_eq!(
            roots,
            vec![
                String::from("/workspace/repo-a"),
                String::from("/workspace/repo-b")
            ]
        );
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

    #[test]
    fn resolve_codex_remote_thread_repo_id_accepts_workspace_root_and_repo_roots() {
        let repos = vec![RepoDto {
            id: "repo-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            name: "repo".to_string(),
            path: "/workspace/repo".to_string(),
            default_branch: "main".to_string(),
            is_active: true,
            trust_level: TrustLevelDto::Standard,
        }];

        assert_eq!(
            resolve_codex_remote_thread_repo_id("/workspace", &repos, "/workspace").unwrap(),
            None
        );
        assert_eq!(
            resolve_codex_remote_thread_repo_id("/workspace", &repos, "/workspace/repo").unwrap(),
            Some("repo-1".to_string())
        );
        assert!(resolve_codex_remote_thread_repo_id("/workspace", &repos, "/elsewhere").is_err());
    }

    #[test]
    fn build_codex_remote_thread_title_prefers_thread_title_then_preview() {
        let titled = CodexRemoteThreadSummary {
            engine_thread_id: "thread-12345678".to_string(),
            title: Some("  Remote title  ".to_string()),
            preview: "Preview line".to_string(),
            cwd: "/workspace".to_string(),
            created_at: 1_710_000_000,
            updated_at: 1_710_000_001,
            model_provider: "openai".to_string(),
            source_kind: "appServer".to_string(),
            status_type: "idle".to_string(),
            active_flags: Vec::new(),
            archived: false,
        };
        let preview_only = CodexRemoteThreadSummary {
            title: None,
            preview: "First line\nSecond line".to_string(),
            ..titled.clone()
        };

        assert_eq!(build_codex_remote_thread_title(&titled), "Remote title");
        assert_eq!(build_codex_remote_thread_title(&preview_only), "First line");
    }

    #[test]
    fn build_codex_remote_thread_metadata_sets_remote_fields() {
        let summary = CodexRemoteThreadSummary {
            engine_thread_id: "thread-12345678".to_string(),
            title: Some("Remote title".to_string()),
            preview: "Preview line".to_string(),
            cwd: "/workspace".to_string(),
            created_at: 1_710_000_000,
            updated_at: 1_710_000_001,
            model_provider: "openai".to_string(),
            source_kind: "appServer".to_string(),
            status_type: "active".to_string(),
            active_flags: vec!["waitingOnApproval".to_string()],
            archived: true,
        };

        let metadata = build_codex_remote_thread_metadata(&summary, "gpt-5.4");

        assert_eq!(metadata.get("lastModelId"), Some(&json!("gpt-5.4")));
        assert_eq!(metadata.get("codexTranscriptImported"), Some(&json!(false)));
        assert_eq!(metadata.get("codexModelProvider"), Some(&json!("openai")));
        assert_eq!(metadata.get("codexSourceKind"), Some(&json!("appServer")));
        assert_eq!(metadata.get("codexRemoteArchived"), Some(&json!(true)));
        assert_eq!(metadata.get("codexRemoteCwd"), Some(&json!("/workspace")));
        assert_eq!(metadata.get("codexThreadStatus"), Some(&json!("active")));
        assert_eq!(
            metadata.get("codexThreadActiveFlags"),
            Some(&json!(["waitingOnApproval"]))
        );
        assert_eq!(metadata.get("codexPreview"), Some(&json!("Preview line")));
        assert_eq!(metadata.get("codexSyncRequired"), Some(&json!(true)));
        assert_eq!(
            metadata.get("codexSyncReason"),
            Some(&json!("remote_thread_attached"))
        );
    }

    #[test]
    fn remote_timestamp_format_accepts_opencode_milliseconds() {
        assert_eq!(
            codex_remote_thread_timestamp_to_rfc3339(1_777_155_663_506),
            "2026-04-25T22:21:03.506+00:00"
        );
    }

    #[test]
    fn build_opencode_remote_session_metadata_sets_remote_fields() {
        let summary = OpenCodeRemoteSessionSummary {
            engine_thread_id: "ses_12345678".to_string(),
            title: Some("OpenCode title".to_string()),
            cwd: "/workspace".to_string(),
            created_at: 1_777_155_663_506,
            updated_at: 1_777_155_663_524,
            archived: true,
        };

        let metadata = build_opencode_remote_session_metadata(
            Some(&json!({
                "opencodeAgent": "plan",
                "reasoningEffort": "high"
            })),
            &summary,
            "opencode/big-pickle",
        );

        assert_eq!(
            build_opencode_remote_session_title(&summary),
            "OpenCode title"
        );
        assert_eq!(
            metadata.get("lastModelId"),
            Some(&json!("opencode/big-pickle"))
        );
        assert_eq!(
            metadata.get("opencodeRemoteSessionAttached"),
            Some(&json!(true))
        );
        assert_eq!(metadata.get("opencodeRemoteArchived"), Some(&json!(true)));
        assert_eq!(
            metadata.get("opencodeRemoteCwd"),
            Some(&json!("/workspace"))
        );
        assert_eq!(
            metadata.get("opencodeTranscriptImported"),
            Some(&json!(false))
        );
        assert_eq!(metadata.get("opencodeAgent"), Some(&json!("plan")));
        assert_eq!(metadata.get("reasoningEffort"), Some(&json!("high")));
    }

    #[test]
    fn clone_codex_branch_metadata_marks_local_transcript_as_imported() {
        let metadata = clone_codex_branch_metadata(
            Some(&json!({
                "codexTranscriptImported": false,
                "manualTitle": true,
            })),
            "gpt-5.4",
            Some("idle"),
            &[],
            Some("Preview"),
            false,
            None,
        );

        assert_eq!(metadata.get("codexTranscriptImported"), Some(&json!(true)));
        assert_eq!(metadata.get("lastModelId"), Some(&json!("gpt-5.4")));
        assert_eq!(metadata.get("manualTitle"), None);
    }

    #[test]
    fn should_clone_local_branch_history_requires_synced_local_messages() {
        let mut thread = ThreadDto {
            id: "thread-1".to_string(),
            workspace_id: "workspace-1".to_string(),
            repo_id: None,
            engine_id: "codex".to_string(),
            model_id: "gpt-5.4".to_string(),
            engine_thread_id: Some("engine-thread-1".to_string()),
            engine_metadata: Some(json!({
                "codexSyncRequired": false,
            })),
            title: "Thread".to_string(),
            status: ThreadStatusDto::Idle,
            message_count: 2,
            total_tokens: 0,
            created_at: "2026-03-13T00:00:00Z".to_string(),
            last_activity_at: "2026-03-13T00:00:00Z".to_string(),
        };

        assert!(should_clone_local_branch_history(&thread));

        thread.message_count = 0;
        assert!(!should_clone_local_branch_history(&thread));

        thread.message_count = 2;
        thread.engine_metadata = Some(json!({
            "codexSyncRequired": true,
        }));
        assert!(!should_clone_local_branch_history(&thread));
    }

    #[tokio::test]
    async fn create_codex_branch_thread_rejects_threads_without_imported_transcript() {
        let state = test_app_state();
        let mut thread = test_thread(&state, "codex", "gpt-5.4");
        thread.engine_metadata = Some(json!({
            "codexTranscriptImported": false,
        }));

        let error = create_codex_branch_thread(
            &state,
            &thread,
            "engine-thread-branch",
            "gpt-5.4",
            Some("Fork"),
            None,
            Some("idle"),
            &[],
            None,
        )
        .await
        .expect_err("expected branch creation to reject missing local transcript");

        assert!(error.contains("locally mirrored transcript"));
    }

    #[test]
    fn clone_codex_branch_metadata_preserves_sync_needed_state() {
        let metadata = clone_codex_branch_metadata(
            Some(&json!({
                "manualTitle": true,
                "manualTitleUpdatedAt": "2026-03-12T00:00:00Z",
                "codexPreview": "old preview",
                "codexThreadStatus": "active",
                "codexThreadActiveFlags": ["waitingOnApproval"],
                "codexSyncRequired": false,
                "serviceTier": "fast",
            })),
            "gpt-5.4",
            Some("active"),
            &["waitingOnApproval".to_string()],
            Some("Fresh preview"),
            true,
            Some("branch_thread_requires_sync"),
        );

        assert_eq!(metadata.get("manualTitle"), None);
        assert_eq!(metadata.get("manualTitleUpdatedAt"), None);
        assert_eq!(metadata.get("lastModelId"), Some(&json!("gpt-5.4")));
        assert_eq!(metadata.get("codexPreview"), Some(&json!("Fresh preview")));
        assert_eq!(metadata.get("codexThreadStatus"), Some(&json!("active")));
        assert_eq!(
            metadata.get("codexThreadActiveFlags"),
            Some(&json!(["waitingOnApproval"]))
        );
        assert_eq!(metadata.get("codexSyncRequired"), Some(&json!(true)));
        assert_eq!(
            metadata.get("codexSyncReason"),
            Some(&json!("branch_thread_requires_sync"))
        );
        assert_eq!(metadata.get("serviceTier"), Some(&json!("fast")));
    }

    #[tokio::test]
    async fn create_thread_inner_persists_initial_runtime_metadata() {
        let state = test_app_state();
        let workspace = test_workspace(&state);

        let created = create_thread_inner(
            &state,
            workspace.id,
            None,
            "codex".to_string(),
            "gpt-5.4".to_string(),
            "Thread".to_string(),
            Some("HIGH".to_string()),
            Some("FAST".to_string()),
        )
        .await
        .expect("expected thread creation to succeed");

        let metadata = created
            .engine_metadata
            .expect("expected runtime metadata to be stored");
        assert_eq!(metadata.get("reasoningEffort"), Some(&json!("high")));
        assert_eq!(metadata.get("serviceTier"), Some(&json!("fast")));
    }

    #[tokio::test]
    async fn create_thread_inner_rejects_unsupported_reasoning_effort() {
        let state = test_app_state();
        let workspace = test_workspace(&state);

        let error = create_thread_inner(
            &state,
            workspace.id,
            None,
            "codex".to_string(),
            "gpt-5.1-codex-mini".to_string(),
            "Thread".to_string(),
            Some("low".to_string()),
            None,
        )
        .await
        .expect_err("expected unsupported effort to be rejected");

        assert!(error.contains("reasoning effort `low` is not supported"));
    }

    #[tokio::test]
    async fn create_thread_inner_rejects_service_tier_for_non_codex_threads() {
        let state = test_app_state();
        let workspace = test_workspace(&state);

        let error = create_thread_inner(
            &state,
            workspace.id,
            None,
            "claude".to_string(),
            "claude-sonnet-4-6".to_string(),
            "Thread".to_string(),
            None,
            Some("fast".to_string()),
        )
        .await
        .expect_err("expected non-codex service tier to be rejected");

        assert!(error.contains("service tier is only supported for Codex threads"));
    }

    #[tokio::test]
    async fn set_thread_execution_policy_allows_claude_read_only() {
        let state = test_app_state();
        let thread = test_thread(&state, "claude", "claude-sonnet-4-6");

        let updated = set_thread_execution_policy_inner(
            &state,
            thread.id.clone(),
            false,
            None,
            true,
            Some("read-only".to_string()),
            false,
            None,
        )
        .await
        .expect("expected read-only update to succeed");

        assert_eq!(
            updated
                .engine_metadata
                .as_ref()
                .and_then(|value| value.get("sandboxMode"))
                .and_then(serde_json::Value::as_str),
            Some("read-only")
        );
    }

    #[tokio::test]
    async fn set_thread_execution_policy_allows_claude_workspace_write() {
        let state = test_app_state();
        let thread = test_thread(&state, "claude", "claude-sonnet-4-6");

        let updated = set_thread_execution_policy_inner(
            &state,
            thread.id.clone(),
            false,
            None,
            true,
            Some("workspace-write".to_string()),
            false,
            None,
        )
        .await
        .expect("expected workspace-write update to succeed");

        assert_eq!(
            updated
                .engine_metadata
                .as_ref()
                .and_then(|value| value.get("sandboxMode"))
                .and_then(serde_json::Value::as_str),
            Some("workspace-write")
        );
    }

    #[tokio::test]
    async fn set_thread_execution_policy_rejects_claude_danger_full_access() {
        let state = test_app_state();
        let thread = test_thread(&state, "claude", "claude-sonnet-4-6");

        let error = set_thread_execution_policy_inner(
            &state,
            thread.id.clone(),
            false,
            None,
            true,
            Some("danger-full-access".to_string()),
            false,
            None,
        )
        .await
        .expect_err("expected danger-full-access to be rejected");

        assert!(error.contains("Claude sandbox mode `danger-full-access` is not supported"));
    }

    #[tokio::test]
    async fn set_thread_codex_config_persists_values() {
        let state = test_app_state();
        let thread = test_thread(&state, "codex", "gpt-5.4");

        let updated = set_thread_codex_config_inner(
            &state,
            thread.id.clone(),
            true,
            Some("Friendly".to_string()),
            true,
            Some("FLEX".to_string()),
            true,
            Some(json!({
                "type": "object",
                "properties": {
                    "summary": { "type": "string" }
                }
            })),
        )
        .await
        .expect("expected codex config update to succeed");

        let metadata = updated
            .engine_metadata
            .expect("expected engine metadata to be present");
        assert_eq!(metadata.get("personality"), Some(&json!("friendly")));
        assert_eq!(metadata.get("serviceTier"), Some(&json!("flex")));
        assert_eq!(
            metadata.get("outputSchema"),
            Some(&json!({
                "type": "object",
                "properties": {
                    "summary": { "type": "string" }
                }
            }))
        );
    }

    #[tokio::test]
    async fn set_thread_codex_config_rejects_non_codex_threads() {
        let state = test_app_state();
        let thread = test_thread(&state, "claude", "claude-sonnet-4-6");

        let error = set_thread_codex_config_inner(
            &state,
            thread.id.clone(),
            true,
            Some("friendly".to_string()),
            false,
            None,
            false,
            None,
        )
        .await
        .expect_err("expected non-codex thread to be rejected");

        assert!(error.contains("Codex thread config is only available for Codex threads"));
    }

    #[tokio::test]
    async fn set_thread_opencode_config_persists_agent() {
        let state = test_app_state();
        let thread = test_thread(&state, "opencode", "opencode/big-pickle");

        let updated = set_thread_opencode_config_inner(
            &state,
            thread.id.clone(),
            true,
            Some("Explore_1".to_string()),
        )
        .await
        .expect("expected OpenCode config update to succeed");

        let metadata = updated
            .engine_metadata
            .expect("expected engine metadata to be present");
        assert_eq!(metadata.get("opencodeAgent"), Some(&json!("Explore_1")));
    }

    #[tokio::test]
    async fn set_thread_opencode_config_clears_build_agent() {
        let state = test_app_state();
        let thread = test_thread(&state, "opencode", "opencode/big-pickle");

        let updated = set_thread_opencode_config_inner(
            &state,
            thread.id.clone(),
            true,
            Some("build".to_string()),
        )
        .await
        .expect("expected OpenCode build agent to clear override");

        assert!(updated
            .engine_metadata
            .and_then(|metadata| metadata.get("opencodeAgent").cloned())
            .is_none());
    }

    #[tokio::test]
    async fn set_thread_opencode_config_rejects_non_opencode_threads() {
        let state = test_app_state();
        let thread = test_thread(&state, "codex", "gpt-5.4");

        let error = set_thread_opencode_config_inner(
            &state,
            thread.id.clone(),
            true,
            Some("explore".to_string()),
        )
        .await
        .expect_err("expected non-opencode thread to be rejected");

        assert!(error.contains("OpenCode thread config is only available for OpenCode threads"));
    }
}
