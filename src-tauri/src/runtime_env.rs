use std::{
    collections::HashMap,
    env,
    ffi::{OsStr, OsString},
    fs,
    path::{Path, PathBuf},
};

use tokio::{
    process::Command,
    sync::OnceCell,
    time::{timeout, Duration},
};

const LOGIN_ENV_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const LOGIN_ENV_PROBE_MARKER: &str = "__PANES_LOGIN_ENV_START__";

static LOGIN_SHELL_ENV: OnceCell<HashMap<OsString, OsString>> = OnceCell::const_new();

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ShellFlavor {
    Bash,
    Fish,
    Zsh,
    Sh,
    Cmd,
    PowerShell,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellLaunchSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
}

pub fn platform_id() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// File Flatpak bind-mounts at the root of every sandbox.
const FLATPAK_INFO_PATH: &str = "/.flatpak-info";

/// Whether the app is currently running inside a Flatpak sandbox.
///
/// `FLATPAK_ID` alone is not enough: it leaks into the environment of any
/// program started from a Flatpak app's terminal, and this answer decides
/// where the database lives. A real sandbox is Linux, has a non-empty
/// `FLATPAK_ID` and has `/.flatpak-info` mounted at its root.
pub fn is_flatpak() -> bool {
    is_flatpak_for(
        cfg!(target_os = "linux"),
        env::var_os("FLATPAK_ID").as_deref(),
        || Path::new(FLATPAK_INFO_PATH).is_file(),
    )
}

fn is_flatpak_for(
    is_linux: bool,
    flatpak_id: Option<&OsStr>,
    flatpak_info_exists: impl FnOnce() -> bool,
) -> bool {
    is_linux && non_empty_os_str(flatpak_id).is_some() && flatpak_info_exists()
}

/// Whether the built-in Tauri updater may run. A Flatpak is updated through
/// its remote, and its /app is read-only, so self-updates cannot apply there.
pub fn self_update_supported() -> bool {
    self_update_supported_for(is_flatpak())
}

fn self_update_supported_for(in_flatpak: bool) -> bool {
    !in_flatpak
}

pub fn app_data_dir() -> PathBuf {
    app_data_dir_with(is_flatpak())
}

fn app_data_dir_with(in_flatpak: bool) -> PathBuf {
    if in_flatpak {
        return flatpak_app_data_dir_for(
            env::var_os("XDG_DATA_HOME").as_deref(),
            env::var_os("FLATPAK_ID").as_deref(),
            home_dir().as_deref(),
        );
    }
    app_data_dir_for(
        cfg!(target_os = "windows"),
        local_app_data_dir().as_deref(),
        roaming_app_data_dir().as_deref(),
        home_dir().as_deref(),
    )
}

pub fn legacy_app_data_dir() -> Option<PathBuf> {
    home_dir().map(|home| legacy_app_data_dir_for(&home))
}

pub fn migrate_legacy_app_data_dir() -> std::io::Result<()> {
    migrate_legacy_app_data_dir_with(is_flatpak())
}

fn migrate_legacy_app_data_dir_with(in_flatpak: bool) -> std::io::Result<()> {
    let current = app_data_dir_with(in_flatpak);
    if in_flatpak {
        // Inside a Flatpak, ~/.agent-workspace is a tmpfs path unless the
        // user made it persistent (a home or ~/.agent-workspace filesystem
        // override, or --persist). Then it holds an older Flatpak's data, or
        // the host install's live data. Either way it is copied once into the
        // sandbox's data dir and never moved or deleted.
        return import_legacy_app_data_into_flatpak(&current, legacy_app_data_dir().as_deref());
    }
    migrate_legacy_app_data_dir_for(&current, legacy_app_data_dir().as_deref())
}

pub fn augmented_path() -> Option<OsString> {
    join_paths(augmented_path_entries())
}

pub fn augmented_path_with_prepend<I>(prepend: I) -> Option<OsString>
where
    I: IntoIterator<Item = PathBuf>,
{
    let mut entries = Vec::new();
    for path in prepend {
        if !path.as_os_str().is_empty() {
            entries.push(path);
        }
    }
    entries.extend(augmented_path_entries());
    join_paths(entries)
}

pub fn augmented_path_entries() -> Vec<PathBuf> {
    let home = home_dir();
    let local_app_data = local_app_data_dir();
    let roaming_app_data = roaming_app_data_dir();
    augmented_path_entries_for(
        home.as_deref(),
        env::var_os("PATH").as_deref(),
        local_app_data.as_deref(),
        roaming_app_data.as_deref(),
    )
}

pub fn resolve_executable(binary: &str) -> Option<PathBuf> {
    let augmented_path = augmented_path()?;
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    which::which_in(binary, Some(augmented_path), cwd).ok()
}

pub async fn apply_missing_login_shell_env(command: &mut Command) {
    let shell_env = login_shell_environment().await;
    for (key, value) in shell_env {
        if !should_import_login_shell_env_var(key) || env::var_os(key).is_some() {
            continue;
        }
        command.env(key, value);
    }
}

async fn login_shell_environment() -> &'static HashMap<OsString, OsString> {
    LOGIN_SHELL_ENV
        .get_or_init(load_login_shell_environment)
        .await
}

async fn load_login_shell_environment() -> HashMap<OsString, OsString> {
    #[cfg(target_os = "windows")]
    {
        HashMap::new()
    }

    #[cfg(not(target_os = "windows"))]
    {
        for shell in login_probe_shells() {
            let output = match timeout(
                LOGIN_ENV_PROBE_TIMEOUT,
                Command::new(&shell)
                    .args(login_env_probe_shell_args(&shell))
                    .output(),
            )
            .await
            {
                Ok(Ok(output)) if output.status.success() => output,
                Ok(Ok(output)) => {
                    log::warn!(
                        "login shell env probe via `{}` exited with status {}",
                        shell.display(),
                        output.status
                    );
                    continue;
                }
                Ok(Err(error)) => {
                    log::warn!(
                        "failed to probe login shell env via `{}`: {error}",
                        shell.display()
                    );
                    continue;
                }
                Err(_) => {
                    log::warn!(
                        "timed out probing login shell env via `{}`",
                        shell.display()
                    );
                    continue;
                }
            };

            let parsed = parse_login_shell_env_output(&output.stdout);
            if !parsed.is_empty() {
                return parsed;
            }
        }

        HashMap::new()
    }
}

#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
pub fn windows_login_probe_shells() -> Vec<PathBuf> {
    ["pwsh", "pwsh.exe", "powershell", "powershell.exe"]
        .into_iter()
        .filter_map(resolve_executable)
        .fold(Vec::new(), |mut shells, shell| {
            if !shells.contains(&shell) {
                shells.push(shell);
            }
            shells
        })
}

pub fn is_executable_file(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::metadata(path)
            .map(|metadata| metadata.is_file() && (metadata.permissions().mode() & 0o111 != 0))
            .unwrap_or(false)
    }

    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
pub fn terminal_shell() -> PathBuf {
    #[cfg(target_os = "windows")]
    let shell_env = env::var("COMSPEC").ok();
    #[cfg(not(target_os = "windows"))]
    let shell_env = env::var("SHELL").ok();

    terminal_shell_for(
        shell_env.as_deref(),
        home_dir().as_deref(),
        env::var_os("PATH").as_deref(),
    )
}

pub fn terminal_shell_args(shell: &Path) -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let _ = shell;
        return Vec::new();
    }

    #[cfg(not(target_os = "windows"))]
    match shell_flavor(shell) {
        ShellFlavor::Bash
        | ShellFlavor::Fish
        | ShellFlavor::Zsh
        | ShellFlavor::Sh
        | ShellFlavor::Cmd
        | ShellFlavor::PowerShell
        | ShellFlavor::Other => {
            vec!["-l".to_string(), "-i".to_string()]
        }
    }
}

pub fn command_shell_for_string(command: &str) -> ShellLaunchSpec {
    let program = command_shell_program();
    let args = command_shell_args_for(&program, command);

    ShellLaunchSpec { program, args }
}

#[cfg(not(target_os = "windows"))]
#[cfg_attr(target_os = "windows", allow(dead_code))]
pub fn login_probe_shells() -> Vec<PathBuf> {
    login_probe_shells_for(
        env::var("SHELL").ok().as_deref(),
        env::var_os("PATH").as_deref(),
    )
}

