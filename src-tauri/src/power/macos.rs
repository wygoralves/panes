use std::{
    io,
    os::raw::c_void,
    process::ExitStatus,
    ptr,
    sync::{
        atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex as StdMutex,
    },
    thread,
};

use anyhow::{anyhow, Context};
use async_trait::async_trait;
use core_foundation::{
    base::{CFType, TCFType},
    boolean::CFBoolean,
    dictionary::CFDictionary,
    runloop::{kCFRunLoopDefaultMode, CFRunLoop, CFRunLoopSource},
    string::{CFString, CFStringRef},
};

use super::{
    exit_status_from_code, ClosedDisplayDiagnostics, KeepAwakeChild, PowerProfile,
    SpawnedKeepAwakeChild, SupportStatus,
};

const ASSERTION_NAME: &str = "Panes Keep Awake";
const DISPLAY_ASSERTION_NAME: &str = "Panes Keep Display Awake";
const K_IOPM_ASSERTION_LEVEL_ON: u32 = 255;
const K_IO_MESSAGE_CAN_SYSTEM_SLEEP: u32 = 0xE000_0270;
const K_IO_MESSAGE_SYSTEM_WILL_SLEEP: u32 = 0xE000_0280;
const K_IO_MESSAGE_SYSTEM_WILL_NOT_SLEEP: u32 = 0xE000_0290;
const K_IO_MESSAGE_SYSTEM_HAS_POWERED_ON: u32 = 0xE000_0300;
const K_IO_MESSAGE_SYSTEM_WILL_POWER_ON: u32 = 0xE000_0320;
const K_IO_PM_ASSERT_PREVENT_USER_IDLE_SYSTEM_SLEEP: &str = "PreventUserIdleSystemSleep";
const K_IO_PM_ASSERT_PREVENT_USER_IDLE_DISPLAY_SLEEP: &str = "PreventUserIdleDisplaySleep";
const K_IOPM_ROOT_DOMAIN_CLASS: &[u8] = b"IOPMrootDomain\0";
const K_APPLE_CLAMSHELL_STATE_KEY: &str = "AppleClamshellState";
const K_APPLE_CLAMSHELL_CAUSES_SLEEP_KEY: &str = "AppleClamshellCausesSleep";
const K_IOPM_SLEEP_DISABLED_KEY: &str = "SleepDisabled";

type IoObject = libc::mach_port_t;
type IoService = libc::mach_port_t;
type IoConnect = libc::mach_port_t;
type IoNotificationPortRef = *mut c_void;
type IoServiceInterestCallback =
    Option<unsafe extern "C" fn(*mut c_void, IoService, u32, *mut c_void)>;

#[link(name = "IOKit", kind = "framework")]
unsafe extern "C" {
    fn IOPMAssertionCreateWithName(
        assertion_type: CFStringRef,
        assertion_level: u32,
        assertion_name: CFStringRef,
        assertion_id: *mut u32,
    ) -> i32;
    fn IOPMAssertionRelease(assertion_id: u32) -> i32;
    fn IORegisterForSystemPower(
        refcon: *mut c_void,
        the_port_ref: *mut IoNotificationPortRef,
        callback: IoServiceInterestCallback,
        notifier: *mut IoObject,
    ) -> IoConnect;
    fn IODeregisterForSystemPower(notifier: *mut IoObject) -> i32;
    fn IOAllowPowerChange(kernel_port: IoConnect, notification_id: libc::intptr_t) -> i32;
    fn IONotificationPortGetRunLoopSource(
        notify: IoNotificationPortRef,
    ) -> core_foundation::runloop::CFRunLoopSourceRef;
    fn IONotificationPortDestroy(notify: IoNotificationPortRef);
    fn IOServiceClose(connect: IoConnect) -> i32;
    fn IOServiceGetMatchingService(
        master_port: libc::mach_port_t,
        matching: core_foundation::dictionary::CFMutableDictionaryRef,
    ) -> IoService;
    fn IORegistryEntryCreateCFProperties(
        entry: IoService,
        properties: *mut core_foundation::dictionary::CFMutableDictionaryRef,
        allocator: core_foundation::base::CFAllocatorRef,
        options: u32,
    ) -> i32;
    fn IOObjectRelease(object: IoObject) -> i32;
    fn IOServiceMatching(
        name: *const std::os::raw::c_char,
    ) -> core_foundation::dictionary::CFMutableDictionaryRef;
    fn IOPMCopySystemPowerSettings() -> core_foundation::dictionary::CFDictionaryRef;
}

