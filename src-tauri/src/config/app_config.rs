use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::PathBuf,
    sync::{Mutex, MutexGuard, OnceLock},
};

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::runtime_env;

pub const DEFAULT_TERMINAL_FONT_SIZE: u32 = 12;
pub const MIN_TERMINAL_FONT_SIZE: u32 = 8;
pub const MAX_TERMINAL_FONT_SIZE: u32 = 32;
pub const VALID_AUTONOMY_PRESETS: [&str; 4] = ["read-only", "ask", "auto", "full"];

/// Clamp a requested terminal font size into the supported range.
pub fn clamp_terminal_font_size(font_size: u32) -> u32 {
    font_size.clamp(MIN_TERMINAL_FONT_SIZE, MAX_TERMINAL_FONT_SIZE)
}

pub const MIN_UI_ZOOM_PERCENT: u32 = 70;
pub const MAX_UI_ZOOM_PERCENT: u32 = 150;
pub const DEFAULT_UI_ZOOM_PERCENT: u32 = 100;

/// Clamp a requested interface zoom percentage into the supported range.
pub fn clamp_ui_zoom_percent(zoom_percent: u32) -> u32 {
    zoom_percent.clamp(MIN_UI_ZOOM_PERCENT, MAX_UI_ZOOM_PERCENT)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub general: GeneralConfig,
    pub ui: UiConfig,
    pub debug: DebugConfig,
    pub power: PowerConfig,
    #[serde(skip_serializing_if = "HarnessesConfig::is_empty")]
    pub harnesses: HarnessesConfig,
    /// Extra chat provider instances (several installs or accounts of the
    /// same engine kind), plus runtime overrides for the built-in ones.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub chat_providers: Vec<ChatProviderInstanceConfig>,
}

pub const CHAT_PROVIDER_KINDS: &[&str] = &["codex", "claude"];
const CHAT_PROVIDER_SLUG_MAX_CHARS: usize = 48;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct ChatProviderInstanceConfig {
    /// Engine id. Built-in kinds use their own name (`codex`, `claude`);
    /// extra instances are `<kind>_<slug>`.
    pub id: String,
    pub kind: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binary_path: Option<String>,
    /// `CODEX_HOME` or `CLAUDE_CONFIG_DIR` for this instance.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub launch_args: Option<String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    pub enabled: bool,
}

impl Default for ChatProviderInstanceConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            kind: String::new(),
            display_name: String::new(),
            binary_path: None,
            home_path: None,
            launch_args: None,
            env: BTreeMap::new(),
            enabled: true,
        }
    }
}

impl ChatProviderInstanceConfig {
    pub fn is_builtin(&self) -> bool {
        self.id == self.kind
    }

    /// Validates the entry shape: known kind, well-formed id for the kind,
    /// and a display name.
    pub fn validate(&self) -> Result<(), String> {
        // OpenCode has no extra instances, but its built-in row can still be
        // switched off in settings.
        let builtin_only_kind = self.kind == "opencode" && self.id == self.kind;
        if !CHAT_PROVIDER_KINDS.contains(&self.kind.as_str()) && !builtin_only_kind {
            return Err(format!(
                "unsupported chat provider kind `{}`. expected one of: {}",
                self.kind,
                CHAT_PROVIDER_KINDS.join(", ")
            ));
        }
        if self.id != self.kind {
            let Some(slug) = self.id.strip_prefix(&format!("{}_", self.kind)) else {
                return Err(format!(
                    "chat provider id `{}` must start with `{}_`",
                    self.id, self.kind
                ));
            };
            validate_chat_provider_slug(slug)?;
        }
        if self.display_name.trim().is_empty() {
            return Err("chat provider display name is required".to_string());
        }
        for key in self.env.keys() {
            let valid = !key.is_empty()
                && key
                    .chars()
                    .all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
                && !key.chars().next().is_some_and(|ch| ch.is_ascii_digit());
            if !valid {
                return Err(format!("invalid environment variable name `{key}`"));
            }
        }
        Ok(())
    }
}

