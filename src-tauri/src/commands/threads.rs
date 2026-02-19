use tauri::State;

use crate::{db, models::ThreadDto, state::AppState};

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

fn err_to_string(error: impl std::fmt::Display) -> String {
  error.to_string()
}
