use std::{
    collections::HashMap,
    ffi::OsStr,
    path::PathBuf,
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};

use notify::{
    event::EventKind, recommended_watcher, Event, RecommendedWatcher, RecursiveMode, Watcher,
};
use tokio::sync::Mutex;

pub type WatchCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;

#[derive(Default, Clone)]
pub struct GitWatcherManager {
    watchers: Arc<Mutex<HashMap<String, RecommendedWatcher>>>,
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
        let mut watcher = recommended_watcher(move |result: notify::Result<Event>| {
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
        })?;

        watcher.watch(&path, RecursiveMode::Recursive)?;
        self.watchers.lock().await.insert(repo_path, watcher);
        Ok(())
    }
}

/// Returns true if a `.git/` sub-path is on the high-signal allowlist.
///
/// Allowed:
///   .git/HEAD              — branch pointer / detached head
///   .git/index             — staging area changes
///   .git/refs/heads/...    — branch create/delete/rename, commits advancing refs
///   .git/refs/tags/...     — tag create/delete
///   .git/refs/stash        — stash push/pop/drop
///
/// Everything else (objects/, logs/, FETCH_HEAD, ORIG_HEAD, config, hooks/, …)
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
        // .git/index (exact)
        Some(std::path::Component::Normal(name)) if name == OsStr::new("index") => {
            components.next().is_none()
        }
        // .git/refs/...
        Some(std::path::Component::Normal(name)) if name == OsStr::new("refs") => {
            match components.next() {
                // .git/refs/heads/... (any depth)
                Some(std::path::Component::Normal(n)) if n == OsStr::new("heads") => true,
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
