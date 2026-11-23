#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
pub fn configure_std_command(command: &mut std::process::Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
pub fn configure_std_command(command: &mut std::process::Command) {
    for change in child_env_changes() {
        match change {
            ChildEnvChange::Remove(key) => {
                command.env_remove(key);
            }
            ChildEnvChange::Set(key, value) => {
                command.env(key, value);
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub fn configure_tokio_command(command: &mut tokio::process::Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
pub fn configure_tokio_command(command: &mut tokio::process::Command) {
    for change in child_env_changes() {
        match change {
            ChildEnvChange::Remove(key) => {
                command.env_remove(key);
            }
            ChildEnvChange::Set(key, value) => {
                command.env(key, value);
            }
        }
    }
}

/// An environment edit for a child process. Only Linux plans any, so the
/// variants are unused elsewhere.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChildEnvChange {
    Remove(&'static str),
    Set(&'static str, std::ffi::OsString),
}

/// AppImage runtime variables that only describe the mounted image.
#[cfg(any(target_os = "linux", test))]
const APPIMAGE_RUNTIME_ENV_VARS: &[&str] = &["APPDIR", "APPIMAGE", "ARGV0", "OWD"];

/// GTK and GLib variables the AppImage GTK hook points into `$APPDIR`. They
/// are dropped from a child only when they still point there.
#[cfg(any(target_os = "linux", test))]
const APPIMAGE_SINGLE_PATH_ENV_VARS: &[&str] = &[
    "GTK_DATA_PREFIX",
    "GTK_EXE_PREFIX",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "GIO_MODULE_DIR",
];

/// Search-path variables the hook prepends `$APPDIR` entries to; only those
/// entries are removed.
#[cfg(any(target_os = "linux", test))]
const APPIMAGE_PATH_LIST_ENV_VARS: &[&str] = &[
    "XDG_DATA_DIRS",
    "GTK_PATH",
    "GI_TYPELIB_PATH",
    "GSETTINGS_SCHEMA_DIR",
    "GIO_EXTRA_MODULES",
];

/// Environment edits that keep Panes' own runtime workarounds (the AppImage
/// GTK hook's variables and the WebKit workarounds Panes set on itself) out
/// of terminal shells, agents and every other child process, where they
/// would make host GTK programs load the AppImage's modules.
#[cfg(target_os = "linux")]
pub fn child_env_changes() -> Vec<ChildEnvChange> {
    plan_child_env_changes(
        |key| std::env::var_os(key),
        &crate::linux_webkit::webkit_env_vars_set_by_panes(),
    )
}

#[cfg(not(target_os = "linux"))]
pub fn child_env_changes() -> Vec<ChildEnvChange> {
    Vec::new()
}

#[cfg(any(target_os = "linux", test))]
fn plan_child_env_changes(
    lookup: impl Fn(&str) -> Option<std::ffi::OsString>,
    panes_set_vars: &[&'static str],
) -> Vec<ChildEnvChange> {
    use std::path::Path;

    let mut changes: Vec<ChildEnvChange> = panes_set_vars
        .iter()
        .map(|key| ChildEnvChange::Remove(*key))
        .collect();

    let Some(appdir) = lookup("APPDIR").filter(|value| !value.is_empty()) else {
        return changes;
    };
    let appdir = Path::new(&appdir);
    let in_appdir = |value: &std::ffi::OsStr| Path::new(value).starts_with(appdir);

    changes.extend(
        APPIMAGE_RUNTIME_ENV_VARS
            .iter()
            .filter(|key| lookup(key).is_some())
            .map(|key| ChildEnvChange::Remove(*key)),
    );

    for key in APPIMAGE_SINGLE_PATH_ENV_VARS {
        if lookup(key).is_some_and(|value| in_appdir(&value)) {
            changes.push(ChildEnvChange::Remove(*key));
        }
    }

    for key in APPIMAGE_PATH_LIST_ENV_VARS {
        let Some(value) = lookup(key) else {
            continue;
        };
        let entries: Vec<_> = std::env::split_paths(&value).collect();
        let kept: Vec<_> = entries
            .iter()
            .filter(|entry| !entry.as_os_str().is_empty() && !entry.starts_with(appdir))
            .cloned()
            .collect();
        if kept.len() == entries.len() {
            continue;
        }
        match std::env::join_paths(&kept) {
            Ok(joined) if !kept.is_empty() => changes.push(ChildEnvChange::Set(*key, joined)),
            _ => changes.push(ChildEnvChange::Remove(*key)),
        }
    }

    // The hook always overwrites GTK_THEME (with Adwaita, or with
    // APPIMAGE_GTK_THEME) because custom themes break inside the image. Host
    // programs should follow the user's own theme instead.
    if lookup("GTK_THEME").is_some() {
        changes.push(ChildEnvChange::Remove("GTK_THEME"));
    }

    changes
}

/// Serializes tests that mutate process-global environment variables (PATH,
/// HOME, ...) against tests that spawn subprocesses. env mutation is
/// process-wide, so a parallel test spawning `git` while another test points
/// PATH at an empty temp dir fails with ENOENT.
#[cfg(test)]
pub(crate) fn test_env_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

#[cfg(test)]
mod tests {
    use super::{plan_child_env_changes, ChildEnvChange};
    use std::{collections::HashMap, ffi::OsString};

    fn lookup_from(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<OsString> {
        let vars: HashMap<String, OsString> = vars
            .iter()
            .map(|(key, value)| (key.to_string(), OsString::from(value)))
            .collect();
        move |key| vars.get(key).cloned()
    }

    #[test]
    fn outside_an_appimage_only_panes_webkit_vars_are_dropped() {
        let lookup = lookup_from(&[
            ("XDG_DATA_DIRS", "/usr/local/share:/usr/share"),
            ("GTK_THEME", "Adwaita:dark"),
            ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
        ]);

        assert_eq!(
            plan_child_env_changes(&lookup, &["WEBKIT_DISABLE_DMABUF_RENDERER"]),
            vec![ChildEnvChange::Remove("WEBKIT_DISABLE_DMABUF_RENDERER")]
        );
        assert!(plan_child_env_changes(&lookup, &[]).is_empty());
    }

    // The fixture's path lists use the Unix separator.
    #[cfg(unix)]
    #[test]
    fn appimage_gtk_hook_vars_are_dropped_from_children() {
        let lookup = lookup_from(&[
            ("APPDIR", "/tmp/.mount_PanesX"),
            ("APPIMAGE", "/home/panes/Panes.AppImage"),
            ("GTK_DATA_PREFIX", "/tmp/.mount_PanesX"),
            (
                "GDK_PIXBUF_MODULE_FILE",
                "/tmp/.mount_PanesX/usr/lib/gdk-pixbuf-2.0/loaders.cache",
            ),
            ("GTK_IM_MODULE_FILE", "/home/panes/.cache/immodules.cache"),
            (
                "XDG_DATA_DIRS",
                "/tmp/.mount_PanesX/usr/share:/usr/share:/usr/local/share",
            ),
            (
                "GI_TYPELIB_PATH",
                "/tmp/.mount_PanesX/usr/lib/girepository-1.0",
            ),
            ("GTK_THEME", "Adwaita:light"),
        ]);

        let changes = plan_child_env_changes(&lookup, &[]);

        assert!(changes.contains(&ChildEnvChange::Remove("APPDIR")));
        assert!(changes.contains(&ChildEnvChange::Remove("APPIMAGE")));
        assert!(changes.contains(&ChildEnvChange::Remove("GTK_DATA_PREFIX")));
        assert!(changes.contains(&ChildEnvChange::Remove("GDK_PIXBUF_MODULE_FILE")));
        assert!(changes.contains(&ChildEnvChange::Remove("GI_TYPELIB_PATH")));
        assert!(changes.contains(&ChildEnvChange::Remove("GTK_THEME")));
        assert!(changes.contains(&ChildEnvChange::Set(
            "XDG_DATA_DIRS",
            OsString::from("/usr/share:/usr/local/share")
        )));
        // A value the user set outside the image is left alone.
        assert!(!changes
            .iter()
            .any(|change| matches!(change, ChildEnvChange::Remove("GTK_IM_MODULE_FILE"))));
    }

    #[test]
    fn appimage_only_gtk_theme_is_dropped_from_children() {
        let lookup = lookup_from(&[
            ("APPDIR", "/tmp/.mount_PanesX"),
            ("APPIMAGE_GTK_THEME", "Yaru"),
            ("GTK_THEME", "Yaru"),
        ]);

        assert_eq!(
            plan_child_env_changes(&lookup, &[]),
            vec![
                ChildEnvChange::Remove("APPDIR"),
                ChildEnvChange::Remove("GTK_THEME")
            ]
        );
    }
}
