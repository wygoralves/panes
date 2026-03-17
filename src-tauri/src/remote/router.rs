use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    db::{self, Database},
    models::{MessageWindowCursorDto, RemoteDeviceGrantDto},
    remote::protocol::{RemoteCommandRequest, RemoteCommandResponse},
    terminal::TerminalManager,
};

const REMOTE_MESSAGE_WINDOW_DEFAULT_LIMIT: usize = 120;
const REMOTE_MESSAGE_WINDOW_MAX_LIMIT: usize = 400;

#[derive(Clone)]
pub struct RemoteCommandRouter {
    db: Database,
    terminals: Arc<TerminalManager>,
}

impl RemoteCommandRouter {
    pub fn new(db: Database, terminals: Arc<TerminalManager>) -> Self {
        Self { db, terminals }
    }

    pub async fn authenticate_device_grant(
        &self,
        token: &str,
    ) -> Result<RemoteDeviceGrantDto, String> {
        let token = token.to_string();
        run_db(self.db.clone(), move |db| {
            let grant = db::remote::find_active_device_grant_by_token(db, &token)?
                .ok_or_else(|| anyhow::anyhow!("remote device grant not found or inactive"))?;
            db::remote::touch_device_grant_last_used(db, &grant.id)?;
            Ok(grant)
        })
        .await
    }

    pub async fn handle_request(
        &self,
        grant: &RemoteDeviceGrantDto,
        request: RemoteCommandRequest,
    ) -> RemoteCommandResponse {
        match self
            .handle_request_inner(grant, request.command.as_str(), request.args.clone())
            .await
        {
            Ok(result) => RemoteCommandResponse::success(request.id, result),
            Err(error) => RemoteCommandResponse::failure(request.id, error),
        }
    }

