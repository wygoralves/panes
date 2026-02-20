use std::{path::Path, time::Instant};

use anyhow::Context;
use tauri::State;
use tokio::process::Command;

use crate::{
    models::{EngineCheckResultDto, EngineHealthDto, EngineInfoDto},
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
    state
        .engines
        .health(&engine_id)
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
    cmd.arg("/C").arg(command);
    cmd
}

#[cfg(not(target_os = "windows"))]
fn build_shell_command(command: &str) -> Command {
    let shell = if Path::new("/bin/zsh").exists() {
        "/bin/zsh"
    } else if Path::new("/bin/bash").exists() {
        "/bin/bash"
    } else {
        "/bin/sh"
    };

    let mut cmd = Command::new(shell);
    cmd.arg("-lc").arg(command);
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
    error.to_string()
}
