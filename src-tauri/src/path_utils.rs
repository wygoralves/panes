use std::{
    borrow::Cow,
    io,
    path::{Path, PathBuf},
};

pub fn canonicalize_path(path: &Path) -> io::Result<PathBuf> {
    std::fs::canonicalize(path).map(normalize_windows_path)
}

pub fn normalize_windows_path_string(path: &str) -> String {
    normalize_windows_path(PathBuf::from(path))
        .to_string_lossy()
        .to_string()
}

pub fn normalize_windows_path(path: PathBuf) -> PathBuf {
    PathBuf::from(strip_windows_verbatim_prefix(path.to_string_lossy().as_ref()).into_owned())
}

pub fn legacy_windows_verbatim_path(path: &Path) -> Option<String> {
    add_windows_verbatim_prefix(path.to_string_lossy().as_ref())
}

pub fn legacy_windows_verbatim_path_string(path: &str) -> Option<String> {
    legacy_windows_verbatim_path(Path::new(path))
}

#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
fn strip_windows_verbatim_prefix(rendered: &str) -> Cow<'_, str> {
    if let Some(rest) = rendered.strip_prefix(r"\\?\UNC\") {
        Cow::Owned(format!(r"\\{}", rest))
    } else if let Some(rest) = rendered.strip_prefix(r"\\?\") {
        Cow::Borrowed(rest)
    } else {
        Cow::Borrowed(rendered)
    }
}

#[cfg_attr(not(any(target_os = "windows", test)), allow(dead_code))]
fn add_windows_verbatim_prefix(rendered: &str) -> Option<String> {
    if rendered.is_empty() {
        return None;
    }

    if rendered.starts_with(r"\\?\") {
        return Some(rendered.to_string());
    }

    if let Some(rest) = rendered.strip_prefix(r"\\") {
        return Some(format!(r"\\?\UNC\{}", rest));
    }

    let bytes = rendered.as_bytes();
    if bytes.len() >= 3 && bytes[1] == b':' && (bytes[2] == b'\\' || bytes[2] == b'/') {
        return Some(format!(r"\\?\{}", rendered.replace('/', "\\")));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::{add_windows_verbatim_prefix, strip_windows_verbatim_prefix};

    #[test]
    fn strips_drive_letter_windows_verbatim_prefix() {
        assert_eq!(
            strip_windows_verbatim_prefix(r"\\?\C:\Users\panes\repo").as_ref(),
            r"C:\Users\panes\repo"
        );
    }

    #[test]
    fn strips_unc_windows_verbatim_prefix() {
        assert_eq!(
            strip_windows_verbatim_prefix(r"\\?\UNC\server\share\repo").as_ref(),
            r"\\server\share\repo"
        );
    }

    #[test]
    fn leaves_regular_paths_unchanged() {
        assert_eq!(
            strip_windows_verbatim_prefix(r"C:\Users\panes\repo").as_ref(),
            r"C:\Users\panes\repo"
        );
    }

    #[test]
    fn adds_drive_letter_windows_verbatim_prefix() {
        assert_eq!(
            add_windows_verbatim_prefix(r"C:\Users\panes\repo").as_deref(),
            Some(r"\\?\C:\Users\panes\repo")
        );
    }

    #[test]
    fn adds_unc_windows_verbatim_prefix() {
        assert_eq!(
            add_windows_verbatim_prefix(r"\\server\share\repo").as_deref(),
            Some(r"\\?\UNC\server\share\repo")
        );
    }
}