pub fn validate_chat_provider_slug(slug: &str) -> Result<(), String> {
    let valid = !slug.is_empty()
        && slug.len() <= CHAT_PROVIDER_SLUG_MAX_CHARS
        && slug
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
        && slug
            .chars()
            .next()
            .is_some_and(|ch| ch.is_ascii_lowercase());
    if valid {
        Ok(())
    } else {
        Err(format!(
            "invalid chat provider id suffix `{slug}`. use lowercase letters, digits and dashes, starting with a letter"
        ))
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_font_size: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat_notifications: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_notifications: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notification_sound: Option<String>,
    /// Autonomy preset applied to newly created chat threads
    /// (`read-only` | `ask` | `auto` | `full`); `None` follows repo trust.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_autonomy_preset: Option<String>,
    /// Sidebar chat-list layout (`projects` | `status`); `None` means `projects`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sidebar_list_mode: Option<String>,
    /// Whether the chat composer shows the Plan mode toggle; `None` means shown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub composer_plan_mode_visible: Option<bool>,
    /// Whether the model picker lists legacy models; `None` means hidden.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub composer_legacy_models_visible: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct UiConfig {
    pub sidebar_width: u32,
    pub git_panel_width: u32,
    pub font_size: u32,
    /// Interface zoom in percent; `None` means 100.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zoom_percent: Option<u32>,
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
    /// Without the privileged helper, lid-close sleep prevention can only be
    /// toggled through `pmset` behind a macOS admin password dialog that
    /// reappears on every activation. Off by default so the prompt never
    /// fires unless the user asked for it.
    pub allow_password_prompt_fallback: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct HarnessesConfig {
    /// Extra CLI flags appended to a harness command when it is launched into
    /// a terminal, keyed by harness id (e.g. `codex = "--yolo"`).
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub launch_args: BTreeMap<String, String>,
}

impl HarnessesConfig {
    fn is_empty(&self) -> bool {
        self.launch_args.is_empty()
    }
}

impl Default for GeneralConfig {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            default_engine: "codex".to_string(),
            default_model: "gpt-5.4".to_string(),
            locale: None,
            terminal_accelerated_rendering: None,
            terminal_font_size: None,
            chat_notifications: None,
            terminal_notifications: None,
            notification_sound: None,
            default_autonomy_preset: None,
            sidebar_list_mode: None,
            composer_plan_mode_visible: None,
            composer_legacy_models_visible: None,
        }
    }
}

pub const VALID_THEME_PREFERENCES: [&str; 3] = ["dark", "light", "system"];

pub const VALID_SIDEBAR_LIST_MODES: [&str; 2] = ["projects", "status"];

impl AppConfig {
    /// Resolve the configured notification sound name.
    /// Returns `None` if explicitly set to `"none"`, the stored value if set,
    /// or the platform default (`"Glass"` on macOS) otherwise.
    pub fn notification_sound(&self) -> Option<&str> {
        match self.general.notification_sound.as_deref() {
            Some("none") => None,
            Some(name) => Some(name),
            None => default_notification_sound(),
        }
    }

    /// Resolve the configured theme preference, falling back to `"dark"` for
    /// unrecognized or legacy values so old config files always load cleanly.
    pub fn theme_preference(&self) -> &str {
        if VALID_THEME_PREFERENCES.contains(&self.general.theme.as_str()) {
            &self.general.theme
        } else {
            "dark"
        }
    }

    /// Resolve the configured sidebar chat-list mode, falling back to
    /// `"projects"` for missing or unrecognized values.
    pub fn sidebar_list_mode(&self) -> &str {
        match self.general.sidebar_list_mode.as_deref() {
            Some(mode) if VALID_SIDEBAR_LIST_MODES.contains(&mode) => mode,
            Some("fleet") => "status",
            _ => "projects",
        }
    }

    /// Whether the chat composer should show the Plan mode toggle.
    pub fn composer_plan_mode_visible(&self) -> bool {
        self.general.composer_plan_mode_visible.unwrap_or(true)
    }

    /// Whether the model picker should list legacy models.
    pub fn composer_legacy_models_visible(&self) -> bool {
        self.general.composer_legacy_models_visible.unwrap_or(false)
    }

