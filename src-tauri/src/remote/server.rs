use std::{net::SocketAddr, sync::Arc};

use anyhow::Context;
use futures::{Sink, SinkExt, StreamExt};
use serde::Deserialize;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{broadcast, Mutex},
    task::JoinHandle,
};
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::{
        handshake::server::{Request, Response},
        protocol::{frame::coding::CloseCode, CloseFrame, Message},
    },
};
use tokio_util::sync::CancellationToken;

use crate::{
    db::Database,
    models::{RemoteDeviceGrantDto, RemoteHostStatusDto},
    remote::{
        protocol::{RemoteCommandRequest, RemoteEventEnvelope},
        router::{grant_allows_scope, RemoteCommandRouter},
    },
    state::AppState,
    terminal::TerminalManager,
};

const DEFAULT_REMOTE_HOST_BIND_ADDR: &str = "127.0.0.1:0";
const REMOTE_EVENT_CHANNEL_CAPACITY: usize = 512;

struct RunningRemoteHost {
    bind_addr: SocketAddr,
    shutdown: CancellationToken,
    join_handle: JoinHandle<()>,
}

pub struct RemoteHostManager {
    db: Database,
    event_tx: broadcast::Sender<RemoteEventEnvelope>,
    running: Mutex<Option<RunningRemoteHost>>,
}

impl RemoteHostManager {
    pub fn new(db: Database) -> Self {
        let (event_tx, _) = broadcast::channel(REMOTE_EVENT_CHANNEL_CAPACITY);
        Self {
            db,
            event_tx,
            running: Mutex::new(None),
        }
    }

    pub fn publish_event<T>(&self, channel: &str, payload: &T)
    where
        T: serde::Serialize,
    {
        let payload = match serde_json::to_value(payload) {
            Ok(payload) => payload,
            Err(error) => {
                log::warn!("failed to encode remote host event payload for {channel}: {error}");
                return;
            }
        };
        let _ = self.event_tx.send(RemoteEventEnvelope {
            channel: channel.to_string(),
            payload,
        });
    }

    pub async fn status(&self) -> RemoteHostStatusDto {
        let running = self.running.lock().await;
        match running.as_ref() {
            Some(host) => RemoteHostStatusDto {
                running: true,
                bind_addr: Some(host.bind_addr.to_string()),
            },
            None => RemoteHostStatusDto {
                running: false,
                bind_addr: None,
            },
        }
    }

    pub async fn start(
        &self,
        bind_addr: Option<&str>,
        terminals: Arc<TerminalManager>,
    ) -> Result<RemoteHostStatusDto, String> {
        self.start_inner(bind_addr, terminals, None, None).await
    }

    pub async fn start_with_runtime(
        &self,
        bind_addr: Option<&str>,
        state: AppState,
        app_handle: tauri::AppHandle,
    ) -> Result<RemoteHostStatusDto, String> {
        self.start_inner(
            bind_addr,
            state.terminals.clone(),
            Some(state),
            Some(app_handle),
        )
        .await
    }