#[cfg(target_os = "windows")]
#[cfg_attr(target_os = "windows", allow(dead_code))]
pub fn login_probe_shells() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(not(target_os = "windows"))]
pub fn login_probe_shell_args(shell: &Path, command: &str) -> Vec<String> {
    match shell_flavor(shell) {
        ShellFlavor::Bash | ShellFlavor::Fish | ShellFlavor::Zsh => vec![
            "-l".to_string(),
            "-i".to_string(),
            "-c".to_string(),
            command.to_string(),
        ],
        ShellFlavor::Sh | ShellFlavor::Cmd | ShellFlavor::PowerShell | ShellFlavor::Other => {
            vec!["-l".to_string(), "-c".to_string(), command.to_string()]
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn login_env_probe_shell_args(shell: &Path) -> Vec<String> {
    let command = format!("printf '%s\\0' {LOGIN_ENV_PROBE_MARKER}; env -0");
    match shell_flavor(shell) {
        ShellFlavor::Bash | ShellFlavor::Fish | ShellFlavor::Zsh => vec![
            "-l".to_string(),
            "-i".to_string(),
            "-c".to_string(),
            command,
        ],
        ShellFlavor::Sh | ShellFlavor::Cmd | ShellFlavor::PowerShell | ShellFlavor::Other => {
            vec!["-l".to_string(), "-c".to_string(), command]
        }
    }
}

fn parse_login_shell_env_output(stdout: &[u8]) -> HashMap<OsString, OsString> {
    let mut parsed = HashMap::new();
    let mut after_marker = false;
    let marker = LOGIN_ENV_PROBE_MARKER.as_bytes();

    for entry in stdout.split(|byte| *byte == b'\0') {
        if !after_marker {
            if entry == marker || entry.ends_with(marker) {
                after_marker = true;
            }
            continue;
        }

        if entry.is_empty() {
            continue;
        }
        let Some(separator) = entry.iter().position(|byte| *byte == b'=') else {
            continue;
        };
        if separator == 0 {
            continue;
        }

        let key = os_string_from_bytes(&entry[..separator]);
        let value = os_string_from_bytes(&entry[separator + 1..]);
        parsed.insert(key, value);
    }

    parsed
}

fn os_string_from_bytes(bytes: &[u8]) -> OsString {
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStringExt;
        OsString::from_vec(bytes.to_vec())
    }

    #[cfg(not(unix))]
    {
        OsString::from(String::from_utf8_lossy(bytes).to_string())
    }
}

fn should_import_login_shell_env_var(key: &OsStr) -> bool {
    let Some(key) = key.to_str() else {
        return false;
    };

    !matches!(
        key,
        "PATH"
            | "PWD"
            | "OLDPWD"
            | "SHLVL"
            | "_"
            | "TERM"
            | "TERM_PROGRAM"
            | "TERM_PROGRAM_VERSION"
            | "XPC_SERVICE_NAME"
            | "XPC_FLAGS"
            | "__CFBundleIdentifier"
            | "__CF_USER_TEXT_ENCODING"
    )
}

#[cfg(not(target_os = "windows"))]
pub fn parse_login_probe_output(stdout: &str) -> Option<(String, String)> {
    let mut lines = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let path = lines.find(|line| line.starts_with('/'))?.to_string();
    let version = lines.next().unwrap_or("").to_string();
    Some((path, version))
}

#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
pub fn parse_windows_login_probe_output(stdout: &str) -> Option<(String, String)> {
    let mut lines = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());

    while let Some(line) = lines.next() {
        if looks_like_windows_absolute_path(line) {
            return Some((line.to_string(), lines.next().unwrap_or("").to_string()));
        }
    }

    None
}

#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
pub fn parse_windows_single_path_output(stdout: &str) -> Option<String> {
    stdout
        .lines()
        .map(str::trim)
        .find(|line| looks_like_windows_absolute_path(line))
        .map(str::to_string)
}

#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
fn looks_like_windows_absolute_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    value.starts_with(r"\\")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/'))
}

fn augmented_path_entries_for(
    home: Option<&Path>,
    current_path: Option<&OsStr>,
    #[allow(unused_variables)] local_app_data: Option<&Path>,
    #[allow(unused_variables)] roaming_app_data: Option<&Path>,
) -> Vec<PathBuf> {
    let mut entries: Vec<PathBuf> = current_path
        .map(env::split_paths)
        .map(|paths| paths.collect())
        .unwrap_or_default();

    #[cfg(target_os = "macos")]
    {
        entries.push(PathBuf::from("/opt/homebrew/bin"));
        entries.push(PathBuf::from("/opt/homebrew/sbin"));
        entries.push(PathBuf::from("/usr/local/bin"));
        entries.push(PathBuf::from("/usr/local/sbin"));
        entries.push(PathBuf::from("/opt/local/bin"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        entries.push(PathBuf::from("/usr/local/bin"));
        entries.push(PathBuf::from("/usr/local/sbin"));
        entries.push(PathBuf::from("/usr/bin"));
        entries.push(PathBuf::from("/bin"));
        entries.push(PathBuf::from("/usr/sbin"));
        entries.push(PathBuf::from("/sbin"));
    }

    #[cfg(target_os = "linux")]
    {
        entries.push(PathBuf::from("/snap/bin"));
        entries.push(PathBuf::from("/home/linuxbrew/.linuxbrew/bin"));
        entries.push(PathBuf::from("/home/linuxbrew/.linuxbrew/sbin"));
        entries.push(PathBuf::from("/linuxbrew/.linuxbrew/bin"));
        entries.push(PathBuf::from("/linuxbrew/.linuxbrew/sbin"));
        entries.push(PathBuf::from("/nix/var/nix/profiles/default/bin"));
        entries.push(PathBuf::from("/run/current-system/sw/bin"));
        // /etc/environment is sourced by PAM/systemd on most distros.
        // When Panes is launched from a .desktop file (e.g. .deb install),
        // the process PATH is minimal — this fills the gap.
        entries.extend(parse_path_from_env_file(
            Path::new("/etc/environment"),
            home,
        ));
    }

    if let Some(home) = home {
        #[cfg(not(target_os = "windows"))]
        {
            entries.push(home.join(".local/bin"));
            entries.push(home.join(".local/share/npm/bin"));
            entries.push(home.join(".npm-global/bin"));
            entries.push(home.join(".volta/bin"));
            entries.push(home.join(".local/share/fnm/aliases/default/bin"));
            entries.push(home.join(".local/share/pnpm"));
            entries.push(home.join(".asdf/shims"));
            entries.push(home.join(".cargo/bin"));
            entries.push(home.join(".deno/bin"));
            entries.push(home.join(".bun/bin"));
            entries.push(home.join(".local/share/mise/shims"));
            entries.push(home.join(".proto/shims"));
            entries.push(home.join(".proto/bin"));
            entries.push(home.join(".fnm/aliases/default/bin"));
            if let Some(npm_bin) = npm_global_bin_from_npmrc(home) {
                entries.push(npm_bin);
            }
            entries.push(home.join("bin"));
            entries.extend(nvm_bin_dirs(home));
        }

        #[cfg(target_os = "windows")]
        {
            entries.push(home.join("scoop/shims"));
            entries.push(home.join(".cargo/bin"));
            entries.push(home.join(".deno/bin"));
            entries.push(home.join(".bun/bin"));
        }

        #[cfg(target_os = "linux")]
        {
            entries.push(home.join(".nix-profile/bin"));
            entries.extend(linux_user_environment_path_entries(home));
        }

        #[cfg(target_os = "macos")]
        {
            entries.push(home.join("Library/pnpm"));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = local_app_data {
            entries.push(local_app_data.join("Microsoft/WindowsApps"));
            entries.push(local_app_data.join("Programs/Microsoft VS Code/bin"));
            entries.push(local_app_data.join("Programs/nodejs"));
            entries.push(local_app_data.join("Volta/bin"));
            entries.push(local_app_data.join("pnpm"));
            entries.push(local_app_data.join("fnm"));
            entries.push(local_app_data.join("fnm/aliases/default"));
            entries.push(local_app_data.join("nvm"));
        }
        if let Some(roaming_app_data) = roaming_app_data {
            entries.push(roaming_app_data.join("npm"));
            entries.push(roaming_app_data.join("pnpm"));
            entries.push(roaming_app_data.join("nvm"));
        }
        // nvm-windows default symlink directory
        if let Some(program_files) = env::var_os("ProgramFiles") {
            entries.push(PathBuf::from(&program_files).join("nodejs"));
        }
    }

    dedupe_paths(entries)
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn terminal_shell_for(
    shell_env: Option<&str>,
    home: Option<&Path>,
    current_path: Option<&OsStr>,
) -> PathBuf {
    if let Some(shell) = shell_env
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| is_executable_file(path))
    {
        return shell;
    }

    let local_app_data = local_app_data_dir();
    let roaming_app_data = roaming_app_data_dir();
    let augmented_entries = augmented_path_entries_for(
        home,
        current_path,
        local_app_data.as_deref(),
        roaming_app_data.as_deref(),
    );
    #[cfg(target_os = "windows")]
    let fallback_shells = ["pwsh", "powershell", "cmd"];
    #[cfg(target_os = "macos")]
    let fallback_shells = ["zsh", "bash", "sh"];
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let fallback_shells = ["bash", "sh", "zsh"];

    for shell in fallback_shells {
        if let Some(path) = resolve_from_entries(shell, &augmented_entries) {
            return path;
        }
    }

    #[cfg(target_os = "windows")]
    {
        PathBuf::from("cmd.exe")
    }
    #[cfg(target_os = "macos")]
    {
        return PathBuf::from("/bin/zsh");
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        PathBuf::from("/bin/sh")
    }
}

fn command_shell_program() -> PathBuf {
    #[cfg(target_os = "windows")]
    let shell_env = env::var("COMSPEC").ok();
    #[cfg(not(target_os = "windows"))]
    let shell_env = env::var("SHELL").ok();

    command_shell_program_for(
        shell_env.as_deref(),
        home_dir().as_deref(),
        env::var_os("PATH").as_deref(),
    )
}

fn command_shell_program_for(
    shell_env: Option<&str>,
    home: Option<&Path>,
    current_path: Option<&OsStr>,
) -> PathBuf {
    let local_app_data = local_app_data_dir();
    let roaming_app_data = roaming_app_data_dir();
    let augmented_entries = augmented_path_entries_for(
        home,
        current_path,
        local_app_data.as_deref(),
        roaming_app_data.as_deref(),
    );

    if let Some(shell) = shell_env
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| resolve_shell_candidate(value, &augmented_entries))
    {
        return shell;
    }

    #[cfg(target_os = "windows")]
    let fallback_shells = ["cmd", "powershell", "pwsh"];
    #[cfg(not(target_os = "windows"))]
    let fallback_shells = ["zsh", "bash", "fish", "sh"];

    for shell in fallback_shells {
        if let Some(path) = resolve_from_entries(shell, &augmented_entries) {
            return path;
        }
    }

    #[cfg(target_os = "windows")]
    {
        PathBuf::from("cmd.exe")
    }

    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("/bin/sh")
    }
}

fn resolve_from_entries(binary: &str, entries: &[PathBuf]) -> Option<PathBuf> {
    let joined = join_paths(entries.iter().cloned())?;
    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    which::which_in(binary, Some(joined), cwd).ok()
}

fn command_shell_args_for(program: &Path, command: &str) -> Vec<String> {
    match shell_flavor(program) {
        ShellFlavor::Bash | ShellFlavor::Zsh | ShellFlavor::Sh => {
            vec!["-lc".to_string(), command.to_string()]
        }
        ShellFlavor::Fish => vec!["-l".to_string(), "-c".to_string(), command.to_string()],
        ShellFlavor::Cmd => vec!["/C".to_string(), command.to_string()],
        ShellFlavor::PowerShell => vec!["-Command".to_string(), command.to_string()],
        _ => vec!["-c".to_string(), command.to_string()],
    }
}

fn shell_flavor(path: &Path) -> ShellFlavor {
    match path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("bash") => ShellFlavor::Bash,
        Some("fish") => ShellFlavor::Fish,
        Some("zsh") => ShellFlavor::Zsh,
        Some("sh") => ShellFlavor::Sh,
        Some("cmd") | Some("cmd.exe") => ShellFlavor::Cmd,
        Some("powershell") | Some("powershell.exe") | Some("pwsh") | Some("pwsh.exe") => {
            ShellFlavor::PowerShell
        }
        _ => ShellFlavor::Other,
    }
}

