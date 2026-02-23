use std::{
    collections::HashMap,
    collections::HashSet,
    ffi::OsString,
    io::{Read, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};

use anyhow::Context;
use chrono::Utc;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::models::{
    TerminalEnvSnapshotDto, TerminalRendererDiagnosticsDto, TerminalResizeSnapshotDto,
    TerminalSessionDto,
};

#[derive(Default)]
pub struct TerminalManager {
    workspaces: RwLock<HashMap<String, HashMap<String, Arc<TerminalSessionHandle>>>>,
}

struct TerminalSessionHandle {
    meta: TerminalSessionDto,
    diagnostics: Mutex<TerminalSessionDiagnosticsState>,
    process: Mutex<TerminalProcess>,
}

#[derive(Debug, Clone)]
struct TerminalSessionDiagnosticsState {
    env_snapshot: TerminalEnvSnapshotDto,
    last_resize: Option<TerminalResizeSnapshotDto>,
    last_zero_pixel_warning_at_ms: Option<i64>,
}

struct TerminalProcess {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send>,
}

struct SpawnedSession {
    session: Arc<TerminalSessionHandle>,
    reader: Box<dyn Read + Send>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEvent {
    session_id: String,
    data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    session_id: String,
    code: Option<i32>,
    signal: Option<i32>,
}

#[derive(Debug, Clone, Copy, Default)]
struct ExitPayload {
    code: Option<i32>,
    signal: Option<i32>,
}

impl TerminalManager {
    pub async fn list_sessions(&self, workspace_id: &str) -> Vec<TerminalSessionDto> {
        let sessions = self.workspaces.read().await;
        let mut out = sessions
            .get(workspace_id)
            .map(|items| {
                items
                    .values()
                    .map(|session| session.meta.clone())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        out
    }

    pub async fn renderer_diagnostics(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<TerminalRendererDiagnosticsDto> {
        let session = self
            .get_session(workspace_id, session_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("terminal session not found: {session_id}"))?;
        Ok(session.renderer_diagnostics())
    }

    pub async fn create_session(
        self: &Arc<Self>,
        app: AppHandle,
        workspace_id: String,
        cwd: String,
        cols: u16,
        rows: u16,
    ) -> anyhow::Result<TerminalSessionDto> {
        let workspace_for_spawn = workspace_id.clone();
        let cwd_for_spawn = cwd.clone();
        let spawned = tokio::task::spawn_blocking(move || {
            spawn_session(workspace_for_spawn, cwd_for_spawn, cols, rows)
        })
        .await
        .context("terminal spawn task failed")??;

        let created = spawned.session.meta.clone();

        {
            let mut sessions = self.workspaces.write().await;
            sessions
                .entry(workspace_id.clone())
                .or_default()
                .insert(created.id.clone(), Arc::clone(&spawned.session));
        }

        self.spawn_reader(app, workspace_id, created.id.clone(), spawned.reader);

        Ok(created)
    }

    pub async fn write(
        &self,
        workspace_id: &str,
        session_id: &str,
        data: String,
    ) -> anyhow::Result<()> {
        let session = self
            .get_session(workspace_id, session_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("terminal session not found: {session_id}"))?;
        tokio::task::spawn_blocking(move || session.write(&data))
            .await
            .context("terminal write task failed")??;
        Ok(())
    }

    pub async fn write_bytes(
        &self,
        workspace_id: &str,
        session_id: &str,
        data: Vec<u8>,
    ) -> anyhow::Result<()> {
        let session = self
            .get_session(workspace_id, session_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("terminal session not found: {session_id}"))?;
        tokio::task::spawn_blocking(move || session.write_raw(&data))
            .await
            .context("terminal write_bytes task failed")??;
        Ok(())
    }

    pub async fn resize(
        &self,
        workspace_id: &str,
        session_id: &str,
        cols: u16,
        rows: u16,
        pixel_width: u16,
        pixel_height: u16,
    ) -> anyhow::Result<()> {
        let session = self
            .get_session(workspace_id, session_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("terminal session not found: {session_id}"))?;
        tokio::task::spawn_blocking(move || session.resize(cols, rows, pixel_width, pixel_height))
            .await
            .context("terminal resize task failed")??;
        Ok(())
    }

    pub async fn close_session(
        self: &Arc<Self>,
        app: AppHandle,
        workspace_id: &str,
        session_id: &str,
    ) -> anyhow::Result<()> {
        let Some(session) = self.take_session(workspace_id, session_id).await else {
            return Ok(());
        };
        let event_session_id = session.meta.id.clone();
        let exit = tokio::task::spawn_blocking(move || session.kill_and_wait())
            .await
            .context("terminal close task failed")?;
        emit_exit(&app, workspace_id, &event_session_id, exit);
        Ok(())
    }

    pub async fn close_workspace(
        self: &Arc<Self>,
        app: AppHandle,
        workspace_id: &str,
    ) -> anyhow::Result<()> {
        let sessions = self.take_workspace_sessions(workspace_id).await;
        for session in sessions {
            let event_session_id = session.meta.id.clone();
            let exit = tokio::task::spawn_blocking(move || session.kill_and_wait())
                .await
                .context("terminal workspace close task failed")?;
            emit_exit(&app, workspace_id, &event_session_id, exit);
        }
        Ok(())
    }

    pub async fn shutdown(&self) {
        let workspaces = {
            let mut guard = self.workspaces.write().await;
            std::mem::take(&mut *guard)
        };

        for (workspace_id, sessions) in workspaces {
            for session in sessions.into_values() {
                let session_id = session.meta.id.clone();
                match tokio::task::spawn_blocking(move || session.kill_and_wait()).await {
                    Ok(_exit) => {
                        log::info!(
                            "terminal session closed during app shutdown: workspace_id={}, session_id={}",
                            workspace_id,
                            session_id
                        );
                    }
                    Err(error) => {
                        log::warn!(
                            "failed to close terminal session during app shutdown: workspace_id={}, session_id={}, error={}",
                            workspace_id,
                            session_id,
                            error
                        );
                    }
                }
            }
        }
    }

    async fn get_session(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> Option<Arc<TerminalSessionHandle>> {
        self.workspaces
            .read()
            .await
            .get(workspace_id)
            .and_then(|sessions| sessions.get(session_id))
            .cloned()
    }

    async fn take_session(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> Option<Arc<TerminalSessionHandle>> {
        let mut sessions = self.workspaces.write().await;
        let workspace_sessions = sessions.get_mut(workspace_id)?;
        let item = workspace_sessions.remove(session_id);
        if workspace_sessions.is_empty() {
            sessions.remove(workspace_id);
        }
        item
    }

    async fn take_workspace_sessions(&self, workspace_id: &str) -> Vec<Arc<TerminalSessionHandle>> {
        self.workspaces
            .write()
            .await
            .remove(workspace_id)
            .map(|sessions| sessions.into_values().collect())
            .unwrap_or_default()
    }

    fn spawn_reader(
        self: &Arc<Self>,
        app: AppHandle,
        workspace_id: String,
        session_id: String,
        mut reader: Box<dyn Read + Send>,
    ) {
        let manager = Arc::clone(self);
        let runtime = tokio::runtime::Handle::current();
        thread::spawn(move || {
            let mut buf = [0_u8; 8192];
            let mut decode_buffer = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        decode_buffer.extend_from_slice(&buf[..n]);
                        while let Some(chunk) = take_next_utf8_chunk(&mut decode_buffer) {
                            emit_output(&app, &workspace_id, &session_id, chunk);
                        }
                    }
                    Err(error) => {
                        if error.kind() == std::io::ErrorKind::Interrupted {
                            continue;
                        }
                        break;
                    }
                }
            }
            if !decode_buffer.is_empty() {
                let trailing = String::from_utf8_lossy(&decode_buffer).to_string();
                if !trailing.is_empty() {
                    emit_output(&app, &workspace_id, &session_id, trailing);
                }
            }

            let manager_for_finalize = Arc::clone(&manager);
            let app_for_finalize = app.clone();
            let workspace_for_finalize = workspace_id.clone();
            let session_for_finalize = session_id.clone();
            drop(runtime.spawn(async move {
                manager_for_finalize
                    .finalize_session_after_reader(
                        app_for_finalize,
                        workspace_for_finalize,
                        session_for_finalize,
                    )
                    .await;
            }));
        });
    }

    async fn finalize_session_after_reader(
        self: Arc<Self>,
        app: AppHandle,
        workspace_id: String,
        session_id: String,
    ) {
        let Some(session) = self.take_session(&workspace_id, &session_id).await else {
            return;
        };
        let event_session_id = session.meta.id.clone();
        let exit = match tokio::task::spawn_blocking(move || session.wait_for_exit()).await {
            Ok(payload) => payload,
            Err(error) => {
                log::warn!(
                    "terminal wait task failed for session {}: {error}",
                    event_session_id
                );
                ExitPayload::default()
            }
        };
        emit_exit(&app, &workspace_id, &event_session_id, exit);
    }
}

impl TerminalSessionHandle {
    fn renderer_diagnostics(&self) -> TerminalRendererDiagnosticsDto {
        let (env_snapshot, last_resize) = match self
            .diagnostics
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal diagnostics lock poisoned"))
        {
            Ok(state) => (state.env_snapshot.clone(), state.last_resize.clone()),
            Err(error) => {
                log::warn!("failed reading terminal renderer diagnostics: {error}");
                (TerminalEnvSnapshotDto::default(), None)
            }
        };

        TerminalRendererDiagnosticsDto {
            session_id: self.meta.id.clone(),
            shell: self.meta.shell.clone(),
            cwd: self.meta.cwd.clone(),
            env_snapshot,
            last_resize,
        }
    }

    fn write(&self, data: &str) -> anyhow::Result<()> {
        let mut process = self
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal process lock poisoned"))?;
        process
            .writer
            .write_all(data.as_bytes())
            .context("failed writing to terminal stdin")?;
        process
            .writer
            .flush()
            .context("failed flushing terminal stdin")?;
        Ok(())
    }

    fn write_raw(&self, data: &[u8]) -> anyhow::Result<()> {
        let mut process = self
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal process lock poisoned"))?;
        process
            .writer
            .write_all(data)
            .context("failed writing bytes to terminal stdin")?;
        process
            .writer
            .flush()
            .context("failed flushing terminal stdin")?;
        Ok(())
    }

    fn resize(
        &self,
        cols: u16,
        rows: u16,
        pixel_width: u16,
        pixel_height: u16,
    ) -> anyhow::Result<()> {
        let process = self
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal process lock poisoned"))?;
        process
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width,
                pixel_height,
            })
            .context("failed resizing terminal pty")?;
        drop(process);

        match self
            .diagnostics
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal diagnostics lock poisoned"))
        {
            Ok(mut state) => {
                state.last_resize = Some(TerminalResizeSnapshotDto {
                    cols: cols.max(1),
                    rows: rows.max(1),
                    pixel_width,
                    pixel_height,
                    recorded_at: Utc::now().to_rfc3339(),
                });
                if pixel_width == 0 || pixel_height == 0 {
                    let now_ms = Utc::now().timestamp_millis();
                    let should_warn = state
                        .last_zero_pixel_warning_at_ms
                        .map(|last| now_ms - last >= 5_000)
                        .unwrap_or(true);
                    if should_warn {
                        log::warn!(
                            "terminal resize reported zero pixel dimensions: session_id={}, cols={}, rows={}, pixel_width={}, pixel_height={}",
                            self.meta.id,
                            cols,
                            rows,
                            pixel_width,
                            pixel_height
                        );
                        state.last_zero_pixel_warning_at_ms = Some(now_ms);
                    }
                }
            }
            Err(error) => {
                log::warn!("failed updating terminal resize diagnostics: {error}");
            }
        }
        Ok(())
    }

    fn wait_for_exit(&self) -> ExitPayload {
        let mut process = match self
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal process lock poisoned"))
        {
            Ok(guard) => guard,
            Err(error) => {
                log::warn!("unable to wait terminal exit: {error}");
                return ExitPayload::default();
            }
        };
        match process.child.wait() {
            Ok(status) => ExitPayload {
                code: Some(status.exit_code() as i32),
                signal: None,
            },
            Err(error) => {
                log::warn!("failed waiting for terminal process exit: {error}");
                ExitPayload::default()
            }
        }
    }

    fn kill_and_wait(&self) -> ExitPayload {
        let mut process = match self
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal process lock poisoned"))
        {
            Ok(guard) => guard,
            Err(error) => {
                log::warn!("unable to stop terminal session: {error}");
                return ExitPayload::default();
            }
        };
        if let Err(error) = process.child.kill() {
            log::warn!("failed killing terminal process: {error}");
        }
        match process.child.wait() {
            Ok(status) => ExitPayload {
                code: Some(status.exit_code() as i32),
                signal: None,
            },
            Err(error) => {
                log::warn!("failed waiting for terminal process after kill: {error}");
                ExitPayload::default()
            }
        }
    }
}

fn spawn_session(
    workspace_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> anyhow::Result<SpawnedSession> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("failed to open terminal pty")?;

    let shell = default_shell();
    let mut cmd = CommandBuilder::new(shell.clone());
    cmd.cwd(PathBuf::from(&cwd));
    let env_snapshot = configure_terminal_env(&mut cmd);
    #[cfg(not(target_os = "windows"))]
    {
        cmd.arg("-l");
        cmd.arg("-i");
    }
    let child = pair
        .slave
        .spawn_command(cmd)
        .context("failed spawning terminal shell process")?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .context("failed to clone terminal reader")?;
    let writer = pair
        .master
        .take_writer()
        .context("failed to take terminal writer")?;

    let session = Arc::new(TerminalSessionHandle {
        meta: TerminalSessionDto {
            id: Uuid::new_v4().to_string(),
            workspace_id,
            shell,
            cwd,
            created_at: Utc::now().to_rfc3339(),
        },
        diagnostics: Mutex::new(TerminalSessionDiagnosticsState {
            env_snapshot,
            last_resize: None,
            last_zero_pixel_warning_at_ms: None,
        }),
        process: Mutex::new(TerminalProcess {
            master: pair.master,
            writer,
            child,
        }),
    });

    Ok(SpawnedSession { session, reader })
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    }
}

fn configure_terminal_env(cmd: &mut CommandBuilder) -> TerminalEnvSnapshotDto {
    let inherited_term = read_non_empty_env("TERM");
    let term = match inherited_term.as_deref() {
        Some("dumb") | None => Some("xterm-256color".to_string()),
        Some(value) => Some(value.to_string()),
    };
    let colorterm = read_non_empty_env("COLORTERM").or_else(|| Some("truecolor".to_string()));
    let term_program = read_non_empty_env("TERM_PROGRAM").or_else(|| Some("Panes".to_string()));
    let term_program_version = read_non_empty_env("TERM_PROGRAM_VERSION")
        .or_else(|| Some(env!("CARGO_PKG_VERSION").to_string()));
    let home = read_non_empty_env("HOME");
    let xdg_config_home = read_non_empty_env("XDG_CONFIG_HOME")
        .or_else(|| home.as_ref().map(|value| format!("{value}/.config")));
    let xdg_data_home = read_non_empty_env("XDG_DATA_HOME")
        .or_else(|| home.as_ref().map(|value| format!("{value}/.local/share")));
    let xdg_cache_home = read_non_empty_env("XDG_CACHE_HOME")
        .or_else(|| home.as_ref().map(|value| format!("{value}/.cache")));
    let xdg_state_home = read_non_empty_env("XDG_STATE_HOME")
        .or_else(|| home.as_ref().map(|value| format!("{value}/.local/state")));
    let tmpdir = read_non_empty_env("TMPDIR");
    let lang = read_non_empty_env("LANG").or_else(|| Some("en_US.UTF-8".to_string()));
    let lc_ctype = read_non_empty_env("LC_CTYPE").or_else(|| lang.clone());
    let lc_all = read_non_empty_env("LC_ALL");
    let path = build_terminal_path(home.as_deref()).or_else(|| read_non_empty_env("PATH"));

    if let Some(value) = term.as_deref() {
        cmd.env("TERM", value);
    }
    if let Some(value) = colorterm.as_deref() {
        cmd.env("COLORTERM", value);
    }
    if let Some(value) = term_program.as_deref() {
        cmd.env("TERM_PROGRAM", value);
    }
    if let Some(value) = term_program_version.as_deref() {
        cmd.env("TERM_PROGRAM_VERSION", value);
    }
    cmd.env("PANES_TERM_PROGRAM", "Panes");
    cmd.env("PANES_TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    if let Some(value) = home.as_deref() {
        cmd.env("HOME", value);
    }
    if let Some(value) = xdg_config_home.as_deref() {
        cmd.env("XDG_CONFIG_HOME", value);
    }
    if let Some(value) = xdg_data_home.as_deref() {
        cmd.env("XDG_DATA_HOME", value);
    }
    if let Some(value) = xdg_cache_home.as_deref() {
        cmd.env("XDG_CACHE_HOME", value);
    }
    if let Some(value) = xdg_state_home.as_deref() {
        cmd.env("XDG_STATE_HOME", value);
    }
    if let Some(value) = tmpdir.as_deref() {
        cmd.env("TMPDIR", value);
    }
    if let Some(value) = lang.as_deref() {
        cmd.env("LANG", value);
    }
    if let Some(value) = lc_ctype.as_deref() {
        cmd.env("LC_CTYPE", value);
    }
    if let Some(value) = lc_all.as_deref() {
        cmd.env("LC_ALL", value);
    }
    if let Some(value) = path.as_deref() {
        cmd.env("PATH", value);
    }

    ensure_dir_exists("XDG_CONFIG_HOME", xdg_config_home.as_deref());
    ensure_dir_exists("XDG_DATA_HOME", xdg_data_home.as_deref());
    ensure_dir_exists("XDG_CACHE_HOME", xdg_cache_home.as_deref());
    ensure_dir_exists("XDG_STATE_HOME", xdg_state_home.as_deref());

    TerminalEnvSnapshotDto {
        term,
        colorterm,
        term_program,
        term_program_version,
        home,
        xdg_config_home,
        xdg_data_home,
        xdg_cache_home,
        xdg_state_home,
        tmpdir,
        lang,
        lc_all,
        lc_ctype,
        path,
    }
}

fn build_terminal_path(home: Option<&str>) -> Option<String> {
    let mut entries: Vec<PathBuf> = read_non_empty_env("PATH")
        .map(|raw| std::env::split_paths(&OsString::from(raw)).collect())
        .unwrap_or_default();

    #[cfg(target_os = "macos")]
    {
        entries.push(PathBuf::from("/opt/homebrew/bin"));
        entries.push(PathBuf::from("/opt/homebrew/sbin"));
        entries.push(PathBuf::from("/usr/local/bin"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        entries.push(PathBuf::from("/usr/bin"));
        entries.push(PathBuf::from("/bin"));
        entries.push(PathBuf::from("/usr/sbin"));
        entries.push(PathBuf::from("/sbin"));
    }

    if let Some(home) = home {
        let home = PathBuf::from(home);
        entries.push(home.join(".local/bin"));
        entries.push(home.join(".cargo/bin"));
        entries.push(home.join(".deno/bin"));
        entries.push(home.join("Library/pnpm"));
    }

    let mut seen = HashSet::new();
    let mut deduped = Vec::with_capacity(entries.len());
    for entry in entries {
        if seen.insert(entry.clone()) {
            deduped.push(entry);
        }
    }

    let joined = std::env::join_paths(deduped).ok()?;
    let rendered = joined.to_string_lossy().to_string();
    if rendered.trim().is_empty() {
        None
    } else {
        Some(rendered)
    }
}

fn ensure_dir_exists(label: &str, path: Option<&str>) {
    let Some(path) = path else {
        return;
    };
    if let Err(error) = std::fs::create_dir_all(path) {
        log::warn!("failed to create {label} directory at {path}: {error}");
    }
}

fn read_non_empty_env(key: &str) -> Option<String> {
    std::env::var(key).ok().and_then(|value| {
        if value.trim().is_empty() {
            None
        } else {
            Some(value)
        }
    })
}

fn emit_output(app: &AppHandle, workspace_id: &str, session_id: &str, data: String) {
    let event_name = format!("terminal-output-{workspace_id}");
    let payload = TerminalOutputEvent {
        session_id: session_id.to_string(),
        data,
    };
    let _ = app.emit(&event_name, payload);
}

fn emit_exit(app: &AppHandle, workspace_id: &str, session_id: &str, exit: ExitPayload) {
    let event_name = format!("terminal-exit-{workspace_id}");
    let payload = TerminalExitEvent {
        session_id: session_id.to_string(),
        code: exit.code,
        signal: exit.signal,
    };
    let _ = app.emit(&event_name, payload);
}

fn take_next_utf8_chunk(buffer: &mut Vec<u8>) -> Option<String> {
    if buffer.is_empty() {
        return None;
    }

    match std::str::from_utf8(buffer) {
        Ok(valid) => {
            let out = valid.to_string();
            buffer.clear();
            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
        Err(error) => {
            let valid_up_to = error.valid_up_to();
            if let Some(error_len) = error.error_len() {
                let end = (valid_up_to + error_len).min(buffer.len());
                let out = String::from_utf8_lossy(&buffer[..end]).to_string();
                buffer.drain(..end);
                if out.is_empty() {
                    None
                } else {
                    Some(out)
                }
            } else if valid_up_to > 0 {
                let out = String::from_utf8_lossy(&buffer[..valid_up_to]).to_string();
                buffer.drain(..valid_up_to);
                if out.is_empty() {
                    None
                } else {
                    Some(out)
                }
            } else {
                None
            }
        }
    }
}