#[derive(Debug)]
struct AssertionSpec {
    assertion_type: &'static str,
    name: &'static str,
}

#[derive(Debug)]
struct MacOsAssertion {
    id: u32,
    assertion_type: &'static str,
}

struct MacOsKeepAwakeChild {
    thread: StdMutex<Option<thread::JoinHandle<()>>>,
    state: Arc<NotificationThreadState>,
    system_sleep_assertion: StdMutex<Option<MacOsAssertion>>,
    display_sleep_assertion: StdMutex<Option<MacOsAssertion>>,
}

#[derive(Default)]
struct NotificationThreadState {
    finished: AtomicBool,
    status_code: AtomicI32,
    run_loop: StdMutex<Option<CFRunLoop>>,
}

#[derive(Default)]
struct NotificationContext {
    root_port: AtomicU32,
}

pub(super) fn support_status() -> SupportStatus {
    SupportStatus {
        supported: true,
        message: None,
    }
}

/// Physical lid state and kernel clamshell sleep policy, read from IORegistry.
#[derive(Debug, Clone, Default)]
pub(super) struct ClamshellState {
    /// True if the lid is physically closed right now. `None` on desktops or if
    /// the IORegistry key is missing.
    pub lid_is_closed: Option<bool>,
    /// True if lid closure will trigger sleep (the macOS default). False when
    /// clamshell sleep has been disabled (e.g. via `IOPMSetSystemPowerSetting`).
    /// `None` if the IORegistry key is missing.
    pub clamshell_causes_sleep: Option<bool>,
}

/// Read `AppleClamshellState` and `AppleClamshellCausesSleep` from the
/// `IOPMrootDomain` IORegistry entry.  No root privileges required.
pub(super) fn read_clamshell_state() -> ClamshellState {
    let matching = unsafe { IOServiceMatching(K_IOPM_ROOT_DOMAIN_CLASS.as_ptr().cast()) };
    if matching.is_null() {
        return ClamshellState::default();
    }

    // IOServiceGetMatchingService consumes the matching dictionary reference.
    let service = unsafe { IOServiceGetMatchingService(0, matching) };
    if service == 0 {
        return ClamshellState::default();
    }

    let mut props_ref: core_foundation::dictionary::CFMutableDictionaryRef = ptr::null_mut();
    let result =
        unsafe { IORegistryEntryCreateCFProperties(service, &mut props_ref, ptr::null_mut(), 0) };
    unsafe {
        IOObjectRelease(service);
    }

    if result != 0 || props_ref.is_null() {
        return ClamshellState::default();
    }

    let props = unsafe {
        CFDictionary::<CFString, CFType>::wrap_under_create_rule(
            props_ref as core_foundation::dictionary::CFDictionaryRef,
        )
    };

    let lid_is_closed = ioregistry_find_bool(&props, K_APPLE_CLAMSHELL_STATE_KEY);
    let clamshell_causes_sleep = ioregistry_find_bool(&props, K_APPLE_CLAMSHELL_CAUSES_SLEEP_KEY);

    ClamshellState {
        lid_is_closed,
        clamshell_causes_sleep,
    }
}

/// Read the `SleepDisabled` flag from `IOPMCopySystemPowerSettings`.
/// Returns `Some(true)` when all-sleep prevention is active (i.e. a privileged
/// helper has called `IOPMSetSystemPowerSetting("SleepDisabled", true)`).
/// No root privileges required to read.
pub(super) fn read_sleep_disabled() -> Option<bool> {
    let dict_ref = unsafe { IOPMCopySystemPowerSettings() };
    if dict_ref.is_null() {
        return None;
    }

    let dict = unsafe { CFDictionary::<CFString, CFType>::wrap_under_create_rule(dict_ref) };

    ioregistry_find_bool(&dict, K_IOPM_SLEEP_DISABLED_KEY)
}

fn ioregistry_find_bool(dict: &CFDictionary<CFString, CFType>, key: &str) -> Option<bool> {
    let cf_key = CFString::new(key);
    dict.find(&cf_key)
        .and_then(|value| value.downcast::<CFBoolean>())
        .map(bool::from)
}

