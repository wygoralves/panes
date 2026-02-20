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

    let _ =
        db::workspaces::ensure_default_workspace(&db).expect("failed to ensure default workspace");

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
            commands::workspace::list_archived_workspaces,
            commands::workspace::get_repos,
            commands::workspace::set_repo_trust_level,
            commands::workspace::set_repo_git_active,
            commands::workspace::set_workspace_git_active_repos,
            commands::workspace::has_workspace_git_selection,
            commands::workspace::archive_workspace,
            commands::workspace::restore_workspace,
            commands::workspace::delete_workspace,
            commands::git::get_git_status,
            commands::git::get_file_diff,
            commands::git::stage_files,
            commands::git::unstage_files,
            commands::git::commit,
            commands::git::fetch_git,
            commands::git::pull_git,
            commands::git::push_git,
            commands::git::list_git_branches,
            commands::git::checkout_git_branch,
            commands::git::create_git_branch,
            commands::git::rename_git_branch,
            commands::git::delete_git_branch,
            commands::git::list_git_commits,
            commands::git::list_git_stashes,
            commands::git::apply_git_stash,
            commands::git::pop_git_stash,
            commands::git::get_file_tree,
            commands::git::get_file_tree_page,
            commands::git::watch_git_repo,
            commands::engines::list_engines,
            commands::engines::engine_health,
            commands::threads::list_threads,
            commands::threads::list_archived_threads,
            commands::threads::create_thread,
            commands::threads::rename_thread,
            commands::threads::confirm_workspace_thread,
            commands::threads::set_thread_reasoning_effort,
            commands::threads::archive_thread,
            commands::threads::restore_thread,
            commands::threads::delete_thread,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