    async fn handle_request_inner(
        &self,
        grant: &RemoteDeviceGrantDto,
        command: &str,
        args: Option<Value>,
    ) -> Result<Value, String> {
        match command {
            "list_workspaces" => {
                require_scope(grant, "workspace.read")?;
                self.run_json(|db| db::workspaces::list_workspaces(db))
                    .await
            }
            "get_repos" => {
                require_scope(grant, "repo.read")?;
                let args: WorkspaceArgs = parse_args(args)?;
                self.run_json(move |db| db::repos::get_repos(db, &args.workspace_id))
                    .await
            }
            "list_threads" => {
                require_scope(grant, "thread.read")?;
                let args: WorkspaceArgs = parse_args(args)?;
                self.run_json(move |db| {
                    db::threads::list_threads_for_workspace(db, &args.workspace_id)
                })
                .await
            }
            "list_archived_threads" => {
                require_scope(grant, "thread.read")?;
                let args: WorkspaceArgs = parse_args(args)?;
                self.run_json(move |db| {
                    db::threads::list_archived_threads_for_workspace(db, &args.workspace_id)
                })
                .await
            }
            "get_thread_messages" => {
                require_scope(grant, "thread.read")?;
                let args: ThreadArgs = parse_args(args)?;
                self.run_json(move |db| db::messages::get_thread_messages(db, &args.thread_id))
                    .await
            }
            "get_thread_messages_window" => {
                require_scope(grant, "thread.read")?;
                let args: ThreadMessagesWindowArgs = parse_args(args)?;
                let requested_limit = args.limit.unwrap_or(REMOTE_MESSAGE_WINDOW_DEFAULT_LIMIT);
                let clamped_limit = requested_limit.clamp(1, REMOTE_MESSAGE_WINDOW_MAX_LIMIT);
                self.run_json(move |db| {
                    db::messages::get_thread_messages_window(
                        db,
                        &args.thread_id,
                        args.cursor.as_ref(),
                        clamped_limit,
                    )
                })
                .await
            }
            "get_message_blocks" => {
                require_scope(grant, "thread.read")?;
                let args: MessageArgs = parse_args(args)?;
                self.run_json(move |db| db::messages::get_message_blocks(db, &args.message_id))
                    .await
            }
            "get_action_output" => {
                require_scope(grant, "thread.read")?;
                let args: ActionOutputArgs = parse_args(args)?;
                self.run_json(move |db| {
                    db::messages::get_action_output(db, &args.message_id, &args.action_id)
                })
                .await
            }
            "list_remote_device_grants" => {
                require_scope(grant, "remote.admin")?;
                self.run_json(db::remote::list_device_grants).await
            }
            "list_remote_audit_events" => {
                require_scope(grant, "remote.admin")?;
                let args: ListRemoteAuditEventsArgs = parse_args(args)?;
                self.run_json(move |db| db::remote::list_remote_audit_events(db, args.limit))
                    .await
            }
            "get_active_remote_controller_lease" => {
                require_scope(grant, "controller.read")?;
                let args: ControllerLeaseScopeArgs = parse_args(args)?;
                self.run_json(move |db| {
                    db::remote::get_active_controller_lease(db, &args.scope_type, &args.scope_id)
                })
                .await
            }
            "acquire_remote_controller_lease" => {
                require_scope(grant, "controller.write")?;
                let args: AcquireControllerLeaseArgs = parse_args(args)?;
                if args.grant_id != grant.id {
                    return Err(
                        "remote device grant can only acquire controller leases for itself"
                            .to_string(),
                    );
                }
                self.run_json(move |db| {
                    db::remote::acquire_controller_lease(
                        db,
                        &args.grant_id,
                        &args.scope_type,
                        &args.scope_id,
                        args.ttl_secs,
                    )
                })
                .await
            }
            "release_remote_controller_lease" => {
                require_scope(grant, "controller.write")?;
                let args: ReleaseControllerLeaseArgs = parse_args(args)?;
                let lease_id = args.lease_id;
                let lookup_lease_id = lease_id.clone();
                let lease = run_db(self.db.clone(), move |db| {
                    db::remote::get_controller_lease_by_id(db, &lookup_lease_id)
                })
                .await?;
                let lease =
                    lease.ok_or_else(|| format!("controller lease not found: {lease_id}"))?;
                if lease.device_grant_id != grant.id {
                    return Err(
                        "remote device grant can only release controller leases it owns"
                            .to_string(),
                    );
                }
                self.run_json(move |db| db::remote::release_controller_lease(db, &lease.id))
                    .await
            }
            "terminal_list_sessions" => {
                require_scope(grant, "terminal.read")?;
                let args: WorkspaceArgs = parse_args(args)?;
                let terminals = self.terminals.clone();
                self.run_terminal_json(async move {
                    Ok(terminals.list_sessions(&args.workspace_id).await)
                })
                .await
            }
            "terminal_resume_session" => {
                require_scope(grant, "terminal.read")?;
                let args: TerminalResumeSessionArgs = parse_args(args)?;
                let terminals = self.terminals.clone();
                self.run_terminal_json(async move {
                    terminals
                        .resume_session(&args.workspace_id, &args.session_id, args.from_seq)
                        .await
                        .map_err(|error| error.to_string())
                })
                .await
            }
            _ => Err(format!("unknown remote command: {command}")),
        }
    }

    async fn run_json<T, F>(&self, operation: F) -> Result<Value, String>
    where
        T: serde::Serialize + Send + 'static,
        F: FnOnce(&Database) -> anyhow::Result<T> + Send + 'static,
    {
        let value = run_db(self.db.clone(), operation).await?;
        to_json(value)
    }