#[cfg(not(target_os = "windows"))]
fn login_probe_shells_for(shell_env: Option<&str>, current_path: Option<&OsStr>) -> Vec<PathBuf> {
    let home = home_dir();
    let augmented_entries = augmented_path_entries_for(home.as_deref(), current_path, None, None);
    let mut candidates = Vec::new();

    if let Some(shell) = shell_env
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| resolve_shell_candidate(value, &augmented_entries))
    {
        candidates.push(shell);
    }

    for candidate in [
        "zsh",
        "/bin/zsh",
        "bash",
        "/bin/bash",
        "fish",
        "/usr/bin/fish",
        "sh",
        "/bin/sh",
    ] {
        if let Some(shell) = resolve_shell_candidate(candidate, &augmented_entries) {
            candidates.push(shell);
        }
    }

    dedupe_paths(candidates)
        .into_iter()
        .filter(|path| is_executable_file(path))
        .collect()
}

fn resolve_shell_candidate(candidate: &str, entries: &[PathBuf]) -> Option<PathBuf> {
    let has_separator = candidate.contains('/') || candidate.contains('\\');
    if has_separator {
        let path = PathBuf::from(candidate);
        if is_executable_file(&path) {
            return Some(path);
        }
    }

    resolve_from_entries(candidate, entries)
}

fn join_paths<I>(entries: I) -> Option<OsString>
where
    I: IntoIterator<Item = PathBuf>,
{
    let entries = dedupe_paths(entries.into_iter().collect());
    env::join_paths(entries).ok()
}

fn dedupe_paths(entries: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = Vec::<PathBuf>::new();
    let mut deduped = Vec::with_capacity(entries.len());

    for entry in entries {
        if entry.as_os_str().is_empty() {
            continue;
        }
        if seen.iter().any(|existing| existing == &entry) {
            continue;
        }
        seen.push(entry.clone());
        deduped.push(entry);
    }

    deduped
}

pub fn home_dir() -> Option<PathBuf> {
    home_dir_from_env(
        env::var_os("HOME").as_deref(),
        env::var_os("USERPROFILE").as_deref(),
        env::var_os("HOMEDRIVE").as_deref(),
        env::var_os("HOMEPATH").as_deref(),
    )
}

fn home_dir_from_env(
    home: Option<&OsStr>,
    user_profile: Option<&OsStr>,
    home_drive: Option<&OsStr>,
    home_path: Option<&OsStr>,
) -> Option<PathBuf> {
    non_empty_os_str(home)
        .map(PathBuf::from)
        .or_else(|| non_empty_os_str(user_profile).map(PathBuf::from))
        .or_else(|| {
            let home_drive = non_empty_os_str(home_drive)?;
            let home_path = non_empty_os_str(home_path)?;
            let mut path = PathBuf::from(home_drive);
            path.push(home_path);
            Some(path)
        })
}

pub fn local_app_data_dir() -> Option<PathBuf> {
    non_empty_os_str(env::var_os("LOCALAPPDATA").as_deref()).map(PathBuf::from)
}

pub fn roaming_app_data_dir() -> Option<PathBuf> {
    non_empty_os_str(env::var_os("APPDATA").as_deref()).map(PathBuf::from)
}

fn app_data_dir_for(
    is_windows: bool,
    local_app_data: Option<&Path>,
    roaming_app_data: Option<&Path>,
    home: Option<&Path>,
) -> PathBuf {
    if is_windows {
        if let Some(path) = local_app_data {
            return path.join("Panes");
        }
        if let Some(path) = roaming_app_data {
            return path.join("Panes");
        }
        if let Some(home) = home {
            return home.join("AppData").join("Local").join("Panes");
        }
        return env::temp_dir().join("Panes");
    }

    home.map(legacy_app_data_dir_for)
        .unwrap_or_else(|| Path::new(".").join(".agent-workspace"))
}

/// Flatpak gives the app a throwaway tmpfs `$HOME`; only the XDG base dirs
/// (redirected to `~/.var/app/$FLATPAK_ID`) survive a restart, so app data
/// has to live under `$XDG_DATA_HOME` there.
fn flatpak_app_data_dir_for(
    xdg_data_home: Option<&OsStr>,
    flatpak_id: Option<&OsStr>,
    home: Option<&Path>,
) -> PathBuf {
    if let Some(data_home) = non_empty_os_str(xdg_data_home) {
        return Path::new(data_home).join("panes");
    }
    let flatpak_id = non_empty_os_str(flatpak_id).unwrap_or(OsStr::new("com.panes.app"));
    home.unwrap_or_else(|| Path::new("."))
        .join(".var")
        .join("app")
        .join(flatpak_id)
        .join("data")
        .join("panes")
}

fn non_empty_os_str(value: Option<&OsStr>) -> Option<&OsStr> {
    value.filter(|value| !value.is_empty())
}

fn legacy_app_data_dir_for(home: &Path) -> PathBuf {
    home.join(".agent-workspace")
}

fn migrate_legacy_app_data_dir_for(current: &Path, legacy: Option<&Path>) -> std::io::Result<()> {
    let Some(legacy) = legacy else {
        return Ok(());
    };

    if current == legacy || !legacy.exists() || path_has_entries(current)? {
        return Ok(());
    }

    if let Some(parent) = current.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut copied_legacy = false;
    if current.exists() {
        copy_dir_contents_recursive(legacy, current)?;
        copied_legacy = true;
    } else if let Err(rename_error) = fs::rename(legacy, current) {
        log::warn!(
            "failed to rename legacy app data dir {} -> {}: {}; falling back to copy",
            legacy.display(),
            current.display(),
            rename_error
        );
        copy_dir_contents_recursive(legacy, current)?;
        copied_legacy = true;
    }

    if copied_legacy {
        let _ = fs::remove_dir_all(legacy);
    }

    Ok(())
}

const DATABASE_FILE_NAME: &str = "workspaces.db";
const DATABASE_SIDECAR_SUFFIXES: [&str; 3] = ["-wal", "-shm", "-journal"];
const IMPORT_STAGING_MARKER: &str = ".panes-import-";
const IMPORT_LOCK_FILE_NAME: &str = ".legacy-import.lock";

