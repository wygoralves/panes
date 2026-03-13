use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    path::{Path, PathBuf},
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
    TerminalEnvSnapshotDto, TerminalIoCountersDto, TerminalLatencySnapshotDto,
    TerminalOutputThrottleSnapshotDto, TerminalRendererDiagnosticsDto, TerminalReplayChunkDto,
    TerminalResizeSnapshotDto, TerminalResumeSessionDto, TerminalSessionDto,
};
#[cfg(target_os = "windows")]
use crate::process_utils;
use crate::runtime_env;

const TERMINAL_OUTPUT_MIN_EMIT_INTERVAL_MS: u64 = 16;
const TERMINAL_OUTPUT_MAX_EMIT_BYTES: usize = 256 * 1024;
const TERMINAL_OUTPUT_BUFFER_MAX_BYTES: usize = 4 * 1024 * 1024;
const TERMINAL_REPLAY_MAX_CHUNKS: usize = 4096;
const TERMINAL_REPLAY_MAX_BYTES: usize = 8 * 1024 * 1024;

#[derive(Default)]
pub struct TerminalManager {
    workspaces: RwLock<HashMap<String, HashMap<String, Arc<TerminalSessionHandle>>>>,
}

struct TerminalSessionHandle {
    meta: TerminalSessionDto,
    shell_pid: Option<u32>,
    diagnostics: Mutex<TerminalSessionDiagnosticsState>,
    io_counters: TerminalSessionIoCounters,
    replay_seq: AtomicU64,
    replay_state: Mutex<TerminalReplayState>,
    process: Mutex<TerminalProcess>,
}

#[derive(Default)]
struct TerminalReplayState {
    entries: VecDeque<TerminalReplayChunkDto>,
    total_bytes: usize,
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
    last_stdin_write_duration_ms: AtomicU64,
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

#[derive(Default)]
struct SharedTerminalOutputState {
    chunks: VecDeque<String>,
    total_bytes: usize,
}

struct SharedTerminalOutput {
    buffer: Mutex<SharedTerminalOutputState>,
    ready: Condvar,
    done: AtomicBool,
}

impl SharedTerminalOutput {
    fn new() -> Self {
        Self {
            buffer: Mutex::new(SharedTerminalOutputState::default()),
            ready: Condvar::new(),
            done: AtomicBool::new(false),
        }
    }

