#[cfg(target_os = "macos")]
use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
};

use crate::{
    config::app_config::AppConfig,
    locale::{normalize_app_locale, resolve_app_locale},
    state::AppState,
    terminal_notifications::{
        agent_notification_settings_status, install_terminal_notification_integration,
        parse_terminal_notification_integration_kind, show_agent_desktop_notification,
        AgentNotificationSettingsStatusDto,
    },
};
use tauri::State;
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;

fn err_to_string(error: impl ToString) -> String {
    error.to_string()
}

#[cfg(target_os = "macos")]
fn macos_sound_preview_process() -> &'static Mutex<Option<Child>> {
    static PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
    PROCESS.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "macos")]
fn stop_active_macos_sound_preview() -> Result<(), String> {
    let mut guard = macos_sound_preview_process()
        .lock()
        .map_err(|_| "notification sound preview lock poisoned".to_string())?;
    let Some(child) = guard.as_mut() else {
        return Ok(());
    };

    match child.try_wait().map_err(err_to_string)? {
        Some(_) => {
            *guard = None;
            Ok(())
        }
        None => {
            child.kill().map_err(err_to_string)?;
            let _ = child.wait();
            *guard = None;
            Ok(())
        }
    }
}

#[cfg(target_os = "macos")]
fn resolve_macos_notification_sound_path(sound: &str) -> Option<PathBuf> {
    let trimmed = sound.trim();
    if trimmed.is_empty() || trimmed == "none" {
        return None;
    }

    let direct_path = Path::new(trimmed);
    if direct_path.is_absolute() && direct_path.is_file() {
        return Some(direct_path.to_path_buf());
    }

    let mut search_dirs = Vec::with_capacity(3);
    if let Some(home) = std::env::var_os("HOME") {
        search_dirs.push(PathBuf::from(home).join("Library/Sounds"));
    }
    search_dirs.push(PathBuf::from("/Library/Sounds"));
    search_dirs.push(PathBuf::from("/System/Library/Sounds"));

    const SOUND_EXTENSIONS: [&str; 4] = ["", ".aiff", ".wav", ".caf"];
    for dir in search_dirs {
        for extension in SOUND_EXTENSIONS {
            let candidate = dir.join(format!("{trimmed}{extension}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn preview_notification_sound_macos(sound: &str) -> Result<(), String> {
    if sound.trim().is_empty() || sound.trim() == "none" {
        return stop_active_macos_sound_preview();
    }

    let sound_path = resolve_macos_notification_sound_path(sound)
        .ok_or_else(|| format!("unknown notification sound: {sound}"))?;

    stop_active_macos_sound_preview()?;

    let child = Command::new("/usr/bin/afplay")
        .arg(sound_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(err_to_string)?;

    let mut guard = macos_sound_preview_process()
        .lock()
        .map_err(|_| "notification sound preview lock poisoned".to_string())?;
    *guard = Some(child);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn preview_notification_sound_via_notification(
    app: tauri::AppHandle,
    sound: &str,
) -> Result<(), String> {
    let mut notification = app
        .notification()
        .builder()
        .title("Panes")
        .body("Notification sound preview");
    if sound != "none" && !sound.is_empty() {
        notification = notification.sound(sound);
    }
    notification.show().map_err(err_to_string)
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
pub async fn get_agent_notification_settings() -> Result<AgentNotificationSettingsStatusDto, String>
{
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
        let parsed =
            parse_terminal_notification_integration_kind(&integration).map_err(err_to_string)?;
        install_terminal_notification_integration(parsed).map_err(err_to_string)
    })
    .await
    .map_err(err_to_string)?
}

#[tauri::command]
pub async fn set_notification_sound(
    state: State<'_, AppState>,
    sound: String,
) -> Result<String, String> {
    let config_write_lock = state.config_write_lock.clone();
    let _guard = config_write_lock.lock_owned().await;

    tokio::task::spawn_blocking(move || -> Result<String, String> {
        AppConfig::mutate(|config| {
            config.general.notification_sound = if sound == "none" || sound.is_empty() {
                Some("none".to_string())
            } else {
                Some(sound.clone())
            };
            Ok(sound)
        })
        .map_err(err_to_string)
    })
    .await
    .map_err(err_to_string)?
}

#[tauri::command]
pub async fn preview_notification_sound(
    app: tauri::AppHandle,
    sound: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        return tokio::task::spawn_blocking(move || preview_notification_sound_macos(&sound))
            .await
            .map_err(err_to_string)?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        preview_notification_sound_via_notification(app, &sound)
    }
}

#[tauri::command]
pub async fn show_agent_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    show_agent_desktop_notification(&app, &title, &body).map_err(err_to_string)
}
