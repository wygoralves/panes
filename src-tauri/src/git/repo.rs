use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::Context;
use git2::{ErrorCode, ObjectType, Repository, Status, StatusOptions};

use crate::models::{
    FileTreeEntryDto, FileTreePageDto, GitBranchDto, GitBranchPageDto, GitBranchScopeDto,
    GitChangeTypeDto, GitCommitDto, GitCommitPageDto, GitCompareSourceDto, GitDiffPreviewDto,
    GitFileCompareDto, GitFileStatusDto, GitInitRepoStatusDto, GitStashDto, GitStatusDto,
};
use crate::path_utils;

use super::cli_fallback::run_git;

const FILE_TREE_DEFAULT_PAGE_SIZE: usize = 2000;
const FILE_TREE_MAX_PAGE_SIZE: usize = 5000;
const FILE_TREE_MAX_SCAN_ENTRIES: usize = 50_000;
const FILE_TREE_SCAN_TIMEOUT: Duration = Duration::from_secs(2);
const FILE_TREE_CACHE_TTL: Duration = Duration::from_secs(30);

const GIT_BRANCH_MAX_PAGE_SIZE: usize = 1000;
const GIT_COMMIT_MAX_PAGE_SIZE: usize = 200;
const GIT_DIFF_PREVIEW_MAX_BYTES: usize = 512 * 1024;
const GIT_DIFF_PREVIEW_MAX_LINES: usize = 10_000;
const GIT_COMPARE_BINARY_SCAN_SIZE: usize = 8192;

const GIT_RECORD_SEPARATOR: char = '\u{1e}';
const GIT_FIELD_SEPARATOR: char = '\u{1f}';

#[derive(Clone, Copy)]
enum FileTreeScanMode {
    Repo,
    Workspace,
}

// ── File Tree Cache ────────────────────────────────────────────

struct FileTreeCacheEntry {
    entries: Arc<Vec<FileTreeEntryDto>>,
    truncated: bool,
    populated_at: Instant,
}

pub struct FileTreeCache {
    inner: Mutex<HashMap<String, FileTreeCacheEntry>>,
}

impl FileTreeCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }

    fn prune_expired_locked(map: &mut HashMap<String, FileTreeCacheEntry>) {
        map.retain(|_, entry| entry.populated_at.elapsed() < FILE_TREE_CACHE_TTL);
    }

    fn get(&self, repo_path: &str) -> Option<(Arc<Vec<FileTreeEntryDto>>, bool)> {
        let mut map = self.inner.lock().unwrap();
        Self::prune_expired_locked(&mut map);
        let entry = map.get(repo_path)?;
        Some((Arc::clone(&entry.entries), entry.truncated))
    }

    fn insert(
        &self,
        repo_path: &str,
        entries: Vec<FileTreeEntryDto>,
        truncated: bool,
    ) -> Arc<Vec<FileTreeEntryDto>> {
        let arc = Arc::new(entries);
        let mut map = self.inner.lock().unwrap();
        Self::prune_expired_locked(&mut map);
        map.insert(
            repo_path.to_string(),
            FileTreeCacheEntry {
                entries: Arc::clone(&arc),
                truncated,
                populated_at: Instant::now(),
            },
        );
        arc
    }

    pub fn invalidate_workspace(&self, root_path: &str) {
        let mut map = self.inner.lock().unwrap();
        map.remove(&file_tree_cache_key(root_path, FileTreeScanMode::Workspace));
    }

    pub fn invalidate_containing_path(&self, path: &str) {
        let normalized_path = path_utils::normalize_windows_path_string(path);
        let mut map = self.inner.lock().unwrap();
        map.retain(|key, _| {
            let cache_root = if let Some(workspace_root) = workspace_root_from_cache_key(key) {
                workspace_root
            } else {
                key.as_str()
            };

            !path_utils::is_path_within_root(&normalized_path, cache_root)
                && !path_utils::is_path_within_root(cache_root, &normalized_path)
        });
    }
}

pub fn get_git_status(repo_path: &str) -> anyhow::Result<GitStatusDto> {
    get_git_status_via_cli(repo_path).or_else(|error| {
        log::debug!("falling back to git2 status for {repo_path}: {error}");
        get_git_status_via_git2(repo_path)
    })
}

fn get_git_status_via_cli(repo_path: &str) -> anyhow::Result<GitStatusDto> {
    let output = run_git(
        repo_path,
        &[
            "status",
            "--porcelain=v1",
            "-b",
            "-z",
            "--untracked-files=normal",
        ],
    )
    .context("failed to read git status via cli")?;

    parse_porcelain_v1_status(&output)
}

fn parse_porcelain_v1_status(output: &str) -> anyhow::Result<GitStatusDto> {
    let mut branch = "detached".to_string();
    let mut ahead = 0usize;
    let mut behind = 0usize;
    let mut files = Vec::new();
    let mut records = output.split('\0').filter(|record| !record.is_empty());

    while let Some(record) = records.next() {
        if let Some(header) = record.strip_prefix("## ") {
            let parsed = parse_porcelain_branch_header(header);
            branch = parsed.0;
            ahead = parsed.1;
            behind = parsed.2;
            continue;
        }

        if let Some((file, consumes_next_path)) = parse_porcelain_status_record(record) {
            files.push(file);
            if consumes_next_path {
                let _ = records.next();
            }
        }
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(GitStatusDto {
        branch,
        files,
        ahead,
        behind,
    })
}

fn parse_porcelain_branch_header(header: &str) -> (String, usize, usize) {
    let branch = if let Some(branch) = header.strip_prefix("No commits yet on ") {
        branch
    } else if let Some(branch) = header.strip_prefix("Initial commit on ") {
        branch
    } else if header.starts_with("HEAD ") {
        "detached"
    } else {
        header
            .split("...")
            .next()
            .and_then(|value| value.split(" [").next())
            .unwrap_or(header)
    };

    let (ahead, behind) = header
        .split_once('[')
        .and_then(|(_, rest)| {
            rest.split_once(']')
                .map(|(track, _)| parse_upstream_track(track))
        })
        .unwrap_or((0, 0));

    (branch.trim().to_string(), ahead, behind)
}

fn parse_porcelain_status_record(record: &str) -> Option<(GitFileStatusDto, bool)> {
    let mut chars = record.chars();
    let index_code = chars.next()?;
    let worktree_code = chars.next()?;
    if chars.next()? != ' ' {
        return None;
    }

    let path = chars.as_str();
    if path.is_empty() {
        return None;
    }

    let conflicted = is_porcelain_conflicted(index_code, worktree_code);
    let index_status = if conflicted {
        Some("conflicted".to_string())
    } else {
        porcelain_index_status_label(index_code)
    };
    let worktree_status = if conflicted {
        Some("conflicted".to_string())
    } else {
        porcelain_worktree_status_label(worktree_code)
    };

    if index_status.is_none() && worktree_status.is_none() {
        return None;
    }

    Some((
        GitFileStatusDto {
            path: path.to_string(),
            index_status,
            worktree_status,
        },
        matches!(index_code, 'R' | 'C') || matches!(worktree_code, 'R' | 'C'),
    ))
}

fn is_porcelain_conflicted(index_code: char, worktree_code: char) -> bool {
    matches!(
        (index_code, worktree_code),
        ('D', 'D') | ('A', 'U') | ('U', 'D') | ('U', 'A') | ('D', 'U') | ('A', 'A') | ('U', 'U')
    ) || index_code == 'U'
        || worktree_code == 'U'
}

fn porcelain_index_status_label(code: char) -> Option<String> {
    match code {
        'A' => Some("added".to_string()),
        'M' | 'T' => Some("modified".to_string()),
        'D' => Some("deleted".to_string()),
        'R' | 'C' => Some("renamed".to_string()),
        _ => None,
    }
}

fn porcelain_worktree_status_label(code: char) -> Option<String> {
    match code {
        '?' => Some("untracked".to_string()),
        'A' => Some("added".to_string()),
        'M' | 'T' => Some("modified".to_string()),
        'D' => Some("deleted".to_string()),
        'R' | 'C' => Some("renamed".to_string()),
        _ => None,
    }
}

fn get_git_status_via_git2(repo_path: &str) -> anyhow::Result<GitStatusDto> {
    let repo = Repository::open(repo_path).context("failed to open repository")?;

    let branch = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(ToOwned::to_owned))
        .unwrap_or_else(|| "detached".to_string());

    let (ahead, behind) = resolve_branch_ahead_behind(&repo);

    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .include_unmodified(false)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true)
        .recurse_untracked_dirs(true);

    let statuses = repo
        .statuses(Some(&mut options))
        .context("failed to read git status")?;
    let mut files = Vec::new();

    for entry in statuses.iter() {
        let status = entry.status();
        let Some(path) = entry.path() else {
            continue;
        };

        let index_status = index_status_label(status);
        let worktree_status = worktree_status_label(status);
        if index_status.is_none() && worktree_status.is_none() {
            continue;
        }

        files.push(GitFileStatusDto {
            path: path.to_string(),
            index_status,
            worktree_status,
        });
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(GitStatusDto {
        branch,
        files,
        ahead,
        behind,
    })
}

