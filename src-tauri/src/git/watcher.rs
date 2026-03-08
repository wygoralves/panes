use std::{
    collections::HashMap,
    ffi::OsStr,
    path::PathBuf,
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
    let event_handler = make_event_handler(
        callback_repo_path.clone(),
        callback_repo_root.clone(),
        Arc::clone(&callback),
        last_emit.clone(),
        debounce_window,
    );
    let mut watcher = recommended_watcher(event_handler)?;
    match watcher.watch(path, RecursiveMode::Recursive) {
        Ok(()) => Ok(Box::new(watcher)),
        Err(error) if should_fallback_to_polling(&error) => {
            log::warn!(
                "git watcher hit native limit for {}: {}. Falling back to polling.",
                path.display(),
                error
            );
            let poll_handler = make_event_handler(
                callback_repo_path,
                callback_repo_root,
                callback,
                last_emit,
                debounce_window,
            );
            let mut poll_watcher = PollWatcher::new(
                poll_handler,
                Config::default().with_poll_interval(Duration::from_secs(2)),
            )?;
            poll_watcher.watch(path, RecursiveMode::Recursive)?;
            Ok(Box::new(poll_watcher))
        }
        Err(error) => Err(error),
    }
}

fn make_event_handler(
    callback_repo_path: String,
    callback_repo_root: PathBuf,
    callback: WatchCallback,
    last_emit: Arc<StdMutex<HashMap<String, Instant>>>,
    debounce_window: Duration,
) -> impl Fn(notify::Result<Event>) + Send + 'static {
    move |result: notify::Result<Event>| {
        let Ok(event) = result else {
            return;
        };

        if !should_emit_repo_change_event(&event, &callback_repo_root) {
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

    let mut components = inside.components();
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

fn should_emit_repo_change_event(event: &Event, repo_root: &PathBuf) -> bool {
    if event.paths.is_empty() {
        return false;
    }

    // Access-only events create noise and do not represent content changes.
    if matches!(event.kind, EventKind::Access(_)) {
        return false;
    }

    // Emit if any path in this event is relevant: working tree changes always
    // pass; .git/ internal changes pass only if they match the high-signal allowlist.
    event.paths.iter().any(|path| {
        let relative = path.strip_prefix(repo_root).unwrap_or(path.as_path());
        let mut components = relative.components();
        match components.next() {
            Some(std::path::Component::Normal(name)) if name != OsStr::new(".git") => true,
            None => false,
            _ => is_allowed_git_internal_path(relative),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
            &PathBuf::from("/tmp/repo")
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
            &PathBuf::from("/tmp/repo")
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
            &PathBuf::from("/tmp/repo")
        ));
        assert!(should_emit_repo_change_event(
            &packed_refs,
            &PathBuf::from("/tmp/repo")
        ));
    }
}
