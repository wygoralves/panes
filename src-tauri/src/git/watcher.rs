use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};

use notify::{recommended_watcher, Event, RecommendedWatcher, RecursiveMode, Watcher};
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
        let last_emit = self.last_emit.clone();
        let debounce_window = Duration::from_millis(300);
        let mut watcher = recommended_watcher(move |result: notify::Result<Event>| {
            if result.is_ok() {
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
        })?;

        watcher.watch(&path, RecursiveMode::Recursive)?;
        self.watchers.lock().await.insert(repo_path, watcher);
        Ok(())
    }
}
