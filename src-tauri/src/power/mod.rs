use std::{
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::Arc,
    time::Duration,
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tokio::{process::Child, sync::Mutex};

pub mod monitor;

use crate::config::app_config::{AppConfig, PowerConfig};
use crate::process_utils;

use monitor::{MonitorConfig, MonitorEvent, PowerMonitorCleanup};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeepAwakeStatus {
    pub supported: bool,
    pub active: bool,
    pub supports_closed_display: Option<bool>,
    pub closed_display_active: Option<bool>,
    pub message: Option<String>,
    pub display_sleep_prevented: bool,
    pub screen_saver_prevented: bool,
    pub on_ac_power: Option<bool>,
    pub battery_percent: Option<u8>,
    pub session_remaining_secs: Option<u64>,
    pub paused_due_to_battery: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct ClosedDisplayDiagnostics {
    supports_closed_display: Option<bool>,
    closed_display_active: Option<bool>,
}

#[derive(Clone)]
pub struct KeepAwakeManager {
    spawner: Arc<dyn KeepAwakeSpawner>,
    process_ops: Arc<dyn KeepAwakeProcessOps>,
    state_dir: PathBuf,
    current_process: ProcessIdentity,
    runtime: Arc<Mutex<KeepAwakeRuntime>>,
}

struct KeepAwakeRuntime {
    child: Option<Box<dyn KeepAwakeChild>>,
    helper: Option<KeepAwakeHelperState>,
    last_error: Option<String>,
    secondary_child: Option<Box<dyn KeepAwakeChild>>,
    secondary_helper: Option<KeepAwakeHelperState>,
    monitor_cleanup: Option<PowerMonitorCleanup>,
    session_end_at: Option<std::time::Instant>,
    paused_due_to_battery: bool,
    active_profile: Option<PowerProfile>,
    on_ac_power: Option<bool>,
    battery_percent: Option<u8>,
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct PowerProfile {
    prevent_system_sleep: bool,
    prevent_display_sleep: bool,
    prevent_screen_saver: bool,
    ac_only: bool,
}

impl PowerProfile {
    fn from_config(config: &PowerConfig) -> Self {
        Self {
            prevent_system_sleep: true,
            prevent_display_sleep: config.prevent_display_sleep,
            prevent_screen_saver: config.prevent_screen_saver,
            ac_only: config.ac_only_mode,
        }
    }

    fn default_profile() -> Self {
        Self {
            prevent_system_sleep: true,
            prevent_display_sleep: false,
            prevent_screen_saver: false,
            ac_only: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct ProcessIdentity {
    pid: u32,
    start_marker: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct KeepAwakeHelperState {
    pid: u32,
    program: String,
    args: Vec<String>,
    start_marker: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct PersistedKeepAwakeHelper {
    owner: ProcessIdentity,
    helper: KeepAwakeHelperState,
}

struct SpawnedKeepAwakeChild {
    child: Box<dyn KeepAwakeChild>,
    helper: Option<KeepAwakeHelperState>,
}

#[async_trait]
trait KeepAwakeChild: Send {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>>;
    async fn kill(&mut self) -> io::Result<()>;
    async fn wait(&mut self) -> io::Result<ExitStatus>;
}

trait KeepAwakeSpawner: Send + Sync {
    fn support_status(&self) -> SupportStatus;
    fn spawn(&self, profile: &PowerProfile) -> anyhow::Result<SpawnedKeepAwakeChild>;
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

const KEEP_AWAKE_SPAWN_GRACE_PERIOD: Duration = Duration::from_millis(150);
const WINDOWS_KEEP_AWAKE_MARKER: &str = "PANES_KEEP_AWAKE_WINDOWS";

#[cfg(any(target_os = "linux", test))]
fn build_linux_gnome_inhibit_args(owner_pid: u32, tail: &Path) -> Vec<OsString> {
    vec![
        OsString::from("--app-id"),
        OsString::from("Panes"),
        OsString::from("--inhibit"),
        OsString::from("suspend"),
        OsString::from("--inhibit"),
        OsString::from("idle"),
        OsString::from("--reason"),
        OsString::from("Keep system awake while Panes is open"),
        tail.as_os_str().to_os_string(),
        OsString::from(format!("--pid={owner_pid}")),
        OsString::from("-f"),
        OsString::from("/dev/null"),
    ]
}

impl KeepAwakeManager {
    pub fn new() -> Self {
        Self::with_dependencies(
            Arc::new(ProcessKeepAwakeSpawner),
            Arc::new(SystemKeepAwakeProcessOps),
            default_state_dir(),
            current_process_identity(),
        )
    }

    fn with_dependencies(
        spawner: Arc<dyn KeepAwakeSpawner>,
        process_ops: Arc<dyn KeepAwakeProcessOps>,
        state_dir: PathBuf,
        current_process: ProcessIdentity,
    ) -> Self {
        Self {
            spawner,
            process_ops,
            state_dir,
            current_process,
            runtime: Arc::new(Mutex::new(KeepAwakeRuntime {
                child: None,
                helper: None,
                last_error: None,
                secondary_child: None,
                secondary_helper: None,
                monitor_cleanup: None,
                session_end_at: None,
                paused_due_to_battery: false,
                active_profile: None,
                on_ac_power: None,
                battery_percent: None,
            })),
        }
    }

    pub fn reclaim_stale_helpers(&self) -> Result<(), String> {
        for state_path in list_helper_state_paths(&self.state_dir)? {
            let helper = match load_helper_state(&state_path) {
                Ok(helper) => helper,
                Err(error) => {
                    log::warn!(
                        "failed to load keep awake helper state {}: {}",
                        state_path.display(),
                        error
                    );
                    clear_helper_state(&state_path)?;
                    continue;
                }
            };
            let Some(helper) = helper else {
                continue;
            };
            if self.owner_may_still_be_running(&helper.owner)? {
                continue;
            }
            self.reclaim_helper_state(&state_path, &helper)?;
        }

        Ok(())
    }

    pub async fn status(&self) -> KeepAwakeStatus {
        let support = self.spawner.support_status();
        let (active, helper_pid, last_error, profile, session_end_at, on_ac_power, battery_percent, paused_due_to_battery) = {
            let mut runtime = self.runtime.lock().await;
            self.sync_child_state(&mut runtime);
            (
                runtime.child.is_some(),
                runtime.helper.as_ref().map(|helper| helper.pid),
                runtime.last_error.clone(),
                runtime.active_profile.clone(),
                runtime.session_end_at,
                runtime.on_ac_power,
                runtime.battery_percent,
                runtime.paused_due_to_battery,
            )
        };
        let closed_display = closed_display_diagnostics(active, helper_pid).await;

        let session_remaining_secs = session_end_at
            .map(|end| end.saturating_duration_since(std::time::Instant::now()).as_secs());

        let display_sleep_prevented = active && profile.as_ref().is_some_and(|p| p.prevent_display_sleep);
        let screen_saver_prevented = active && profile.as_ref().is_some_and(|p| p.prevent_screen_saver);

        KeepAwakeStatus {
            supported: support.supported,
            active,
            supports_closed_display: closed_display.supports_closed_display,
            closed_display_active: closed_display.closed_display_active,
            message: if !support.supported {
                support.message
            } else if active {
                None
            } else {
                last_error
            },
            display_sleep_prevented,
            screen_saver_prevented,
            on_ac_power,
            battery_percent,
            session_remaining_secs,
            paused_due_to_battery,
        }
    }

    pub async fn enable(&self) -> Result<(), String> {
        self.enable_with_config(&PowerConfig::default()).await
    }

    pub async fn enable_with_config(&self, config: &PowerConfig) -> Result<(), String> {
        let profile = PowerProfile::from_config(config);
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
        // Idempotent: if a child is already running, return success without
        // updating the profile or monitor. Callers that need to change the
        // active profile must call disable() first (set_power_settings does).
        if runtime.child.is_some() {
            runtime.last_error = None;
            return Ok(());
        }

        match self.spawner.spawn(&profile) {
            Ok(spawned) => {
                if let Some(helper) = spawned.helper.as_ref() {
                    let helper = PersistedKeepAwakeHelper {
                        owner: self.current_process.clone(),
                        helper: helper.clone(),
                    };
                    if let Err(error) = save_helper_state(&self.state_path(), &helper) {
                        log::warn!("failed to persist keep awake helper state: {error}");
                    }
                    log::info!(
                        "keep awake helper started: pid={}, program={}, args={:?}",
                        helper.helper.pid,
                        helper.helper.program,
                        helper.helper.args
                    );
                }
                runtime.child = Some(spawned.child);
                runtime.helper = spawned.helper;
                runtime.last_error = None;
                runtime.active_profile = Some(profile.clone());
                runtime.paused_due_to_battery = false;
                drop(runtime);

                // Spawn secondary child for Linux display inhibit if needed
                #[cfg(target_os = "linux")]
                if profile.prevent_display_sleep || profile.prevent_screen_saver {
                    self.spawn_linux_display_inhibit().await;
                }

                tokio::time::sleep(KEEP_AWAKE_SPAWN_GRACE_PERIOD).await;

                let mut runtime = self.runtime.lock().await;
                self.sync_child_state(&mut runtime);
                if runtime.child.is_some() {
                    // Always start the monitor so the UI can show power source
                    // status. AC-only, battery threshold, and session timer
                    // features are gated inside the monitor/event-processor.
                    let monitor_config = MonitorConfig {
                        ac_only_mode: config.ac_only_mode,
                        battery_threshold: config.battery_threshold,
                        session_duration_secs: config.session_duration_secs,
                    };
                    let monitor = monitor::start_monitor(monitor_config);
                    runtime.session_end_at = monitor.cleanup.session_end_at;
                    runtime.monitor_cleanup = Some(monitor.cleanup);
                    drop(runtime);

                    let manager = self.clone();
                    let event_rx = monitor.event_rx;
                    tokio::spawn(async move {
                        manager.process_monitor_events(event_rx).await;
                    });

                    Ok(())
                } else {
                    let message = runtime
                        .last_error
                        .clone()
                        .unwrap_or_else(|| "keep awake helper exited unexpectedly".to_string());
                    log::warn!("keep awake failed immediately after enable: {message}");
                    Err(message)
                }
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
        runtime.paused_due_to_battery = false;

        // Stop monitor task
        if let Some(cleanup) = runtime.monitor_cleanup.take() {
            cleanup.task.abort();
        }
        runtime.session_end_at = None;
        runtime.active_profile = None;

        // Kill secondary child (Linux D-Bus inhibit)
        if let Some(mut secondary) = runtime.secondary_child.take() {
            let _ = secondary.kill().await;
            let _ = secondary.wait().await;
        }
        runtime.secondary_helper = None;

        let Some(mut child) = runtime.child.take() else {
            runtime.helper = None;
            drop(runtime);
            return clear_helper_state(&self.state_path());
        };

        match child.try_wait() {
            Ok(Some(_)) => {
                drop(runtime);
                clear_helper_state(&self.state_path())?;
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
                runtime.helper = None;
                drop(runtime);
                clear_helper_state(&self.state_path())?;
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

    async fn process_monitor_events(
        &self,
        mut event_rx: tokio::sync::mpsc::Receiver<MonitorEvent>,
    ) {
        loop {
            let event = event_rx.recv().await;

            match event {
                Some(MonitorEvent::SessionExpired) => {
                    log::info!("keep awake session timer expired");
                    let _ = self.disable().await;
                    break;
                }
                Some(MonitorEvent::PowerSourcePolled { on_ac, battery_percent }) => {
                    let mut runtime = self.runtime.lock().await;
                    runtime.on_ac_power = Some(on_ac);
                    runtime.battery_percent = battery_percent;
                }
                Some(MonitorEvent::AcStatusChanged { on_ac }) => {
                    let mut runtime = self.runtime.lock().await;
                    runtime.on_ac_power = Some(on_ac);

                    if !on_ac {
                        log::info!("keep awake pausing: switched to battery");
                        runtime.paused_due_to_battery = true;
                        // Kill primary child but keep monitor running
                        if let Some(mut child) = runtime.child.take() {
                            let _ = child.kill().await;
                            let _ = child.wait().await;
                        }
                        runtime.helper = None;
                        // Kill secondary child (Linux D-Bus inhibit)
                        if let Some(mut secondary) = runtime.secondary_child.take() {
                            let _ = secondary.kill().await;
                            let _ = secondary.wait().await;
                        }
                        runtime.secondary_helper = None;
                        let _ = clear_helper_state(&self.state_path());
                    } else if runtime.paused_due_to_battery {
                        log::info!("keep awake resuming: AC power restored");
                        let profile = runtime.active_profile.clone()
                            .unwrap_or_else(PowerProfile::default_profile);
                        drop(runtime);
                        // Re-spawn children with the active profile
                        match self.spawner.spawn(&profile) {
                            Ok(spawned) => {
                                let mut runtime = self.runtime.lock().await;
                                if let Some(helper) = spawned.helper.as_ref() {
                                    let persisted = PersistedKeepAwakeHelper {
                                        owner: self.current_process.clone(),
                                        helper: helper.clone(),
                                    };
                                    let _ = save_helper_state(&self.state_path(), &persisted);
                                }
                                runtime.child = Some(spawned.child);
                                runtime.helper = spawned.helper;
                                runtime.last_error = None;
                                runtime.paused_due_to_battery = false;
                                drop(runtime);

                                // Re-spawn Linux display inhibit if needed
                                #[cfg(target_os = "linux")]
                                if profile.prevent_display_sleep || profile.prevent_screen_saver {
                                    self.spawn_linux_display_inhibit().await;
                                }
                            }
                            Err(error) => {
                                let mut runtime = self.runtime.lock().await;
                                runtime.paused_due_to_battery = false;
                                runtime.last_error = Some(format!(
                                    "failed to resume keep awake on AC power: {error}"
                                ));
                            }
                        }
                    }
                }
                Some(MonitorEvent::BatteryLevel { percent }) => {
                    log::info!("keep awake disabling: battery at {percent}%");
                    {
                        let mut runtime = self.runtime.lock().await;
                        runtime.battery_percent = Some(percent);
                    }
                    if let Err(error) = self.disable().await {
                        let mut runtime = self.runtime.lock().await;
                        runtime.last_error = Some(format!(
                            "failed to disable keep awake at battery threshold {percent}%: {error}"
                        ));
                        break;
                    }
                    if let Err(error) = save_keep_awake_enabled_preference(false).await {
                        let mut runtime = self.runtime.lock().await;
                        runtime.last_error = Some(format!(
                            "keep awake disabled at battery threshold {percent}%, but failed to persist the preference: {error}"
                        ));
                    }
                    break;
                }
                None => break,
            }
        }
    }

    #[cfg(target_os = "linux")]
    async fn spawn_linux_display_inhibit(&self) {
        let spec = match resolve_display_inhibit_spec() {
            Ok(Some(spec)) => spec,
            Ok(None) => {
                log::info!("linux display inhibit: gdbus/bash not available, skipping");
                return;
            }
            Err(error) => {
                log::warn!("linux display inhibit: {error}");
                return;
            }
        };

        let mut command = tokio::process::Command::new(&spec.program);
        process_utils::configure_tokio_command(&mut command);
        command
            .args(&spec.args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);

        match command.spawn() {
            Ok(child) => {
                let helper = child.id().map(|pid| KeepAwakeHelperState {
                    pid,
                    program: spec.program.display().to_string(),
                    args: spec.args.iter().map(|a| a.to_string_lossy().into_owned()).collect(),
                    start_marker: read_process_start_marker(pid).ok().flatten(),
                });
                let mut runtime = self.runtime.lock().await;
                runtime.secondary_child = Some(Box::new(TokioKeepAwakeChild { child }));
                runtime.secondary_helper = helper;
                log::info!("linux display inhibit child started");
            }
            Err(error) => {
                log::warn!("failed to spawn linux display inhibit child: {error}");
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
                runtime.helper = None;
                runtime.last_error = Some(exit_status_message(status));
                if let Some(message) = runtime.last_error.as_deref() {
                    log::warn!("{message}");
                }
                if let Err(error) = clear_helper_state(&self.state_path()) {
                    log::warn!("failed to clear keep awake helper state: {error}");
                }
            }
            Some(Ok(None)) => {}
            Some(Err(error)) => {
                runtime.child = None;
                runtime.helper = None;
                runtime.last_error = Some(format!(
                    "failed to inspect keep awake helper state: {error}"
                ));
                if let Some(message) = runtime.last_error.as_deref() {
                    log::warn!("{message}");
                }
                if let Err(clear_error) = clear_helper_state(&self.state_path()) {
                    log::warn!("failed to clear keep awake helper state: {clear_error}");
                }
            }
            None => {}
        }
    }

    fn state_path(&self) -> PathBuf {
        state_file_path(&self.state_dir, self.current_process.pid)
    }

    fn owner_may_still_be_running(&self, owner: &ProcessIdentity) -> Result<bool, String> {
        let current_start_marker =
            self.process_ops
                .read_start_marker(owner.pid)
                .map_err(|error| {
                    format!(
                        "failed to inspect keep awake owner start marker {}: {error}",
                        owner.pid
                    )
                })?;
        if let Some(current_start_marker) = current_start_marker {
            return Ok(match owner.start_marker.as_deref() {
                Some(saved_start_marker) => saved_start_marker == current_start_marker,
                None => true,
            });
        }

        let command_line = self
            .process_ops
            .read_command_line(owner.pid)
            .map_err(|error| {
                format!("failed to inspect keep awake owner {}: {error}", owner.pid)
            })?;
        Ok(command_line.is_some())
    }

    fn reclaim_helper_state(
        &self,
        state_path: &Path,
        persisted: &PersistedKeepAwakeHelper,
    ) -> Result<(), String> {
        let command_line = self
            .process_ops
            .read_command_line(persisted.helper.pid)
            .map_err(|error| {
                format!(
                    "failed to inspect stale keep awake helper {}: {error}",
                    persisted.helper.pid
                )
            })?;
        let start_marker = self
            .process_ops
            .read_start_marker(persisted.helper.pid)
            .map_err(|error| {
                format!(
                    "failed to inspect stale keep awake helper start marker {}: {error}",
                    persisted.helper.pid
                )
            })?;

        let Some(command_line) = command_line else {
            return clear_helper_state(state_path);
        };
        if !helper_command_matches(command_line.as_str(), &persisted.helper) {
            return clear_helper_state(state_path);
        }

        match persisted.helper.start_marker.as_deref() {
            Some(saved_start_marker) => match start_marker.as_deref() {
                Some(current_start_marker) if current_start_marker == saved_start_marker => {
                    self.process_ops
                        .terminate(persisted.helper.pid)
                        .map_err(|error| {
                            format!(
                                "failed to stop stale keep awake helper {}: {error}",
                                persisted.helper.pid
                            )
                        })?;
                    clear_helper_state(state_path)
                }
                Some(_) => clear_helper_state(state_path),
                None => Ok(()),
            },
            None => {
                if let Some(current_start_marker) = start_marker {
                    let mut refreshed = persisted.clone();
                    refreshed.helper.start_marker = Some(current_start_marker);
                    save_helper_state(state_path, &refreshed)?;
                }
                self.process_ops
                    .terminate(persisted.helper.pid)
                    .map_err(|error| {
                        format!(
                            "failed to stop stale keep awake helper {}: {error}",
                            persisted.helper.pid
                        )
                    })?;
                clear_helper_state(state_path)
            }
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
        match resolve_backend_spec(&PowerProfile::default_profile()) {
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

    fn spawn(&self, profile: &PowerProfile) -> anyhow::Result<SpawnedKeepAwakeChild> {
        let spec = resolve_backend_spec(profile).map_err(anyhow::Error::msg)?;
        let mut command = tokio::process::Command::new(&spec.program);
        process_utils::configure_tokio_command(&mut command);
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
        let helper = child.id().map(|pid| KeepAwakeHelperState {
            pid,
            program: spec.program.display().to_string(),
            args: helper_command_args_fingerprint(&spec.program, &spec.args),
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
            helper,
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

fn default_state_dir() -> PathBuf {
    AppConfig::path()
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("keep-awake-helpers")
}

async fn save_keep_awake_enabled_preference(enabled: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        AppConfig::mutate(|config| {
            config.power.keep_awake_enabled = enabled;
            Ok(())
        })
        .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn current_process_identity() -> ProcessIdentity {
    let pid = std::process::id();
    ProcessIdentity {
        pid,
        start_marker: read_process_start_marker(pid).ok().flatten(),
    }
}

fn state_file_path(state_dir: &Path, pid: u32) -> PathBuf {
    state_dir.join(format!("{pid}.json"))
}

fn save_helper_state(path: &Path, helper: &PersistedKeepAwakeHelper) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let raw = serde_json::to_vec(helper).map_err(|error| error.to_string())?;
    let temp_path = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("")
    ));
    fs::write(&temp_path, raw).map_err(|error| error.to_string())?;
    fs::rename(&temp_path, path).map_err(|error| error.to_string())
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

fn list_helper_state_paths(state_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let entries = match fs::read_dir(state_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };

    let mut paths = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) == Some("json") {
            paths.push(path);
        }
    }
    Ok(paths)
}

fn helper_command_matches(command_line: &str, helper: &KeepAwakeHelperState) -> bool {
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

fn helper_command_args_fingerprint(program: &Path, args: &[OsString]) -> Vec<String> {
    if is_powershell_program(program)
        && args
            .last()
            .is_some_and(|arg| arg.to_string_lossy().contains(WINDOWS_KEEP_AWAKE_MARKER))
    {
        let mut fingerprint = args
            .iter()
            .take(args.len().saturating_sub(1))
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        fingerprint.push(WINDOWS_KEEP_AWAKE_MARKER.to_string());
        return fingerprint;
    }

    args.iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect()
}

fn is_powershell_program(program: &Path) -> bool {
    let program_name = program
        .to_string_lossy()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        program_name.as_str(),
        "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe"
    )
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

    #[cfg(target_os = "windows")]
    {
        return read_windows_process_property(pid, "CreationDate", true);
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

    #[cfg(target_os = "windows")]
    {
        return read_windows_process_property(pid, "CommandLine", false);
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

    #[cfg(target_os = "windows")]
    {
        return terminate_windows_process(pid);
    }

    #[allow(unreachable_code)]
    Err(io::Error::other(
        "keep awake termination is not supported on this platform",
    ))
}

#[cfg(target_os = "windows")]
fn read_windows_process_property(
    pid: u32,
    property: &str,
    format_datetime: bool,
) -> io::Result<Option<String>> {
    let formatting = if format_datetime {
        "$value.ToString('o')"
    } else {
        "$value.ToString()"
    };
    let script = format!(
        "$process = Get-CimInstance Win32_Process -Filter 'ProcessId = {pid}' | Select-Object -First 1; if ($null -eq $process) {{ exit 1 }}; $value = $process.{property}; if ($null -eq $value -or [string]::IsNullOrWhiteSpace($value.ToString())) {{ exit 1 }}; {formatting}"
    );
    let output = run_windows_powershell_script(&script)?;
    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        Ok(None)
    } else {
        Ok(Some(stdout))
    }
}

#[cfg(target_os = "windows")]
fn terminate_windows_process(pid: u32) -> io::Result<()> {
    let script = format!(
        "$process = Get-Process -Id {pid} -ErrorAction SilentlyContinue; if ($null -eq $process) {{ exit 0 }}; Stop-Process -Id {pid} -Force -ErrorAction Stop"
    );
    let output = run_windows_powershell_script(&script)?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(io::Error::other(if stderr.is_empty() {
        format!("failed to stop process {pid} via PowerShell")
    } else {
        stderr
    }))
}

#[cfg(target_os = "windows")]
fn run_windows_powershell_script(script: &str) -> io::Result<std::process::Output> {
    let powershell = resolve_windows_powershell().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "Windows keep awake requires PowerShell",
        )
    })?;
    let mut command = Command::new(powershell);
    process_utils::configure_std_command(&mut command);
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .output()
}

fn exit_status_message(status: ExitStatus) -> String {
    match status.code() {
        Some(code) => format!("keep awake helper exited unexpectedly with status code {code}"),
        None => "keep awake helper exited unexpectedly".to_string(),
    }
}

#[cfg(target_os = "macos")]
async fn closed_display_diagnostics(
    _keep_awake_active: bool,
    _helper_pid: Option<u32>,
) -> ClosedDisplayDiagnostics {
    // This backend uses public caffeinate assertions only. Real-world validation on macOS
    // shows that these assertions do not reliably prove clamshell behavior, so the UI
    // must keep closed-display status as unknown unless a stronger backend is added.
    ClosedDisplayDiagnostics::default()
}

#[cfg(not(target_os = "macos"))]
async fn closed_display_diagnostics(
    _keep_awake_active: bool,
    _helper_pid: Option<u32>,
) -> ClosedDisplayDiagnostics {
    ClosedDisplayDiagnostics::default()
}

fn resolve_backend_spec(profile: &PowerProfile) -> Result<BackendSpec, String> {
    #[cfg(target_os = "macos")]
    {
        let owner_pid = std::process::id();
        let caffeinate = crate::runtime_env::resolve_executable("caffeinate")
            .ok_or_else(|| "macOS keep awake requires the `caffeinate` utility".to_string())?;

        let mut args = Vec::new();

        // System sleep prevention
        if profile.prevent_system_sleep {
            if profile.ac_only {
                // AC-only: -s alone keeps the assertion limited to AC power.
                // Closed-display/clamshell behavior still remains unknown.
                args.push(OsString::from("-s"));
            } else {
                // Default: -i prevents idle sleep on any power source, while
                // -s adds the public AC-only system sleep assertion. The
                // backend still does not guarantee closed-display behavior.
                args.push(OsString::from("-i"));
                args.push(OsString::from("-s"));
            }
        }

        // Display sleep / screen saver prevention
        if profile.prevent_display_sleep || profile.prevent_screen_saver {
            args.push(OsString::from("-d"));
        }

        // Exit when owner exits
        args.push(OsString::from("-w"));
        args.push(OsString::from(owner_pid.to_string()));

        return Ok(BackendSpec {
            program: caffeinate,
            args,
        });
    }

    #[cfg(target_os = "linux")]
    {
        let owner_pid = std::process::id();
        let tail = crate::runtime_env::resolve_executable("tail");

        // Try systemd-inhibit first (covers most Linux distributions).
        if let Some(systemd_inhibit) = crate::runtime_env::resolve_executable("systemd-inhibit") {
            let tail = tail
                .clone()
                .ok_or_else(|| "Linux keep awake requires the `tail` utility".to_string())?;

            // Build --what= argument — always inhibit handle-lid-switch when active
            let what_arg = "--what=idle:sleep:handle-lid-switch";

            return Ok(BackendSpec {
                program: systemd_inhibit,
                args: vec![
                    OsString::from(what_arg),
                    OsString::from("--mode=block"),
                    OsString::from("--who=Panes"),
                    OsString::from("--why=Keep system awake while Panes is open"),
                    tail.into_os_string(),
                    OsString::from(format!("--pid={owner_pid}")),
                    OsString::from("-f"),
                    OsString::from("/dev/null"),
                ],
            });
        }

        // Fallback for non-systemd distros: try gnome-session-inhibit.
        if let Some(gnome_inhibit) = crate::runtime_env::resolve_executable("gnome-session-inhibit")
        {
            let tail =
                tail.ok_or_else(|| "Linux keep awake requires the `tail` utility".to_string())?;
            return Ok(BackendSpec {
                program: gnome_inhibit,
                args: build_linux_gnome_inhibit_args(owner_pid, &tail),
            });
        }

        return Err(
            "Linux keep awake requires `systemd-inhibit` or `gnome-session-inhibit`".to_string(),
        );
    }

    #[cfg(target_os = "windows")]
    {
        let owner_pid = std::process::id();
        let powershell = resolve_windows_powershell()
            .ok_or_else(|| "Windows keep awake requires PowerShell".to_string())?;
        return Ok(BackendSpec {
            program: powershell,
            args: build_windows_keep_awake_args(owner_pid, profile),
        });
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = profile;
        Err("keep awake is not supported on this platform".to_string())
    }
}

#[cfg(target_os = "linux")]
fn resolve_display_inhibit_spec() -> Result<Option<BackendSpec>, String> {
    let gdbus = crate::runtime_env::resolve_executable("gdbus");
    let bash = crate::runtime_env::resolve_executable("bash");
    let tail = crate::runtime_env::resolve_executable("tail");

    if gdbus.is_none() || bash.is_none() || tail.is_none() {
        return Ok(None); // graceful degradation
    }

    let gdbus_path = gdbus.unwrap();
    let bash = bash.unwrap();
    let tail_path = tail.unwrap();
    let owner_pid = std::process::id();

    // Self-contained shell script that:
    // 1. Calls org.freedesktop.ScreenSaver.Inhibit and captures the cookie
    // 2. Sets a trap to call UnInhibit on exit
    // 3. Waits for the owner PID to exit via tail --pid
    let script = format!(
        "COOKIE=$({gdbus} call --session --dest org.freedesktop.ScreenSaver \
         --object-path /org/freedesktop/ScreenSaver \
         --method org.freedesktop.ScreenSaver.Inhibit \"Panes\" \"Keep display awake\" 2>/dev/null \
         | tr -dc '0-9') && \
         [ -n \"$COOKIE\" ] && \
         trap \"{gdbus} call --session --dest org.freedesktop.ScreenSaver \
         --object-path /org/freedesktop/ScreenSaver \
         --method org.freedesktop.ScreenSaver.UnInhibit $COOKIE 2>/dev/null\" EXIT && \
         {tail} --pid={owner_pid} -f /dev/null",
        gdbus = gdbus_path.display(),
        tail = tail_path.display(),
    );

    Ok(Some(BackendSpec {
        program: bash,
        args: vec![OsString::from("-c"), OsString::from(script)],
    }))
}

#[cfg(target_os = "windows")]
fn resolve_windows_powershell() -> Option<PathBuf> {
    ["powershell.exe", "powershell", "pwsh", "pwsh.exe"]
        .into_iter()
        .find_map(crate::runtime_env::resolve_executable)
}

#[cfg(any(target_os = "windows", test))]
fn build_windows_keep_awake_args(owner_pid: u32, profile: &PowerProfile) -> Vec<OsString> {
    vec![
        OsString::from("-NoLogo"),
        OsString::from("-NoProfile"),
        OsString::from("-NonInteractive"),
        OsString::from("-ExecutionPolicy"),
        OsString::from("Bypass"),
        OsString::from("-WindowStyle"),
        OsString::from("Hidden"),
        OsString::from("-Command"),
        OsString::from(build_windows_keep_awake_script(owner_pid, profile)),
    ]
}

#[cfg(any(target_os = "windows", test))]
fn build_windows_keep_awake_script(owner_pid: u32, profile: &PowerProfile) -> String {
    let mut flags = vec!["$continuous"];
    if profile.prevent_system_sleep {
        flags.push("$systemRequired");
    }
    if profile.prevent_display_sleep {
        flags.push("$displayRequired");
    }
    let flags_expr = flags.join(" -bor ");

    let screen_saver_type = if profile.prevent_screen_saver {
        "public static class PanesScreenSaver { \
         [DllImport(\"user32.dll\", SetLastError=true)] \
         public static extern bool SystemParametersInfo(uint action, uint param, IntPtr vparam, uint init); \
         } "
    } else {
        ""
    };

    let screen_saver_disable = if profile.prevent_screen_saver {
        "[PanesScreenSaver]::SystemParametersInfo(0x11, 0, [IntPtr]::Zero, 0) | Out-Null; "
    } else {
        ""
    };

    let screen_saver_restore = if profile.prevent_screen_saver {
        "[PanesScreenSaver]::SystemParametersInfo(0x11, 1, [IntPtr]::Zero, 0) | Out-Null; "
    } else {
        ""
    };

    format!(
        "$marker = '{WINDOWS_KEEP_AWAKE_MARKER}'; \
$ownerPid = {owner_pid}; \
$signature = @'\
using System.Runtime.InteropServices; \
public static class PanesKeepAwakeNative {{ \
  [DllImport(\"kernel32.dll\", SetLastError=true)] \
  public static extern uint SetThreadExecutionState(uint esFlags); \
}} \
{screen_saver_type}\
'@; \
Add-Type -TypeDefinition $signature; \
$continuous = 0x80000000; \
$systemRequired = 0x00000001; \
$displayRequired = 0x00000002; \
{screen_saver_disable}\
try {{ \
  while (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue) {{ \
    [PanesKeepAwakeNative]::SetThreadExecutionState({flags_expr}) | Out-Null; \
    Start-Sleep -Seconds 30; \
  }} \
}} finally {{ \
  [PanesKeepAwakeNative]::SetThreadExecutionState($continuous) | Out-Null; \
  {screen_saver_restore}\
}}"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::HashMap,
        fs,
        sync::Mutex as StdMutex,
    };
    use uuid::Uuid;

    const APP_DATA_ENV_VARS: [&str; 4] = ["HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA"];

    fn with_temp_app_data_env<T>(f: impl FnOnce() -> T) -> T {
        let _guard = crate::config::app_config::app_data_env_lock()
            .lock()
            .expect("env lock poisoned");
        let previous: Vec<(&str, Option<std::ffi::OsString>)> = APP_DATA_ENV_VARS
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();
        let root = std::env::temp_dir().join(format!("panes-power-home-{}", Uuid::new_v4()));
        let local_app_data = root.join("AppData").join("Local");
        let roaming_app_data = root.join("AppData").join("Roaming");
        fs::create_dir_all(&local_app_data).expect("temp local app data should exist");
        fs::create_dir_all(&roaming_app_data).expect("temp roaming app data should exist");
        std::env::set_var("HOME", &root);
        std::env::set_var("USERPROFILE", &root);
        std::env::set_var("LOCALAPPDATA", &local_app_data);
        std::env::set_var("APPDATA", &roaming_app_data);
        let result = f();
        for (key, value) in previous {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
        let _ = fs::remove_dir_all(&root);
        result
    }

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

        fn spawn(&self, _profile: &PowerProfile) -> anyhow::Result<SpawnedKeepAwakeChild> {
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
            helper: Some(KeepAwakeHelperState {
                pid,
                program: "/usr/bin/caffeinate".to_string(),
                args: vec!["-i".to_string(), "-w".to_string(), "1".to_string()],
                start_marker: Some(format!("start-{pid}")),
            }),
        }
    }

    fn test_process(pid: u32) -> ProcessIdentity {
        ProcessIdentity {
            pid,
            start_marker: Some(format!("owner-{pid}")),
        }
    }

    fn temp_state_dir() -> PathBuf {
        std::env::temp_dir().join(format!("panes-keep-awake-{}", Uuid::new_v4()))
    }

    #[tokio::test]
    async fn reports_unsupported_runtime() {
        let current_process = test_process(1);
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: false,
                    message: Some("unsupported".to_string()),
                },
                next_spawn: StdMutex::new(Vec::new()),
            }),
            Arc::new(FakeProcessOps::default()),
            temp_state_dir(),
            current_process,
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
        let current_process = test_process(2);
        let state_dir = temp_state_dir();
        let state_path = state_file_path(&state_dir, current_process.pid);
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(vec![Ok(make_spawn(child, 101))]),
            }),
            Arc::new(FakeProcessOps::default()),
            state_dir,
            current_process,
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
    async fn enable_fails_when_helper_exits_immediately() {
        let (child, state) = FakeChildHandle::new(23);
        state.lock().expect("fake child state lock poisoned").alive = false;
        let current_process = test_process(22);
        let state_dir = temp_state_dir();
        let state_path = state_file_path(&state_dir, current_process.pid);
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(vec![Ok(make_spawn(child, 222))]),
            }),
            Arc::new(FakeProcessOps::default()),
            state_dir,
            current_process,
        );

        let error = manager
            .enable()
            .await
            .expect_err("enable should fail when helper exits immediately");
        assert!(error.contains("status code 23"));

        let status = manager.status().await;
        assert!(!status.active);
        assert_eq!(
            status.message.as_deref(),
            Some("keep awake helper exited unexpectedly with status code 23")
        );
        assert!(!state_path.exists());
    }

    #[tokio::test]
    async fn status_reflects_unexpected_child_exit() {
        let (child, state) = FakeChildHandle::new(17);
        let current_process = test_process(3);
        let state_dir = temp_state_dir();
        let state_path = state_file_path(&state_dir, current_process.pid);
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(vec![Ok(make_spawn(child, 202))]),
            }),
            Arc::new(FakeProcessOps::default()),
            state_dir,
            current_process,
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
        let current_process = test_process(4);
        let state_dir = temp_state_dir();
        let state_path = state_file_path(&state_dir, current_process.pid);
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(vec![Ok(make_spawn(child, 303))]),
            }),
            Arc::new(FakeProcessOps::default()),
            state_dir,
            current_process,
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

    #[tokio::test]
    async fn ac_resume_failure_preserves_paused_state_and_reports_error() {
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(vec![Err(anyhow::anyhow!("resume failed"))]),
            }),
            Arc::new(FakeProcessOps::default()),
            temp_state_dir(),
            test_process(40),
        );

        {
            let mut runtime = manager.runtime.lock().await;
            runtime.active_profile = Some(PowerProfile {
                ac_only: true,
                ..PowerProfile::default_profile()
            });
            runtime.paused_due_to_battery = true;
            runtime.on_ac_power = Some(false);
        }

        let (event_tx, event_rx) = tokio::sync::mpsc::channel(2);
        event_tx
            .send(MonitorEvent::AcStatusChanged { on_ac: true })
            .await
            .expect("event should send");
        drop(event_tx);

        manager.process_monitor_events(event_rx).await;

        let status = manager.status().await;
        assert!(!status.active);
        assert_eq!(status.on_ac_power, Some(true));
        assert!(!status.paused_due_to_battery);
        assert_eq!(
            status.message.as_deref(),
            Some("failed to resume keep awake on AC power: resume failed")
        );
    }

    #[test]
    fn battery_threshold_disables_preference_instead_of_leaving_paused_state() {
        with_temp_app_data_env(|| {
            AppConfig::mutate(|config| {
                config.power.keep_awake_enabled = true;
                Ok(())
            })
            .expect("config should save");

            let runtime = tokio::runtime::Runtime::new().expect("runtime should build");
            runtime.block_on(async {
                let (child, _state) = FakeChildHandle::new(0);
                let spawned = make_spawn(child, 501);
                let manager = KeepAwakeManager::with_dependencies(
                    Arc::new(FakeSpawner {
                        support: SupportStatus {
                            supported: true,
                            message: None,
                        },
                        next_spawn: StdMutex::new(Vec::new()),
                    }),
                    Arc::new(FakeProcessOps::default()),
                    temp_state_dir(),
                    test_process(41),
                );

                {
                    let mut runtime = manager.runtime.lock().await;
                    runtime.child = Some(spawned.child);
                    runtime.helper = spawned.helper;
                    runtime.active_profile = Some(PowerProfile::default_profile());
                }

                let (event_tx, event_rx) = tokio::sync::mpsc::channel(2);
                event_tx
                    .send(MonitorEvent::BatteryLevel { percent: 19 })
                    .await
                    .expect("event should send");
                drop(event_tx);

                manager.process_monitor_events(event_rx).await;

                let status = manager.status().await;
                assert!(!status.active);
                assert!(!status.paused_due_to_battery);
                assert_eq!(status.battery_percent, Some(19));
                assert_eq!(status.message, None);

                let config = AppConfig::load_or_create().expect("config should load");
                assert!(!config.power.keep_awake_enabled);
            });
        });
    }

    #[test]
    fn reclaim_stale_helpers_skip_live_owner_processes() {
        let state_dir = temp_state_dir();
        let state_path = state_file_path(&state_dir, 10);
        save_helper_state(
            &state_path,
            &PersistedKeepAwakeHelper {
                owner: test_process(10),
                helper: KeepAwakeHelperState {
                    pid: 404,
                    program: "/usr/bin/caffeinate".to_string(),
                    args: vec!["-i".to_string(), "-w".to_string(), "1".to_string()],
                    start_marker: Some("start-404".to_string()),
                },
            },
        )
        .expect("helper state should save");

        let process_ops = Arc::new(FakeProcessOps::default());
        process_ops
            .commands
            .lock()
            .expect("fake commands lock poisoned")
            .insert(
                10,
                Some("/Applications/Panes.app/Contents/MacOS/Panes".to_string()),
            );
        process_ops
            .start_markers
            .lock()
            .expect("fake start markers lock poisoned")
            .insert(10, Some("owner-10".to_string()));
        process_ops
            .commands
            .lock()
            .expect("fake commands lock poisoned")
            .insert(404, Some("/usr/bin/caffeinate -i -w 1".to_string()));
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
            state_dir,
            test_process(99),
        );

        manager
            .reclaim_stale_helpers()
            .expect("live helper should not be reclaimed");

        assert!(process_ops
            .terminated
            .lock()
            .expect("fake terminated lock poisoned")
            .is_empty());
        assert!(state_path.exists());
    }

    #[test]
    fn reclaim_stale_helpers_terminates_matching_process() {
        let state_dir = temp_state_dir();
        let state_path = state_file_path(&state_dir, 11);
        save_helper_state(
            &state_path,
            &PersistedKeepAwakeHelper {
                owner: test_process(11),
                helper: KeepAwakeHelperState {
                    pid: 405,
                    program: "/usr/bin/caffeinate".to_string(),
                    args: vec!["-i".to_string(), "-w".to_string(), "1".to_string()],
                    start_marker: Some("start-405".to_string()),
                },
            },
        )
        .expect("helper state should save");

        let process_ops = Arc::new(FakeProcessOps::default());
        process_ops
            .commands
            .lock()
            .expect("fake commands lock poisoned")
            .insert(405, Some("/usr/bin/caffeinate -i -w 1".to_string()));
        process_ops
            .start_markers
            .lock()
            .expect("fake start markers lock poisoned")
            .insert(405, Some("start-405".to_string()));
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(Vec::new()),
            }),
            process_ops.clone(),
            state_dir,
            test_process(99),
        );

        manager
            .reclaim_stale_helpers()
            .expect("stale helper reclaim should succeed");

        assert_eq!(
            process_ops
                .terminated
                .lock()
                .expect("fake terminated lock poisoned")
                .as_slice(),
            &[405]
        );
        assert!(!state_path.exists());
    }

    #[test]
    fn reclaim_stale_helpers_terminate_when_saved_start_marker_is_missing() {
        let state_dir = temp_state_dir();
        let state_path = state_file_path(&state_dir, 12);
        save_helper_state(
            &state_path,
            &PersistedKeepAwakeHelper {
                owner: test_process(12),
                helper: KeepAwakeHelperState {
                    pid: 406,
                    program: "/usr/bin/caffeinate".to_string(),
                    args: vec!["-i".to_string(), "-w".to_string(), "1".to_string()],
                    start_marker: None,
                },
            },
        )
        .expect("helper state should save");

        let process_ops = Arc::new(FakeProcessOps::default());
        process_ops
            .commands
            .lock()
            .expect("fake commands lock poisoned")
            .insert(406, Some("/usr/bin/caffeinate -i -w 1".to_string()));
        process_ops
            .start_markers
            .lock()
            .expect("fake start markers lock poisoned")
            .insert(406, Some("start-406".to_string()));
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(Vec::new()),
            }),
            process_ops.clone(),
            state_dir,
            test_process(99),
        );

        manager
            .reclaim_stale_helpers()
            .expect("stale helper reclaim should succeed");

        assert_eq!(
            process_ops
                .terminated
                .lock()
                .expect("fake terminated lock poisoned")
                .as_slice(),
            &[406]
        );
        assert!(!state_path.exists());
    }

    #[test]
    fn reclaim_stale_helpers_skips_invalid_state_files() {
        let state_dir = temp_state_dir();
        let invalid_state_path = state_file_path(&state_dir, 12);
        fs::create_dir_all(&state_dir).expect("state dir should exist");
        fs::write(&invalid_state_path, b"{not-json").expect("invalid helper state should save");

        let valid_state_path = state_file_path(&state_dir, 13);
        save_helper_state(
            &valid_state_path,
            &PersistedKeepAwakeHelper {
                owner: test_process(13),
                helper: KeepAwakeHelperState {
                    pid: 407,
                    program: "/usr/bin/caffeinate".to_string(),
                    args: vec!["-i".to_string(), "-w".to_string(), "1".to_string()],
                    start_marker: Some("start-407".to_string()),
                },
            },
        )
        .expect("valid helper state should save");

        let process_ops = Arc::new(FakeProcessOps::default());
        process_ops
            .commands
            .lock()
            .expect("fake commands lock poisoned")
            .insert(407, Some("/usr/bin/caffeinate -i -w 1".to_string()));
        process_ops
            .start_markers
            .lock()
            .expect("fake start markers lock poisoned")
            .insert(407, Some("start-407".to_string()));
        let manager = KeepAwakeManager::with_dependencies(
            Arc::new(FakeSpawner {
                support: SupportStatus {
                    supported: true,
                    message: None,
                },
                next_spawn: StdMutex::new(Vec::new()),
            }),
            process_ops.clone(),
            state_dir,
            test_process(99),
        );

        manager
            .reclaim_stale_helpers()
            .expect("reclaim should continue past invalid state");

        assert_eq!(
            process_ops
                .terminated
                .lock()
                .expect("fake terminated lock poisoned")
                .as_slice(),
            &[407]
        );
        assert!(!invalid_state_path.exists());
        assert!(!valid_state_path.exists());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_backend_waits_on_the_owner_process() {
        let profile = PowerProfile::default_profile();
        let spec = resolve_backend_spec(&profile).expect("macOS backend should resolve");
        let args = spec
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert!(args.iter().any(|arg| arg == "-i"), "should include -i for idle sleep");
        assert!(
            args.iter().any(|arg| arg == "-s"),
            "should include -s for the AC-only system sleep assertion"
        );
        assert!(args.iter().any(|arg| arg == "-w"));
        assert!(args
            .iter()
            .any(|arg| arg == &std::process::id().to_string()));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_display_sleep_adds_d_flag() {
        let profile = PowerProfile {
            prevent_display_sleep: true,
            ..PowerProfile::default_profile()
        };
        let spec = resolve_backend_spec(&profile).expect("macOS backend should resolve");
        let args: Vec<String> = spec.args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.iter().any(|a| a == "-d"));
        assert!(args.iter().any(|a| a == "-i"));
        assert!(
            args.iter().any(|a| a == "-s"),
            "should include -s for the AC-only system sleep assertion"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_ac_only_uses_s_flag() {
        let profile = PowerProfile {
            ac_only: true,
            ..PowerProfile::default_profile()
        };
        let spec = resolve_backend_spec(&profile).expect("macOS backend should resolve");
        let args: Vec<String> = spec.args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.iter().any(|a| a == "-s"));
        assert!(!args.iter().any(|a| a == "-i"));
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn macos_closed_display_diagnostics_remain_unknown() {
        let diagnostics = closed_display_diagnostics(true, Some(101)).await;

        assert_eq!(diagnostics.supports_closed_display, None);
        assert_eq!(diagnostics.closed_display_active, None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_backend_blocks_sleep_and_idle_for_current_process() {
        let profile = PowerProfile::default_profile();
        let spec = resolve_backend_spec(&profile).expect("linux backend should resolve");
        let program = spec.program.to_string_lossy().into_owned();
        let args = spec
            .args
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        if program.contains("systemd-inhibit") {
            assert!(args.iter().any(|arg| arg == "--what=idle:sleep:handle-lid-switch"));
        } else {
            assert!(program.contains("gnome-session-inhibit"));
            assert!(args.windows(2).any(|pair| pair == ["--inhibit", "suspend"]));
            assert!(args.windows(2).any(|pair| pair == ["--inhibit", "idle"]));
        }
        assert!(args.iter().any(|arg| arg == "-f"));
        assert!(args.iter().any(|arg| arg == "/dev/null"));
        assert!(args
            .iter()
            .any(|arg| arg == format!("--pid={}", std::process::id())));
    }

    #[test]
    fn linux_gnome_backend_args_identify_app_and_repeat_inhibits() {
        let args = build_linux_gnome_inhibit_args(77, Path::new("/usr/bin/tail"))
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();

        assert_eq!(
            args,
            vec![
                "--app-id".to_string(),
                "Panes".to_string(),
                "--inhibit".to_string(),
                "suspend".to_string(),
                "--inhibit".to_string(),
                "idle".to_string(),
                "--reason".to_string(),
                "Keep system awake while Panes is open".to_string(),
                "/usr/bin/tail".to_string(),
                "--pid=77".to_string(),
                "-f".to_string(),
                "/dev/null".to_string(),
            ]
        );
    }

    #[test]
    fn windows_backend_script_tracks_owner_process_and_prevents_sleep() {
        let profile = PowerProfile::default_profile();
        let args = build_windows_keep_awake_args(77, &profile)
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        let script = args.last().expect("powershell script should be present");

        assert!(args.iter().any(|arg| arg == "-NoProfile"));
        assert!(args.iter().any(|arg| arg == "-NonInteractive"));
        assert!(args.iter().any(|arg| arg == "-WindowStyle"));
        assert!(args.iter().any(|arg| arg == "Hidden"));
        assert!(script.contains(WINDOWS_KEEP_AWAKE_MARKER));
        assert!(script.contains("$ownerPid = 77"));
        assert!(script.contains("SetThreadExecutionState"));
        assert!(script.contains("Start-Sleep -Seconds 30"));
        assert!(script.contains("$continuous -bor $systemRequired"));
    }

    #[test]
    fn windows_display_required_flag_in_script() {
        let profile = PowerProfile {
            prevent_display_sleep: true,
            ..PowerProfile::default_profile()
        };
        let args = build_windows_keep_awake_args(77, &profile);
        let script = args.last().unwrap().to_string_lossy().into_owned();
        assert!(script.contains("$displayRequired"));
        assert!(script.contains("$continuous -bor $systemRequired -bor $displayRequired"));
    }

    #[test]
    fn windows_screen_saver_disable_in_script() {
        let profile = PowerProfile {
            prevent_screen_saver: true,
            ..PowerProfile::default_profile()
        };
        let args = build_windows_keep_awake_args(77, &profile);
        let script = args.last().unwrap().to_string_lossy().into_owned();
        assert!(script.contains("PanesScreenSaver"));
        assert!(script.contains("SystemParametersInfo"));
    }

    #[test]
    fn profile_from_default_config() {
        let config = PowerConfig::default();
        let profile = PowerProfile::from_config(&config);
        assert!(profile.prevent_system_sleep);
        assert!(!profile.prevent_display_sleep);
        assert!(!profile.prevent_screen_saver);
        assert!(!profile.ac_only);
    }

    #[test]
    fn profile_from_full_config() {
        let config = PowerConfig {
            keep_awake_enabled: true,
            prevent_display_sleep: true,
            prevent_screen_saver: true,
            ac_only_mode: true,
            battery_threshold: Some(20),
            session_duration_secs: Some(3600),
        };
        let profile = PowerProfile::from_config(&config);
        assert!(profile.prevent_system_sleep);
        assert!(profile.prevent_display_sleep);
        assert!(profile.prevent_screen_saver);
        assert!(profile.ac_only);
    }

    #[test]
    fn powershell_helper_fingerprint_uses_marker_instead_of_full_script() {
        let program =
            PathBuf::from("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
        let profile = PowerProfile::default_profile();
        let args = build_windows_keep_awake_args(88, &profile);
        let fingerprint = helper_command_args_fingerprint(&program, &args);

        assert!(fingerprint.iter().any(|arg| arg == "-NoProfile"));
        assert!(fingerprint
            .iter()
            .any(|arg| arg == WINDOWS_KEEP_AWAKE_MARKER));
        assert!(!fingerprint
            .iter()
            .any(|arg| arg.contains("SetThreadExecutionState")));
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
