use std::{
    collections::HashMap, env, ffi::OsString, path::Path, process::Stdio, sync::Arc, time::Duration,
};

use anyhow::Context;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::{broadcast, oneshot, Mutex},
};

use super::codex_protocol::{
    notification_payload, parse_incoming, request_payload, response_error_payload,
    response_success_payload, IncomingMessage, RpcResponse,
};

pub struct CodexTransport {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<RpcResponse>>>>,
    incoming_tx: broadcast::Sender<IncomingMessage>,
    next_request_id: std::sync::atomic::AtomicU64,
}

impl CodexTransport {
    pub async fn spawn(codex_executable: &str) -> anyhow::Result<Self> {
        let mut command = Command::new(codex_executable);
        if let Some(augmented_path) = codex_augmented_path(codex_executable) {
            command.env("PATH", augmented_path);
        }

        let mut child = command
            .arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| {
                format!("failed to spawn `codex app-server` using `{codex_executable}`")
            })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow::anyhow!("codex app-server stdin not available"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("codex app-server stdout not available"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow::anyhow!("codex app-server stderr not available"))?;

        let (incoming_tx, _) = broadcast::channel(1024);
        let pending = Arc::new(Mutex::new(
            HashMap::<String, oneshot::Sender<RpcResponse>>::new(),
        ));

        {
            let pending = pending.clone();
            let incoming_tx = incoming_tx.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();

                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => match parse_incoming(&line) {
                            Ok(IncomingMessage::Response(response)) => {
                                let sender = pending.lock().await.remove(&response.id);
                                if let Some(sender) = sender {
                                    let _ = sender.send(response);
                                }
                            }
                            Ok(other) => {
                                let _ = incoming_tx.send(other);
                            }
                            Err(error) => {
                                log::warn!("codex stdout parse error: {error}");
                                let _ = incoming_tx.send(IncomingMessage::Notification {
                                    method: "transport/parse_error".to_string(),
                                    params: serde_json::json!({
                                      "error": error.to_string(),
                                      "line": line,
                                    }),
                                });
                            }
                        },
                        Ok(None) => {
                            let _ = incoming_tx.send(IncomingMessage::Notification {
                                method: "transport/eof".to_string(),
                                params: serde_json::json!({}),
                            });
                            break;
                        }
                        Err(error) => {
                            log::warn!("codex stdout read error: {error}");
                            let _ = incoming_tx.send(IncomingMessage::Notification {
                                method: "transport/read_error".to_string(),
                                params: serde_json::json!({
                                  "error": error.to_string(),
                                }),
                            });
                            break;
                        }
                    }
                }
            });
        }

        {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            if !line.trim().is_empty() {
                                log::debug!("codex stderr: {line}");
                            }
                        }
                        Ok(None) => break,
                        Err(error) => {
                            log::debug!("codex stderr read error: {error}");
                            break;
                        }
                    }
                }
            });
        }

        Ok(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending,
            incoming_tx,
            next_request_id: std::sync::atomic::AtomicU64::new(1),
        })
    }

    pub fn subscribe(&self) -> broadcast::Receiver<IncomingMessage> {
        self.incoming_tx.subscribe()
    }

    pub async fn request(
        &self,
        method: &str,
        params: serde_json::Value,
        timeout: Duration,
    ) -> anyhow::Result<serde_json::Value> {
        self.ensure_alive().await?;

        let id = self
            .next_request_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            .to_string();

        let payload = request_payload(&id, method, params);
        let (sender, receiver) = oneshot::channel::<RpcResponse>();
        self.pending.lock().await.insert(id.clone(), sender);

        if let Err(error) = self.write_payload(&payload).await {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }

        let response = match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) => {
                self.pending.lock().await.remove(&id);
                anyhow::bail!("codex response channel closed for method `{method}`")
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                anyhow::bail!("codex request timeout for method `{method}`")
            }
        };

        if let Some(error) = response.error {
            anyhow::bail!("{}", error);
        }

        Ok(response.result.unwrap_or(serde_json::Value::Null))
    }

    pub async fn notify(&self, method: &str, params: serde_json::Value) -> anyhow::Result<()> {
        self.ensure_alive().await?;
        self.write_payload(&notification_payload(method, params))
            .await
    }

    pub async fn respond_success(
        &self,
        request_id: &serde_json::Value,
        result: serde_json::Value,
    ) -> anyhow::Result<()> {
        self.ensure_alive().await?;
        self.write_payload(&response_success_payload(request_id, result))
            .await
    }

    pub async fn respond_error(
        &self,
        request_id: &serde_json::Value,
        code: i64,
        message: &str,
        data: Option<serde_json::Value>,
    ) -> anyhow::Result<()> {
        self.ensure_alive().await?;
        self.write_payload(&response_error_payload(request_id, code, message, data))
            .await
    }

    pub async fn is_alive(&self) -> bool {
        self.ensure_alive().await.is_ok()
    }

    pub async fn shutdown(&self) -> anyhow::Result<()> {
        let mut child = self.child.lock().await;
        if child.try_wait()?.is_none() {
            child.kill().await.ok();
            child.wait().await.ok();
        }
        Ok(())
    }

    async fn write_payload(&self, payload: &serde_json::Value) -> anyhow::Result<()> {
        let serialized = serde_json::to_vec(payload)?;
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(&serialized)
            .await
            .context("failed writing payload to codex stdin")?;
        stdin
            .write_all(b"\n")
            .await
            .context("failed writing line terminator to codex stdin")?;
        stdin.flush().await.context("failed flushing codex stdin")?;
        Ok(())
    }

    async fn ensure_alive(&self) -> anyhow::Result<()> {
        let mut child = self.child.lock().await;
        if let Some(status) = child
            .try_wait()
            .context("failed to query codex process status")?
        {
            anyhow::bail!("codex app-server exited with status {status}");
        }
        Ok(())
    }
}

fn codex_augmented_path(executable: &str) -> Option<OsString> {
    let executable_dir = Path::new(executable).parent()?.to_path_buf();
    let mut entries = vec![executable_dir.clone()];

    if let Some(current) = env::var_os("PATH") {
        for path in env::split_paths(&current) {
            if path != executable_dir {
                entries.push(path);
            }
        }
    } else {
        for fallback in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            let fallback_path = Path::new(fallback).to_path_buf();
            if fallback_path != executable_dir {
                entries.push(fallback_path);
            }
        }
    }

    env::join_paths(entries).ok()
}