pub fn get_file_diff(
    repo_path: &str,
    file_path: &str,
    staged: bool,
) -> anyhow::Result<GitDiffPreviewDto> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--staged");
    }
    args.push("--");
    args.push(file_path);

    let raw = run_git(repo_path, &args)?;
    Ok(build_diff_preview(raw))
}

pub fn get_git_file_compare(
    repo_path: &str,
    file_path: &str,
    source: GitCompareSourceDto,
) -> anyhow::Result<GitFileCompareDto> {
    let repo = Repository::open(repo_path).context("failed to open repository")?;
    let status = repo
        .status_file(Path::new(file_path))
        .unwrap_or_else(|_| Status::empty());
    let has_staged_changes = index_status_label(status).is_some();
    let has_unstaged_changes = worktree_status_label(status).is_some();
    let change_type = git_change_type_for_source(status, source)
        .or_else(|| git_change_type_from_status(status))
        .unwrap_or(GitChangeTypeDto::Modified);

    let (base_label, base_bytes) = match source {
        GitCompareSourceDto::Changes => {
            ("Index".to_string(), read_index_content(&repo, file_path)?)
        }
        GitCompareSourceDto::Staged => ("HEAD".to_string(), read_head_content(&repo, file_path)?),
    };
    let modified_label = "Working Tree".to_string();
    let modified_bytes = read_worktree_content(repo_path, file_path)?;

    let is_binary = base_bytes.as_deref().is_some_and(is_binary_content)
        || modified_bytes.as_deref().is_some_and(is_binary_content);

    let is_deleted = matches!(change_type, GitChangeTypeDto::Deleted);
    let is_conflicted = matches!(change_type, GitChangeTypeDto::Conflicted);
    let is_editable = !is_binary && !is_deleted && !is_conflicted;
    let fallback_reason = if is_binary {
        Some("Editable diff unavailable for binary files.".to_string())
    } else if is_conflicted {
        Some("Editable diff unavailable while this file is conflicted.".to_string())
    } else {
        None
    };

    Ok(GitFileCompareDto {
        source,
        base_content: decode_compare_content(base_bytes.as_deref()),
        modified_content: decode_compare_content(modified_bytes.as_deref()),
        base_label,
        modified_label,
        change_type,
        has_staged_changes,
        has_unstaged_changes,
        is_binary,
        is_editable: Some(is_editable),
        fallback_reason,
    })
}

pub fn stage_files(repo_path: &str, files: &[String]) -> anyhow::Result<()> {
    if files.is_empty() {
        return Ok(());
    }

    let mut args = vec!["add", "--"];
    let file_refs: Vec<&str> = files.iter().map(|item| item.as_str()).collect();
    args.extend(file_refs);
    run_git(repo_path, &args)?;
    Ok(())
}

pub fn unstage_files(repo_path: &str, files: &[String]) -> anyhow::Result<()> {
    if files.is_empty() {
        return Ok(());
    }

    let mut args = vec!["restore", "--staged", "--"];
    let file_refs: Vec<&str> = files.iter().map(|item| item.as_str()).collect();
    args.extend(file_refs);
    run_git(repo_path, &args)?;
    Ok(())
}

pub fn discard_files(repo_path: &str, files: &[String]) -> anyhow::Result<()> {
    if files.is_empty() {
        return Ok(());
    }

    let repo = Repository::open(repo_path).context("failed to open repository")?;
    let mut tracked = Vec::new();
    let mut untracked = Vec::new();

    for f in files {
        let path = std::path::Path::new(f);
        let status = repo.status_file(path).unwrap_or(Status::empty());
        if status.contains(Status::WT_NEW) {
            untracked.push(f.as_str());
        } else {
            tracked.push(f.as_str());
        }
    }

    if !tracked.is_empty() {
        let mut args = vec!["checkout", "--"];
        args.extend(&tracked);
        run_git(repo_path, &args)?;
    }

    if !untracked.is_empty() {
        let mut args = vec!["clean", "-fd", "--"];
        args.extend(&untracked);
        run_git(repo_path, &args)?;
    }

    Ok(())
}

pub fn commit(repo_path: &str, message: &str) -> anyhow::Result<String> {
    run_git(repo_path, &["commit", "-m", message])?;
    let hash = run_git(repo_path, &["rev-parse", "HEAD"])?;
    Ok(hash.trim().to_string())
}

pub fn soft_reset_last_commit(repo_path: &str) -> anyhow::Result<()> {
    run_git(repo_path, &["reset", "--soft", "HEAD~1"])
        .context("failed to soft reset last commit")?;
    Ok(())
}

pub fn fetch_repo(repo_path: &str) -> anyhow::Result<()> {
    run_git(repo_path, &["fetch", "--all", "--prune"]).context("failed to fetch from remotes")?;
    Ok(())
}

pub fn pull_repo(repo_path: &str) -> anyhow::Result<()> {
    match run_git(repo_path, &["pull", "--ff-only"]) {
        Ok(_) => Ok(()),
        Err(error) => {
            if is_no_upstream_error(&error) {
                anyhow::bail!(
                    "current branch has no upstream configured; checkout a tracking branch or push with upstream first"
                );
            }
            Err(error).context("failed to pull current branch")
        }
    }
}

