use std::{
    env,
    ffi::{OsStr, OsString},
    fs,
    path::{Path, PathBuf},
};

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
pub fn login_probe_shells() -> Vec<PathBuf> {
    login_probe_shells_for(
        env::var("SHELL").ok().as_deref(),
        env::var_os("PATH").as_deref(),
    )
}

#[cfg(target_os = "windows")]
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
pub fn parse_login_probe_output(stdout: &str) -> Option<(String, String)> {
    let mut lines = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let path = lines.find(|line| line.starts_with('/'))?.to_string();
    let version = lines.next().unwrap_or("").to_string();
    Some((path, version))
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
            entries.push(local_app_data.join("Volta/bin"));
            entries.push(local_app_data.join("pnpm"));
            entries.push(local_app_data.join("fnm"));
        }
        if let Some(roaming_app_data) = roaming_app_data {
            entries.push(roaming_app_data.join("npm"));
            entries.push(roaming_app_data.join("pnpm"));
        }
    }

    dedupe_paths(entries)
}

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
        return PathBuf::from("cmd.exe");
    }

    PathBuf::from("/bin/sh")
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
    use std::time::{SystemTime, UNIX_EPOCH};
    use uuid::Uuid;

    fn normalize_path(path: &Path) -> String {
        path.to_string_lossy().replace('\\', "/")
    }

    #[test]
    fn terminal_shell_args_match_shell_type() {
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
