#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
pub fn configure_std_command(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
pub fn configure_std_command(_command: &mut std::process::Command) {}

#[cfg(target_os = "windows")]
pub fn configure_tokio_command(command: &mut tokio::process::Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
pub fn configure_tokio_command(_command: &mut tokio::process::Command) {}

/// Serializes tests that mutate process-global environment variables (PATH,
/// HOME, ...) against tests that spawn subprocesses. env mutation is
/// process-wide, so a parallel test spawning `git` while another test points
/// PATH at an empty temp dir fails with ENOENT.
#[cfg(test)]
pub(crate) fn test_env_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}
