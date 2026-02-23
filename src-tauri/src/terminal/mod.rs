use std::{
    collections::HashMap,
    collections::HashSet,
    ffi::OsString,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::Context;
use chrono::Utc;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::models::{
    TerminalEnvSnapshotDto, TerminalIoCountersDto, TerminalOutputThrottleSnapshotDto,
    TerminalRendererDiagnosticsDto, TerminalResizeSnapshotDto, TerminalSessionDto,
};

const TERMINAL_OUTPUT_MIN_EMIT_INTERVAL_MS: u64 = 16;
const TERMINAL_OUTPUT_MAX_EMIT_BYTES: usize = 256 * 1024;
const TERMINAL_OUTPUT_BUFFER_MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Default)]
pub struct TerminalManager {
    workspaces: RwLock<HashMap<String, HashMap<String, Arc<TerminalSessionHandle>>>>,
}

struct TerminalSessionHandle {
    meta: TerminalSessionDto,
    diagnostics: Mutex<TerminalSessionDiagnosticsState>,
    io_counters: TerminalSessionIoCounters,
    process: Mutex<TerminalProcess>,
}

struct TerminalSessionDiagnosticsState {
    env_snapshot: TerminalEnvSnapshotDto,
    last_resize: Option<TerminalResizeSnapshotDto>,
    last_zero_pixel_warning_at_ms: Option<i64>,
}

#[derive(Default)]
struct TerminalSessionIoCounters {
    stdin_writes: AtomicU64,
    stdin_bytes: AtomicU64,
    stdin_ctrl_c: AtomicU64,
    stdout_reads: AtomicU64,
    stdout_bytes: AtomicU64,
    stdout_emits: AtomicU64,
    stdout_emit_bytes: AtomicU64,
    stdout_dropped_bytes: AtomicU64,
    last_stdin_write_at_ms: AtomicU64,
    last_stdout_read_at_ms: AtomicU64,
    last_stdout_emit_at_ms: AtomicU64,
    output_buffer_bytes: AtomicU64,
    output_buffer_peak_bytes: AtomicU64,
    output_buffer_trimmed_bytes: AtomicU64,
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

struct SharedTerminalOutput {
    buffer: Mutex<String>,
    ready: Condvar,
    done: AtomicBool,
}

impl SharedTerminalOutput {
    fn new() -> Self {
        Self {
            buffer: Mutex::new(String::new()),
            ready: Condvar::new(),
            done: AtomicBool::new(false),
        }
    }
}

fn take_string_head(value: &mut String, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return std::mem::take(value);
    }

    let mut cut = max_bytes;
    while cut > 0 && !value.is_char_boundary(cut) {
        cut -= 1;
    }
    if cut == 0 {
        return std::mem::take(value);
    }

    let rest = value.split_off(cut);
    let out = std::mem::take(value);
    *value = rest;
    out
}

