use std::{
    io,
    net::SocketAddr,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use anyhow::Context;
use futures::{Sink, SinkExt, StreamExt};
use serde::Deserialize;
use tauri::Manager;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
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
const REMOTE_WEB_REDIRECT_TARGET: &str = "/remote";
const REMOTE_HTTP_READ_BUFFER_SIZE: usize = 8192;

struct RunningRemoteHost {
    bind_addr: SocketAddr,
    web_bind_addr: Option<SocketAddr>,
    shutdown: CancellationToken,
    join_handle: JoinHandle<()>,
}

pub struct RemoteHostManager {
    db: Database,
    event_tx: broadcast::Sender<RemoteEventEnvelope>,
    web_root: Option<PathBuf>,
    running: Mutex<Option<RunningRemoteHost>>,
}

impl RemoteHostManager {
    pub fn new(db: Database) -> Self {
        Self::new_with_web_root(db, None)
    }

    pub fn new_with_web_root(db: Database, web_root: Option<PathBuf>) -> Self {
        let (event_tx, _) = broadcast::channel(REMOTE_EVENT_CHANNEL_CAPACITY);
        Self {
            db,
            event_tx,
            web_root: web_root.and_then(validate_remote_web_root),
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
                web_bind_addr: host.web_bind_addr.map(|addr| addr.to_string()),
            },
            None => RemoteHostStatusDto {
                running: false,
                bind_addr: None,
                web_bind_addr: None,
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
                web_bind_addr: host.web_bind_addr.map(|addr| addr.to_string()),
            });
        }

        let listener = TcpListener::bind(bind_addr.unwrap_or(DEFAULT_REMOTE_HOST_BIND_ADDR))
            .await
            .map_err(|error| error.to_string())?;
        let local_addr = listener.local_addr().map_err(|error| error.to_string())?;
        let web_root = self
            .resolve_web_root(app_handle.as_ref())
            .or_else(resolve_default_remote_web_root);
        let (web_listener, web_bind_addr) = match web_root.as_ref() {
            Some(_) => {
                let listener = bind_remote_web_listener(local_addr)
                    .await
                    .map_err(|error| error.to_string())?;
                let addr = listener.local_addr().map_err(|error| error.to_string())?;
                (Some(listener), Some(addr))
            }
            None => (None, None),
        };
        let shutdown = CancellationToken::new();
        let join_handle = tokio::spawn(run_remote_services(
            listener,
            web_listener,
            web_root,
            self.db.clone(),
            terminals,
            state,
            app_handle,
            self.event_tx.clone(),
            shutdown.clone(),
        ));
        *running = Some(RunningRemoteHost {
            bind_addr: local_addr,
            web_bind_addr,
            shutdown,
            join_handle,
        });

        Ok(RemoteHostStatusDto {
            running: true,
            bind_addr: Some(local_addr.to_string()),
            web_bind_addr: web_bind_addr.map(|addr| addr.to_string()),
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
            web_bind_addr: None,
        })
    }

    fn resolve_web_root(&self, app_handle: Option<&tauri::AppHandle>) -> Option<PathBuf> {
        self.web_root.clone().or_else(|| {
            app_handle.and_then(|app| {
                app.path().resource_dir().ok().and_then(|resource_dir| {
                    [resource_dir.join("dist"), resource_dir]
                        .into_iter()
                        .find_map(validate_remote_web_root)
                })
            })
        })
    }
}

pub fn resolve_default_remote_web_root() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("PANES_REMOTE_WEB_ROOT") {
        if let Some(valid) = validate_remote_web_root(PathBuf::from(path)) {
            return Some(valid);
        }
    }

    let manifest_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    validate_remote_web_root(manifest_root.join("..").join("dist"))
}

fn validate_remote_web_root(path: PathBuf) -> Option<PathBuf> {
    if path.join("index.html").is_file() {
        Some(path)
    } else {
        None
    }
}

