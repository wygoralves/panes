use std::{
    collections::HashMap,
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};

use notify::{
    event::EventKind, recommended_watcher, Config, Event, PollWatcher, RecursiveMode, Watcher,
};
use tokio::sync::Mutex;

pub type WatchCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;
type BoxedWatcher = Box<dyn Watcher + Send>;

#[derive(Default, Clone)]
pub struct GitWatcherManager {
    watchers: Arc<Mutex<HashMap<String, BoxedWatcher>>>,
    last_emit: Arc<StdMutex<HashMap<String, Instant>>>,
}

impl GitWatcherManager {
    pub async fn watch_repo(
        &self,
        repo_path: String,
        callback: WatchCallback,
    ) -> anyhow::Result<()> {
        let path = PathBuf::from(&repo_path);
        if !path.exists() {
            return Ok(());
        }

        if self.watchers.lock().await.contains_key(&repo_path) {
            return Ok(());
        }

        let callback_repo_path = repo_path.clone();
        let callback_repo_root = path.clone();
        let last_emit = self.last_emit.clone();
        let debounce_window = Duration::from_millis(650);
        let watcher = create_repo_watcher(
            &path,
            callback_repo_path.clone(),
            callback_repo_root,
            callback,
            last_emit,
            debounce_window,
        )?;

        self.watchers.lock().await.insert(repo_path, watcher);
        Ok(())
    }
}

fn create_repo_watcher(
    path: &PathBuf,
    callback_repo_path: String,
    callback_repo_root: PathBuf,
    callback: WatchCallback,
    last_emit: Arc<StdMutex<HashMap<String, Instant>>>,
    debounce_window: Duration,
) -> notify::Result<BoxedWatcher> {
    let watch_paths = git_watch_paths(path);
    let event_handler = make_event_handler(
        callback_repo_path.clone(),
        callback_repo_root.clone(),
        watch_paths.clone(),
        Arc::clone(&callback),
        last_emit.clone(),
        debounce_window,
    );
    let mut watcher = recommended_watcher(event_handler)?;
    match watch_git_paths(&mut watcher, &watch_paths) {
        Ok(()) => Ok(Box::new(watcher)),
        Err(error) if should_fallback_to_polling(&error) => {
            log::warn!(
                "git watcher hit native limit for {}: {}. Falling back to polling.",
                format_watch_paths(&watch_paths),
                error
            );
            let poll_handler = make_event_handler(
                callback_repo_path,
                callback_repo_root,
                watch_paths.clone(),
                callback,
                last_emit,
                debounce_window,
            );
            let mut poll_watcher = PollWatcher::new(
                poll_handler,
                Config::default().with_poll_interval(Duration::from_secs(2)),
            )?;
            watch_git_paths(&mut poll_watcher, &watch_paths)?;
            Ok(Box::new(poll_watcher))
        }
        Err(error) => Err(error),
    }
}

fn git_watch_paths(repo_path: &PathBuf) -> Vec<PathBuf> {
    let dot_git = repo_path.join(".git");
    let paths = if dot_git.is_dir() {
        vec![canonicalize_existing_path(dot_git)]
    } else if dot_git.is_file() {
        match resolve_gitdir_pointer(repo_path, &dot_git) {
            Some(gitdir) => {
                let mut paths = vec![gitdir.clone()];
                if let Some(commondir) = resolve_common_gitdir(&gitdir) {
                    paths.push(commondir);
                }
                paths
            }
            None => vec![dot_git],
        }
    } else {
        vec![repo_path.clone()]
    };

    dedupe_paths(paths)
}

fn watch_git_paths<W: Watcher>(watcher: &mut W, paths: &[PathBuf]) -> notify::Result<()> {
    for path in paths {
        watcher.watch(path, git_watch_recursive_mode(path))?;
    }
    Ok(())
}

fn format_watch_paths(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

fn resolve_gitdir_pointer(repo_path: &Path, dot_git: &Path) -> Option<PathBuf> {
    let content = fs::read_to_string(dot_git).ok()?;
    let gitdir = content.trim().strip_prefix("gitdir:")?.trim();
    if gitdir.is_empty() {
        return None;
    }

    let path = PathBuf::from(gitdir);
    let resolved = if path.is_absolute() {
        path
    } else {
        repo_path.join(path)
    };

    Some(canonicalize_existing_path(resolved))
}

fn resolve_common_gitdir(gitdir: &Path) -> Option<PathBuf> {
    let content = fs::read_to_string(gitdir.join("commondir")).ok()?;
    let commondir = content.trim();
    if commondir.is_empty() {
        return None;
    }

    let path = PathBuf::from(commondir);
    let resolved = if path.is_absolute() {
        path
    } else {
        gitdir.join(path)
    };

    Some(canonicalize_existing_path(resolved))
}

fn canonicalize_existing_path(path: PathBuf) -> PathBuf {
    fs::canonicalize(&path).unwrap_or(path)
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut deduped = Vec::new();
    for path in paths {
        if !deduped.iter().any(|existing| existing == &path) {
            deduped.push(path);
        }
    }
    deduped
}

fn git_watch_recursive_mode(path: &PathBuf) -> RecursiveMode {
    if path.is_dir() {
        RecursiveMode::Recursive
    } else {
        RecursiveMode::NonRecursive
    }
}

fn make_event_handler(
    callback_repo_path: String,
    callback_repo_root: PathBuf,
    git_metadata_roots: Vec<PathBuf>,
    callback: WatchCallback,
    last_emit: Arc<StdMutex<HashMap<String, Instant>>>,
    debounce_window: Duration,
) -> impl Fn(notify::Result<Event>) + Send + 'static {
    move |result: notify::Result<Event>| {
        let Ok(event) = result else {
            return;
        };

        if !should_emit_repo_change_event(&event, &callback_repo_root, &git_metadata_roots) {
            return;
        }

        let now = Instant::now();
        let should_emit = if let Ok(mut guard) = last_emit.lock() {
            match guard.get(&callback_repo_path) {
                Some(previous) if now.duration_since(*previous) < debounce_window => false,
                _ => {
                    guard.insert(callback_repo_path.clone(), now);
                    true
                }
            }
        } else {
            true
        };

        if should_emit {
            callback(callback_repo_path.clone());
        }
    }
}