    fn push_chunk(&self, mut chunk: String) -> (usize, usize) {
        if chunk.is_empty() {
            let state = self
                .buffer
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            return (0, state.total_bytes);
        }

        if chunk.len() > TERMINAL_OUTPUT_BUFFER_MAX_BYTES {
            trim_string_to_tail(&mut chunk, TERMINAL_OUTPUT_BUFFER_MAX_BYTES);
        }

        let mut state = self
            .buffer
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        state.total_bytes += chunk.len();
        state.chunks.push_back(chunk);

        let mut trimmed = 0;
        while state.total_bytes > TERMINAL_OUTPUT_BUFFER_MAX_BYTES {
            let Some(removed) = state.chunks.pop_front() else {
                break;
            };
            state.total_bytes = state.total_bytes.saturating_sub(removed.len());
            trimmed += removed.len();
        }

        let total_bytes = state.total_bytes;
        drop(state);
        self.ready.notify_one();
        (trimmed, total_bytes)
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

fn take_output_chunks_head(state: &mut SharedTerminalOutputState, max_bytes: usize) -> String {
    if state.total_bytes == 0 {
        return String::new();
    }

    let mut payload = String::new();
    let mut payload_bytes = 0;
    while let Some(front) = state.chunks.front() {
        let front_len = front.len();
        if payload_bytes > 0 && payload_bytes + front_len > max_bytes {
            break;
        }

        if payload_bytes == 0 && front_len > max_bytes {
            let Some(mut chunk) = state.chunks.pop_front() else {
                break;
            };
            let head = take_string_head(&mut chunk, max_bytes);
            let head_len = head.len();
            state.total_bytes = state.total_bytes.saturating_sub(head_len);
            payload.push_str(&head);
            if !chunk.is_empty() {
                state.chunks.push_front(chunk);
            }
            break;
        }

        let Some(chunk) = state.chunks.pop_front() else {
            break;
        };
        state.total_bytes = state.total_bytes.saturating_sub(front_len);
        payload_bytes += front_len;
        payload.push_str(&chunk);
        if payload_bytes >= max_bytes {
            break;
        }
    }

    payload
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
    seq: u64,
    ts: String,
    data: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    session_id: String,
    code: Option<i32>,
    signal: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalForegroundChangedEvent {
    session_id: String,
    pid: Option<u32>,
    name: Option<String>,
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

    pub async fn resume_session(
        &self,
        workspace_id: &str,
        session_id: &str,
        from_seq: Option<u64>,
    ) -> anyhow::Result<TerminalResumeSessionDto> {
        let session = self
            .get_session(workspace_id, session_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("terminal session not found: {session_id}"))?;
        Ok(session.replay_since(from_seq))
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
            let emitter_shell_pid = session.shell_pid;
            let emitter = thread::spawn(move || {
                // 60Hz is enough for TUIs while keeping IPC overhead bounded.
                let min_emit_interval = Duration::from_millis(TERMINAL_OUTPUT_MIN_EMIT_INTERVAL_MS);
                let mut last_emit_at = Instant::now()
                    .checked_sub(min_emit_interval)
                    .unwrap_or_else(Instant::now);

                // Foreground process detection state — active when the PTY exposes a shell PID.
                let fg_check_interval = Duration::from_millis(1500);
                let mut last_fg_check_at: Option<Instant> = None;
                let mut last_fg_process: Option<(u32, String)> = None;

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

                        if guard.total_bytes == 0 {
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
                    if guard.total_bytes == 0 {
                        if done {
                            break;
                        }
                        drop(guard);
                        continue;
                    }

                    let payload =
                        take_output_chunks_head(&mut guard, TERMINAL_OUTPUT_MAX_EMIT_BYTES);
                    session_handle_for_emitter
                        .io_counters
                        .output_buffer_bytes
                        .store(guard.total_bytes as u64, Ordering::Relaxed);
                    drop(guard);
                    if payload.is_empty() {
                        continue;
                    }
                    let replay_chunk = session_handle_for_emitter.record_replay_chunk(payload);
                    let payload_len = replay_chunk.data.len() as u64;
                    emit_output(
                        &app_for_emitter,
                        &workspace_for_emitter,
                        &session_for_emitter,
                        replay_chunk,
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

                    // Check foreground process reactively after output, debounced to 1.5s.
                    if let Some(shell_pid) = emitter_shell_pid {
                        let should_check = last_fg_check_at
                            .map(|t| t.elapsed() >= fg_check_interval)
                            .unwrap_or(true);
                        if should_check {
                            let current = detect_foreground_process(shell_pid);
                            if current != last_fg_process {
                                emit_foreground_changed(
                                    &app_for_emitter,
                                    &workspace_for_emitter,
                                    &session_for_emitter,
                                    current.clone(),
                                );
                                last_fg_process = current;
                            }
                            last_fg_check_at = Some(Instant::now());
                        }
                    }
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
                            let (trimmed, total_bytes) =
                                shared.push_chunk(std::mem::take(&mut pending));
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
                            session
                                .io_counters
                                .output_buffer_bytes
                                .store(total_bytes as u64, Ordering::Relaxed);
                            session
                                .io_counters
                                .output_buffer_peak_bytes
                                .fetch_max(total_bytes as u64, Ordering::Relaxed);
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
                let (trimmed, total_bytes) = shared.push_chunk(std::mem::take(&mut pending));
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
                session
                    .io_counters
                    .output_buffer_bytes
                    .store(total_bytes as u64, Ordering::Relaxed);
                session
                    .io_counters
                    .output_buffer_peak_bytes
                    .fetch_max(total_bytes as u64, Ordering::Relaxed);
            }
            if !decode_buffer.is_empty() {
                let trailing = String::from_utf8_lossy(&decode_buffer).to_string();
                if !trailing.is_empty() {
                    let (trimmed, total_bytes) = shared.push_chunk(trailing);
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
                    session
                        .io_counters
                        .output_buffer_bytes
                        .store(total_bytes as u64, Ordering::Relaxed);
                    session
                        .io_counters
                        .output_buffer_peak_bytes
                        .fetch_max(total_bytes as u64, Ordering::Relaxed);
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
            last_stdin_write_duration_ms: non_zero_u64(
                self.io_counters
                    .last_stdin_write_duration_ms
                    .load(Ordering::Relaxed),
            ),
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

        let last_stdin_write_at_ms = self
            .io_counters
            .last_stdin_write_at_ms
            .load(Ordering::Relaxed);
        let last_stdout_read_at_ms = self
            .io_counters
            .last_stdout_read_at_ms
            .load(Ordering::Relaxed);
        let last_stdout_emit_at_ms = self
            .io_counters
            .last_stdout_emit_at_ms
            .load(Ordering::Relaxed);

        let latency = TerminalLatencySnapshotDto {
            stdin_to_stdout_read_ms: diff_u64(last_stdout_read_at_ms, last_stdin_write_at_ms),
            stdout_read_to_emit_ms: diff_u64(last_stdout_emit_at_ms, last_stdout_read_at_ms),
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
            latency,
            output_throttle,
        }
    }

    fn record_replay_chunk(&self, data: String) -> TerminalReplayChunkDto {
        let seq = self
            .replay_seq
            .fetch_add(1, Ordering::Relaxed)
            .saturating_add(1);
        let chunk = TerminalReplayChunkDto {
            seq,
            ts: Utc::now().to_rfc3339(),
            data,
        };
        let chunk_bytes = chunk.data.len();

        match self
            .replay_state
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal replay lock poisoned"))
        {
            Ok(mut state) => {
                state.total_bytes += chunk_bytes;
                state.entries.push_back(chunk.clone());
                while state.entries.len() > TERMINAL_REPLAY_MAX_CHUNKS
                    || state.total_bytes > TERMINAL_REPLAY_MAX_BYTES
                {
                    let Some(removed) = state.entries.pop_front() else {
                        break;
                    };
                    state.total_bytes = state.total_bytes.saturating_sub(removed.data.len());
                }
            }
            Err(error) => {
                log::warn!("failed storing terminal replay chunk: {error}");
            }
        }

        chunk
    }

    fn replay_since(&self, from_seq: Option<u64>) -> TerminalResumeSessionDto {
        let latest_seq = self.replay_seq.load(Ordering::Relaxed);
        match self
            .replay_state
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal replay lock poisoned"))
        {
            Ok(state) => {
                let oldest_available_seq = state.entries.front().map(|chunk| chunk.seq);
                let gap = match (from_seq, oldest_available_seq) {
                    (Some(from), Some(oldest)) => from.saturating_add(1) < oldest,
                    _ => false,
                };
                let chunks = state
                    .entries
                    .iter()
                    .filter(|chunk| from_seq.map(|value| chunk.seq > value).unwrap_or(true))
                    .cloned()
                    .collect();

                TerminalResumeSessionDto {
                    latest_seq,
                    oldest_available_seq,
                    gap,
                    chunks,
                }
            }
            Err(error) => {
                log::warn!("failed reading terminal replay chunk: {error}");
                TerminalResumeSessionDto {
                    latest_seq,
                    oldest_available_seq: None,
                    gap: false,
                    chunks: Vec::new(),
                }
            }
        }
    }

    fn write(&self, data: &str) -> anyhow::Result<()> {
        let started_at = Instant::now();
        let mut process = self
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal process lock poisoned"))?;
        process
            .writer
            .write_all(data.as_bytes())
            .context("failed writing to terminal stdin")?;
        let write_duration_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;

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
        self.io_counters
            .last_stdin_write_duration_ms
            .store(write_duration_ms, Ordering::Relaxed);
        let now_ms = Utc::now().timestamp_millis();
        if now_ms > 0 {
            self.io_counters
                .last_stdin_write_at_ms
                .store(now_ms as u64, Ordering::Relaxed);
        }
        Ok(())
    }

    fn write_raw(&self, data: &[u8]) -> anyhow::Result<()> {
        let started_at = Instant::now();
        let mut process = self
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal process lock poisoned"))?;
        process
            .writer
            .write_all(data)
            .context("failed writing bytes to terminal stdin")?;
        let write_duration_ms = started_at.elapsed().as_millis().min(u64::MAX as u128) as u64;

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
        self.io_counters
            .last_stdin_write_duration_ms
            .store(write_duration_ms, Ordering::Relaxed);
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
        for arg in runtime_env::terminal_shell_args(Path::new(&shell)) {
            cmd.arg(arg);
        }
    }
    let child = pair
        .slave
        .spawn_command(cmd)
        .context("failed spawning terminal shell process")?;
    // process_id() returns None on platforms where the PID is unavailable;
    // in that case terminal_foreground_process will gracefully return None.
    let shell_pid = child.process_id();
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
        shell_pid,
        diagnostics: Mutex::new(TerminalSessionDiagnosticsState {
            env_snapshot,
            last_resize: None,
            last_zero_pixel_warning_at_ms: None,
        }),
        io_counters: TerminalSessionIoCounters::default(),
        replay_seq: AtomicU64::new(0),
        replay_state: Mutex::new(TerminalReplayState::default()),
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
        runtime_env::terminal_shell().display().to_string()
    }
}

#[derive(Debug, Clone, Default)]
struct TerminalEnvInputs {
    term: Option<String>,
    colorterm: Option<String>,
    term_program: Option<String>,
    term_program_version: Option<String>,
    home: Option<String>,
    xdg_config_home: Option<String>,
    xdg_data_home: Option<String>,
    xdg_cache_home: Option<String>,
    xdg_state_home: Option<String>,
    tmpdir: Option<String>,
    lang: Option<String>,
    lc_all: Option<String>,
    lc_ctype: Option<String>,
    path: Option<String>,
    user_profile: Option<String>,
    local_app_data: Option<String>,
    roaming_app_data: Option<String>,
    temp: Option<String>,
    tmp: Option<String>,
    default_home: Option<String>,
    default_local_app_data: Option<String>,
    default_roaming_app_data: Option<String>,
    default_temp_dir: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct TerminalEnvConfig {
    is_windows: bool,
    snapshot: TerminalEnvSnapshotDto,
    user_profile: Option<String>,
    local_app_data: Option<String>,
    roaming_app_data: Option<String>,
    temp: Option<String>,
    tmp: Option<String>,
}

fn configure_terminal_env(cmd: &mut CommandBuilder) -> TerminalEnvSnapshotDto {
    let config = build_terminal_env_config();
    apply_terminal_env(cmd, &config);
    config.snapshot
}

fn build_terminal_path(_home: Option<&str>) -> Option<String> {
    let joined = runtime_env::augmented_path()?;
    let rendered = joined.to_string_lossy().to_string();
    if rendered.trim().is_empty() {
        None
    } else {
        Some(rendered)
    }
}

fn read_terminal_env_inputs() -> TerminalEnvInputs {
    TerminalEnvInputs {
        term: read_non_empty_env("TERM"),
        colorterm: read_non_empty_env("COLORTERM"),
        term_program: read_non_empty_env("TERM_PROGRAM"),
        term_program_version: read_non_empty_env("TERM_PROGRAM_VERSION"),
        home: read_non_empty_env("HOME"),
        xdg_config_home: read_non_empty_env("XDG_CONFIG_HOME"),
        xdg_data_home: read_non_empty_env("XDG_DATA_HOME"),
        xdg_cache_home: read_non_empty_env("XDG_CACHE_HOME"),
        xdg_state_home: read_non_empty_env("XDG_STATE_HOME"),
        tmpdir: read_non_empty_env("TMPDIR"),
        lang: read_non_empty_env("LANG"),
        lc_all: read_non_empty_env("LC_ALL"),
        lc_ctype: read_non_empty_env("LC_CTYPE"),
        path: build_terminal_path(None).or_else(|| read_non_empty_env("PATH")),
        user_profile: read_non_empty_env("USERPROFILE"),
        local_app_data: read_non_empty_env("LOCALAPPDATA"),
        roaming_app_data: read_non_empty_env("APPDATA"),
        temp: read_non_empty_env("TEMP"),
        tmp: read_non_empty_env("TMP"),
        default_home: runtime_env::home_dir().map(path_to_string),
        default_local_app_data: runtime_env::local_app_data_dir().map(path_to_string),
        default_roaming_app_data: runtime_env::roaming_app_data_dir().map(path_to_string),
        default_temp_dir: Some(path_to_string(std::env::temp_dir())),
    }
}

fn build_terminal_env_config() -> TerminalEnvConfig {
    build_terminal_env_config_for(cfg!(target_os = "windows"), read_terminal_env_inputs())
}

fn build_terminal_env_config_for(is_windows: bool, inputs: TerminalEnvInputs) -> TerminalEnvConfig {
    let term = match inputs.term.as_deref() {
        Some("dumb") | None => Some("xterm-256color".to_string()),
        Some(value) => Some(value.to_string()),
    };
    let colorterm = inputs.colorterm.or_else(|| Some("truecolor".to_string()));
    let term_program = inputs.term_program.or_else(|| Some("Panes".to_string()));
    let term_program_version = inputs
        .term_program_version
        .or_else(|| Some(env!("CARGO_PKG_VERSION").to_string()));
    let path = inputs.path;

    if is_windows {
        let user_profile = inputs
            .user_profile
            .clone()
            .or(inputs.default_home.clone())
            .or(inputs.home.clone());
        let home = inputs
            .home
            .or_else(|| user_profile.clone())
            .or(inputs.default_home);
        let windows_home = user_profile.clone().or_else(|| home.clone());
        let local_app_data = inputs
            .local_app_data
            .or(inputs.default_local_app_data)
            .or_else(|| {
                windows_home
                    .as_ref()
                    .map(|value| path_to_string(Path::new(value).join("AppData").join("Local")))
            })
            .or_else(|| inputs.roaming_app_data.clone())
            .or(inputs.default_roaming_app_data.clone());
        let roaming_app_data = inputs
            .roaming_app_data
            .or(inputs.default_roaming_app_data)
            .or_else(|| {
                windows_home
                    .as_ref()
                    .map(|value| path_to_string(Path::new(value).join("AppData").join("Roaming")))
            })
            .or_else(|| local_app_data.clone());
        let temp = inputs
            .temp
            .or_else(|| inputs.tmp.clone())
            .or_else(|| {
                local_app_data
                    .as_ref()
                    .map(|value| path_to_string(Path::new(value).join("Temp")))
            })
            .or(inputs.default_temp_dir);
        let tmp = inputs.tmp.or_else(|| temp.clone());
        let tmpdir = inputs.tmpdir.or_else(|| temp.clone());

        return TerminalEnvConfig {
            is_windows,
            snapshot: TerminalEnvSnapshotDto {
                term,
                colorterm,
                term_program,
                term_program_version,
                home,
                user_profile: user_profile.clone(),
                app_data: roaming_app_data.clone(),
                local_app_data: local_app_data.clone(),
                xdg_config_home: None,
                xdg_data_home: None,
                xdg_cache_home: None,
                xdg_state_home: None,
                tmpdir,
                temp: temp.clone(),
                tmp: tmp.clone(),
                lang: None,
                lc_all: None,
                lc_ctype: None,
                path,
            },
            user_profile,
            local_app_data,
            roaming_app_data,
            temp,
            tmp,
        };
    }

    let home = inputs.home.or(inputs.default_home);

    let xdg_config_home = inputs
        .xdg_config_home
        .or_else(|| home.as_ref().map(|value| format!("{value}/.config")));
    let xdg_data_home = inputs
        .xdg_data_home
        .or_else(|| home.as_ref().map(|value| format!("{value}/.local/share")));
    let xdg_cache_home = inputs
        .xdg_cache_home
        .or_else(|| home.as_ref().map(|value| format!("{value}/.cache")));
    let xdg_state_home = inputs
        .xdg_state_home
        .or_else(|| home.as_ref().map(|value| format!("{value}/.local/state")));
    let tmpdir = inputs.tmpdir;
    let lang = inputs.lang.or_else(|| Some("en_US.UTF-8".to_string()));
    let lc_ctype = inputs.lc_ctype.or_else(|| lang.clone());
    let lc_all = inputs.lc_all;

    TerminalEnvConfig {
        is_windows,
        snapshot: TerminalEnvSnapshotDto {
            term,
            colorterm,
            term_program,
            term_program_version,
            home,
            user_profile: None,
            app_data: None,
            local_app_data: None,
            xdg_config_home,
            xdg_data_home,
            xdg_cache_home,
            xdg_state_home,
            tmpdir,
            temp: None,
            tmp: None,
            lang,
            lc_all,
            lc_ctype,
            path,
        },
        user_profile: None,
        local_app_data: None,
        roaming_app_data: None,
        temp: None,
        tmp: None,
    }
}

fn apply_terminal_env(cmd: &mut CommandBuilder, config: &TerminalEnvConfig) {
    if let Some(value) = config.snapshot.term.as_deref() {
        cmd.env("TERM", value);
    }
    if let Some(value) = config.snapshot.colorterm.as_deref() {
        cmd.env("COLORTERM", value);
    }
    if let Some(value) = config.snapshot.term_program.as_deref() {
        cmd.env("TERM_PROGRAM", value);
    }
    if let Some(value) = config.snapshot.term_program_version.as_deref() {
        cmd.env("TERM_PROGRAM_VERSION", value);
    }
    cmd.env("PANES_TERM_PROGRAM", "Panes");
    cmd.env("PANES_TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    if let Some(value) = config.snapshot.home.as_deref() {
        cmd.env("HOME", value);
    }
    if let Some(value) = config.snapshot.path.as_deref() {
        cmd.env("PATH", value);
    }
    if let Some(value) = config.snapshot.tmpdir.as_deref() {
        cmd.env("TMPDIR", value);
    }

    if config.is_windows {
        if let Some(value) = config.user_profile.as_deref() {
            cmd.env("USERPROFILE", value);
        }
        if let Some(value) = config.local_app_data.as_deref() {
            cmd.env("LOCALAPPDATA", value);
        }
        if let Some(value) = config.roaming_app_data.as_deref() {
            cmd.env("APPDATA", value);
        }
        if let Some(value) = config.temp.as_deref() {
            cmd.env("TEMP", value);
        }
        if let Some(value) = config.tmp.as_deref() {
            cmd.env("TMP", value);
        }

        ensure_dir_exists("LOCALAPPDATA", config.local_app_data.as_deref());
        ensure_dir_exists("APPDATA", config.roaming_app_data.as_deref());
        ensure_dir_exists("TMPDIR", config.snapshot.tmpdir.as_deref());
        ensure_dir_exists("TEMP", config.temp.as_deref());
        ensure_dir_exists("TMP", config.tmp.as_deref());
        return;
    }

    if let Some(value) = config.snapshot.xdg_config_home.as_deref() {
        cmd.env("XDG_CONFIG_HOME", value);
    }
    if let Some(value) = config.snapshot.xdg_data_home.as_deref() {
        cmd.env("XDG_DATA_HOME", value);
    }
    if let Some(value) = config.snapshot.xdg_cache_home.as_deref() {
        cmd.env("XDG_CACHE_HOME", value);
    }
    if let Some(value) = config.snapshot.xdg_state_home.as_deref() {
        cmd.env("XDG_STATE_HOME", value);
    }
    if let Some(value) = config.snapshot.lang.as_deref() {
        cmd.env("LANG", value);
    }
    if let Some(value) = config.snapshot.lc_ctype.as_deref() {
        cmd.env("LC_CTYPE", value);
    }
    if let Some(value) = config.snapshot.lc_all.as_deref() {
        cmd.env("LC_ALL", value);
    }

    ensure_dir_exists(
        "XDG_CONFIG_HOME",
        config.snapshot.xdg_config_home.as_deref(),
    );
    ensure_dir_exists("XDG_DATA_HOME", config.snapshot.xdg_data_home.as_deref());
    ensure_dir_exists("XDG_CACHE_HOME", config.snapshot.xdg_cache_home.as_deref());
    ensure_dir_exists("XDG_STATE_HOME", config.snapshot.xdg_state_home.as_deref());
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

fn path_to_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().to_string()
}

fn rfc3339_from_unix_ms(ms: u64) -> Option<String> {
    if ms == 0 {
        return None;
    }
    chrono::DateTime::<Utc>::from_timestamp_millis(ms as i64).map(|dt| dt.to_rfc3339())
}

fn non_zero_u64(value: u64) -> Option<u64> {
    if value == 0 {
        None
    } else {
        Some(value)
    }
}

fn diff_u64(later: u64, earlier: u64) -> Option<u64> {
    if later == 0 || earlier == 0 || later < earlier {
        None
    } else {
        Some(later - earlier)
    }
}

fn emit_output(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    chunk: TerminalReplayChunkDto,
) {
    let event_name = format!("terminal-output-{workspace_id}");
    let payload = TerminalOutputEvent {
        session_id: session_id.to_string(),
        seq: chunk.seq,
        ts: chunk.ts,
        data: chunk.data,
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

fn emit_foreground_changed(
    app: &AppHandle,
    workspace_id: &str,
    session_id: &str,
    fg: Option<(u32, String)>,
) {
    let event_name = format!("terminal-fg-changed-{workspace_id}");
    let payload = TerminalForegroundChangedEvent {
        session_id: session_id.to_string(),
        pid: fg.as_ref().map(|(pid, _)| *pid),
        name: fg.map(|(_, name)| name),
    };
    let _ = app.emit(&event_name, payload);
}

/// Detect the foreground child process of the given shell PID.
/// Returns `Some((pid, name))` if a child is running, `None` otherwise.
/// Note: the pgrep→ps sequence is not atomic — the child could exit between calls.
#[cfg(not(target_os = "windows"))]
fn detect_foreground_process(shell_pid: u32) -> Option<(u32, String)> {
    let output = std::process::Command::new("pgrep")
        .args(["-P", &shell_pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Take the last child PID (most recently spawned).
    // This heuristic may miss the true foreground process when background
    // jobs are present; a more robust approach would use tcgetpgrp() on
    // the PTY master fd.
    let child_pid_str = stdout.lines().rfind(|l| !l.trim().is_empty())?;
    let child_pid: u32 = child_pid_str.trim().parse().ok()?;

    // Get both the binary name (comm) and full command line (args).
    // For native binaries (e.g. claude), comm is sufficient.
    // For interpreter-based tools (e.g. node running codex), we need
    // to parse args to find the actual tool name.
    let ps_output = std::process::Command::new("ps")
        .args(["-o", "comm=", "-p", &child_pid.to_string()])
        .output()
        .ok()?;
    if !ps_output.status.success() {
        return None;
    }
    let comm = String::from_utf8_lossy(&ps_output.stdout)
        .trim()
        .to_string();
    if comm.is_empty() {
        return None;
    }
    let short_comm = comm.rsplit('/').next().unwrap_or(&comm).to_string();

    // If comm is a known interpreter, parse args to find the actual tool name.
    if is_interpreter(&short_comm) {
        if let Some(tool_name) = extract_tool_name_from_args(child_pid) {
            return Some((child_pid, tool_name));
        }
    }

    Some((child_pid, short_comm))
}

/// Returns true if the binary name is a known script interpreter.
#[cfg(not(target_os = "windows"))]
fn is_interpreter(comm: &str) -> bool {
    matches!(
        comm,
        "node"
            | "nodejs"
            | "python"
            | "python3"
            | "ruby"
            | "perl"
            | "deno"
            | "bun"
            | "tsx"
            | "ts-node"
            | "npx"
    )
}

/// Extract the tool name from process args (e.g. "node /path/to/codex.js" → "codex").
#[cfg(not(target_os = "windows"))]
fn extract_tool_name_from_args(pid: u32) -> Option<String> {
    let output = std::process::Command::new("ps")
        .args(["-o", "args=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let args_str = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Split into argv, skip the interpreter and any flags (starting with -)
    // to find the first path-like argument (the script being run).
    let script = args_str
        .split_whitespace()
        .skip(1) // skip the interpreter itself
        .find(|arg| !arg.starts_with('-'))?;

    // Extract basename and strip common extensions
    let basename = script.rsplit('/').next().unwrap_or(script);
    let name = basename
        .strip_suffix(".js")
        .or_else(|| basename.strip_suffix(".mjs"))
        .or_else(|| basename.strip_suffix(".cjs"))
        .or_else(|| basename.strip_suffix(".ts"))
        .or_else(|| basename.strip_suffix(".mts"))
        .or_else(|| basename.strip_suffix(".py"))
        .or_else(|| basename.strip_suffix(".rb"))
        .or_else(|| basename.strip_suffix(".pl"))
        .unwrap_or(basename);

    if name.is_empty() {
        return None;
    }
    Some(name.to_string())
}

#[cfg(any(target_os = "windows", test))]
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WindowsChildProcess {
    process_id: u32,
    name: Option<String>,
    command_line: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(untagged)]
enum WindowsChildProcessResponse {
    One(WindowsChildProcess),
    Many(Vec<WindowsChildProcess>),
}

#[cfg(target_os = "windows")]
impl WindowsChildProcessResponse {
    fn into_vec(self) -> Vec<WindowsChildProcess> {
        match self {
            Self::One(process) => vec![process],
            Self::Many(processes) => processes,
        }
    }
}

#[cfg(target_os = "windows")]
fn detect_foreground_process(shell_pid: u32) -> Option<(u32, String)> {
    let script = format!(
        "$children = @(Get-CimInstance Win32_Process -Filter 'ParentProcessId = {shell_pid}' | Sort-Object ProcessId | Select-Object ProcessId, Name, CommandLine); if ($children.Count -eq 0) {{ exit 1 }}; $children | ConvertTo-Json -Compress"
    );
    let mut command = std::process::Command::new("powershell.exe");
    process_utils::configure_std_command(&mut command);
    let output = command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &script,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let processes = serde_json::from_slice::<WindowsChildProcessResponse>(&output.stdout)
        .ok()?
        .into_vec();
    select_windows_foreground_process(&processes)
}

#[cfg(any(target_os = "windows", test))]
fn select_windows_foreground_process(processes: &[WindowsChildProcess]) -> Option<(u32, String)> {
    let mut ordered = processes.to_vec();
    ordered.sort_by_key(|process| process.process_id);

    for process in ordered.into_iter().rev() {
        let raw_name = process.name.as_deref().unwrap_or("").trim();
        if raw_name.is_empty() {
            continue;
        }

        let normalized_name = normalize_process_token(raw_name)?;
        if is_windows_infrastructure_process(&normalized_name) {
            continue;
        }

        if let Some(command_line) = process.command_line.as_deref() {
            if let Some(tool_name) =
                extract_tool_name_from_windows_command_line(&normalized_name, command_line)
            {
                if !is_windows_infrastructure_process(&tool_name)
                    && !is_windows_shell_or_interpreter(&tool_name)
                {
                    return Some((process.process_id, tool_name));
                }
            }
        }

        if !is_windows_shell_or_interpreter(&normalized_name) {
            return Some((process.process_id, normalized_name));
        }
    }

    None
}

#[cfg(any(target_os = "windows", test))]
fn normalize_process_token(token: &str) -> Option<String> {
    let trimmed = token
        .trim()
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`'));
    if trimmed.is_empty() {
        return None;
    }

    let basename = trimmed
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(trimmed)
        .trim()
        .trim_matches(|ch| matches!(ch, '"' | '\'' | '`'));
    if basename.is_empty() {
        return None;
    }

    let lowercase = basename.to_ascii_lowercase();
    let normalized = strip_known_process_suffix(&lowercase);
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

#[cfg(any(target_os = "windows", test))]
fn strip_known_process_suffix(value: &str) -> &str {
    value
        .strip_suffix(".exe")
        .or_else(|| value.strip_suffix(".cmd"))
        .or_else(|| value.strip_suffix(".bat"))
        .or_else(|| value.strip_suffix(".ps1"))
        .or_else(|| value.strip_suffix(".mjs"))
        .or_else(|| value.strip_suffix(".cjs"))
        .or_else(|| value.strip_suffix(".js"))
        .or_else(|| value.strip_suffix(".mts"))
        .or_else(|| value.strip_suffix(".ts"))
        .or_else(|| value.strip_suffix(".py"))
        .or_else(|| value.strip_suffix(".rb"))
        .or_else(|| value.strip_suffix(".pl"))
        .unwrap_or(value)
}

#[cfg(any(target_os = "windows", test))]
fn is_windows_infrastructure_process(name: &str) -> bool {
    matches!(name, "conhost" | "openconsole")
}

#[cfg(any(target_os = "windows", test))]
fn is_windows_shell_or_interpreter(name: &str) -> bool {
    matches!(
        name,
        "cmd"
            | "powershell"
            | "pwsh"
            | "node"
            | "nodejs"
            | "python"
            | "python3"
            | "ruby"
            | "perl"
            | "deno"
            | "bun"
            | "tsx"
            | "ts-node"
            | "npx"
    )
}

#[cfg(any(target_os = "windows", test))]
fn extract_tool_name_from_windows_command_line(
    process_name: &str,
    command_line: &str,
) -> Option<String> {
    let tokens = split_command_line_words(command_line);
    if tokens.is_empty() {
        return None;
    }

    match process_name {
        "cmd" => extract_tool_name_from_cmd_tokens(&tokens),
        "powershell" | "pwsh" => extract_tool_name_from_powershell_tokens(&tokens),
        name if is_windows_shell_or_interpreter(name) => {
            extract_tool_name_from_token_sequence(&tokens[1..])
        }
        _ => Some(process_name.to_string()),
    }
}

#[cfg(any(target_os = "windows", test))]
fn extract_tool_name_from_cmd_tokens(tokens: &[String]) -> Option<String> {
    if let Some(index) = tokens
        .iter()
        .position(|token| matches_ignore_ascii_case(token, ["/c", "/k"]))
    {
        return extract_tool_name_from_token_sequence(&tokens[index + 1..]);
    }

    extract_tool_name_from_token_sequence(&tokens[1..])
}

#[cfg(any(target_os = "windows", test))]
fn extract_tool_name_from_powershell_tokens(tokens: &[String]) -> Option<String> {
    for (index, token) in tokens.iter().enumerate() {
        if matches_ignore_ascii_case(token, ["-command", "-c", "-file"]) {
            return extract_tool_name_from_token_sequence(&tokens[index + 1..]);
        }
    }

    extract_tool_name_from_token_sequence(&tokens[1..])
}

#[cfg(any(target_os = "windows", test))]
fn extract_tool_name_from_token_sequence(tokens: &[String]) -> Option<String> {
    for (index, token) in tokens.iter().enumerate() {
        let trimmed = token.trim();
        if trimmed.is_empty() || matches!(trimmed, "&" | "." | "call" | "start") {
            continue;
        }
        if looks_like_command_flag(trimmed) {
            continue;
        }

        if trimmed.contains(char::is_whitespace) {
            if let Some(name) = extract_tool_name_from_windows_command_line_snippet(trimmed) {
                return Some(name);
            }
        }

        let candidate = match normalize_process_token(trimmed) {
            Some(value) => value,
            None => continue,
        };

        if is_windows_infrastructure_process(&candidate) {
            continue;
        }

        if is_windows_shell_or_interpreter(&candidate) {
            if let Some(name) = extract_tool_name_from_token_sequence(&tokens[index + 1..]) {
                return Some(name);
            }
            continue;
        }

        return Some(candidate);
    }

    None
}

#[cfg(any(target_os = "windows", test))]
fn extract_tool_name_from_windows_command_line_snippet(snippet: &str) -> Option<String> {
    let nested = split_command_line_words(snippet);
    if nested.is_empty() {
        return None;
    }
    extract_tool_name_from_token_sequence(&nested)
}

#[cfg(any(target_os = "windows", test))]
fn looks_like_command_flag(token: &str) -> bool {
    (token.starts_with('-') || token.starts_with('/'))
        && !token.contains('\\')
        && !token.contains(':')
}

#[cfg(any(target_os = "windows", test))]
fn split_command_line_words(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut active_quote: Option<char> = None;

    for ch in input.chars() {
        match active_quote {
            Some(quote) if ch == quote => {
                active_quote = None;
            }
            Some(_) => current.push(ch),
            None if ch == '"' || ch == '\'' => {
                active_quote = Some(ch);
            }
            None if ch.is_whitespace() => {
                if !current.is_empty() {
                    tokens.push(std::mem::take(&mut current));
                }
            }
            None => current.push(ch),
        }
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
}

#[cfg(any(target_os = "windows", test))]
fn matches_ignore_ascii_case<const N: usize>(value: &str, options: [&str; N]) -> bool {
    options
        .iter()
        .any(|option| value.eq_ignore_ascii_case(option))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn normalize_path(path: &str) -> String {
        path.replace('\\', "/")
    }

    #[test]
    fn windows_terminal_env_prefers_windows_dirs_without_unix_overrides() {
        let config = build_terminal_env_config_for(
            true,
            TerminalEnvInputs {
                default_home: Some(r"C:\Users\panes".to_string()),
                default_local_app_data: Some(r"C:\Users\panes\AppData\Local".to_string()),
                default_roaming_app_data: Some(r"C:\Users\panes\AppData\Roaming".to_string()),
                default_temp_dir: Some(r"C:\Users\panes\AppData\Local\Temp".to_string()),
                path: Some(r"C:\Tools;C:\Windows\System32".to_string()),
                ..TerminalEnvInputs::default()
            },
        );

        assert_eq!(
            config
                .snapshot
                .home
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes")
        );
        assert_eq!(
            config
                .user_profile
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes")
        );
        assert_eq!(
            config
                .snapshot
                .user_profile
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes")
        );
        assert_eq!(
            config
                .local_app_data
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes/AppData/Local")
        );
        assert_eq!(
            config
                .snapshot
                .local_app_data
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes/AppData/Local")
        );
        assert_eq!(
            config
                .roaming_app_data
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes/AppData/Roaming")
        );
        assert_eq!(
            config
                .snapshot
                .app_data
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes/AppData/Roaming")
        );
        assert_eq!(
            config.temp.as_deref().map(normalize_path).as_deref(),
            Some("C:/Users/panes/AppData/Local/Temp")
        );
        assert_eq!(
            config
                .snapshot
                .temp
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes/AppData/Local/Temp")
        );
        assert_eq!(
            config.tmp.as_deref().map(normalize_path).as_deref(),
            Some("C:/Users/panes/AppData/Local/Temp")
        );
        assert_eq!(
            config
                .snapshot
                .tmp
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes/AppData/Local/Temp")
        );
        assert!(config.snapshot.xdg_config_home.is_none());
        assert!(config.snapshot.xdg_data_home.is_none());
        assert!(config.snapshot.xdg_cache_home.is_none());
        assert!(config.snapshot.xdg_state_home.is_none());
        assert_eq!(
            config
                .snapshot
                .tmpdir
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes/AppData/Local/Temp")
        );
        assert!(config.snapshot.lang.is_none());
        assert!(config.snapshot.lc_all.is_none());
        assert!(config.snapshot.lc_ctype.is_none());
        assert_eq!(
            config.snapshot.path.as_deref(),
            Some(r"C:\Tools;C:\Windows\System32")
        );
    }

    #[test]
    fn windows_terminal_env_uses_user_profile_for_windows_dirs() {
        let config = build_terminal_env_config_for(
            true,
            TerminalEnvInputs {
                home: Some("/c/Users/panes".to_string()),
                user_profile: Some(r"C:\Users\panes".to_string()),
                path: Some(r"C:\Tools;C:\Windows\System32".to_string()),
                ..TerminalEnvInputs::default()
            },
        );

        assert_eq!(
            config
                .snapshot
                .home
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("/c/Users/panes")
        );
        assert_eq!(
            config
                .snapshot
                .user_profile
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes")
        );
        assert_eq!(
            config
                .local_app_data
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes/AppData/Local")
        );
        assert_eq!(
            config
                .roaming_app_data
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes/AppData/Roaming")
        );
    }

    #[test]
    fn windows_command_line_extracts_tool_from_cmd_wrapper() {
        let tool = extract_tool_name_from_windows_command_line(
            "cmd",
            r#"cmd.exe /d /s /c "codex --help""#,
        );

        assert_eq!(tool.as_deref(), Some("codex"));
    }

    #[test]
    fn windows_command_line_extracts_tool_from_node_script() {
        let tool = extract_tool_name_from_windows_command_line(
            "node",
            r#""C:\Program Files\nodejs\node.exe" "C:\Users\panes\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js" --version"#,
        );

        assert_eq!(tool.as_deref(), Some("codex"));
    }

    #[test]
    fn windows_command_line_extracts_tool_from_powershell_wrapper() {
        let tool = extract_tool_name_from_windows_command_line(
            "powershell",
            r#"powershell.exe -NoProfile -Command "& 'C:\Users\panes\AppData\Roaming\npm\claude.cmd' --help""#,
        );

        assert_eq!(tool.as_deref(), Some("claude"));
    }

    #[test]
    fn windows_foreground_process_skips_conhost_and_uses_wrapped_tool_name() {
        let selected = select_windows_foreground_process(&[
            WindowsChildProcess {
                process_id: 4200,
                name: Some("conhost.exe".to_string()),
                command_line: Some(r#"C:\Windows\System32\conhost.exe 0x4"#.to_string()),
            },
            WindowsChildProcess {
                process_id: 4201,
                name: Some("cmd.exe".to_string()),
                command_line: Some(r#"cmd.exe /d /s /c "gemini --help""#.to_string()),
            },
        ]);

        assert_eq!(selected, Some((4201, "gemini".to_string())));
    }

    #[test]
    fn unix_terminal_env_keeps_xdg_and_locale_defaults() {
        let config = build_terminal_env_config_for(
            false,
            TerminalEnvInputs {
                home: Some("/home/panes".to_string()),
                path: Some("/custom/bin:/usr/bin".to_string()),
                ..TerminalEnvInputs::default()
            },
        );

        assert_eq!(config.snapshot.home.as_deref(), Some("/home/panes"));
        assert_eq!(
            config.snapshot.xdg_config_home.as_deref(),
            Some("/home/panes/.config")
        );
        assert_eq!(
            config.snapshot.xdg_data_home.as_deref(),
            Some("/home/panes/.local/share")
        );
        assert_eq!(
            config.snapshot.xdg_cache_home.as_deref(),
            Some("/home/panes/.cache")
        );
        assert_eq!(
            config.snapshot.xdg_state_home.as_deref(),
            Some("/home/panes/.local/state")
        );
        assert_eq!(config.snapshot.lang.as_deref(), Some("en_US.UTF-8"));
        assert_eq!(config.snapshot.lc_ctype.as_deref(), Some("en_US.UTF-8"));
        assert!(config.snapshot.lc_all.is_none());
        assert_eq!(
            config.snapshot.path.as_deref(),
            Some("/custom/bin:/usr/bin")
        );
        assert!(config.snapshot.user_profile.is_none());
        assert!(config.snapshot.app_data.is_none());
        assert!(config.snapshot.local_app_data.is_none());
        assert!(config.snapshot.temp.is_none());
        assert!(config.snapshot.tmp.is_none());
        assert!(config.user_profile.is_none());
        assert!(config.local_app_data.is_none());
        assert!(config.roaming_app_data.is_none());
        assert!(config.temp.is_none());
        assert!(config.tmp.is_none());
    }

    #[test]
    fn windows_terminal_env_preserves_explicit_home() {
        let config = build_terminal_env_config_for(
            true,
            TerminalEnvInputs {
                home: Some(r"D:\custom-home".to_string()),
                user_profile: Some(r"C:\Users\panes".to_string()),
                local_app_data: Some(r"C:\Users\panes\AppData\Local".to_string()),
                roaming_app_data: Some(r"C:\Users\panes\AppData\Roaming".to_string()),
                temp: Some(r"C:\Users\panes\AppData\Local\Temp".to_string()),
                ..TerminalEnvInputs::default()
            },
        );

        assert_eq!(
            config
                .snapshot
                .home
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("D:/custom-home")
        );
        assert_eq!(
            config
                .snapshot
                .user_profile
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes")
        );
        assert_eq!(
            config
                .snapshot
                .local_app_data
                .as_deref()
                .map(normalize_path)
                .as_deref(),
            Some("C:/Users/panes/AppData/Local")
        );
    }
}
