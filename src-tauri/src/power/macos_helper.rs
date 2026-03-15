//! Communication layer between the Tauri app and the privileged
//! `PanesKeepAwakeHelper` daemon that controls `IOPMSetSystemPowerSetting`.
//!
//! The helper runs as root via launchd (registered through `SMAppService`) and
//! listens on a Unix domain socket.  This module provides:
//!
//! - Status queries via the bundled `PanesHelperRegistrar` binary
//! - `preventSleep` / `allowSleep` commands over the Unix socket
//! - Connection management with reconnection on failure

use std::{
    io,
    path::{Path, PathBuf},
    time::Duration,
};

use serde::Deserialize;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::UnixStream,
    time::timeout,
};

const HELPER_SOCKET_PATH: &str = "/var/run/com.panes.app.keepawake.sock";
const IPC_TIMEOUT: Duration = Duration::from_secs(5);
const REGISTRAR_BINARY_NAME: &str = "PanesHelperRegistrar";

/// Registration status of the privileged helper daemon.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HelperStatus {
    /// Helper is registered and running.
    Registered,
    /// Helper is registered but pending user approval in System Settings.
    RequiresApproval,
    /// Helper is not registered.
    NotRegistered,
    /// The plist was not found in the app bundle.
    NotFound,
    /// Could not determine status (registrar binary missing, etc.).
    Unknown(String),
}

impl HelperStatus {
    pub fn as_str(&self) -> &str {
        match self {
            Self::Registered => "registered",
            Self::RequiresApproval => "requiresApproval",
            Self::NotRegistered => "notRegistered",
            Self::NotFound => "notFound",
            Self::Unknown(_) => "unknown",
        }
    }
}

#[derive(Deserialize)]
struct RegistrarOutput {
    status: String,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Deserialize)]
struct HelperResponse {
    #[serde(default)]
    ok: Option<bool>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default, rename = "sleepDisabled")]
    sleep_disabled: Option<bool>,
}

// ---------------------------------------------------------------------------
// Registrar (status / register / unregister)
// ---------------------------------------------------------------------------

/// Resolve the path to the bundled `PanesHelperRegistrar` binary.
///
/// In a Tauri `.app` bundle the layout is:
///   Panes.app/Contents/MacOS/Panes          (main binary)
///   Panes.app/Contents/MacOS/PanesHelperRegistrar
///
/// During development (`cargo test` / `cargo run`) the binary lives at
///   src-tauri/helper/build/PanesHelperRegistrar
fn resolve_registrar_path() -> Option<PathBuf> {
    // Production: next to the main executable inside the app bundle.
    if let Ok(exe) = std::env::current_exe() {
        let sibling = exe.parent()?.join(REGISTRAR_BINARY_NAME);
        if sibling.is_file() {
            return Some(sibling);
        }
    }

    // Development fallback: compiled helper in the helper/build directory.
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let dev_path = manifest_dir
        .join("helper")
        .join("build")
        .join(REGISTRAR_BINARY_NAME);
    if dev_path.is_file() {
        return Some(dev_path);
    }

    None
}

fn run_registrar(args: &[&str]) -> Result<RegistrarOutput, String> {
    let registrar = resolve_registrar_path()
        .ok_or_else(|| "PanesHelperRegistrar binary not found".to_string())?;

    let output = std::process::Command::new(&registrar)
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .map_err(|e| format!("failed to run PanesHelperRegistrar: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str::<RegistrarOutput>(stdout.trim())
        .map_err(|e| format!("failed to parse registrar output: {e} (raw: {stdout})"))
}

fn parse_status(raw: &str) -> HelperStatus {
    match raw {
        "registered" => HelperStatus::Registered,
        "requiresApproval" => HelperStatus::RequiresApproval,
        "notRegistered" => HelperStatus::NotRegistered,
        "notFound" => HelperStatus::NotFound,
        other => HelperStatus::Unknown(other.to_string()),
    }
}

/// Query the current registration status of the helper daemon.
pub fn helper_status() -> HelperStatus {
    match run_registrar(&["--status"]) {
        Ok(output) => parse_status(&output.status),
        Err(error) => HelperStatus::Unknown(error),
    }
}

/// Register the helper daemon via SMAppService.  On first call, macOS shows a
/// user consent prompt in System Settings → General → Login Items & Extensions.
pub fn register_helper() -> Result<HelperStatus, String> {
    let output = run_registrar(&["--register"])?;
    if let Some(error) = output.error {
        return Err(error);
    }
    Ok(parse_status(&output.status))
}

/// Unregister the helper daemon.
pub(super) fn unregister_helper() -> Result<HelperStatus, String> {
    let output = run_registrar(&["--unregister"])?;
    if let Some(error) = output.error {
        return Err(error);
    }
    Ok(parse_status(&output.status))
}

// ---------------------------------------------------------------------------
// Socket IPC (preventSleep / allowSleep / status)
// ---------------------------------------------------------------------------

/// A connection to the privileged helper's Unix domain socket.
pub(super) struct HelperConnection {
    stream: BufReader<UnixStream>,
}

impl HelperConnection {
    /// Connect to the helper daemon.  Returns `Err` if the socket does not
    /// exist or the connection is refused (helper not running).
    pub async fn connect() -> io::Result<Self> {
        let stream = timeout(IPC_TIMEOUT, UnixStream::connect(HELPER_SOCKET_PATH))
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "helper connect timeout"))?
            ?;
        Ok(Self {
            stream: BufReader::new(stream),
        })
    }

    /// Ask the helper to set `SleepDisabled = true`.
    pub async fn prevent_sleep(&mut self) -> Result<(), String> {
        self.send_action("preventSleep").await
    }

    /// Ask the helper to set `SleepDisabled = false`.
    pub async fn allow_sleep(&mut self) -> Result<(), String> {
        self.send_action("allowSleep").await
    }

    /// Read the current `SleepDisabled` value via the helper.
    pub async fn is_sleep_disabled(&mut self) -> Result<bool, String> {
        let response = self.send_raw("{\"action\":\"status\"}\n").await?;
        Ok(response.sleep_disabled.unwrap_or(false))
    }

    async fn send_action(&mut self, action: &str) -> Result<(), String> {
        let response = self
            .send_raw(&format!("{{\"action\":\"{action}\"}}\n"))
            .await?;
        if response.ok == Some(true) {
            Ok(())
        } else {
            Err(response
                .error
                .unwrap_or_else(|| "helper returned ok=false".to_string()))
        }
    }

    async fn send_raw(&mut self, message: &str) -> Result<HelperResponse, String> {
        let result = timeout(IPC_TIMEOUT, async {
            self.stream
                .get_mut()
                .write_all(message.as_bytes())
                .await
                .map_err(|e| format!("helper write failed: {e}"))?;

            let mut line = String::new();
            self.stream
                .read_line(&mut line)
                .await
                .map_err(|e| format!("helper read failed: {e}"))?;

            serde_json::from_str::<HelperResponse>(line.trim())
                .map_err(|e| format!("helper response parse error: {e} (raw: {line})"))
        })
        .await;

        match result {
            Ok(inner) => inner,
            Err(_) => Err("helper IPC timeout".to_string()),
        }
    }
}

