use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::Context;

#[cfg(target_os = "linux")]
const APPIMAGE_DISABLE_ENV: &str = "PANES_DISABLE_APPIMAGE_INTEGRATION";
#[cfg(target_os = "linux")]
const APPIMAGE_ENV: &str = "APPIMAGE";
const APP_ID: &str = "com.panes.app";
const APP_NAME: &str = "Panes";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const DESKTOP_FILE_NAME: &str = "com.panes.app.desktop";
const DESKTOP_ENTRY_MARKER: &str = "# Managed by Panes AppImage integration";
#[cfg(target_os = "linux")]
const DEFAULT_XDG_DATA_DIRS: &str = "/usr/local/share:/usr/share";

const ICON_ASSETS: &[(u32, &[u8])] = &[
    (32, include_bytes!("../icons/32x32.png")),
    (64, include_bytes!("../icons/64x64.png")),
    (128, include_bytes!("../icons/128x128.png")),
    (256, include_bytes!("../icons/128x128@2x.png")),
    (512, include_bytes!("../icons/icon.png")),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppImageIntegrationStatus {
    SkippedDisabled,
    SkippedNotAppImage,
    SkippedUnmanagedLocalEntry,
    SkippedSystemInstall,
    Updated,
    Unchanged,
}

#[derive(Debug, Clone)]
struct AppImageIntegrationEnv {
    appimage_path: Option<PathBuf>,
    home_dir: Option<PathBuf>,
    xdg_data_home: Option<PathBuf>,
    xdg_data_dirs: Vec<PathBuf>,
    disabled: bool,
}

impl AppImageIntegrationEnv {
    #[cfg(target_os = "linux")]
    fn from_process_env() -> Self {
        let xdg_data_dirs = env::var("XDG_DATA_DIRS")
            .unwrap_or_else(|_| DEFAULT_XDG_DATA_DIRS.to_string())
            .split(':')
            .filter(|entry| !entry.trim().is_empty())
            .map(PathBuf::from)
            .collect();

        Self {
            appimage_path: env::var_os(APPIMAGE_ENV).map(PathBuf::from),
            home_dir: env::var_os("HOME").map(PathBuf::from),
            xdg_data_home: env::var_os("XDG_DATA_HOME").map(PathBuf::from),
            xdg_data_dirs,
            disabled: env::var_os(APPIMAGE_DISABLE_ENV).is_some(),
        }
    }

    fn data_home(&self) -> Option<PathBuf> {
        self.xdg_data_home.clone().or_else(|| {
            self.home_dir
                .as_ref()
                .map(|home| home.join(".local").join("share"))
        })
    }

    fn appimage_path(&self) -> Option<&Path> {
        self.appimage_path
            .as_deref()
            .filter(|path| path.is_file())
            .or_else(|| self.appimage_path.as_deref().filter(|path| path.exists()))
    }

    fn desktop_entry_path(&self) -> Option<PathBuf> {
        self.data_home()
            .map(|data_home| data_home.join("applications").join(DESKTOP_FILE_NAME))
    }

    fn icon_theme_root(&self) -> Option<PathBuf> {
        self.data_home()
            .map(|data_home| data_home.join("icons").join("hicolor"))
    }
}

#[cfg(target_os = "linux")]
pub fn ensure_appimage_desktop_integration() -> anyhow::Result<AppImageIntegrationStatus> {
    ensure_appimage_desktop_integration_with_env(&AppImageIntegrationEnv::from_process_env())
}

fn ensure_appimage_desktop_integration_with_env(
    integration_env: &AppImageIntegrationEnv,
) -> anyhow::Result<AppImageIntegrationStatus> {
    if integration_env.disabled {
        return Ok(AppImageIntegrationStatus::SkippedDisabled);
    }

    let appimage_path = match integration_env.appimage_path() {
        Some(path) => path,
        None => return Ok(AppImageIntegrationStatus::SkippedNotAppImage),
    };
    let desktop_entry_path = integration_env
        .desktop_entry_path()
        .context("failed to resolve XDG desktop-entry path")?;

    if desktop_entry_path.exists() && !is_managed_entry(&desktop_entry_path)? {
        return Ok(AppImageIntegrationStatus::SkippedUnmanagedLocalEntry);
    }

    if system_install_conflicts(integration_env)? {
        let mut changed = remove_managed_desktop_entry(&desktop_entry_path)?;
        changed |= remove_managed_icons(integration_env)?;
        if changed {
            refresh_linux_desktop_metadata(integration_env)?;
        }
        return Ok(AppImageIntegrationStatus::SkippedSystemInstall);
    }

    let mut changed = false;
    changed |= install_icons(integration_env)?;
    changed |= write_if_changed(
        &desktop_entry_path,
        build_desktop_entry(appimage_path).as_bytes(),
    )?;

    if changed {
        refresh_linux_desktop_metadata(integration_env)?;
        Ok(AppImageIntegrationStatus::Updated)
    } else {
        Ok(AppImageIntegrationStatus::Unchanged)
    }
}

fn build_desktop_entry(appimage_path: &Path) -> String {
    let escaped_exec = escape_desktop_exec_arg(appimage_path);
    let escaped_try_exec = escape_desktop_string(&appimage_path.to_string_lossy());
    format!(
        "{DESKTOP_ENTRY_MARKER}\n[Desktop Entry]\nType=Application\nName={APP_NAME}\nExec={escaped_exec} %U\nTryExec={escaped_try_exec}\nIcon={APP_ID}\nTerminal=false\nCategories=Development;\nStartupNotify=true\nX-AppImage-Version={APP_VERSION}\nX-Panes-Managed=true\n"
    )
}

fn escape_desktop_exec_arg(path: &Path) -> String {
    let mut escaped = String::from("\"");
    for ch in path.to_string_lossy().chars() {
        match ch {
            '"' | '\\' | '$' | '`' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            '%' => escaped.push_str("%%"),
            _ => escaped.push(ch),
        }
    }
    escaped.push('"');
    escaped
}

fn escape_desktop_string(value: &str) -> String {
    let mut escaped = String::new();
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            _ => escaped.push(ch),
        }
    }
    escaped
}

