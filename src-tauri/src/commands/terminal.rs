use tauri::State;

use crate::{
    db,
    models::{TerminalRendererDiagnosticsDto, TerminalSessionDto},
    state::AppState,
};

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
pub async fn terminal_create_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    cols: u16,
    rows: u16,
) -> Result<TerminalSessionDto, String> {
    let cwd = workspace_root_path(state.inner(), &workspace_id).await?;
    state
        .terminals
        .create_session(app, workspace_id, cwd, cols.max(1), rows.max(1))
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn terminal_write(
    state: State<'_, AppState>,
    workspace_id: String,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state
        .terminals
        .write(&workspace_id, &session_id, data)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn terminal_write_bytes(
    state: State<'_, AppState>,
    workspace_id: String,
    session_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    state
        .terminals
        .write_bytes(&workspace_id, &session_id, data)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, AppState>,
    workspace_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
    pixel_width: u16,
    pixel_height: u16,
) -> Result<(), String> {
    state
        .terminals
        .resize(
            &workspace_id,
            &session_id,
            cols.max(1),
            rows.max(1),
            pixel_width,
            pixel_height,
        )
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn terminal_close_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
    session_id: String,
) -> Result<(), String> {
    state
        .terminals
        .close_session(app, &workspace_id, &session_id)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn terminal_close_workspace_sessions(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<(), String> {
    state
        .terminals
        .close_workspace(app, &workspace_id)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn terminal_list_sessions(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<TerminalSessionDto>, String> {
    Ok(state.terminals.list_sessions(&workspace_id).await)
}

#[tauri::command]
pub async fn terminal_get_renderer_diagnostics(
    state: State<'_, AppState>,
    workspace_id: String,
    session_id: String,
) -> Result<TerminalRendererDiagnosticsDto, String> {
    state
        .terminals
        .renderer_diagnostics(&workspace_id, &session_id)
        .await
        .map_err(err_to_string)
}

async fn workspace_root_path(state: &AppState, workspace_id: &str) -> Result<String, String> {
    run_db(state.db.clone(), {
        let workspace_id = workspace_id.to_string();
        move |db| {
            db::workspaces::list_workspaces(db)?
                .into_iter()
                .find(|workspace| workspace.id == workspace_id)
                .map(|workspace| workspace.root_path)
                .ok_or_else(|| anyhow::anyhow!("workspace not found: {workspace_id}"))
        }
    })
    .await
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}
