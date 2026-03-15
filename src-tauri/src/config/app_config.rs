use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, MutexGuard, OnceLock},
};

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::runtime_env;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub general: GeneralConfig,
    pub ui: UiConfig,
    pub debug: DebugConfig,
    pub power: PowerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GeneralConfig {
    pub theme: String,
    pub default_engine: String,
    pub default_model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_accelerated_rendering: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UiConfig {
    pub sidebar_width: u32,
    pub git_panel_width: u32,
    pub font_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct DebugConfig {
    pub persist_engine_event_logs: bool,
    pub max_action_output_chars: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct PowerConfig {
    pub keep_awake_enabled: bool,
    pub prevent_display_sleep: bool,
    pub prevent_screen_saver: bool,
    pub ac_only_mode: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub battery_threshold: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_duration_secs: Option<u64>,
    pub prevent_closed_display_sleep: bool,
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            default_engine: "codex".to_string(),
            default_model: "gpt-5.3-codex".to_string(),
            locale: None,
            terminal_accelerated_rendering: None,
        }
    }
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            sidebar_width: 260,
            git_panel_width: 380,
            font_size: 13,
        }
    }
}

impl Default for DebugConfig {
    fn default() -> Self {
        Self {
            persist_engine_event_logs: false,
            max_action_output_chars: 20_000,
        }
    }
}

impl Default for PowerConfig {
    fn default() -> Self {
        Self {
            keep_awake_enabled: false,
            prevent_display_sleep: false,
            prevent_screen_saver: false,
            ac_only_mode: false,
            battery_threshold: None,
            session_duration_secs: None,
            prevent_closed_display_sleep: false,
        }
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            general: GeneralConfig::default(),
            ui: UiConfig::default(),
            debug: DebugConfig::default(),
            power: PowerConfig::default(),
        }
    }
}

impl AppConfig {
    pub fn terminal_accelerated_rendering_enabled(&self) -> bool {
        self.general.terminal_accelerated_rendering.unwrap_or(true)
    }

    pub fn load_or_create() -> anyhow::Result<Self> {
        let _guard = lock_config()?;
        Self::load_or_create_unlocked()
    }

    #[allow(dead_code)]
    pub fn save(&self) -> anyhow::Result<()> {
        let _guard = lock_config()?;
        self.save_unlocked()
    }

    pub fn mutate<T>(f: impl FnOnce(&mut Self) -> anyhow::Result<T>) -> anyhow::Result<T> {
        let _guard = lock_config()?;
        let mut config = Self::load_or_create_unlocked()?;
        let result = f(&mut config)?;
        config.save_unlocked()?;
        Ok(result)
    }

    fn load_or_create_unlocked() -> anyhow::Result<Self> {
        runtime_env::migrate_legacy_app_data_dir()
            .context("failed to migrate legacy app data dir")?;
        let path = Self::path();

        if !path.exists() {
            let config = Self::default();
            config.save_unlocked()?;
            return Ok(config);
        }

        let raw = fs::read_to_string(&path)?;
        let config = toml::from_str::<Self>(&raw).unwrap_or_default();
        Ok(config)
    }

    fn save_unlocked(&self) -> anyhow::Result<()> {
        let path = Self::path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let raw = toml::to_string_pretty(self)?;
        let temp_path = path.with_extension("toml.tmp");
        fs::write(&temp_path, raw)?;
        replace_file(&temp_path, &path)?;
        Ok(())
    }

    pub fn path() -> PathBuf {
        runtime_env::app_data_dir().join("config.toml")
    }
}

fn config_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn lock_config() -> anyhow::Result<MutexGuard<'static, ()>> {
    config_lock()
        .lock()
        .map_err(|_| anyhow::anyhow!("config lock poisoned"))
}

