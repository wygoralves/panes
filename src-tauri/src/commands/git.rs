use serde::Serialize;
use tauri::Emitter;
use tauri::State;

use crate::{
    db,
    git::{repo, worktree},
    models::{
        FileTreeEntryDto, FileTreePageDto, GitBranchPageDto, GitBranchScopeDto, GitCommitPageDto,
        GitCompareSourceDto, GitDiffPreviewDto, GitFileCompareDto, GitInitRepoStatusDto,
        GitRemoteDto, GitStashDto, GitStatusDto, GitWorktreeDto, ThreadStatusDto,
    },
    state::AppState,
};

async fn run_db<T, F>(db: crate::db::Database, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&crate::db::Database) -> anyhow::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || operation(&db))
        .await
        .map_err(|error| error.to_string())?
        .map_err(err_to_string)
}

#[tauri::command]
pub async fn get_git_status(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<GitStatusDto, String> {
    tokio::task::spawn_blocking(move || repo::get_git_status(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_file_diff(
    _state: State<'_, AppState>,
    repo_path: String,
    file_path: String,
    staged: bool,
) -> Result<GitDiffPreviewDto, String> {
    tokio::task::spawn_blocking(move || {
        repo::get_file_diff(&repo_path, &file_path, staged).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_git_file_compare(
    _state: State<'_, AppState>,
    repo_path: String,
    file_path: String,
    source: String,
) -> Result<GitFileCompareDto, String> {
    let compare_source = GitCompareSourceDto::from_str(&source);
    tokio::task::spawn_blocking(move || {
        repo::get_git_file_compare(&repo_path, &file_path, compare_source).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn stage_files(
    _state: State<'_, AppState>,
    repo_path: String,
    files: Vec<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::stage_files(&repo_path, &files).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn unstage_files(
    _state: State<'_, AppState>,
    repo_path: String,
    files: Vec<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::unstage_files(&repo_path, &files).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn discard_files(
    _state: State<'_, AppState>,
    repo_path: String,
    files: Vec<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::discard_files(&repo_path, &files).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn commit(
    _state: State<'_, AppState>,
    repo_path: String,
    message: String,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || repo::commit(&repo_path, &message).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn soft_reset_last_commit(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::soft_reset_last_commit(&repo_path).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn fetch_git(_state: State<'_, AppState>, repo_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo::fetch_repo(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pull_git(_state: State<'_, AppState>, repo_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo::pull_repo(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn push_git(_state: State<'_, AppState>, repo_path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || repo::push_repo(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_git_branches(
    _state: State<'_, AppState>,
    repo_path: String,
    scope: String,
    offset: Option<usize>,
    limit: Option<usize>,
    search: Option<String>,
) -> Result<GitBranchPageDto, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(200);
    let scope = GitBranchScopeDto::from_str(&scope);

    tokio::task::spawn_blocking(move || {
        repo::list_git_branches(&repo_path, scope, offset, limit, search.as_deref())
            .map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn checkout_git_branch(
    _state: State<'_, AppState>,
    repo_path: String,
    branch_name: String,
    is_remote: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::checkout_git_branch(&repo_path, &branch_name, is_remote).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn create_git_branch(
    _state: State<'_, AppState>,
    repo_path: String,
    branch_name: String,
    from_ref: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::create_git_branch(&repo_path, &branch_name, from_ref.as_deref())
            .map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn rename_git_branch(
    _state: State<'_, AppState>,
    repo_path: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::rename_git_branch(&repo_path, &old_name, &new_name).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn delete_git_branch(
    _state: State<'_, AppState>,
    repo_path: String,
    branch_name: String,
    force: bool,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::delete_git_branch(&repo_path, &branch_name, force).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_git_commits(
    _state: State<'_, AppState>,
    repo_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<GitCommitPageDto, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(100);

    tokio::task::spawn_blocking(move || {
        repo::list_git_commits(&repo_path, offset, limit).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_git_stashes(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<GitStashDto>, String> {
    tokio::task::spawn_blocking(move || repo::list_git_stashes(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn push_git_stash(
    _state: State<'_, AppState>,
    repo_path: String,
    message: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::push_git_stash(&repo_path, message.as_deref()).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn apply_git_stash(
    _state: State<'_, AppState>,
    repo_path: String,
    stash_index: usize,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::apply_git_stash(&repo_path, stash_index).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn pop_git_stash(
    _state: State<'_, AppState>,
    repo_path: String,
    stash_index: usize,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        repo::pop_git_stash(&repo_path, stash_index).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_commit_diff(
    _state: State<'_, AppState>,
    repo_path: String,
    commit_hash: String,
) -> Result<GitDiffPreviewDto, String> {
    tokio::task::spawn_blocking(move || {
        repo::get_commit_diff(&repo_path, &commit_hash).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_file_tree(
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<FileTreeEntryDto>, String> {
    let cache = state.file_tree_cache.clone();
    tokio::task::spawn_blocking(move || {
        repo::get_file_tree(&repo_path, &cache).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_file_tree_page(
    state: State<'_, AppState>,
    repo_path: String,
    offset: Option<usize>,
    limit: Option<usize>,
) -> Result<FileTreePageDto, String> {
    let offset = offset.unwrap_or(0);
    let limit = limit.unwrap_or(2000);
    let cache = state.file_tree_cache.clone();
    tokio::task::spawn_blocking(move || {
        repo::get_file_tree_page(&repo_path, offset, limit, &cache).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitRepoChangedEvent {
    repo_path: String,
}

#[tauri::command]
pub async fn watch_git_repo(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo_path: String,
) -> Result<(), String> {
    let cache = state.file_tree_cache.clone();
    let callback = std::sync::Arc::new(move |changed_repo_path: String| {
        cache.invalidate_containing_path(&changed_repo_path);
        let payload = GitRepoChangedEvent {
            repo_path: changed_repo_path,
        };
        let _ = app.emit("git-repo-changed", payload);
    });

    state
        .git_watchers
        .watch_repo(repo_path, callback)
        .await
        .map_err(err_to_string)
}

// ── Git Worktrees ──────────────────────────────────────────────

#[tauri::command]
pub async fn add_git_worktree(
    _state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    branch_name: String,
    base_ref: Option<String>,
) -> Result<GitWorktreeDto, String> {
    // Validate branch name
    if branch_name.contains("..")
        || branch_name.starts_with('/')
        || branch_name.ends_with('/')
        || branch_name.contains(' ')
        || branch_name.is_empty()
    {
        return Err(format!("invalid branch name: {branch_name}"));
    }

    tokio::task::spawn_blocking(move || {
        // Ensure parent directory exists
        if let Some(parent) = std::path::Path::new(&worktree_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("failed to create worktree parent directory: {e}"))?;
        }

        // `add_worktree` keeps `.panes/` out of `git status` through the
        // repository's private exclude file before it creates the directory.
        worktree::add_worktree(
            &repo_path,
            &worktree_path,
            &branch_name,
            base_ref.as_deref(),
        )
        .map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_git_worktrees(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<GitWorktreeDto>, String> {
    tokio::task::spawn_blocking(move || worktree::list_worktrees(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn remove_git_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    worktree_path: String,
    force: bool,
    branch_name: Option<String>,
    delete_branch: bool,
) -> Result<(), String> {
    remove_git_worktree_inner(
        state.inner(),
        repo_path,
        worktree_path,
        force,
        branch_name,
        delete_branch,
    )
    .await
}

/// Marker the frontend matches on so it can render localized copy for the one
/// removal failure the user can act on: a chat is still running in the worktree.
pub(crate) const WORKTREE_BUSY_ERROR_PREFIX: &str = "worktree_busy:";

async fn remove_git_worktree_inner(
    state: &AppState,
    repo_path: String,
    worktree_path: String,
    force: bool,
    branch_name: Option<String>,
    delete_branch: bool,
) -> Result<(), String> {
    let bound_threads = run_db(state.db.clone(), {
        let worktree_path = worktree_path.clone();
        move |db| {
            Ok(db::threads::list_threads_with_worktree_binding(db)?
                .into_iter()
                .filter(|thread| {
                    crate::commands::threads::thread_worktree_path(thread.engine_metadata.as_ref())
                        .is_some_and(|bound| worktree::worktree_paths_match(&bound, &worktree_path))
                })
                .collect::<Vec<_>>())
        }
    })
    .await?;

    let mut busy = Vec::new();
    let mut idle = Vec::new();
    for thread in bound_threads {
        let has_running_turn = state.turns.get(&thread.id).await.is_some()
            || matches!(
                thread.status,
                ThreadStatusDto::Streaming | ThreadStatusDto::AwaitingApproval
            );
        if has_running_turn {
            busy.push(if thread.title.trim().is_empty() {
                thread.id.clone()
            } else {
                thread.title.trim().to_string()
            });
        } else {
            idle.push(thread);
        }
    }

    if !busy.is_empty() {
        return Err(format!("{WORKTREE_BUSY_ERROR_PREFIX}{}", busy.join(", ")));
    }

    // Idle threads fall back to the main checkout, so the removal never leaves
    // a thread pointing at a directory that is about to disappear.
    if !idle.is_empty() {
        run_db(state.db.clone(), move |db| {
            for thread in &idle {
                let metadata = crate::commands::threads::metadata_without_worktree(
                    thread.engine_metadata.as_ref(),
                );
                db::threads::update_engine_metadata(db, &thread.id, &metadata)?;
            }
            Ok(())
        })
        .await?;
    }

    tokio::task::spawn_blocking(move || {
        worktree::remove_worktree(
            &repo_path,
            &worktree_path,
            force,
            branch_name.as_deref(),
            delete_branch,
        )
        .map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn prune_git_worktrees(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        worktree::prune_worktrees(&repo_path).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

// ── Init & Remote Management ──────────────────────────────────

#[tauri::command]
pub async fn init_git_repo(
    _state: State<'_, AppState>,
    repo_path: String,
    validate_only: Option<bool>,
) -> Result<GitInitRepoStatusDto, String> {
    if repo_path.is_empty() {
        return Err("repo_path is required".to_string());
    }
    if !std::path::Path::new(&repo_path).is_dir() {
        return Err(format!(
            "path does not exist or is not a directory: {repo_path}"
        ));
    }
    let validate_only = validate_only.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        repo::init_repo(&repo_path, validate_only).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn list_git_remotes(
    _state: State<'_, AppState>,
    repo_path: String,
) -> Result<Vec<GitRemoteDto>, String> {
    tokio::task::spawn_blocking(move || repo::list_remotes(&repo_path).map_err(err_to_string))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn add_git_remote(
    _state: State<'_, AppState>,
    repo_path: String,
    name: String,
    url: String,
) -> Result<(), String> {
    if name.is_empty() || name.contains(char::is_whitespace) {
        return Err(format!("invalid remote name: {name}"));
    }
    if url.is_empty() {
        return Err("url is required".to_string());
    }
    tokio::task::spawn_blocking(move || {
        repo::add_remote(&repo_path, &name, &url).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn remove_git_remote(
    _state: State<'_, AppState>,
    repo_path: String,
    name: String,
) -> Result<(), String> {
    if name.is_empty() {
        return Err("name is required".to_string());
    }
    tokio::task::spawn_blocking(move || {
        repo::remove_remote(&repo_path, &name).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn rename_git_remote(
    _state: State<'_, AppState>,
    repo_path: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    if new_name.is_empty() || new_name.contains(char::is_whitespace) {
        return Err(format!("invalid remote name: {new_name}"));
    }
    tokio::task::spawn_blocking(move || {
        repo::rename_remote(&repo_path, &old_name, &new_name).map_err(err_to_string)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn err_to_string(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc};

    use serde_json::json;
    use uuid::Uuid;

    use super::*;
    use crate::{
        config::app_config::AppConfig,
        engines::EngineManager,
        git::{cli_fallback::run_git, repo::FileTreeCache, watcher::GitWatcherManager},
        models::ThreadDto,
        power::KeepAwakeManager,
        state::TurnManager,
        terminal::TerminalManager,
        terminal_notifications::TerminalNotificationManager,
    };

    struct TestRepo {
        state: AppState,
        workspace_id: String,
        path: std::path::PathBuf,
        // Spawning git races with tests that point the process-global PATH at
        // an empty temp dir; hold the shared env lock for the repo's lifetime.
        _env_guard: std::sync::MutexGuard<'static, ()>,
    }

    impl TestRepo {
        fn init() -> Self {
            let env_guard = crate::process_utils::test_env_lock()
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let root = std::env::temp_dir().join(format!("panes-git-cmd-{}", Uuid::new_v4()));
            fs::create_dir_all(&root).expect("create temp root");
            let db = crate::db::Database::open(root.join("workspaces.db"))
                .expect("failed to create test database");
            let state = AppState {
                db,
                config: Arc::new(AppConfig::default()),
                config_write_lock: Arc::new(tokio::sync::Mutex::new(())),
                engines: Arc::new(EngineManager::new()),
                git_watchers: Arc::new(GitWatcherManager::default()),
                terminals: Arc::new(TerminalManager::default()),
                notifications: Arc::new(TerminalNotificationManager::default()),
                keep_awake: Arc::new(KeepAwakeManager::new()),
                turns: Arc::new(TurnManager::default()),
                file_tree_cache: Arc::new(FileTreeCache::new()),
            };

            let path = root.join("repo");
            fs::create_dir_all(&path).expect("create repo dir");
            let mut repo = Self {
                state,
                workspace_id: String::new(),
                path,
                _env_guard: env_guard,
            };
            let repo_path = repo.path_str().to_string();
            run_git(&repo_path, &["init", "--initial-branch=main"]).expect("git init");
            run_git(&repo_path, &["config", "user.email", "test@example.com"])
                .expect("config email");
            run_git(&repo_path, &["config", "user.name", "Test"]).expect("config name");
            fs::write(repo.path.join("a.txt"), "committed\n").expect("write file");
            run_git(&repo_path, &["add", "-A"]).expect("git add");
            run_git(&repo_path, &["commit", "-m", "init"]).expect("git commit");

            let workspace =
                crate::db::workspaces::upsert_workspace(&repo.state.db, &repo_path, Some(1))
                    .expect("create workspace");
            repo.workspace_id = workspace.id;
            repo
        }

        fn path_str(&self) -> &str {
            self.path.to_str().expect("utf-8 temp path")
        }

        fn add_worktree(&self, branch: &str) -> String {
            let path = self.path.join(".panes/worktrees").join(branch);
            fs::create_dir_all(path.parent().expect("worktrees parent"))
                .expect("create worktrees dir");
            worktree::add_worktree(
                self.path_str(),
                path.to_str().expect("utf-8 worktree path"),
                branch,
                None,
            )
            .expect("add worktree")
            .path
        }

        fn thread_bound_to(&self, worktree_path: &str, title: &str) -> ThreadDto {
            let thread = crate::db::threads::create_thread(
                &self.state.db,
                &self.workspace_id,
                None,
                "codex",
                "gpt-5.4",
                title,
            )
            .expect("create thread");
            crate::db::threads::update_engine_metadata(
                &self.state.db,
                &thread.id,
                &json!({ "worktreePath": worktree_path, "sandboxMode": "read-only" }),
            )
            .expect("bind worktree");
            thread
        }

        fn reload(&self, thread_id: &str) -> ThreadDto {
            crate::db::threads::get_thread(&self.state.db, thread_id)
                .expect("read thread")
                .expect("thread exists")
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            if let Some(root) = self.path.parent() {
                let _ = fs::remove_dir_all(root);
            }
        }
    }

    #[tokio::test]
    async fn remove_git_worktree_rejects_removal_while_a_bound_thread_streams() {
        let repo = TestRepo::init();
        let worktree_path = repo.add_worktree("feature");
        let thread = repo.thread_bound_to(&worktree_path, "Refactor auth");
        crate::db::threads::update_thread_status(
            &repo.state.db,
            &thread.id,
            ThreadStatusDto::Streaming,
        )
        .expect("mark streaming");

        let error = remove_git_worktree_inner(
            &repo.state,
            repo.path_str().to_string(),
            worktree_path.clone(),
            false,
            Some("feature".to_string()),
            false,
        )
        .await
        .expect_err("expected removal to be refused while a turn is running");

        assert!(
            error.starts_with(WORKTREE_BUSY_ERROR_PREFIX),
            "got: {error}"
        );
        assert!(error.contains("Refactor auth"), "got: {error}");
        assert!(
            std::path::Path::new(&worktree_path).is_dir(),
            "the worktree must survive a refused removal"
        );
        assert_eq!(
            crate::commands::threads::thread_worktree_path(
                repo.reload(&thread.id).engine_metadata.as_ref()
            )
            .as_deref(),
            Some(worktree_path.as_str()),
            "a refused removal must leave the binding alone"
        );
    }

    #[tokio::test]
    async fn remove_git_worktree_rejects_removal_while_a_bound_thread_holds_a_turn() {
        let repo = TestRepo::init();
        let worktree_path = repo.add_worktree("feature");
        let thread = repo.thread_bound_to(&worktree_path, "Refactor auth");
        assert!(
            repo.state
                .turns
                .try_register(&thread.id, tokio_util::sync::CancellationToken::new())
                .await,
            "expected the turn to register"
        );

        let error = remove_git_worktree_inner(
            &repo.state,
            repo.path_str().to_string(),
            worktree_path.clone(),
            false,
            None,
            false,
        )
        .await
        .expect_err("expected removal to be refused while a turn is registered");

        assert!(
            error.starts_with(WORKTREE_BUSY_ERROR_PREFIX),
            "got: {error}"
        );
        assert!(std::path::Path::new(&worktree_path).is_dir());
    }

    #[tokio::test]
    async fn remove_git_worktree_detaches_idle_threads_before_removing() {
        let repo = TestRepo::init();
        let worktree_path = repo.add_worktree("feature");
        let other_worktree_path = repo.add_worktree("other");
        let idle = repo.thread_bound_to(&worktree_path, "Idle thread");
        let untouched = repo.thread_bound_to(&other_worktree_path, "Other thread");

        remove_git_worktree_inner(
            &repo.state,
            repo.path_str().to_string(),
            worktree_path.clone(),
            false,
            Some("feature".to_string()),
            true,
        )
        .await
        .expect("expected the removal to succeed");

        assert!(!std::path::Path::new(&worktree_path).exists());

        let detached = repo.reload(&idle.id);
        assert!(
            crate::commands::threads::thread_worktree_path(detached.engine_metadata.as_ref())
                .is_none(),
            "the idle thread should fall back to the main checkout"
        );
        assert_eq!(
            detached
                .engine_metadata
                .as_ref()
                .and_then(|value| value.get("sandboxMode")),
            Some(&json!("read-only")),
            "detaching must not drop the thread's other overrides"
        );
        assert_eq!(
            crate::commands::threads::thread_worktree_path(
                repo.reload(&untouched.id).engine_metadata.as_ref()
            )
            .as_deref(),
            Some(other_worktree_path.as_str()),
            "threads bound to other worktrees must be left alone"
        );
    }
}