    async fn start_inner(
        &self,
        bind_addr: Option<&str>,
        terminals: Arc<TerminalManager>,
        state: Option<AppState>,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<RemoteHostStatusDto, String> {
        let mut running = self.running.lock().await;
        if let Some(host) = running.as_ref() {
            return Ok(RemoteHostStatusDto {
                running: true,
                bind_addr: Some(host.bind_addr.to_string()),
            });
        }

        let listener = TcpListener::bind(bind_addr.unwrap_or(DEFAULT_REMOTE_HOST_BIND_ADDR))
            .await
            .map_err(|error| error.to_string())?;
        let local_addr = listener.local_addr().map_err(|error| error.to_string())?;
        let shutdown = CancellationToken::new();
        let join_handle = tokio::spawn(run_remote_host(
            listener,
            self.db.clone(),
            terminals,
            state,
            app_handle,
            self.event_tx.clone(),
            shutdown.clone(),
        ));
        *running = Some(RunningRemoteHost {
            bind_addr: local_addr,
            shutdown,
            join_handle,
        });

        Ok(RemoteHostStatusDto {
            running: true,
            bind_addr: Some(local_addr.to_string()),
        })
    }

    pub async fn stop(&self) -> Result<RemoteHostStatusDto, String> {
        let running = self.running.lock().await.take();
        if let Some(host) = running {
            host.shutdown.cancel();
            if let Err(error) = host.join_handle.await {
                log::warn!("remote host task join failed: {error}");
            }
        }

        Ok(RemoteHostStatusDto {
            running: false,
            bind_addr: None,
        })
    }
}

async fn run_remote_host(
    listener: TcpListener,
    db: Database,
    terminals: Arc<TerminalManager>,
    state: Option<AppState>,
    app_handle: Option<tauri::AppHandle>,
    event_tx: broadcast::Sender<RemoteEventEnvelope>,
    shutdown: CancellationToken,
) {
    loop {
        tokio::select! {
            _ = shutdown.cancelled() => break,
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((stream, peer_addr)) => {
                        let db = db.clone();
                        let terminals = terminals.clone();
                        let state = state.clone();
                        let app_handle = app_handle.clone();
                        let event_tx = event_tx.clone();
                        let shutdown = shutdown.clone();
                        tokio::spawn(async move {
                            if let Err(error) =
                                handle_connection(
                                    stream,
                                    db,
                                    terminals,
                                    state,
                                    app_handle,
                                    event_tx,
                                    shutdown,
                                )
                                .await
                            {
                                log::warn!("remote host connection failed for {peer_addr}: {error}");
                            }
                        });
                    }
                    Err(error) => {
                        if !shutdown.is_cancelled() {
                            log::warn!("remote host accept failed: {error}");
                        }
                    }
                }
            }
        }
    }
}

