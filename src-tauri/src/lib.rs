mod commands;
mod config;
mod db;
mod engines;
mod fs_ops;
mod git;
mod models;
mod state;
mod terminal;

use std::sync::Arc;

use config::app_config::AppConfig;
use db::Database;
use engines::EngineManager;
use git::watcher::GitWatcherManager;
use state::{AppState, TurnManager};
use tauri::{
    image::Image,
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, SubmenuBuilder},
    Emitter,
};
use terminal::TerminalManager;

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
        terminals: Arc::new(TerminalManager::default()),
        turns: Arc::new(TurnManager::default()),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(app_state)
        .menu(build_app_menu)
        .setup(|app| {
            let handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                let id = event.id().as_ref();
                match id {
                    "toggle-sidebar" | "toggle-git-panel" | "toggle-search" | "toggle-terminal"
                    | "close-window" => {
                        let _ = handle.emit("menu-action", id);
                    }
                    _ => {}
                }
            });
            Ok(())
        })
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
            commands::git::discard_files,
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
            commands::git::get_commit_diff,
            commands::git::list_git_stashes,
            commands::git::push_git_stash,
            commands::git::apply_git_stash,
            commands::git::pop_git_stash,
            commands::git::get_file_tree,
            commands::git::get_file_tree_page,
            commands::files::list_dir,
            commands::files::read_file,
            commands::files::write_file,
            commands::git::watch_git_repo,
            commands::engines::list_engines,
            commands::engines::engine_health,
            commands::engines::run_engine_check,
            commands::threads::list_threads,
            commands::threads::list_archived_threads,
            commands::threads::create_thread,
            commands::threads::rename_thread,
            commands::threads::confirm_workspace_thread,
            commands::threads::set_thread_reasoning_effort,
            commands::threads::archive_thread,
            commands::threads::restore_thread,
            commands::threads::delete_thread,
            commands::terminal::terminal_create_session,
            commands::terminal::terminal_write,
            commands::terminal::terminal_write_bytes,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_close_session,
            commands::terminal::terminal_close_workspace_sessions,
            commands::terminal::terminal_list_sessions,
            commands::setup::check_dependencies,
            commands::setup::install_dependency,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_app_menu(handle: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let app_menu = SubmenuBuilder::new(handle, "Panes")
        .about(Some(AboutMetadata {
            name: Some("Panes".to_string()),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
            authors: Some(vec!["Wygor Alves".to_string()]),
            comments: Some("The open-source cockpit for AI-assisted coding".to_string()),
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

    let edit_menu = SubmenuBuilder::new(handle, "Edit")
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
        "Toggle Sidebar",
        true,
        Some("CmdOrCtrl+B"),
    )?;
    let toggle_git_panel = MenuItem::with_id(
        handle,
        "toggle-git-panel",
        "Toggle Git Panel",
        true,
        Some("CmdOrCtrl+Shift+B"),
    )?;
    let toggle_search = MenuItem::with_id(
        handle,
        "toggle-search",
        "Search",
        true,
        Some("CmdOrCtrl+Shift+F"),
    )?;
    let toggle_terminal = MenuItem::with_id(
        handle,
        "toggle-terminal",
        "Toggle Terminal",
        true,
        Some("CmdOrCtrl+Shift+T"),
    )?;
    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(&toggle_sidebar)
        .item(&toggle_git_panel)
        .separator()
        .item(&toggle_search)
        .separator()
        .item(&toggle_terminal)
        .build()?;

    let close_window =
        MenuItem::with_id(handle, "close-window", "Close", true, Some("CmdOrCtrl+W"))?;
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .item(&PredefinedMenuItem::maximize(handle, None)?)
        .separator()
        .item(&close_window)
        .build()?;

    Menu::with_items(handle, &[&app_menu, &edit_menu, &view_menu, &window_menu])
}
