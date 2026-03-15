use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{
    config::app_config::{AppConfig, PowerConfig},
    power::KeepAwakeStatus,
    state::AppState,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeepAwakeStateDto {
    pub supported: bool,
    pub enabled: bool,
    pub active: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_closed_display: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_display_active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    pub display_sleep_prevented: bool,
    pub screen_saver_prevented: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_ac_power: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub battery_percent: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_remaining_secs: Option<u64>,
    pub paused_due_to_battery: bool,
    pub closed_display_sleep_disabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerSettingsDto {
    pub keep_awake_enabled: bool,
    pub prevent_display_sleep: bool,
    pub prevent_screen_saver: bool,
    pub ac_only_mode: bool,
    pub battery_threshold: Option<u8>,
    pub session_duration_secs: Option<u64>,
    pub prevent_closed_display_sleep: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerSettingsInput {
    pub keep_awake_enabled: bool,
    pub prevent_display_sleep: bool,
    pub prevent_screen_saver: bool,
    pub ac_only_mode: bool,
    pub battery_threshold: Option<u8>,
    pub session_duration_secs: Option<u64>,
    pub prevent_closed_display_sleep: bool,
}

#[tauri::command]
pub async fn get_keep_awake_state(state: State<'_, AppState>) -> Result<KeepAwakeStateDto, String> {
    let enabled = load_power_config().await?.keep_awake_enabled;
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

        // Load full config to respect all power settings
        let mut config = load_power_config().await?;
        config.keep_awake_enabled = true;
        state.keep_awake.enable_with_config(&config).await?;

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
            // Rollback: reload full config to preserve the user's profile
            let rollback_config = load_power_config().await.ok();

            let rollback_result = if let Some(mut config) = rollback_config {
                config.keep_awake_enabled = true;
                state.keep_awake.enable_with_config(&config).await
            } else {
                state.keep_awake.enable().await
            };

            match rollback_result {
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

#[tauri::command]
pub async fn get_power_settings(_state: State<'_, AppState>) -> Result<PowerSettingsDto, String> {
    let config = load_power_config().await?;

    Ok(PowerSettingsDto {
        keep_awake_enabled: config.keep_awake_enabled,
        prevent_display_sleep: config.prevent_display_sleep,
        prevent_screen_saver: config.prevent_screen_saver,
        ac_only_mode: config.ac_only_mode,
        battery_threshold: config.battery_threshold,
        session_duration_secs: config.session_duration_secs,
        prevent_closed_display_sleep: config.prevent_closed_display_sleep,
    })
}

#[tauri::command]
pub async fn set_power_settings(
    state: State<'_, AppState>,
    settings: PowerSettingsInput,
) -> Result<KeepAwakeStateDto, String> {
    // Validate battery threshold
    if let Some(threshold) = settings.battery_threshold {
        if threshold == 0 || threshold >= 100 {
            return Err("battery threshold must be between 1 and 99".to_string());
        }
    }

    let previous_config = load_power_config().await?;
    let next_config = PowerConfig {
        keep_awake_enabled: settings.keep_awake_enabled,
        prevent_display_sleep: settings.prevent_display_sleep,
        prevent_screen_saver: settings.prevent_screen_saver,
        ac_only_mode: settings.ac_only_mode,
        battery_threshold: settings.battery_threshold,
        session_duration_secs: settings.session_duration_secs,
        prevent_closed_display_sleep: settings.prevent_closed_display_sleep,
    };

    // Apply runtime changes first so persistence cannot leave disk and runtime
    // diverged on partial failure.
    state.keep_awake.disable().await?;

    if next_config.keep_awake_enabled {
        if let Err(error) = state.keep_awake.enable_with_config(&next_config).await {
            rollback_power_runtime(&state, &previous_config)
                .await
                .map_err(|rollback_error| {
                    format!(
                        "failed to apply power settings at runtime: {error}; failed to restore previous runtime state: {rollback_error}"
                    )
                })?;
            return Err(format!(
                "failed to apply power settings at runtime: {error}; previous runtime state restored"
            ));
        }
    }

    if let Err(error) = save_power_config(next_config).await {
        rollback_power_runtime(&state, &previous_config)
            .await
            .map_err(|rollback_error| {
                format!(
                    "failed to persist power settings: {error}; failed to restore previous runtime state: {rollback_error}"
                )
            })?;
        return Err(format!(
            "failed to persist power settings: {error}; previous runtime state restored"
        ));
    }

    let runtime = state.keep_awake.status().await;
    Ok(dto_from_runtime(runtime, settings.keep_awake_enabled))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperStatusDto {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[tauri::command]
pub async fn get_helper_status() -> Result<HelperStatusDto, String> {
    #[cfg(target_os = "macos")]
    {
        let status = tokio::task::spawn_blocking(|| {
            crate::power::macos_helper::helper_status()
        })
        .await
        .map_err(err_to_string)?;

        Ok(HelperStatusDto {
            status: status.as_str().to_string(),
            message: if let crate::power::macos_helper::HelperStatus::Unknown(msg) = &status {
                Some(msg.clone())
            } else {
                None
            },
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(HelperStatusDto {
            status: "notSupported".to_string(),
            message: None,
        })
    }
}

#[tauri::command]
pub async fn register_keep_awake_helper() -> Result<HelperStatusDto, String> {
    #[cfg(target_os = "macos")]
    {
        let result = tokio::task::spawn_blocking(|| {
            crate::power::macos_helper::register_helper()
        })
        .await
        .map_err(err_to_string)?;

        match result {
            Ok(status) => Ok(HelperStatusDto {
                status: status.as_str().to_string(),
                message: None,
            }),
            Err(error) => {
                // When running outside a signed .app bundle (dev mode), SMAppService
                // fails with a codesigning error.  Return a descriptive message so
                // the UI can guide the user toward the pmset fallback.
                if error.contains("Codesigning failure") || error.contains("notFound") {
                    return Ok(HelperStatusDto {
                        status: "notFound".to_string(),
                        message: Some(
                            "Helper registration requires a signed app bundle. \
                             The lid-close feature will use a password prompt instead."
                                .to_string(),
                        ),
                    });
                }
                Err(error)
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        Err("helper registration is only supported on macOS".to_string())
    }
}

async fn load_power_config() -> Result<PowerConfig, String> {
    tokio::task::spawn_blocking(|| AppConfig::load_or_create().map(|config| config.power))
        .await
        .map_err(err_to_string)?
        .map_err(err_to_string)
}

async fn save_enabled_preference(enabled: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        AppConfig::mutate(|config| {
            config.power.keep_awake_enabled = enabled;
            Ok(())
        })
        .map_err(err_to_string)
    })
    .await
    .map_err(err_to_string)?
}

async fn save_power_config(power_config: PowerConfig) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        AppConfig::mutate(|config| {
            config.power = power_config;
            Ok(())
        })
        .map_err(err_to_string)
    })
    .await
    .map_err(err_to_string)?
}

async fn rollback_power_runtime(
    state: &State<'_, AppState>,
    previous_config: &PowerConfig,
) -> Result<(), String> {
    if previous_config.keep_awake_enabled {
        state.keep_awake.enable_with_config(previous_config).await
    } else {
        state.keep_awake.disable().await
    }
}

fn dto_from_runtime(status: KeepAwakeStatus, enabled: bool) -> KeepAwakeStateDto {
    KeepAwakeStateDto {
        supported: status.supported,
        enabled,
        active: status.active,
        supports_closed_display: status.supports_closed_display,
        closed_display_active: status.closed_display_active,
        message: status.message,
        display_sleep_prevented: status.display_sleep_prevented,
        screen_saver_prevented: status.screen_saver_prevented,
        on_ac_power: status.on_ac_power,
        battery_percent: status.battery_percent,
        session_remaining_secs: status.session_remaining_secs,
        paused_due_to_battery: status.paused_due_to_battery,
        closed_display_sleep_disabled: status.closed_display_sleep_disabled,
    }
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use uuid::Uuid;

    const APP_DATA_ENV_VARS: [&str; 4] = ["HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA"];

    fn with_temp_app_data_env<T>(f: impl FnOnce() -> T) -> T {
        let _guard = crate::config::app_config::app_data_env_lock()
            .lock()
            .expect("env lock poisoned");
        let previous: Vec<(&str, Option<std::ffi::OsString>)> = APP_DATA_ENV_VARS
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();
        let root = std::env::temp_dir().join(format!("panes-keep-awake-home-{}", Uuid::new_v4()));
        let local_app_data = root.join("AppData").join("Local");
        let roaming_app_data = root.join("AppData").join("Roaming");
        fs::create_dir_all(&local_app_data).expect("failed to create temp local app data");
        fs::create_dir_all(&roaming_app_data).expect("failed to create temp roaming app data");
        std::env::set_var("HOME", &root);
        std::env::set_var("USERPROFILE", &root);
        std::env::set_var("LOCALAPPDATA", &local_app_data);
        std::env::set_var("APPDATA", &roaming_app_data);
        let result = f();
        for (key, value) in previous {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
        let _ = fs::remove_dir_all(&root);
        result
    }

    #[test]
    fn save_enabled_preference_updates_power_section() {
        with_temp_app_data_env(|| {
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

    #[test]
    fn dto_from_runtime_preserves_closed_display_state() {
        let dto = dto_from_runtime(
            KeepAwakeStatus {
                supported: true,
                active: true,
                supports_closed_display: Some(false),
                closed_display_active: Some(false),
                message: Some("limited".to_string()),
                display_sleep_prevented: true,
                screen_saver_prevented: false,
                on_ac_power: Some(true),
                battery_percent: Some(87),
                session_remaining_secs: Some(1800),
                paused_due_to_battery: false,
                closed_display_sleep_disabled: false,
            },
            true,
        );

        assert!(dto.supported);
        assert!(dto.enabled);
        assert!(dto.active);
        assert_eq!(dto.supports_closed_display, Some(false));
        assert_eq!(dto.closed_display_active, Some(false));
        assert_eq!(dto.message.as_deref(), Some("limited"));
        assert!(dto.display_sleep_prevented);
        assert!(!dto.screen_saver_prevented);
        assert_eq!(dto.on_ac_power, Some(true));
        assert_eq!(dto.battery_percent, Some(87));
        assert_eq!(dto.session_remaining_secs, Some(1800));
        assert!(!dto.paused_due_to_battery);
    }

    #[test]
    fn set_power_settings_saves_all_fields() {
        with_temp_app_data_env(|| {
            let runtime = tokio::runtime::Runtime::new().expect("runtime should build");
            runtime.block_on(async {
                tokio::task::spawn_blocking(|| {
                    AppConfig::mutate(|config| {
                        config.power.keep_awake_enabled = true;
                        config.power.prevent_display_sleep = true;
                        config.power.prevent_screen_saver = true;
                        config.power.ac_only_mode = true;
                        config.power.battery_threshold = Some(20);
                        config.power.session_duration_secs = Some(3600);
                        config.power.prevent_closed_display_sleep = true;
                        Ok(())
                    })
                })
                .await
                .expect("task should complete")
                .expect("mutate should succeed");

                let config = AppConfig::load_or_create().expect("config should load");
                assert!(config.power.keep_awake_enabled);
                assert!(config.power.prevent_display_sleep);
                assert!(config.power.prevent_screen_saver);
                assert!(config.power.ac_only_mode);
                assert_eq!(config.power.battery_threshold, Some(20));
                assert_eq!(config.power.session_duration_secs, Some(3600));
                assert!(config.power.prevent_closed_display_sleep);
            });
        });
    }
}
