use tauri::State;

use crate::{
  models::{EngineHealthDto, EngineInfoDto},
  state::AppState,
};

#[tauri::command]
pub async fn list_engines(state: State<'_, AppState>) -> Result<Vec<EngineInfoDto>, String> {
  state.engines.list_engines().await.map_err(err_to_string)
}

#[tauri::command]
pub async fn engine_health(
  state: State<'_, AppState>,
  engine_id: String,
) -> Result<EngineHealthDto, String> {
  state.engines.health(&engine_id).await.map_err(err_to_string)
}

fn err_to_string(error: impl std::fmt::Display) -> String {
  error.to_string()
}
