use std::{
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::Arc,
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::{process::Child, sync::Mutex};

use crate::config::app_config::AppConfig;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeepAwakeStatus {
    pub supported: bool,
    pub active: bool,
    pub message: Option<String>,
}

#[derive(Clone)]
pub struct KeepAwakeManager {
    spawner: Arc<dyn KeepAwakeSpawner>,
    process_ops: Arc<dyn KeepAwakeProcessOps>,
    state_path: PathBuf,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct PersistedKeepAwakeHelper {
    pid: u32,
    program: String,
    args: Vec<String>,
    start_marker: Option<String>,
}

struct SpawnedKeepAwakeChild {
    child: Box<dyn KeepAwakeChild>,
    persisted_helper: Option<PersistedKeepAwakeHelper>,
}

#[async_trait]
trait KeepAwakeChild: Send {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>>;
    async fn kill(&mut self) -> io::Result<()>;
    async fn wait(&mut self) -> io::Result<ExitStatus>;
}

trait KeepAwakeSpawner: Send + Sync {
    fn support_status(&self) -> SupportStatus;
    fn spawn(&self) -> anyhow::Result<SpawnedKeepAwakeChild>;
}

trait KeepAwakeProcessOps: Send + Sync {
    fn read_command_line(&self, pid: u32) -> io::Result<Option<String>>;
    fn read_start_marker(&self, pid: u32) -> io::Result<Option<String>>;
    fn terminate(&self, pid: u32) -> io::Result<()>;
}

#[derive(Debug)]
struct ProcessKeepAwakeSpawner;

#[derive(Debug)]
struct SystemKeepAwakeProcessOps;

struct TokioKeepAwakeChild {
    child: Child,
}

impl KeepAwakeManager {
    pub fn new() -> Self {
        Self::with_dependencies(
            Arc::new(ProcessKeepAwakeSpawner),
            Arc::new(SystemKeepAwakeProcessOps),
            default_state_path(),
        )
    }

    fn with_dependencies(
        spawner: Arc<dyn KeepAwakeSpawner>,
        process_ops: Arc<dyn KeepAwakeProcessOps>,
        state_path: PathBuf,
    ) -> Self {
        Self {
            spawner,
            process_ops,
            state_path,
            runtime: Arc::new(Mutex::new(KeepAwakeRuntime {
                child: None,
                last_error: None,
            })),
        }
    }

    pub fn reclaim_stale_helper(&self) -> Result<(), String> {
        let Some(helper) = load_helper_state(&self.state_path)? else {
            return Ok(());
        };

        let command_line = self
            .process_ops
            .read_command_line(helper.pid)
            .map_err(|error| {
                format!(
                    "failed to inspect stale keep awake helper {}: {error}",
                    helper.pid
                )
            })?;
        let start_marker = self.process_ops.read_start_marker(helper.pid).map_err(|error| {
            format!(
                "failed to inspect stale keep awake helper start marker {}: {error}",
                helper.pid
            )
        })?;

        if let (Some(command_line), Some(start_marker)) = (command_line, start_marker) {
            if process_matches_helper(command_line.as_str(), start_marker.as_str(), &helper) {
                self.process_ops.terminate(helper.pid).map_err(|error| {
                    format!(
                        "failed to stop stale keep awake helper {}: {error}",
                        helper.pid
                    )
                })?;
            }
        }

        clear_helper_state(&self.state_path)
    }

    pub async fn status(&self) -> KeepAwakeStatus {
        let support = self.spawner.support_status();
        let mut runtime = self.runtime.lock().await;
        self.sync_child_state(&mut runtime);

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
            self.runtime.lock().await.last_error = Some(message.clone());
            return Err(message);
        }

        let mut runtime = self.runtime.lock().await;
        self.sync_child_state(&mut runtime);
        if runtime.child.is_some() {
            runtime.last_error = None;
            return Ok(());
        }

        match self.spawner.spawn() {
            Ok(spawned) => {
                if let Some(helper) = spawned.persisted_helper.as_ref() {
                    if let Err(error) = save_helper_state(&self.state_path, helper) {
                        log::warn!("failed to persist keep awake helper state: {error}");
                    }
                }
                runtime.child = Some(spawned.child);
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
        let mut runtime = self.runtime.lock().await;
        self.sync_child_state(&mut runtime);
        runtime.last_error = None;

        let Some(mut child) = runtime.child.take() else {
            drop(runtime);
            return clear_helper_state(&self.state_path);
        };

        match child.try_wait() {
            Ok(Some(_)) => {
                drop(runtime);
                clear_helper_state(&self.state_path)?;
                Ok(())
            }
            Ok(None) => {
                if let Err(error) = child.kill().await {
                    let message = format!("failed to stop keep awake helper: {error}");
                    runtime.child = Some(child);
                    runtime.last_error = Some(message.clone());
                    return Err(message);
                }

                if let Err(error) = child.wait().await {
                    let message = format!("failed to wait for keep awake helper shutdown: {error}");
                    runtime.child = Some(child);
                    self.sync_child_state(&mut runtime);
                    runtime.last_error = Some(message.clone());
                    return Err(message);
                }

                runtime.last_error = None;
                drop(runtime);
                clear_helper_state(&self.state_path)?;
                Ok(())
            }
            Err(error) => {
                let message = format!("failed to inspect keep awake helper state: {error}");
                runtime.child = Some(child);
                runtime.last_error = Some(message.clone());
                Err(message)
            }
        }
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        self.disable().await
    }

    fn sync_child_state(&self, runtime: &mut KeepAwakeRuntime) {
        let outcome = runtime.child.as_mut().map(|child| child.try_wait());
        match outcome {
            Some(Ok(Some(status))) => {
                runtime.child = None;
                runtime.last_error = Some(exit_status_message(status));
                if let Err(error) = clear_helper_state(&self.state_path) {
                    log::warn!("failed to clear keep awake helper state: {error}");
                }
            }
            Some(Ok(None)) => {}
            Some(Err(error)) => {
                runtime.child = None;
                runtime.last_error = Some(format!(
                    "failed to inspect keep awake helper state: {error}"
                ));
                if let Err(clear_error) = clear_helper_state(&self.state_path) {
                    log::warn!("failed to clear keep awake helper state: {clear_error}");
                }
            }
            None => {}
        }
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

    fn spawn(&self) -> anyhow::Result<SpawnedKeepAwakeChild> {
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
        let persisted_helper = child.id().map(|pid| PersistedKeepAwakeHelper {
            pid,
            program: spec.program.display().to_string(),
            args: spec
                .args
                .iter()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect(),
            start_marker: read_process_start_marker(pid)
                .map_err(|error| {
                    log::warn!(
                        "failed to read keep awake helper start marker for pid {}: {}",
                        pid,
                        error
                    );
                    error
                })
                .ok()
                .flatten(),
        });

        Ok(SpawnedKeepAwakeChild {
            child: Box::new(TokioKeepAwakeChild { child }),
            persisted_helper,
        })
    }
}

impl KeepAwakeProcessOps for SystemKeepAwakeProcessOps {
    fn read_command_line(&self, pid: u32) -> io::Result<Option<String>> {
        read_process_command_line(pid)
    }

    fn read_start_marker(&self, pid: u32) -> io::Result<Option<String>> {
        read_process_start_marker(pid)
    }

    fn terminate(&self, pid: u32) -> io::Result<()> {
        terminate_process(pid)
    }
}

fn default_state_path() -> PathBuf {
    AppConfig::path()
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("keep-awake-helper.json")
}

fn save_helper_state(path: &Path, helper: &PersistedKeepAwakeHelper) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_vec(helper).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

fn load_helper_state(path: &Path) -> Result<Option<PersistedKeepAwakeHelper>, String> {
    let raw = match fs::read(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };

    serde_json::from_slice::<PersistedKeepAwakeHelper>(&raw)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn clear_helper_state(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn process_matches_helper(
    command_line: &str,
    start_marker: &str,
    helper: &PersistedKeepAwakeHelper,
) -> bool {
    if helper.start_marker.as_deref() != Some(start_marker) {
        return false;
    }

    let program_name = Path::new(&helper.program)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(helper.program.as_str());
    if !command_line.contains(program_name) {
        return false;
    }

    helper
        .args
        .iter()
        .filter(|arg| !arg.is_empty())
        .all(|arg| command_line.contains(arg))
}

fn read_process_start_marker(pid: u32) -> io::Result<Option<String>> {
    #[cfg(target_os = "linux")]
    {
        let proc_stat = PathBuf::from(format!("/proc/{pid}/stat"));
        match fs::read_to_string(&proc_stat) {
            Ok(raw) => {
                let Some(process_tail) = raw.rsplit_once(") ").map(|(_, tail)| tail) else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("unexpected stat format for pid {pid}"),
                    ));
                };
                let fields = process_tail.split_whitespace().collect::<Vec<_>>();
                let Some(start_time) = fields.get(19) else {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!("missing start time for pid {pid}"),
                    ));
                };
                return Ok(Some((*start_time).to_string()));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        }
    }

    #[allow(unreachable_code)]
    {
        let ps = crate::runtime_env::resolve_executable("ps")
            .unwrap_or_else(|| PathBuf::from("/bin/ps"));
        let output = Command::new(ps)
            .args(["-p", &pid.to_string(), "-o", "lstart="])
            .output()?;
        if !output.status.success() {
            return Ok(None);
        }

        let start_marker = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if start_marker.is_empty() {
            Ok(None)
        } else {
            Ok(Some(start_marker))
        }
    }
}

fn read_process_command_line(pid: u32) -> io::Result<Option<String>> {
    #[cfg(target_os = "linux")]
    {
        let proc_cmdline = PathBuf::from(format!("/proc/{pid}/cmdline"));
        match fs::read(&proc_cmdline) {
            Ok(raw) => {
                if raw.is_empty() {
                    return Ok(None);
                }
                let command_line = raw
                    .split(|byte| *byte == 0)
                    .filter(|segment| !segment.is_empty())
                    .map(|segment| String::from_utf8_lossy(segment).into_owned())
                    .collect::<Vec<_>>()
                    .join(" ");
                return Ok(Some(command_line));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        }
    }

    #[allow(unreachable_code)]
    {
        let ps = crate::runtime_env::resolve_executable("ps")
            .unwrap_or_else(|| PathBuf::from("/bin/ps"));
        let output = Command::new(ps)
            .args(["-p", &pid.to_string(), "-o", "command="])
            .output()?;
        if !output.status.success() {
            return Ok(None);
        }

        let command_line = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if command_line.is_empty() {
            Ok(None)
        } else {
            Ok(Some(command_line))
        }
    }
}

fn terminate_process(pid: u32) -> io::Result<()> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        let result = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
        if result == 0 {
            return Ok(());
        }

        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(());
        }
        return Err(error);
    }

    #[allow(unreachable_code)]
    Err(io::Error::other(
        "keep awake termination is not supported on this platform",
    ))
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
                OsString::from("--what=idle:sleep"),
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
    use std::{collections::HashMap, sync::Mutex as StdMutex};
    use uuid::Uuid;

    struct FakeSpawner {
        support: SupportStatus,
        next_spawn: StdMutex<Vec<anyhow::Result<SpawnedKeepAwakeChild>>>,
    }

    #[derive(Debug, Default)]
    struct FakeProcessOps {
        commands: StdMutex<HashMap<u32, Option<String>>>,
        start_markers: StdMutex<HashMap<u32, Option<String>>>,
        terminated: StdMutex<Vec<u32>>,
        terminate_error: StdMutex<Option<String>>,
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

        fn spawn(&self) -> anyhow::Result<SpawnedKeepAwakeChild> {
            match self
                .next_spawn
                .lock()
                .expect("fake spawner lock poisoned")
                .pop()
            {
                Some(next) => next,
                None => anyhow::bail!("no fake child configured"),
            }
        }
    }

    impl KeepAwakeProcessOps for FakeProcessOps {
        fn read_command_line(&self, pid: u32) -> io::Result<Option<String>> {
            Ok(self
                .commands
                .lock()
                .expect("fake commands lock poisoned")
                .get(&pid)
                .cloned()
                .flatten())
        }

        fn terminate(&self, pid: u32) -> io::Result<()> {
            if let Some(error) = self
                .terminate_error
                .lock()
                .expect("fake terminate error lock poisoned")
                .clone()
            {
                return Err(io::Error::other(error));
            }

            self.terminated
                .lock()
                .expect("fake terminated lock poisoned")
                .push(pid);
            Ok(())
        }

        fn read_start_marker(&self, pid: u32) -> io::Result<Option<String>> {
            Ok(self
                .start_markers
                .lock()
                .expect("fake start markers lock poisoned")
                .get(&pid)
                .cloned()
                .flatten())
        }
    }

    fn make_spawn(child: FakeChildHandle, pid: u32) -> SpawnedKeepAwakeChild {
        SpawnedKeepAwakeChild {
            child: Box::new(child),
            persisted_helper: Some(PersistedKeepAwakeHelper {
                pid,
                program: "/usr/bin/caffeinate".to_string(),
                args: vec!["-i".to_string()],
                start_marker: Some(format!("start-{pid}")),
            }),
        }
    }

    fn temp_state_path() -> PathBuf {
        std::env::temp_dir().join(format!("panes-keep-awake-{}.json", Uuid::new_v4()))
    }

    #[tokio::test]
    async fn reports_unsupported_runtime() {
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: false,
                    message: Some("unsupported".to_string()),
                },
                next_spawn: StdMutex::new(Vec::new()),
            }),
            Arc::new(FakeProcessOps::default()),
            temp_state_path(),
        );

        let status = manager.status().await;
        assert!(!status.supported);
        assert!(!status.active);
        assert_eq!(status.message.as_deref(), Some("unsupported"));
        assert!(manager.enable().await.is_err());
    }

    #[tokio::test]
    async fn enable_and_disable_are_idempotent() {
        let (child, _state) = FakeChildHandle::new(0);
        let state_path = temp_state_path();
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(vec![Ok(make_spawn(child, 101))]),
            }),
            Arc::new(FakeProcessOps::default()),
            state_path.clone(),
        );

        manager.enable().await.expect("enable should succeed");
        assert!(state_path.exists());
        manager
            .enable()
            .await
            .expect("second enable should be a no-op");
        assert!(manager.status().await.active);

        manager.disable().await.expect("disable should succeed");
        manager
            .disable()
            .await
            .expect("second disable should be a no-op");
        assert!(!manager.status().await.active);
        assert_eq!(manager.status().await.message, None);
        assert!(!state_path.exists());
    }

    #[tokio::test]
    async fn status_reflects_unexpected_child_exit() {
        let (child, state) = FakeChildHandle::new(17);
        let state_path = temp_state_path();
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(vec![Ok(make_spawn(child, 202))]),
            }),
            Arc::new(FakeProcessOps::default()),
            state_path.clone(),
        );

        manager.enable().await.expect("enable should succeed");
        state.lock().expect("fake child state lock poisoned").alive = false;

        let status = manager.status().await;
        assert!(!status.active);
        assert_eq!(
            status.message.as_deref(),
            Some("keep awake helper exited unexpectedly with status code 17")
        );
        assert!(!state_path.exists());
    }

    #[tokio::test]
    async fn disable_failure_keeps_helper_tracked() {
        let (child, state) = FakeChildHandle::new(0);
        state
            .lock()
            .expect("fake child state lock poisoned")
            .kill_error = Some("permission denied".to_string());
        let state_path = temp_state_path();
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(vec![Ok(make_spawn(child, 303))]),
            }),
            Arc::new(FakeProcessOps::default()),
            state_path.clone(),
        );

        manager.enable().await.expect("enable should succeed");
        let error = manager
            .disable()
            .await
            .expect_err("disable should surface kill failures");
        assert!(error.contains("failed to stop keep awake helper"));
        assert!(manager.status().await.active);
        assert!(state_path.exists());
    }

    #[test]
    fn reclaim_stale_helper_terminates_matching_process() {
        let state_path = temp_state_path();
        save_helper_state(
            &state_path,
            &PersistedKeepAwakeHelper {
                pid: 404,
                program: "/usr/bin/caffeinate".to_string(),
                args: vec!["-i".to_string()],
                start_marker: Some("start-404".to_string()),
            },
        )
        .expect("helper state should save");

        let process_ops = Arc::new(FakeProcessOps::default());
        process_ops
            .commands
            .lock()
            .expect("fake commands lock poisoned")
            .insert(404, Some("/usr/bin/caffeinate -i".to_string()));
        process_ops
            .start_markers
            .lock()
            .expect("fake start markers lock poisoned")
            .insert(404, Some("start-404".to_string()));
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(Vec::new()),
            }),
            process_ops.clone(),
            state_path.clone(),
        );

        manager
            .reclaim_stale_helper()
            .expect("stale helper reclaim should succeed");

        assert_eq!(
            process_ops
                .terminated
                .lock()
                .expect("fake terminated lock poisoned")
                .as_slice(),
            &[404]
        );
        assert!(!state_path.exists());
    }

    #[test]
    fn reclaim_stale_helper_skips_pid_reuse_when_start_marker_differs() {
        let state_path = temp_state_path();
        save_helper_state(
            &state_path,
            &PersistedKeepAwakeHelper {
                pid: 505,
                program: "/usr/bin/caffeinate".to_string(),
                args: vec!["-i".to_string()],
                start_marker: Some("start-505".to_string()),
            },
        )
        .expect("helper state should save");

        let process_ops = Arc::new(FakeProcessOps::default());
        process_ops
            .commands
            .lock()
            .expect("fake commands lock poisoned")
            .insert(505, Some("/usr/bin/caffeinate -i".to_string()));
        process_ops
            .start_markers
            .lock()
            .expect("fake start markers lock poisoned")
            .insert(505, Some("reused-505".to_string()));
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(Vec::new()),
            }),
            process_ops.clone(),
            state_path.clone(),
        );

        manager
            .reclaim_stale_helper()
            .expect("stale helper reclaim should succeed");

        assert!(
            process_ops
                .terminated
                .lock()
                .expect("fake terminated lock poisoned")
                .is_empty()
        );
        assert!(!state_path.exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_backend_blocks_sleep_and_idle() {
        let spec = resolve_backend_spec().expect("linux backend should resolve");
        let args = spec
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert!(args.iter().any(|arg| arg == "--what=idle:sleep"));
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