fn install_icons(integration_env: &AppImageIntegrationEnv) -> anyhow::Result<bool> {
    let icon_theme_root = integration_env
        .icon_theme_root()
        .context("failed to resolve XDG icon theme path")?;
    let mut changed = false;

    for (size, bytes) in ICON_ASSETS {
        let icon_path = icon_theme_root
            .join(format!("{size}x{size}"))
            .join("apps")
            .join(format!("{APP_ID}.png"));
        changed |= write_if_changed(&icon_path, bytes)?;
    }

    Ok(changed)
}

fn remove_managed_icons(integration_env: &AppImageIntegrationEnv) -> anyhow::Result<bool> {
    let icon_theme_root = integration_env
        .icon_theme_root()
        .context("failed to resolve XDG icon theme path")?;
    let mut changed = false;

    for (size, bytes) in ICON_ASSETS {
        let icon_path = icon_theme_root
            .join(format!("{size}x{size}"))
            .join("apps")
            .join(format!("{APP_ID}.png"));
        changed |= remove_file_if_matches(&icon_path, bytes)?;
    }

    Ok(changed)
}

fn system_install_conflicts(integration_env: &AppImageIntegrationEnv) -> anyhow::Result<bool> {
    let Some(data_home) = integration_env.data_home() else {
        return Ok(false);
    };
    for data_dir in &integration_env.xdg_data_dirs {
        if data_dir == &data_home {
            continue;
        }
        let candidate = data_dir.join("applications").join(DESKTOP_FILE_NAME);
        if candidate.exists() && desktop_entry_targets_installed_binary(&candidate)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn desktop_entry_targets_installed_binary(path: &Path) -> anyhow::Result<bool> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("failed to read desktop entry {}", path.display()))?;

    if let Some(try_exec) = desktop_entry_key(&raw, "TryExec") {
        let try_exec = try_exec.trim();
        if !try_exec.is_empty() && desktop_command_exists(try_exec) {
            return Ok(true);
        }
    }

    let Some(exec) = desktop_entry_key(&raw, "Exec") else {
        return Ok(false);
    };
    let Some(command) = parse_desktop_exec_command(&exec) else {
        return Ok(false);
    };

    Ok(desktop_command_exists(&command))
}

fn desktop_entry_key(raw: &str, key: &str) -> Option<String> {
    let mut in_desktop_entry = false;
    let prefix = format!("{key}=");

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            in_desktop_entry = trimmed == "[Desktop Entry]";
            continue;
        }

        if in_desktop_entry {
            if let Some(value) = trimmed.strip_prefix(&prefix) {
                return Some(value.to_string());
            }
        }
    }

    None
}

