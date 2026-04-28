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

pub fn app_data_dir() -> PathBuf {
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
    let current = app_data_dir();
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
        sync::{Mutex, OnceLock},
        time::{SystemTime, UNIX_EPOCH},
    };
    use uuid::Uuid;

    fn normalize_path(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
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
}
