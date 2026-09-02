use std::time::Instant;

use anyhow::Context;
use tauri::State;
use tokio::process::Command;

#[cfg(not(target_os = "windows"))]
use crate::runtime_env;
use crate::{
    config::app_config::{AppConfig, ChatProviderInstanceConfig, CHAT_PROVIDER_KINDS},
    engines::is_builtin_engine_id,
    models::{
        ChatProviderInstanceDto, ChatProviderUsageDto, CodexAppDto, CodexSkillDto,
        EngineCheckResultDto, EngineHealthDto, EngineInfoDto, OpenCodeRuntimeCatalogDto,
    },
    process_utils,
    state::AppState,
};

fn chat_provider_dto(entry: &ChatProviderInstanceConfig) -> ChatProviderInstanceDto {
    ChatProviderInstanceDto {
        id: entry.id.clone(),
        kind: entry.kind.clone(),
        display_name: entry.display_name.clone(),
        binary_path: entry.binary_path.clone(),
        home_path: entry.home_path.clone(),
        launch_args: entry.launch_args.clone(),
        env: entry.env.clone(),
        enabled: entry.enabled,
        built_in: entry.is_builtin(),
    }
}

/// Configured provider entries plus implicit rows for the built-in kinds
/// that have no overrides yet, so the settings page always shows every
/// provider the app can run.
fn chat_provider_rows(config: &AppConfig) -> Vec<ChatProviderInstanceDto> {
    let configured = config.chat_providers();
    let mut rows = Vec::new();
    let builtin_kinds: Vec<&str> = CHAT_PROVIDER_KINDS
        .iter()
        .copied()
        .chain(std::iter::once("opencode"))
        .collect();
    for kind in builtin_kinds.iter() {
        match configured.iter().find(|entry| entry.id == *kind) {
            Some(entry) => rows.push(chat_provider_dto(entry)),
            None => rows.push(ChatProviderInstanceDto {
                id: (*kind).to_string(),
                kind: (*kind).to_string(),
                display_name: match *kind {
                    "codex" => "Codex".to_string(),
                    "claude" => "Claude".to_string(),
                    "opencode" => "OpenCode".to_string(),
                    other => other.to_string(),
                },
                binary_path: None,
                home_path: None,
                launch_args: None,
                env: Default::default(),
                enabled: true,
                built_in: true,
            }),
        }
    }
    rows.extend(
        configured
            .iter()
            .filter(|entry| !entry.is_builtin())
            .map(chat_provider_dto),
    );
    rows
}

#[tauri::command]
pub async fn list_chat_providers(
    _state: State<'_, AppState>,
) -> Result<Vec<ChatProviderInstanceDto>, String> {
    tokio::task::spawn_blocking(move || {
        let config = AppConfig::load_or_create().map_err(err_to_string)?;
        Ok(chat_provider_rows(&config))
    })
    .await
    .map_err(err_to_string)?
}

#[tauri::command]
pub async fn save_chat_provider(
    state: State<'_, AppState>,
    provider: ChatProviderInstanceDto,
) -> Result<Vec<ChatProviderInstanceDto>, String> {
    let entry = ChatProviderInstanceConfig {
        id: provider.id.trim().to_string(),
        kind: provider.kind.trim().to_string(),
        display_name: provider.display_name.trim().to_string(),
        binary_path: provider
            .binary_path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        home_path: provider
            .home_path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        launch_args: provider
            .launch_args
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        env: provider
            .env
            .into_iter()
            .map(|(key, value)| (key.trim().to_string(), value))
            .filter(|(key, _)| !key.is_empty())
            .collect(),
        enabled: provider.enabled,
    };
    entry.validate()?;
    if is_builtin_engine_id(&entry.id) && entry.id != entry.kind {
        return Err(format!("`{}` is reserved for a built-in engine", entry.id));
    }

    let config_write_lock = state.config_write_lock.clone();
    let _guard = config_write_lock.lock_owned().await;
    let config = tokio::task::spawn_blocking(move || {
        AppConfig::mutate(|config| {
            match config
                .chat_providers
                .iter_mut()
                .find(|existing| existing.id == entry.id)
            {
                Some(existing) => *existing = entry,
                None => config.chat_providers.push(entry),
            }
            Ok(config.clone())
        })
        .map_err(err_to_string)
    })
    .await
    .map_err(err_to_string)??;

    state
        .engines
        .apply_chat_providers(&config.chat_providers())
        .await;
    Ok(chat_provider_rows(&config))
}