async fn bind_remote_web_listener(bind_addr: SocketAddr) -> io::Result<TcpListener> {
    let preferred_port = bind_addr.port().checked_add(1).unwrap_or(0);
    let preferred_addr = SocketAddr::new(bind_addr.ip(), preferred_port);

    match TcpListener::bind(preferred_addr).await {
        Ok(listener) => Ok(listener),
        Err(error) if preferred_port != 0 => {
            log::warn!(
                "failed to bind remote web server on {}: {}, retrying with an ephemeral port",
                preferred_addr,
                error
            );
            TcpListener::bind(SocketAddr::new(bind_addr.ip(), 0)).await
        }
        Err(error) => Err(error),
    }
}

async fn run_remote_services(
    listener: TcpListener,
    web_listener: Option<TcpListener>,
    web_root: Option<PathBuf>,
    db: Database,
    terminals: Arc<TerminalManager>,
    state: Option<AppState>,
    app_handle: Option<tauri::AppHandle>,
    event_tx: broadcast::Sender<RemoteEventEnvelope>,
    shutdown: CancellationToken,
) {
    let websocket_task = tokio::spawn(run_remote_host(
        listener,
        db,
        terminals,
        state,
        app_handle,
        event_tx,
        shutdown.clone(),
    ));

    let web_task = match (web_listener, web_root) {
        (Some(listener), Some(root)) => Some(tokio::spawn(run_remote_web_host(
            listener,
            root,
            shutdown.clone(),
        ))),
        _ => None,
    };

    let _ = websocket_task.await;
    if let Some(task) = web_task {
        let _ = task.await;
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

async fn run_remote_web_host(
    listener: TcpListener,
    web_root: PathBuf,
    shutdown: CancellationToken,
) {
    loop {
        tokio::select! {
            _ = shutdown.cancelled() => break,
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((stream, peer_addr)) => {
                        let web_root = web_root.clone();
                        tokio::spawn(async move {
                            if let Err(error) = handle_http_connection(stream, web_root).await {
                                log::warn!("remote web connection failed for {peer_addr}: {error}");
                            }
                        });
                    }
                    Err(error) => {
                        if !shutdown.is_cancelled() {
                            log::warn!("remote web accept failed: {error}");
                        }
                    }
                }
            }
        }
    }
}

#[derive(Debug)]
struct RemoteHttpRequest<'a> {
    method: &'a str,
    path: &'a str,
}

async fn handle_http_connection(mut stream: TcpStream, web_root: PathBuf) -> anyhow::Result<()> {
    let mut buffer = vec![0_u8; REMOTE_HTTP_READ_BUFFER_SIZE];
    let bytes_read = stream
        .read(&mut buffer)
        .await
        .context("failed to read remote http request")?;
    if bytes_read == 0 {
        return Ok(());
    }

    let request = parse_http_request(&buffer[..bytes_read])?;
    let request_path = request.path.split('?').next().unwrap_or(request.path);

    match request.method {
        "GET" | "HEAD" => {}
        _ => {
            send_http_response(
                &mut stream,
                "405 Method Not Allowed",
                "text/plain; charset=utf-8",
                b"method not allowed",
                request.method == "HEAD",
                &[],
            )
            .await?;
            return Ok(());
        }
    }

    match request_path {
        "/" => {
            send_http_response(
                &mut stream,
                "302 Found",
                "text/plain; charset=utf-8",
                b"redirecting",
                request.method == "HEAD",
                &[("Location", REMOTE_WEB_REDIRECT_TARGET)],
            )
            .await?;
        }
        "/remote" | "/remote/" => {
            let bytes = tokio::fs::read(web_root.join("index.html"))
                .await
                .context("failed to read remote web index")?;
            send_http_response(
                &mut stream,
                "200 OK",
                "text/html; charset=utf-8",
                &bytes,
                request.method == "HEAD",
                &[("Cache-Control", "no-cache")],
            )
            .await?;
        }
        path if path.starts_with("/assets/") => match resolve_remote_asset_path(&web_root, path) {
            Some(asset_path) if asset_path.is_file() => {
                let bytes = tokio::fs::read(&asset_path)
                    .await
                    .with_context(|| format!("failed to read {}", asset_path.display()))?;
                send_http_response(
                    &mut stream,
                    "200 OK",
                    remote_content_type(&asset_path),
                    &bytes,
                    request.method == "HEAD",
                    &[("Cache-Control", "public, max-age=31536000, immutable")],
                )
                .await?;
            }
            _ => {
                send_http_response(
                    &mut stream,
                    "404 Not Found",
                    "text/plain; charset=utf-8",
                    b"not found",
                    request.method == "HEAD",
                    &[],
                )
                .await?;
            }
        },
        _ => {
            send_http_response(
                &mut stream,
                "404 Not Found",
                "text/plain; charset=utf-8",
                b"not found",
                request.method == "HEAD",
                &[],
            )
            .await?;
        }
    }

    Ok(())
}

