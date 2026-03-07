use std::{
    collections::HashSet,
    path::{Component, Path, PathBuf},
};

use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};

const MIN_SPLIT_PANEL_SIZE: u8 = 15;
const MAX_SPLIT_PANEL_SIZE: u8 = 72;
const MIN_SPLIT_RATIO: f32 = 0.1;
const MAX_SPLIT_RATIO: f32 = 0.9;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceStartupPresetFormat {
    Json,
    Toml,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceDefaultView {
    Chat,
    Split,
    Terminal,
    Editor,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspacePathBase {
    Workspace,
    Worktree,
    Absolute,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceStartupApplyWhen {
    NoLiveSessions,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceStartupRepoMode {
    ActiveRepo,
    FixedRepo,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceStartupSplitDirection {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStartupPreset {
    pub version: u8,
    pub default_view: WorkspaceDefaultView,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub split_panel_size: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terminal: Option<WorkspaceTerminalStartupPreset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTerminalStartupPreset {
    pub apply_when: WorkspaceStartupApplyWhen,
    #[serde(default)]
    pub groups: Vec<WorkspaceStartupGroup>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_group_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focused_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStartupGroup {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub broadcast_on_start: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree: Option<WorkspaceStartupWorktreeConfig>,
    #[serde(default)]
    pub sessions: Vec<WorkspaceStartupSession>,
    pub root: WorkspaceStartupSplitNode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStartupWorktreeConfig {
    pub enabled: bool,
    pub repo_mode: WorkspaceStartupRepoMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repo_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_dir: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch_prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceStartupSession {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub cwd: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd_base: Option<WorkspacePathBase>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub launch_harness_on_create: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkspaceStartupSplitNode {
    Leaf {
        session_id: String,
    },
    Split {
        direction: WorkspaceStartupSplitDirection,
        ratio: f32,
        children: [Box<WorkspaceStartupSplitNode>; 2],
    },
}

pub fn parse_workspace_startup_preset_raw(
    format: WorkspaceStartupPresetFormat,
    raw_text: &str,
) -> anyhow::Result<WorkspaceStartupPreset> {
    match format {
        WorkspaceStartupPresetFormat::Json => {
            serde_json::from_str(raw_text).context("invalid startup preset JSON")
        }
        WorkspaceStartupPresetFormat::Toml => {
            toml::from_str(raw_text).context("invalid startup preset TOML")
        }
    }
}

pub fn serialize_workspace_startup_preset(
    preset: &WorkspaceStartupPreset,
    format: WorkspaceStartupPresetFormat,
) -> anyhow::Result<String> {
    match format {
        WorkspaceStartupPresetFormat::Json => {
            serde_json::to_string_pretty(preset).context("failed to serialize startup preset JSON")
        }
        WorkspaceStartupPresetFormat::Toml => {
            toml::to_string_pretty(preset).context("failed to serialize startup preset TOML")
        }
    }
}

pub fn normalize_workspace_startup_preset(
    mut preset: WorkspaceStartupPreset,
    workspace_root: &Path,
) -> anyhow::Result<WorkspaceStartupPreset> {
    let workspace_root = workspace_root.canonicalize().with_context(|| {
        format!(
            "failed to resolve workspace root '{}'",
            workspace_root.display()
        )
    })?;

    if preset.version != 1 {
        anyhow::bail!(
            "unsupported workspace startup preset version: {}",
            preset.version
        );
    }

    preset.split_panel_size = Some(
        preset
            .split_panel_size
            .unwrap_or(32)
            .clamp(MIN_SPLIT_PANEL_SIZE, MAX_SPLIT_PANEL_SIZE),
    );

    if let Some(terminal) = preset.terminal.as_mut() {
        normalize_terminal_preset(terminal, &workspace_root)?;
    }

    Ok(preset)
}

fn normalize_terminal_preset(
    terminal: &mut WorkspaceTerminalStartupPreset,
    workspace_root: &Path,
) -> anyhow::Result<()> {
    let mut group_ids = HashSet::new();
    let mut all_session_ids = HashSet::new();
    let mut broadcast_group_ids = Vec::new();

    for group in &mut terminal.groups {
        normalize_group(group, workspace_root, &mut group_ids, &mut all_session_ids)?;
        if group.broadcast_on_start {
            broadcast_group_ids.push(group.id.clone());
        }
    }

    if broadcast_group_ids.len() > 1 {
        anyhow::bail!(
            "only one startup group may enable broadcastOnStart (found: {})",
            broadcast_group_ids.join(", ")
        );
    }

    if let Some(active_group_id) = terminal.active_group_id.as_mut() {
        *active_group_id = normalize_non_empty(active_group_id, "terminal.activeGroupId")?;
        if !group_ids.contains(active_group_id) {
            anyhow::bail!("terminal.activeGroupId references an unknown group");
        }
    }

    if let Some(focused_session_id) = terminal.focused_session_id.as_mut() {
        *focused_session_id = normalize_non_empty(focused_session_id, "terminal.focusedSessionId")?;
        if !all_session_ids.contains(focused_session_id) {
            anyhow::bail!("terminal.focusedSessionId references an unknown session");
        }
    }

    Ok(())
}

fn normalize_group(
    group: &mut WorkspaceStartupGroup,
    workspace_root: &Path,
    group_ids: &mut HashSet<String>,
    all_session_ids: &mut HashSet<String>,
) -> anyhow::Result<()> {
    group.id = normalize_non_empty(&group.id, "terminal.groups[].id")?;
    if !group_ids.insert(group.id.clone()) {
        anyhow::bail!("duplicate startup group id: {}", group.id);
    }

    group.name = normalize_non_empty(&group.name, "terminal.groups[].name")?;
    normalize_worktree(group.worktree.as_mut(), workspace_root)?;
    group.sessions = normalize_sessions(
        &group.sessions,
        all_session_ids,
        workspace_root,
        group.worktree.as_ref(),
    )?;

    let session_ids = group
        .sessions
        .iter()
        .map(|session| session.id.clone())
        .collect::<HashSet<_>>();
    if session_ids.is_empty() {
        anyhow::bail!(
            "startup group '{}' must contain at least one session",
            group.id
        );
    }

    group.root = normalize_split_node(&group.root, &session_ids, "terminal.groups[].root")?;

    let referenced_session_ids = collect_leaf_session_ids(&group.root)?;
    if referenced_session_ids != session_ids {
        anyhow::bail!(
            "startup group '{}' root must reference each session exactly once",
            group.id
        );
    }

    let worktree_enabled = group.worktree.as_ref().is_some_and(|config| config.enabled);
    if !worktree_enabled
        && group
            .sessions
            .iter()
            .any(|session| session.cwd_base == Some(WorkspacePathBase::Worktree))
    {
        anyhow::bail!(
            "startup group '{}' uses cwdBase='worktree' without worktree.enabled=true",
            group.id
        );
    }

    Ok(())
}

fn normalize_sessions(
    sessions: &[WorkspaceStartupSession],
    all_session_ids: &mut HashSet<String>,
    workspace_root: &Path,
    worktree: Option<&WorkspaceStartupWorktreeConfig>,
) -> anyhow::Result<Vec<WorkspaceStartupSession>> {
    let mut session_ids = HashSet::new();
    let mut normalized = Vec::with_capacity(sessions.len());

    for session in sessions {
        let mut next = session.clone();
        next.id = normalize_non_empty(&next.id, "terminal.groups[].sessions[].id")?;
        if !session_ids.insert(next.id.clone()) {
            anyhow::bail!("duplicate session id inside group: {}", next.id);
        }
        if !all_session_ids.insert(next.id.clone()) {
            anyhow::bail!("duplicate startup session id across groups: {}", next.id);
        }

        next.title = next
            .title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        next.cwd_base = Some(next.cwd_base.unwrap_or(WorkspacePathBase::Workspace));
        next.cwd = normalize_session_cwd(
            &next.cwd,
            next.cwd_base.unwrap_or(WorkspacePathBase::Workspace),
            workspace_root,
            worktree,
        )?;
        next.harness_id = next
            .harness_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        next.launch_harness_on_create = Some(
            next.launch_harness_on_create
                .unwrap_or(next.harness_id.is_some()),
        );
        normalized.push(next);
    }

    Ok(normalized)
}

fn normalize_session_cwd(
    raw_cwd: &str,
    cwd_base: WorkspacePathBase,
    workspace_root: &Path,
    worktree: Option<&WorkspaceStartupWorktreeConfig>,
) -> anyhow::Result<String> {
    const FIELD_NAME: &str = "terminal.groups[].sessions[].cwd";
    let cwd = normalize_non_empty(raw_cwd, FIELD_NAME)?;

    match cwd_base {
        WorkspacePathBase::Workspace => {
            let resolved =
                resolve_path_inside_workspace(&cwd, workspace_root, workspace_root, FIELD_NAME)?;
            ensure_existing_dir(&resolved, FIELD_NAME)?;
            let relative = relative_path_from_base(workspace_root, &resolved)
                .context("failed to normalize startup cwd")?;
            Ok(path_to_string(&relative))
        }
        WorkspacePathBase::Absolute => {
            let resolved =
                resolve_path_inside_workspace(&cwd, workspace_root, workspace_root, FIELD_NAME)?;
            ensure_existing_dir(&resolved, FIELD_NAME)?;
            Ok(path_to_string(&resolved))
        }
        WorkspacePathBase::Worktree => {
            let cwd_path = Path::new(&cwd);
            anyhow::ensure!(
                !cwd_path.is_absolute(),
                "{FIELD_NAME} cannot be absolute when cwdBase='worktree'"
            );
            anyhow::ensure!(
                !uses_parent_components(cwd_path),
                "{FIELD_NAME} cannot contain parent segments when cwdBase='worktree'"
            );

            let normalized = path_to_string(&normalize_path(cwd_path));
            if let Some(worktree) = worktree.filter(|config| config.enabled) {
                if worktree.repo_mode == WorkspaceStartupRepoMode::FixedRepo {
                    let repo_path = worktree.repo_path.as_deref().ok_or_else(|| {
                        anyhow!("worktree.repoPath is required when repoMode='fixed_repo'")
                    })?;
                    let repo_root = workspace_root.join(repo_path);
                    let resolved = resolve_path_inside_workspace(
                        &normalized,
                        &repo_root,
                        workspace_root,
                        FIELD_NAME,
                    )?;
                    ensure_existing_dir(&resolved, FIELD_NAME)?;
                    let relative = relative_path_from_base(&normalize_path(&repo_root), &resolved)
                        .context("failed to normalize startup cwd")?;
                    return Ok(path_to_string(&relative));
                }
            }

            Ok(normalized)
        }
    }
}

fn normalize_worktree(
    worktree: Option<&mut WorkspaceStartupWorktreeConfig>,
    workspace_root: &Path,
) -> anyhow::Result<()> {
    let Some(worktree) = worktree else {
        return Ok(());
    };

    worktree.base_branch = worktree
        .base_branch
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    worktree.base_dir = worktree
        .base_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    worktree.branch_prefix = worktree
        .branch_prefix
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    match worktree.repo_mode {
        WorkspaceStartupRepoMode::ActiveRepo => {
            worktree.repo_path = None;
        }
        WorkspaceStartupRepoMode::FixedRepo => {
            let raw_repo_path = worktree.repo_path.as_deref().ok_or_else(|| {
                anyhow!("worktree.repoPath is required when repoMode='fixed_repo'")
            })?;
            worktree.repo_path = Some(normalize_repo_path(raw_repo_path, workspace_root)?);
        }
    }

    worktree.base_dir = worktree
        .base_dir
        .as_deref()
        .map(|raw_base_dir| {
            normalize_base_dir(
                raw_base_dir,
                workspace_root,
                worktree.repo_mode,
                worktree.repo_path.as_deref(),
            )
        })
        .transpose()?;

    Ok(())
}

fn normalize_repo_path(raw_path: &str, workspace_root: &Path) -> anyhow::Result<String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        anyhow::bail!("worktree.repoPath cannot be empty");
    }

    let resolved = resolve_path_inside_workspace(
        trimmed,
        workspace_root,
        workspace_root,
        "worktree.repoPath",
    )?;
    ensure_existing_dir(&resolved, "worktree.repoPath")?;
    ensure_git_repository(&resolved, "worktree.repoPath")?;
    let relative = relative_path_from_base(workspace_root, &resolved)
        .context("failed to normalize worktree.repoPath")?;
    Ok(path_to_string(&relative))
}

fn normalize_base_dir(
    raw_base_dir: &str,
    workspace_root: &Path,
    repo_mode: WorkspaceStartupRepoMode,
    repo_path: Option<&str>,
) -> anyhow::Result<String> {
    let trimmed = raw_base_dir.trim();
    if trimmed.is_empty() {
        anyhow::bail!("worktree.baseDir cannot be empty");
    }

    let base_dir_path = Path::new(trimmed);
    if base_dir_path.is_absolute() {
        let resolved = resolve_path_inside_workspace(
            trimmed,
            workspace_root,
            workspace_root,
            "worktree.baseDir",
        )?;
        return Ok(path_to_string(&resolved));
    }

    match repo_mode {
        WorkspaceStartupRepoMode::ActiveRepo => {
            anyhow::ensure!(
                !uses_parent_components(base_dir_path),
                "worktree.baseDir cannot contain parent segments when repoMode='active_repo'"
            );
            Ok(path_to_string(&normalize_path(base_dir_path)))
        }
        WorkspaceStartupRepoMode::FixedRepo => {
            let repo_root = workspace_root.join(repo_path.ok_or_else(|| {
                anyhow!("worktree.repoPath is required when repoMode='fixed_repo'")
            })?);
            let resolved = resolve_path_inside_workspace(
                trimmed,
                &repo_root,
                workspace_root,
                "worktree.baseDir",
            )?;
            let relative = relative_path_from_base(&normalize_path(&repo_root), &resolved)
                .context("failed to normalize worktree.baseDir")?;
            Ok(path_to_string(&relative))
        }
    }
}

fn resolve_path_inside_workspace(
    raw_path: &str,
    base_path: &Path,
    workspace_root: &Path,
    field_name: &str,
) -> anyhow::Result<PathBuf> {
    let candidate = resolve_path(raw_path, base_path);
    ensure_path_inside_workspace(&candidate, workspace_root, field_name)?;
    Ok(candidate)
}

fn resolve_path(raw_path: &str, base_path: &Path) -> PathBuf {
    let path = Path::new(raw_path.trim());
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        base_path.join(path)
    };
    normalize_path(&joined)
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
        }
    }
    normalized
}

fn ensure_path_inside_workspace(
    candidate: &Path,
    workspace_root: &Path,
    field_name: &str,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        candidate.starts_with(workspace_root),
        "{field_name} must stay inside the workspace root"
    );

    let existing_ancestor = deepest_existing_ancestor(candidate)
        .ok_or_else(|| anyhow!("{field_name} has no existing parent inside the workspace root"))?;
    let canonical_ancestor = existing_ancestor
        .canonicalize()
        .with_context(|| format!("failed to resolve {field_name}"))?;
    anyhow::ensure!(
        canonical_ancestor.starts_with(workspace_root),
        "{field_name} must stay inside the workspace root"
    );
    Ok(())
}

fn ensure_existing_dir(path: &Path, field_name: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        path.is_dir(),
        "{field_name} must reference an existing directory"
    );
    Ok(())
}

fn ensure_git_repository(path: &Path, field_name: &str) -> anyhow::Result<()> {
    git2::Repository::open(path)
        .with_context(|| format!("{field_name} must reference an existing git repository"))?;
    Ok(())
}

fn deepest_existing_ancestor(path: &Path) -> Option<&Path> {
    let mut current = Some(path);
    while let Some(candidate) = current {
        if candidate.exists() {
            return Some(candidate);
        }
        current = candidate.parent();
    }
    None
}

fn relative_path_from_base(base: &Path, target: &Path) -> anyhow::Result<PathBuf> {
    anyhow::ensure!(
        base.is_absolute() && target.is_absolute(),
        "relative path conversion requires absolute paths"
    );

    let base_components = base.components().collect::<Vec<_>>();
    let target_components = target.components().collect::<Vec<_>>();
    let mut shared_prefix_len = 0;

    while shared_prefix_len < base_components.len()
        && shared_prefix_len < target_components.len()
        && base_components[shared_prefix_len] == target_components[shared_prefix_len]
    {
        shared_prefix_len += 1;
    }

    let mut relative = PathBuf::new();
    for component in &base_components[shared_prefix_len..] {
        if matches!(component, Component::Normal(_)) {
            relative.push("..");
        }
    }
    for component in &target_components[shared_prefix_len..] {
        relative.push(component.as_os_str());
    }

    Ok(if relative.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        relative
    })
}

fn uses_parent_components(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn normalize_split_node(
    node: &WorkspaceStartupSplitNode,
    known_session_ids: &HashSet<String>,
    field_path: &str,
) -> anyhow::Result<WorkspaceStartupSplitNode> {
    match node {
        WorkspaceStartupSplitNode::Leaf { session_id } => {
            let session_id = normalize_non_empty(session_id, field_path)?;
            if !known_session_ids.contains(&session_id) {
                anyhow::bail!("{field_path} references unknown sessionId '{session_id}'");
            }
            Ok(WorkspaceStartupSplitNode::Leaf { session_id })
        }
        WorkspaceStartupSplitNode::Split {
            direction,
            ratio,
            children,
        } => Ok(WorkspaceStartupSplitNode::Split {
            direction: *direction,
            ratio: ratio.clamp(MIN_SPLIT_RATIO, MAX_SPLIT_RATIO),
            children: [
                Box::new(normalize_split_node(
                    &children[0],
                    known_session_ids,
                    field_path,
                )?),
                Box::new(normalize_split_node(
                    &children[1],
                    known_session_ids,
                    field_path,
                )?),
            ],
        }),
    }
}

fn collect_leaf_session_ids(node: &WorkspaceStartupSplitNode) -> anyhow::Result<HashSet<String>> {
    let mut seen = HashSet::new();
    collect_leaf_session_ids_into(node, &mut seen)?;
    Ok(seen)
}

fn collect_leaf_session_ids_into(
    node: &WorkspaceStartupSplitNode,
    seen: &mut HashSet<String>,
) -> anyhow::Result<()> {
    match node {
        WorkspaceStartupSplitNode::Leaf { session_id } => {
            if !seen.insert(session_id.clone()) {
                anyhow::bail!(
                    "startup split tree references session '{session_id}' more than once"
                );
            }
        }
        WorkspaceStartupSplitNode::Split { children, .. } => {
            collect_leaf_session_ids_into(&children[0], seen)?;
            collect_leaf_session_ids_into(&children[1], seen)?;
        }
    }
    Ok(())
}

fn normalize_non_empty(value: &str, field_name: &str) -> anyhow::Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        anyhow::bail!("{field_name} cannot be empty");
    }
    Ok(trimmed.to_string())
}

fn path_to_string(path: &Path) -> String {
    let rendered = path.to_string_lossy().replace('\\', "/");
    if rendered.is_empty() {
        ".".to_string()
    } else {
        rendered
    }
}

fn is_false(value: &bool) -> bool {
    !*value
}

pub fn parse_persisted_workspace_startup_preset_json(
    raw_json: &str,
) -> anyhow::Result<WorkspaceStartupPreset> {
    serde_json::from_str(raw_json).context("invalid persisted workspace startup preset JSON")
}

pub fn resolve_workspace_path(root_path: &str) -> anyhow::Result<PathBuf> {
    PathBuf::from(root_path)
        .canonicalize()
        .with_context(|| format!("failed to resolve workspace root '{root_path}'"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;

    fn workspace_root() -> PathBuf {
        static ROOT: OnceLock<PathBuf> = OnceLock::new();
        ROOT.get_or_init(|| {
            let root = std::env::temp_dir().join("panes-startup-preset-tests");
            std::fs::create_dir_all(&root).unwrap();
            std::fs::create_dir_all(root.join("apps/repo")).unwrap();
            std::fs::create_dir_all(root.join("apps/web")).unwrap();
            std::fs::create_dir_all(root.join("apps/not-a-repo")).unwrap();
            if !root.join("apps/repo/.git").exists() {
                git2::Repository::init(root.join("apps/repo")).unwrap();
            }
            root.canonicalize().unwrap()
        })
        .clone()
    }

    fn preset() -> WorkspaceStartupPreset {
        WorkspaceStartupPreset {
            version: 1,
            default_view: WorkspaceDefaultView::Split,
            split_panel_size: Some(90),
            terminal: Some(WorkspaceTerminalStartupPreset {
                apply_when: WorkspaceStartupApplyWhen::NoLiveSessions,
                groups: vec![WorkspaceStartupGroup {
                    id: "main".to_string(),
                    name: "Main".to_string(),
                    broadcast_on_start: true,
                    worktree: None,
                    sessions: vec![
                        WorkspaceStartupSession {
                            id: "a".to_string(),
                            title: None,
                            cwd: ".".to_string(),
                            cwd_base: None,
                            harness_id: Some("codex".to_string()),
                            launch_harness_on_create: None,
                        },
                        WorkspaceStartupSession {
                            id: "b".to_string(),
                            title: None,
                            cwd: "apps/web".to_string(),
                            cwd_base: Some(WorkspacePathBase::Workspace),
                            harness_id: None,
                            launch_harness_on_create: None,
                        },
                    ],
                    root: WorkspaceStartupSplitNode::Split {
                        direction: WorkspaceStartupSplitDirection::Vertical,
                        ratio: 0.95,
                        children: [
                            Box::new(WorkspaceStartupSplitNode::Leaf {
                                session_id: "a".to_string(),
                            }),
                            Box::new(WorkspaceStartupSplitNode::Leaf {
                                session_id: "b".to_string(),
                            }),
                        ],
                    },
                }],
                active_group_id: Some("main".to_string()),
                focused_session_id: Some("a".to_string()),
            }),
        }
    }

    #[test]
    fn normalizes_defaults_and_clamps_sizes() {
        let normalized = normalize_workspace_startup_preset(preset(), &workspace_root()).unwrap();
        let terminal = normalized.terminal.unwrap();
        let group = &terminal.groups[0];
        assert_eq!(normalized.split_panel_size, Some(72));
        match &group.root {
            WorkspaceStartupSplitNode::Split { ratio, .. } => assert_eq!(*ratio, 0.9),
            WorkspaceStartupSplitNode::Leaf { .. } => panic!("expected split node"),
        }
        assert_eq!(
            group.sessions[0].cwd_base,
            Some(WorkspacePathBase::Workspace)
        );
        assert_eq!(group.sessions[0].launch_harness_on_create, Some(true));
        assert_eq!(group.sessions[1].launch_harness_on_create, Some(false));
    }

    #[test]
    fn parses_persisted_json_without_revalidating_paths() {
        let mut preset = preset();
        preset.terminal.as_mut().unwrap().groups[0].sessions[1].cwd = "apps/missing".to_string();

        let raw_json = serde_json::to_string(&preset).unwrap();
        let parsed = parse_persisted_workspace_startup_preset_json(&raw_json).unwrap();

        let terminal = parsed.terminal.unwrap();
        assert_eq!(terminal.groups[0].sessions[1].cwd, "apps/missing");
    }

    #[test]
    fn rejects_duplicate_broadcast_groups() {
        let mut preset = preset();
        let terminal = preset.terminal.as_mut().unwrap();
        terminal.groups.push(WorkspaceStartupGroup {
            id: "secondary".to_string(),
            name: "Secondary".to_string(),
            broadcast_on_start: true,
            worktree: None,
            sessions: vec![WorkspaceStartupSession {
                id: "c".to_string(),
                title: None,
                cwd: ".".to_string(),
                cwd_base: None,
                harness_id: None,
                launch_harness_on_create: None,
            }],
            root: WorkspaceStartupSplitNode::Leaf {
                session_id: "c".to_string(),
            },
        });
        let error = normalize_workspace_startup_preset(preset, &workspace_root())
            .unwrap_err()
            .to_string();
        assert!(error.contains("broadcastOnStart"));
    }

    #[test]
    fn rejects_split_tree_with_missing_session_reference() {
        let mut preset = preset();
        preset.terminal.as_mut().unwrap().groups[0].root = WorkspaceStartupSplitNode::Leaf {
            session_id: "missing".to_string(),
        };
        let error = normalize_workspace_startup_preset(preset, &workspace_root())
            .unwrap_err()
            .to_string();
        assert!(error.contains("unknown sessionId"));
    }

    #[test]
    fn rejects_workspace_cwd_that_escapes_workspace_root() {
        let workspace_root = workspace_root();
        let mut preset = preset();
        preset.terminal.as_mut().unwrap().groups[0].sessions[0].cwd = "../outside".to_string();

        let error = normalize_workspace_startup_preset(preset, &workspace_root)
            .unwrap_err()
            .to_string();
        assert!(error.contains("terminal.groups[].sessions[].cwd"));
    }

    #[test]
    fn rejects_workspace_cwd_that_does_not_exist() {
        let workspace_root = workspace_root();
        let mut preset = preset();
        preset.terminal.as_mut().unwrap().groups[0].sessions[1].cwd = "apps/missing".to_string();

        let error = normalize_workspace_startup_preset(preset, &workspace_root)
            .unwrap_err()
            .to_string();
        assert!(error.contains("must reference an existing directory"));
    }

    #[test]
    fn rejects_fixed_repo_path_that_escapes_workspace() {
        let workspace_root = workspace_root();
        let mut preset = preset();
        preset.terminal.as_mut().unwrap().groups[0].worktree =
            Some(WorkspaceStartupWorktreeConfig {
                enabled: true,
                repo_mode: WorkspaceStartupRepoMode::FixedRepo,
                repo_path: Some("../outside-repo".to_string()),
                base_branch: None,
                base_dir: None,
                branch_prefix: None,
            });

        let error = normalize_workspace_startup_preset(preset, &workspace_root)
            .unwrap_err()
            .to_string();
        assert!(error.contains("worktree.repoPath must stay inside the workspace root"));
    }

    #[test]
    fn rejects_parent_escaped_absolute_repo_path() {
        let workspace_root = workspace_root();
        let mut preset = preset();
        preset.terminal.as_mut().unwrap().groups[0].worktree =
            Some(WorkspaceStartupWorktreeConfig {
                enabled: true,
                repo_mode: WorkspaceStartupRepoMode::FixedRepo,
                repo_path: Some(
                    workspace_root
                        .join("../outside-repo")
                        .to_string_lossy()
                        .to_string(),
                ),
                base_branch: None,
                base_dir: None,
                branch_prefix: None,
            });

        let error = normalize_workspace_startup_preset(preset, &workspace_root)
            .unwrap_err()
            .to_string();
        assert!(error.contains("worktree.repoPath must stay inside the workspace root"));
    }

    #[test]
    fn rejects_missing_fixed_repo_path() {
        let workspace_root = workspace_root();
        let mut preset = preset();
        preset.terminal.as_mut().unwrap().groups[0].worktree =
            Some(WorkspaceStartupWorktreeConfig {
                enabled: true,
                repo_mode: WorkspaceStartupRepoMode::FixedRepo,
                repo_path: Some("apps/missing-repo".to_string()),
                base_branch: None,
                base_dir: None,
                branch_prefix: None,
            });

        let error = normalize_workspace_startup_preset(preset, &workspace_root)
            .unwrap_err()
            .to_string();
        assert!(error.contains("must reference an existing directory"));
    }

    #[test]
    fn rejects_fixed_repo_path_that_is_not_a_git_repository() {
        let workspace_root = workspace_root();
        let mut preset = preset();
        preset.terminal.as_mut().unwrap().groups[0].worktree =
            Some(WorkspaceStartupWorktreeConfig {
                enabled: true,
                repo_mode: WorkspaceStartupRepoMode::FixedRepo,
                repo_path: Some("apps/not-a-repo".to_string()),
                base_branch: None,
                base_dir: None,
                branch_prefix: None,
            });

        let error = normalize_workspace_startup_preset(preset, &workspace_root)
            .unwrap_err()
            .to_string();
        assert!(error.contains("existing git repository"));
    }

    #[test]
    fn rejects_worktree_base_dir_that_escapes_workspace() {
        let workspace_root = workspace_root();
        let mut preset = preset();
        preset.terminal.as_mut().unwrap().groups[0].worktree =
            Some(WorkspaceStartupWorktreeConfig {
                enabled: true,
                repo_mode: WorkspaceStartupRepoMode::FixedRepo,
                repo_path: Some("apps/repo".to_string()),
                base_branch: None,
                base_dir: Some("../../../outside-worktrees".to_string()),
                branch_prefix: None,
            });

        let error = normalize_workspace_startup_preset(preset, &workspace_root)
            .unwrap_err()
            .to_string();
        assert!(error.contains("worktree.baseDir must stay inside the workspace root"));
    }

    #[test]
    fn keeps_fixed_repo_base_dir_relative_when_it_stays_inside_workspace() {
        let workspace_root = workspace_root();
        let mut preset = preset();
        preset.terminal.as_mut().unwrap().groups[0].worktree =
            Some(WorkspaceStartupWorktreeConfig {
                enabled: true,
                repo_mode: WorkspaceStartupRepoMode::FixedRepo,
                repo_path: Some("apps/repo".to_string()),
                base_branch: None,
                base_dir: Some("../worktrees".to_string()),
                branch_prefix: None,
            });

        let normalized = normalize_workspace_startup_preset(preset, &workspace_root).unwrap();
        let worktree = normalized
            .terminal
            .unwrap()
            .groups
            .into_iter()
            .next()
            .unwrap()
            .worktree
            .unwrap();

        assert_eq!(worktree.repo_path.as_deref(), Some("apps/repo"));
        assert_eq!(worktree.base_dir.as_deref(), Some("../worktrees"));
    }
}
