use std::{collections::HashMap, path::PathBuf, sync::Arc};

use notify::{recommended_watcher, Event, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::Mutex;

pub type WatchCallback = Arc<dyn Fn(String) + Send + Sync + 'static>;

#[derive(Default, Clone)]
pub struct GitWatcherManager {
    watchers: Arc<Mutex<HashMap<String, RecommendedWatcher>>>,
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

        let callback_repo_path = repo_path.clone();
        let mut watcher = recommended_watcher(move |result: notify::Result<Event>| {
            if result.is_ok() {
                callback(callback_repo_path.clone());
            }
        })?;

        watcher.watch(&path, RecursiveMode::Recursive)?;
        self.watchers.lock().await.insert(repo_path, watcher);
        Ok(())
    }
}