    /// Interface zoom percentage, clamped into the supported range.
    pub fn ui_zoom_percent(&self) -> u32 {
        clamp_ui_zoom_percent(self.ui.zoom_percent.unwrap_or(DEFAULT_UI_ZOOM_PERCENT))
    }
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            sidebar_width: 260,
            git_panel_width: 380,
            font_size: 13,
            zoom_percent: None,
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
            allow_password_prompt_fallback: false,
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
            harnesses: HarnessesConfig::default(),
            chat_providers: Vec::new(),
        }
    }
}

impl AppConfig {
    pub fn terminal_accelerated_rendering_enabled(&self) -> bool {
        self.general.terminal_accelerated_rendering.unwrap_or(true)
    }

    pub fn terminal_font_size(&self) -> u32 {
        self.general
            .terminal_font_size
            .map(clamp_terminal_font_size)
            .unwrap_or(DEFAULT_TERMINAL_FONT_SIZE)
    }

    pub fn chat_notifications_enabled(&self) -> bool {
        self.general.chat_notifications.unwrap_or(false)
    }

    pub fn terminal_notifications_enabled(&self) -> bool {
        self.general.terminal_notifications.unwrap_or(false)
    }

    /// Extra launch flags configured for a harness, or `None` when unset or
    /// blank.
    pub fn harness_launch_args(&self, harness_id: &str) -> Option<&str> {
        self.harnesses
            .launch_args
            .get(harness_id)
            .map(|args| args.trim())
            .filter(|args| !args.is_empty())
    }

    /// Configured chat provider entries that pass validation, with duplicate
    /// ids dropped (first wins).
    pub fn chat_providers(&self) -> Vec<ChatProviderInstanceConfig> {
        let mut seen = std::collections::BTreeSet::new();
        self.chat_providers
            .iter()
            .filter(|entry| entry.validate().is_ok())
            .filter(|entry| seen.insert(entry.id.clone()))
            .cloned()
            .collect()
    }

    pub fn default_autonomy_preset(&self) -> Option<&str> {
        self.general
            .default_autonomy_preset
            .as_deref()
            .filter(|preset| VALID_AUTONOMY_PRESETS.contains(preset))
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
            restore_interrupted_windows_save(&path);
        }

        if !path.exists() {
            let config = Self::default();
            config.save_unlocked()?;
            return Ok(config);
        }

        let raw = fs::read_to_string(&path)?;
        let config = match toml::from_str::<Self>(&raw) {
            Ok(config) => config,
            Err(error) => {
                // Keep starting with defaults (an Err here would abort startup),
                // but copy the unreadable file aside first: the next save
                // overwrites config.toml.
                // The error's Display quotes the offending line, which can hold
                // a provider API key, so log only where parsing failed.
                // Count bytes: the span can start inside a multibyte character.
                let line = error.span().map(|span| {
                    raw.bytes()
                        .take(span.start)
                        .filter(|byte| *byte == b'\n')
                        .count()
                        + 1
                });
                log::error!(
                    "failed to parse {} (line {})",
                    path.display(),
                    line.map_or_else(|| "unknown".to_string(), |line| line.to_string())
                );
                preserve_corrupt_config(&path, &raw);
                Self::default()
            }
        };
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

fn default_notification_sound() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    {
        return Some("Glass");
    }