    async fn run_terminal_json<T, Fut>(&self, future: Fut) -> Result<Value, String>
    where
        T: serde::Serialize,
        Fut: std::future::Future<Output = Result<T, String>>,
    {
        let value = future.await?;
        to_json(value)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceArgs {
    workspace_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadArgs {
    thread_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadMessagesWindowArgs {
    thread_id: String,
    #[serde(default)]
    cursor: Option<MessageWindowCursorDto>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageArgs {
    message_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionOutputArgs {
    message_id: String,
    action_id: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListRemoteAuditEventsArgs {
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControllerLeaseScopeArgs {
    scope_type: String,
    scope_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AcquireControllerLeaseArgs {
    grant_id: String,
    scope_type: String,
    scope_id: String,
    ttl_secs: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseControllerLeaseArgs {
    lease_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalResumeSessionArgs {
    workspace_id: String,
    session_id: String,
    #[serde(default)]
    from_seq: Option<u64>,
}

fn parse_args<T>(args: Option<Value>) -> Result<T, String>
where
    T: DeserializeOwned,
{
    serde_json::from_value(args.unwrap_or(Value::Object(Default::default())))
        .map_err(|error| format!("invalid remote command arguments: {error}"))
}

fn require_scope(grant: &RemoteDeviceGrantDto, required_scope: &str) -> Result<(), String> {
    if grant_allows_scope(grant, required_scope) {
        return Ok(());
    }

    Err(format!(
        "remote device grant lacks required scope: {required_scope}"
    ))
}

pub(crate) fn grant_allows_scope(grant: &RemoteDeviceGrantDto, required_scope: &str) -> bool {
    grant.scopes.is_empty()
        || grant.scopes.iter().any(|scope| {
            scope == "*"
                || scope == required_scope
                || scope.ends_with(".*") && required_scope.starts_with(scope.trim_end_matches('*'))
        })
}

fn to_json<T>(value: T) -> Result<Value, String>
where
    T: serde::Serialize,
{
    serde_json::to_value(value).map_err(|error| error.to_string())
}

async fn run_db<T, F>(db: Database, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&Database) -> anyhow::Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || operation(&db))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, sync::Arc};

    use uuid::Uuid;

    use crate::{
        config::app_config::AppConfig,
        db,
        engines::EngineManager,
        git::{repo::FileTreeCache, watcher::GitWatcherManager},
        models::{
            ActionOutputDto, CreatedRemoteDeviceGrantDto, MessageDto, MessageStatusDto,
            MessageWindowDto, RemoteDeviceGrantDto, RepoDto, TerminalSessionDto, ThreadDto,
            WorkspaceDto,
        },
        power::KeepAwakeManager,
        remote::server::RemoteHostManager,
        state::{AppState, TurnManager},
        terminal::TerminalManager,
    };

    use super::*;

    fn test_app_state() -> (AppState, PathBuf) {
        let base_dir = std::env::temp_dir().join(format!("panes-remote-router-{}", Uuid::new_v4()));
        fs::create_dir_all(&base_dir).expect("failed to create base dir");
        let db_path = base_dir.join("router.db");
        let db = Database::open(db_path).expect("failed to initialize test db");
        let remote_host = Arc::new(RemoteHostManager::new(db.clone()));
        let state = AppState {
            db,
            config: Arc::new(AppConfig::default()),
            config_write_lock: Arc::new(tokio::sync::Mutex::new(())),
            engines: Arc::new(EngineManager::new()),
            git_watchers: Arc::new(GitWatcherManager::default()),
            terminals: Arc::new(TerminalManager::default()),
            remote_host,
            keep_awake: Arc::new(KeepAwakeManager::new()),
            turns: Arc::new(TurnManager::default()),
            file_tree_cache: Arc::new(FileTreeCache::new()),
        };
        (state, base_dir)
    }

    fn create_grant(state: &AppState, label: &str, scopes: &[&str]) -> CreatedRemoteDeviceGrantDto {
        db::remote::create_device_grant(
            &state.db,
            label,
            &scopes
                .iter()
                .map(|scope| (*scope).to_string())
                .collect::<Vec<_>>(),
            None,
        )
        .expect("failed to create device grant")
    }

    fn create_workspace_repo_and_thread(
        state: &AppState,
        base_dir: &PathBuf,
    ) -> (WorkspaceDto, RepoDto, ThreadDto) {
        let workspace_dir = base_dir.join("workspace");
        let repo_dir = workspace_dir.join("repo");
        fs::create_dir_all(&repo_dir).expect("failed to create repo dir");

        let workspace = db::workspaces::upsert_workspace(
            &state.db,
            workspace_dir.to_string_lossy().as_ref(),
            None,
        )
        .expect("failed to create workspace");
        let repo = db::repos::upsert_repo(
            &state.db,
            &workspace.id,
            "repo",
            repo_dir.to_string_lossy().as_ref(),
            "main",
            true,
        )
        .expect("failed to create repo");
        let thread = db::threads::create_thread(
            &state.db,
            &workspace.id,
            Some(&repo.id),
            "codex",
            "gpt-5.3-codex",
            "Remote",
        )
        .expect("failed to create thread");
        db::threads::set_engine_thread_id(&state.db, &thread.id, "engine-thread-1")
            .expect("failed to set engine thread id");

        (workspace, repo, thread)
    }

    fn seed_thread_messages(state: &AppState, thread: &ThreadDto) -> (MessageDto, MessageDto) {
        let user_message = db::messages::insert_user_message(
            &state.db,
            &thread.id,
            "User prompt",
            Some(serde_json::json!([
                {
                    "type": "text",
                    "content": "User prompt"
                }
            ])),
            Some("codex"),
            Some("gpt-5.3-codex"),
            None,
        )
        .expect("failed to insert user message");
        let assistant_message = db::messages::insert_assistant_placeholder(
            &state.db,
            &thread.id,
            Some("codex"),
            Some("gpt-5.3-codex"),
            None,
        )
        .expect("failed to insert assistant message");
        db::messages::update_assistant_blocks_json(
            &state.db,
            &assistant_message.id,
            &serde_json::json!([
                {
                    "type": "action",
                    "actionId": "action-1",
                    "actionType": "shell",
                    "summary": "Run shell",
                    "details": {
                        "outputTruncated": true
                    },
                    "outputChunks": [
                        {
                            "stream": "stdout",
                            "content": "hello"
                        }
                    ],
                    "status": "completed",
                    "result": {
                        "success": true,
                        "output": "hello",
                        "error": null,
                        "diff": null,
                        "durationMs": 12
                    }
                }
            ])
            .to_string(),
            MessageStatusDto::Completed,
            Some("gpt-5.3-codex"),
        )
        .expect("failed to update assistant blocks");
        let assistant_message = db::messages::get_thread_messages(&state.db, &thread.id)
            .expect("failed to reload thread messages")
            .into_iter()
            .find(|message| message.id == assistant_message.id)
            .expect("missing assistant message");
        (user_message, assistant_message)
    }

    #[tokio::test]
    async fn authenticates_active_device_grants_and_updates_last_used_at() {
        let (state, _base_dir) = test_app_state();
        let created = create_grant(&state, "Tablet", &["workspace.read"]);
        let router = RemoteCommandRouter::new(state.db.clone(), state.terminals.clone());

        let grant = router
            .authenticate_device_grant(&created.token)
            .await
            .expect("failed to authenticate device grant");
        assert_eq!(grant.id, created.grant.id);

        let stored = db::remote::list_device_grants(&state.db)
            .expect("failed to list grants")
            .into_iter()
            .find(|candidate| candidate.id == created.grant.id)
            .expect("missing device grant");
        assert!(stored.last_used_at.is_some());
    }

    #[tokio::test]
    async fn routes_read_commands_and_enforces_scopes() {
        let (state, base_dir) = test_app_state();
        let (workspace, repo, thread) = create_workspace_repo_and_thread(&state, &base_dir);
        let router = RemoteCommandRouter::new(state.db.clone(), state.terminals.clone());
        let created = create_grant(
            &state,
            "Reader",
            &["workspace.read", "repo.read", "thread.read"],
        );

        let workspaces = router
            .handle_request(
                &created.grant,
                RemoteCommandRequest {
                    id: "req-1".to_string(),
                    command: "list_workspaces".to_string(),
                    args: None,
                },
            )
            .await;
        assert!(workspaces.ok);
        let workspace_values = serde_json::from_value::<Vec<WorkspaceDto>>(
            workspaces.result.expect("missing workspace result"),
        )
        .expect("failed to decode workspaces");
        assert!(workspace_values.iter().any(|item| item.id == workspace.id));

        let repos = router
            .handle_request(
                &created.grant,
                RemoteCommandRequest {
                    id: "req-2".to_string(),
                    command: "get_repos".to_string(),
                    args: Some(serde_json::json!({ "workspaceId": workspace.id })),
                },
            )
            .await;
        assert!(repos.ok);
        let repo_values =
            serde_json::from_value::<Vec<RepoDto>>(repos.result.expect("missing repo result"))
                .expect("failed to decode repos");
        assert!(repo_values.iter().any(|item| item.id == repo.id));

        let threads = router
            .handle_request(
                &created.grant,
                RemoteCommandRequest {
                    id: "req-3".to_string(),
                    command: "list_threads".to_string(),
                    args: Some(serde_json::json!({ "workspaceId": workspace.id })),
                },
            )
            .await;
        assert!(threads.ok);
        let thread_values = serde_json::from_value::<Vec<ThreadDto>>(
            threads.result.expect("missing thread result"),
        )
        .expect("failed to decode threads");
        assert!(thread_values.iter().any(|item| item.id == thread.id));

        let denied = router
            .handle_request(
                &RemoteDeviceGrantDto {
                    scopes: vec!["workspace.read".to_string()],
                    ..created.grant.clone()
                },
                RemoteCommandRequest {
                    id: "req-4".to_string(),
                    command: "get_repos".to_string(),
                    args: Some(serde_json::json!({ "workspaceId": workspace.id })),
                },
            )
            .await;
        assert!(!denied.ok);
        assert!(denied
            .error
            .as_deref()
            .is_some_and(|error| error.contains("repo.read")));
    }

    #[tokio::test]
    async fn routes_thread_history_and_terminal_read_commands() {
        let (state, base_dir) = test_app_state();
        let (workspace, _repo, thread) = create_workspace_repo_and_thread(&state, &base_dir);
        let (_user_message, assistant_message) = seed_thread_messages(&state, &thread);
        let router = RemoteCommandRouter::new(state.db.clone(), state.terminals.clone());
        let reader = create_grant(&state, "Attach Reader", &["thread.read", "terminal.read"]);

        let messages = router
            .handle_request(
                &reader.grant,
                RemoteCommandRequest {
                    id: "req-4".to_string(),
                    command: "get_thread_messages_window".to_string(),
                    args: Some(serde_json::json!({
                        "threadId": thread.id,
                        "limit": 10
                    })),
                },
            )
            .await;
        assert!(messages.ok);
        let messages = serde_json::from_value::<MessageWindowDto>(
            messages.result.expect("missing message window result"),
        )
        .expect("failed to decode message window");
        assert_eq!(messages.messages.len(), 2);

        let blocks = router
            .handle_request(
                &reader.grant,
                RemoteCommandRequest {
                    id: "req-5".to_string(),
                    command: "get_message_blocks".to_string(),
                    args: Some(serde_json::json!({
                        "messageId": assistant_message.id
                    })),
                },
            )
            .await;
        assert!(blocks.ok);
        let blocks = blocks.result.expect("missing blocks result");
        assert_eq!(blocks[0]["type"], "action");

        let action_output = router
            .handle_request(
                &reader.grant,
                RemoteCommandRequest {
                    id: "req-6".to_string(),
                    command: "get_action_output".to_string(),
                    args: Some(serde_json::json!({
                        "messageId": assistant_message.id,
                        "actionId": "action-1"
                    })),
                },
            )
            .await;
        assert!(action_output.ok);
        let action_output = serde_json::from_value::<ActionOutputDto>(
            action_output.result.expect("missing action output result"),
        )
        .expect("failed to decode action output");
        assert!(action_output.found);
        assert_eq!(action_output.output_chunks.len(), 1);
        assert!(action_output.truncated);

        let terminal_sessions = router
            .handle_request(
                &reader.grant,
                RemoteCommandRequest {
                    id: "req-7".to_string(),
                    command: "terminal_list_sessions".to_string(),
                    args: Some(serde_json::json!({
                        "workspaceId": workspace.id
                    })),
                },
            )
            .await;
        assert!(terminal_sessions.ok);
        let terminal_sessions = serde_json::from_value::<Vec<TerminalSessionDto>>(
            terminal_sessions
                .result
                .expect("missing terminal list result"),
        )
        .expect("failed to decode terminal list");
        assert!(terminal_sessions.is_empty());

        let missing_resume = router
            .handle_request(
                &reader.grant,
                RemoteCommandRequest {
                    id: "req-8".to_string(),
                    command: "terminal_resume_session".to_string(),
                    args: Some(serde_json::json!({
                        "workspaceId": workspace.id,
                        "sessionId": "missing-session",
                        "fromSeq": 0
                    })),
                },
            )
            .await;
        assert!(!missing_resume.ok);
        assert!(missing_resume
            .error
            .as_deref()
            .is_some_and(|error| error.contains("session not found")));

        let denied_terminal = router
            .handle_request(
                &RemoteDeviceGrantDto {
                    scopes: vec!["thread.read".to_string()],
                    ..reader.grant.clone()
                },
                RemoteCommandRequest {
                    id: "req-9".to_string(),
                    command: "terminal_list_sessions".to_string(),
                    args: Some(serde_json::json!({
                        "workspaceId": workspace.id
                    })),
                },
            )
            .await;
        assert!(!denied_terminal.ok);
        assert!(denied_terminal
            .error
            .as_deref()
            .is_some_and(|error| error.contains("terminal.read")));
    }

    #[tokio::test]
    async fn routes_remote_admin_and_controller_commands() {
        let (state, _base_dir) = test_app_state();
        let router = RemoteCommandRouter::new(state.db.clone(), state.terminals.clone());
        let admin = create_grant(
            &state,
            "Admin",
            &["remote.admin", "controller.read", "controller.write"],
        );

        let grants = router
            .handle_request(
                &admin.grant,
                RemoteCommandRequest {
                    id: "req-5".to_string(),
                    command: "list_remote_device_grants".to_string(),
                    args: None,
                },
            )
            .await;
        assert!(grants.ok);

        let acquire = router
            .handle_request(
                &admin.grant,
                RemoteCommandRequest {
                    id: "req-6".to_string(),
                    command: "acquire_remote_controller_lease".to_string(),
                    args: Some(serde_json::json!({
                        "grantId": admin.grant.id,
                        "scopeType": "workspace",
                        "scopeId": "ws-remote",
                        "ttlSecs": 60
                    })),
                },
            )
            .await;
        assert!(acquire.ok);
        let lease = serde_json::from_value::<crate::models::RemoteControllerLeaseDto>(
            acquire.result.expect("missing lease result"),
        )
        .expect("failed to decode lease");

        let active = router
            .handle_request(
                &admin.grant,
                RemoteCommandRequest {
                    id: "req-7".to_string(),
                    command: "get_active_remote_controller_lease".to_string(),
                    args: Some(serde_json::json!({
                        "scopeType": "workspace",
                        "scopeId": "ws-remote"
                    })),
                },
            )
            .await;
        assert!(active.ok);
        let active_lease =
            serde_json::from_value::<Option<crate::models::RemoteControllerLeaseDto>>(
                active.result.expect("missing active lease result"),
            )
            .expect("failed to decode active lease");
        assert_eq!(
            active_lease.as_ref().map(|item| item.id.as_str()),
            Some(lease.id.as_str())
        );

        let release = router
            .handle_request(
                &admin.grant,
                RemoteCommandRequest {
                    id: "req-8".to_string(),
                    command: "release_remote_controller_lease".to_string(),
                    args: Some(serde_json::json!({ "leaseId": lease.id })),
                },
            )
            .await;
        assert!(release.ok);

        let audit = router
            .handle_request(
                &admin.grant,
                RemoteCommandRequest {
                    id: "req-9".to_string(),
                    command: "list_remote_audit_events".to_string(),
                    args: Some(serde_json::json!({ "limit": 20 })),
                },
            )
            .await;
        assert!(audit.ok);

        let other = create_grant(&state, "Other", &["controller.write"]);
        let denied_release = router
            .handle_request(
                &other.grant,
                RemoteCommandRequest {
                    id: "req-10".to_string(),
                    command: "release_remote_controller_lease".to_string(),
                    args: Some(serde_json::json!({ "leaseId": lease.id })),
                },
            )
            .await;
        assert!(!denied_release.ok);
        assert!(denied_release
            .error
            .as_deref()
            .is_some_and(|error| error.contains("owns")));
    }
}