pub fn push_repo(repo_path: &str) -> anyhow::Result<()> {
    match run_git(repo_path, &["push"]) {
        Ok(_) => Ok(()),
        Err(error) => {
            if !is_no_upstream_error(&error) {
                return Err(error).context("failed to push current branch");
            }

            let repo = Repository::open(repo_path).context("failed to open repository")?;
            let branch_name = current_branch_name(&repo).ok_or_else(|| {
                anyhow::anyhow!("detached HEAD; checkout a local branch before pushing")
            })?;
            let remote_name = default_remote_name(&repo)
                .ok_or_else(|| anyhow::anyhow!("no git remote configured for this repository"))?;

            let push_args = [
                "push",
                "--set-upstream",
                remote_name.as_str(),
                branch_name.as_str(),
            ];
            run_git(repo_path, &push_args)
                .context("failed to push current branch and set upstream")?;
            Ok(())
        }
    }
}

pub fn list_git_branches(
    repo_path: &str,
    scope: GitBranchScopeDto,
    offset: usize,
    limit: usize,
    search: Option<&str>,
) -> anyhow::Result<GitBranchPageDto> {
    let limit = limit.clamp(1, GIT_BRANCH_MAX_PAGE_SIZE);
    let branch_ref = match scope {
        GitBranchScopeDto::Local => "refs/heads",
        GitBranchScopeDto::Remote => "refs/remotes",
    };

    let format = format!(
        "%(refname:short){f}%(refname){f}%(upstream:short){f}%(upstream:track){f}%(committerdate:iso-strict){r}",
        f = GIT_FIELD_SEPARATOR,
        r = GIT_RECORD_SEPARATOR
    );
    let format_arg = format!("--format={format}");
    let output = run_git(
        repo_path,
        &["for-each-ref", branch_ref, format_arg.as_str()],
    )
    .context("failed to list git branches")?;

    let current_branch = Repository::open(repo_path).ok().and_then(|repo| {
        let head = repo.head().ok()?;
        if !head.is_branch() {
            return None;
        }
        head.shorthand().map(ToOwned::to_owned)
    });

    let mut entries = Vec::new();
    for record in output.split(GIT_RECORD_SEPARATOR) {
        let trimmed = record.trim();
        if trimmed.is_empty() {
            continue;
        }

        let fields: Vec<&str> = trimmed.split(GIT_FIELD_SEPARATOR).collect();
        if fields.len() < 5 {
            continue;
        }

        let name = fields[0].trim().to_string();
        if name.is_empty() {
            continue;
        }

        if matches!(scope, GitBranchScopeDto::Remote) && name.ends_with("/HEAD") {
            continue;
        }

        let full_name = fields[1].trim().to_string();
        let upstream = non_empty_string(fields[2]);
        let (ahead, behind) = parse_upstream_track(fields[3]);
        let last_commit_at = non_empty_string(fields[4]);

        let is_remote = matches!(scope, GitBranchScopeDto::Remote);
        let is_current = !is_remote
            && current_branch
                .as_ref()
                .is_some_and(|current| current == &name);

        entries.push(GitBranchDto {
            name,
            full_name,
            is_current,
            is_remote,
            upstream,
            ahead,
            behind,
            last_commit_at,
        });
    }

    entries.sort_by(|a, b| match (a.is_current, b.is_current) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.cmp(&b.name),
    });

    let entries: Vec<GitBranchDto> = if let Some(q) = search.filter(|s| !s.trim().is_empty()) {
        let q_lower = q.to_lowercase();
        entries
            .into_iter()
            .filter(|b| b.name.to_lowercase().contains(&q_lower))
            .collect()
    } else {
        entries
    };

    let total = entries.len();
    let offset = offset.min(total);
    let end = offset.saturating_add(limit).min(total);
    let page_entries = entries[offset..end].to_vec();

    Ok(GitBranchPageDto {
        entries: page_entries,
        offset,
        limit,
        total,
        has_more: end < total,
    })
}

pub fn checkout_git_branch(
    repo_path: &str,
    branch_name: &str,
    is_remote: bool,
) -> anyhow::Result<()> {
    if is_remote {
        match run_git(repo_path, &["checkout", "--track", branch_name]) {
            Ok(_) => return Ok(()),
            Err(error) => {
                let error_message = error.to_string();
                if !error_message.contains("already exists") {
                    return Err(error).context("failed to checkout remote branch");
                }
            }
        }

        let local_name = branch_name
            .split_once('/')
            .map(|(_, value)| value)
            .unwrap_or(branch_name);
        run_git(repo_path, &["checkout", local_name])
            .context("failed to checkout existing local branch")?;
        return Ok(());
    }

    run_git(repo_path, &["checkout", branch_name]).context("failed to checkout branch")?;
    Ok(())
}

pub fn create_git_branch(
    repo_path: &str,
    branch_name: &str,
    from_ref: Option<&str>,
) -> anyhow::Result<()> {
    if let Some(reference) = from_ref.map(str::trim).filter(|value| !value.is_empty()) {
        run_git(repo_path, &["checkout", "-b", branch_name, reference])
            .context("failed to create git branch")?;
    } else {
        run_git(repo_path, &["checkout", "-b", branch_name])
            .context("failed to create git branch")?;
    }
    Ok(())
}

pub fn rename_git_branch(repo_path: &str, old_name: &str, new_name: &str) -> anyhow::Result<()> {
    run_git(repo_path, &["branch", "-m", old_name, new_name])
        .context("failed to rename git branch")?;
    Ok(())
}

pub fn delete_git_branch(repo_path: &str, branch_name: &str, force: bool) -> anyhow::Result<()> {
    let delete_flag = if force { "-D" } else { "-d" };
    run_git(repo_path, &["branch", delete_flag, branch_name])
        .context("failed to delete git branch")?;
    Ok(())
}

pub fn list_git_commits(
    repo_path: &str,
    offset: usize,
    limit: usize,
) -> anyhow::Result<GitCommitPageDto> {
    let limit = limit.clamp(1, GIT_COMMIT_MAX_PAGE_SIZE);
    let total = count_head_commits(repo_path)?;

    if total == 0 {
        return Ok(GitCommitPageDto {
            entries: Vec::new(),
            offset: 0,
            limit,
            total: 0,
            has_more: false,
        });
    }

    let offset = offset.min(total);
    if offset >= total {
        return Ok(GitCommitPageDto {
            entries: Vec::new(),
            offset,
            limit,
            total,
            has_more: false,
        });
    }

    let skip_arg = format!("--skip={offset}");
    let count_arg = format!("--max-count={limit}");
    let format_arg = format!(
        "--pretty=format:%H{f}%h{f}%an{f}%ae{f}%s{f}%b{f}%cI{r}",
        f = GIT_FIELD_SEPARATOR,
        r = GIT_RECORD_SEPARATOR
    );

    let output = run_git(
        repo_path,
        &[
            "log",
            "HEAD",
            "--date=iso-strict",
            skip_arg.as_str(),
            count_arg.as_str(),
            format_arg.as_str(),
        ],
    )
    .context("failed to list git commits")?;

    let mut entries = Vec::new();
    for record in output.split(GIT_RECORD_SEPARATOR) {
        let trimmed = record.trim();
        if trimmed.is_empty() {
            continue;
        }

        let fields: Vec<&str> = trimmed.split(GIT_FIELD_SEPARATOR).collect();
        if fields.len() < 7 {
            continue;
        }

        entries.push(GitCommitDto {
            hash: fields[0].trim().to_string(),
            short_hash: fields[1].trim().to_string(),
            author_name: fields[2].trim().to_string(),
            author_email: fields[3].trim().to_string(),
            subject: fields[4].trim().to_string(),
            body: fields[5].trim().to_string(),
            authored_at: fields[6].trim().to_string(),
        });
    }

    let loaded = entries.len();

    Ok(GitCommitPageDto {
        entries,
        offset,
        limit,
        total,
        has_more: offset.saturating_add(loaded) < total,
    })
}