    #[cfg(not(target_os = "macos"))]
    {
        None
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
    // std::fs::rename replaces an existing destination on every platform
    // (MoveFileExW with MOVEFILE_REPLACE_EXISTING on Windows), so config.toml
    // is never missing mid-save.
    fs::rename(temp_path, path)
}

/// Older Windows builds saved by renaming config.toml to config.toml.bak
/// before moving the new file in. A crash between the two renames left only
/// the backup; put it back instead of starting from defaults.
fn restore_interrupted_windows_save(path: &std::path::Path) {
    let backup = path.with_extension("toml.bak");
    if !backup.is_file() {
        return;
    }
    match fs::rename(&backup, path) {
        Ok(()) => log::warn!(
            "restored {} from an interrupted save backup",
            path.display()
        ),
        Err(error) => log::error!(
            "failed to restore {} from {}: {error}",
            path.display(),
            backup.display()
        ),
    }
}

/// Copies an unparseable config file to `config.toml.corrupt-<unix-seconds>`
/// unless a copy with the same contents already exists, so repeated saves do
/// not pile up identical copies.
fn preserve_corrupt_config(path: &std::path::Path, raw: &str) {
    let Some(parent) = path.parent() else {
        return;
    };
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return;
    };
    let prefix = format!("{file_name}.corrupt-");
    let already_preserved = fs::read_dir(parent)
        .map(|entries| {
            entries.flatten().any(|entry| {
                entry.file_name().to_string_lossy().starts_with(&prefix)
                    && fs::read_to_string(entry.path()).is_ok_and(|existing| existing == raw)
            })
        })
        .unwrap_or(false);
    if already_preserved {
        return;
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    // create_new so a second unreadable version in the same second gets its
    // own name instead of truncating the first copy.
    let mut copy_path = parent.join(format!("{prefix}{timestamp}"));
    let mut attempt = 1;
    let written = loop {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&copy_path)
        {
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists && attempt < 100 => {
                copy_path = parent.join(format!("{prefix}{timestamp}-{attempt}"));
                attempt += 1;
            }
            opened => break opened.and_then(|mut file| file.write_all(raw.as_bytes())),
        }
    };
    match written {
        Ok(()) => log::error!(
            "kept a copy of the unreadable config at {}",
            copy_path.display()
        ),
        Err(error) => log::error!(
            "failed to keep a copy of the unreadable config at {}: {error}",
            copy_path.display()
        ),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use std::collections::BTreeMap;

    use super::{preserve_corrupt_config, AppConfig, ChatProviderInstanceConfig};
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
default_model = "gpt-5.4"

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
        assert_eq!(config.general.terminal_notifications, None);
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
        assert!(!raw.contains("terminal_notifications"));
        assert!(!raw.contains("terminal_font_size"));
        assert!(!raw.contains("harnesses"));
    }

