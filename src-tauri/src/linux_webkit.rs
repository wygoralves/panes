#[cfg(any(target_os = "linux", test))]
const WAYLAND_CLIENT_PRELOAD_ENV: &str = "PANES_WAYLAND_CLIENT_PRELOAD";
#[cfg(any(target_os = "linux", test))]
const ORIGINAL_LD_PRELOAD_ENV: &str = "PANES_ORIGINAL_LD_PRELOAD";
#[cfg(target_os = "linux")]
const SYSTEM_WAYLAND_CLIENT_CANDIDATES: &[&str] = &[
    "/usr/lib64/libwayland-client.so.0",
    "/usr/lib64/libwayland-client.so",
    "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
    "/lib/x86_64-linux-gnu/libwayland-client.so.0",
    "/usr/lib/x86_64-linux-gnu/libwayland-client.so",
    "/lib/x86_64-linux-gnu/libwayland-client.so",
    "/usr/lib/aarch64-linux-gnu/libwayland-client.so.0",
    "/lib/aarch64-linux-gnu/libwayland-client.so.0",
    "/usr/lib/aarch64-linux-gnu/libwayland-client.so",
    "/lib/aarch64-linux-gnu/libwayland-client.so",
    "/usr/lib/libwayland-client.so.0",
    "/lib64/libwayland-client.so.0",
    "/lib/libwayland-client.so.0",
    "/usr/lib/libwayland-client.so",
    "/lib64/libwayland-client.so",
    "/lib/libwayland-client.so",
];

#[cfg(any(target_os = "linux", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct WebkitDisplayEnv<'a> {
    xdg_session_type: Option<&'a str>,
    wayland_display_present: bool,
    xdg_current_desktop: Option<&'a str>,
    desktop_session: Option<&'a str>,
    appimage_present: bool,
    appdir_present: bool,
    ld_preload: Option<&'a str>,
    internal_wayland_client_preload: Option<&'a str>,
    dmabuf_renderer_configured: bool,
    compositing_mode_configured: bool,
}

#[cfg(any(target_os = "linux", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct WebkitWorkaroundPlan<'a> {
    is_wayland_session: bool,
    is_cosmic_session: bool,
    relaunch_with_wayland_client_preload: Option<&'a str>,
    restore_original_ld_preload: bool,
    disable_dmabuf_renderer: bool,
    disable_compositing_mode: bool,
}

#[cfg(any(target_os = "linux", test))]
fn plan_webkit_workarounds<'a>(
    env: &WebkitDisplayEnv<'a>,
    system_wayland_client_path: Option<&'a str>,
) -> WebkitWorkaroundPlan<'a> {
    let is_wayland_session = env
        .xdg_session_type
        .is_some_and(|value| value.eq_ignore_ascii_case("wayland"))
        || env.wayland_display_present;
    let is_cosmic_session = [env.xdg_current_desktop, env.desktop_session]
        .into_iter()
        .flatten()
        .any(|value| value.to_ascii_lowercase().contains("cosmic"));
    let is_appimage_bundle = env.appimage_present || env.appdir_present;
    let already_preloaded = system_wayland_client_path.is_some_and(|path| {
        env.ld_preload
            .is_some_and(|value| value.split(':').any(|entry| entry == path))
    });

    WebkitWorkaroundPlan {
        is_wayland_session,
        is_cosmic_session,
        relaunch_with_wayland_client_preload: if env.internal_wayland_client_preload.is_some() {
            None
        } else if is_wayland_session && is_appimage_bundle && !already_preloaded {
            system_wayland_client_path
        } else {
            None
        },
        restore_original_ld_preload: env.internal_wayland_client_preload.is_some(),
        disable_dmabuf_renderer: is_wayland_session && !env.dmabuf_renderer_configured,
        disable_compositing_mode: is_wayland_session
            && is_cosmic_session
            && !env.compositing_mode_configured,
    }
}