/// Try to connect to the helper, with up to `attempts` retries and exponential
/// backoff (500ms, 1s, 2s).
pub(super) async fn connect_with_retry(attempts: u32) -> Result<HelperConnection, String> {
    let delays = [
        Duration::from_millis(500),
        Duration::from_secs(1),
        Duration::from_secs(2),
    ];

    for attempt in 0..attempts {
        match HelperConnection::connect().await {
            Ok(conn) => return Ok(conn),
            Err(error) => {
                if attempt + 1 < attempts {
                    let delay = delays.get(attempt as usize).copied().unwrap_or(delays[2]);
                    log::debug!(
                        "helper connect attempt {} failed: {error}, retrying in {delay:?}",
                        attempt + 1
                    );
                    tokio::time::sleep(delay).await;
                } else {
                    return Err(format!(
                        "failed to connect to keep-awake helper after {attempts} attempts: {error}"
                    ));
                }
            }
        }
    }

    Err("helper connection attempts exhausted".to_string())
}

/// Check whether the helper socket exists (quick availability check without
/// attempting a connection).
pub(super) fn helper_socket_exists() -> bool {
    Path::new(HELPER_SOCKET_PATH).exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helper_status_as_str_values() {
        assert_eq!(HelperStatus::Registered.as_str(), "registered");
        assert_eq!(HelperStatus::RequiresApproval.as_str(), "requiresApproval");
        assert_eq!(HelperStatus::NotRegistered.as_str(), "notRegistered");
        assert_eq!(HelperStatus::NotFound.as_str(), "notFound");
        assert_eq!(
            HelperStatus::Unknown("foo".into()).as_str(),
            "unknown"
        );
    }

    #[test]
    fn parse_registrar_output_registered() {
        let raw = r#"{"status":"registered"}"#;
        let output: RegistrarOutput = serde_json::from_str(raw).unwrap();
        assert_eq!(parse_status(&output.status), HelperStatus::Registered);
    }

    #[test]
    fn parse_registrar_output_with_error() {
        let raw = r#"{"status":"notRegistered","error":"Operation not permitted"}"#;
        let output: RegistrarOutput = serde_json::from_str(raw).unwrap();
        assert_eq!(parse_status(&output.status), HelperStatus::NotRegistered);
        assert_eq!(output.error.as_deref(), Some("Operation not permitted"));
    }

    #[test]
    fn parse_helper_response_ok() {
        let raw = r#"{"ok":true}"#;
        let response: HelperResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(response.ok, Some(true));
        assert!(response.error.is_none());
    }

    #[test]
    fn parse_helper_response_status() {
        let raw = r#"{"sleepDisabled":true}"#;
        let response: HelperResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(response.sleep_disabled, Some(true));
    }

    #[test]
    fn parse_helper_response_error() {
        let raw = r#"{"ok":false,"error":"IOReturn 42"}"#;
        let response: HelperResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(response.ok, Some(false));
        assert_eq!(response.error.as_deref(), Some("IOReturn 42"));
    }

    #[test]
    fn socket_path_is_expected() {
        assert_eq!(HELPER_SOCKET_PATH, "/var/run/com.panes.app.keepawake.sock");
    }

    #[test]
    fn resolve_registrar_does_not_panic() {
        // In dev, should find helper/build/PanesHelperRegistrar if it was built.
        // In CI without a build, returns None. Either way: no panic.
        let _ = resolve_registrar_path();
    }
}
