use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};

use anyhow::Context;
use git2::{Repository, Status, StatusOptions};

use crate::models::{
    FileTreeEntryDto, FileTreePageDto, GitBranchDto, GitBranchPageDto, GitBranchScopeDto,
    GitCommitDto, GitCommitPageDto, GitFileStatusDto, GitStashDto, GitStatusDto, GitTagDto,
};

use super::cli_fallback::run_git;

const FILE_TREE_DEFAULT_PAGE_SIZE: usize = 2000;
const FILE_TREE_MAX_PAGE_SIZE: usize = 5000;
const FILE_TREE_MAX_SCAN_ENTRIES: usize = 50_000;
const FILE_TREE_SCAN_TIMEOUT: Duration = Duration::from_secs(2);

const GIT_BRANCH_MAX_PAGE_SIZE: usize = 1000;
const GIT_COMMIT_MAX_PAGE_SIZE: usize = 200;

const GIT_RECORD_SEPARATOR: char = '\u{1e}';
const GIT_FIELD_SEPARATOR: char = '\u{1f}';

pub fn get_git_status(repo_path: &str) -> anyhow::Result<GitStatusDto> {
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

pub fn get_file_diff(repo_path: &str, file_path: &str, staged: bool) -> anyhow::Result<String> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--staged");
    }
    args.push("--");
    args.push(file_path);

    run_git(repo_path, &args)
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
        run_git(repo_path, &["branch", branch_name, reference])
            .context("failed to create git branch")?;
    } else {
        run_git(repo_path, &["branch", branch_name]).context("failed to create git branch")?;
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

pub fn get_commit_diff(repo_path: &str, commit_hash: &str) -> anyhow::Result<String> {
    anyhow::ensure!(
        !commit_hash.is_empty() && commit_hash.chars().all(|c| c.is_ascii_hexdigit()),
        "invalid commit hash"
    );
    run_git(repo_path, &["diff-tree", "-p", commit_hash])
}

pub fn drop_git_stash(repo_path: &str, stash_index: usize) -> anyhow::Result<()> {
    let stash_ref = format!("stash@{{{stash_index}}}");
    run_git(repo_path, &["stash", "drop", stash_ref.as_str()]).context("failed to drop stash")?;
    Ok(())
}

pub fn merge_branch(repo_path: &str, branch_name: &str) -> anyhow::Result<String> {
    let output = run_git(repo_path, &["merge", branch_name])
        .context("failed to merge branch")?;
    Ok(output)
}

pub fn revert_commit(repo_path: &str, commit_hash: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        !commit_hash.is_empty() && commit_hash.chars().all(|c| c.is_ascii_hexdigit()),
        "invalid commit hash"
    );
    run_git(repo_path, &["revert", "--no-edit", commit_hash])
        .context("failed to revert commit")?;
    Ok(())
}

pub fn cherry_pick_commit(repo_path: &str, commit_hash: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        !commit_hash.is_empty() && commit_hash.chars().all(|c| c.is_ascii_hexdigit()),
        "invalid commit hash"
    );
    run_git(repo_path, &["cherry-pick", commit_hash])
        .context("failed to cherry-pick commit")?;
    Ok(())
}

pub fn reset_to_commit(repo_path: &str, commit_hash: &str, mode: &str) -> anyhow::Result<()> {
    anyhow::ensure!(
        !commit_hash.is_empty() && commit_hash.chars().all(|c| c.is_ascii_hexdigit()),
        "invalid commit hash"
    );
    let mode_flag = match mode {
        "soft" => "--soft",
        "hard" => "--hard",
        _ => "--mixed",
    };
    run_git(repo_path, &["reset", mode_flag, commit_hash])
        .context("failed to reset to commit")?;
    Ok(())
}

pub fn list_git_tags(repo_path: &str) -> anyhow::Result<Vec<GitTagDto>> {
    let format = format!(
        "%(refname:short){f}%(objectname:short){f}%(creatordate:iso-strict){f}%(subject){r}",
        f = GIT_FIELD_SEPARATOR,
        r = GIT_RECORD_SEPARATOR
    );
    let format_arg = format!("--format={format}");
    let sort_arg = "--sort=-creatordate";
    let output = run_git(
        repo_path,
        &["tag", "--list", sort_arg, format_arg.as_str()],
    )
    .context("failed to list git tags")?;

    let mut entries = Vec::new();
    for record in output.split(GIT_RECORD_SEPARATOR) {
        let trimmed = record.trim();
        if trimmed.is_empty() {
            continue;
        }

        let fields: Vec<&str> = trimmed.split(GIT_FIELD_SEPARATOR).collect();
        if fields.len() < 4 {
            continue;
        }

        let name = fields[0].trim().to_string();
        if name.is_empty() {
            continue;
        }

        entries.push(GitTagDto {
            name,
            commit_hash: fields[1].trim().to_string(),
            created_at: non_empty_string(fields[2]),
            message: non_empty_string(fields[3]),
        });
    }

    Ok(entries)
}

pub fn create_git_tag(
    repo_path: &str,
    tag_name: &str,
    commit_hash: Option<&str>,
    message: Option<&str>,
) -> anyhow::Result<()> {
    let mut args = vec!["tag"];
    if let Some(msg) = message.filter(|m| !m.trim().is_empty()) {
        args.extend(["-a", tag_name, "-m", msg]);
    } else {
        args.push(tag_name);
    }
    if let Some(hash) = commit_hash.filter(|h| !h.trim().is_empty()) {
        args.push(hash);
    }
    run_git(repo_path, &args).context("failed to create git tag")?;
    Ok(())
}

pub fn delete_git_tag(repo_path: &str, tag_name: &str) -> anyhow::Result<()> {
    run_git(repo_path, &["tag", "-d", tag_name]).context("failed to delete git tag")?;
    Ok(())
}

pub fn get_file_tree(repo_path: &str) -> anyhow::Result<Vec<FileTreeEntryDto>> {
    Ok(scan_file_tree(repo_path)?.entries)
}

pub fn get_file_tree_page(
    repo_path: &str,
    offset: usize,
    limit: usize,
) -> anyhow::Result<FileTreePageDto> {
    let limit = limit.clamp(1, FILE_TREE_MAX_PAGE_SIZE);
    let scan = scan_file_tree(repo_path)?;
    let total = scan.entries.len();
    let offset = offset.min(total);
    let end = offset.saturating_add(limit).min(total);
    let entries = scan.entries[offset..end].to_vec();

    Ok(FileTreePageDto {
        entries,
        offset,
        limit,
        total,
        has_more: end < total,
        scan_truncated: scan.truncated,
    })
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

fn scan_file_tree(repo_path: &str) -> anyhow::Result<FileTreeScanResult> {
    let root = PathBuf::from(repo_path);
    let mut context = FileTreeScanContext {
        entries: Vec::with_capacity(FILE_TREE_DEFAULT_PAGE_SIZE),
        scanned_count: 0,
        truncated: false,
        deadline: Instant::now() + FILE_TREE_SCAN_TIMEOUT,
    };
    visit_dir(&root, &root, &mut context)?;
    context.entries.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(FileTreeScanResult {
        entries: context.entries,
        truncated: context.truncated,
    })
}

fn visit_dir(
    root: &PathBuf,
    current: &PathBuf,
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

        let relative = path
            .strip_prefix(root)
            .map(|item| item.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string_lossy().to_string());

        context.scanned_count += 1;

        if path.is_dir() {
            context.entries.push(FileTreeEntryDto {
                path: relative.clone(),
                is_dir: true,
            });
            visit_dir(root, &path, context)?;
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