async fn handle_connection(
    stream: TcpStream,
    db: Database,
    terminals: Arc<TerminalManager>,
    state: Option<AppState>,
    app_handle: Option<tauri::AppHandle>,
    event_tx: broadcast::Sender<RemoteEventEnvelope>,
    shutdown: CancellationToken,
) -> anyhow::Result<()> {
    let websocket = accept_hdr_async(stream, |_request: &Request, response: Response| {
        Ok(response)
    })
    .await
    .context("failed to accept remote websocket handshake")?;

    let router = match (state, app_handle) {
        (Some(state), Some(app_handle)) => {
            RemoteCommandRouter::new(db.clone(), terminals).with_runtime(state, app_handle)
        }
        (Some(state), None) => RemoteCommandRouter::new(db.clone(), terminals).with_state(state),
        (None, Some(_)) => RemoteCommandRouter::new(db.clone(), terminals),
        (None, None) => RemoteCommandRouter::new(db.clone(), terminals),
    };
    let (mut write, mut read) = websocket.split();
    let grant = match authenticate_connection(&mut write, &mut read, &router).await? {
        Some(grant) => grant,
        None => return Ok(()),
    };
    let mut event_rx = event_tx.subscribe();

    loop {
        tokio::select! {
            _ = shutdown.cancelled() => {
                send_close(&mut write, CloseCode::Restart, "server_shutdown").await?;
                break;
            }
            next_event = event_rx.recv() => {
                match next_event {
                    Ok(event) => {
                        if !grant_can_receive_event(&grant, &event.channel) {
                            continue;
                        }
                        let encoded = serde_json::to_string(&event)
                            .context("failed to encode remote event envelope")?;
                        write.send(Message::Text(encoded.into())).await?;
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        log::warn!(
                            "remote host event bridge lagged for device grant {} and skipped {skipped} events",
                            grant.id
                        );
                        send_close(&mut write, CloseCode::Again, "event_overflow").await?;
                        break;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            next_message = read.next() => {
                match next_message {
                    Some(Ok(Message::Text(text))) => {
                        let request: RemoteCommandRequest = match serde_json::from_str(&text) {
                            Ok(request) => request,
                            Err(error) => {
                                log::warn!("remote host received invalid request payload: {error}");
                                send_close(&mut write, CloseCode::Protocol, "invalid_request").await?;
                                break;
                            }
                        };
                        let response = router.handle_request(&grant, request).await;
                        let encoded = serde_json::to_string(&response)
                            .context("failed to encode remote command response")?;
                        write.send(Message::Text(encoded.into())).await?;
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        write.send(Message::Pong(payload)).await?;
                    }
                    Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Binary(_))) => {}
                    Some(Ok(Message::Frame(_))) => {}
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(error)) => return Err(error.into()),
                }
            }
        }
    }

    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthenticateSessionArgs {
    token: String,
}

async fn authenticate_connection<S, R>(
    write: &mut S,
    read: &mut R,
    router: &RemoteCommandRouter,
) -> anyhow::Result<Option<RemoteDeviceGrantDto>>
where
    S: Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
    R: StreamExt<Item = Result<Message, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    let Some(initial_message) = read.next().await else {
        send_close(write, CloseCode::Policy, "missing_auth").await?;
        return Ok(None);
    };

    let request = match initial_message? {
        Message::Text(text) => serde_json::from_str::<RemoteCommandRequest>(&text)
            .context("failed to decode auth request")?,
        Message::Ping(payload) => {
            write.send(Message::Pong(payload)).await?;
            send_close(write, CloseCode::Policy, "missing_auth").await?;
            return Ok(None);
        }
        Message::Close(_) => return Ok(None),
        _ => {
            send_close(write, CloseCode::Policy, "missing_auth").await?;
            return Ok(None);
        }
    };

    if request.command != "authenticate_session" {
        let response = crate::remote::protocol::RemoteCommandResponse::failure(
            request.id,
            "first remote command must authenticate_session",
        );
        write
            .send(Message::Text(serde_json::to_string(&response)?.into()))
            .await?;
        send_close(write, CloseCode::Policy, "missing_auth").await?;
        return Ok(None);
    }

    let args = request
        .args
        .ok_or_else(|| anyhow::anyhow!("missing authenticate_session arguments"))?;
    let args = serde_json::from_value::<AuthenticateSessionArgs>(args)
        .context("failed to decode authenticate_session arguments")?;
    let grant = match router.authenticate_device_grant(&args.token).await {
        Ok(grant) => grant,
        Err(error) => {
            let response =
                crate::remote::protocol::RemoteCommandResponse::failure(request.id, error.clone());
            write
                .send(Message::Text(serde_json::to_string(&response)?.into()))
                .await?;
            send_close(write, CloseCode::Policy, &error).await?;
            return Ok(None);
        }
    };

    let response = crate::remote::protocol::RemoteCommandResponse::success(
        request.id,
        serde_json::Value::Null,
    );
    write
        .send(Message::Text(serde_json::to_string(&response)?.into()))
        .await?;
    Ok(Some(grant))
}

fn grant_can_receive_event(grant: &RemoteDeviceGrantDto, channel: &str) -> bool {
    match required_scope_for_event_channel(channel) {
        Some(required_scope) => grant_allows_scope(grant, required_scope),
        None => false,
    }
}

fn required_scope_for_event_channel(channel: &str) -> Option<&'static str> {
    if channel == "thread-updated"
        || channel.starts_with("stream-event-")
        || channel.starts_with("approval-request-")
    {
        return Some("thread.read");
    }

    if channel.starts_with("terminal-output-")
        || channel.starts_with("terminal-exit-")
        || channel.starts_with("terminal-fg-changed-")
    {
        return Some("terminal.read");
    }

    None
}

