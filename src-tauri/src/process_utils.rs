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
