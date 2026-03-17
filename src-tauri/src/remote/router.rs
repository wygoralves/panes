use std::{path::Path, sync::Arc};

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;

use crate::{
    commands::{
        chat::{self, ChatAttachmentPayload, ChatInputItemPayload},
        terminal,
    },
    config::app_config::AppConfig,
    db::{self, Database},
    git::{repo, worktree},
    models::{MessageWindowCursorDto, RemoteDeviceGrantDto},
    path_utils,
    remote::protocol::{RemoteCommandRequest, RemoteCommandResponse},
    state::AppState,
    terminal::TerminalManager,
    workspace_startup::parse_persisted_workspace_startup_preset_json,
};

const REMOTE_MESSAGE_WINDOW_DEFAULT_LIMIT: usize = 120;
const REMOTE_MESSAGE_WINDOW_MAX_LIMIT: usize = 400;

#[derive(Clone)]
pub struct RemoteCommandRouter {
    db: Database,
    terminals: Arc<TerminalManager>,
    runtime_state: Option<AppState>,
    app_handle: Option<tauri::AppHandle>,
}

impl RemoteCommandRouter {
    pub fn new(db: Database, terminals: Arc<TerminalManager>) -> Self {
        Self {
            db,
            terminals,
            runtime_state: None,
            app_handle: None,
        }
    }

    pub fn with_state(mut self, state: AppState) -> Self {
        self.runtime_state = Some(state);
        self
    }