#[cfg(target_os = "linux")]
pub fn apply_webkit_display_workarounds() {
    use std::{env, os::unix::process::CommandExt, path::Path, process::Command};

    fn find_system_wayland_client_path() -> Option<&'static str> {
        SYSTEM_WAYLAND_CLIENT_CANDIDATES
            .iter()
            .copied()
            .find(|candidate| Path::new(candidate).exists())
    }

    fn build_ld_preload_value(candidate: &str, existing: Option<&str>) -> String {
        match existing {
            Some(value)
                if !value.is_empty() && value.split(':').any(|entry| entry == candidate) =>
            {
                value.to_string()
            }
            Some(value) if !value.is_empty() => format!("{candidate}:{value}"),
            _ => candidate.to_string(),
        }
    }

    fn restore_original_ld_preload() {
        match env::var_os(ORIGINAL_LD_PRELOAD_ENV) {
            Some(value) if !value.is_empty() => env::set_var("LD_PRELOAD", value),
            _ => env::remove_var("LD_PRELOAD"),
        }
        env::remove_var(WAYLAND_CLIENT_PRELOAD_ENV);
        env::remove_var(ORIGINAL_LD_PRELOAD_ENV);
    }

    let xdg_session_type = env::var("XDG_SESSION_TYPE").ok();
    let xdg_current_desktop = env::var("XDG_CURRENT_DESKTOP").ok();
    let desktop_session = env::var("DESKTOP_SESSION").ok();
    let ld_preload = env::var("LD_PRELOAD").ok();
    let internal_wayland_client_preload = env::var(WAYLAND_CLIENT_PRELOAD_ENV).ok();
    let env_snapshot = WebkitDisplayEnv {
        xdg_session_type: xdg_session_type.as_deref(),
        wayland_display_present: env::var_os("WAYLAND_DISPLAY").is_some(),
        xdg_current_desktop: xdg_current_desktop.as_deref(),
        desktop_session: desktop_session.as_deref(),
        appimage_present: env::var_os("APPIMAGE").is_some(),
        appdir_present: env::var_os("APPDIR").is_some(),
        ld_preload: ld_preload.as_deref(),
        internal_wayland_client_preload: internal_wayland_client_preload.as_deref(),
        dmabuf_renderer_configured: env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some(),
        compositing_mode_configured: env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some(),
    };
    let plan = plan_webkit_workarounds(&env_snapshot, find_system_wayland_client_path());

    if plan.restore_original_ld_preload {
        restore_original_ld_preload();
    }

    if let Some(candidate) = plan.relaunch_with_wayland_client_preload {
        match env::current_exe() {
            Ok(current_exe) => {
                let original_ld_preload = env::var_os("LD_PRELOAD");
                let updated_ld_preload = build_ld_preload_value(
                    candidate,
                    original_ld_preload
                        .as_deref()
                        .and_then(|value| value.to_str()),
                );
                let mut command = Command::new(current_exe);
                command.args(env::args_os().skip(1));
                command.env("LD_PRELOAD", updated_ld_preload);
                command.env(WAYLAND_CLIENT_PRELOAD_ENV, candidate);
                match original_ld_preload {
                    Some(value) => {
                        command.env(ORIGINAL_LD_PRELOAD_ENV, value);
                    }
                    None => {
                        command.env_remove(ORIGINAL_LD_PRELOAD_ENV);
                    }
                }

                let error = command.exec();
                eprintln!(
                    "failed to relaunch with system libwayland-client preload ({candidate}): {error}"
                );
            }
            Err(error) => {
                eprintln!(
                    "failed to determine current executable for libwayland-client relaunch: {error}"
                );
            }
        }
    }

    if !plan.is_wayland_session {
        return;
    }

    // WebKitGTK can fail before the frontend boots on some Wayland stacks,
    // leaving a blank window with EGL display errors. Apply conservative
    // defaults unless the user already configured an override.
    if plan.disable_dmabuf_renderer {
        env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    if plan.disable_compositing_mode {
        env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    if plan.disable_dmabuf_renderer || plan.disable_compositing_mode {
        log::info!(
            "applied linux webkit display workarounds: wayland={}, cosmic={}, relaunch_with_wayland_client_preload={}, disable_dmabuf_renderer={}, disable_compositing_mode={}",
            plan.is_wayland_session,
            plan.is_cosmic_session,
            plan.relaunch_with_wayland_client_preload.is_some(),
            plan.disable_dmabuf_renderer,
            plan.disable_compositing_mode,
        );
    }
}

#[cfg(not(target_os = "linux"))]
pub fn apply_webkit_display_workarounds() {}

#[cfg(test)]
mod tests {
    use super::{
        plan_webkit_workarounds, WebkitDisplayEnv, WebkitWorkaroundPlan, ORIGINAL_LD_PRELOAD_ENV,
        WAYLAND_CLIENT_PRELOAD_ENV,
    };

    fn base_env<'a>() -> WebkitDisplayEnv<'a> {
        WebkitDisplayEnv {
            xdg_session_type: None,
            wayland_display_present: false,
            xdg_current_desktop: None,
            desktop_session: None,
            appimage_present: false,
            appdir_present: false,
            ld_preload: None,
            internal_wayland_client_preload: None,
            dmabuf_renderer_configured: false,
            compositing_mode_configured: false,
        }
    }

    #[test]
    fn skips_workarounds_outside_wayland() {
        let plan = plan_webkit_workarounds(
            &WebkitDisplayEnv {
                xdg_session_type: Some("x11"),
                wayland_display_present: false,
                xdg_current_desktop: Some("COSMIC"),
                desktop_session: Some("cosmic"),
                appimage_present: true,
                appdir_present: false,
                ld_preload: None,
                internal_wayland_client_preload: None,
                dmabuf_renderer_configured: false,
                compositing_mode_configured: false,
            },
            Some("/usr/lib64/libwayland-client.so.0"),
        );

        assert_eq!(
            plan,
            WebkitWorkaroundPlan {
                is_wayland_session: false,
                is_cosmic_session: true,
                relaunch_with_wayland_client_preload: None,
                restore_original_ld_preload: false,
                disable_dmabuf_renderer: false,
                disable_compositing_mode: false,
            }
        );
    }

    #[test]
    fn enables_dmabuf_workaround_on_wayland_sessions() {
        let plan = plan_webkit_workarounds(
            &WebkitDisplayEnv {
                xdg_session_type: Some("wayland"),
                wayland_display_present: true,
                xdg_current_desktop: Some("GNOME"),
                desktop_session: Some("gnome"),
                appimage_present: false,
                appdir_present: false,
                ld_preload: None,
                internal_wayland_client_preload: None,
                dmabuf_renderer_configured: false,
                compositing_mode_configured: false,
            },
            Some("/usr/lib64/libwayland-client.so.0"),
        );

        assert_eq!(
            plan,
            WebkitWorkaroundPlan {
                is_wayland_session: true,
                is_cosmic_session: false,
                relaunch_with_wayland_client_preload: None,
                restore_original_ld_preload: false,
                disable_dmabuf_renderer: true,
                disable_compositing_mode: false,
            }
        );
    }

    #[test]
    fn adds_compositing_workaround_for_cosmic_wayland() {
        let plan = plan_webkit_workarounds(
            &WebkitDisplayEnv {
                xdg_session_type: Some("wayland"),
                wayland_display_present: true,
                xdg_current_desktop: Some("pop:COSMIC"),
                desktop_session: Some("cosmic"),
                appimage_present: false,
                appdir_present: false,
                ld_preload: None,
                internal_wayland_client_preload: None,
                dmabuf_renderer_configured: false,
                compositing_mode_configured: false,
            },
            Some("/usr/lib64/libwayland-client.so.0"),
        );

        assert_eq!(
            plan,
            WebkitWorkaroundPlan {
                is_wayland_session: true,
                is_cosmic_session: true,
                relaunch_with_wayland_client_preload: None,
                restore_original_ld_preload: false,
                disable_dmabuf_renderer: true,
                disable_compositing_mode: true,
            }
        );
    }

    #[test]
    fn preserves_existing_user_overrides() {
        let plan = plan_webkit_workarounds(
            &WebkitDisplayEnv {
                xdg_session_type: Some("wayland"),
                wayland_display_present: true,
                xdg_current_desktop: Some("COSMIC"),
                desktop_session: Some("cosmic"),
                appimage_present: false,
                appdir_present: false,
                ld_preload: None,
                internal_wayland_client_preload: None,
                dmabuf_renderer_configured: true,
                compositing_mode_configured: true,
            },
            Some("/usr/lib64/libwayland-client.so.0"),
        );

        assert_eq!(
            plan,
            WebkitWorkaroundPlan {
                is_wayland_session: true,
                is_cosmic_session: true,
                relaunch_with_wayland_client_preload: None,
                restore_original_ld_preload: false,
                disable_dmabuf_renderer: false,
                disable_compositing_mode: false,
            }
        );
    }

    #[test]
    fn relaunches_appimage_wayland_sessions_with_system_wayland_client() {
        let mut env = base_env();
        env.xdg_session_type = Some("wayland");
        env.wayland_display_present = true;
        env.appimage_present = true;

        let plan = plan_webkit_workarounds(&env, Some("/usr/lib64/libwayland-client.so.0"));

        assert_eq!(
            plan.relaunch_with_wayland_client_preload,
            Some("/usr/lib64/libwayland-client.so.0")
        );
        assert!(!plan.restore_original_ld_preload);
    }

    #[test]
    fn skips_relaunch_when_wayland_client_is_already_preloaded() {
        let mut env = base_env();
        env.xdg_session_type = Some("wayland");
        env.wayland_display_present = true;
        env.appimage_present = true;
        env.ld_preload = Some("/usr/lib64/libwayland-client.so.0:/tmp/other.so");

        let plan = plan_webkit_workarounds(&env, Some("/usr/lib64/libwayland-client.so.0"));

        assert_eq!(plan.relaunch_with_wayland_client_preload, None);
    }

    #[test]
    fn restores_original_ld_preload_after_internal_relaunch() {
        let mut env = base_env();
        env.xdg_session_type = Some("wayland");
        env.wayland_display_present = true;
        env.appimage_present = true;
        env.internal_wayland_client_preload = Some("/usr/lib64/libwayland-client.so.0");

        let plan = plan_webkit_workarounds(&env, Some("/usr/lib64/libwayland-client.so.0"));

        assert_eq!(plan.relaunch_with_wayland_client_preload, None);
        assert!(plan.restore_original_ld_preload);
    }

    #[test]
    fn helper_env_var_names_are_stable() {
        assert_eq!(WAYLAND_CLIENT_PRELOAD_ENV, "PANES_WAYLAND_CLIENT_PRELOAD");
        assert_eq!(ORIGINAL_LD_PRELOAD_ENV, "PANES_ORIGINAL_LD_PRELOAD");
    }
}
