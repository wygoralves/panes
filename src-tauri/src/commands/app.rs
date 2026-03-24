use crate::{
    config::app_config::AppConfig,
    locale::{normalize_app_locale, resolve_app_locale},
    state::AppState,
    terminal_notifications::{
        agent_notification_settings_status, show_agent_desktop_notification,
        install_terminal_notification_integration, parse_terminal_notification_integration_kind,
        AgentNotificationSettingsStatusDto,
    },
};
use tauri::State;

fn err_to_string(error: impl ToString) -> String {
    error.to_string()
}

#[tauri::command]
pub async fn get_app_locale() -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let config = AppConfig::load_or_create().map_err(err_to_string)?;
        Ok(resolve_app_locale(config.general.locale.as_deref()).to_string())
    })
    .await
    .map_err(err_to_string)?
}

#[tauri::command]
pub async fn set_app_locale(state: State<'_, AppState>, locale: String) -> Result<String, String> {
    let config_write_lock = state.config_write_lock.clone();
    let _guard = config_write_lock.lock_owned().await;

    tokio::task::spawn_blocking(move || {
        let normalized =
            normalize_app_locale(&locale).ok_or_else(|| format!("unsupported locale: {locale}"))?;
        AppConfig::mutate(|config| {
            config.general.locale = Some(normalized.to_string());
            Ok(normalized.to_string())
        })
        .map_err(err_to_string)
    })
    .await
    .map_err(err_to_string)?
}

#[tauri::command]
pub async fn get_terminal_accelerated_rendering() -> Result<bool, String> {
    tokio::task::spawn_blocking(move || {
        let config = AppConfig::load_or_create().map_err(err_to_string)?;
        Ok(config.terminal_accelerated_rendering_enabled())
    })
    .await
    .map_err(err_to_string)?
}

#[tauri::command]
pub async fn set_terminal_accelerated_rendering(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<bool, String> {
    let config_write_lock = state.config_write_lock.clone();
    let _guard = config_write_lock.lock_owned().await;

    tokio::task::spawn_blocking(move || -> Result<bool, String> {
        let mut config = AppConfig::load_or_create().map_err(err_to_string)?;
        config.general.terminal_accelerated_rendering = if enabled { None } else { Some(false) };
        config.save().map_err(err_to_string)?;
        Ok(enabled)
    })
    .await
    .map_err(err_to_string)?
}

#[tauri::command]
pub async fn get_agent_notification_settings() -> Result<AgentNotificationSettingsStatusDto, String> {
    tokio::task::spawn_blocking(agent_notification_settings_status)
        .await
        .map_err(err_to_string)?
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn set_chat_notifications_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<bool, String> {
    let config_write_lock = state.config_write_lock.clone();
    let _guard = config_write_lock.lock_owned().await;

    tokio::task::spawn_blocking(move || -> Result<bool, String> {
        let mut config = AppConfig::load_or_create().map_err(err_to_string)?;
        config.general.chat_notifications = if enabled { Some(true) } else { None };
        config.save().map_err(err_to_string)?;
        Ok(enabled)
    })
    .await
    .map_err(err_to_string)?
}

#[tauri::command]
pub async fn set_terminal_notifications_enabled(
    state: State<'_, AppState>,
    enabled: bool,
) -> Result<bool, String> {
    let config_write_lock = state.config_write_lock.clone();
    let _guard = config_write_lock.lock_owned().await;

    tokio::task::spawn_blocking(move || -> Result<bool, String> {
        let mut config = AppConfig::load_or_create().map_err(err_to_string)?;
        config.general.terminal_notifications = if enabled { Some(true) } else { None };
        config.save().map_err(err_to_string)?;
        Ok(enabled)
    })
    .await
    .map_err(err_to_string)?
}

#[tauri::command]
pub async fn install_terminal_notification_integration_command(
    integration: String,
) -> Result<AgentNotificationSettingsStatusDto, String> {
    tokio::task::spawn_blocking(move || {
        let parsed = parse_terminal_notification_integration_kind(&integration)
            .map_err(err_to_string)?;
        install_terminal_notification_integration(parsed).map_err(err_to_string)
    })
    .await
    .map_err(err_to_string)?
}

#[tauri::command]
pub async fn show_agent_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    show_agent_desktop_notification(&app, &title, &body).map_err(err_to_string)
}
