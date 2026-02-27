use anyhow::Context;
use std::path::Path;

use super::cli_fallback::run_git;
use crate::models::GitWorktreeDto;

/// Creates a new worktree at `worktree_path` on a new branch `branch_name`,
/// branching from `base_ref` (defaults to HEAD if None).
pub fn add_worktree(
    repo_path: &str,
    worktree_path: &str,
    branch_name: &str,
    base_ref: Option<&str>,
) -> anyhow::Result<GitWorktreeDto> {
    let mut args = vec!["worktree", "add", "-b", branch_name, worktree_path];
    if let Some(base) = base_ref {
        args.push(base);
    }
    run_git(repo_path, &args).context("failed to add worktree")?;

    // Return info about the newly created worktree
    let all = list_worktrees(repo_path)?;
    all.into_iter()
        .find(|w| worktree_paths_match(&w.path, worktree_path))
        .ok_or_else(|| anyhow::anyhow!("worktree created but not found in listing"))
}

fn worktree_paths_match(listed_path: &str, requested_path: &str) -> bool {
    if listed_path == requested_path {
        return true;
    }

    let listed = Path::new(listed_path);
    let requested = Path::new(requested_path);
    if listed == requested {
        return true;
    }

    match (
        std::fs::canonicalize(listed),
        std::fs::canonicalize(requested),
    ) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

/// Lists all worktrees for a repository using porcelain format.
pub fn list_worktrees(repo_path: &str) -> anyhow::Result<Vec<GitWorktreeDto>> {
    let output = run_git(repo_path, &["worktree", "list", "--porcelain"])
        .context("failed to list worktrees")?;

    let mut worktrees = Vec::new();
    let mut path: Option<String> = None;
    let mut head_sha: Option<String> = None;
    let mut branch: Option<String> = None;
    let mut is_bare = false;
    let mut is_locked = false;
    let mut is_prunable = false;
    let mut is_first = true;

    for line in output.lines() {
        if line.is_empty() {
            // Flush current block
            if let Some(p) = path.take() {
                worktrees.push(GitWorktreeDto {
                    path: p,
                    head_sha: head_sha.take(),
                    branch: branch.take(),
                    is_main: is_first && !is_bare,
                    is_locked,
                    is_prunable,
                });
                is_first = false;
            }
            is_bare = false;
            is_locked = false;
            is_prunable = false;
            continue;
        }

        if let Some(rest) = line.strip_prefix("worktree ") {
            path = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("HEAD ") {
            head_sha = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("branch ") {
            // "branch refs/heads/main" → "main"
            branch = Some(rest.strip_prefix("refs/heads/").unwrap_or(rest).to_string());
        } else if line == "bare" {
            is_bare = true;
        } else if line == "detached" {
            branch = None;
        } else if line.starts_with("locked") {
            is_locked = true;
        } else if line.starts_with("prunable") {
            is_prunable = true;
        }
    }

    // Flush last block (porcelain output may not end with blank line)
    if let Some(p) = path.take() {
        worktrees.push(GitWorktreeDto {
            path: p,
            head_sha: head_sha.take(),
            branch: branch.take(),
            is_main: is_first && !is_bare,
            is_locked,
            is_prunable,
        });
    }

    Ok(worktrees)
}

/// Removes a linked worktree. Use `force` to remove even with uncommitted changes.
pub fn remove_worktree(
    repo_path: &str,
    worktree_path: &str,
    force: bool,
    branch_name: Option<&str>,
    delete_branch: bool,
) -> anyhow::Result<()> {
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(worktree_path);
    run_git(repo_path, &args).context("failed to remove worktree")?;
    if delete_branch {
        if let Some(branch) = branch_name {
            let flag = if force { "-D" } else { "-d" };
            run_git(repo_path, &["branch", flag, branch])
                .with_context(|| format!("failed to delete worktree branch '{branch}'"))?;
        }
    }
    Ok(())
}

/// Prunes stale worktree admin files for worktrees whose directories no longer exist.
pub fn prune_worktrees(repo_path: &str) -> anyhow::Result<()> {
    run_git(repo_path, &["worktree", "prune"]).context("failed to prune worktrees")?;
    Ok(())
}