fn parse_http_request(bytes: &[u8]) -> anyhow::Result<RemoteHttpRequest<'_>> {
    let request = std::str::from_utf8(bytes).context("remote http request was not valid utf-8")?;
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| anyhow::anyhow!("remote http request missing request line"))?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("remote http request missing method"))?;
    let path = parts
        .next()
        .ok_or_else(|| anyhow::anyhow!("remote http request missing path"))?;
    Ok(RemoteHttpRequest { method, path })
}

fn resolve_remote_asset_path(web_root: &Path, request_path: &str) -> Option<PathBuf> {
    let relative = request_path.trim_start_matches('/');
    let relative_path = Path::new(relative);
    if relative_path
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return None;
    }

    Some(web_root.join(relative_path))
}

fn remote_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("css") => "text/css; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "application/javascript; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

async fn send_http_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    head_only: bool,
    headers: &[(&str, &str)],
) -> anyhow::Result<()> {
    let mut response = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: {content_type}\r\nConnection: close\r\n",
        body.len()
    );
    for (name, value) in headers {
        response.push_str(name);
        response.push_str(": ");
        response.push_str(value);
        response.push_str("\r\n");
    }
    response.push_str("\r\n");

    stream
        .write_all(response.as_bytes())
        .await
        .context("failed to write remote http response headers")?;
    if !head_only {
        stream
            .write_all(body)
            .await
            .context("failed to write remote http response body")?;
    }
    stream
        .shutdown()
        .await
        .context("failed to close remote http response stream")?;
    Ok(())
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
    use reqwest::StatusCode;
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
    async fn remote_host_serves_remote_browser_shell_when_web_root_is_configured() {
        let (db, base_dir) = test_db();
        let web_root = base_dir.join("web");
        let assets_dir = web_root.join("assets");
        fs::create_dir_all(&assets_dir).expect("failed to create remote web asset dir");
        fs::write(
            web_root.join("index.html"),
            "<html><body>remote shell</body></html>",
        )
        .expect("failed to write remote web index");
        fs::write(assets_dir.join("app.js"), "console.log('remote');")
            .expect("failed to write remote web asset");

        let manager = RemoteHostManager::new_with_web_root(db, Some(web_root));
        let status = manager
            .start(Some("127.0.0.1:0"), Arc::new(TerminalManager::default()))
            .await
            .expect("failed to start remote host");
        let web_bind_addr = status.web_bind_addr.expect("missing remote web bind addr");

        let shell_response = reqwest::get(format!("http://{web_bind_addr}/remote"))
            .await
            .expect("failed to fetch remote web shell");
        assert_eq!(shell_response.status(), StatusCode::OK);
        let shell_body = shell_response
            .text()
            .await
            .expect("failed to read remote web shell body");
        assert!(shell_body.contains("remote shell"));

        let asset_response = reqwest::get(format!("http://{web_bind_addr}/assets/app.js"))
            .await
            .expect("failed to fetch remote web asset");
        assert_eq!(asset_response.status(), StatusCode::OK);

        let redirect_response = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("failed to build redirect-disabled client")
            .get(format!("http://{web_bind_addr}/"))
            .send()
            .await
            .expect("failed to fetch remote web root");
        assert_eq!(redirect_response.status(), StatusCode::FOUND);
        assert_eq!(
            redirect_response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok()),
            Some("/remote")
        );

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