fn should_fallback_to_polling(error: &notify::Error) -> bool {
    #[cfg(target_os = "linux")]
    {
        if matches!(error.kind, notify::ErrorKind::MaxFilesWatch) {
            return true;
        }

        if let notify::ErrorKind::Io(io_error) = &error.kind {
            if io_error.raw_os_error() == Some(28) {
                return true;
            }
        }

        error.to_string().contains("No space left on device")
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = error;
        false
    }
}

/// Returns true if a `.git/` sub-path is on the high-signal allowlist.
///
/// Allowed:
///   .git/HEAD              — branch pointer / detached head
///   .git/index             — staging area changes
///   .git/refs/heads/...    — branch create/delete/rename, commits advancing refs
///   .git/refs/remotes/...  — remote branch updates after fetch/pull
///   .git/refs/tags/...     — tag create/delete
///   .git/refs/stash        — stash push/pop/drop
///   .git/FETCH_HEAD        — fetch results for remote branch refresh
///   .git/packed-refs       — packed branch/tag refs after maintenance/fetch
///
/// Everything else (objects/, logs/, ORIG_HEAD, config, hooks/, …)
/// is dropped to avoid noisy refreshes during fetch/pull/push.
fn is_allowed_git_internal_path(relative: &std::path::Path) -> bool {
    let inside = match relative.strip_prefix(".git") {
        Ok(p) => p,
        Err(_) => return false,
    };

    if inside.components().next().is_none() {
        return true;
    }

    is_allowed_git_metadata_path(inside)
}

fn is_allowed_git_metadata_path(relative: &std::path::Path) -> bool {
    let mut components = relative.components();
    match components.next() {
        // .git/HEAD (exact)
        Some(std::path::Component::Normal(name)) if name == OsStr::new("HEAD") => {
            components.next().is_none()
        }
        // .git/FETCH_HEAD (exact)
        Some(std::path::Component::Normal(name)) if name == OsStr::new("FETCH_HEAD") => {
            components.next().is_none()
        }
        // .git/index (exact)
        Some(std::path::Component::Normal(name)) if name == OsStr::new("index") => {
            components.next().is_none()
        }
        // .git/packed-refs (exact)
        Some(std::path::Component::Normal(name)) if name == OsStr::new("packed-refs") => {
            components.next().is_none()
        }
        // .git/refs/...
        Some(std::path::Component::Normal(name)) if name == OsStr::new("refs") => {
            match components.next() {
                // .git/refs/heads/... (any depth)
                Some(std::path::Component::Normal(n)) if n == OsStr::new("heads") => true,
                // .git/refs/remotes/... (any depth)
                Some(std::path::Component::Normal(n)) if n == OsStr::new("remotes") => true,
                // .git/refs/tags/... (any depth)
                Some(std::path::Component::Normal(n)) if n == OsStr::new("tags") => true,
                // .git/refs/stash (exact)
                Some(std::path::Component::Normal(n)) if n == OsStr::new("stash") => {
                    components.next().is_none()
                }
                _ => false,
            }
        }
        _ => false,
    }
}