pub(super) fn spawn(profile: &PowerProfile) -> anyhow::Result<SpawnedKeepAwakeChild> {
    let mut system_sleep_assertion = None;
    let mut display_sleep_assertion = None;

    for spec in assertion_specs(profile) {
        let assertion = match create_assertion(&spec) {
            Ok(assertion) => assertion,
            Err(error) => {
                release_assertion(&mut system_sleep_assertion);
                release_assertion(&mut display_sleep_assertion);
                return Err(error);
            }
        };
        match spec.assertion_type {
            K_IO_PM_ASSERT_PREVENT_USER_IDLE_SYSTEM_SLEEP => {
                system_sleep_assertion = Some(assertion);
            }
            K_IO_PM_ASSERT_PREVENT_USER_IDLE_DISPLAY_SLEEP => {
                display_sleep_assertion = Some(assertion);
            }
            _ => {}
        }
    }

    let state = Arc::new(NotificationThreadState::default());
    let thread = match spawn_notification_thread(state.clone()) {
        Ok(thread) => thread,
        Err(error) => {
            release_assertion(&mut system_sleep_assertion);
            release_assertion(&mut display_sleep_assertion);
            return Err(error);
        }
    };

    Ok(SpawnedKeepAwakeChild {
        child: Box::new(MacOsKeepAwakeChild {
            thread: StdMutex::new(Some(thread)),
            state,
            system_sleep_assertion: StdMutex::new(system_sleep_assertion),
            display_sleep_assertion: StdMutex::new(display_sleep_assertion),
        }),
        helper: None,
    })
}

pub(super) async fn closed_display_diagnostics(
    _keep_awake_active: bool,
) -> ClosedDisplayDiagnostics {
    let (clamshell, sleep_disabled) =
        tokio::task::spawn_blocking(|| (read_clamshell_state(), read_sleep_disabled()))
            .await
            .unwrap_or_else(|_| (ClamshellState::default(), None));

    // The system supports closed-display operation when SleepDisabled is active
    // (set by a privileged helper) OR when the kernel reports that clamshell
    // closure does not cause sleep (e.g. external display on AC).
    let clamshell_sleep_bypassed =
        sleep_disabled == Some(true) || clamshell.clamshell_causes_sleep == Some(false);

    ClosedDisplayDiagnostics {
        supports_closed_display: Some(clamshell_sleep_bypassed),
        closed_display_active: Some(
            clamshell_sleep_bypassed && clamshell.lid_is_closed == Some(true),
        ),
    }
}

#[async_trait]
impl KeepAwakeChild for MacOsKeepAwakeChild {
    fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        if self.state.finished.load(Ordering::Acquire) {
            Ok(Some(exit_status_from_code(
                self.state.status_code.load(Ordering::Relaxed),
            )))
        } else {
            Ok(None)
        }
    }

    async fn kill(&mut self) -> io::Result<()> {
        self.release_assertions();
        self.stop_notification_thread();
        Ok(())
    }

    async fn wait(&mut self) -> io::Result<ExitStatus> {
        self.release_assertions();
        self.stop_notification_thread();

        let handle = self
            .thread
            .lock()
            .expect("macOS keep awake thread lock poisoned")
            .take();

        if let Some(handle) = handle {
            tokio::task::spawn_blocking(move || handle.join())
                .await
                .map_err(|error| io::Error::other(error.to_string()))?
                .map_err(|_| io::Error::other("macOS keep awake thread panicked"))?;
        }

        Ok(exit_status_from_code(
            self.state.status_code.load(Ordering::Relaxed),
        ))
    }
}

impl MacOsKeepAwakeChild {
    fn release_assertions(&self) {
        let mut system_sleep_assertion = self
            .system_sleep_assertion
            .lock()
            .expect("macOS system assertion lock poisoned");
        release_assertion(&mut system_sleep_assertion);

        let mut display_sleep_assertion = self
            .display_sleep_assertion
            .lock()
            .expect("macOS display assertion lock poisoned");
        release_assertion(&mut display_sleep_assertion);
    }

    fn stop_notification_thread(&self) {
        let run_loop = self
            .state
            .run_loop
            .lock()
            .expect("macOS run loop lock poisoned")
            .clone();
        if let Some(run_loop) = run_loop {
            run_loop.stop();
        }
    }
}

fn assertion_specs(profile: &PowerProfile) -> Vec<AssertionSpec> {
    let mut specs = Vec::new();

    if profile.prevent_system_sleep {
        // Apple documents PreventSystemSleep as unsupported. Prevent idle system
        // sleep with the public user-idle assertion and let the AC-only monitor
        // pause the assertion when the machine switches to battery.
        specs.push(AssertionSpec {
            assertion_type: K_IO_PM_ASSERT_PREVENT_USER_IDLE_SYSTEM_SLEEP,
            name: ASSERTION_NAME,
        });
    }

    if profile.prevent_display_sleep || profile.prevent_screen_saver {
        specs.push(AssertionSpec {
            assertion_type: K_IO_PM_ASSERT_PREVENT_USER_IDLE_DISPLAY_SLEEP,
            name: DISPLAY_ASSERTION_NAME,
        });
    }

    specs
}