/// Copies a legacy `~/.agent-workspace` into the Flatpak data dir, once.
///
/// It runs only while the target has no database and the legacy dir has
/// one, so it stops after the first complete copy, and it holds a lock in
/// the target so two launches cannot interleave. Nothing in the legacy dir
/// is moved, deleted or rewritten (opening its database read-only can leave
/// SQLite's empty `-wal` and `-shm` files beside it). Files already in the target are kept; each new file is written
/// under a staging name this run created and renamed into place. The
/// database is snapshotted through SQLite last, so an interrupted copy
/// leaves no `workspaces.db` and runs again on the next launch.
fn import_legacy_app_data_into_flatpak(
    current: &Path,
    legacy: Option<&Path>,
) -> std::io::Result<()> {
    let Some(legacy) = legacy else {
        return Ok(());
    };
    let legacy_database = legacy.join(DATABASE_FILE_NAME);
    let database = current.join(DATABASE_FILE_NAME);
    if current == legacy || !path_is_present(&legacy_database)? || path_is_present(&database)? {
        return Ok(());
    }

    fs::create_dir_all(current)?;
    let lock = fs::File::create(current.join(IMPORT_LOCK_FILE_NAME))?;
    lock.lock()?;
    // Another launch may have finished the import while this one waited.
    if path_is_present(&database)? {
        return Ok(());
    }

    log::info!(
        "copying legacy app data {} into {}",
        legacy.display(),
        current.display()
    );
    copy_dir_contents_without_overwrite(legacy, current, true);
    import_legacy_database(&legacy_database, current)
}

/// Whether `path` exists. Only a confirmed absence counts as missing: an
/// unreadable legacy dir must fail the launch rather than let a fresh
/// database replace the import for good.
fn path_is_present(path: &Path) -> std::io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn is_import_bookkeeping_file_name(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    name == IMPORT_LOCK_FILE_NAME || name.contains(IMPORT_STAGING_MARKER)
}

fn is_database_file_name(name: &OsStr) -> bool {
    let Some(name) = name.to_str() else {
        return false;
    };
    name == DATABASE_FILE_NAME
        || DATABASE_SIDECAR_SUFFIXES
            .iter()
            .any(|suffix| name.strip_suffix(suffix) == Some(DATABASE_FILE_NAME))
}

/// Copies everything but the database. A file that cannot be copied is
/// logged and skipped, so one unreadable log or attachment cannot stop every
/// launch; the legacy dir keeps it.
fn copy_dir_contents_without_overwrite(source: &Path, target: &Path, top_level: bool) {
    if let Err(error) = fs::create_dir_all(target) {
        log::warn!("skipping legacy dir {}: {error}", source.display());
        return;
    }
    let entries = match fs::read_dir(source) {
        Ok(entries) => entries,
        Err(error) => {
            log::warn!("skipping legacy dir {}: {error}", source.display());
            return;
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                log::warn!("skipping an entry of {}: {error}", source.display());
                continue;
            }
        };
        let name = entry.file_name();
        if (top_level && is_database_file_name(&name)) || is_import_bookkeeping_file_name(&name) {
            continue;
        }
        let source_path = entry.path();
        let target_path = target.join(&name);
        if let Err(error) = copy_entry_without_overwrite(&entry, &source_path, &target_path) {
            log::warn!("skipping legacy file {}: {error}", source_path.display());
        }
    }
}

fn copy_entry_without_overwrite(
    entry: &fs::DirEntry,
    source: &Path,
    target: &Path,
) -> std::io::Result<()> {
    let file_type = entry.file_type()?;
    if file_type.is_dir() {
        copy_dir_contents_without_overwrite(source, target, false);
        return Ok(());
    }
    if path_is_present(target)? {
        return Ok(());
    }
    if file_type.is_symlink() {
        // Recreate the link rather than follow it: it may point at a
        // directory the user moved elsewhere.
        #[cfg(unix)]
        {
            return std::os::unix::fs::symlink(fs::read_link(source)?, target);
        }
        #[cfg(not(unix))]
        {
            return Ok(());
        }
    }

    let staging = new_staging_path(target);
    let result = copy_file_to_new(source, &staging).and_then(|()| publish_staged(&staging, target));
    if result.is_err() {
        let _ = fs::remove_file(&staging);
    }
    result
}

/// Snapshots the legacy database through SQLite, so the copy is consistent
/// even while a host install writes to it and includes what is still in its
/// WAL, then renames the snapshot into place. A WAL, SHM or journal file
/// already in the target belongs to no database (there is no
/// `workspaces.db` there) and SQLite would replay a stale WAL into the
/// snapshot, so it is renamed aside, never deleted.
fn import_legacy_database(legacy_database: &Path, current: &Path) -> std::io::Result<()> {
    let database = current.join(DATABASE_FILE_NAME);
    let staging = new_staging_path(&database);
    if let Err(error) = snapshot_sqlite_database(legacy_database, &staging) {
        let _ = fs::remove_file(&staging);
        return Err(error);
    }

    for suffix in DATABASE_SIDECAR_SUFFIXES {
        let sidecar = current.join(format!("{DATABASE_FILE_NAME}{suffix}"));
        if path_is_present(&sidecar)? {
            let mut aside = sidecar.clone().into_os_string();
            aside.push(format!(".orphaned-{}", uuid::Uuid::new_v4()));
            log::warn!(
                "moving {} aside to {:?}: it has no database",
                sidecar.display(),
                aside
            );
            fs::rename(&sidecar, aside)?;
        }
    }

    let result = publish_staged(&staging, &database);
    if result.is_err() {
        let _ = fs::remove_file(&staging);
    }
    result
}

fn snapshot_sqlite_database(source: &Path, staging: &Path) -> std::io::Result<()> {
    let to_io = |error: rusqlite::Error| std::io::Error::other(error);
    let staging = staging
        .to_str()
        .ok_or_else(|| std::io::Error::other("staging path is not valid UTF-8"))?;
    let connection = rusqlite::Connection::open_with_flags(
        source,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(to_io)?;
    connection
        .busy_timeout(Duration::from_secs(10))
        .map_err(to_io)?;
    connection
        .execute("VACUUM INTO ?1", [staging])
        .map_err(to_io)?;
    Ok(())
}

/// A staging path no earlier run or other launch can be using.
fn new_staging_path(target: &Path) -> PathBuf {
    let mut name = target
        .file_name()
        .map(OsStr::to_os_string)
        .unwrap_or_default();
    name.push(format!("{IMPORT_STAGING_MARKER}{}", uuid::Uuid::new_v4()));
    target.with_file_name(name)
}

fn copy_file_to_new(source: &Path, staging: &Path) -> std::io::Result<()> {
    let mut reader = fs::File::open(source)?;
    let mut writer = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(staging)?;
    std::io::copy(&mut reader, &mut writer)?;
    writer.sync_all()?;
    fs::set_permissions(staging, reader.metadata()?.permissions())
}

/// Renames a staged file into place unless the target appeared meanwhile.
/// The import lock keeps other launches out, so check then rename is safe.
fn publish_staged(staging: &Path, target: &Path) -> std::io::Result<()> {
    if path_is_present(target)? {
        let _ = fs::remove_file(staging);
        return Ok(());
    }
    fs::rename(staging, target)
}

fn path_has_entries(path: &Path) -> std::io::Result<bool> {
    if !path.exists() {
        return Ok(false);
    }
    if path.is_file() {
        return Ok(true);
    }

    Ok(fs::read_dir(path)?.next().transpose()?.is_some())
}

fn copy_dir_contents_recursive(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::create_dir_all(target)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if entry.file_type()?.is_dir() {
            copy_dir_contents_recursive(&source_path, &target_path)?;
            continue;
        }

        if target_path.exists() {
            continue;
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&source_path, &target_path)?;
    }

    Ok(())
}

/// Parse PATH entries from environment files like `/etc/environment`.
/// Format: `PATH="..."` or `PATH=...` with colon-separated paths.
#[cfg(target_os = "linux")]
fn parse_path_from_env_file(path: &Path, home: Option<&Path>) -> Vec<PathBuf> {
    let Ok(contents) = fs::read_to_string(path) else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        if let Some(("PATH", value)) = parse_config_assignment(line) {
            let value = value.trim_matches('"').trim_matches('\'');
            for entry in value.split(':') {
                if let Some(path) = parse_config_path_entry(entry, home) {
                    result.push(path);
                }
            }
        }
    }
    result
}

/// Read PATH entries from `~/.config/environment.d/*.conf` (systemd user environment).
#[cfg(target_os = "linux")]
fn linux_user_environment_path_entries(home: &Path) -> Vec<PathBuf> {
    let env_dir = home.join(".config/environment.d");
    let Ok(dir_entries) = fs::read_dir(env_dir) else {
        return Vec::new();
    };

    let mut result = Vec::new();
    for entry in dir_entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("conf") {
            result.extend(parse_path_from_env_file(&path, Some(home)));
        }
    }
    result
}

fn parse_config_assignment(line: &str) -> Option<(&str, &str)> {
    let (key, value) = line.split_once('=')?;
    Some((key.trim(), value.trim()))
}

fn parse_config_path_entry(entry: &str, home: Option<&Path>) -> Option<PathBuf> {
    let entry = entry.trim();
    if entry.is_empty() || entry == "$PATH" || entry == "${PATH}" {
        return None;
    }

    if let Some(home) = home {
        if let Some(expanded) = expand_home_path(entry, home) {
            return Some(expanded);
        }
    }

    if entry.contains('$') {
        return None;
    }

    Some(PathBuf::from(entry))
}

