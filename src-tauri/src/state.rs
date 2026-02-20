use std::{collections::HashMap, sync::Arc};

use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use crate::{
    config::app_config::AppConfig, db::Database, engines::EngineManager,
    git::watcher::GitWatcherManager, terminal::TerminalManager,
};

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub config: Arc<AppConfig>,
    pub engines: Arc<EngineManager>,
    pub git_watchers: Arc<GitWatcherManager>,
    pub terminals: Arc<TerminalManager>,
    pub turns: Arc<TurnManager>,
}

#[derive(Default)]
pub struct TurnManager {
    active: RwLock<HashMap<String, CancellationToken>>,
}

impl TurnManager {
    pub async fn try_register(&self, thread_id: &str, token: CancellationToken) -> bool {
        let mut active = self.active.write().await;
        if active.contains_key(thread_id) {
            return false;
        }

        active.insert(thread_id.to_string(), token);
        true
    }

    pub async fn get(&self, thread_id: &str) -> Option<CancellationToken> {
        self.active.read().await.get(thread_id).cloned()
    }

    pub async fn cancel(&self, thread_id: &str) {
        if let Some(token) = self.active.read().await.get(thread_id).cloned() {
            token.cancel();
        }
    }

    pub async fn finish(&self, thread_id: &str) {
        self.active.write().await.remove(thread_id);
    }
}