fn create_assertion(spec: &AssertionSpec) -> anyhow::Result<MacOsAssertion> {
    let assertion_type = CFString::from_static_string(spec.assertion_type);
    let assertion_name = CFString::from_static_string(spec.name);
    let mut assertion_id = 0;

    let result = unsafe {
        IOPMAssertionCreateWithName(
            assertion_type.as_concrete_TypeRef(),
            K_IOPM_ASSERTION_LEVEL_ON,
            assertion_name.as_concrete_TypeRef(),
            &mut assertion_id,
        )
    };

    if result != 0 {
        return Err(anyhow!(
            "failed to create macOS power assertion {} (IOReturn {})",
            spec.assertion_type,
            result
        ));
    }

    Ok(MacOsAssertion {
        id: assertion_id,
        assertion_type: spec.assertion_type,
    })
}

fn release_assertion(assertion: &mut Option<MacOsAssertion>) {
    let Some(assertion) = assertion.take() else {
        return;
    };

    let result = unsafe { IOPMAssertionRelease(assertion.id) };
    if result != 0 {
        log::warn!(
            "failed to release macOS power assertion {} (IOReturn {})",
            assertion.assertion_type,
            result
        );
    }
}

fn spawn_notification_thread(
    state: Arc<NotificationThreadState>,
) -> anyhow::Result<thread::JoinHandle<()>> {
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let thread_state = state.clone();

    let handle = thread::Builder::new()
        .name("panes-macos-power".to_string())
        .spawn(move || {
            if let Err(error) = notification_thread_main(thread_state.clone(), ready_tx) {
                state.status_code.store(1, Ordering::Release);
                state.finished.store(true, Ordering::Release);
                log::warn!("macOS power notification thread failed: {error}");
            }
        })
        .context("failed to spawn macOS power notification thread")?;

    match ready_rx.recv() {
        Ok(Ok(())) => Ok(handle),
        Ok(Err(error)) => {
            let _ = handle.join();
            Err(anyhow!(error))
        }
        Err(error) => {
            let _ = handle.join();
            Err(anyhow!(
                "failed to initialize macOS power notification thread: {error}"
            ))
        }
    }
}

fn notification_thread_main(
    state: Arc<NotificationThreadState>,
    ready_tx: SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let context = Box::new(NotificationContext::default());
    let context_ptr = Box::into_raw(context);
    let mut notification_port: IoNotificationPortRef = ptr::null_mut();
    let mut notifier: IoObject = 0;

    let root_port = unsafe {
        IORegisterForSystemPower(
            context_ptr.cast(),
            &mut notification_port,
            Some(power_notification_callback),
            &mut notifier,
        )
    };

    if root_port == 0 {
        unsafe {
            drop(Box::from_raw(context_ptr));
        }
        let _ = ready_tx.send(Err(
            "failed to register for macOS sleep/wake notifications".into()
        ));
        return Err("IORegisterForSystemPower returned IO_OBJECT_NULL".to_string());
    }

    unsafe {
        (*context_ptr).root_port.store(root_port, Ordering::Relaxed);
    }

    let source_ref = unsafe { IONotificationPortGetRunLoopSource(notification_port) };
    if source_ref.is_null() {
        cleanup_notification_registration(root_port, notification_port, &mut notifier, context_ptr);
        let _ = ready_tx.send(Err(
            "failed to attach macOS sleep/wake notifications to a run loop".into(),
        ));
        return Err("IONotificationPortGetRunLoopSource returned null".to_string());
    }

    let run_loop = CFRunLoop::get_current();
    let source = unsafe { CFRunLoopSource::wrap_under_get_rule(source_ref) };
    unsafe {
        run_loop.add_source(&source, kCFRunLoopDefaultMode);
    }

    *state.run_loop.lock().expect("macOS run loop lock poisoned") = Some(run_loop.clone());

    let _ = ready_tx.send(Ok(()));
    CFRunLoop::run_current();

    *state.run_loop.lock().expect("macOS run loop lock poisoned") = None;

    cleanup_notification_registration(root_port, notification_port, &mut notifier, context_ptr);
    state.status_code.store(0, Ordering::Release);
    state.finished.store(true, Ordering::Release);
    Ok(())
}

