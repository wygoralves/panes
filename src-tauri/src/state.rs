use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

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
    active: RwLock<HashMap<String, ActiveTurn>>,
    finished: Notify,
}

struct ActiveTurn {
    token: CancellationToken,
    /// Set once the engine reported the turn complete: only teardown is left,
    /// so a new send waits for the release instead of bouncing.
    finishing: AtomicBool,
    snapshot: Arc<StreamSnapshotSync>,
}

impl ActiveTurn {
    fn new(token: CancellationToken) -> Self {
        Self {
            token,
            finishing: AtomicBool::new(false),
            snapshot: Arc::default(),
        }
    }
}

/// Lets a view that binds to a running turn ask the turn loop to store its
/// blocks at once, so the snapshot it then reads covers every event emitted
/// before it subscribed.
#[derive(Default)]
pub struct StreamSnapshotSync {
    requested: Notify,
    flushed: Notify,
}

impl StreamSnapshotSync {
    pub async fn requested(&self) {
        self.requested.notified().await;
    }

    pub fn mark_flushed(&self) {
        self.flushed.notify_waiters();
    }
}

impl TurnManager {
    pub async fn try_register(&self, thread_id: &str, token: CancellationToken) -> bool {
        let mut active = self.active.write().await;
        if active.contains_key(thread_id) {
            return false;
        }

        active.insert(thread_id.to_string(), ActiveTurn::new(token));
        true
    }

    /// Like `try_register`, but a turn that was cancelled or already reported
    /// complete is waited on for up to `max_wait`: the view treats such a turn
    /// as over before the backend releases the thread, and a message sent
    /// right then should not bounce. A turn that is still running is refused
    /// at once.
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
                        active.insert(thread_id.to_string(), ActiveTurn::new(token));
                        return true;
                    }
                    Some(existing)
                        if !existing.token.is_cancelled()
                            && !existing.finishing.load(Ordering::SeqCst) =>
                    {
                        return false
                    }
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
        self.active
            .read()
            .await
            .get(thread_id)
            .map(|turn| turn.token.clone())
    }

    pub async fn cancel(&self, thread_id: &str) {
        if let Some(token) = self.get(thread_id).await {
            token.cancel();
        }
    }

    pub async fn mark_finishing(&self, thread_id: &str) {
        if let Some(turn) = self.active.read().await.get(thread_id) {
            turn.finishing.store(true, Ordering::SeqCst);
        }
    }

    pub async fn snapshot_sync(&self, thread_id: &str) -> Option<Arc<StreamSnapshotSync>> {
        self.active
            .read()
            .await
            .get(thread_id)
            .map(|turn| turn.snapshot.clone())
    }

    /// Asks the running turn of `thread_id` to store its blocks and waits for
    /// that write, at most `max_wait`. Returns at once when no turn runs.
    pub async fn request_stream_snapshot(&self, thread_id: &str, max_wait: Duration) {
        let Some(sync) = self.snapshot_sync(thread_id).await else {
            return;
        };
        let flushed = sync.flushed.notified();
        tokio::pin!(flushed);
        flushed.as_mut().enable();
        match self.snapshot_sync(thread_id).await {
            Some(current) if Arc::ptr_eq(&current, &sync) => {}
            // The turn finished, after its final write, before we subscribed.
            _ => return,
        }
        sync.requested.notify_one();
        let _ = tokio::time::timeout(max_wait, flushed).await;
    }

    pub async fn finish(&self, thread_id: &str) {
        let removed = self.active.write().await.remove(thread_id);
        if let Some(turn) = removed {
            // The final write is done: a view waiting on a snapshot can read.
            turn.snapshot.mark_flushed();
        }
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
    async fn register_or_wait_waits_for_a_turn_the_engine_reported_complete() {
        let turns = Arc::new(TurnManager::default());
        assert!(turns.try_register("thread", CancellationToken::new()).await);
        turns.mark_finishing("thread").await;

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
    }

    #[tokio::test]
    async fn stream_snapshot_request_waits_for_the_turn_to_store_its_blocks() {
        let turns = Arc::new(TurnManager::default());
        let started = tokio::time::Instant::now();
        turns
            .request_stream_snapshot("thread", Duration::from_secs(5))
            .await;
        assert!(started.elapsed() < Duration::from_secs(1));

        assert!(turns.try_register("thread", CancellationToken::new()).await);
        let sync = turns.snapshot_sync("thread").await.expect("sync exists");
        let turn_loop = tokio::spawn(async move {
            sync.requested().await;
            sync.mark_flushed();
        });
        let started = tokio::time::Instant::now();
        turns
            .request_stream_snapshot("thread", Duration::from_secs(5))
            .await;
        assert!(started.elapsed() < Duration::from_secs(1));
        turn_loop.await.expect("turn loop task panicked");
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
