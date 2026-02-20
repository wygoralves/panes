use std::{
    collections::HashMap,
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

use crate::models::TerminalSessionDto;

#[derive(Default)]
pub struct TerminalManager {
    workspaces: RwLock<HashMap<String, HashMap<String, Arc<TerminalSessionHandle>>>>,
}

struct TerminalSessionHandle {
    meta: TerminalSessionDto,
    process: Mutex<TerminalProcess>,
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

    pub async fn resize(
        &self,
        workspace_id: &str,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> anyhow::Result<()> {
        let session = self
            .get_session(workspace_id, session_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("terminal session not found: {session_id}"))?;
        tokio::task::spawn_blocking(move || session.resize(cols, rows))
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
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                        if !chunk.is_empty() {
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
                log::warn!("terminal wait task failed for session {}: {error}", event_session_id);
                ExitPayload::default()
            }
        };
        emit_exit(&app, &workspace_id, &event_session_id, exit);
    }
}

impl TerminalSessionHandle {
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

    fn resize(&self, cols: u16, rows: u16) -> anyhow::Result<()> {
        let process = self
            .process
            .lock()
            .map_err(|_| anyhow::anyhow!("terminal process lock poisoned"))?;
        process
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("failed resizing terminal pty")
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
        if let Err(error) = process.child.wait() {
            log::warn!("failed waiting for terminal process exit: {error}");
        }
        ExitPayload::default()
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
        if let Err(error) = process.child.wait() {
            log::warn!("failed waiting for terminal process after kill: {error}");
        }
        ExitPayload::default()
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
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    #[cfg(not(target_os = "windows"))]
    {
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