pub fn list_git_stashes(repo_path: &str) -> anyhow::Result<Vec<GitStashDto>> {
    let format = format!(
        "%gd{f}%gs{f}%cI{r}",
        f = GIT_FIELD_SEPARATOR,
        r = GIT_RECORD_SEPARATOR
    );
    let format_arg = format!("--format={format}");
    let output = run_git(repo_path, &["stash", "list", format_arg.as_str()])
        .context("failed to list stashes")?;

    let mut entries = Vec::new();
    for record in output.split(GIT_RECORD_SEPARATOR) {
        let trimmed = record.trim();
        if trimmed.is_empty() {
            continue;
        }

        let fields: Vec<&str> = trimmed.split(GIT_FIELD_SEPARATOR).collect();
        if fields.len() < 3 {
            continue;
        }

        let Some(index) = parse_stash_index(fields[0]) else {
            continue;
        };
        let name = fields[1].trim().to_string();
        let created_at = non_empty_string(fields[2]);

        entries.push(GitStashDto {
            index,
            branch_hint: parse_branch_hint(&name),
            name,
            created_at,
        });
    }

    entries.sort_by(|a, b| a.index.cmp(&b.index));
    Ok(entries)
}

pub fn push_git_stash(repo_path: &str, message: Option<&str>) -> anyhow::Result<()> {
    let mut args = vec!["stash", "push"];
    if let Some(msg) = message.filter(|m| !m.trim().is_empty()) {
        args.extend(["-m", msg]);
    }
    run_git(repo_path, &args).context("failed to create stash")?;
    Ok(())
}

pub fn apply_git_stash(repo_path: &str, stash_index: usize) -> anyhow::Result<()> {
    let stash_ref = format!("stash@{{{stash_index}}}");
    run_git(repo_path, &["stash", "apply", stash_ref.as_str()]).context("failed to apply stash")?;
    Ok(())
}

pub fn pop_git_stash(repo_path: &str, stash_index: usize) -> anyhow::Result<()> {
    let stash_ref = format!("stash@{{{stash_index}}}");
    run_git(repo_path, &["stash", "pop", stash_ref.as_str()]).context("failed to pop stash")?;
    Ok(())
}

pub fn get_commit_diff(repo_path: &str, commit_hash: &str) -> anyhow::Result<GitDiffPreviewDto> {
    anyhow::ensure!(
        !commit_hash.is_empty() && commit_hash.chars().all(|c| c.is_ascii_hexdigit()),
        "invalid commit hash"
    );
    let raw = run_git(repo_path, &["diff-tree", "-p", commit_hash])?;
    Ok(build_diff_preview(raw))
}

fn build_diff_preview(raw: String) -> GitDiffPreviewDto {
    let original_bytes = raw.len();
    if raw.is_empty() {
        return GitDiffPreviewDto {
            content: raw,
            truncated: false,
            original_bytes,
            returned_bytes: 0,
        };
    }

    let mut preview = String::with_capacity(original_bytes.min(GIT_DIFF_PREVIEW_MAX_BYTES));
    let mut returned_bytes = 0;
    let mut visible_lines = 0;
    let mut truncated = false;

    for segment in raw.split_inclusive('\n') {
        if visible_lines >= GIT_DIFF_PREVIEW_MAX_LINES {
            truncated = true;
            break;
        }

        if returned_bytes + segment.len() > GIT_DIFF_PREVIEW_MAX_BYTES {
            let remaining_bytes = GIT_DIFF_PREVIEW_MAX_BYTES.saturating_sub(returned_bytes);
            let truncated_segment = truncate_utf8_prefix(segment, remaining_bytes);
            if !truncated_segment.is_empty() {
                preview.push_str(truncated_segment);
                returned_bytes += truncated_segment.len();
            }
            truncated = true;
            break;
        }

        preview.push_str(segment);
        returned_bytes += segment.len();
        if !is_diff_preview_metadata_line(segment.trim_end_matches('\n')) {
            visible_lines += 1;
        }
    }

    if !truncated && preview.len() == original_bytes {
        return GitDiffPreviewDto {
            content: raw,
            truncated: false,
            original_bytes,
            returned_bytes: original_bytes,
        };
    }

    if preview.is_empty() {
        let truncated_raw = truncate_utf8_prefix(&raw, GIT_DIFF_PREVIEW_MAX_BYTES);
        if !truncated_raw.is_empty() {
            preview.push_str(truncated_raw);
            returned_bytes = preview.len();
        }
        truncated = truncated_raw.len() < original_bytes;
    }

    GitDiffPreviewDto {
        content: preview,
        truncated,
        original_bytes,
        returned_bytes,
    }
}

fn truncate_utf8_prefix(value: &str, max_bytes: usize) -> &str {
    if max_bytes >= value.len() {
        return value;
    }

    let mut safe_cut = max_bytes;
    while safe_cut > 0 && !value.is_char_boundary(safe_cut) {
        safe_cut -= 1;
    }

    &value[..safe_cut]
}

fn is_diff_preview_metadata_line(line: &str) -> bool {
    line.starts_with("diff --git")
        || line.starts_with("index ")
        || is_diff_preview_file_header_line(line)
        || line.starts_with("new file")
        || line.starts_with("deleted file")
        || line.starts_with("similarity")
        || line.starts_with("dissimilarity")
        || line.starts_with("rename")
        || line.starts_with("copy ")
        || line.starts_with("old mode")
        || line.starts_with("new mode")
}

fn is_diff_preview_file_header_line(line: &str) -> bool {
    line == "--- /dev/null"
        || line == "+++ /dev/null"
        || line.starts_with("--- a/")
        || line.starts_with("+++ b/")
}

pub fn get_file_tree(
    repo_path: &str,
    cache: &FileTreeCache,
) -> anyhow::Result<Vec<FileTreeEntryDto>> {
    let cache_key = file_tree_cache_key(repo_path, FileTreeScanMode::Repo);
    if let Some((entries, _)) = cache.get(&cache_key) {
        return Ok((*entries).clone());
    }
    let scan = scan_file_tree(repo_path, FileTreeScanMode::Repo)?;
    let arc = cache.insert(&cache_key, scan.entries, scan.truncated);
    Ok((*arc).clone())
}

pub fn get_file_tree_page(
    repo_path: &str,
    offset: usize,
    limit: usize,
    cache: &FileTreeCache,
) -> anyhow::Result<FileTreePageDto> {
    get_cached_file_tree_page(repo_path, offset, limit, FileTreeScanMode::Repo, cache)
}

pub fn get_workspace_file_tree_page(
    root_path: &str,
    offset: usize,
    limit: usize,
    cache: &FileTreeCache,
) -> anyhow::Result<FileTreePageDto> {
    get_cached_file_tree_page(root_path, offset, limit, FileTreeScanMode::Workspace, cache)
}

