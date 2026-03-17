use std::sync::Arc;

use anyhow::Context;

use crate::{
    config::app_config::AppConfig,
    db::{self, Database},
    engines::EngineManager,
    git::{repo::FileTreeCache, watcher::GitWatcherManager},
    power::KeepAwakeManager,
    remote::server::RemoteHostManager,
    state::{AppState, TurnManager},
    terminal::TerminalManager,
};

pub fn create_app_state() -> anyhow::Result<AppState> {
    let db = Database::init().context("failed to initialize database")?;
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

    let app_config = AppConfig::load_or_create().context("failed to load config")?;
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

    let _ = db::workspaces::ensure_default_workspace(&db)
        .context("failed to ensure default workspace")?;
    let remote_host = Arc::new(RemoteHostManager::new(db.clone()));

    Ok(AppState {
        db,
        config: Arc::new(app_config),
        config_write_lock: Arc::new(tokio::sync::Mutex::new(())),
        engines: Arc::new(EngineManager::new()),
        git_watchers: Arc::new(GitWatcherManager::default()),
        terminals: Arc::new(TerminalManager::default()),
        remote_host,
        keep_awake,
        turns: Arc::new(TurnManager::default()),
        file_tree_cache: Arc::new(FileTreeCache::new()),
    })
}

pub async fn shutdown_app_state(state: &AppState) {
    if let Err(error) = state.keep_awake.shutdown().await {
        log::warn!("failed to release keep awake on shutdown: {error}");
    }
    if let Err(error) = state.remote_host.stop().await {
        log::warn!("failed to stop remote host on shutdown: {error}");
    }
    state.terminals.shutdown().await;
}