fn cleanup_notification_registration(
    root_port: IoConnect,
    notification_port: IoNotificationPortRef,
    notifier: &mut IoObject,
    context_ptr: *mut NotificationContext,
) {
    if *notifier != 0 {
        let result = unsafe { IODeregisterForSystemPower(notifier) };
        if result != 0 {
            log::warn!(
                "failed to deregister macOS power notifications (IOReturn {})",
                result
            );
        }
    }

    if !notification_port.is_null() {
        unsafe {
            IONotificationPortDestroy(notification_port);
        }
    }

    if root_port != 0 {
        let result = unsafe { IOServiceClose(root_port) };
        if result != 0 {
            log::warn!(
                "failed to close macOS power notification service (IOReturn {})",
                result
            );
        }
    }

    unsafe {
        drop(Box::from_raw(context_ptr));
    }
}

unsafe extern "C" fn power_notification_callback(
    refcon: *mut c_void,
    _service: IoService,
    message_type: u32,
    message_argument: *mut c_void,
) {
    let context = unsafe { &*(refcon.cast::<NotificationContext>()) };
    let root_port = context.root_port.load(Ordering::Relaxed);

    match message_type {
        K_IO_MESSAGE_CAN_SYSTEM_SLEEP | K_IO_MESSAGE_SYSTEM_WILL_SLEEP => {
            let notification_id = message_argument as libc::intptr_t;
            let result = unsafe { IOAllowPowerChange(root_port, notification_id) };
            if result != 0 {
                log::warn!(
                    "failed to acknowledge macOS power notification type {message_type:#x} (IOReturn {result})"
                );
            }
        }
        K_IO_MESSAGE_SYSTEM_WILL_NOT_SLEEP => {
            log::info!("macOS power management canceled an idle sleep request");
        }
        K_IO_MESSAGE_SYSTEM_WILL_POWER_ON => {
            log::info!("macOS system wake is starting");
        }
        K_IO_MESSAGE_SYSTEM_HAS_POWERED_ON => {
            log::info!("macOS system wake completed");
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_profile_uses_idle_system_sleep_assertion() {
        let assertion_types = assertion_specs(&PowerProfile::default_profile())
            .into_iter()
            .map(|spec| spec.assertion_type)
            .collect::<Vec<_>>();

        assert_eq!(
            assertion_types,
            vec![K_IO_PM_ASSERT_PREVENT_USER_IDLE_SYSTEM_SLEEP]
        );
    }

    #[test]
    fn display_sleep_settings_add_display_assertion() {
        let profile = PowerProfile {
            prevent_display_sleep: true,
            ..PowerProfile::default_profile()
        };
        let assertion_types = assertion_specs(&profile)
            .into_iter()
            .map(|spec| spec.assertion_type)
            .collect::<Vec<_>>();

        assert_eq!(
            assertion_types,
            vec![
                K_IO_PM_ASSERT_PREVENT_USER_IDLE_SYSTEM_SLEEP,
                K_IO_PM_ASSERT_PREVENT_USER_IDLE_DISPLAY_SLEEP,
            ]
        );
    }

    #[test]
    fn ac_only_profile_does_not_use_unsupported_prevent_system_sleep_assertion() {
        let profile = PowerProfile {
            ac_only: true,
            ..PowerProfile::default_profile()
        };
        let assertion_types = assertion_specs(&profile)
            .into_iter()
            .map(|spec| spec.assertion_type)
            .collect::<Vec<_>>();

        assert_eq!(
            assertion_types,
            vec![K_IO_PM_ASSERT_PREVENT_USER_IDLE_SYSTEM_SLEEP]
        );
        assert!(!assertion_types.contains(&"PreventSystemSleep"));
    }

    #[tokio::test]
    async fn closed_display_diagnostics_reads_real_ioregistry_values() {
        let diagnostics = closed_display_diagnostics(true).await;

        // On CI VMs without a lid, supports_closed_display will be
        // Some(true) only if SleepDisabled is active or clamshell causes
        // sleep is false.  On machines with a lid and no helper, it will
        // typically be Some(false).  Either way, the values must be Some.
        assert!(diagnostics.supports_closed_display.is_some());
        assert!(diagnostics.closed_display_active.is_some());
    }

    #[test]
    fn read_clamshell_state_does_not_panic() {
        let state = read_clamshell_state();
        // On desktops/VMs, both may be None.  On laptops, both should be Some.
        // We only assert the function does not crash.
        let _ = state.lid_is_closed;
        let _ = state.clamshell_causes_sleep;
    }

    #[test]
    fn read_sleep_disabled_does_not_panic() {
        let result = read_sleep_disabled();
        // Typically Some(false) unless a helper has set it.
        let _ = result;
    }
}