fn get_cached_file_tree_page(
    root_path: &str,
    offset: usize,
    limit: usize,
    mode: FileTreeScanMode,
    cache: &FileTreeCache,
) -> anyhow::Result<FileTreePageDto> {
    let limit = limit.clamp(1, FILE_TREE_MAX_PAGE_SIZE);
    let cache_key = file_tree_cache_key(root_path, mode);

    let (all_entries, truncated) = if let Some(hit) = cache.get(&cache_key) {
        hit
    } else {
        let scan = scan_file_tree(root_path, mode)?;
        let arc = cache.insert(&cache_key, scan.entries, scan.truncated);
        (arc, scan.truncated)
    };

    let total = all_entries.len();
    let offset = offset.min(total);
    let end = offset.saturating_add(limit).min(total);
    let entries = all_entries[offset..end].to_vec();

    Ok(FileTreePageDto {
        entries,
        offset,
        limit,
        total,
        has_more: end < total,
        scan_truncated: truncated,
    })
}

fn file_tree_cache_key(root_path: &str, mode: FileTreeScanMode) -> String {
    match mode {
        FileTreeScanMode::Repo => root_path.to_string(),
        FileTreeScanMode::Workspace => format!("workspace::{root_path}"),
    }
}

fn workspace_root_from_cache_key(cache_key: &str) -> Option<&str> {
    cache_key.strip_prefix("workspace::")
}

struct FileTreeScanResult {
    entries: Vec<FileTreeEntryDto>,
    truncated: bool,
}

struct FileTreeScanContext {
    entries: Vec<FileTreeEntryDto>,
    scanned_count: usize,
    truncated: bool,
    deadline: Instant,
}

fn scan_file_tree(root_path: &str, mode: FileTreeScanMode) -> anyhow::Result<FileTreeScanResult> {
    let root = PathBuf::from(root_path)
        .canonicalize()
        .context("failed to canonicalize file tree root")?;
    let repo = match mode {
        FileTreeScanMode::Repo => Repository::open(&root).ok(),
        FileTreeScanMode::Workspace => None,
    };
    let mut context = FileTreeScanContext {
        entries: Vec::with_capacity(FILE_TREE_DEFAULT_PAGE_SIZE),
        scanned_count: 0,
        truncated: false,
        deadline: Instant::now() + FILE_TREE_SCAN_TIMEOUT,
    };
    visit_dir(&root, &root, repo.as_ref(), &mut context)?;
    context.entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(FileTreeScanResult {
        entries: context.entries,
        truncated: context.truncated,
    })
}

fn visit_dir(
    root: &PathBuf,
    current: &PathBuf,
    repo: Option<&Repository>,
    context: &mut FileTreeScanContext,
) -> anyhow::Result<()> {
    if Instant::now() >= context.deadline {
        context.truncated = true;
        return Ok(());
    }

    for entry in fs::read_dir(current).context("failed reading dir for file tree")? {
        if context.truncated {
            break;
        }

        if context.scanned_count >= FILE_TREE_MAX_SCAN_ENTRIES {
            context.truncated = true;
            break;
        }

        if Instant::now() >= context.deadline {
            context.truncated = true;
            break;
        }

        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();

        if path.file_name().is_some_and(|name| name == ".git") {
            continue;
        }

        if path.is_symlink() {
            let Ok(canonical) = path.canonicalize() else {
                continue;
            };
            if !canonical.starts_with(root) {
                continue;
            }
        }

        let relative = path
            .strip_prefix(root)
            .map(|item| item.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string_lossy().to_string());

        // Skip gitignored paths
        if let Some(repo) = repo {
            if repo.is_path_ignored(&relative).unwrap_or(false) {
                continue;
            }
        }

        context.scanned_count += 1;

        if path.is_dir() {
            context.entries.push(FileTreeEntryDto {
                path: relative.clone(),
                is_dir: true,
            });
            visit_dir(root, &path, repo, context)?;
        } else {
            context.entries.push(FileTreeEntryDto {
                path: relative,
                is_dir: false,
            });
        }
    }

    Ok(())
}

fn resolve_branch_ahead_behind(repo: &Repository) -> (usize, usize) {
    let head = match repo.head() {
        Ok(value) => value,
        Err(_) => return (0, 0),
    };

    if !head.is_branch() {
        return (0, 0);
    }

    let Some(local_oid) = head.target() else {
        return (0, 0);
    };

    let Some(local_name) = head.shorthand() else {
        return (0, 0);
    };

    let upstream_oid = repo
        .find_branch(local_name, git2::BranchType::Local)
        .ok()
        .and_then(|branch| branch.upstream().ok())
        .and_then(|branch| branch.get().target());

    let Some(upstream_oid) = upstream_oid else {
        return (0, 0);
    };

    repo.graph_ahead_behind(local_oid, upstream_oid)
        .unwrap_or((0, 0))
}

fn current_branch_name(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if !head.is_branch() {
        return None;
    }
    head.shorthand().map(ToOwned::to_owned)
}

fn default_remote_name(repo: &Repository) -> Option<String> {
    let remotes = repo.remotes().ok()?;
    if remotes.iter().flatten().any(|name| name == "origin") {
        return Some("origin".to_string());
    }
    remotes.iter().flatten().next().map(ToOwned::to_owned)
}

fn count_head_commits(repo_path: &str) -> anyhow::Result<usize> {
    match run_git(repo_path, &["rev-list", "--count", "HEAD"]) {
        Ok(output) => Ok(output.trim().parse::<usize>().unwrap_or(0)),
        Err(error) => {
            if is_missing_head_error(&error) {
                Ok(0)
            } else {
                Err(error).context("failed to count git commits")
            }
        }
    }
}

fn parse_upstream_track(track: &str) -> (usize, usize) {
    let track = track.trim().trim_matches(['[', ']']);
    if track.is_empty() {
        return (0, 0);
    }

    let mut ahead = 0;
    let mut behind = 0;

    for part in track.split(',').map(str::trim) {
        if let Some(value) = part.strip_prefix("ahead ") {
            ahead = value.trim().parse::<usize>().unwrap_or(0);
            continue;
        }
        if let Some(value) = part.strip_prefix("behind ") {
            behind = value.trim().parse::<usize>().unwrap_or(0);
        }
    }

    (ahead, behind)
}

fn parse_stash_index(stash_ref: &str) -> Option<usize> {
    stash_ref
        .trim()
        .strip_prefix("stash@{")?
        .strip_suffix('}')?
        .parse::<usize>()
        .ok()
}

fn parse_branch_hint(stash_name: &str) -> Option<String> {
    let message = stash_name.trim();

    if let Some(rest) = message.strip_prefix("WIP on ") {
        let branch = rest.split(':').next()?.trim();
        if branch.is_empty() {
            return None;
        }
        return Some(branch.to_string());
    }

    if let Some(rest) = message.strip_prefix("On ") {
        let branch = rest.split(':').next()?.trim();
        if branch.is_empty() {
            return None;
        }
        return Some(branch.to_string());
    }

    None
}

fn git_change_type_for_source(
    status: Status,
    source: GitCompareSourceDto,
) -> Option<GitChangeTypeDto> {
    match source {
        GitCompareSourceDto::Changes => {
            if status.contains(Status::CONFLICTED) {
                return Some(GitChangeTypeDto::Conflicted);
            }
            if status.contains(Status::WT_NEW) {
                return Some(GitChangeTypeDto::Untracked);
            }
            if status.contains(Status::WT_DELETED) {
                return Some(GitChangeTypeDto::Deleted);
            }
            if status.contains(Status::WT_RENAMED) {
                return Some(GitChangeTypeDto::Renamed);
            }
            if status.contains(Status::WT_MODIFIED) || status.contains(Status::WT_TYPECHANGE) {
                return Some(GitChangeTypeDto::Modified);
            }
        }
        GitCompareSourceDto::Staged => {
            if status.contains(Status::CONFLICTED) {
                return Some(GitChangeTypeDto::Conflicted);
            }
            if status.contains(Status::INDEX_NEW) {
                return Some(GitChangeTypeDto::Added);
            }
            if status.contains(Status::INDEX_DELETED) {
                return Some(GitChangeTypeDto::Deleted);
            }
            if status.contains(Status::INDEX_RENAMED) {
                return Some(GitChangeTypeDto::Renamed);
            }
            if status.contains(Status::INDEX_MODIFIED) || status.contains(Status::INDEX_TYPECHANGE)
            {
                return Some(GitChangeTypeDto::Modified);
            }
        }
    }
    None
}