fn trim_string_to_tail(value: &mut String, max_bytes: usize) -> usize {
    if value.len() <= max_bytes {
        return 0;
    }
    let before = value.len();
    let mut cut = value.len().saturating_sub(max_bytes);
    while cut < value.len() && !value.is_char_boundary(cut) {
        cut += 1;
    }
    value.drain(..cut);
    before.saturating_sub(value.len())
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

        self.spawn_reader(
            app,
            workspace_id,
            Arc::clone(&spawned.session),
            spawned.reader,
        );

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
        session: Arc<TerminalSessionHandle>,
        mut reader: Box<dyn Read + Send>,
    ) {
        let manager = Arc::clone(self);
        let runtime = tokio::runtime::Handle::current();
        thread::spawn(move || {
            let session_id = session.meta.id.clone();
            // High-frequency TUIs (OpenCode, Kilo Code, vim, etc.) can generate a lot of
            // output. In release builds the PTY reader can outpace the webview, flooding
            // IPC and making the terminal feel frozen (including Ctrl+C). We want to:
            // - Drain the PTY continuously (never sleep in the reader)
            // - Coalesce and rate-limit IPC emissions (emit at most ~60Hz)
            //
            // Implementation: the reader thread appends into a shared buffer; an emitter
            // thread flushes it on a timer/condvar.
            let shared = Arc::new(SharedTerminalOutput::new());

            let shared_for_emitter = Arc::clone(&shared);
            let app_for_emitter = app.clone();
            let workspace_for_emitter = workspace_id.clone();
            let session_for_emitter = session_id.clone();
            let session_handle_for_emitter = Arc::clone(&session);
            let emitter = thread::spawn(move || {
                // 60Hz is enough for TUIs while keeping IPC overhead bounded.
                let min_emit_interval = Duration::from_millis(TERMINAL_OUTPUT_MIN_EMIT_INTERVAL_MS);
                let mut last_emit_at = Instant::now()
                    .checked_sub(min_emit_interval)
                    .unwrap_or_else(Instant::now);

                loop {
                    let mut guard = shared_for_emitter
                        .buffer
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner());

                    loop {
                        let done = shared_for_emitter.done.load(Ordering::Relaxed);
                        if done {
                            break;
                        }

                        if guard.is_empty() {
                            guard = shared_for_emitter
                                .ready
                                .wait(guard)
                                .unwrap_or_else(|poison| poison.into_inner());
                            continue;
                        }

                        let elapsed = last_emit_at.elapsed();
                        if elapsed >= min_emit_interval {
                            break;
                        }

                        let timeout = min_emit_interval - elapsed;
                        let (next_guard, _timeout) = shared_for_emitter
                            .ready
                            .wait_timeout(guard, timeout)
                            .unwrap_or_else(|poison| poison.into_inner());
                        guard = next_guard;
                    }

                    let done = shared_for_emitter.done.load(Ordering::Relaxed);
                    if guard.is_empty() {
                        if done {
                            break;
                        }
                        drop(guard);
                        continue;
                    }

                    let payload = take_string_head(&mut *guard, TERMINAL_OUTPUT_MAX_EMIT_BYTES);
                    session_handle_for_emitter
                        .io_counters
                        .output_buffer_bytes
                        .store(guard.len() as u64, Ordering::Relaxed);
                    drop(guard);
                    if payload.is_empty() {
                        continue;
                    }
                    let payload_len = payload.len() as u64;
                    emit_output(
                        &app_for_emitter,
                        &workspace_for_emitter,
                        &session_for_emitter,
                        payload,
                    );
                    session_handle_for_emitter
                        .io_counters
                        .stdout_emits
                        .fetch_add(1, Ordering::Relaxed);
                    session_handle_for_emitter
                        .io_counters
                        .stdout_emit_bytes
                        .fetch_add(payload_len, Ordering::Relaxed);
                    let now_ms = Utc::now().timestamp_millis();
                    if now_ms > 0 {
                        session_handle_for_emitter
                            .io_counters
                            .last_stdout_emit_at_ms
                            .store(now_ms as u64, Ordering::Relaxed);
                    }
                    last_emit_at = Instant::now();
                }
            });

            let mut buf = [0_u8; 64 * 1024];
            let mut decode_buffer = Vec::new();
            let mut pending = String::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        session
                            .io_counters
                            .stdout_reads
                            .fetch_add(1, Ordering::Relaxed);
                        session
                            .io_counters
                            .stdout_bytes
                            .fetch_add(n as u64, Ordering::Relaxed);
                        let now_ms = Utc::now().timestamp_millis();
                        if now_ms > 0 {
                            session
                                .io_counters
                                .last_stdout_read_at_ms
                                .store(now_ms as u64, Ordering::Relaxed);
                        }

                        decode_buffer.extend_from_slice(&buf[..n]);
                        while let Some(chunk) = take_next_utf8_chunk(&mut decode_buffer) {
                            if pending.is_empty() {
                                pending = chunk;
                            } else {
                                pending.push_str(&chunk);
                            }
                        }

                        if !pending.is_empty() {
                            let mut buffer = shared
                                .buffer
                                .lock()
                                .unwrap_or_else(|poison| poison.into_inner());
                            buffer.push_str(&pending);
                            let trimmed =
                                trim_string_to_tail(&mut buffer, TERMINAL_OUTPUT_BUFFER_MAX_BYTES);
                            if trimmed > 0 {
                                session
                                    .io_counters
                                    .stdout_dropped_bytes
                                    .fetch_add(trimmed as u64, Ordering::Relaxed);
                                session
                                    .io_counters
                                    .output_buffer_trimmed_bytes
                                    .fetch_add(trimmed as u64, Ordering::Relaxed);
                            }
                            let len = buffer.len() as u64;
                            session
                                .io_counters
                                .output_buffer_bytes
                                .store(len, Ordering::Relaxed);
                            session
                                .io_counters
                                .output_buffer_peak_bytes
                                .fetch_max(len, Ordering::Relaxed);
                            pending.clear();
                            drop(buffer);
                            shared.ready.notify_one();
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

            if !pending.is_empty() {
                let mut buffer = shared
                    .buffer
                    .lock()
                    .unwrap_or_else(|poison| poison.into_inner());
                buffer.push_str(&pending);
                let trimmed = trim_string_to_tail(&mut buffer, TERMINAL_OUTPUT_BUFFER_MAX_BYTES);
                if trimmed > 0 {
                    session
                        .io_counters
                        .stdout_dropped_bytes
                        .fetch_add(trimmed as u64, Ordering::Relaxed);
                    session
                        .io_counters
                        .output_buffer_trimmed_bytes
                        .fetch_add(trimmed as u64, Ordering::Relaxed);
                }
                let len = buffer.len() as u64;
                session
                    .io_counters
                    .output_buffer_bytes
                    .store(len, Ordering::Relaxed);
                session
                    .io_counters
                    .output_buffer_peak_bytes
                    .fetch_max(len, Ordering::Relaxed);
                drop(buffer);
                shared.ready.notify_one();
            }
            if !decode_buffer.is_empty() {
                let trailing = String::from_utf8_lossy(&decode_buffer).to_string();
                if !trailing.is_empty() {
                    let mut buffer = shared
                        .buffer
                        .lock()
                        .unwrap_or_else(|poison| poison.into_inner());
                    buffer.push_str(&trailing);
                    let trimmed =
                        trim_string_to_tail(&mut buffer, TERMINAL_OUTPUT_BUFFER_MAX_BYTES);
                    if trimmed > 0 {
                        session
                            .io_counters
                            .stdout_dropped_bytes
                            .fetch_add(trimmed as u64, Ordering::Relaxed);
                        session
                            .io_counters
                            .output_buffer_trimmed_bytes
                            .fetch_add(trimmed as u64, Ordering::Relaxed);
                    }
                    let len = buffer.len() as u64;
                    session
                        .io_counters
                        .output_buffer_bytes
                        .store(len, Ordering::Relaxed);
                    session
                        .io_counters
                        .output_buffer_peak_bytes
                        .fetch_max(len, Ordering::Relaxed);
                    drop(buffer);
                    shared.ready.notify_one();
                }
            }

            shared.done.store(true, Ordering::Relaxed);
            shared.ready.notify_one();
            let _ = emitter.join();

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

        let last_stdin_write_at = rfc3339_from_unix_ms(
            self.io_counters
                .last_stdin_write_at_ms
                .load(Ordering::Relaxed),
        );
        let last_stdout_read_at = rfc3339_from_unix_ms(
            self.io_counters
                .last_stdout_read_at_ms
                .load(Ordering::Relaxed),
        );
        let last_stdout_emit_at = rfc3339_from_unix_ms(
            self.io_counters
                .last_stdout_emit_at_ms
                .load(Ordering::Relaxed),
        );

        let io_counters = TerminalIoCountersDto {
            stdin_writes: self.io_counters.stdin_writes.load(Ordering::Relaxed),
            stdin_bytes: self.io_counters.stdin_bytes.load(Ordering::Relaxed),
            stdin_ctrl_c: self.io_counters.stdin_ctrl_c.load(Ordering::Relaxed),
            stdout_reads: self.io_counters.stdout_reads.load(Ordering::Relaxed),
            stdout_bytes: self.io_counters.stdout_bytes.load(Ordering::Relaxed),
            stdout_emits: self.io_counters.stdout_emits.load(Ordering::Relaxed),
            stdout_emit_bytes: self.io_counters.stdout_emit_bytes.load(Ordering::Relaxed),
            stdout_dropped_bytes: self
                .io_counters
                .stdout_dropped_bytes
                .load(Ordering::Relaxed),
            last_stdin_write_at,
            last_stdout_read_at,
            last_stdout_emit_at,
        };

        let output_throttle = TerminalOutputThrottleSnapshotDto {
            min_emit_interval_ms: TERMINAL_OUTPUT_MIN_EMIT_INTERVAL_MS,
            max_emit_bytes: TERMINAL_OUTPUT_MAX_EMIT_BYTES as u64,
            buffer_bytes: self.io_counters.output_buffer_bytes.load(Ordering::Relaxed),
            buffer_cap_bytes: TERMINAL_OUTPUT_BUFFER_MAX_BYTES as u64,
            buffer_peak_bytes: self
                .io_counters
                .output_buffer_peak_bytes
                .load(Ordering::Relaxed),
            buffer_trimmed_bytes: self
                .io_counters
                .output_buffer_trimmed_bytes
                .load(Ordering::Relaxed),
        };

        TerminalRendererDiagnosticsDto {
            session_id: self.meta.id.clone(),
            shell: self.meta.shell.clone(),
            cwd: self.meta.cwd.clone(),
            env_snapshot,
            last_resize,
            io_counters,
            output_throttle,
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

        self.io_counters
            .stdin_writes
            .fetch_add(1, Ordering::Relaxed);
        self.io_counters
            .stdin_bytes
            .fetch_add(data.len() as u64, Ordering::Relaxed);
        let ctrl_c = data.as_bytes().iter().filter(|&&b| b == 3).count() as u64;
        if ctrl_c > 0 {
            self.io_counters
                .stdin_ctrl_c
                .fetch_add(ctrl_c, Ordering::Relaxed);
        }
        let now_ms = Utc::now().timestamp_millis();
        if now_ms > 0 {
            self.io_counters
                .last_stdin_write_at_ms
                .store(now_ms as u64, Ordering::Relaxed);
        }
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

        self.io_counters
            .stdin_writes
            .fetch_add(1, Ordering::Relaxed);
        self.io_counters
            .stdin_bytes
            .fetch_add(data.len() as u64, Ordering::Relaxed);
        let ctrl_c = data.iter().filter(|&&b| b == 3).count() as u64;
        if ctrl_c > 0 {
            self.io_counters
                .stdin_ctrl_c
                .fetch_add(ctrl_c, Ordering::Relaxed);
        }
        let now_ms = Utc::now().timestamp_millis();
        if now_ms > 0 {
            self.io_counters
                .last_stdin_write_at_ms
                .store(now_ms as u64, Ordering::Relaxed);
        }
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
        io_counters: TerminalSessionIoCounters::default(),
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

fn rfc3339_from_unix_ms(ms: u64) -> Option<String> {
    if ms == 0 {
        return None;
    }
    chrono::DateTime::<Utc>::from_timestamp_millis(ms as i64).map(|dt| dt.to_rfc3339())
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