#[cfg(test)]
pub(crate) fn app_data_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn replace_file(temp_path: &std::path::Path, path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        // Windows does not support atomic rename-over-existing. Use a backup
        // strategy: rename the existing file to .bak, rename the new file into
        // place, then remove .bak.  A crash between steps 1 and 2 leaves the
        // .bak file as a recoverable copy.
        if path.exists() {
            let backup = path.with_extension("toml.bak");
            // Clean up any stale backup from a prior interrupted save.
            let _ = fs::remove_file(&backup);
            match fs::rename(path, &backup) {
                Ok(()) => {
                    if let Err(error) = fs::rename(temp_path, path) {
                        // Restore the backup so the original config is preserved.
                        let _ = fs::rename(&backup, path);
                        return Err(error);
                    }
                    let _ = fs::remove_file(&backup);
                    return Ok(());
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    // File vanished between exists() and rename — proceed.
                }
                Err(error) => return Err(error),
            }
        }
    }

    fs::rename(temp_path, path)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::AppConfig;
    use uuid::Uuid;

    const APP_DATA_ENV_VARS: [&str; 4] = ["HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA"];

    fn with_temp_app_data_env<T>(f: impl FnOnce() -> T) -> T {
        let _guard = super::app_data_env_lock()
            .lock()
            .expect("env lock poisoned");
        let previous: Vec<(&str, Option<std::ffi::OsString>)> = APP_DATA_ENV_VARS
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();
        let root = std::env::temp_dir().join(format!("panes-app-config-home-{}", Uuid::new_v4()));
        let local_app_data = root.join("AppData").join("Local");
        let roaming_app_data = root.join("AppData").join("Roaming");
        fs::create_dir_all(&local_app_data).expect("temp local app data should exist");
        fs::create_dir_all(&roaming_app_data).expect("temp roaming app data should exist");
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
    fn missing_locale_field_uses_none() {
        let raw = r#"
[general]
theme = "dark"
default_engine = "codex"
default_model = "gpt-5.3-codex"

[ui]
sidebar_width = 260
git_panel_width = 380
font_size = 13

[debug]
persist_engine_event_logs = false
max_action_output_chars = 20000
"#;

        let config = toml::from_str::<AppConfig>(raw).expect("config should deserialize");

        assert_eq!(config.general.locale, None);
        assert!(!config.power.keep_awake_enabled);
        assert_eq!(config.general.terminal_accelerated_rendering, None);
        assert!(!config.power.prevent_display_sleep);
        assert!(!config.power.prevent_screen_saver);
        assert!(!config.power.ac_only_mode);
        assert_eq!(config.power.battery_threshold, None);
        assert_eq!(config.power.session_duration_secs, None);
        assert!(!config.power.prevent_closed_display_sleep);
    }

    #[test]
    fn default_config_omits_optional_general_fields_from_toml() {
        let raw = toml::to_string_pretty(&AppConfig::default()).expect("config should serialize");

        assert!(!raw.contains("locale"));
        assert!(raw.contains("[power]"));
        assert!(raw.contains("keep_awake_enabled = false"));
        assert!(!raw.contains("terminal_accelerated_rendering"));
    }

    #[test]
    fn save_overwrites_existing_config() {
        with_temp_app_data_env(|| {
            let mut config = AppConfig::default();
            config.general.locale = Some("en".to_string());
            config.save().expect("initial config save should succeed");

            let mut updated = AppConfig::load_or_create().expect("config should reload");
            updated.general.locale = Some("pt-BR".to_string());
            updated.power.keep_awake_enabled = true;
            updated.save().expect("updated config save should succeed");

            let saved = AppConfig::load_or_create().expect("config should reload after overwrite");
            assert_eq!(saved.general.locale.as_deref(), Some("pt-BR"));
            assert!(saved.power.keep_awake_enabled);
        });
    }

    #[test]
    fn legacy_native_window_decorations_field_is_ignored() {
        let raw = r#"
[general]
theme = "dark"
default_engine = "codex"
default_model = "gpt-5.3-codex"
native_window_decorations = false

[ui]
sidebar_width = 260
git_panel_width = 380
font_size = 13

[debug]
persist_engine_event_logs = false
max_action_output_chars = 20000
"#;

        let config = toml::from_str::<AppConfig>(raw).expect("legacy config should deserialize");

        assert_eq!(config.general.locale, None);
        assert_eq!(config.general.terminal_accelerated_rendering, None);
    }

    #[test]
    fn terminal_accelerated_rendering_defaults_to_enabled() {
        let config = AppConfig::default();

        assert!(config.terminal_accelerated_rendering_enabled());
    }

    #[test]
    fn new_power_fields_serialize_roundtrip() {
        let mut config = AppConfig::default();
        config.power.prevent_display_sleep = true;
        config.power.prevent_screen_saver = true;
        config.power.ac_only_mode = true;
        config.power.battery_threshold = Some(20);
        config.power.session_duration_secs = Some(3600);
        config.power.prevent_closed_display_sleep = true;

        let raw = toml::to_string_pretty(&config).expect("config should serialize");
        let loaded = toml::from_str::<AppConfig>(&raw).expect("config should deserialize");

        assert!(loaded.power.prevent_display_sleep);
        assert!(loaded.power.prevent_screen_saver);
        assert!(loaded.power.ac_only_mode);
        assert_eq!(loaded.power.battery_threshold, Some(20));
        assert_eq!(loaded.power.session_duration_secs, Some(3600));
        assert!(loaded.power.prevent_closed_display_sleep);
    }

    #[test]
    fn old_config_without_new_power_fields_loads() {
        let raw = r#"
[general]
theme = "dark"
default_engine = "codex"
default_model = "gpt-5.3-codex"

[ui]
sidebar_width = 260
git_panel_width = 380
font_size = 13

[debug]
persist_engine_event_logs = false
max_action_output_chars = 20000

[power]
keep_awake_enabled = true
"#;

        let config = toml::from_str::<AppConfig>(raw).expect("old config should deserialize");

        assert!(config.power.keep_awake_enabled);
        assert!(!config.power.prevent_display_sleep);
        assert!(!config.power.prevent_screen_saver);
        assert!(!config.power.ac_only_mode);
        assert_eq!(config.power.battery_threshold, None);
        assert_eq!(config.power.session_duration_secs, None);
        assert!(!config.power.prevent_closed_display_sleep);
    }
}
