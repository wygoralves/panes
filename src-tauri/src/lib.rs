mod commands;
mod config;
mod db;
mod engines;
mod fs_ops;
mod git;
#[cfg(any(target_os = "linux", test))]
mod linux_appimage;
mod linux_webkit;
mod locale;
mod models;
mod path_utils;
mod power;
mod process_utils;
mod runtime_env;
mod state;
mod terminal;
mod terminal_notifications;
mod workspace_startup;

use std::sync::Arc;

use anyhow::Context;
use rusqlite::OptionalExtension;

use config::app_config::AppConfig;
use db::Database;
use engines::{CodexRuntimeEvent, EngineManager};
use git::repo::FileTreeCache;
use git::watcher::GitWatcherManager;
#[cfg(target_os = "macos")]
use locale::native_strings;
use locale::resolve_app_locale;
use models::{EngineRuntimeUpdatedDto, ThreadDto, ThreadStatusDto};
use power::KeepAwakeManager;
use state::{AppState, TurnManager};
#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::{image::Image, menu::Menu, Emitter, Manager, RunEvent, WebviewWindowBuilder};
use terminal::TerminalManager;

pub fn maybe_handle_cli_subcommand() -> anyhow::Result<bool> {
    terminal_notifications::maybe_handle_cli_subcommand()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    linux_webkit::apply_webkit_display_workarounds();

    let db = Database::init().expect("failed to initialize database");
    match db::threads::reconcile_runtime_state(&db) {
        Ok(report) => {
            if report.messages_marked_interrupted > 0 || report.thread_status_updates > 0 {
                log::info!(
                    "runtime recovery applied: interrupted_messages={}, thread_status_updates={}",
                    report.messages_marked_interrupted,
                    report.thread_status_updates
                );
            }
        }
        Err(error) => {
            log::warn!("runtime recovery failed, continuing startup: {error}");
        }
    }
    let app_config = AppConfig::load_or_create().expect("failed to load config");
    let app_locale = resolve_app_locale(app_config.general.locale.as_deref());
    let keep_awake = Arc::new(KeepAwakeManager::new());
    if let Err(error) = keep_awake.reclaim_stale_helpers() {
        log::warn!("failed to reclaim stale keep awake helper: {error}");
    }
    if app_config.power.keep_awake_enabled {
        if let Err(error) =
            tauri::async_runtime::block_on(keep_awake.enable_with_config(&app_config.power))
        {
            log::warn!("failed to reapply keep awake on startup: {error}");
        }
    }

    let _ =
        db::workspaces::ensure_default_workspace(&db).expect("failed to ensure default workspace");

    let app_state = AppState {
        db,
        config: Arc::new(app_config),
        config_write_lock: Arc::new(tokio::sync::Mutex::new(())),
        engines: Arc::new(EngineManager::new()),
        git_watchers: Arc::new(GitWatcherManager::default()),
        terminals: Arc::new(TerminalManager::default()),
        notifications: Arc::new(terminal_notifications::TerminalNotificationManager::default()),
        keep_awake,
        turns: Arc::new(TurnManager::default()),
        file_tree_cache: Arc::new(FileTreeCache::new()),
    };

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(app_state)
        .menu(move |handle| build_app_menu(handle, app_locale))
        .setup(|app| {
            let main_window_config = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .or_else(|| app.config().app.windows.first())
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("main window config not found"))?;

            #[cfg(any(target_os = "linux", target_os = "windows"))]
            let main_window_config = {
                let mut main_window_config = main_window_config;
                main_window_config.decorations = false;
                main_window_config
            };

            let main_window = WebviewWindowBuilder::from_config(app.handle(), &main_window_config)?
                .enable_clipboard_access()
                .build()?;
            #[cfg(not(target_os = "linux"))]
            let _ = &main_window;

            #[cfg(target_os = "linux")]
            {
                if let Ok(icon) = Image::from_bytes(include_bytes!("../icons/icon.png")) {
                    if let Err(error) = main_window.set_icon(icon) {
                        log::warn!("failed to apply linux window icon: {error}");
                    }
                }
            }

            #[cfg(target_os = "linux")]
            tauri::async_runtime::spawn_blocking(|| {
                match linux_appimage::ensure_appimage_desktop_integration() {
                    Ok(status) => {
                        if !matches!(
                            status,
                            linux_appimage::AppImageIntegrationStatus::SkippedNotAppImage
                        ) {
                            log::info!("linux AppImage desktop integration status: {status:?}");
                        }
                    }
                    Err(error) => {
                        log::warn!("failed to ensure linux AppImage desktop integration: {error}");
                    }
                }
            });

            let handle = app.handle().clone();
            let resource_dir = app.path().resource_dir().ok();
            let state = app.state::<AppState>().inner().clone();
            if let Err(error) = tauri::async_runtime::block_on(state.notifications.start(handle.clone())) {
                log::warn!("failed to start terminal notification ingress: {error}");
            }
            state.engines.set_resource_dir(resource_dir);
            tauri::async_runtime::spawn(run_codex_runtime_bridge(handle.clone(), state.clone()));
            app.on_menu_event(move |_app, event| {
                let id = event.id().as_ref();
                match id {
                    "toggle-sidebar" | "toggle-git-panel" | "toggle-focus-mode"
                    | "toggle-fullscreen" | "toggle-search" | "toggle-terminal"
                    | "close-window" | "edit-undo" | "edit-redo" | "edit-cut" | "edit-copy"
                    | "edit-paste" | "edit-select-all" => {
                        let _ = handle.emit("menu-action", id);
                    }
                    _ => {}
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_locale,
            commands::app::set_app_locale,
            commands::power::get_keep_awake_state,
            commands::power::set_keep_awake_enabled,
            commands::power::get_power_settings,
            commands::power::set_power_settings,
            commands::power::get_helper_status,
            commands::power::register_keep_awake_helper,
            commands::chat::send_message,
            commands::chat::start_codex_review,
            commands::chat::steer_message,
            commands::chat::cancel_turn,
            commands::chat::respond_to_approval,
            commands::chat::get_thread_messages,
            commands::chat::get_thread_messages_window,
            commands::chat::get_message_blocks,
            commands::chat::get_action_output,
            commands::chat::search_messages,
            commands::workspace::open_workspace,
            commands::workspace::list_workspaces,
            commands::workspace::list_archived_workspaces,
            commands::workspace::get_repos,
            commands::workspace::set_repo_trust_level,
            commands::workspace::set_repo_git_active,
            commands::workspace::set_workspace_git_active_repos,
            commands::workspace::has_workspace_git_selection,
            commands::workspace::archive_workspace,
            commands::workspace::restore_workspace,
            commands::workspace::delete_workspace,
            commands::workspace::get_workspace_startup_preset,
            commands::workspace::normalize_workspace_startup_preset,
            commands::workspace::serialize_workspace_startup_preset,
            commands::workspace::normalize_workspace_startup_preset_raw,
            commands::workspace::set_workspace_startup_preset,
            commands::workspace::set_workspace_startup_preset_raw,
            commands::workspace::clear_workspace_startup_preset,
            commands::workspace::export_workspace_startup_preset,
            commands::workspace::list_workspace_dirs,
            commands::git::get_git_status,
            commands::git::get_file_diff,
            commands::git::get_git_file_compare,
            commands::git::stage_files,
            commands::git::unstage_files,
            commands::git::discard_files,
            commands::git::commit,
            commands::git::soft_reset_last_commit,
            commands::git::fetch_git,
            commands::git::pull_git,
            commands::git::push_git,
            commands::git::list_git_branches,
            commands::git::checkout_git_branch,
            commands::git::create_git_branch,
            commands::git::rename_git_branch,
            commands::git::delete_git_branch,
            commands::git::list_git_commits,
            commands::git::get_commit_diff,
            commands::git::list_git_stashes,
            commands::git::push_git_stash,
            commands::git::apply_git_stash,
            commands::git::pop_git_stash,
            commands::git::get_file_tree,
            commands::git::get_file_tree_page,
            commands::git::add_git_worktree,
            commands::git::list_git_worktrees,
            commands::git::remove_git_worktree,
            commands::git::prune_git_worktrees,
            commands::git::init_git_repo,
            commands::git::list_git_remotes,
            commands::git::add_git_remote,
            commands::git::remove_git_remote,
            commands::git::rename_git_remote,
            commands::app::get_terminal_accelerated_rendering,
            commands::app::set_terminal_accelerated_rendering,
            commands::app::get_agent_notification_settings,
            commands::app::set_chat_notifications_enabled,
            commands::app::set_terminal_notifications_enabled,
            commands::app::install_terminal_notification_integration_command,
            commands::app::set_notification_sound,
            commands::app::preview_notification_sound,
            commands::app::show_agent_notification,
            commands::files::list_dir,
            commands::files::read_file,
            commands::files::write_file,
            commands::files::reveal_path,
            commands::git::watch_git_repo,
            commands::engines::list_engines,
            commands::engines::engine_health,
            commands::engines::prewarm_engine,
            commands::engines::list_codex_skills,
            commands::engines::list_codex_apps,
            commands::engines::run_engine_check,
            commands::threads::list_threads,
            commands::threads::list_archived_threads,
            commands::threads::list_codex_remote_threads,
            commands::threads::attach_codex_remote_thread,
            commands::threads::create_thread,
            commands::threads::rename_thread,
            commands::threads::confirm_workspace_thread,
            commands::threads::set_thread_reasoning_effort,
            commands::threads::set_thread_execution_policy,
            commands::threads::set_thread_codex_config,
            commands::threads::archive_thread,
            commands::threads::restore_thread,
            commands::threads::sync_thread_from_engine,
            commands::threads::fork_codex_thread,
            commands::threads::rollback_codex_thread,
            commands::threads::compact_codex_thread,
            commands::threads::delete_thread,
            commands::terminal::terminal_create_session,
            commands::terminal::terminal_write,
            commands::terminal::terminal_write_bytes,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close_session,
            commands::terminal::terminal_close_workspace_sessions,
            commands::terminal::terminal_list_sessions,
            commands::terminal::terminal_get_renderer_diagnostics,
            commands::terminal::terminal_resume_session,
            commands::terminal::terminal_list_notifications,
            commands::terminal::terminal_clear_notification,
            commands::terminal::terminal_set_notification_focus,
            commands::setup::check_dependencies,
            commands::setup::install_dependency,
            commands::harness::check_harnesses,
            commands::harness::install_harness,
            commands::harness::launch_harness,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            let terminals = app_handle.state::<AppState>().terminals.clone();
            let keep_awake = app_handle.state::<AppState>().keep_awake.clone();
            tauri::async_runtime::block_on(async move {
                if let Err(error) = keep_awake.shutdown().await {
                    log::warn!("failed to release keep awake on shutdown: {error}");
                }
                terminals.shutdown().await;
            });
        }
        _ => {}
    });
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadUpdatedEvent {
    thread_id: String,
    workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    thread: Option<ThreadDto>,
}

async fn run_codex_runtime_bridge(app: tauri::AppHandle, state: AppState) {
    let mut rx = state.engines.subscribe_codex_runtime_events();
    loop {
        match rx.recv().await {
            Ok(event) => handle_codex_runtime_event(&app, &state, event).await,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                log::warn!("codex runtime bridge lagged and skipped {skipped} events");
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }
}

async fn handle_codex_runtime_event(
    app: &tauri::AppHandle,
    state: &AppState,
    event: CodexRuntimeEvent,
) {
    match event {
        CodexRuntimeEvent::DiagnosticsUpdated { diagnostics, toast } => {
            let _ = app.emit(
                "engine-runtime-updated",
                EngineRuntimeUpdatedDto {
                    engine_id: "codex".to_string(),
                    protocol_diagnostics: Some(diagnostics),
                    toast,
                },
            );
        }
        CodexRuntimeEvent::ApprovalResolved { approval_id } => {
            resolve_codex_runtime_approval(app, state, &approval_id).await;
        }
        CodexRuntimeEvent::ThreadStatusChanged {
            engine_thread_id,
            status_type,
            active_flags,
        } => {
            if let Some(updated_thread) = apply_codex_runtime_thread_update(
                state,
                &engine_thread_id,
                None,
                Some(status_type.as_str()),
                &active_flags,
                None,
                None,
                None,
            )
            .await
            {
                let _ = app.emit(
                    "thread-updated",
                    ThreadUpdatedEvent {
                        thread_id: updated_thread.id.clone(),
                        workspace_id: updated_thread.workspace_id.clone(),
                        thread: Some(updated_thread),
                    },
                );
            }
        }
        CodexRuntimeEvent::ThreadNameUpdated {
            engine_thread_id,
            thread_name,
        } => {
            let normalized_thread_name = thread_name.and_then(|name| {
                let trimmed = name.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            });
            let sync_required = if normalized_thread_name.is_some() {
                Some(false)
            } else {
                Some(true)
            };
            let sync_reason = if normalized_thread_name.is_some() {
                None
            } else {
                Some("thread_name_updated")
            };
            if let Some(updated_thread) = apply_codex_runtime_thread_update(
                state,
                &engine_thread_id,
                normalized_thread_name.as_deref(),
                None,
                &[],
                None,
                sync_required,
                sync_reason,
            )
            .await
            {
                let _ = app.emit(
                    "thread-updated",
                    ThreadUpdatedEvent {
                        thread_id: updated_thread.id.clone(),
                        workspace_id: updated_thread.workspace_id.clone(),
                        thread: Some(updated_thread),
                    },
                );
            }
        }
        CodexRuntimeEvent::ThreadSnapshotUpdated {
            engine_thread_id,
            thread_name,
            status_type,
            active_flags,
            preview,
        } => {
            if let Some(updated_thread) = apply_codex_runtime_thread_update(
                state,
                &engine_thread_id,
                thread_name.as_deref(),
                status_type.as_deref(),
                &active_flags,
                preview.as_deref(),
                Some(false),
                None,
            )
            .await
            {
                let _ = app.emit(
                    "thread-updated",
                    ThreadUpdatedEvent {
                        thread_id: updated_thread.id.clone(),
                        workspace_id: updated_thread.workspace_id.clone(),
                        thread: Some(updated_thread),
                    },
                );
            }
        }
        CodexRuntimeEvent::ThreadArchived { engine_thread_id } => {
            if let Some((thread_id, workspace_id)) =
                archive_codex_runtime_thread(state, &engine_thread_id).await
            {
                let _ = app.emit(
                    "thread-updated",
                    ThreadUpdatedEvent {
                        thread_id,
                        workspace_id,
                        thread: None,
                    },
                );
            }
        }
        CodexRuntimeEvent::ThreadUnarchived { engine_thread_id } => {
            if let Some(updated_thread) =
                restore_codex_runtime_thread(state, &engine_thread_id).await
            {
                let _ = app.emit(
                    "thread-updated",
                    ThreadUpdatedEvent {
                        thread_id: updated_thread.id.clone(),
                        workspace_id: updated_thread.workspace_id.clone(),
                        thread: Some(updated_thread),
                    },
                );
            }
        }
    }
}

async fn resolve_codex_runtime_approval(
    app: &tauri::AppHandle,
    state: &AppState,
    approval_id: &str,
) {
    let Some((thread_id, message_id)) = run_db(state.db.clone(), {
        let approval_id = approval_id.to_string();
        move |db| db::actions::find_approval_context(db, &approval_id)
    })
    .await
    .ok()
    .flatten() else {
        return;
    };

    let has_local_turn = state.turns.get(&thread_id).await.is_some();
    let updated_thread = match run_db(state.db.clone(), {
        let approval_id = approval_id.to_string();
        let thread_id = thread_id.clone();
        let message_id = message_id.clone();
        move |db| {
            let mut conn = db.connect()?;
            let tx = conn
                .transaction()
                .context("failed to start approval resolution transaction")?;

            // Resolve the approval record.
            tx.execute(
                "UPDATE approvals
                 SET status = 'answered', answered_at = COALESCE(answered_at, datetime('now'))
                 WHERE id = ?1",
                rusqlite::params![approval_id],
            )
            .context("failed to resolve approval")?;

            // Update the approval block inside the message's blocks_json (best-effort).
            let raw_blocks: Option<String> = tx
                .query_row(
                    "SELECT blocks_json FROM messages WHERE id = ?1",
                    rusqlite::params![message_id],
                    |row| row.get(0),
                )
                .optional()
                .context("failed to load message blocks for approval update")?;
            if let Some(raw_blocks) = raw_blocks {
                let mut blocks_value: serde_json::Value =
                    serde_json::from_str(&raw_blocks).unwrap_or_else(|_| serde_json::json!([]));
                let changed = if let Some(items) = blocks_value.as_array_mut() {
                    let mut any_changed = false;
                    for block in items.iter_mut() {
                        let Some(object) = block.as_object_mut() else {
                            continue;
                        };
                        if object.get("type").and_then(serde_json::Value::as_str)
                            != Some("approval")
                        {
                            continue;
                        }
                        let bid = object
                            .get("approvalId")
                            .and_then(serde_json::Value::as_str)
                            .or_else(|| {
                                object
                                    .get("approval_id")
                                    .and_then(serde_json::Value::as_str)
                            });
                        if bid != Some(approval_id.as_str()) {
                            continue;
                        }
                        let should_update = object
                            .get("status")
                            .and_then(serde_json::Value::as_str)
                            .map(|v| v != "answered")
                            .unwrap_or(true);
                        if should_update {
                            object.insert(
                                "status".to_string(),
                                serde_json::Value::String("answered".to_string()),
                            );
                            any_changed = true;
                        }
                    }
                    any_changed
                } else {
                    false
                };
                if changed {
                    tx.execute(
                        "UPDATE messages SET blocks_json = ?1 WHERE id = ?2",
                        rusqlite::params![blocks_value.to_string(), message_id],
                    )
                    .context("failed to persist answered approval in message blocks")?;
                }
            }

            // Conditionally advance the thread status.
            if has_local_turn {
                tx.execute(
                    "UPDATE threads
                     SET status = ?1, last_activity_at = datetime('now')
                     WHERE id = ?2
                       AND status = ?3",
                    rusqlite::params![
                        ThreadStatusDto::Streaming.as_str(),
                        thread_id,
                        ThreadStatusDto::AwaitingApproval.as_str()
                    ],
                )
                .context("failed to conditionally update thread status")?;
            }

            tx.commit()
                .context("failed to commit approval resolution transaction")?;

            // Read the updated thread after the transaction has committed (non-atomic read is fine).
            let updated_thread = if has_local_turn {
                db::threads::get_thread(db, &thread_id)?
            } else {
                None
            };

            Ok(updated_thread)
        }
    })
    .await
    {
        Ok(updated_thread) => updated_thread,
        Err(error) => {
            log::warn!("failed to reconcile resolved runtime approval {approval_id}: {error}");
            return;
        }
    };

    let stream_event_topic = format!("stream-event-{thread_id}");
    let _ = app.emit(
        &stream_event_topic,
        serde_json::json!({
            "type": "ApprovalResolved",
            "approval_id": approval_id,
        }),
    );

    if let Some(thread) = updated_thread {
        let _ = app.emit(
            "thread-updated",
            ThreadUpdatedEvent {
                thread_id: thread.id.clone(),
                workspace_id: thread.workspace_id.clone(),
                thread: Some(thread),
            },
        );
    }
}

async fn apply_codex_runtime_thread_update(
    state: &AppState,
    engine_thread_id: &str,
    title: Option<&str>,
    raw_status: Option<&str>,
    active_flags: &[String],
    preview: Option<&str>,
    sync_required: Option<bool>,
    sync_reason: Option<&str>,
) -> Option<ThreadDto> {
    let thread = run_db(state.db.clone(), {
        let engine_thread_id = engine_thread_id.to_string();
        move |db| db::threads::find_thread_by_engine_thread_id(db, "codex", &engine_thread_id)
    })
    .await
    .ok()??;

    let has_local_turn = state.turns.get(&thread.id).await.is_some();
    let next_status = map_codex_runtime_status_to_local(raw_status, active_flags, has_local_turn);
    let metadata = merge_codex_runtime_metadata(
        thread.engine_metadata.clone(),
        raw_status,
        active_flags,
        preview,
        sync_required,
        sync_reason,
    );

    run_db(state.db.clone(), {
        let thread_id = thread.id.clone();
        let title = title.map(str::to_string);
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
    .ok()
}

async fn archive_codex_runtime_thread(
    state: &AppState,
    engine_thread_id: &str,
) -> Option<(String, String)> {
    let thread = run_db(state.db.clone(), {
        let engine_thread_id = engine_thread_id.to_string();
        move |db| db::threads::find_thread_by_engine_thread_id(db, "codex", &engine_thread_id)
    })
    .await
    .ok()??;

    run_db(state.db.clone(), {
        let thread_id = thread.id.clone();
        move |db| match db::threads::archive_thread(db, &thread_id) {
            Ok(()) => Ok(()),
            Err(error) if error.to_string().contains("already archived") => Ok(()),
            Err(error) => Err(error),
        }
    })
    .await
    .ok()?;

    Some((thread.id, thread.workspace_id))
}

async fn restore_codex_runtime_thread(
    state: &AppState,
    engine_thread_id: &str,
) -> Option<ThreadDto> {
    let thread = run_db(state.db.clone(), {
        let engine_thread_id = engine_thread_id.to_string();
        move |db| db::threads::find_thread_by_engine_thread_id(db, "codex", &engine_thread_id)
    })
    .await
    .ok()??;

    run_db(state.db.clone(), {
        let thread_id = thread.id.clone();
        let existing = thread.clone();
        move |db| match db::threads::restore_thread(db, &thread_id) {
            Ok(restored) => Ok(restored),
            Err(error) if error.to_string().contains("not archived") => Ok(existing),
            Err(error) => Err(error),
        }
    })
    .await
    .ok()
}

fn merge_codex_runtime_metadata(
    existing: Option<serde_json::Value>,
    raw_status: Option<&str>,
    active_flags: &[String],
    preview: Option<&str>,
    sync_required: Option<bool>,
    sync_reason: Option<&str>,
) -> serde_json::Value {
    let mut metadata = existing.unwrap_or_else(|| serde_json::json!({}));
    if !metadata.is_object() {
        metadata = serde_json::json!({});
    }

    if let Some(object) = metadata.as_object_mut() {
        if raw_status.is_some() {
            match raw_status.map(str::trim).filter(|value| !value.is_empty()) {
                Some(status) => {
                    object.insert("codexThreadStatus".to_string(), serde_json::json!(status));
                }
                None => {
                    object.remove("codexThreadStatus");
                }
            }

            if active_flags.is_empty() {
                object.remove("codexThreadActiveFlags");
            } else {
                object.insert(
                    "codexThreadActiveFlags".to_string(),
                    serde_json::json!(active_flags),
                );
            }
        }

        if preview.is_some() {
            match preview.map(str::trim).filter(|value| !value.is_empty()) {
                Some(preview) => {
                    object.insert("codexPreview".to_string(), serde_json::json!(preview));
                }
                None => {
                    object.remove("codexPreview");
                }
            }
        }

        if let Some(sync_required) = sync_required {
            object.insert(
                "codexSyncRequired".to_string(),
                serde_json::json!(sync_required),
            );
            object.insert(
                "codexSyncUpdatedAt".to_string(),
                serde_json::json!(chrono::Utc::now().to_rfc3339()),
            );
            match sync_reason.map(str::trim).filter(|value| !value.is_empty()) {
                Some(reason) => {
                    object.insert("codexSyncReason".to_string(), serde_json::json!(reason));
                }
                None => {
                    object.insert("codexSyncReason".to_string(), serde_json::Value::Null);
                }
            }
        }
    }

    metadata
}

fn map_codex_runtime_status_to_local(
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

async fn run_db<T, F>(db: crate::db::Database, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&crate::db::Database) -> anyhow::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || operation(&db))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

fn build_app_menu(handle: &tauri::AppHandle, locale: &str) -> tauri::Result<Menu<tauri::Wry>> {
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    {
        let _ = locale;
        return Menu::with_items(handle, &[]);
    }

    #[cfg(target_os = "macos")]
    {
        let strings = native_strings(locale);

        let app_menu = SubmenuBuilder::new(handle, strings.app_menu)
            .about(Some(AboutMetadata {
                name: Some("Panes".to_string()),
                version: Some(env!("CARGO_PKG_VERSION").to_string()),
                authors: Some(vec!["Wygor Alves".to_string()]),
                comments: Some(strings.about_comments.to_string()),
                copyright: Some("Copyright © 2026 Wygor Alves".to_string()),
                license: Some("MIT".to_string()),
                website: Some("https://github.com/wygoralves/panes".to_string()),
                website_label: Some("GitHub".to_string()),
                icon: match Image::from_bytes(include_bytes!("../icons/128x128@2x.png")) {
                    Ok(img) => Some(img),
                    Err(e) => {
                        log::warn!("failed to load about icon: {e}");
                        None
                    }
                },
                ..Default::default()
            }))
            .separator()
            .item(&PredefinedMenuItem::services(handle, None)?)
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;

        let edit_menu = SubmenuBuilder::new(handle, strings.edit_menu)
            .undo()
            .redo()
            .separator()
            .cut()
            .copy()
            .paste()
            .select_all()
            .build()?;

        let toggle_sidebar = MenuItem::with_id(
            handle,
            "toggle-sidebar",
            strings.toggle_sidebar,
            true,
            Some("CmdOrCtrl+B"),
        )?;
        let toggle_git_panel = MenuItem::with_id(
            handle,
            "toggle-git-panel",
            strings.toggle_git_panel,
            true,
            Some("CmdOrCtrl+Shift+B"),
        )?;
        let toggle_focus_mode = MenuItem::with_id(
            handle,
            "toggle-focus-mode",
            strings.toggle_focus_mode,
            true,
            Some("CmdOrCtrl+Alt+F"),
        )?;
        let toggle_fullscreen = MenuItem::with_id(
            handle,
            "toggle-fullscreen",
            strings.toggle_fullscreen,
            true,
            Some("F11"),
        )?;
        let toggle_search = MenuItem::with_id(
            handle,
            "toggle-search",
            strings.search,
            true,
            Some("CmdOrCtrl+Shift+F"),
        )?;
        let toggle_terminal = MenuItem::with_id(
            handle,
            "toggle-terminal",
            strings.toggle_terminal,
            true,
            Some("CmdOrCtrl+Shift+T"),
        )?;
        let view_menu = SubmenuBuilder::new(handle, strings.view_menu)
            .item(&toggle_sidebar)
            .item(&toggle_git_panel)
            .item(&toggle_focus_mode)
            .item(&toggle_fullscreen)
            .separator()
            .item(&toggle_search)
            .separator()
            .item(&toggle_terminal)
            .build()?;

        let close_window = MenuItem::with_id(
            handle,
            "close-window",
            strings.close,
            true,
            Some("CmdOrCtrl+W"),
        )?;
        let window_menu = SubmenuBuilder::new(handle, strings.window_menu)
            .minimize()
            .item(&PredefinedMenuItem::maximize(handle, None)?)
            .separator()
            .item(&close_window)
            .build()?;

        return Menu::with_items(handle, &[&app_menu, &edit_menu, &view_menu, &window_menu]);
    }

    #[allow(unreachable_code)]
    Menu::with_items(handle, &[])
}
