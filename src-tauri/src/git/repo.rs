use std::{
    fs,
    path::PathBuf,
    time::{Duration, Instant},
};

use anyhow::Context;
use git2::{Repository, Status, StatusOptions};

use crate::models::{FileTreeEntryDto, FileTreePageDto, GitFileStatusDto, GitStatusDto};

use super::cli_fallback::run_git;

const FILE_TREE_DEFAULT_PAGE_SIZE: usize = 2000;
const FILE_TREE_MAX_PAGE_SIZE: usize = 5000;
const FILE_TREE_MAX_SCAN_ENTRIES: usize = 50_000;
const FILE_TREE_SCAN_TIMEOUT: Duration = Duration::from_secs(2);

pub fn get_git_status(repo_path: &str) -> anyhow::Result<GitStatusDto> {
    let repo = Repository::open(repo_path).context("failed to open repository")?;

    let branch = repo
        .head()
        .ok()
        .and_then(|head| head.shorthand().map(ToOwned::to_owned))
        .unwrap_or_else(|| "detached".to_string());

    let (ahead, behind) = repo
        .head()
        .ok()
        .and_then(|head| {
            let local = head.target()?;
            let upstream = head.resolve().ok()?.peel_to_commit().ok()?;
            let upstream_branch = repo
                .find_branch(head.shorthand()?, git2::BranchType::Local)
                .ok()?
                .upstream()
                .ok()?;
            let upstream_oid = upstream_branch.get().target()?;
            let _ = upstream;
            repo.graph_ahead_behind(local, upstream_oid).ok()
        })
        .unwrap_or((0, 0));

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
        let path = entry.path().unwrap_or("<unknown>").to_string();
        let staged = is_staged(status);
        files.push(GitFileStatusDto {
            path,
            status: status_label(status),
            staged,
        });
    }

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

pub fn commit(repo_path: &str, message: &str) -> anyhow::Result<String> {
    run_git(repo_path, &["commit", "-m", message])?;
    let hash = run_git(repo_path, &["rev-parse", "HEAD"])?;
    Ok(hash.trim().to_string())
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

fn is_staged(status: Status) -> bool {
    status.contains(Status::INDEX_NEW)
        || status.contains(Status::INDEX_MODIFIED)
        || status.contains(Status::INDEX_DELETED)
        || status.contains(Status::INDEX_RENAMED)
        || status.contains(Status::INDEX_TYPECHANGE)
}

fn status_label(status: Status) -> String {
    if status.contains(Status::WT_NEW) {
        return "untracked".to_string();
    }
    if status.contains(Status::WT_MODIFIED) {
        return "modified".to_string();
    }
    if status.contains(Status::WT_DELETED) {
        return "deleted".to_string();
    }
    if status.contains(Status::INDEX_NEW) {
        return "added".to_string();
    }
    if status.contains(Status::INDEX_MODIFIED) {
        return "staged".to_string();
    }
    if status.contains(Status::CONFLICTED) {
        return "conflicted".to_string();
    }
    "changed".to_string()
}
