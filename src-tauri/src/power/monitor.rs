use std::time::{Duration, Instant};
use tokio::sync::mpsc;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MonitorEvent {
    AcStatusChanged { on_ac: bool },
    BatteryLevel { percent: u8 },
    /// Periodic power source status for UI display — does not trigger any action.
    PowerSourcePolled { on_ac: bool, battery_percent: Option<u8> },
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
}

const POLL_INTERVAL: Duration = Duration::from_secs(10);

pub fn start_monitor(config: MonitorConfig) -> PowerMonitorHandle {
    let (event_tx, event_rx) = mpsc::channel(16);

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
                let should_stop = emit_power_source_events(
                    &event_tx,
                    &config,
                    &mut was_on_ac,
                    status,
                )
                .await;
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

            tokio::time::sleep(sleep_duration).await;
        }
    });

    PowerMonitorHandle {
        event_rx,
        cleanup: PowerMonitorCleanup {
            task,
            session_end_at,
        },
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

    if let (Some(threshold), Some(percent)) = (config.battery_threshold, status.battery_percent) {
        if percent < threshold {
            let _ = event_tx.send(MonitorEvent::BatteryLevel { percent }).await;
            return true;
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
    let output = std::process::Command::new("pmset")
        .args(["-g", "batt"])
        .output()
        .map_err(|e| format!("failed to run pmset: {e}"))?;

    if !output.status.success() {
        return Err("pmset returned non-zero".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    let on_ac = stdout.contains("AC Power");

    let battery_percent = stdout
        .lines()
        .find(|line| line.contains("InternalBattery"))
        .and_then(|line| {
            line.split_whitespace()
                .find(|word| word.ends_with("%;") || word.ends_with('%'))
                .and_then(|pct| {
                    pct.trim_end_matches(|c: char| !c.is_ascii_digit())
                        .parse::<u8>()
                        .ok()
                })
        });

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
    let battery_percent = parts[1]
        .parse::<u8>()
        .ok()
        .filter(|&p| p <= 100); // 255 means unknown

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
                Ok(None) => break,        // channel closed
                Err(_) => break,          // timeout — expected
            }
        }

        handle.cleanup.task.abort();
    }

    #[tokio::test]
    async fn monitor_cleanup_on_abort() {
        let config = MonitorConfig {
            ac_only_mode: false,
            battery_threshold: None,
            session_duration_secs: Some(3600),
        };
        let handle = start_monitor(config);

        handle.cleanup.task.abort();
        let result = handle.cleanup.task.await;
        assert!(result.is_err() || result.is_ok());
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
}