fn parse_desktop_exec_command(value: &str) -> Option<String> {
    let mut chars = value.chars().peekable();
    while matches!(chars.peek(), Some(ch) if ch.is_whitespace()) {
        chars.next();
    }

    let mut command = String::new();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        match ch {
            '"' => in_quotes = !in_quotes,
            '\\' => {
                let escaped = chars.next()?;
                command.push(escaped);
            }
            '%' => {
                if matches!(chars.peek(), Some('%')) {
                    chars.next();
                    command.push('%');
                } else if command.is_empty() {
                    return None;
                } else {
                    break;
                }
            }
            _ if !in_quotes && ch.is_whitespace() => break,
            _ => command.push(ch),
        }
    }

    if in_quotes || command.is_empty() {
        return None;
    }

    Some(command)
}

fn desktop_command_exists(command: &str) -> bool {
    which::which(command).is_ok()
}

fn remove_managed_desktop_entry(desktop_entry_path: &Path) -> anyhow::Result<bool> {
    if !desktop_entry_path.exists() || !is_managed_entry(desktop_entry_path)? {
        return Ok(false);
    }

    fs::remove_file(desktop_entry_path).with_context(|| {
        format!(
            "failed to remove managed desktop entry {}",
            desktop_entry_path.display()
        )
    })?;
    Ok(true)
}

fn is_managed_entry(path: &Path) -> anyhow::Result<bool> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("failed to read desktop entry {}", path.display()))?;
    Ok(raw.contains(DESKTOP_ENTRY_MARKER) || raw.contains("X-Panes-Managed=true"))
}