    pub fn with_runtime(mut self, state: AppState, app_handle: tauri::AppHandle) -> Self {
        self.runtime_state = Some(state);
        self.app_handle = Some(app_handle);
        self
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
            "get_authenticated_remote_device_grant" => to_json(grant),
            "list_workspaces" => {
                require_scope(grant, "workspace.read")?;
                self.run_json(|db| db::workspaces::list_workspaces(db))
                    .await
            }
            "list_archived_workspaces" => {
                require_scope(grant, "workspace.read")?;
                self.run_json(|db| db::workspaces::list_archived_workspaces(db))
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
            "create_thread" => {
                require_scope(grant, "workspace.read")?;
                require_scope(grant, "thread.read")?;
                require_scope(grant, "controller.write")?;
                let args: CreateThreadArgs = parse_args(args)?;
                if args.repo_id.is_some() {
                    require_scope(grant, "repo.read")?;
                }
                self.require_controller_lease(grant, "workspace", &args.workspace_id)
                    .await?;
                self.run_json(move |db| {
                    let workspace = db::workspaces::list_workspaces(db)?
                        .into_iter()
                        .find(|workspace| workspace.id == args.workspace_id)
                        .ok_or_else(|| {
                            anyhow::anyhow!("workspace not found: {}", args.workspace_id)
                        })?;
                    if let Some(repo_id) = args.repo_id.as_deref() {
                        let repo = db::repos::find_repo_by_id(db, repo_id)?
                            .ok_or_else(|| anyhow::anyhow!("repo not found: {repo_id}"))?;
                        if repo.workspace_id != workspace.id {
                            anyhow::bail!(
                                "repo {repo_id} does not belong to workspace {}",
                                workspace.id
                            );
                        }
                    }
                    db::threads::create_thread(
                        db,
                        &workspace.id,
                        args.repo_id.as_deref(),
                        &args.engine_id,
                        &args.model_id,
                        &args.title,
                    )
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
            "send_message" => {
                require_scope(grant, "thread.read")?;
                require_scope(grant, "controller.write")?;
                let args: SendMessageArgs = parse_args(args)?;
                self.require_controller_lease(grant, "thread", &args.thread_id)
                    .await?;
                let state = self.runtime_state()?;
                let app_handle = self.app_handle()?;
                let assistant_message_id = chat::send_message_inner(
                    app_handle,
                    state,
                    args.thread_id,
                    args.message,
                    args.model_id,
                    args.reasoning_effort,
                    args.attachments,
                    args.input_items,
                    args.plan_mode,
                    args.client_turn_id,
                )
                .await?;
                to_json(assistant_message_id)
            }
            "cancel_turn" => {
                require_scope(grant, "thread.read")?;
                require_scope(grant, "controller.write")?;
                let args: ThreadArgs = parse_args(args)?;
                self.require_controller_lease(grant, "thread", &args.thread_id)
                    .await?;
                let state = self.runtime_state()?;
                chat::cancel_turn_inner(state, args.thread_id).await?;
                Ok(Value::Null)
            }
            "respond_to_approval" => {
                require_scope(grant, "thread.read")?;
                require_scope(grant, "controller.write")?;
                let args: ApprovalResponseArgs = parse_args(args)?;
                self.require_controller_lease(grant, "thread", &args.thread_id)
                    .await?;
                let state = self.runtime_state()?;
                chat::respond_to_approval_inner(
                    state,
                    args.thread_id,
                    args.approval_id,
                    args.response,
                )
                .await?;
                Ok(Value::Null)
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
            "get_terminal_accelerated_rendering" => {
                require_scope(grant, "terminal.read")?;
                self.run_repo_json(move || {
                    let config = AppConfig::load_or_create().map_err(|error| error.to_string())?;
                    Ok(config.terminal_accelerated_rendering_enabled())
                })
                .await
            }
            "terminal_create_session" => {
                require_scope(grant, "terminal.read")?;
                require_scope(grant, "controller.write")?;
                let args: TerminalCreateSessionArgs = parse_args(args)?;
                self.require_controller_lease(grant, "workspace", &args.workspace_id)
                    .await?;
                let state = self.runtime_state()?;
                let app_handle = self.app_handle()?;
                let session = terminal::terminal_create_session_inner(
                    app_handle,
                    state,
                    args.workspace_id,
                    args.cols,
                    args.rows,
                    args.cwd,
                )
                .await?;
                to_json(session)
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
            "terminal_close_session" => {
                require_scope(grant, "terminal.read")?;
                require_scope(grant, "controller.write")?;
                let args: TerminalSessionArgs = parse_args(args)?;
                self.require_controller_lease(grant, "workspace", &args.workspace_id)
                    .await?;
                let state = self.runtime_state()?;
                let app_handle = self.app_handle()?;
                terminal::terminal_close_session_inner(
                    app_handle,
                    state,
                    args.workspace_id,
                    args.session_id,
                )
                .await?;
                Ok(Value::Null)
            }
            "terminal_write" => {
                require_scope(grant, "terminal.read")?;
                require_scope(grant, "controller.write")?;
                let args: TerminalWriteArgs = parse_args(args)?;
                self.require_controller_lease(grant, "workspace", &args.workspace_id)
                    .await?;
                let state = self.runtime_state()?;
                terminal::terminal_write_inner(
                    state,
                    args.workspace_id,
                    args.session_id,
                    args.data,
                )
                .await?;
                Ok(Value::Null)
            }
            "terminal_write_bytes" => {
                require_scope(grant, "terminal.read")?;
                require_scope(grant, "controller.write")?;
                let args: TerminalWriteBytesArgs = parse_args(args)?;
                self.require_controller_lease(grant, "workspace", &args.workspace_id)
                    .await?;
                let state = self.runtime_state()?;
                terminal::terminal_write_bytes_inner(
                    state,
                    args.workspace_id,
                    args.session_id,
                    args.data,
                )
                .await?;
                Ok(Value::Null)
            }
            "terminal_resize" => {
                require_scope(grant, "terminal.read")?;
                require_scope(grant, "controller.write")?;
                let args: TerminalResizeArgs = parse_args(args)?;
                self.require_controller_lease(grant, "workspace", &args.workspace_id)
                    .await?;
                let state = self.runtime_state()?;
                terminal::terminal_resize_inner(
                    state,
                    args.workspace_id,
                    args.session_id,
                    args.cols,
                    args.rows,
                    args.pixel_width,
                    args.pixel_height,
                )
                .await?;
                Ok(Value::Null)
            }
            "get_git_status" => {
                require_scope(grant, "repo.read")?;
                let args: RepoPathArgs = parse_args(args)?;
                let repo_path = self.require_accessible_repo_path(args.repo_path).await?;
                self.run_repo_json(move || {
                    repo::get_git_status(&repo_path).map_err(|error| error.to_string())
                })
                .await
            }
            "get_file_diff" => {
                require_scope(grant, "repo.read")?;
                let args: GitFileDiffArgs = parse_args(args)?;
                let repo_path = self.require_accessible_repo_path(args.repo_path).await?;
                self.run_repo_json(move || {
                    repo::get_file_diff(&repo_path, &args.file_path, args.staged)
                        .map_err(|error| error.to_string())
                })
                .await
            }
            "list_git_branches" => {
                require_scope(grant, "repo.read")?;
                let args: GitBranchesArgs = parse_args(args)?;
                let repo_path = self.require_accessible_repo_path(args.repo_path).await?;
                self.run_repo_json(move || {
                    repo::list_git_branches(
                        &repo_path,
                        crate::models::GitBranchScopeDto::from_str(&args.scope),
                        args.offset.unwrap_or(0),
                        args.limit.unwrap_or(200),
                        args.search.as_deref(),
                    )
                    .map_err(|error| error.to_string())
                })
                .await
            }
            "list_git_commits" => {
                require_scope(grant, "repo.read")?;
                let args: GitCommitsArgs = parse_args(args)?;
                let repo_path = self.require_accessible_repo_path(args.repo_path).await?;
                self.run_repo_json(move || {
                    repo::list_git_commits(
                        &repo_path,
                        args.offset.unwrap_or(0),
                        args.limit.unwrap_or(100),
                    )
                    .map_err(|error| error.to_string())
                })
                .await
            }
            "get_commit_diff" => {
                require_scope(grant, "repo.read")?;
                let args: CommitDiffArgs = parse_args(args)?;
                let repo_path = self.require_accessible_repo_path(args.repo_path).await?;
                self.run_repo_json(move || {
                    repo::get_commit_diff(&repo_path, &args.commit_hash)
                        .map_err(|error| error.to_string())
                })
                .await
            }
            "list_git_worktrees" => {
                require_scope(grant, "repo.read")?;
                let args: RepoPathArgs = parse_args(args)?;
                let repo_path = self.require_accessible_repo_path(args.repo_path).await?;
                self.run_repo_json(move || {
                    worktree::list_worktrees(&repo_path).map_err(|error| error.to_string())
                })
                .await
            }
            "list_git_stashes" => {
                require_scope(grant, "repo.read")?;
                let args: RepoPathArgs = parse_args(args)?;
                let repo_path = self.require_accessible_repo_path(args.repo_path).await?;
                self.run_repo_json(move || {
                    repo::list_git_stashes(&repo_path).map_err(|error| error.to_string())
                })
                .await
            }
            "get_workspace_startup_preset" => {
                require_scope(grant, "workspace.read")?;
                let args: WorkspaceArgs = parse_args(args)?;
                self.run_json(move |db| {
                    db::workspaces::get_workspace_startup_preset_json(db, &args.workspace_id)?
                        .map(|raw| parse_persisted_workspace_startup_preset_json(&raw))
                        .transpose()
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

    async fn run_repo_json<T, F>(&self, operation: F) -> Result<Value, String>
    where
        T: serde::Serialize + Send + 'static,
        F: FnOnce() -> Result<T, String> + Send + 'static,
    {
        let value = tokio::task::spawn_blocking(operation)
            .await
            .map_err(|error| error.to_string())??;
        to_json(value)
    }

    async fn require_controller_lease(
        &self,
        grant: &RemoteDeviceGrantDto,
        scope_type: &str,
        scope_id: &str,
    ) -> Result<(), String> {
        let scope_type = scope_type.to_string();
        let scope_id = scope_id.to_string();
        let lookup_scope_type = scope_type.clone();
        let lookup_scope_id = scope_id.clone();
        let lease = run_db(self.db.clone(), move |db| {
            db::remote::get_active_controller_lease(db, &lookup_scope_type, &lookup_scope_id)
        })
        .await?;

        match lease {
            Some(lease) if lease.device_grant_id == grant.id => Ok(()),
            Some(lease) => Err(format!(
                "controller lease for {}:{} is held by device grant {}",
                lease.scope_type, lease.scope_id, lease.device_grant_id
            )),
            None => Err(format!(
                "remote controller lease required for {}:{}",
                scope_type, scope_id
            )),
        }
    }

    async fn require_accessible_repo_path(&self, repo_path: String) -> Result<String, String> {
        let candidate = repo_path.clone();
        let normalized = run_db(self.db.clone(), move |db| {
            let canonical_candidate = path_utils::canonicalize_path(Path::new(&candidate))
                .map_err(|error| anyhow::anyhow!("failed to resolve repo path: {error}"))?;
            let workspaces = db::workspaces::list_workspaces(db)?;
            let mut allowed_paths = Vec::new();
            for workspace in workspaces {
                let repos = db::repos::get_repos(db, &workspace.id)?;
                allowed_paths.extend(repos.into_iter().map(|repo| repo.path));
            }
            let allowed = allowed_paths.iter().any(|allowed_path| {
                path_utils::canonicalize_path(Path::new(allowed_path))
                    .map(|canonical_allowed| canonical_candidate == canonical_allowed)
                    .unwrap_or(false)
            });
            if !allowed {
                anyhow::bail!("repo path is outside the registered repositories");
            }
            Ok(canonical_candidate.to_string_lossy().to_string())
        })
        .await?;
        Ok(normalized)
    }

    fn app_handle(&self) -> Result<tauri::AppHandle, String> {
        self.app_handle
            .clone()
            .ok_or_else(|| "remote host app handle is unavailable".to_string())
    }

    fn runtime_state(&self) -> Result<&AppState, String> {
        self.runtime_state
            .as_ref()
            .ok_or_else(|| "remote host runtime state is unavailable".to_string())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceArgs {
    workspace_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateThreadArgs {
    workspace_id: String,
    #[serde(default)]
    repo_id: Option<String>,
    engine_id: String,
    model_id: String,
    title: String,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendMessageArgs {
    thread_id: String,
    message: String,
    #[serde(default)]
    model_id: Option<String>,
    #[serde(default)]
    reasoning_effort: Option<String>,
    #[serde(default)]
    attachments: Option<Vec<ChatAttachmentPayload>>,
    #[serde(default)]
    input_items: Option<Vec<ChatInputItemPayload>>,
    #[serde(default)]
    plan_mode: Option<bool>,
    #[serde(default)]
    client_turn_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovalResponseArgs {
    thread_id: String,
    approval_id: String,
    response: Value,
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
struct TerminalCreateSessionArgs {
    workspace_id: String,
    cols: u16,
    rows: u16,
    #[serde(default)]
    cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalResumeSessionArgs {
    workspace_id: String,
    session_id: String,
    #[serde(default)]
    from_seq: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalSessionArgs {
    workspace_id: String,
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalWriteArgs {
    workspace_id: String,
    session_id: String,
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalWriteBytesArgs {
    workspace_id: String,
    session_id: String,
    data: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalResizeArgs {
    workspace_id: String,
    session_id: String,
    cols: u16,
    rows: u16,
    #[serde(default)]
    pixel_width: u16,
    #[serde(default)]
    pixel_height: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoPathArgs {
    repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitFileDiffArgs {
    repo_path: String,
    file_path: String,
    staged: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitBranchesArgs {
    repo_path: String,
    scope: String,
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    limit: Option<usize>,
    #[serde(default)]
    search: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCommitsArgs {
    repo_path: String,
    #[serde(default)]
    offset: Option<usize>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitDiffArgs {
    repo_path: String,
    commit_hash: String,
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
    grant.scopes.iter().any(|scope| {
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

    use git2::Repository;
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

    #[test]
    fn grant_scope_checks_require_explicit_scopes() {
        let empty = RemoteDeviceGrantDto {
            id: "grant-empty".to_string(),
            label: "Empty".to_string(),
            scopes: Vec::new(),
            created_at: "2026-01-01 00:00:00".to_string(),
            expires_at: None,
            revoked_at: None,
            last_used_at: None,
        };
        assert!(!grant_allows_scope(&empty, "workspace.read"));

        let wildcard = RemoteDeviceGrantDto {
            scopes: vec!["*".to_string()],
            ..empty
        };
        assert!(grant_allows_scope(&wildcard, "workspace.read"));
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

    fn acquire_lease(
        state: &AppState,
        grant_id: &str,
        scope_type: &str,
        scope_id: &str,
    ) -> crate::models::RemoteControllerLeaseDto {
        db::remote::acquire_controller_lease(&state.db, grant_id, scope_type, scope_id, 60)
            .expect("failed to acquire controller lease")
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
    async fn validates_repo_scope_when_creating_remote_threads() {
        let (state, base_dir) = test_app_state();
        let (workspace, repo, _thread) = create_workspace_repo_and_thread(&state, &base_dir);
        let other_workspace_dir = base_dir.join("workspace-other");
        let other_repo_dir = other_workspace_dir.join("repo-other");
        fs::create_dir_all(&other_repo_dir).expect("failed to create second repo dir");
        let other_workspace = db::workspaces::upsert_workspace(
            &state.db,
            other_workspace_dir.to_string_lossy().as_ref(),
            None,
        )
        .expect("failed to create second workspace");
        let other_repo = db::repos::upsert_repo(
            &state.db,
            &other_workspace.id,
            "repo-other",
            other_repo_dir.to_string_lossy().as_ref(),
            "main",
            true,
        )
        .expect("failed to create second repo");

        let router = RemoteCommandRouter::new(state.db.clone(), state.terminals.clone());
        let controller = create_grant(
            &state,
            "Controller",
            &[
                "workspace.read",
                "repo.read",
                "thread.read",
                "controller.write",
            ],
        );
        acquire_lease(&state, &controller.grant.id, "workspace", &workspace.id);

        let mismatched_repo = router
            .handle_request(
                &controller.grant,
                RemoteCommandRequest {
                    id: "req-create-1".to_string(),
                    command: "create_thread".to_string(),
                    args: Some(serde_json::json!({
                        "workspaceId": workspace.id,
                        "repoId": other_repo.id,
                        "engineId": "codex",
                        "modelId": "gpt-5.3-codex",
                        "title": "Mismatched"
                    })),
                },
            )
            .await;
        assert!(!mismatched_repo.ok);
        assert!(mismatched_repo
            .error
            .as_deref()
            .is_some_and(|error| error.contains("does not belong to workspace")));

        let no_repo_scope = router
            .handle_request(
                &RemoteDeviceGrantDto {
                    scopes: vec![
                        "workspace.read".to_string(),
                        "thread.read".to_string(),
                        "controller.write".to_string(),
                    ],
                    ..controller.grant.clone()
                },
                RemoteCommandRequest {
                    id: "req-create-2".to_string(),
                    command: "create_thread".to_string(),
                    args: Some(serde_json::json!({
                        "workspaceId": workspace.id,
                        "repoId": repo.id,
                        "engineId": "codex",
                        "modelId": "gpt-5.3-codex",
                        "title": "Repo scoped"
                    })),
                },
            )
            .await;
        assert!(!no_repo_scope.ok);
        assert!(no_repo_scope
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
    async fn rejects_git_reads_for_unregistered_nested_repositories() {
        let (state, base_dir) = test_app_state();
        let (workspace, repo, _thread) = create_workspace_repo_and_thread(&state, &base_dir);
        Repository::init(&repo.path).expect("failed to initialize registered repo");

        let nested_repo_dir = PathBuf::from(&workspace.root_path).join("private-repo");
        fs::create_dir_all(&nested_repo_dir).expect("failed to create nested repo dir");
        Repository::init(&nested_repo_dir).expect("failed to initialize nested repo");

        let router = RemoteCommandRouter::new(state.db.clone(), state.terminals.clone());
        let reader = create_grant(&state, "Attach Reader", &["repo.read"]);

        let denied = router
            .handle_request(
                &reader.grant,
                RemoteCommandRequest {
                    id: "req-nested-repo".to_string(),
                    command: "get_git_status".to_string(),
                    args: Some(serde_json::json!({
                        "repoPath": nested_repo_dir.to_string_lossy(),
                    })),
                },
            )
            .await;

        assert!(!denied.ok);
        assert!(denied
            .error
            .as_deref()
            .is_some_and(|error| error.contains("registered repositories")));
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

    #[tokio::test]
    async fn enforces_controller_leases_for_runtime_write_commands() {
        let (state, base_dir) = test_app_state();
        let (workspace, _repo, thread) = create_workspace_repo_and_thread(&state, &base_dir);
        let router = RemoteCommandRouter::new(state.db.clone(), state.terminals.clone())
            .with_state(state.clone());
        let controller = create_grant(
            &state,
            "Controller",
            &["thread.read", "terminal.read", "controller.write"],
        );
        let other = create_grant(
            &state,
            "Other",
            &["thread.read", "terminal.read", "controller.write"],
        );

        let denied_cancel = router
            .handle_request(
                &controller.grant,
                RemoteCommandRequest {
                    id: "req-10".to_string(),
                    command: "cancel_turn".to_string(),
                    args: Some(serde_json::json!({
                        "threadId": thread.id
                    })),
                },
            )
            .await;
        assert!(!denied_cancel.ok);
        assert!(denied_cancel
            .error
            .as_deref()
            .is_some_and(|error| error.contains("remote controller lease required")));

        acquire_lease(&state, &controller.grant.id, "thread", &thread.id);

        let cancel = router
            .handle_request(
                &controller.grant,
                RemoteCommandRequest {
                    id: "req-11".to_string(),
                    command: "cancel_turn".to_string(),
                    args: Some(serde_json::json!({
                        "threadId": thread.id
                    })),
                },
            )
            .await;
        assert!(cancel.ok);

        let denied_response = router
            .handle_request(
                &other.grant,
                RemoteCommandRequest {
                    id: "req-12".to_string(),
                    command: "respond_to_approval".to_string(),
                    args: Some(serde_json::json!({
                        "threadId": thread.id,
                        "approvalId": "approval-1",
                        "response": { "decision": "accept" }
                    })),
                },
            )
            .await;
        assert!(!denied_response.ok);
        assert!(denied_response
            .error
            .as_deref()
            .is_some_and(|error| error.contains("held by device grant")));

        let claude_thread = db::threads::create_thread(
            &state.db,
            &workspace.id,
            None,
            "claude",
            "claude-3-7-sonnet",
            "Claude Remote",
        )
        .expect("failed to create claude thread");
        acquire_lease(&state, &controller.grant.id, "thread", &claude_thread.id);

        let approval = router
            .handle_request(
                &controller.grant,
                RemoteCommandRequest {
                    id: "req-13".to_string(),
                    command: "respond_to_approval".to_string(),
                    args: Some(serde_json::json!({
                        "threadId": claude_thread.id,
                        "approvalId": "approval-1",
                        "response": { "decision": "accept" }
                    })),
                },
            )
            .await;
        assert!(approval.ok);

        let denied_terminal_write = router
            .handle_request(
                &controller.grant,
                RemoteCommandRequest {
                    id: "req-14".to_string(),
                    command: "terminal_write".to_string(),
                    args: Some(serde_json::json!({
                        "workspaceId": workspace.id,
                        "sessionId": "missing-session",
                        "data": "pwd\n"
                    })),
                },
            )
            .await;
        assert!(!denied_terminal_write.ok);
        assert!(denied_terminal_write
            .error
            .as_deref()
            .is_some_and(|error| error.contains("remote controller lease required")));

        acquire_lease(&state, &controller.grant.id, "workspace", &workspace.id);

        let terminal_write = router
            .handle_request(
                &controller.grant,
                RemoteCommandRequest {
                    id: "req-15".to_string(),
                    command: "terminal_write".to_string(),
                    args: Some(serde_json::json!({
                        "workspaceId": workspace.id,
                        "sessionId": "missing-session",
                        "data": "pwd\n"
                    })),
                },
            )
            .await;
        assert!(!terminal_write.ok);
        assert!(terminal_write
            .error
            .as_deref()
            .is_some_and(|error| error.contains("terminal session not found")));

        let terminal_resize = router
            .handle_request(
                &controller.grant,
                RemoteCommandRequest {
                    id: "req-16".to_string(),
                    command: "terminal_resize".to_string(),
                    args: Some(serde_json::json!({
                        "workspaceId": workspace.id,
                        "sessionId": "missing-session",
                        "cols": 120,
                        "rows": 40,
                        "pixelWidth": 0,
                        "pixelHeight": 0
                    })),
                },
            )
            .await;
        assert!(!terminal_resize.ok);
        assert!(terminal_resize
            .error
            .as_deref()
            .is_some_and(|error| error.contains("terminal session not found")));
    }
}