    #[test]
    fn harness_launch_args_roundtrip_and_lookup() {
        let mut config = AppConfig::default();
        config
            .harnesses
            .launch_args
            .insert("codex".to_string(), "--yolo".to_string());
        config
            .harnesses
            .launch_args
            .insert("claude-code".to_string(), "  ".to_string());

        let raw = toml::to_string_pretty(&config).expect("config should serialize");
        assert!(raw.contains("[harnesses.launch_args]"));
        assert!(raw.contains("codex = \"--yolo\""));

        let reloaded = toml::from_str::<AppConfig>(&raw).expect("config should deserialize");
        assert_eq!(reloaded.harness_launch_args("codex"), Some("--yolo"));
        // Blank values are treated as unset.
        assert_eq!(reloaded.harness_launch_args("claude-code"), None);
        assert_eq!(reloaded.harness_launch_args("gemini-cli"), None);
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
    fn unparseable_config_is_copied_aside_before_the_next_save() {
        with_temp_app_data_env(|| {
            let path = AppConfig::path();
            fs::create_dir_all(path.parent().expect("config has a parent"))
                .expect("config dir should exist");
            let broken = "[power]\nbattery_threshold = 300\n";
            fs::write(&path, broken).expect("broken config should be written");

            AppConfig::mutate(|config| {
                config.general.locale = Some("en".to_string());
                Ok(())
            })
            .expect("mutate should still succeed");
            AppConfig::mutate(|_| Ok(())).expect("second mutate should succeed");

            let corrupt_copies: Vec<_> = fs::read_dir(path.parent().unwrap())
                .expect("config dir should be readable")
                .flatten()
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("config.toml.corrupt-")
                })
                .collect();
            assert_eq!(corrupt_copies.len(), 1);
            assert_eq!(
                fs::read_to_string(corrupt_copies[0].path()).expect("copy should be readable"),
                broken
            );
        });
    }

    #[test]
    fn distinct_unreadable_versions_each_keep_their_own_copy() {
        let dir = std::env::temp_dir().join(format!("panes-corrupt-config-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("temp dir should exist");
        let path = dir.join("config.toml");

        preserve_corrupt_config(&path, "first = [");
        preserve_corrupt_config(&path, "second = [");
        preserve_corrupt_config(&path, "first = [");

        let mut copies: Vec<String> = fs::read_dir(&dir)
            .expect("temp dir should be readable")
            .flatten()
            .map(|entry| fs::read_to_string(entry.path()).expect("copy should be readable"))
            .collect();
        let _ = fs::remove_dir_all(&dir);
        copies.sort();

        assert_eq!(
            copies,
            vec!["first = [".to_string(), "second = [".to_string()]
        );
    }

    #[test]
    fn invalid_escape_before_a_multibyte_character_is_kept_without_panicking() {
        with_temp_app_data_env(|| {
            let path = AppConfig::path();
            fs::create_dir_all(path.parent().expect("config has a parent"))
                .expect("config dir should exist");
            let broken = "[general]\nlocale = \"\\\u{e9}\"\n";
            fs::write(&path, broken).expect("broken config should be written");

            let loaded = AppConfig::load_or_create().expect("config should load");

            assert_eq!(loaded.general.locale, None);
            let copies: Vec<_> = fs::read_dir(path.parent().unwrap())
                .expect("config dir should be readable")
                .flatten()
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("config.toml.corrupt-")
                })
                .collect();
            assert_eq!(copies.len(), 1);
            assert_eq!(
                fs::read_to_string(copies[0].path()).expect("copy should be readable"),
                broken
            );
        });
    }

    #[test]
    fn backup_from_an_interrupted_save_is_restored() {
        with_temp_app_data_env(|| {
            let path = AppConfig::path();
            fs::create_dir_all(path.parent().expect("config has a parent"))
                .expect("config dir should exist");
            let mut config = AppConfig::default();
            config.general.locale = Some("pt-BR".to_string());
            let raw = toml::to_string_pretty(&config).expect("config should serialize");
            fs::write(path.with_extension("toml.bak"), raw).expect("backup should be written");

            let loaded = AppConfig::load_or_create().expect("config should load");

            assert_eq!(loaded.general.locale.as_deref(), Some("pt-BR"));
            assert!(path.is_file());
            assert!(!path.with_extension("toml.bak").exists());
        });
    }

    #[test]
    fn legacy_native_window_decorations_field_is_ignored() {
        let raw = r#"
[general]
theme = "dark"
default_engine = "codex"
default_model = "gpt-5.4"
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
        assert_eq!(config.general.terminal_notifications, None);
        assert_eq!(config.general.terminal_font_size, None);
    }

    #[test]
    fn terminal_font_size_defaults_when_unset() {
        let config = AppConfig::default();

        assert_eq!(config.general.terminal_font_size, None);
        assert_eq!(
            config.terminal_font_size(),
            super::DEFAULT_TERMINAL_FONT_SIZE
        );
    }

    #[test]
    fn terminal_font_size_clamps_out_of_range_values() {
        assert_eq!(
            super::clamp_terminal_font_size(1),
            super::MIN_TERMINAL_FONT_SIZE
        );
        assert_eq!(
            super::clamp_terminal_font_size(1000),
            super::MAX_TERMINAL_FONT_SIZE
        );
        assert_eq!(super::clamp_terminal_font_size(18), 18);
    }

    #[test]
    fn terminal_font_size_serialize_roundtrip() {
        let mut config = AppConfig::default();
        config.general.terminal_font_size = Some(16);

        let raw = toml::to_string_pretty(&config).expect("config should serialize");
        let loaded = toml::from_str::<AppConfig>(&raw).expect("config should deserialize");

        assert_eq!(loaded.general.terminal_font_size, Some(16));
        assert_eq!(loaded.terminal_font_size(), 16);
    }

    #[test]
    fn terminal_accelerated_rendering_defaults_to_enabled() {
        let config = AppConfig::default();

        assert!(config.terminal_accelerated_rendering_enabled());
    }

    #[test]
    fn terminal_notifications_default_to_disabled() {
        let config = AppConfig::default();

        assert!(!config.terminal_notifications_enabled());
    }

    #[test]
    fn theme_preference_defaults_to_dark() {
        let config = AppConfig::default();

        assert_eq!(config.theme_preference(), "dark");
    }

    #[test]
    fn theme_preference_accepts_light_and_system() {
        let mut config = AppConfig::default();

        config.general.theme = "light".to_string();
        assert_eq!(config.theme_preference(), "light");

        config.general.theme = "system".to_string();
        assert_eq!(config.theme_preference(), "system");
    }

    #[test]
    fn theme_preference_falls_back_to_dark_for_unknown_values() {
        let mut config = AppConfig::default();
        config.general.theme = "solarized".to_string();

        assert_eq!(config.theme_preference(), "dark");
    }

    #[test]
    fn sidebar_list_mode_defaults_to_projects() {
        let config = AppConfig::default();

        assert_eq!(config.sidebar_list_mode(), "projects");
    }

    #[test]
    fn sidebar_list_mode_accepts_status_migrates_fleet_and_rejects_unknown_values() {
        let mut config = AppConfig::default();

        config.general.sidebar_list_mode = Some("status".to_string());
        assert_eq!(config.sidebar_list_mode(), "status");

        config.general.sidebar_list_mode = Some("fleet".to_string());
        assert_eq!(config.sidebar_list_mode(), "status");

        config.general.sidebar_list_mode = Some("kanban".to_string());
        assert_eq!(config.sidebar_list_mode(), "projects");
    }

    #[test]
    fn chat_provider_entries_validate_ids_kinds_and_env_names() {
        let mut entry = ChatProviderInstanceConfig {
            id: "claude_work".to_string(),
            kind: "claude".to_string(),
            display_name: "Claude (work)".to_string(),
            ..Default::default()
        };
        assert!(entry.validate().is_ok());
        assert!(!entry.is_builtin());

        entry.id = "codex_work".to_string();
        assert!(entry.validate().is_err());

        entry.id = "claude_Work".to_string();
        assert!(entry.validate().is_err());

        entry.id = "claude".to_string();
        assert!(entry.validate().is_ok());
        assert!(entry.is_builtin());

        entry.env.insert("1BAD".to_string(), "x".to_string());
        assert!(entry.validate().is_err());
    }

    #[test]
    fn chat_providers_roundtrip_through_toml_and_dedupe() {
        let mut config = AppConfig::default();
        config.chat_providers.push(ChatProviderInstanceConfig {
            id: "codex_work".to_string(),
            kind: "codex".to_string(),
            display_name: "Codex (work)".to_string(),
            home_path: Some("~/.codex-work".to_string()),
            env: BTreeMap::from([("OPENAI_BASE_URL".to_string(), "http://x".to_string())]),
            ..Default::default()
        });
        config.chat_providers.push(ChatProviderInstanceConfig {
            id: "codex_work".to_string(),
            kind: "codex".to_string(),
            display_name: "Duplicate".to_string(),
            ..Default::default()
        });
        let raw = toml::to_string_pretty(&config).expect("serialize");
        assert!(raw.contains("[[chat_providers]]"));
        let reloaded: AppConfig = toml::from_str(&raw).expect("parse");
        let providers = reloaded.chat_providers();
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].display_name, "Codex (work)");
        assert_eq!(
            providers[0].env.get("OPENAI_BASE_URL").map(String::as_str),
            Some("http://x")
        );
    }

    #[test]
    fn ui_zoom_defaults_to_full_size_and_clamps() {
        let mut config = AppConfig::default();
        assert_eq!(config.ui_zoom_percent(), 100);

        config.ui.zoom_percent = Some(125);
        assert_eq!(config.ui_zoom_percent(), 125);

        config.ui.zoom_percent = Some(10);
        assert_eq!(config.ui_zoom_percent(), 70);

        config.ui.zoom_percent = Some(900);
        assert_eq!(config.ui_zoom_percent(), 150);
    }

    #[test]
    fn composer_plan_mode_defaults_to_visible() {
        let mut config = AppConfig::default();
        assert!(config.composer_plan_mode_visible());

        config.general.composer_plan_mode_visible = Some(false);
        assert!(!config.composer_plan_mode_visible());
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
default_model = "gpt-5.4"

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
