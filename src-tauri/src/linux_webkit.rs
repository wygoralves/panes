#[cfg(any(target_os = "linux", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct WebkitDisplayEnv<'a> {
    xdg_session_type: Option<&'a str>,
    wayland_display_present: bool,
    xdg_current_desktop: Option<&'a str>,
    desktop_session: Option<&'a str>,
    dmabuf_renderer_configured: bool,
    compositing_mode_configured: bool,
}

#[cfg(any(target_os = "linux", test))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct WebkitWorkaroundPlan {
    is_wayland_session: bool,
    is_cosmic_session: bool,
    disable_dmabuf_renderer: bool,
    disable_compositing_mode: bool,
}

#[cfg(any(target_os = "linux", test))]
fn plan_webkit_workarounds(env: &WebkitDisplayEnv<'_>) -> WebkitWorkaroundPlan {
    let is_wayland_session = env
        .xdg_session_type
        .is_some_and(|value| value.eq_ignore_ascii_case("wayland"))
        || env.wayland_display_present;
    let is_cosmic_session = [env.xdg_current_desktop, env.desktop_session]
        .into_iter()
        .flatten()
        .any(|value| value.to_ascii_lowercase().contains("cosmic"));

    WebkitWorkaroundPlan {
        is_wayland_session,
        is_cosmic_session,
        disable_dmabuf_renderer: is_wayland_session && !env.dmabuf_renderer_configured,
        disable_compositing_mode: is_wayland_session
            && is_cosmic_session
            && !env.compositing_mode_configured,
    }
}

#[cfg(target_os = "linux")]
pub fn apply_webkit_display_workarounds() {
    use std::env;

    let env_snapshot = WebkitDisplayEnv {
        xdg_session_type: env::var("XDG_SESSION_TYPE").ok().as_deref(),
        wayland_display_present: env::var_os("WAYLAND_DISPLAY").is_some(),
        xdg_current_desktop: env::var("XDG_CURRENT_DESKTOP").ok().as_deref(),
        desktop_session: env::var("DESKTOP_SESSION").ok().as_deref(),
        dmabuf_renderer_configured: env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some(),
        compositing_mode_configured: env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_some(),
    };
    let plan = plan_webkit_workarounds(&env_snapshot);

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
            "applied linux webkit display workarounds: wayland={}, cosmic={}, disable_dmabuf_renderer={}, disable_compositing_mode={}",
            plan.is_wayland_session,
            plan.is_cosmic_session,
            plan.disable_dmabuf_renderer,
            plan.disable_compositing_mode,
        );
    }
}

#[cfg(not(target_os = "linux"))]
pub fn apply_webkit_display_workarounds() {}

#[cfg(test)]
mod tests {
    use super::{plan_webkit_workarounds, WebkitDisplayEnv, WebkitWorkaroundPlan};

    #[test]
    fn skips_workarounds_outside_wayland() {
        let plan = plan_webkit_workarounds(&WebkitDisplayEnv {
            xdg_session_type: Some("x11"),
            wayland_display_present: false,
            xdg_current_desktop: Some("COSMIC"),
            desktop_session: Some("cosmic"),
            dmabuf_renderer_configured: false,
            compositing_mode_configured: false,
        });

        assert_eq!(
            plan,
            WebkitWorkaroundPlan {
                is_wayland_session: false,
                is_cosmic_session: true,
                disable_dmabuf_renderer: false,
                disable_compositing_mode: false,
            }
        );
    }

    #[test]
    fn enables_dmabuf_workaround_on_wayland_sessions() {
        let plan = plan_webkit_workarounds(&WebkitDisplayEnv {
            xdg_session_type: Some("wayland"),
            wayland_display_present: true,
            xdg_current_desktop: Some("GNOME"),
            desktop_session: Some("gnome"),
            dmabuf_renderer_configured: false,
            compositing_mode_configured: false,
        });

        assert_eq!(
            plan,
            WebkitWorkaroundPlan {
                is_wayland_session: true,
                is_cosmic_session: false,
                disable_dmabuf_renderer: true,
                disable_compositing_mode: false,
            }
        );
    }

    #[test]
    fn adds_compositing_workaround_for_cosmic_wayland() {
        let plan = plan_webkit_workarounds(&WebkitDisplayEnv {
            xdg_session_type: Some("wayland"),
            wayland_display_present: true,
            xdg_current_desktop: Some("pop:COSMIC"),
            desktop_session: Some("cosmic"),
            dmabuf_renderer_configured: false,
            compositing_mode_configured: false,
        });

        assert_eq!(
            plan,
            WebkitWorkaroundPlan {
                is_wayland_session: true,
                is_cosmic_session: true,
                disable_dmabuf_renderer: true,
                disable_compositing_mode: true,
            }
        );
    }

    #[test]
    fn preserves_existing_user_overrides() {
        let plan = plan_webkit_workarounds(&WebkitDisplayEnv {
            xdg_session_type: Some("wayland"),
            wayland_display_present: true,
            xdg_current_desktop: Some("COSMIC"),
            desktop_session: Some("cosmic"),
            dmabuf_renderer_configured: true,
            compositing_mode_configured: true,
        });

        assert_eq!(
            plan,
            WebkitWorkaroundPlan {
                is_wayland_session: true,
                is_cosmic_session: true,
                disable_dmabuf_renderer: false,
                disable_compositing_mode: false,
            }
        );
    }
}
