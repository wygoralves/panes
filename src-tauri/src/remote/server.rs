use std::net::SocketAddr;

use anyhow::Context;
use futures::{Sink, SinkExt, StreamExt};
use serde::Deserialize;
use tokio::{
    net::{TcpListener, TcpStream},
    sync::Mutex,
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
    remote::{protocol::RemoteCommandRequest, router::RemoteCommandRouter},
};

const DEFAULT_REMOTE_HOST_BIND_ADDR: &str = "127.0.0.1:0";

struct RunningRemoteHost {
    bind_addr: SocketAddr,
    shutdown: CancellationToken,
    join_handle: JoinHandle<()>,
}

pub struct RemoteHostManager {
    db: Database,
    running: Mutex<Option<RunningRemoteHost>>,
}

impl RemoteHostManager {
    pub fn new(db: Database) -> Self {
        Self {
            db,
            running: Mutex::new(None),
        }
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

    pub async fn start(&self, bind_addr: Option<&str>) -> Result<RemoteHostStatusDto, String> {
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
        let join_handle =
            tokio::spawn(run_remote_host(listener, self.db.clone(), shutdown.clone()));
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

async fn run_remote_host(listener: TcpListener, db: Database, shutdown: CancellationToken) {
    loop {
        tokio::select! {
            _ = shutdown.cancelled() => break,
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((stream, peer_addr)) => {
                        let db = db.clone();
                        let shutdown = shutdown.clone();
                        tokio::spawn(async move {
                            if let Err(error) = handle_connection(stream, db, shutdown).await {
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
    shutdown: CancellationToken,
) -> anyhow::Result<()> {
    let websocket = accept_hdr_async(stream, |_request: &Request, response: Response| {
        Ok(response)
    })
    .await
    .context("failed to accept remote websocket handshake")?;

    let router = RemoteCommandRouter::new(db.clone());
    let (mut write, mut read) = websocket.split();
    let grant = match authenticate_connection(&mut write, &mut read, &router).await? {
        Some(grant) => grant,
        None => return Ok(()),
    };

    loop {
        tokio::select! {
            _ = shutdown.cancelled() => {
                send_close(&mut write, CloseCode::Restart, "server_shutdown").await?;
                break;
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
    use std::fs;

    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::{connect_async, tungstenite::Message};
    use uuid::Uuid;

    use crate::{
        db::{self, Database},
        models::WorkspaceDto,
        remote::protocol::{RemoteCommandRequest, RemoteCommandResponse},
    };

    use super::RemoteHostManager;

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
            .start(Some("127.0.0.1:0"))
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
            .start(Some("127.0.0.1:0"))
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
}