fn should_emit_repo_change_event(
    event: &Event,
    repo_root: &PathBuf,
    git_metadata_roots: &[PathBuf],
) -> bool {
    if event.paths.is_empty() {
        return false;
    }

    // Access-only events create noise and do not represent content changes.
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }

    // Emit only for high-signal git metadata changes. Working tree edits are
    // picked up by the active Git-panel poller, which avoids recursively
    // watching large ignored trees like node_modules.
    event.paths.iter().any(|path| {
        if let Ok(relative) = path.strip_prefix(repo_root) {
            let mut components = relative.components();
            if matches!(
                components.next(),
                Some(std::path::Component::Normal(name)) if name == OsStr::new(".git")
            ) {
                return is_allowed_git_internal_path(relative);
            }
        }

        for git_metadata_root in git_metadata_roots {
            if let Ok(relative) = path.strip_prefix(git_metadata_root) {
                if relative.components().next().is_none() {
                    return true;
                }
                if is_allowed_git_metadata_path(relative) {
                    return true;
                }
            }
        }

        false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn standard_git_metadata_roots() -> Vec<PathBuf> {
        vec![PathBuf::from("/tmp/repo/.git")]
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_inotify_limit_errors_enable_poll_fallback() {
        let max_files = notify::Error::new(notify::ErrorKind::MaxFilesWatch);
        assert!(should_fallback_to_polling(&max_files));

        let io_error =
            notify::Error::new(notify::ErrorKind::Io(std::io::Error::from_raw_os_error(28)));
        assert!(should_fallback_to_polling(&io_error));
    }

    #[test]
    fn ignores_access_only_events() {
        let event = Event {
            kind: EventKind::Access(notify::event::AccessKind::Any),
            paths: vec![PathBuf::from("/tmp/repo/file.txt")],
            attrs: Default::default(),
        };

        assert!(!should_emit_repo_change_event(
            &event,
            &PathBuf::from("/tmp/repo"),
            &standard_git_metadata_roots(),
        ));
    }

    #[test]
    fn allows_remote_ref_updates() {
        let event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Any),
            paths: vec![PathBuf::from("/tmp/repo/.git/refs/remotes/origin/main")],
            attrs: Default::default(),
        };

        assert!(should_emit_repo_change_event(
            &event,
            &PathBuf::from("/tmp/repo"),
            &standard_git_metadata_roots(),
        ));
    }

    #[test]
    fn ignores_working_tree_events() {
        let event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Any),
            paths: vec![PathBuf::from("/tmp/repo/src/main.rs")],
            attrs: Default::default(),
        };

        assert!(!should_emit_repo_change_event(
            &event,
            &PathBuf::from("/tmp/repo"),
            &standard_git_metadata_roots(),
        ));
    }

    #[test]
    fn resolves_linked_worktree_gitdir_pointer_and_common_dir() {
        let root = std::env::temp_dir().join(format!(
            "panes-git-watcher-{}-{}",
            std::process::id(),
            "linked-worktree"
        ));
        let worktree = root.join("worktree");
        let gitdir = root.join("main/.git/worktrees/feature");
        let dot_git = worktree.join(".git");

        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&worktree).expect("create worktree dir");
        fs::create_dir_all(&gitdir).expect("create linked gitdir");
        fs::write(&dot_git, "gitdir: ../main/.git/worktrees/feature\n").expect("write .git file");
        fs::write(gitdir.join("commondir"), "../..").expect("write commondir file");

        let resolved = resolve_gitdir_pointer(&worktree, &dot_git).expect("resolve gitdir");
        let common = fs::canonicalize(root.join("main/.git")).expect("canonicalize common gitdir");
        assert_eq!(
            resolved,
            fs::canonicalize(&gitdir).expect("canonicalize gitdir")
        );
        assert_eq!(
            resolve_common_gitdir(&gitdir).expect("resolve commondir"),
            common
        );
        let watch_paths = git_watch_paths(&worktree);
        assert!(watch_paths.contains(&resolved));
        assert!(watch_paths.contains(&common));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn allows_external_gitdir_updates_for_linked_worktrees() {
        let git_metadata_root = PathBuf::from("/tmp/main/.git/worktrees/feature");
        let event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Any),
            paths: vec![git_metadata_root.join("HEAD")],
            attrs: Default::default(),
        };

        assert!(should_emit_repo_change_event(
            &event,
            &PathBuf::from("/tmp/repo"),
            &[git_metadata_root],
        ));
    }

    #[test]
    fn allows_common_gitdir_ref_updates_for_linked_worktrees() {
        let worktree_gitdir = PathBuf::from("/tmp/main/.git/worktrees/feature");
        let common_gitdir = PathBuf::from("/tmp/main/.git");
        let event = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Any),
            paths: vec![common_gitdir.join("refs/heads/main")],
            attrs: Default::default(),
        };

        assert!(should_emit_repo_change_event(
            &event,
            &PathBuf::from("/tmp/repo"),
            &[worktree_gitdir, common_gitdir],
        ));
    }

    #[test]
    fn allows_fetch_head_and_packed_refs_updates() {
        let fetch_head = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Any),
            paths: vec![PathBuf::from("/tmp/repo/.git/FETCH_HEAD")],
            attrs: Default::default(),
        };
        let packed_refs = Event {
            kind: EventKind::Modify(notify::event::ModifyKind::Any),
            paths: vec![PathBuf::from("/tmp/repo/.git/packed-refs")],
            attrs: Default::default(),
        };

        assert!(should_emit_repo_change_event(
            &fetch_head,
            &PathBuf::from("/tmp/repo"),
            &standard_git_metadata_roots(),
        ));
        assert!(should_emit_repo_change_event(
            &packed_refs,
            &PathBuf::from("/tmp/repo"),
            &standard_git_metadata_roots(),
        ));
    }
}