fn git_change_type_from_status(status: Status) -> Option<GitChangeTypeDto> {
    if status.contains(Status::CONFLICTED) {
        return Some(GitChangeTypeDto::Conflicted);
    }
    if status.contains(Status::WT_NEW) {
        return Some(GitChangeTypeDto::Untracked);
    }
    if status.contains(Status::INDEX_NEW) {
        return Some(GitChangeTypeDto::Added);
    }
    if status.contains(Status::WT_DELETED) || status.contains(Status::INDEX_DELETED) {
        return Some(GitChangeTypeDto::Deleted);
    }
    if status.contains(Status::WT_RENAMED) || status.contains(Status::INDEX_RENAMED) {
        return Some(GitChangeTypeDto::Renamed);
    }
    if status.contains(Status::WT_MODIFIED)
        || status.contains(Status::WT_TYPECHANGE)
        || status.contains(Status::INDEX_MODIFIED)
        || status.contains(Status::INDEX_TYPECHANGE)
    {
        return Some(GitChangeTypeDto::Modified);
    }
    None
}

fn read_index_content(repo: &Repository, file_path: &str) -> anyhow::Result<Option<Vec<u8>>> {
    let index = repo.index().context("failed to read git index")?;
    let Some(entry) = index.get_path(Path::new(file_path), 0) else {
        return Ok(None);
    };
    let blob = repo
        .find_blob(entry.id)
        .context("failed to read index blob")?;
    Ok(Some(blob.content().to_vec()))
}

fn read_head_content(repo: &Repository, file_path: &str) -> anyhow::Result<Option<Vec<u8>>> {
    let head = match repo.head() {
        Ok(head) => head,
        Err(error)
            if error.code() == ErrorCode::UnbornBranch || error.code() == ErrorCode::NotFound =>
        {
            return Ok(None);
        }
        Err(error) => return Err(error).context("failed to resolve HEAD"),
    };
    let tree = head.peel_to_tree().context("failed to resolve HEAD tree")?;
    let entry = match tree.get_path(Path::new(file_path)) {
        Ok(entry) => entry,
        Err(error) if error.code() == ErrorCode::NotFound => return Ok(None),
        Err(error) => return Err(error).context("failed to read file from HEAD"),
    };
    if entry.kind() != Some(ObjectType::Blob) {
        return Ok(None);
    }
    let blob = repo
        .find_blob(entry.id())
        .context("failed to read HEAD blob")?;
    Ok(Some(blob.content().to_vec()))
}

fn read_worktree_content(repo_path: &str, file_path: &str) -> anyhow::Result<Option<Vec<u8>>> {
    let repo_root = PathBuf::from(repo_path)
        .canonicalize()
        .context("failed to canonicalize repo path")?;
    let target = repo_root.join(file_path);

    if !target.exists() {
        return Ok(None);
    }

    let canonical = target
        .canonicalize()
        .context("failed to resolve file path")?;
    anyhow::ensure!(
        canonical.starts_with(&repo_root),
        "path traversal not allowed"
    );
    let bytes = fs::read(&canonical).context("failed to read working tree file")?;
    Ok(Some(bytes))
}

fn is_binary_content(content: &[u8]) -> bool {
    content
        .iter()
        .take(GIT_COMPARE_BINARY_SCAN_SIZE)
        .any(|&byte| byte == 0)
}

fn decode_compare_content(content: Option<&[u8]>) -> String {
    content
        .map(|value| String::from_utf8_lossy(value).to_string())
        .unwrap_or_default()
}

fn index_status_label(status: Status) -> Option<String> {
    if status.contains(Status::CONFLICTED) {
        return Some("conflicted".to_string());
    }
    if status.contains(Status::INDEX_NEW) {
        return Some("added".to_string());
    }
    if status.contains(Status::INDEX_MODIFIED) || status.contains(Status::INDEX_TYPECHANGE) {
        return Some("modified".to_string());
    }
    if status.contains(Status::INDEX_DELETED) {
        return Some("deleted".to_string());
    }
    if status.contains(Status::INDEX_RENAMED) {
        return Some("renamed".to_string());
    }
    None
}