#[tauri::command]
pub async fn remove_chat_provider(
    state: State<'_, AppState>,
    provider_id: String,
) -> Result<Vec<ChatProviderInstanceDto>, String> {
    let provider_id = provider_id.trim().to_string();
    if provider_id.is_empty() {
        return Err("provider id is required".to_string());
    }

    let config_write_lock = state.config_write_lock.clone();
    let _guard = config_write_lock.lock_owned().await;
    let config = tokio::task::spawn_blocking(move || {
        AppConfig::mutate(|config| {
            config
                .chat_providers
                .retain(|existing| existing.id != provider_id);
            Ok(config.clone())
        })
        .map_err(err_to_string)
    })
    .await
    .map_err(err_to_string)??;

    state
        .engines
        .apply_chat_providers(&config.chat_providers())
        .await;
    Ok(chat_provider_rows(&config))
}

#[tauri::command]
pub async fn list_engines(state: State<'_, AppState>) -> Result<Vec<EngineInfoDto>, String> {
    state.engines.list_engines().await.map_err(err_to_string)
}

#[tauri::command]
pub async fn get_chat_provider_usage(
    state: State<'_, AppState>,
) -> Result<Vec<ChatProviderUsageDto>, String> {
    Ok(state.engines.chat_provider_usage().await)
}

#[tauri::command]
pub async fn codex_uses_external_sandbox(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.engines.codex_uses_external_sandbox().await)
}

#[tauri::command]
pub async fn engine_health(
    state: State<'_, AppState>,
    engine_id: String,
) -> Result<EngineHealthDto, String> {
    state
        .engines
        .health(&engine_id)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn prewarm_engine(state: State<'_, AppState>, engine_id: String) -> Result<(), String> {
    state
        .engines
        .prewarm(&engine_id)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn list_codex_skills(
    state: State<'_, AppState>,
    cwd: String,
) -> Result<Vec<CodexSkillDto>, String> {
    state
        .engines
        .list_codex_skills(cwd.trim())
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn list_codex_apps(state: State<'_, AppState>) -> Result<Vec<CodexAppDto>, String> {
    state.engines.list_codex_apps().await.map_err(err_to_string)
}

#[tauri::command]
pub async fn get_opencode_runtime_catalog(
    state: State<'_, AppState>,
    cwd: String,
) -> Result<OpenCodeRuntimeCatalogDto, String> {
    let cwd = cwd.trim();
    if cwd.is_empty() {
        return Err("cwd is required".to_string());
    }
    state
        .engines
        .opencode_runtime_catalog(cwd)
        .await
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn run_engine_check(
    state: State<'_, AppState>,
    engine_id: String,
    command: String,
) -> Result<EngineCheckResultDto, String> {
    let health = state
        .engines
        .health(&engine_id)
        .await
        .map_err(err_to_string)?;
    let is_allowed = health
        .checks
        .iter()
        .chain(health.fixes.iter())
        .any(|value| value == &command);

    if !is_allowed {
        return Err("command is not allowed for this engine check".to_string());
    }

    execute_engine_check_command(&command)
        .await
        .map_err(err_to_string)
}

async fn execute_engine_check_command(command: &str) -> anyhow::Result<EngineCheckResultDto> {
    let started = Instant::now();

    let output = build_shell_command(command)
        .output()
        .await
        .with_context(|| format!("failed to execute check command: `{command}`"))?;

    let duration_ms = started.elapsed().as_millis();

    Ok(EngineCheckResultDto {
        command: command.to_string(),
        success: output.status.success(),
        exit_code: output.status.code(),
        stdout: truncate_output(&String::from_utf8_lossy(&output.stdout), 12_000),
        stderr: truncate_output(&String::from_utf8_lossy(&output.stderr), 12_000),
        duration_ms,
    })
}

#[cfg(target_os = "windows")]
fn build_shell_command(command: &str) -> Command {
    let mut cmd = Command::new("cmd");
    process_utils::configure_tokio_command(&mut cmd);
    cmd.arg("/C").arg(command);
    cmd
}

#[cfg(not(target_os = "windows"))]
fn build_shell_command(command: &str) -> Command {
    let spec = runtime_env::command_shell_for_string(command);
    let mut cmd = Command::new(&spec.program);
    process_utils::configure_tokio_command(&mut cmd);
    cmd.args(&spec.args);
    if let Some(augmented_path) = runtime_env::augmented_path_with_prepend(
        spec.program
            .parent()
            .into_iter()
            .map(|value| value.to_path_buf()),
    ) {
        cmd.env("PATH", augmented_path);
    }
    cmd
}

fn truncate_output(value: &str, max_chars: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= max_chars {
        return value.to_string();
    }

    let mut out = chars.into_iter().take(max_chars).collect::<String>();
    out.push_str("\n...[truncated]");
    out
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    format!("{error:#}")
}
