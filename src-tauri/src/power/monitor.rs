use std::time::{Duration, Instant};

#[cfg(target_os = "macos")]
use std::{
    os::raw::c_void,
    sync::{mpsc as std_mpsc, Arc, Mutex as StdMutex},
    thread,
};

#[cfg(target_os = "macos")]
use core_foundation::{
    array::CFArray,
    base::{CFType, TCFType},
    boolean::CFBoolean,
    dictionary::CFDictionary,
    number::CFNumber,
    runloop::{kCFRunLoopDefaultMode, CFRunLoop, CFRunLoopSource},
    string::{CFString, CFStringRef},
};

use tokio::sync::mpsc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MonitorEvent {
    AcStatusChanged {
        on_ac: bool,
    },
    BatteryLevel {
        percent: u8,
    },
    /// Periodic power source status for UI display — does not trigger any action.
    PowerSourcePolled {
        on_ac: bool,
        battery_percent: Option<u8>,
    },
    SessionExpired,
}

#[derive(Debug, Clone)]
pub struct MonitorConfig {
    pub ac_only_mode: bool,
    pub battery_threshold: Option<u8>,
    pub session_duration_secs: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct PowerSourceStatus {
    pub on_ac: bool,
    pub battery_percent: Option<u8>,
}

/// Returned by `start_monitor`. The caller should pass `event_rx` to the
/// event-processing task and store `cleanup` in the runtime for abort/timer.
pub struct PowerMonitorHandle {
    pub event_rx: mpsc::Receiver<MonitorEvent>,
    pub cleanup: PowerMonitorCleanup,
}

/// Stored in the runtime — holds only what `disable()` needs to abort the
/// monitor task and what `status()` needs for the session countdown.
pub struct PowerMonitorCleanup {
    pub task: tokio::task::JoinHandle<()>,
    pub session_end_at: Option<Instant>,
    #[cfg(target_os = "macos")]
    power_source_watcher: Option<MacOsPowerSourceWatcherCleanup>,
}

const POLL_INTERVAL: Duration = Duration::from_secs(10);

pub fn start_monitor(config: MonitorConfig) -> PowerMonitorHandle {
    let (event_tx, event_rx) = mpsc::channel(16);
    #[cfg(target_os = "macos")]
    let (mut power_source_rx, power_source_watcher) = match start_power_source_watcher() {
        Ok((rx, cleanup)) => (Some(rx), Some(cleanup)),
        Err(error) => {
            log::warn!("failed to start macOS power-source watcher: {error}");
            (None, None)
        }
    };

    let session_end_at = config
        .session_duration_secs
        .map(|secs| Instant::now() + Duration::from_secs(secs));

    let task = tokio::spawn(async move {
        let mut was_on_ac: Option<bool> = None;

        loop {
            // Check session timer first
            if let Some(end_at) = session_end_at {
                if Instant::now() >= end_at {
                    let _ = event_tx.send(MonitorEvent::SessionExpired).await;
                    break;
                }
            }

            // Always poll power source for UI display; act on AC/battery events
            // only when the corresponding feature is enabled.
            if let Ok(status) = poll_power_source().await {
                let should_stop =
                    emit_power_source_events(&event_tx, &config, &mut was_on_ac, status).await;
                if should_stop {
                    break;
                }
            }

            // Sleep until next poll or session end
            let sleep_duration = if let Some(end_at) = session_end_at {
                let remaining = end_at.saturating_duration_since(Instant::now());
                POLL_INTERVAL.min(remaining)
            } else {
                POLL_INTERVAL
            };

            #[cfg(target_os = "macos")]
            if let Some(power_source_events) = power_source_rx.as_mut() {
                tokio::select! {
                    _ = tokio::time::sleep(sleep_duration) => {}
                    changed = power_source_events.recv() => {
                        if changed.is_none() {
                            power_source_rx = None;
                            tokio::time::sleep(sleep_duration).await;
                        }
                    }
                }
                continue;
            }

            tokio::time::sleep(sleep_duration).await;
        }
    });

    PowerMonitorHandle {
        event_rx,
        cleanup: PowerMonitorCleanup {
            task,
            session_end_at,
            #[cfg(target_os = "macos")]
            power_source_watcher,
        },
    }
}

impl PowerMonitorCleanup {
    pub async fn shutdown(self) {
        self.task.abort();

        #[cfg(target_os = "macos")]
        if let Some(watcher) = self.power_source_watcher {
            watcher.shutdown().await;
        }
    }
}

async fn emit_power_source_events(
    event_tx: &mpsc::Sender<MonitorEvent>,
    config: &MonitorConfig,
    was_on_ac: &mut Option<bool>,
    status: PowerSourceStatus,
) -> bool {
    let _ = event_tx
        .send(MonitorEvent::PowerSourcePolled {
            on_ac: status.on_ac,
            battery_percent: status.battery_percent,
        })
        .await;

    if config.ac_only_mode {
        let currently_on_ac = status.on_ac;
        let should_emit_change = match *was_on_ac {
            Some(previous_on_ac) => previous_on_ac != currently_on_ac,
            None => !currently_on_ac,
        };
        if should_emit_change {
            let _ = event_tx
                .send(MonitorEvent::AcStatusChanged {
                    on_ac: currently_on_ac,
                })
                .await;
        }
        *was_on_ac = Some(currently_on_ac);
    }

    if !status.on_ac {
        if let (Some(threshold), Some(percent)) = (config.battery_threshold, status.battery_percent)
        {
            if percent < threshold {
                let _ = event_tx.send(MonitorEvent::BatteryLevel { percent }).await;
                return true;
            }
        }
    }

    false
}

async fn poll_power_source() -> Result<PowerSourceStatus, String> {
    tokio::task::spawn_blocking(poll_power_source_blocking)
        .await
        .map_err(|e| e.to_string())?
}

fn poll_power_source_blocking() -> Result<PowerSourceStatus, String> {
    #[cfg(target_os = "macos")]
    {
        return poll_power_source_macos();
    }

    #[cfg(target_os = "linux")]
    {
        return poll_power_source_linux();
    }

    #[cfg(target_os = "windows")]
    {
        return poll_power_source_windows();
    }

    #[allow(unreachable_code)]
    Err("power source monitoring not supported".to_string())
}

#[cfg(target_os = "macos")]
fn poll_power_source_macos() -> Result<PowerSourceStatus, String> {
    let snapshot_ref = unsafe { IOPSCopyPowerSourcesInfo() };
    if snapshot_ref.is_null() {
        return Err("IOPSCopyPowerSourcesInfo returned null".to_string());
    }
    let snapshot = unsafe { CFType::wrap_under_create_rule(snapshot_ref) };

    let providing_power_ref = unsafe { IOPSGetProvidingPowerSourceType(snapshot.as_CFTypeRef()) };
    if providing_power_ref.is_null() {
        return Err("IOPSGetProvidingPowerSourceType returned null".to_string());
    }
    let providing_power = unsafe { CFString::wrap_under_get_rule(providing_power_ref) };
    let on_ac = providing_power == CFString::from_static_string(K_IOPS_AC_POWER_VALUE);

    let list_ref = unsafe { IOPSCopyPowerSourcesList(snapshot.as_CFTypeRef()) };
    if list_ref.is_null() {
        return Ok(PowerSourceStatus {
            on_ac,
            battery_percent: None,
        });
    }
    let list = unsafe { CFArray::<CFType>::wrap_under_create_rule(list_ref) };

    let mut battery_percent = None;
    for power_source in &list {
        let description_ref = unsafe {
            IOPSGetPowerSourceDescription(snapshot.as_CFTypeRef(), power_source.as_CFTypeRef())
        };
        if description_ref.is_null() {
            continue;
        }
        let description =
            unsafe { CFDictionary::<CFString, CFType>::wrap_under_get_rule(description_ref) };

        if dictionary_find_bool(&description, K_IOPS_IS_PRESENT_KEY) == Some(false) {
            continue;
        }

        let power_state = dictionary_find_string(&description, K_IOPS_POWER_SOURCE_STATE_KEY);
        if power_state.as_deref() != Some(K_IOPS_BATTERY_POWER_VALUE) {
            continue;
        }

        let current_capacity = dictionary_find_i32(&description, K_IOPS_CURRENT_CAPACITY_KEY);
        let max_capacity = dictionary_find_i32(&description, K_IOPS_MAX_CAPACITY_KEY);
        if let (Some(current_capacity), Some(max_capacity)) = (current_capacity, max_capacity) {
            if max_capacity > 0 {
                let percent =
                    ((current_capacity as f64 / max_capacity as f64) * 100.0).round() as i32;
                battery_percent = Some(percent.clamp(0, 100) as u8);
                break;
            }
        }
    }

    Ok(PowerSourceStatus {
        on_ac,
        battery_percent,
    })
}

#[cfg(target_os = "linux")]
fn poll_power_source_linux() -> Result<PowerSourceStatus, String> {
    let power_supply_dir = std::path::Path::new("/sys/class/power_supply");

    if !power_supply_dir.exists() {
        return Err("no power supply sysfs".to_string());
    }

    let mut on_ac = false;
    let mut battery_percent: Option<u8> = None;

    for entry in std::fs::read_dir(power_supply_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        let supply_type = std::fs::read_to_string(path.join("type"))
            .unwrap_or_default()
            .trim()
            .to_string();

        match supply_type.as_str() {
            "Mains" => {
                let online = std::fs::read_to_string(path.join("online"))
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if online == "1" {
                    on_ac = true;
                }
            }
            "Battery" => {
                if let Ok(capacity) = std::fs::read_to_string(path.join("capacity")) {
                    if let Ok(pct) = capacity.trim().parse::<u8>() {
                        battery_percent = Some(pct);
                    }
                }
            }
            _ => {}
        }
    }

    Ok(PowerSourceStatus {
        on_ac,
        battery_percent,
    })
}

#[cfg(target_os = "windows")]
fn poll_power_source_windows() -> Result<PowerSourceStatus, String> {
    let script = r#"
        Add-Type -TypeDefinition @'
        using System.Runtime.InteropServices;
        public struct SYSTEM_POWER_STATUS {
            public byte ACLineStatus;
            public byte BatteryFlag;
            public byte BatteryLifePercent;
            public byte SystemStatusFlag;
            public uint BatteryLifeTime;
            public uint BatteryFullLifeTime;
        }
        public static class PanesPowerStatus {
            [DllImport("kernel32.dll", SetLastError=true)]
            public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS status);
        }
'@
        $status = New-Object SYSTEM_POWER_STATUS
        if ([PanesPowerStatus]::GetSystemPowerStatus([ref]$status)) {
            "$($status.ACLineStatus)|$($status.BatteryLifePercent)"
        } else {
            "error"
        }
    "#;