fn worktree_status_label(status: Status) -> Option<String> {
    if status.contains(Status::CONFLICTED) {
        return Some("conflicted".to_string());
    }
    if status.contains(Status::WT_NEW) {
        return Some("untracked".to_string());
    }
    if status.contains(Status::WT_MODIFIED) || status.contains(Status::WT_TYPECHANGE) {
        return Some("modified".to_string());
    }
    if status.contains(Status::WT_DELETED) {
        return Some("deleted".to_string());
    }
    if status.contains(Status::WT_RENAMED) {
        return Some("renamed".to_string());
    }
    None
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn is_missing_head_error(error: &anyhow::Error) -> bool {
    let text = error.to_string();
    text.contains("unknown revision")
        || text.contains("ambiguous argument 'HEAD'")
        || text.contains("does not have any commits yet")
}

fn is_no_upstream_error(error: &anyhow::Error) -> bool {
    let text = error.to_string().to_lowercase();
    text.contains("has no upstream branch")
        || text.contains("no upstream configured")
        || text.contains("no tracking information")
        || text.contains("set-upstream")
}

// ── Init & Remote Management ─────────────────────────────────────────

pub fn inspect_init_repo(path: &str) -> anyhow::Result<GitInitRepoStatusDto> {
    let target_path = fs::canonicalize(path).context("failed to resolve repository path")?;
    let discovered_repo = match Repository::discover(&target_path) {
        Ok(repo) => repo,
        Err(error) if error.code() == ErrorCode::NotFound => {
            return Ok(GitInitRepoStatusDto {
                can_initialize: true,
                blocking_repo_path: None,
            });
        }
        Err(error) => return Err(error).context("failed to inspect ancestor repositories"),
    };

    let blocking_repo_path = discovered_repo
        .workdir()
        .map(PathBuf::from)
        .unwrap_or_else(|| discovered_repo.path().to_path_buf());
    let blocking_repo_path = fs::canonicalize(&blocking_repo_path)
        .unwrap_or(blocking_repo_path)
        .to_string_lossy()
        .to_string();

    Ok(GitInitRepoStatusDto {
        can_initialize: false,
        blocking_repo_path: Some(blocking_repo_path),
    })
}

pub fn init_repo(path: &str, validate_only: bool) -> anyhow::Result<GitInitRepoStatusDto> {
    let status = inspect_init_repo(path)?;
    if validate_only {
        return Ok(status);
    }

    if !status.can_initialize {
        let blocking_path = status.blocking_repo_path.as_deref().unwrap_or(path);
        anyhow::bail!(
            "cannot initialize a repository inside an existing git repository: {blocking_path}"
        );
    }

    run_git(path, &["init"]).context("failed to initialize git repository")?;
    Ok(status)
}

pub fn list_remotes(repo_path: &str) -> anyhow::Result<Vec<crate::models::GitRemoteDto>> {
    let repo = Repository::open(repo_path).context("failed to open repository")?;
    let remote_names = repo.remotes().context("failed to list remotes")?;
    let mut remotes = Vec::new();
    for name in remote_names.iter().flatten() {
        if let Ok(remote) = repo.find_remote(name) {
            remotes.push(crate::models::GitRemoteDto {
                name: name.to_string(),
                url: remote.url().unwrap_or("").to_string(),
            });
        }
    }
    Ok(remotes)
}

pub fn add_remote(repo_path: &str, name: &str, url: &str) -> anyhow::Result<()> {
    run_git(repo_path, &["remote", "add", name, url]).context("failed to add remote")?;
    Ok(())
}

pub fn remove_remote(repo_path: &str, name: &str) -> anyhow::Result<()> {
    run_git(repo_path, &["remote", "remove", name]).context("failed to remove remote")?;
    Ok(())
}

pub fn rename_remote(repo_path: &str, old_name: &str, new_name: &str) -> anyhow::Result<()> {
    run_git(repo_path, &["remote", "rename", old_name, new_name])
        .context("failed to rename remote")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        build_diff_preview, get_workspace_file_tree_page, is_diff_preview_metadata_line,
        parse_porcelain_v1_status, truncate_utf8_prefix, FileTreeCache, GIT_DIFF_PREVIEW_MAX_BYTES,
        GIT_DIFF_PREVIEW_MAX_LINES,
    };
    use crate::models::FileTreeEntryDto;
    use uuid::Uuid;

    #[test]
    fn parses_porcelain_status_branch_and_file_states() {
        let output = concat!(
            "## main...origin/main [ahead 2, behind 1]\0",
            " M src/app.ts\0",
            "M  src/staged.ts\0",
            "A  src/added.ts\0",
            "D  src/deleted.ts\0",
            "R  src/new-name.ts\0src/old-name.ts\0",
            "?? src/new-file.ts\0",
        );

        let status = parse_porcelain_v1_status(output).expect("status should parse");

        assert_eq!(status.branch, "main");
        assert_eq!(status.ahead, 2);
        assert_eq!(status.behind, 1);
        assert_eq!(
            status
                .files
                .iter()
                .map(|file| (
                    file.path.as_str(),
                    file.index_status.as_deref(),
                    file.worktree_status.as_deref(),
                ))
                .collect::<Vec<_>>(),
            vec![
                ("src/added.ts", Some("added"), None),
                ("src/app.ts", None, Some("modified")),
                ("src/deleted.ts", Some("deleted"), None),
                ("src/new-file.ts", None, Some("untracked")),
                ("src/new-name.ts", Some("renamed"), None),
                ("src/staged.ts", Some("modified"), None),
            ]
        );
    }

    #[test]
    fn parses_porcelain_conflicts_as_both_sides_conflicted() {
        let output = "## HEAD (no branch)\0UU src/conflict.ts\0";

        let status = parse_porcelain_v1_status(output).expect("status should parse");

        assert_eq!(status.branch, "detached");
        assert_eq!(status.files.len(), 1);
        assert_eq!(status.files[0].path, "src/conflict.ts");
        assert_eq!(status.files[0].index_status.as_deref(), Some("conflicted"));
        assert_eq!(
            status.files[0].worktree_status.as_deref(),
            Some("conflicted")
        );
    }

    #[test]
    fn parses_porcelain_unborn_branch() {
        let output = "## No commits yet on feature/start\0?? README.md\0";

        let status = parse_porcelain_v1_status(output).expect("status should parse");

        assert_eq!(status.branch, "feature/start");
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
        assert_eq!(status.files[0].path, "README.md");
        assert_eq!(
            status.files[0].worktree_status.as_deref(),
            Some("untracked")
        );
    }

    #[test]
    fn keeps_small_diffs_untruncated() {
        let raw = "diff --git a/file.txt b/file.txt\n@@ -1 +1 @@\n-old\n+new\n".to_string();
        let preview = build_diff_preview(raw.clone());

        assert!(!preview.truncated);
        assert_eq!(preview.content, raw);
        assert_eq!(preview.original_bytes, raw.len());
        assert_eq!(preview.returned_bytes, raw.len());
    }

    #[test]
    fn truncates_large_diffs_by_byte_limit() {
        let raw = format!(
            "diff --git a/file.txt b/file.txt\n{}",
            "+0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n"
                .repeat((GIT_DIFF_PREVIEW_MAX_BYTES / 64) + 32)
        );
        let preview = build_diff_preview(raw);

        assert!(preview.truncated);
        assert!(preview.returned_bytes <= GIT_DIFF_PREVIEW_MAX_BYTES);
        assert_eq!(preview.returned_bytes, preview.content.len());
        assert!(preview.original_bytes > preview.returned_bytes);
    }

    #[test]
    fn keeps_prefix_of_oversized_changed_line() {
        let raw = format!(
            "diff --git a/file.txt b/file.txt\n@@ -0,0 +1 @@\n+{}\n",
            "x".repeat(GIT_DIFF_PREVIEW_MAX_BYTES)
        );
        let preview = build_diff_preview(raw);

        assert!(preview.truncated);
        assert!(preview.returned_bytes <= GIT_DIFF_PREVIEW_MAX_BYTES);
        assert_eq!(preview.returned_bytes, preview.content.len());
        assert!(preview.content.contains("@@ -0,0 +1 @@\n+"));
        assert!(preview
            .content
            .lines()
            .any(|line| line.starts_with('+') && line.len() > 1));
    }

    #[test]
    fn truncates_large_diffs_by_line_limit() {
        let mut raw = String::from("diff --git a/file.txt b/file.txt\n");
        for index in 0..(GIT_DIFF_PREVIEW_MAX_LINES + 50) {
            raw.push_str(&format!("+line-{index}\n"));
        }

        let preview = build_diff_preview(raw);

        assert!(preview.truncated);
        assert_eq!(
            preview
                .content
                .lines()
                .filter(|line| !is_diff_preview_metadata_line(line))
                .count(),
            GIT_DIFF_PREVIEW_MAX_LINES
        );
        assert!(preview.original_bytes > preview.returned_bytes);
    }

    #[test]
    fn line_limit_ignores_copy_and_dissimilarity_metadata() {
        let mut raw = String::from("diff --git a/file.txt b/file.txt\n");
        for index in 0..(GIT_DIFF_PREVIEW_MAX_LINES + 50) {
            match index % 3 {
                0 => raw.push_str(&format!("copy from old-{index}\n")),
                1 => raw.push_str(&format!("copy to new-{index}\n")),
                _ => raw.push_str("dissimilarity index 99%\n"),
            }
        }
        raw.push_str("@@ -0,0 +1,10050 @@\n");
        for index in 0..(GIT_DIFF_PREVIEW_MAX_LINES + 50) {
            raw.push_str(&format!("+line-{index}\n"));
        }

        let preview = build_diff_preview(raw);

        assert!(preview.truncated);
        assert!(preview.content.contains("@@ -0,0 +1,10050 @@"));
        assert!(preview.content.contains("+line-0\n"));
        assert_eq!(
            preview
                .content
                .lines()
                .filter(|line| !is_diff_preview_metadata_line(line))
                .count(),
            GIT_DIFF_PREVIEW_MAX_LINES
        );
    }

    #[test]
    fn line_limit_preserves_hunks_after_metadata_heavy_prefix() {
        let mut raw = String::new();
        for index in 0..(GIT_DIFF_PREVIEW_MAX_LINES + 50) {
            raw.push_str(&format!("rename from old-{index}\n"));
        }
        raw.push_str("diff --git a/file.txt b/file.txt\n");
        raw.push_str("index 1111111..2222222 100644\n");
        raw.push_str("--- a/file.txt\n");
        raw.push_str("+++ b/file.txt\n");
        raw.push_str("@@ -0,0 +1,10050 @@\n");
        for index in 0..(GIT_DIFF_PREVIEW_MAX_LINES + 50) {
            raw.push_str(&format!("+line-{index}\n"));
        }

        let preview = build_diff_preview(raw);

        assert!(preview.truncated);
        assert!(preview.content.contains("@@ -0,0 +1,10050 @@"));
        assert!(preview.content.contains("+line-0\n"));
        assert_eq!(
            preview
                .content
                .lines()
                .filter(|line| !is_diff_preview_metadata_line(line))
                .count(),
            GIT_DIFF_PREVIEW_MAX_LINES
        );
    }

    #[test]
    fn utf8_prefix_truncation_stays_within_byte_budget() {
        let value = "aé日";

        assert_eq!(truncate_utf8_prefix(value, 0), "");
        assert_eq!(truncate_utf8_prefix(value, 1), "a");
        assert_eq!(truncate_utf8_prefix(value, 2), "a");
        assert_eq!(truncate_utf8_prefix(value, 3), "aé");
        assert_eq!(truncate_utf8_prefix(value, 5), "aé");
        assert_eq!(truncate_utf8_prefix(value, 6), "aé日");
    }

    #[test]
    fn line_limit_counts_changed_lines_starting_with_diff_markers() {
        let mut raw = String::from("diff --git a/file.txt b/file.txt\n");
        raw.push_str("@@ -1,10050 +1,10050 @@\n");
        for _ in 0..((GIT_DIFF_PREVIEW_MAX_LINES / 2) + 50) {
            raw.push_str("---i;\n");
            raw.push_str("+++i;\n");
        }

        let preview = build_diff_preview(raw);

        assert!(preview.truncated);
        assert!(preview.content.contains("---i;\n"));
        assert!(preview.content.contains("+++i;\n"));
        assert!(!is_diff_preview_metadata_line("---i;"));
        assert!(!is_diff_preview_metadata_line("+++i;"));
        assert_eq!(
            preview
                .content
                .lines()
                .filter(|line| !is_diff_preview_metadata_line(line))
                .count(),
            GIT_DIFF_PREVIEW_MAX_LINES
        );
    }

    #[test]
    fn line_limit_counts_changed_lines_starting_with_file_header_markers() {
        let mut raw = String::from("diff --git a/file.txt b/file.txt\n");
        raw.push_str("@@ -1,10050 +1,10050 @@\n");
        for _ in 0..((GIT_DIFF_PREVIEW_MAX_LINES / 2) + 50) {
            raw.push_str("--- help\n");
            raw.push_str("+++ title\n");
        }

        let preview = build_diff_preview(raw);

        assert!(preview.truncated);
        assert!(preview.content.contains("--- help\n"));
        assert!(preview.content.contains("+++ title\n"));
        assert!(!is_diff_preview_metadata_line("--- help"));
        assert!(!is_diff_preview_metadata_line("+++ title"));
        assert!(is_diff_preview_metadata_line("--- a/file.txt"));
        assert!(is_diff_preview_metadata_line("+++ b/file.txt"));
        assert_eq!(
            preview
                .content
                .lines()
                .filter(|line| !is_diff_preview_metadata_line(line))
                .count(),
            GIT_DIFF_PREVIEW_MAX_LINES
        );
    }

    #[test]
    fn workspace_file_tree_page_includes_workspace_files_and_skips_git_dir() {
        let root = std::env::temp_dir().join(format!("panes-workspace-tree-{}", Uuid::new_v4()));
        let app_dir = root.join("apps/app/src");
        let nested_repo_dir = root.join("apps/app/packages/web/src");
        let git_dir = root.join(".git");

        fs::create_dir_all(&app_dir).expect("workspace app dir should exist");
        fs::create_dir_all(&nested_repo_dir).expect("workspace nested repo dir should exist");
        fs::create_dir_all(&git_dir).expect("workspace .git dir should exist");
        fs::write(root.join("README.md"), "workspace").expect("workspace file should exist");
        fs::write(app_dir.join("main.ts"), "console.log('app')").expect("app file should exist");
        fs::write(
            nested_repo_dir.join("page.tsx"),
            "export default function Page() {}",
        )
        .expect("nested repo file should exist");
        fs::write(git_dir.join("config"), "[core]").expect("git config should exist");

        let cache = FileTreeCache::new();
        let page = get_workspace_file_tree_page(root.to_string_lossy().as_ref(), 0, 100, &cache)
            .expect("workspace file tree should load");
        let paths = page
            .entries
            .into_iter()
            .map(|entry| entry.path)
            .collect::<Vec<_>>();

        assert!(paths.contains(&"README.md".to_string()));
        assert!(paths.contains(&"apps/app/src/main.ts".to_string()));
        assert!(paths.contains(&"apps/app/packages/web/src/page.tsx".to_string()));
        assert!(!paths.iter().any(|path| path.starts_with(".git")));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn invalidating_a_repo_path_clears_containing_workspace_cache_entries() {
        let cache = FileTreeCache::new();
        cache.insert(
            "/workspace/apps/app",
            vec![FileTreeEntryDto {
                path: "src/main.ts".to_string(),
                is_dir: false,
            }],
            false,
        );
        cache.insert(
            "workspace::/workspace",
            vec![FileTreeEntryDto {
                path: "apps/app/src/main.ts".to_string(),
                is_dir: false,
            }],
            false,
        );
        cache.insert(
            "workspace::/other-workspace",
            vec![FileTreeEntryDto {
                path: "README.md".to_string(),
                is_dir: false,
            }],
            false,
        );

        cache.invalidate_containing_path("/workspace/apps/app");

        assert!(cache.get("/workspace/apps/app").is_none());
        assert!(cache.get("workspace::/workspace").is_none());
        assert!(cache.get("workspace::/other-workspace").is_some());
    }

    #[test]
    fn invalidating_a_parent_path_clears_nested_repo_cache_entries() {
        let cache = FileTreeCache::new();
        cache.insert(
            "/workspace/apps/app",
            vec![FileTreeEntryDto {
                path: "src/main.ts".to_string(),
                is_dir: false,
            }],
            false,
        );
        cache.insert(
            "workspace::/workspace",
            vec![FileTreeEntryDto {
                path: "apps/app/src/main.ts".to_string(),
                is_dir: false,
            }],
            false,
        );
        cache.insert(
            "/workspace/other",
            vec![FileTreeEntryDto {
                path: "README.md".to_string(),
                is_dir: false,
            }],
            false,
        );

        cache.invalidate_containing_path("/workspace/apps");

        assert!(cache.get("/workspace/apps/app").is_none());
        assert!(cache.get("workspace::/workspace").is_none());
        assert!(cache.get("/workspace/other").is_some());
    }
}
