use std::env;

use sys_locale::get_locale as get_system_locale;

pub const DEFAULT_APP_LOCALE: &str = "en";
pub const PT_BR_APP_LOCALE: &str = "pt-BR";

#[derive(Debug, Clone, Copy)]
pub struct NativeStrings {
    pub app_menu: &'static str,
    pub about_comments: &'static str,
    pub edit_menu: &'static str,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub undo: &'static str,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub redo: &'static str,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub cut: &'static str,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub copy: &'static str,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub paste: &'static str,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub select_all: &'static str,
    pub view_menu: &'static str,
    pub window_menu: &'static str,
    pub toggle_sidebar: &'static str,
    pub toggle_git_panel: &'static str,
    pub toggle_focus_mode: &'static str,
    pub toggle_fullscreen: &'static str,
    pub search: &'static str,
    pub toggle_terminal: &'static str,
    pub close: &'static str,
}

pub fn normalize_app_locale(input: &str) -> Option<&'static str> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    let without_encoding = trimmed.split('.').next().unwrap_or(trimmed);
    let without_variant = without_encoding
        .split('@')
        .next()
        .unwrap_or(without_encoding);
    let normalized = without_variant.replace('_', "-").to_ascii_lowercase();

    if normalized == "pt" || normalized.starts_with("pt-") {
        Some(PT_BR_APP_LOCALE)
    } else if normalized == "en" || normalized.starts_with("en-") {
        Some(DEFAULT_APP_LOCALE)
    } else {
        None
    }
}

pub fn detect_system_locale() -> Option<&'static str> {
    if let Some(locale) = get_system_locale().and_then(|value| normalize_app_locale(&value)) {
        return Some(locale);
    }

    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|key| {
            env::var(key)
                .ok()
                .and_then(|value| normalize_app_locale(&value))
        })
}

pub fn resolve_app_locale(saved_locale: Option<&str>) -> &'static str {
    resolve_app_locale_with_system(saved_locale, detect_system_locale())
}

fn resolve_app_locale_with_system(
    saved_locale: Option<&str>,
    system_locale: Option<&str>,
) -> &'static str {
    saved_locale
        .and_then(normalize_app_locale)
        .or_else(|| system_locale.and_then(normalize_app_locale))
        .unwrap_or(DEFAULT_APP_LOCALE)
}

pub fn native_strings(locale: &str) -> NativeStrings {
    match normalize_app_locale(locale).unwrap_or(DEFAULT_APP_LOCALE) {
        PT_BR_APP_LOCALE => NativeStrings {
            app_menu: "Panes",
            about_comments: "O cockpit open-source para programacao com assistencia de IA",
            edit_menu: "Editar",
            undo: "Desfazer",
            redo: "Refazer",
            cut: "Recortar",
            copy: "Copiar",
            paste: "Colar",
            select_all: "Selecionar tudo",
            view_menu: "Visualizar",
            window_menu: "Janela",
            toggle_sidebar: "Alternar barra lateral",
            toggle_git_panel: "Alternar painel Git",
            toggle_focus_mode: "Alternar modo foco",
            toggle_fullscreen: "Alternar tela cheia",
            search: "Buscar no workspace",
            toggle_terminal: "Alternar terminal",
            close: "Fechar",
        },
        _ => NativeStrings {
            app_menu: "Panes",
            about_comments: "The open-source cockpit for AI-assisted coding",
            edit_menu: "Edit",
            undo: "Undo",
            redo: "Redo",
            cut: "Cut",
            copy: "Copy",
            paste: "Paste",
            select_all: "Select All",
            view_menu: "View",
            window_menu: "Window",
            toggle_sidebar: "Toggle Sidebar",
            toggle_git_panel: "Toggle Git Panel",
            toggle_focus_mode: "Toggle Focus Mode",
            toggle_fullscreen: "Toggle Full Screen",
            search: "Search Workspace",
            toggle_terminal: "Toggle Terminal",
            close: "Close",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{
        native_strings, normalize_app_locale, resolve_app_locale_with_system, DEFAULT_APP_LOCALE,
        PT_BR_APP_LOCALE,
    };

    #[test]
    fn normalizes_supported_locales() {
        assert_eq!(normalize_app_locale("en"), Some(DEFAULT_APP_LOCALE));
        assert_eq!(normalize_app_locale("en-US"), Some(DEFAULT_APP_LOCALE));
        assert_eq!(normalize_app_locale("pt"), Some(PT_BR_APP_LOCALE));
        assert_eq!(normalize_app_locale("pt_BR.UTF-8"), Some(PT_BR_APP_LOCALE));
    }

    #[test]
    fn resolves_saved_locale_before_system_locale() {
        assert_eq!(
            resolve_app_locale_with_system(Some("en-US"), Some("pt-BR")),
            DEFAULT_APP_LOCALE
        );
        assert_eq!(
            resolve_app_locale_with_system(Some("pt"), Some("en-US")),
            PT_BR_APP_LOCALE
        );
    }

    #[test]
    fn resolves_system_locale_before_default() {
        assert_eq!(
            resolve_app_locale_with_system(Some("fr-FR"), Some("pt-BR")),
            PT_BR_APP_LOCALE
        );
        assert_eq!(
            resolve_app_locale_with_system(None, Some("en_US.UTF-8")),
            DEFAULT_APP_LOCALE
        );
        assert_eq!(
            resolve_app_locale_with_system(Some("fr-FR"), Some("de-DE")),
            DEFAULT_APP_LOCALE
        );
    }

    #[test]
    fn returns_pt_br_native_strings() {
        let strings = native_strings("pt-BR");

        assert_eq!(strings.edit_menu, "Editar");
        assert_eq!(strings.close, "Fechar");
    }
}