fn expand_home_path(value: &str, home: &Path) -> Option<PathBuf> {
    if value == "~" || value == "$HOME" || value == "${HOME}" {
        return Some(home.to_path_buf());
    }
    if let Some(rest) = value.strip_prefix("~/") {
        return Some(home.join(rest));
    }
    if let Some(rest) = value.strip_prefix("$HOME/") {
        return Some(home.join(rest));
    }
    if let Some(rest) = value.strip_prefix("${HOME}/") {
        return Some(home.join(rest));
    }
    None
}

/// Read the npm global bin dir from the user's `~/.npmrc` file.
/// Handles custom prefixes set via `npm config set prefix <path>`.
#[cfg_attr(target_os = "windows", allow(dead_code))]
fn npm_global_bin_from_npmrc(home: &Path) -> Option<PathBuf> {
    let npmrc = home.join(".npmrc");
    let contents = fs::read_to_string(npmrc).ok()?;
    for line in contents.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(("prefix", prefix)) = parse_config_assignment(line) {
            let prefix = prefix.trim_matches('"').trim_matches('\'');
            if prefix.is_empty() {
                continue;
            }
            let expanded = parse_config_path_entry(prefix, Some(home))?;
            return Some(expanded.join("bin"));
        }
    }
    None
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn nvm_bin_dirs(home: &Path) -> Vec<PathBuf> {
    let versions_dir = home.join(".nvm/versions/node");
    let Ok(entries) = fs::read_dir(versions_dir) else {
        return Vec::new();
    };

    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("bin"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        ffi::{OsStr, OsString},
        sync::Mutex,
        time::{SystemTime, UNIX_EPOCH},
    };
    use uuid::Uuid;

    fn normalize_path(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    fn env_lock() -> &'static Mutex<()> {
        crate::process_utils::test_env_lock()
    }

    struct PathEnvGuard {
        original_path: Option<OsString>,
        temp_dir: PathBuf,
    }

    impl Drop for PathEnvGuard {
        fn drop(&mut self) {
            match self.original_path.as_ref() {
                Some(path) => std::env::set_var("PATH", path),
                None => std::env::remove_var("PATH"),
            }
            let _ = std::fs::remove_dir_all(&self.temp_dir);
        }
    }

    #[test]
    fn terminal_shell_args_match_shell_type() {
        #[cfg(target_os = "windows")]
        {
            assert_eq!(
                terminal_shell_args(Path::new("cmd.exe")),
                Vec::<String>::new()
            );
            assert_eq!(
                terminal_shell_args(Path::new("pwsh.exe")),
                Vec::<String>::new()
            );
        }

        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(
                terminal_shell_args(Path::new("/bin/bash")),
                vec!["-l".to_string(), "-i".to_string()]
            );
            assert_eq!(
                terminal_shell_args(Path::new("/bin/zsh")),
                vec!["-l".to_string(), "-i".to_string()]
            );
            assert_eq!(
                terminal_shell_args(Path::new("/bin/sh")),
                vec!["-l".to_string(), "-i".to_string()]
            );
            assert_eq!(
                terminal_shell_args(Path::new("/usr/bin/fish")),
                vec!["-l".to_string(), "-i".to_string()]
            );
        }
    }

    #[test]
    fn command_shell_args_match_shell_type() {
        assert_eq!(
            command_shell_args_for(Path::new("/bin/bash"), "echo hi"),
            vec!["-lc".to_string(), "echo hi".to_string()]
        );
        assert_eq!(
            command_shell_args_for(Path::new("/usr/bin/fish"), "echo hi"),
            vec!["-l".to_string(), "-c".to_string(), "echo hi".to_string()]
        );
        assert_eq!(
            command_shell_args_for(Path::new("/bin/sh"), "echo hi"),
            vec!["-lc".to_string(), "echo hi".to_string()]
        );
        assert_eq!(
            command_shell_args_for(Path::new("cmd.exe"), "echo hi"),
            vec!["/C".to_string(), "echo hi".to_string()]
        );
        assert_eq!(
            command_shell_args_for(Path::new("pwsh.exe"), "echo hi"),
            vec!["-Command".to_string(), "echo hi".to_string()]
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn login_probe_shell_args_match_shell_type() {
        assert_eq!(
            login_probe_shell_args(Path::new("/bin/bash"), "command -v node"),
            vec![
                "-l".to_string(),
                "-i".to_string(),
                "-c".to_string(),
                "command -v node".to_string(),
            ]
        );
        assert_eq!(
            login_probe_shell_args(Path::new("/usr/bin/fish"), "command -v node"),
            vec![
                "-l".to_string(),
                "-i".to_string(),
                "-c".to_string(),
                "command -v node".to_string(),
            ]
        );
        assert_eq!(
            login_probe_shell_args(Path::new("/bin/sh"), "command -v node"),
            vec![
                "-l".to_string(),
                "-c".to_string(),
                "command -v node".to_string(),
            ]
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn parse_login_probe_output_skips_banner_lines() {
        assert_eq!(
            parse_login_probe_output("Welcome to fish\n/usr/local/bin/node\nv22.0.0\n"),
            Some(("/usr/local/bin/node".to_string(), "v22.0.0".to_string()))
        );
    }

    #[test]
    fn parse_login_shell_env_output_starts_after_marker() {
        let mut output = b"profile noise\n".to_vec();
        output.extend_from_slice(LOGIN_ENV_PROBE_MARKER.as_bytes());
        output.push(0);
        output.extend_from_slice(b"OPENROUTER_API_KEY=secret-value");
        output.push(0);
        output.extend_from_slice(b"BROKEN_ENTRY");
        output.push(0);
        output.extend_from_slice(b"EMPTY=");
        output.push(0);

        let parsed = parse_login_shell_env_output(&output);

        assert_eq!(
            parsed.get(&OsString::from("OPENROUTER_API_KEY")),
            Some(&OsString::from("secret-value"))
        );
        assert_eq!(
            parsed.get(&OsString::from("EMPTY")),
            Some(&OsString::from(""))
        );
        assert!(!parsed.contains_key(&OsString::from("BROKEN_ENTRY")));
    }

    #[test]
    fn login_shell_env_import_skips_process_and_path_keys() {
        assert!(!should_import_login_shell_env_var(OsStr::new("PATH")));
        assert!(!should_import_login_shell_env_var(OsStr::new("PWD")));
        assert!(!should_import_login_shell_env_var(OsStr::new(
            "XPC_SERVICE_NAME"
        )));
        assert!(should_import_login_shell_env_var(OsStr::new(
            "OPENROUTER_API_KEY"
        )));
    }

    #[test]
    fn parse_windows_login_probe_output_skips_profile_noise() {
        assert_eq!(
            parse_windows_login_probe_output(
                "Loading profile...\nC:\\Users\\panes\\AppData\\Roaming\\npm\\codex.cmd\n0.42.0\n",
            ),
            Some((
                "C:\\Users\\panes\\AppData\\Roaming\\npm\\codex.cmd".to_string(),
                "0.42.0".to_string(),
            ))
        );
    }

    #[test]
    fn parse_windows_single_path_output_skips_profile_noise() {
        assert_eq!(
            parse_windows_single_path_output("Welcome back\nC:\\Program Files\\nodejs\\node.exe\n",),
            Some("C:\\Program Files\\nodejs\\node.exe".to_string())
        );
    }

    #[test]
    fn windows_login_probe_shells_prefer_pwsh_before_powershell() {
        let _env_guard = env_lock().lock().expect("env lock poisoned");
        let temp_dir = std::env::temp_dir().join(format!(
            "panes-runtime-env-pwsh-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time after epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");
        let _path_guard = PathEnvGuard {
            original_path: std::env::var_os("PATH"),
            temp_dir: temp_dir.clone(),
        };

        #[cfg(target_os = "windows")]
        let shell_names = ["pwsh.exe", "powershell.exe"];
        #[cfg(not(target_os = "windows"))]
        let shell_names = ["pwsh", "powershell"];

        for shell in shell_names {
            let path = temp_dir.join(shell);
            std::fs::write(&path, "").expect("write shell stub");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;

                let mut permissions = std::fs::metadata(&path).expect("metadata").permissions();
                permissions.set_mode(0o755);
                std::fs::set_permissions(&path, permissions).expect("set permissions");
            }
        }

        std::env::set_var("PATH", &temp_dir);
        let shells = windows_login_probe_shells();

        #[cfg(target_os = "windows")]
        {
            assert_eq!(shells[0], temp_dir.join("pwsh.exe"));
            assert!(shells.contains(&temp_dir.join("powershell.exe")));
        }

        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(shells[0], temp_dir.join("pwsh"));
            assert!(shells.contains(&temp_dir.join("powershell")));
        }
    }

    #[cfg(unix)]
    #[test]
    fn command_shell_prefers_zsh_before_other_available_shells() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = std::env::temp_dir().join(format!(
            "panes-runtime-env-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time after epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        for shell in ["zsh", "bash", "sh"] {
            let path = temp_dir.join(shell);
            std::fs::write(&path, "#!/bin/sh\n").expect("write shell stub");
            let mut permissions = std::fs::metadata(&path).expect("metadata").permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&path, permissions).expect("set permissions");
        }

        let selected = command_shell_program_for(None, None, Some(temp_dir.as_os_str()));
        assert_eq!(selected, temp_dir.join("zsh"));

        std::fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }

    #[cfg(not(target_os = "windows"))]
    #[cfg(unix)]
    #[test]
    fn command_shell_prefers_shell_env_when_available() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = std::env::temp_dir().join(format!(
            "panes-runtime-env-command-shell-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time after epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        for shell in ["fish", "zsh", "bash", "sh"] {
            let path = temp_dir.join(shell);
            std::fs::write(&path, "#!/bin/sh\n").expect("write shell stub");
            let mut permissions = std::fs::metadata(&path).expect("metadata").permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&path, permissions).expect("set permissions");
        }

        let selected = command_shell_program_for(
            Some(temp_dir.join("fish").to_string_lossy().as_ref()),
            None,
            Some(temp_dir.as_os_str()),
        );
        assert_eq!(selected, temp_dir.join("fish"));
        assert_eq!(
            command_shell_args_for(&selected, "echo hi"),
            vec!["-l".to_string(), "-c".to_string(), "echo hi".to_string()]
        );

        std::fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }

    #[cfg(not(target_os = "windows"))]
    #[cfg(unix)]
    #[test]
    fn login_probe_shells_prefer_shell_env_and_include_fish_and_sh() {
        use std::os::unix::fs::PermissionsExt;

        let temp_dir = std::env::temp_dir().join(format!(
            "panes-runtime-env-shells-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time after epoch")
                .as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).expect("create temp dir");

        for shell in ["fish", "zsh", "bash", "sh"] {
            let path = temp_dir.join(shell);
            std::fs::write(&path, "#!/bin/sh\n").expect("write shell stub");
            let mut permissions = std::fs::metadata(&path).expect("metadata").permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&path, permissions).expect("set permissions");
        }

        let shells = login_probe_shells_for(
            Some(temp_dir.join("fish").to_string_lossy().as_ref()),
            Some(temp_dir.as_os_str()),
        );

        assert_eq!(shells[0], temp_dir.join("fish"));
        assert!(shells.contains(&temp_dir.join("zsh")));
        assert!(shells.contains(&temp_dir.join("bash")));
        assert!(shells.contains(&temp_dir.join("sh")));

        std::fs::remove_dir_all(&temp_dir).expect("remove temp dir");
    }

    #[test]
    fn prepended_paths_stay_first() {
        let value =
            augmented_path_with_prepend([PathBuf::from("/custom/bin"), PathBuf::from("/usr/bin")])
                .expect("joined path");
        let joined = value.to_string_lossy();
        assert!(joined.starts_with("/custom/bin"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_augmented_path_includes_expected_user_bins() {
        let home = Path::new("/home/panes");
        let current_path = OsStr::new("/usr/bin:/bin");
        let entries = augmented_path_entries_for(Some(home), Some(current_path), None, None);

        assert!(entries.contains(&home.join(".local/share/npm/bin")));
        assert!(entries.contains(&home.join(".npm-global/bin")));
        assert!(entries.contains(&home.join(".volta/bin")));
        assert!(entries.contains(&home.join(".local/share/fnm/aliases/default/bin")));
        assert!(entries.contains(&home.join(".local/share/pnpm")));
        assert!(entries.contains(&home.join(".cargo/bin")));
        assert!(entries.contains(&home.join(".deno/bin")));
        assert!(entries.contains(&home.join(".bun/bin")));
        assert!(entries.contains(&home.join(".local/share/mise/shims")));
        assert!(entries.contains(&home.join(".proto/shims")));
        assert!(entries.contains(&home.join(".proto/bin")));
        assert!(entries.contains(&home.join(".fnm/aliases/default/bin")));
        assert!(entries.contains(&home.join("bin")));
        assert!(entries.contains(&home.join(".nix-profile/bin")));
        assert!(entries.contains(&PathBuf::from("/snap/bin")));
        assert!(entries.contains(&PathBuf::from("/home/linuxbrew/.linuxbrew/bin")));
        assert!(entries.contains(&PathBuf::from("/nix/var/nix/profiles/default/bin")));
        assert!(entries.contains(&PathBuf::from("/run/current-system/sw/bin")));
        assert!(!entries.contains(&home.join("Library/pnpm")));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_terminal_shell_skips_empty_shell_env() {
        let home = Path::new("/home/panes");
        let shell = terminal_shell_for(Some(""), Some(home), Some(OsStr::new("/usr/bin:/bin")));
        assert_ne!(shell.as_os_str(), "");
        assert_ne!(shell, PathBuf::from("/bin/zsh"));
    }

    #[test]
    fn home_dir_from_env_uses_windows_fallbacks_when_home_is_missing() {
        let from_user_profile =
            home_dir_from_env(None, Some(OsStr::new(r"C:\Users\panes")), None, None)
                .expect("user profile path");
        assert_eq!(normalize_path(&from_user_profile), "C:/Users/panes");

        let from_home_drive = home_dir_from_env(
            None,
            None,
            Some(OsStr::new("C:")),
            Some(OsStr::new(r"\Users\panes")),
        )
        .expect("home drive + home path");
        let rendered = normalize_path(&from_home_drive);
        assert!(rendered.starts_with("C:"));
        assert!(rendered.ends_with("/Users/panes"));
    }

    #[test]
    fn app_data_dir_for_windows_prefers_local_app_data() {
        let path = app_data_dir_for(
            true,
            Some(Path::new(r"C:\Users\panes\AppData\Local")),
            Some(Path::new(r"C:\Users\panes\AppData\Roaming")),
            Some(Path::new(r"C:\Users\panes")),
        );
        assert_eq!(normalize_path(&path), "C:/Users/panes/AppData/Local/Panes");
    }

    #[test]
    fn app_data_dir_for_unix_uses_dot_agent_workspace() {
        let path = app_data_dir_for(false, None, None, Some(Path::new("/home/panes")));
        assert_eq!(path, PathBuf::from("/home/panes/.agent-workspace"));
    }

    #[test]
    fn app_data_dir_for_windows_falls_back_to_absolute_temp_dir() {
        let path = app_data_dir_for(true, None, None, None);
        assert_eq!(path, std::env::temp_dir().join("Panes"));
        assert!(path.is_absolute());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parse_path_from_env_file_extracts_paths() {
        let dir = std::env::temp_dir().join(format!("panes-env-file-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create temp dir");
        let env_file = dir.join("environment");
        let home = Path::new("/home/panes");

        fs::write(
            &env_file,
            "# comment\nPATH=\"/usr/local/sbin:/usr/local/bin:/usr/bin:/snap/bin\"\nLANG=en_US.UTF-8\n",
        )
        .expect("write env file");

        let paths = parse_path_from_env_file(&env_file, Some(home));
        assert_eq!(
            paths,
            vec![
                PathBuf::from("/usr/local/sbin"),
                PathBuf::from("/usr/local/bin"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/snap/bin"),
            ]
        );

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parse_path_from_env_file_skips_variable_references() {
        let dir = std::env::temp_dir().join(format!("panes-env-var-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create temp dir");
        let env_file = dir.join("environment");
        let home = Path::new("/home/panes");

        fs::write(&env_file, "PATH=${PATH}:/custom/bin:/other/bin\n").expect("write env file");

        let paths = parse_path_from_env_file(&env_file, Some(home));
        // ${PATH} entry should be skipped, literal paths kept
        assert!(paths.contains(&PathBuf::from("/custom/bin")));
        assert!(paths.contains(&PathBuf::from("/other/bin")));
        assert!(!paths.iter().any(|p| p.to_string_lossy().contains('$')));

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn parse_path_from_env_file_expands_home_and_supports_spaced_assignment() {
        let dir = std::env::temp_dir().join(format!("panes-env-home-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create temp dir");
        let env_file = dir.join("environment");
        let home = Path::new("/home/panes");

        fs::write(
            &env_file,
            "PATH = \"$HOME/.local/bin:${HOME}/.cargo/bin:${PATH}:~/bin\"\n",
        )
        .expect("write env file");

        let paths = parse_path_from_env_file(&env_file, Some(home));
        assert!(paths.contains(&home.join(".local/bin")));
        assert!(paths.contains(&home.join(".cargo/bin")));
        assert!(paths.contains(&home.join("bin")));
        assert!(!paths.iter().any(|p| p.to_string_lossy().contains('$')));

        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_user_environment_path_entries_reads_conf_files() {
        let dir = std::env::temp_dir().join(format!("panes-envd-{}", Uuid::new_v4()));
        let env_d = dir.join(".config/environment.d");
        fs::create_dir_all(&env_d).expect("create environment.d dir");

        fs::write(env_d.join("custom.conf"), "PATH=/custom/tools/bin\n").expect("write conf file");
        // non-.conf files should be ignored
        fs::write(env_d.join("readme.txt"), "PATH=/should/be/ignored\n").expect("write txt file");

        let paths = linux_user_environment_path_entries(&dir);
        assert!(paths.contains(&PathBuf::from("/custom/tools/bin")));
        assert!(!paths.contains(&PathBuf::from("/should/be/ignored")));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn npm_global_bin_from_npmrc_reads_prefix() {
        let dir = std::env::temp_dir().join(format!("panes-npmrc-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create temp dir");

        // Absolute prefix
        fs::write(dir.join(".npmrc"), "prefix=/opt/npm-global\n").expect("write npmrc");
        assert_eq!(
            npm_global_bin_from_npmrc(&dir),
            Some(PathBuf::from("/opt/npm-global/bin"))
        );

        // Tilde prefix
        fs::write(
            dir.join(".npmrc"),
            "# comment\n; another comment\nprefix=~/npm-packages\n",
        )
        .expect("write npmrc");
        assert_eq!(
            npm_global_bin_from_npmrc(&dir),
            Some(dir.join("npm-packages/bin"))
        );

        // INI-style spacing and ${HOME} interpolation
        fs::write(dir.join(".npmrc"), "prefix = ${HOME}/.npm-packages\n").expect("write npmrc");
        assert_eq!(
            npm_global_bin_from_npmrc(&dir),
            Some(dir.join(".npm-packages/bin"))
        );

        // Quoted prefix
        fs::write(dir.join(".npmrc"), "prefix=\"/quoted/path\"\n").expect("write npmrc");
        assert_eq!(
            npm_global_bin_from_npmrc(&dir),
            Some(PathBuf::from("/quoted/path/bin"))
        );

        // No prefix
        fs::write(dir.join(".npmrc"), "registry=https://registry.npmjs.org/\n")
            .expect("write npmrc");
        assert_eq!(npm_global_bin_from_npmrc(&dir), None);

        // No file
        let _ = fs::remove_file(dir.join(".npmrc"));
        assert_eq!(npm_global_bin_from_npmrc(&dir), None);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn migrate_legacy_app_data_dir_moves_existing_legacy_tree() {
        let root = std::env::temp_dir().join(format!("panes-app-data-migrate-{}", Uuid::new_v4()));
        let current = root.join("AppData").join("Local").join("Panes");
        let legacy = root.join(".agent-workspace");

        fs::create_dir_all(legacy.join("logs")).expect("legacy app data dir should exist");
        fs::write(legacy.join("config.toml"), "theme = \"dark\"\n")
            .expect("legacy config should be written");
        fs::write(legacy.join("logs").join("events.log"), "hello\n")
            .expect("legacy log should be written");

        migrate_legacy_app_data_dir_for(&current, Some(&legacy))
            .expect("legacy app data should migrate");

        assert!(current.join("config.toml").exists());
        assert!(current.join("logs").join("events.log").exists());
        assert!(!legacy.exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn migrate_legacy_app_data_dir_preserves_existing_target_data() {
        let root = std::env::temp_dir().join(format!("panes-app-data-preserve-{}", Uuid::new_v4()));
        let current = root.join("AppData").join("Local").join("Panes");
        let legacy = root.join(".agent-workspace");

        fs::create_dir_all(&current).expect("current app data dir should exist");
        fs::create_dir_all(&legacy).expect("legacy app data dir should exist");
        fs::write(current.join("config.toml"), "theme = \"light\"\n")
            .expect("current config should be written");
        fs::write(legacy.join("config.toml"), "theme = \"dark\"\n")
            .expect("legacy config should be written");

        migrate_legacy_app_data_dir_for(&current, Some(&legacy))
            .expect("migration should skip populated targets");

        assert_eq!(
            fs::read_to_string(current.join("config.toml")).expect("current config should exist"),
            "theme = \"light\"\n"
        );
        assert!(legacy.join("config.toml").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn is_flatpak_needs_linux_a_flatpak_id_and_the_sandbox_marker() {
        let id = Some(OsStr::new("com.panes.app"));
        assert!(is_flatpak_for(true, id, || true));

        assert!(!is_flatpak_for(false, id, || true));
        assert!(!is_flatpak_for(true, None, || true));
        assert!(!is_flatpak_for(true, Some(OsStr::new("")), || true));
        assert!(!is_flatpak_for(true, id, || false));
    }

    #[test]
    fn is_flatpak_ignores_an_inherited_flatpak_id_outside_a_sandbox() {
        // A shell started from another Flatpak app's terminal carries its
        // FLATPAK_ID; that alone must not move the database.
        if Path::new(FLATPAK_INFO_PATH).exists() {
            return;
        }
        let _app_data_guard = crate::config::app_config::app_data_env_lock()
            .lock()
            .expect("app data env lock poisoned");
        let _env_guard = env_lock().lock().expect("env lock poisoned");
        let original = std::env::var_os("FLATPAK_ID");

        std::env::set_var("FLATPAK_ID", "org.example.Ide");
        assert!(!is_flatpak());
        assert!(self_update_supported());

        match original {
            Some(value) => std::env::set_var("FLATPAK_ID", value),
            None => std::env::remove_var("FLATPAK_ID"),
        }
    }

    #[test]
    fn self_update_is_disabled_inside_flatpak() {
        assert!(self_update_supported_for(false));
        assert!(!self_update_supported_for(true));
    }

    #[test]
    fn flatpak_app_data_dir_for_prefers_xdg_data_home() {
        let path = flatpak_app_data_dir_for(
            Some(OsStr::new("/home/panes/.var/app/com.panes.app/data")),
            Some(OsStr::new("com.panes.app")),
            Some(Path::new("/home/panes")),
        );
        assert_eq!(
            path,
            PathBuf::from("/home/panes/.var/app/com.panes.app/data/panes")
        );
    }

    #[test]
    fn flatpak_app_data_dir_for_falls_back_to_var_app_dir() {
        let path = flatpak_app_data_dir_for(
            Some(OsStr::new("")),
            Some(OsStr::new("com.panes.app")),
            Some(Path::new("/home/panes")),
        );
        assert_eq!(
            path,
            PathBuf::from("/home/panes/.var/app/com.panes.app/data/panes")
        );
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn app_data_dir_moves_out_of_home_only_inside_flatpak() {
        let _app_data_guard = crate::config::app_config::app_data_env_lock()
            .lock()
            .expect("app data env lock poisoned");
        let _env_guard = env_lock().lock().expect("env lock poisoned");
        let saved: Vec<(&str, Option<OsString>)> = ["FLATPAK_ID", "XDG_DATA_HOME", "HOME"]
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();

        std::env::set_var("HOME", "/home/panes");
        std::env::set_var("XDG_DATA_HOME", "/home/panes/.var/app/com.panes.app/data");

        std::env::set_var("FLATPAK_ID", "com.panes.app");
        assert_eq!(
            app_data_dir_with(false),
            PathBuf::from("/home/panes/.agent-workspace")
        );
        assert_eq!(
            app_data_dir_with(true),
            PathBuf::from("/home/panes/.var/app/com.panes.app/data/panes")
        );

        for (key, value) in saved {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
    }

    #[test]
    fn flatpak_import_needs_a_legacy_database() {
        let _app_data_guard = crate::config::app_config::app_data_env_lock()
            .lock()
            .expect("app data env lock poisoned");
        let _env_guard = env_lock().lock().expect("env lock poisoned");
        let saved: Vec<(&str, Option<OsString>)> = ["FLATPAK_ID", "XDG_DATA_HOME", "HOME"]
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();

        let root = std::env::temp_dir().join(format!("panes-flatpak-migrate-{}", Uuid::new_v4()));
        let legacy = root.join(".agent-workspace");
        fs::create_dir_all(&legacy).expect("legacy app data dir should exist");
        fs::write(legacy.join("config.toml"), "theme = \"dark\"\n")
            .expect("legacy config should be written");

        std::env::set_var("HOME", &root);
        std::env::set_var("XDG_DATA_HOME", root.join("data"));
        std::env::set_var("FLATPAK_ID", "com.panes.app");

        migrate_legacy_app_data_dir_with(true).expect("migration should be a no-op");
        assert!(legacy.join("config.toml").exists());
        assert!(!root.join("data").join("panes").exists());

        for (key, value) in saved {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
        let _ = fs::remove_dir_all(&root);
    }

    /// Writes a legacy install whose database still has rows only in its
    /// WAL. The returned connection keeps the WAL from being checkpointed.
    fn write_legacy_install(legacy: &Path) -> rusqlite::Connection {
        fs::create_dir_all(legacy.join("logs")).expect("legacy logs dir should exist");
        fs::write(legacy.join("config.toml"), "theme = \"dark\"\n")
            .expect("legacy config should be written");
        fs::write(legacy.join("logs").join("events.log"), "hello\n")
            .expect("legacy log should be written");

        let connection = rusqlite::Connection::open(legacy.join(DATABASE_FILE_NAME))
            .expect("legacy db should open");
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .expect("legacy db should use WAL");
        connection
            .pragma_update(None, "wal_autocheckpoint", 0)
            .expect("legacy db autocheckpoint should be off");
        connection
            .execute_batch(
                "CREATE TABLE workspaces (name TEXT);
                 INSERT INTO workspaces VALUES ('alpha'), ('beta');",
            )
            .expect("legacy rows should be written");
        assert!(legacy.join("workspaces.db-wal").exists());
        connection
    }

    fn workspace_names(database: &Path) -> Vec<String> {
        let connection = rusqlite::Connection::open(database).expect("db should open");
        let mut statement = connection
            .prepare("SELECT name FROM workspaces ORDER BY name")
            .expect("query should prepare");
        let names = statement
            .query_map([], |row| row.get(0))
            .expect("query should run")
            .collect::<Result<Vec<String>, _>>()
            .expect("rows should read");
        names
    }

    fn assert_legacy_install_untouched(legacy: &Path) {
        assert_eq!(
            fs::read_to_string(legacy.join("config.toml")).expect("legacy config should remain"),
            "theme = \"dark\"\n"
        );
        assert_eq!(
            fs::read_to_string(legacy.join("logs").join("events.log"))
                .expect("legacy log should remain"),
            "hello\n"
        );
        assert_eq!(
            workspace_names(&legacy.join(DATABASE_FILE_NAME)),
            vec!["alpha".to_string(), "beta".to_string()]
        );
    }

    fn staged_files_in(dir: &Path) -> Vec<PathBuf> {
        let mut found = Vec::new();
        for entry in fs::read_dir(dir).expect("dir should be readable") {
            let path = entry.expect("entry should be readable").path();
            if path.is_dir() {
                found.extend(staged_files_in(&path));
            } else if path.to_string_lossy().contains(IMPORT_STAGING_MARKER) {
                found.push(path);
            }
        }
        found
    }

    #[test]
    fn migrate_inside_flatpak_copies_a_persistent_legacy_dir_once() {
        let _app_data_guard = crate::config::app_config::app_data_env_lock()
            .lock()
            .expect("app data env lock poisoned");
        let _env_guard = env_lock().lock().expect("env lock poisoned");
        let saved: Vec<(&str, Option<OsString>)> = ["XDG_DATA_HOME", "HOME", "USERPROFILE"]
            .into_iter()
            .map(|key| (key, std::env::var_os(key)))
            .collect();

        let root = std::env::temp_dir().join(format!("panes-flatpak-import-{}", Uuid::new_v4()));
        let legacy = root.join(".agent-workspace");
        let current = root.join("data").join("panes");
        let live_legacy = write_legacy_install(&legacy);
        std::env::set_var("HOME", &root);
        std::env::set_var("USERPROFILE", &root);
        std::env::set_var("XDG_DATA_HOME", root.join("data"));

        migrate_legacy_app_data_dir_with(true).expect("legacy data should be copied");

        // Rows that were only in the live legacy WAL made it into the copy.
        assert_eq!(
            workspace_names(&current.join(DATABASE_FILE_NAME)),
            vec!["alpha".to_string(), "beta".to_string()]
        );
        assert!(current.join("config.toml").exists());
        assert!(current.join("logs").join("events.log").exists());
        assert!(staged_files_in(&current).is_empty());
        assert_legacy_install_untouched(&legacy);

        // A second launch must not copy over what the app has written since.
        rusqlite::Connection::open(current.join(DATABASE_FILE_NAME))
            .expect("copied db should open")
            .execute("INSERT INTO workspaces VALUES ('gamma')", [])
            .expect("copied db should accept writes");
        live_legacy
            .execute("DELETE FROM workspaces", [])
            .expect("legacy db should accept writes");
        fs::write(legacy.join("config.toml"), "theme = \"light\"\n")
            .expect("legacy config should be writable");
        migrate_legacy_app_data_dir_with(true).expect("second run should be a no-op");
        assert_eq!(
            workspace_names(&current.join(DATABASE_FILE_NAME)),
            vec!["alpha".to_string(), "beta".to_string(), "gamma".to_string()]
        );
        assert_eq!(
            fs::read_to_string(current.join("config.toml")).expect("config should remain"),
            "theme = \"dark\"\n"
        );

        drop(live_legacy);
        for (key, value) in saved {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn flatpak_import_keeps_files_already_in_the_target() {
        let root = std::env::temp_dir().join(format!("panes-flatpak-keep-{}", Uuid::new_v4()));
        let legacy = root.join(".agent-workspace");
        let current = root.join("data").join("panes");
        let _live_legacy = write_legacy_install(&legacy);
        fs::create_dir_all(current.join("logs")).expect("target logs dir should exist");
        fs::write(current.join("config.toml"), "theme = \"light\"\n")
            .expect("target config should be written");
        fs::write(current.join("logs").join("events.log"), "mine\n")
            .expect("target log should be written");

        import_legacy_app_data_into_flatpak(&current, Some(&legacy))
            .expect("legacy data should be copied");

        assert_eq!(
            fs::read_to_string(current.join("config.toml")).expect("config should remain"),
            "theme = \"light\"\n"
        );
        assert_eq!(
            fs::read_to_string(current.join("logs").join("events.log")).expect("log should remain"),
            "mine\n"
        );
        assert!(current.join(DATABASE_FILE_NAME).exists());
        assert_legacy_install_untouched(&legacy);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn flatpak_import_skips_a_target_that_already_has_a_database() {
        let root = std::env::temp_dir().join(format!("panes-flatpak-skip-{}", Uuid::new_v4()));
        let legacy = root.join(".agent-workspace");
        let current = root.join("data").join("panes");
        let _live_legacy = write_legacy_install(&legacy);
        fs::create_dir_all(&current).expect("target dir should exist");
        fs::write(current.join(DATABASE_FILE_NAME), "mine").expect("target db should be written");

        import_legacy_app_data_into_flatpak(&current, Some(&legacy))
            .expect("import should be a no-op");

        assert_eq!(
            fs::read_to_string(current.join(DATABASE_FILE_NAME)).expect("db should remain"),
            "mine"
        );
        assert!(!current.join("config.toml").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn flatpak_import_moves_sidecars_without_a_database_aside() {
        let root = std::env::temp_dir().join(format!("panes-flatpak-stale-{}", Uuid::new_v4()));
        let legacy = root.join(".agent-workspace");
        let current = root.join("data").join("panes");
        let _live_legacy = write_legacy_install(&legacy);
        fs::create_dir_all(&current).expect("target dir should exist");
        fs::write(current.join("workspaces.db-wal"), "stale").expect("stale wal should be written");

        import_legacy_app_data_into_flatpak(&current, Some(&legacy))
            .expect("legacy data should be copied");

        assert!(!current.join("workspaces.db-wal").exists());
        let aside: Vec<String> = fs::read_dir(&current)
            .expect("target dir should be readable")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .filter(|name| name.starts_with("workspaces.db-wal.orphaned-"))
            .collect();
        assert_eq!(aside.len(), 1);
        assert_eq!(
            fs::read_to_string(current.join(&aside[0])).expect("stale wal should be kept"),
            "stale"
        );
        assert_eq!(
            workspace_names(&current.join(DATABASE_FILE_NAME)),
            vec!["alpha".to_string(), "beta".to_string()]
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn flatpak_import_failure_leaves_no_database_and_the_legacy_dir_intact() {
        let root = std::env::temp_dir().join(format!("panes-flatpak-fail-{}", Uuid::new_v4()));
        let legacy = root.join(".agent-workspace");
        let current = root.join("data").join("panes");
        fs::create_dir_all(&legacy).expect("legacy dir should exist");
        fs::write(legacy.join(DATABASE_FILE_NAME), "not a database")
            .expect("legacy db should be written");
        fs::write(legacy.join("config.toml"), "theme = \"dark\"\n")
            .expect("legacy config should be written");

        let result = import_legacy_app_data_into_flatpak(&current, Some(&legacy));

        assert!(result.is_err());
        assert!(!current.join(DATABASE_FILE_NAME).exists());
        assert!(staged_files_in(&current).is_empty());
        assert_eq!(
            fs::read_to_string(legacy.join(DATABASE_FILE_NAME)).expect("legacy db should remain"),
            "not a database"
        );
        assert!(legacy.join("config.toml").exists());

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn flatpak_import_skips_unreadable_files_and_keeps_symlinks() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!("panes-flatpak-odd-{}", Uuid::new_v4()));
        let legacy = root.join(".agent-workspace");
        let current = root.join("data").join("panes");
        let moved = root.join("moved-attachments");
        let _live_legacy = write_legacy_install(&legacy);
        fs::create_dir_all(&moved).expect("moved dir should exist");
        std::os::unix::fs::symlink(&moved, legacy.join("attachments"))
            .expect("attachments link should be created");
        let unreadable = legacy.join("logs").join("locked.log");
        fs::write(&unreadable, "secret").expect("locked log should be written");
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000))
            .expect("locked log permissions should change");

        let result = import_legacy_app_data_into_flatpak(&current, Some(&legacy));

        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o600))
            .expect("locked log permissions should be restored");
        result.expect("one unreadable file must not stop the import");
        assert_eq!(
            fs::read_link(current.join("attachments")).expect("link should be recreated"),
            moved
        );
        assert!(current.join("logs").join("events.log").exists());
        assert!(current.join(DATABASE_FILE_NAME).exists());
        assert!(staged_files_in(&current).is_empty());

        let _ = fs::remove_dir_all(&root);
    }
}