async fn send_close<S>(sink: &mut S, code: CloseCode, reason: &str) -> anyhow::Result<()>
where
    S: Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    sink.send(Message::Close(Some(CloseFrame {
        code,
        reason: reason.to_string().into(),
    })))
    .await
    .context("failed to send websocket close frame")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc, time::Duration};

    use futures::{SinkExt, StreamExt};
    use serde_json::json;
    use tokio::time::timeout;
    use tokio_tungstenite::{connect_async, tungstenite::Message};
    use uuid::Uuid;

    use crate::{
        db::{self, Database},
        models::{RemoteDeviceGrantDto, WorkspaceDto},
        remote::protocol::{RemoteCommandRequest, RemoteCommandResponse, RemoteEventEnvelope},
        terminal::TerminalManager,
    };

    use super::{grant_can_receive_event, RemoteHostManager};

    fn test_db() -> (Database, std::path::PathBuf) {
        let base_dir = std::env::temp_dir().join(format!("panes-remote-server-{}", Uuid::new_v4()));
        fs::create_dir_all(&base_dir).expect("failed to create remote server temp dir");
        let db = Database::open(base_dir.join("server.db")).expect("failed to initialize test db");
        (db, base_dir)
    }

    #[tokio::test]
    async fn remote_host_serves_authenticated_command_requests() {
        let (db, base_dir) = test_db();
        let workspace_dir = base_dir.join("workspace");
        fs::create_dir_all(&workspace_dir).expect("failed to create workspace dir");
        let workspace =
            db::workspaces::upsert_workspace(&db, workspace_dir.to_string_lossy().as_ref(), None)
                .expect("failed to create workspace");
        let grant = db::remote::create_device_grant(
            &db,
            "Server Test",
            &["workspace.read".to_string()],
            None,
        )
        .expect("failed to create device grant");
        let manager = RemoteHostManager::new(db.clone());

        let status = manager
            .start(Some("127.0.0.1:0"), Arc::new(TerminalManager::default()))
            .await
            .expect("failed to start remote host");
        let bind_addr = status.bind_addr.expect("missing remote host bind addr");
        let url = format!("ws://{bind_addr}");
        let (mut socket, _) = connect_async(&url)
            .await
            .expect("failed to connect to remote host");

        socket
            .send(Message::Text(
                serde_json::to_string(&RemoteCommandRequest {
                    id: "auth-1".to_string(),
                    command: "authenticate_session".to_string(),
                    args: Some(serde_json::json!({ "token": grant.token })),
                })
                .expect("failed to encode auth request")
                .into(),
            ))
            .await
            .expect("failed to send auth request");

        let Some(Ok(Message::Text(auth_response))) = socket.next().await else {
            panic!("expected remote host auth response frame");
        };
        let auth_response = serde_json::from_str::<RemoteCommandResponse>(&auth_response)
            .expect("failed to decode auth response");
        assert!(auth_response.ok);

        socket
            .send(Message::Text(
                serde_json::to_string(&RemoteCommandRequest {
                    id: "req-1".to_string(),
                    command: "list_workspaces".to_string(),
                    args: None,
                })
                .expect("failed to encode request")
                .into(),
            ))
            .await
            .expect("failed to send request");

        let Some(Ok(Message::Text(response))) = socket.next().await else {
            panic!("expected remote host response frame");
        };
        let response = serde_json::from_str::<RemoteCommandResponse>(&response)
            .expect("failed to decode remote host response");
        assert!(response.ok);
        let workspaces = serde_json::from_value::<Vec<WorkspaceDto>>(
            response.result.expect("missing workspace list result"),
        )
        .expect("failed to decode workspace list");
        assert!(workspaces.iter().any(|item| item.id == workspace.id));

        manager.stop().await.expect("failed to stop remote host");
    }

    #[tokio::test]
    async fn remote_host_rejects_invalid_authentication() {
        let (db, _base_dir) = test_db();
        let manager = RemoteHostManager::new(db);

        let status = manager
            .start(Some("127.0.0.1:0"), Arc::new(TerminalManager::default()))
            .await
            .expect("failed to start remote host");
        let bind_addr = status.bind_addr.expect("missing remote host bind addr");
        let url = format!("ws://{bind_addr}");
        let (mut socket, _) = connect_async(&url)
            .await
            .expect("failed to connect to remote host");

        socket
            .send(Message::Text(
                serde_json::to_string(&RemoteCommandRequest {
                    id: "auth-2".to_string(),
                    command: "authenticate_session".to_string(),
                    args: Some(serde_json::json!({ "token": "invalid-token" })),
                })
                .expect("failed to encode auth request")
                .into(),
            ))
            .await
            .expect("failed to send auth request");

        let Some(Ok(Message::Text(auth_response))) = socket.next().await else {
            panic!("expected remote host auth failure response frame");
        };
        let auth_response = serde_json::from_str::<RemoteCommandResponse>(&auth_response)
            .expect("failed to decode auth failure response");
        assert!(!auth_response.ok);
        assert!(auth_response
            .error
            .as_deref()
            .is_some_and(|error| error.contains("inactive")));

        manager.stop().await.expect("failed to stop remote host");
    }

    #[tokio::test]
    async fn remote_host_forwards_scoped_live_events() {
        let (db, _base_dir) = test_db();
        let grant = db::remote::create_device_grant(
            &db,
            "Thread Reader",
            &["thread.read".to_string()],
            None,
        )
        .expect("failed to create device grant");
        let manager = RemoteHostManager::new(db.clone());

        let status = manager
            .start(Some("127.0.0.1:0"), Arc::new(TerminalManager::default()))
            .await
            .expect("failed to start remote host");
        let bind_addr = status.bind_addr.expect("missing remote host bind addr");
        let url = format!("ws://{bind_addr}");
        let (mut socket, _) = connect_async(&url)
            .await
            .expect("failed to connect to remote host");

        socket
            .send(Message::Text(
                serde_json::to_string(&RemoteCommandRequest {
                    id: "auth-3".to_string(),
                    command: "authenticate_session".to_string(),
                    args: Some(serde_json::json!({ "token": grant.token })),
                })
                .expect("failed to encode auth request")
                .into(),
            ))
            .await
            .expect("failed to send auth request");

        let Some(Ok(Message::Text(auth_response))) = socket.next().await else {
            panic!("expected remote host auth response frame");
        };
        let auth_response = serde_json::from_str::<RemoteCommandResponse>(&auth_response)
            .expect("failed to decode auth response");
        assert!(auth_response.ok);

        manager.publish_event(
            "stream-event-thread-1",
            &json!({
                "type": "TextDelta",
                "content": "hello from host"
            }),
        );

        let Some(Ok(Message::Text(event_frame))) = timeout(Duration::from_secs(1), socket.next())
            .await
            .expect("timed out waiting for forwarded event")
        else {
            panic!("expected forwarded remote event frame");
        };
        let event = serde_json::from_str::<RemoteEventEnvelope>(&event_frame)
            .expect("failed to decode forwarded event");
        assert_eq!(event.channel, "stream-event-thread-1");
        assert_eq!(
            event.payload,
            json!({
                "type": "TextDelta",
                "content": "hello from host"
            })
        );

        manager.stop().await.expect("failed to stop remote host");
    }

    #[test]
    fn remote_event_scope_filter_matches_supported_channels() {
        let thread_reader = RemoteDeviceGrantDto {
            id: "grant-thread".to_string(),
            label: "Thread Reader".to_string(),
            scopes: vec!["thread.read".to_string()],
            created_at: "2026-01-01T00:00:00Z".to_string(),
            expires_at: None,
            revoked_at: None,
            last_used_at: None,
        };
        let terminal_reader = RemoteDeviceGrantDto {
            id: "grant-terminal".to_string(),
            label: "Terminal Reader".to_string(),
            scopes: vec!["terminal.read".to_string()],
            created_at: "2026-01-01T00:00:00Z".to_string(),
            expires_at: None,
            revoked_at: None,
            last_used_at: None,
        };

        assert!(grant_can_receive_event(
            &thread_reader,
            "stream-event-thread-1"
        ));
        assert!(grant_can_receive_event(
            &thread_reader,
            "approval-request-thread-1"
        ));
        assert!(grant_can_receive_event(&thread_reader, "thread-updated"));
        assert!(!grant_can_receive_event(
            &thread_reader,
            "terminal-output-ws-1"
        ));

        assert!(grant_can_receive_event(
            &terminal_reader,
            "terminal-output-ws-1"
        ));
        assert!(grant_can_receive_event(
            &terminal_reader,
            "terminal-exit-ws-1"
        ));
        assert!(grant_can_receive_event(
            &terminal_reader,
            "terminal-fg-changed-ws-1"
        ));
        assert!(!grant_can_receive_event(
            &terminal_reader,
            "engine-runtime-updated"
        ));
    }
}