    let output = super::run_windows_powershell_script(script)
        .map_err(|e| format!("failed to get power status: {e}"))?;

    if !output.status.success() {
        return Err("power status query failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = stdout.split('|').collect();

    if parts.len() != 2 {
        return Err("unexpected power status format".to_string());
    }

    let on_ac = parts[0] == "1";
    let battery_percent = parts[1].parse::<u8>().ok().filter(|&p| p <= 100); // 255 means unknown

    Ok(PowerSourceStatus {
        on_ac,
        battery_percent,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn session_timer_fires() {
        let config = MonitorConfig {
            ac_only_mode: false,
            battery_threshold: None,
            session_duration_secs: Some(0), // expire immediately
        };
        let mut handle = start_monitor(config);

        let event = tokio::time::timeout(Duration::from_secs(5), handle.event_rx.recv())
            .await
            .expect("should receive event before timeout");

        assert_eq!(event, Some(MonitorEvent::SessionExpired));
        assert!(handle.cleanup.session_end_at.is_some());
    }

    #[tokio::test]
    async fn monitor_with_no_features_does_not_fire_action_events() {
        let config = MonitorConfig {
            ac_only_mode: false,
            battery_threshold: None,
            session_duration_secs: None,
        };
        let mut handle = start_monitor(config);

        // Drain events for a short window — only PowerSourcePolled is acceptable
        let deadline = tokio::time::Instant::now() + Duration::from_millis(200);
        loop {
            match tokio::time::timeout_at(deadline, handle.event_rx.recv()).await {
                Ok(Some(MonitorEvent::PowerSourcePolled { .. })) => continue,
                Ok(Some(other)) => panic!("unexpected action event: {other:?}"),
                Ok(None) => break, // channel closed
                Err(_) => break,   // timeout — expected
            }
        }

        handle.cleanup.shutdown().await;
    }

    #[tokio::test]
    async fn monitor_cleanup_on_abort() {
        let config = MonitorConfig {
            ac_only_mode: false,
            battery_threshold: None,
            session_duration_secs: Some(3600),
        };
        let handle = start_monitor(config);

        handle.cleanup.shutdown().await;
    }

    #[tokio::test]
    async fn ac_only_mode_pauses_immediately_when_started_on_battery() {
        let (event_tx, mut event_rx) = mpsc::channel(4);
        let mut was_on_ac = None;
        let config = MonitorConfig {
            ac_only_mode: true,
            battery_threshold: None,
            session_duration_secs: None,
        };

        let should_stop = emit_power_source_events(
            &event_tx,
            &config,
            &mut was_on_ac,
            PowerSourceStatus {
                on_ac: false,
                battery_percent: Some(42),
            },
        )
        .await;

        assert!(!should_stop);
        assert_eq!(
            event_rx.recv().await,
            Some(MonitorEvent::PowerSourcePolled {
                on_ac: false,
                battery_percent: Some(42),
            })
        );
        assert_eq!(
            event_rx.recv().await,
            Some(MonitorEvent::AcStatusChanged { on_ac: false })
        );
        assert_eq!(was_on_ac, Some(false));
    }

    #[tokio::test]
    async fn battery_threshold_ignores_low_battery_while_on_ac_power() {
        let (event_tx, mut event_rx) = mpsc::channel(4);
        let mut was_on_ac = None;
        let config = MonitorConfig {
            ac_only_mode: false,
            battery_threshold: Some(20),
            session_duration_secs: None,
        };

        let should_stop = emit_power_source_events(
            &event_tx,
            &config,
            &mut was_on_ac,
            PowerSourceStatus {
                on_ac: true,
                battery_percent: Some(10),
            },
        )
        .await;

        assert!(!should_stop);
        assert_eq!(
            event_rx.recv().await,
            Some(MonitorEvent::PowerSourcePolled {
                on_ac: true,
                battery_percent: Some(10),
            })
        );
        assert!(
            tokio::time::timeout(Duration::from_millis(50), event_rx.recv())
                .await
                .is_err()
        );
        assert_eq!(was_on_ac, None);
    }
}

#[cfg(target_os = "macos")]
const K_IOPS_AC_POWER_VALUE: &str = "AC Power";
#[cfg(target_os = "macos")]
const K_IOPS_BATTERY_POWER_VALUE: &str = "Battery Power";
#[cfg(target_os = "macos")]
const K_IOPS_POWER_SOURCE_STATE_KEY: &str = "Power Source State";
#[cfg(target_os = "macos")]
const K_IOPS_CURRENT_CAPACITY_KEY: &str = "Current Capacity";
#[cfg(target_os = "macos")]
const K_IOPS_MAX_CAPACITY_KEY: &str = "Max Capacity";
#[cfg(target_os = "macos")]
const K_IOPS_IS_PRESENT_KEY: &str = "Is Present";

#[cfg(target_os = "macos")]
type IOPowerSourceCallbackType = Option<unsafe extern "C" fn(*mut c_void)>;

#[cfg(target_os = "macos")]
#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOPSCopyPowerSourcesInfo() -> core_foundation::base::CFTypeRef;
    fn IOPSCopyPowerSourcesList(
        blob: core_foundation::base::CFTypeRef,
    ) -> core_foundation::array::CFArrayRef;
    fn IOPSGetPowerSourceDescription(
        blob: core_foundation::base::CFTypeRef,
        ps: core_foundation::base::CFTypeRef,
    ) -> core_foundation::dictionary::CFDictionaryRef;
    fn IOPSGetProvidingPowerSourceType(snapshot: core_foundation::base::CFTypeRef) -> CFStringRef;
    fn IOPSNotificationCreateRunLoopSource(
        callback: IOPowerSourceCallbackType,
        context: *mut c_void,
    ) -> core_foundation::runloop::CFRunLoopSourceRef;
}

#[cfg(target_os = "macos")]
struct MacOsPowerSourceWatcherCleanup {
    thread: Option<thread::JoinHandle<()>>,
    run_loop: Arc<StdMutex<Option<CFRunLoop>>>,
}

#[cfg(target_os = "macos")]
impl MacOsPowerSourceWatcherCleanup {
    async fn shutdown(mut self) {
        if let Some(run_loop) = self
            .run_loop
            .lock()
            .expect("macOS power-source run loop lock poisoned")
            .clone()
        {
            run_loop.stop();
        }

        if let Some(thread) = self.thread.take() {
            let _ = tokio::task::spawn_blocking(move || thread.join()).await;
        }
    }
}

#[cfg(target_os = "macos")]
struct MacOsPowerSourceWatcherContext {
    event_tx: mpsc::UnboundedSender<()>,
}

#[cfg(target_os = "macos")]
fn start_power_source_watcher(
) -> Result<(mpsc::UnboundedReceiver<()>, MacOsPowerSourceWatcherCleanup), String> {
    let (event_tx, event_rx) = mpsc::unbounded_channel();
    let (ready_tx, ready_rx) = std_mpsc::sync_channel(1);
    let run_loop = Arc::new(StdMutex::new(None));
    let thread_run_loop = run_loop.clone();

    let thread = thread::Builder::new()
        .name("panes-macos-power-source".to_string())
        .spawn(move || {
            if let Err(error) = macos_power_source_watcher_main(thread_run_loop, event_tx, ready_tx)
            {
                log::warn!("macOS power-source watcher failed: {error}");
            }
        })
        .map_err(|error| format!("failed to spawn macOS power-source watcher: {error}"))?;

    match ready_rx.recv() {
        Ok(Ok(())) => Ok((
            event_rx,
            MacOsPowerSourceWatcherCleanup {
                thread: Some(thread),
                run_loop,
            },
        )),
        Ok(Err(error)) => {
            let _ = thread.join();
            Err(error)
        }
        Err(error) => {
            let _ = thread.join();
            Err(format!(
                "failed to initialize macOS power-source watcher: {error}"
            ))
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_power_source_watcher_main(
    run_loop_slot: Arc<StdMutex<Option<CFRunLoop>>>,
    event_tx: mpsc::UnboundedSender<()>,
    ready_tx: std_mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let context = Box::new(MacOsPowerSourceWatcherContext { event_tx });
    let context_ptr = Box::into_raw(context);

    let source_ref = unsafe {
        IOPSNotificationCreateRunLoopSource(Some(power_source_changed_callback), context_ptr.cast())
    };
    if source_ref.is_null() {
        unsafe {
            drop(Box::from_raw(context_ptr));
        }
        let _ = ready_tx.send(Err(
            "IOPSNotificationCreateRunLoopSource returned null".to_string()
        ));
        return Err("IOPSNotificationCreateRunLoopSource returned null".to_string());
    }

    let run_loop = CFRunLoop::get_current();
    let source = unsafe { CFRunLoopSource::wrap_under_create_rule(source_ref) };
    unsafe {
        run_loop.add_source(&source, kCFRunLoopDefaultMode);
    }

    *run_loop_slot
        .lock()
        .expect("macOS power-source run loop lock poisoned") = Some(run_loop.clone());
    let _ = ready_tx.send(Ok(()));
    CFRunLoop::run_current();
    *run_loop_slot
        .lock()
        .expect("macOS power-source run loop lock poisoned") = None;

    unsafe {
        drop(Box::from_raw(context_ptr));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn power_source_changed_callback(context: *mut c_void) {
    let context = unsafe { &*(context.cast::<MacOsPowerSourceWatcherContext>()) };
    let _ = context.event_tx.send(());
}

#[cfg(target_os = "macos")]
fn dictionary_find_string(
    dictionary: &CFDictionary<CFString, CFType>,
    key: &'static str,
) -> Option<String> {
    let key = CFString::from_static_string(key);
    dictionary
        .find(&key)
        .and_then(|value| value.downcast::<CFString>())
        .map(|value| value.to_string())
}

#[cfg(target_os = "macos")]
fn dictionary_find_i32(
    dictionary: &CFDictionary<CFString, CFType>,
    key: &'static str,
) -> Option<i32> {
    let key = CFString::from_static_string(key);
    dictionary
        .find(&key)
        .and_then(|value| value.downcast::<CFNumber>())
        .and_then(|value| value.to_i32())
}

#[cfg(target_os = "macos")]
fn dictionary_find_bool(
    dictionary: &CFDictionary<CFString, CFType>,
    key: &'static str,
) -> Option<bool> {
    let key = CFString::from_static_string(key);
    dictionary
        .find(&key)
        .and_then(|value| value.downcast::<CFBoolean>())
        .map(bool::from)
}