fn write_if_changed(path: &Path, bytes: &[u8]) -> anyhow::Result<bool> {
    if let Ok(existing) = fs::read(path) {
        if existing == bytes {
            return Ok(false);
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }
    fs::write(path, bytes).with_context(|| format!("failed to write {}", path.display()))?;
    Ok(true)
}

fn remove_file_if_matches(path: &Path, expected_bytes: &[u8]) -> anyhow::Result<bool> {
    let Ok(existing) = fs::read(path) else {
        return Ok(false);
    };
    if existing != expected_bytes {
        return Ok(false);
    }

    fs::remove_file(path).with_context(|| format!("failed to remove {}", path.display()))?;
    Ok(true)
}

fn refresh_linux_desktop_metadata(integration_env: &AppImageIntegrationEnv) -> anyhow::Result<()> {
    let applications_dir = integration_env
        .desktop_entry_path()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .context("failed to resolve desktop applications directory")?;
    let icon_theme_root = integration_env
        .icon_theme_root()
        .context("failed to resolve icon theme directory")?;

    run_optional_command("update-desktop-database", &[applications_dir.as_os_str()]);
    run_optional_command(
        "gtk-update-icon-cache",
        &[
            std::ffi::OsStr::new("-f"),
            std::ffi::OsStr::new("-t"),
            icon_theme_root.as_os_str(),
        ],
    );

    Ok(())
}

fn run_optional_command(command_name: &str, args: &[&std::ffi::OsStr]) {
    let Ok(command_path) = which::which(command_name) else {
        return;
    };

    match Command::new(command_path).args(args).status() {
        Ok(status) if status.success() => {}
        Ok(status) => {
            log::debug!("{command_name} exited with status {status}");
        }
        Err(error) => {
            log::debug!("failed to run {command_name}: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        desktop_entry_targets_installed_binary, ensure_appimage_desktop_integration_with_env,
        escape_desktop_exec_arg, AppImageIntegrationEnv, AppImageIntegrationStatus, APP_ID,
        DESKTOP_ENTRY_MARKER, DESKTOP_FILE_NAME,
    };
    use std::{env, fs, path::PathBuf};
    use uuid::Uuid;

    struct TestPaths {
        root: PathBuf,
        home: PathBuf,
        data_home: PathBuf,
        system_data_home: PathBuf,
    }

    impl TestPaths {
        fn new() -> Self {
            let root =
                env::temp_dir().join(format!("panes-appimage-integration-{}", Uuid::new_v4()));
            let home = root.join("home");
            let data_home = root.join("xdg-data");
            let system_data_home = root.join("system-data");

            fs::create_dir_all(&home).expect("test home should exist");
            fs::create_dir_all(&data_home).expect("xdg data home should exist");
            fs::create_dir_all(&system_data_home).expect("system data home should exist");

            Self {
                root,
                home,
                data_home,
                system_data_home,
            }
        }

        fn appimage_path(&self, name: &str) -> PathBuf {
            let path = self.root.join(name);
            fs::write(&path, b"appimage").expect("dummy appimage should exist");
            path
        }

        fn managed_desktop_entry(&self) -> PathBuf {
            self.data_home.join("applications").join(DESKTOP_FILE_NAME)
        }

        fn icon_path(&self, size: u32) -> PathBuf {
            self.data_home
                .join("icons")
                .join("hicolor")
                .join(format!("{size}x{size}"))
                .join("apps")
                .join(format!("{APP_ID}.png"))
        }
    }

    impl Drop for TestPaths {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn integration_env(
        paths: &TestPaths,
        appimage_path: Option<PathBuf>,
    ) -> AppImageIntegrationEnv {
        AppImageIntegrationEnv {
            appimage_path,
            home_dir: Some(paths.home.clone()),
            xdg_data_home: Some(paths.data_home.clone()),
            xdg_data_dirs: vec![paths.system_data_home.clone()],
            disabled: false,
        }
    }

    #[test]
    fn skips_when_not_running_as_appimage() {
        let paths = TestPaths::new();
        let status = ensure_appimage_desktop_integration_with_env(&integration_env(&paths, None))
            .expect("integration should not error");

        assert_eq!(status, AppImageIntegrationStatus::SkippedNotAppImage);
        assert!(!paths.managed_desktop_entry().exists());
    }

    #[test]
    fn skips_when_disabled() {
        let paths = TestPaths::new();
        let mut env = integration_env(&paths, Some(paths.appimage_path("Panes.AppImage")));
        env.disabled = true;

        let status = ensure_appimage_desktop_integration_with_env(&env)
            .expect("disabled integration should not error");

        assert_eq!(status, AppImageIntegrationStatus::SkippedDisabled);
        assert!(!paths.managed_desktop_entry().exists());
    }

    #[test]
    fn writes_managed_desktop_entry_and_icons() {
        let paths = TestPaths::new();
        let appimage_path = paths.appimage_path("Panes Beta.AppImage");

        let status = ensure_appimage_desktop_integration_with_env(&integration_env(
            &paths,
            Some(appimage_path.clone()),
        ))
        .expect("integration should succeed");

        assert_eq!(status, AppImageIntegrationStatus::Updated);

        let desktop_entry = fs::read_to_string(paths.managed_desktop_entry())
            .expect("desktop entry should be written");
        assert!(desktop_entry.contains(DESKTOP_ENTRY_MARKER));
        assert!(desktop_entry.contains("X-Panes-Managed=true"));
        assert!(desktop_entry.contains(&format!("Icon={APP_ID}")));
        assert!(desktop_entry.contains(&format!(
            "Exec={} %U",
            escape_desktop_exec_arg(&appimage_path)
        )));
        assert!(desktop_entry.contains(&format!("TryExec={}", appimage_path.to_string_lossy())));
        assert!(!desktop_entry.contains("StartupWMClass="));

        for size in [32_u32, 64, 128, 256, 512] {
            let icon_path = paths.icon_path(size);
            assert!(icon_path.exists(), "icon for size {size} should exist");
        }
    }

    #[test]
    fn second_run_is_unchanged() {
        let paths = TestPaths::new();
        let env = integration_env(&paths, Some(paths.appimage_path("Panes.AppImage")));

        let first = ensure_appimage_desktop_integration_with_env(&env)
            .expect("initial integration should succeed");
        let second = ensure_appimage_desktop_integration_with_env(&env)
            .expect("repeat integration should succeed");

        assert_eq!(first, AppImageIntegrationStatus::Updated);
        assert_eq!(second, AppImageIntegrationStatus::Unchanged);
    }

    #[test]
    fn rewrites_desktop_entry_when_appimage_path_changes() {
        let paths = TestPaths::new();
        let first_env = integration_env(&paths, Some(paths.appimage_path("Panes One.AppImage")));
        let second_path = paths.appimage_path("Panes Two.AppImage");

        ensure_appimage_desktop_integration_with_env(&first_env)
            .expect("initial integration should succeed");
        let second = ensure_appimage_desktop_integration_with_env(&integration_env(
            &paths,
            Some(second_path.clone()),
        ))
        .expect("re-integration should succeed");

        assert_eq!(second, AppImageIntegrationStatus::Updated);

        let desktop_entry = fs::read_to_string(paths.managed_desktop_entry())
            .expect("desktop entry should be readable");
        assert!(desktop_entry.contains(&escape_desktop_exec_arg(&second_path)));
        assert!(!desktop_entry.contains("Panes One.AppImage\" %U\nTryExec=Panes One.AppImage"));
    }

    #[test]
    fn removes_managed_local_entry_when_system_install_exists() {
        let paths = TestPaths::new();
        let env = integration_env(&paths, Some(paths.appimage_path("Panes.AppImage")));

        ensure_appimage_desktop_integration_with_env(&env)
            .expect("initial integration should succeed");

        let system_entry = paths
            .system_data_home
            .join("applications")
            .join(DESKTOP_FILE_NAME);
        fs::create_dir_all(
            system_entry
                .parent()
                .expect("system entry should have parent"),
        )
        .expect("system applications dir should exist");
        fs::write(
            &system_entry,
            "[Desktop Entry]\nName=Panes\nTryExec=/bin/sh\nExec=/bin/sh -c true\n",
        )
        .expect("system desktop entry should be written");

        let status = ensure_appimage_desktop_integration_with_env(&env)
            .expect("conflict detection should succeed");

        assert_eq!(status, AppImageIntegrationStatus::SkippedSystemInstall);
        assert!(!paths.managed_desktop_entry().exists());
        for size in [32_u32, 64, 128, 256, 512] {
            assert!(
                !paths.icon_path(size).exists(),
                "managed icon for size {size} should be removed"
            );
        }
    }

    #[test]
    fn preserves_unmanaged_local_entry_and_icons() {
        let paths = TestPaths::new();
        let env = integration_env(&paths, Some(paths.appimage_path("Panes.AppImage")));

        ensure_appimage_desktop_integration_with_env(&env)
            .expect("initial integration should succeed");

        fs::write(
            paths.managed_desktop_entry(),
            "[Desktop Entry]\nName=Panes Custom\nIcon=custom-panes\n",
        )
        .expect("unmanaged local entry should be written");

        let status = ensure_appimage_desktop_integration_with_env(&env)
            .expect("unmanaged local entry should be preserved");

        assert_eq!(
            status,
            AppImageIntegrationStatus::SkippedUnmanagedLocalEntry
        );
        let desktop_entry = fs::read_to_string(paths.managed_desktop_entry())
            .expect("local desktop entry should still exist");
        assert!(desktop_entry.contains("Name=Panes Custom"));
        assert!(!desktop_entry.contains(DESKTOP_ENTRY_MARKER));
        for size in [32_u32, 64, 128, 256, 512] {
            assert!(
                paths.icon_path(size).exists(),
                "managed icon for size {size} should be preserved"
            );
        }
    }

    #[test]
    fn escapes_exec_path_with_spaces_and_percent_signs() {
        let paths = TestPaths::new();
        let appimage_path = paths.appimage_path("Panes 100%.AppImage");

        ensure_appimage_desktop_integration_with_env(&integration_env(
            &paths,
            Some(appimage_path.clone()),
        ))
        .expect("integration should succeed");

        let desktop_entry = fs::read_to_string(paths.managed_desktop_entry())
            .expect("desktop entry should be readable");
        assert!(desktop_entry.contains(&format!(
            "Exec=\"{}\" %U",
            appimage_path.to_string_lossy().replace('%', "%%")
        )));
        assert!(desktop_entry.contains(&format!("TryExec={}", appimage_path.to_string_lossy())));
    }

    #[test]
    fn ignores_broken_system_desktop_entry() {
        let paths = TestPaths::new();
        let env = integration_env(&paths, Some(paths.appimage_path("Panes.AppImage")));

        ensure_appimage_desktop_integration_with_env(&env)
            .expect("initial integration should succeed");

        let system_entry = paths
            .system_data_home
            .join("applications")
            .join(DESKTOP_FILE_NAME);
        fs::create_dir_all(
            system_entry
                .parent()
                .expect("system entry should have parent"),
        )
        .expect("system applications dir should exist");
        fs::write(
            &system_entry,
            "[Desktop Entry]\nName=Panes\nExec=/definitely/missing/panes %U\n",
        )
        .expect("broken system desktop entry should be written");

        let status = ensure_appimage_desktop_integration_with_env(&env)
            .expect("broken system entry should be ignored");

        assert_eq!(status, AppImageIntegrationStatus::Unchanged);
        assert!(paths.managed_desktop_entry().exists());
        assert!(!desktop_entry_targets_installed_binary(&system_entry)
            .expect("system desktop entry should be readable"));
    }
}
