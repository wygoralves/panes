use std::{collections::HashMap, sync::Arc, time::Duration};

use tokio::sync::{Notify, RwLock};
use tokio_util::sync::CancellationToken;

use crate::{
    config::app_config::AppConfig, db::Database, engines::EngineManager, git::repo::FileTreeCache,
    git::watcher::GitWatcherManager, power::KeepAwakeManager, terminal::TerminalManager,
    terminal_notifications::TerminalNotificationManager,
};

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub config: Arc<AppConfig>,
    pub config_write_lock: Arc<tokio::sync::Mutex<()>>,
    pub engines: Arc<EngineManager>,
    pub git_watchers: Arc<GitWatcherManager>,
    pub terminals: Arc<TerminalManager>,
    pub notifications: Arc<TerminalNotificationManager>,
    pub keep_awake: Arc<KeepAwakeManager>,
    pub turns: Arc<TurnManager>,
    pub file_tree_cache: Arc<FileTreeCache>,
}

#[derive(Default)]
pub struct TurnManager {
    active: RwLock<HashMap<String, CancellationToken>>,
    finished: Notify,
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

    /// Like `try_register`, but a turn that was already cancelled is waited on
    /// for up to `max_wait`: Stop returns before the stopped turn releases the
    /// thread, and a message sent right after it should not bounce. A turn that
    /// is still live is refused at once.
    pub async fn register_or_wait(
        &self,
        thread_id: &str,
        token: CancellationToken,
        max_wait: Duration,
    ) -> bool {
        let deadline = tokio::time::Instant::now() + max_wait;
        loop {
            let finished = self.finished.notified();
            tokio::pin!(finished);
            {
                let mut active = self.active.write().await;
                match active.get(thread_id) {
                    None => {
                        active.insert(thread_id.to_string(), token);
                        return true;
                    }
                    Some(existing) if !existing.is_cancelled() => return false,
                    Some(_) => {
                        // Subscribe before releasing the lock so a finish that
                        // lands in between still wakes this waiter.
                        finished.as_mut().enable();
                    }
                }
            }
            if tokio::time::timeout_at(deadline, finished).await.is_err() {
                return false;
            }
        }
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
        self.finished.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn register_or_wait_takes_the_slot_once_a_cancelled_turn_finishes() {
        let turns = Arc::new(TurnManager::default());
        let first = CancellationToken::new();
        assert!(turns.try_register("thread", first.clone()).await);
        first.cancel();

        let waiter = tokio::spawn({
            let turns = turns.clone();
            async move {
                turns
                    .register_or_wait("thread", CancellationToken::new(), Duration::from_secs(5))
                    .await
            }
        });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(!waiter.is_finished());

        turns.finish("thread").await;
        assert!(waiter.await.expect("waiter task panicked"));
        assert!(turns.get("thread").await.is_some());
    }

    #[tokio::test]
    async fn register_or_wait_refuses_a_live_turn_without_waiting() {
        let turns = TurnManager::default();
        assert!(turns.try_register("thread", CancellationToken::new()).await);

        let started = tokio::time::Instant::now();
        assert!(
            !turns
                .register_or_wait("thread", CancellationToken::new(), Duration::from_secs(5))
                .await
        );
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[tokio::test]
    async fn register_or_wait_gives_up_after_max_wait() {
        let turns = TurnManager::default();
        let first = CancellationToken::new();
        assert!(turns.try_register("thread", first.clone()).await);
        first.cancel();

        assert!(
            !turns
                .register_or_wait(
                    "thread",
                    CancellationToken::new(),
                    Duration::from_millis(50)
                )
                .await
        );
    }
}
