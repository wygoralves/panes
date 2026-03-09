use serde::Serialize;
use tauri::State;

use crate::{config::app_config::AppConfig, power::KeepAwakeStatus, state::AppState};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepAwakeStateDto {
    pub supported: bool,
    pub enabled: bool,
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[tauri::command]
pub async fn get_keep_awake_state(state: State<'_, AppState>) -> Result<KeepAwakeStateDto, String> {
    let enabled = tokio::task::spawn_blocking(|| {
        AppConfig::load_or_create().map(|config| config.power.keep_awake_enabled)
    })
    .await
    .map_err(err_to_string)?
    .map_err(err_to_string)?;
    let runtime = state.keep_awake.status().await;

    Ok(dto_from_runtime(runtime, enabled))
}

#[tauri::command]
pub async fn set_keep_awake_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<KeepAwakeStateDto, String> {
    if enabled {
        let current = state.keep_awake.status().await;
        if !current.supported {
            return Ok(dto_from_runtime(current, false));
        }
    }

    if enabled {
        state.keep_awake.enable().await?;
        if let Err(error) = save_enabled_preference(true).await {
            match state.keep_awake.disable().await {
                Ok(()) => {
                    return Err(format!(
                        "failed to persist keep awake preference after enabling: {error}; runtime state reverted"
                    ));
                }
                Err(rollback_error) => {
                    return Err(format!(
                        "failed to persist keep awake preference after enabling: {error}; failed to roll back runtime state: {rollback_error}"
                    ));
                }
            }
        }
    } else {
        state.keep_awake.disable().await?;
        if let Err(error) = save_enabled_preference(false).await {
            match state.keep_awake.enable().await {
                Ok(()) => {
                    return Err(format!(
                        "failed to persist keep awake preference after disabling: {error}; runtime state reverted"
                    ));
                }
                Err(rollback_error) => {
                    return Err(format!(
                        "failed to persist keep awake preference after disabling: {error}; failed to roll back runtime state: {rollback_error}"
                    ));
                }
            }
        }
    }

    let runtime = state.keep_awake.status().await;
    Ok(dto_from_runtime(runtime, enabled))
}

async fn save_enabled_preference(enabled: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let mut config = AppConfig::load_or_create().map_err(err_to_string)?;
        config.power.keep_awake_enabled = enabled;
        config.save().map_err(err_to_string)
    })
    .await
    .map_err(err_to_string)?
}

fn dto_from_runtime(status: KeepAwakeStatus, enabled: bool) -> KeepAwakeStateDto {
    KeepAwakeStateDto {
        supported: status.supported,
        enabled,
        active: status.active,
        message: status.message,
    }
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{Mutex, OnceLock},
    };

    use super::*;
    use uuid::Uuid;

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn with_temp_home<T>(f: impl FnOnce() -> T) -> T {
        let _guard = env_lock().lock().expect("env lock poisoned");
        let previous = std::env::var_os("HOME");
        let root = std::env::temp_dir().join(format!("panes-keep-awake-home-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("failed to create temp home");
        std::env::set_var("HOME", &root);
        let result = f();
        match previous {
            Some(value) => std::env::set_var("HOME", value),
            None => std::env::remove_var("HOME"),
        }
        result
    }

    #[test]
    fn save_enabled_preference_updates_power_section() {
        with_temp_home(|| {
            let runtime = tokio::runtime::Runtime::new().expect("runtime should build");
            runtime.block_on(async {
                save_enabled_preference(true)
                    .await
                    .expect("preference should save");

                let config = AppConfig::load_or_create().expect("config should load");
                assert!(config.power.keep_awake_enabled);
            });
        });
    }
}
