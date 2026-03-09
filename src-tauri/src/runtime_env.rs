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
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellLaunchSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
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
    augmented_path_entries_for(home_dir().as_deref(), env::var_os("PATH").as_deref())
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
    terminal_shell_for(
        env::var("SHELL").ok().as_deref(),
        home_dir().as_deref(),
        env::var_os("PATH").as_deref(),
    )
}

pub fn terminal_shell_args(shell: &Path) -> Vec<String> {
    match shell_flavor(shell) {
        ShellFlavor::Bash
        | ShellFlavor::Fish
        | ShellFlavor::Zsh
        | ShellFlavor::Sh
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
        ShellFlavor::Sh | ShellFlavor::Other => {
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

fn augmented_path_entries_for(home: Option<&Path>, current_path: Option<&OsStr>) -> Vec<PathBuf> {
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

        #[cfg(target_os = "linux")]
        {
            entries.push(home.join(".nix-profile/bin"));
        }

        #[cfg(target_os = "macos")]
        {
            entries.push(home.join("Library/pnpm"));
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

    let augmented_entries = augmented_path_entries_for(home, current_path);

    #[cfg(target_os = "macos")]
    let fallback_shells = ["zsh", "bash", "sh"];
    #[cfg(not(target_os = "macos"))]
    let fallback_shells = ["bash", "sh", "zsh"];

    for shell in fallback_shells {
        if let Some(path) = resolve_from_entries(shell, &augmented_entries) {
            return path;
        }
    }

    #[cfg(target_os = "macos")]
    {
        return PathBuf::from("/bin/zsh");
    }
    #[cfg(not(target_os = "macos"))]
    {
        PathBuf::from("/bin/sh")
    }
}

fn command_shell_program() -> PathBuf {
    command_shell_program_for(
        env::var("SHELL").ok().as_deref(),
        home_dir().as_deref(),
        env::var_os("PATH").as_deref(),
    )
}

fn command_shell_program_for(
    shell_env: Option<&str>,
    home: Option<&Path>,
    current_path: Option<&OsStr>,
) -> PathBuf {
    let augmented_entries = augmented_path_entries_for(home, current_path);

    if let Some(shell) = shell_env
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|value| resolve_shell_candidate(value, &augmented_entries))
    {
        return shell;
    }

    for shell in ["zsh", "bash", "fish", "sh"] {
        if let Some(path) = resolve_from_entries(shell, &augmented_entries) {
            return path;
        }
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
        _ => vec!["-c".to_string(), command.to_string()],
    }
}

fn shell_flavor(path: &Path) -> ShellFlavor {
    match path.file_name().and_then(|value| value.to_str()) {
        Some("bash") => ShellFlavor::Bash,
        Some("fish") => ShellFlavor::Fish,
        Some("zsh") => ShellFlavor::Zsh,
        Some("sh") => ShellFlavor::Sh,
        _ => ShellFlavor::Other,
    }
}

#[cfg(not(target_os = "windows"))]
fn login_probe_shells_for(shell_env: Option<&str>, current_path: Option<&OsStr>) -> Vec<PathBuf> {
    let augmented_entries = augmented_path_entries_for(home_dir().as_deref(), current_path);
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

#[cfg(not(target_os = "windows"))]
fn resolve_shell_candidate(candidate: &str, entries: &[PathBuf]) -> Option<PathBuf> {
    if candidate.contains('/') {
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

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
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
        let entries = augmented_path_entries_for(Some(home), Some(current_path));

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
}
