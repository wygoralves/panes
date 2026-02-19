mod commands;
mod config;
mod db;
mod engines;
mod git;
mod models;
mod state;

use std::sync::Arc;

use config::app_config::AppConfig;
use db::Database;
use engines::EngineManager;
use git::watcher::GitWatcherManager;
use state::{AppState, TurnManager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    let db = Database::init().expect("failed to initialize database");
    let app_config = AppConfig::load_or_create().expect("failed to load config");

    let workspace =
        db::workspaces::ensure_default_workspace(&db).expect("failed to ensure default workspace");
    db::threads::ensure_workspace_thread(
        &db,
        &workspace.id,
        &app_config.general.default_engine,
        &app_config.general.default_model,
    )
    .expect("failed to ensure workspace thread");

    let app_state = AppState {
        db,
        config: Arc::new(app_config),
        engines: Arc::new(EngineManager::new()),
        git_watchers: Arc::new(GitWatcherManager::default()),
        turns: Arc::new(TurnManager::default()),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::chat::send_message,
            commands::chat::cancel_turn,
            commands::chat::respond_to_approval,
            commands::chat::get_thread_messages,
            commands::chat::search_messages,
            commands::workspace::open_workspace,
            commands::workspace::list_workspaces,
            commands::workspace::get_repos,
            commands::workspace::set_repo_trust_level,
            commands::git::get_git_status,
            commands::git::get_file_diff,
            commands::git::stage_files,
            commands::git::unstage_files,
            commands::git::commit,
            commands::git::get_file_tree,
            commands::git::watch_git_repo,
            commands::engines::list_engines,
            commands::engines::engine_health,
            commands::threads::list_threads,
            commands::threads::create_thread,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
