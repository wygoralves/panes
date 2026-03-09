use std::{
    ffi::OsString,
    io,
    path::PathBuf,
    process::{ExitStatus, Stdio},
    sync::Arc,
};

use async_trait::async_trait;
use tokio::{process::Child, sync::Mutex};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeepAwakeStatus {
    pub supported: bool,
    pub active: bool,
    pub message: Option<String>,
}

#[derive(Clone)]
pub struct KeepAwakeManager {
    spawner: Arc<dyn KeepAwakeSpawner>,
    runtime: Arc<Mutex<KeepAwakeRuntime>>,
}

struct KeepAwakeRuntime {
    child: Option<Box<dyn KeepAwakeChild>>,
    last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SupportStatus {
    supported: bool,
    message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct BackendSpec {
    program: PathBuf,
    args: Vec<OsString>,
}

#[async_trait]
trait KeepAwakeChild: Send {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>>;
    async fn kill(&mut self) -> io::Result<()>;
    async fn wait(&mut self) -> io::Result<ExitStatus>;
}

trait KeepAwakeSpawner: Send + Sync {
    fn support_status(&self) -> SupportStatus;
    fn spawn(&self) -> anyhow::Result<Box<dyn KeepAwakeChild>>;
}

#[derive(Debug)]
struct ProcessKeepAwakeSpawner;

struct TokioKeepAwakeChild {
    child: Child,
}

impl KeepAwakeManager {
    pub fn new() -> Self {
        Self::with_spawner(Arc::new(ProcessKeepAwakeSpawner))
    }

    fn with_spawner(spawner: Arc<dyn KeepAwakeSpawner>) -> Self {
        Self {
            spawner,
            runtime: Arc::new(Mutex::new(KeepAwakeRuntime {
                child: None,
                last_error: None,
            })),
        }
    }

    pub async fn status(&self) -> KeepAwakeStatus {
        let support = self.spawner.support_status();
        let mut runtime = self.runtime.lock().await;
        sync_child_state(&mut runtime);

        KeepAwakeStatus {
            supported: support.supported,
            active: runtime.child.is_some(),
            message: if !support.supported {
                support.message
            } else if runtime.child.is_some() {
                None
            } else {
                runtime.last_error.clone()
            },
        }
    }

    pub async fn enable(&self) -> Result<(), String> {
        let support = self.spawner.support_status();
        if !support.supported {
            let message = support
                .message
                .unwrap_or_else(|| "keep awake is not supported on this platform".to_string());
            self.set_last_error(Some(message.clone())).await;
            return Err(message);
        }

        let mut runtime = self.runtime.lock().await;
        sync_child_state(&mut runtime);
        if runtime.child.is_some() {
            runtime.last_error = None;
            return Ok(());
        }

        match self.spawner.spawn() {
            Ok(child) => {
                runtime.child = Some(child);
                runtime.last_error = None;
                Ok(())
            }
            Err(error) => {
                let message = error.to_string();
                runtime.last_error = Some(message.clone());
                Err(message)
            }
        }
    }

    pub async fn disable(&self) -> Result<(), String> {
        let child = {
            let mut runtime = self.runtime.lock().await;
            sync_child_state(&mut runtime);
            runtime.last_error = None;
            runtime.child.take()
        };

        if let Some(mut child) = child {
            match child.try_wait() {
                Ok(Some(_)) => {}
                Ok(None) => {
                    if let Err(error) = child.kill().await {
                        let message = format!("failed to stop keep awake helper: {error}");
                        self.set_last_error(Some(message.clone())).await;
                        return Err(message);
                    }
                    if let Err(error) = child.wait().await {
                        let message = format!("failed to wait for keep awake helper shutdown: {error}");
                        self.set_last_error(Some(message.clone())).await;
                        return Err(message);
                    }
                }
                Err(error) => {
                    let message = format!("failed to inspect keep awake helper state: {error}");
                    self.set_last_error(Some(message.clone())).await;
                    return Err(message);
                }
            }
        }

        self.set_last_error(None).await;
        Ok(())
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        self.disable().await
    }

    async fn set_last_error(&self, message: Option<String>) {
        self.runtime.lock().await.last_error = message;
    }
}

impl Default for KeepAwakeManager {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl KeepAwakeChild for TokioKeepAwakeChild {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }

    async fn kill(&mut self) -> io::Result<()> {
        self.child.kill().await
    }

    async fn wait(&mut self) -> io::Result<ExitStatus> {
        self.child.wait().await
    }
}

impl KeepAwakeSpawner for ProcessKeepAwakeSpawner {
    fn support_status(&self) -> SupportStatus {
        match resolve_backend_spec() {
            Ok(_) => SupportStatus {
                supported: true,
                message: None,
            },
            Err(error) => SupportStatus {
                supported: false,
                message: Some(error),
            },
        }
    }

    fn spawn(&self) -> anyhow::Result<Box<dyn KeepAwakeChild>> {
        let spec = resolve_backend_spec().map_err(anyhow::Error::msg)?;
        let mut command = tokio::process::Command::new(&spec.program);
        command
            .args(&spec.args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);

        let child = command.spawn().map_err(|error| {
            anyhow::anyhow!(
                "failed to start keep awake helper `{}`: {error}",
                spec.program.display()
            )
        })?;

        Ok(Box::new(TokioKeepAwakeChild { child }))
    }
}

fn sync_child_state(runtime: &mut KeepAwakeRuntime) {
    let outcome = runtime.child.as_mut().map(|child| child.try_wait());
    match outcome {
        Some(Ok(Some(status))) => {
            runtime.child = None;
            runtime.last_error = Some(exit_status_message(status));
        }
        Some(Ok(None)) => {}
        Some(Err(error)) => {
            runtime.child = None;
            runtime.last_error = Some(format!(
                "failed to inspect keep awake helper state: {error}"
            ));
        }
        None => {}
    }
}

fn exit_status_message(status: ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("keep awake helper exited unexpectedly with status code {code}"),
        None => "keep awake helper exited unexpectedly".to_string(),
    }
}

fn resolve_backend_spec() -> Result<BackendSpec, String> {
    #[cfg(target_os = "macos")]
    {
        let caffeinate = crate::runtime_env::resolve_executable("caffeinate")
            .ok_or_else(|| "macOS keep awake requires the `caffeinate` utility".to_string())?;
        return Ok(BackendSpec {
            program: caffeinate,
            args: vec![OsString::from("-i")],
        });
    }

    #[cfg(target_os = "linux")]
    {
        let systemd_inhibit = crate::runtime_env::resolve_executable("systemd-inhibit")
            .ok_or_else(|| "Linux keep awake requires `systemd-inhibit`".to_string())?;
        let sleep = crate::runtime_env::resolve_executable("sleep")
            .ok_or_else(|| "Linux keep awake requires the `sleep` utility".to_string())?;
        return Ok(BackendSpec {
            program: systemd_inhibit,
            args: vec![
                OsString::from("--what=idle"),
                OsString::from("--mode=block"),
                OsString::from("--who=Panes"),
                OsString::from("--why=Keep system awake while Panes is open"),
                sleep.into_os_string(),
                OsString::from("2147483647"),
            ],
        });
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Err("keep awake is not supported on this platform".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    #[derive(Debug)]
    struct FakeSpawner {
        support: SupportStatus,
        next_spawn: StdMutex<Vec<anyhow::Result<FakeChildHandle>>>,
    }

    #[derive(Debug)]
    struct FakeChildState {
        alive: bool,
        kill_error: Option<String>,
        wait_error: Option<String>,
        exit_code: i32,
    }

    #[derive(Debug, Clone)]
    struct FakeChildHandle {
        state: Arc<StdMutex<FakeChildState>>,
    }

    impl FakeChildHandle {
        fn new(exit_code: i32) -> (Self, Arc<StdMutex<FakeChildState>>) {
            let state = Arc::new(StdMutex::new(FakeChildState {
                alive: true,
                kill_error: None,
                wait_error: None,
                exit_code,
            }));
            (
                Self {
                    state: state.clone(),
                },
                state,
            )
        }
    }

    #[async_trait]
    impl KeepAwakeChild for FakeChildHandle {
        fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
            let state = self.state.lock().expect("fake child state lock poisoned");
            if state.alive {
                Ok(None)
            } else {
                Ok(Some(exit_status_from_code(state.exit_code)))
            }
        }

        async fn kill(&mut self) -> io::Result<()> {
            let mut state = self.state.lock().expect("fake child state lock poisoned");
            if let Some(error) = &state.kill_error {
                return Err(io::Error::other(error.clone()));
            }
            state.alive = false;
            Ok(())
        }

        async fn wait(&mut self) -> io::Result<ExitStatus> {
            let mut state = self.state.lock().expect("fake child state lock poisoned");
            if let Some(error) = &state.wait_error {
                return Err(io::Error::other(error.clone()));
            }
            state.alive = false;
            Ok(exit_status_from_code(state.exit_code))
        }
    }

    impl KeepAwakeSpawner for FakeSpawner {
        fn support_status(&self) -> SupportStatus {
            self.support.clone()
        }

        fn spawn(&self) -> anyhow::Result<Box<dyn KeepAwakeChild>> {
            let next = match self
                .next_spawn
                .lock()
                .expect("fake spawner lock poisoned")
                .pop()
            {
                Some(next) => next,
                None => anyhow::bail!("no fake child configured"),
            };
            next.map(|child| Box::new(child) as Box<dyn KeepAwakeChild>)
        }
    }

    #[tokio::test]
    async fn reports_unsupported_runtime() {
        let manager = KeepAwakeManager::with_spawner(Arc::new(FakeSpawner {
            support: SupportStatus {
                supported: false,
                message: Some("unsupported".to_string()),
            },
            next_spawn: StdMutex::new(Vec::new()),
        }));

        let status = manager.status().await;
        assert!(!status.supported);
        assert!(!status.active);
        assert_eq!(status.message.as_deref(), Some("unsupported"));
        assert!(manager.enable().await.is_err());
    }

    #[tokio::test]
    async fn enable_and_disable_are_idempotent() {
        let (child, _state) = FakeChildHandle::new(0);
        let manager = KeepAwakeManager::with_spawner(Arc::new(FakeSpawner {
            support: SupportStatus {
                supported: true,
                message: None,
            },
            next_spawn: StdMutex::new(vec![Ok(child)]),
        }));

        manager.enable().await.expect("enable should succeed");
        manager.enable().await.expect("second enable should be a no-op");
        assert!(manager.status().await.active);

        manager.disable().await.expect("disable should succeed");
        manager.disable().await.expect("second disable should be a no-op");
        assert!(!manager.status().await.active);
        assert_eq!(manager.status().await.message, None);
    }

    #[tokio::test]
    async fn status_reflects_unexpected_child_exit() {
        let (child, state) = FakeChildHandle::new(17);
        let manager = KeepAwakeManager::with_spawner(Arc::new(FakeSpawner {
            support: SupportStatus {
                supported: true,
                message: None,
            },
            next_spawn: StdMutex::new(vec![Ok(child)]),
        }));

        manager.enable().await.expect("enable should succeed");
        state.lock().expect("fake child state lock poisoned").alive = false;

        let status = manager.status().await;
        assert!(!status.active);
        assert_eq!(
            status.message.as_deref(),
            Some("keep awake helper exited unexpectedly with status code 17")
        );
    }

    fn exit_status_from_code(code: i32) -> ExitStatus {
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;

            ExitStatus::from_raw(code << 8)
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::ExitStatusExt;

            ExitStatus::from_raw(code as u32)
        }
    }
}
