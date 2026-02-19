use std::{collections::HashMap, sync::Arc};

use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use crate::{
    config::app_config::AppConfig, db::Database, engines::EngineManager,
    git::watcher::GitWatcherManager,
};

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub config: Arc<AppConfig>,
    pub engines: Arc<EngineManager>,
    pub git_watchers: Arc<GitWatcherManager>,
    pub turns: Arc<TurnManager>,
}

#[derive(Default)]
pub struct TurnManager {
    active: RwLock<HashMap<String, CancellationToken>>,
}

impl TurnManager {
    pub async fn register(&self, thread_id: &str, token: CancellationToken) {
        self.active
            .write()
            .await
            .insert(thread_id.to_string(), token);
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
