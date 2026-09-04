use anyhow::Context;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use super::cli_fallback::run_git;
use crate::models::GitWorktreeDto;

/// Directory Panes keeps its own repo-local scratch state in, worktrees included.
pub const PANES_DIR_NAME: &str = ".panes";

/// Ignore pattern written to the repository's private exclude file so the
/// directory above never shows up as an untracked change.
pub const PANES_EXCLUDE_ENTRY: &str = ".panes/";

/// Creates a new worktree at `worktree_path` on a new branch `branch_name`,
/// branching from `base_ref` (defaults to HEAD if None).
pub fn add_worktree(
    repo_path: &str,
    worktree_path: &str,
    branch_name: &str,
    base_ref: Option<&str>,
) -> anyhow::Result<GitWorktreeDto> {
    // Worktrees Panes puts inside the repository would otherwise leave the
    // checkout dirty, so the exclude lands before the directory exists.
    if is_inside_panes_dir(repo_path, worktree_path) {
        if let Err(error) = ensure_git_info_exclude_entry(repo_path, PANES_EXCLUDE_ENTRY) {
            log::warn!("failed to exclude {PANES_EXCLUDE_ENTRY} in '{repo_path}': {error:#}");
        }
    }

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

/// Resolves the git directory shared by a repository and all of its linked
/// worktrees. `git rev-parse --git-common-dir` follows `gitdir:` pointer files
/// and linked-worktree admin directories, so the answer is the main repository's
/// git dir even when `repo_path` is itself a worktree.
pub fn git_common_dir(repo_path: &str) -> anyhow::Result<PathBuf> {
    let output = run_git(repo_path, &["rev-parse", "--git-common-dir"])
        .context("failed to resolve the git common directory")?;
    let resolved = output.trim();
    if resolved.is_empty() {
        anyhow::bail!("git returned an empty common directory for '{repo_path}'");
    }

    let candidate = Path::new(resolved);
    Ok(if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        Path::new(repo_path).join(candidate)
    })
}

/// Appends `entry` to the repository's private `info/exclude` file unless it is
/// already listed. This keeps Panes-managed directories out of `git status`
/// without touching the user's own `.gitignore`.
pub fn ensure_git_info_exclude_entry(repo_path: &str, entry: &str) -> anyhow::Result<()> {
    let info_dir = git_common_dir(repo_path)?.join("info");
    std::fs::create_dir_all(&info_dir)
        .with_context(|| format!("failed to create '{}'", info_dir.display()))?;

    let exclude_path = info_dir.join("exclude");
    let existing = match std::fs::read_to_string(&exclude_path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(error)
                .with_context(|| format!("failed to read '{}'", exclude_path.display()))
        }
    };

    if existing.lines().any(|line| line.trim() == entry) {
        return Ok(());
    }

    let separator = if existing.is_empty() || existing.ends_with('\n') {
        ""
    } else {
        "\n"
    };
    std::fs::write(&exclude_path, format!("{existing}{separator}{entry}\n"))
        .with_context(|| format!("failed to write '{}'", exclude_path.display()))?;
    Ok(())
}

/// True when `worktree_path` sits under `<repo_path>/.panes/`. The worktree
/// directory usually does not exist yet, so only the existing ancestors are
/// resolved before the paths are compared.
pub fn is_inside_panes_dir(repo_path: &str, worktree_path: &str) -> bool {
    let repo = resolve_existing_ancestor(Path::new(repo_path));
    let worktree = resolve_existing_ancestor(Path::new(worktree_path));
    match worktree.strip_prefix(&repo) {
        Ok(relative) => relative
            .components()
            .next()
            .map(|component| component.as_os_str() == PANES_DIR_NAME)
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// Canonicalizes the deepest existing ancestor of `path` and re-appends the
/// missing tail, so paths that do not exist yet still compare against
/// canonicalized roots (symlinked temp dirs, `/var` on macOS, and so on).
fn resolve_existing_ancestor(path: &Path) -> PathBuf {
    let mut missing: Vec<OsString> = Vec::new();
    let mut current = path.to_path_buf();

    loop {
        if let Ok(resolved) = std::fs::canonicalize(&current) {
            let mut out = resolved;
            for segment in missing.iter().rev() {
                out.push(segment);
            }
            return out;
        }

        let Some(name) = current.file_name().map(ToOwned::to_owned) else {
            return path.to_path_buf();
        };
        let Some(parent) = current.parent().map(Path::to_path_buf) else {
            return path.to_path_buf();
        };
        if parent.as_os_str().is_empty() {
            return path.to_path_buf();
        }

        missing.push(name);
        current = parent;
    }
}

/// Finds the worktree registered at `worktree_path`, matching by canonical path.
pub fn find_worktree(
    repo_path: &str,
    worktree_path: &str,
) -> anyhow::Result<Option<GitWorktreeDto>> {
    let all = list_worktrees(repo_path)?;
    Ok(all
        .into_iter()
        .find(|w| worktree_paths_match(&w.path, worktree_path)))
}

pub fn worktree_paths_match(listed_path: &str, requested_path: &str) -> bool {
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

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;
    use uuid::Uuid;

    struct TempRepo {
        path: std::path::PathBuf,
        // Spawning git races with tests that point the process-global PATH at
        // an empty temp dir; hold the shared env lock for the repo's lifetime.
        _env_guard: std::sync::MutexGuard<'static, ()>,
    }

    impl TempRepo {
        fn init() -> Self {
            let env_guard = crate::process_utils::test_env_lock()
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            let path = std::env::temp_dir().join(format!("panes-worktree-test-{}", Uuid::new_v4()));
            fs::create_dir_all(&path).expect("create temp repo dir");
            let repo = Self {
                path,
                _env_guard: env_guard,
            };
            run_git(repo.path_str(), &["init", "--initial-branch=main"]).expect("git init");
            run_git(
                repo.path_str(),
                &["config", "user.email", "test@example.com"],
            )
            .expect("config email");
            run_git(repo.path_str(), &["config", "user.name", "Test"]).expect("config name");
            fs::write(repo.path.join("a.txt"), "committed\n").expect("write file");
            run_git(repo.path_str(), &["add", "-A"]).expect("git add");
            run_git(repo.path_str(), &["commit", "-m", "init"]).expect("git commit");
            repo
        }

        fn path_str(&self) -> &str {
            self.path.to_str().expect("utf-8 temp path")
        }

        fn exclude_contents(&self) -> String {
            fs::read_to_string(self.path.join(".git/info/exclude")).expect("read exclude file")
        }
    }

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn adding_a_panes_worktree_excludes_the_panes_dir_without_touching_gitignore() {
        let repo = TempRepo::init();
        let worktree_path = repo.path.join(".panes/worktrees/feature");
        fs::create_dir_all(worktree_path.parent().expect("parent")).expect("create parent");

        add_worktree(
            repo.path_str(),
            worktree_path.to_str().expect("utf-8 worktree path"),
            "feature",
            None,
        )
        .expect("add worktree");

        assert!(
            repo.exclude_contents()
                .lines()
                .any(|line| line.trim() == PANES_EXCLUDE_ENTRY),
            "expected {PANES_EXCLUDE_ENTRY} in .git/info/exclude"
        );
        assert!(
            !repo.path.join(".gitignore").exists(),
            "the user's .gitignore must be left alone"
        );

        let status = run_git(repo.path_str(), &["status", "--porcelain"]).expect("git status");
        assert!(
            !status.contains(".panes"),
            "main checkout should stay clean, got: {status}"
        );
    }

    #[test]
    fn ensure_git_info_exclude_entry_is_written_once() {
        let repo = TempRepo::init();

        ensure_git_info_exclude_entry(repo.path_str(), PANES_EXCLUDE_ENTRY).expect("first write");
        ensure_git_info_exclude_entry(repo.path_str(), PANES_EXCLUDE_ENTRY).expect("second write");

        let matches = repo
            .exclude_contents()
            .lines()
            .filter(|line| line.trim() == PANES_EXCLUDE_ENTRY)
            .count();
        assert_eq!(matches, 1, "entry must not be duplicated");
    }

    #[test]
    fn ensure_git_info_exclude_entry_targets_the_common_dir_from_a_linked_worktree() {
        let repo = TempRepo::init();
        let worktree_path = repo.path.join(".panes/worktrees/linked");
        fs::create_dir_all(worktree_path.parent().expect("parent")).expect("create parent");
        let worktree_path_str = worktree_path.to_str().expect("utf-8 worktree path");
        add_worktree(repo.path_str(), worktree_path_str, "linked", None).expect("add worktree");

        // The linked worktree uses a `.git` file pointing at the main repo, so
        // the exclude must still land in the shared git dir.
        ensure_git_info_exclude_entry(worktree_path_str, "scratch/").expect("write exclude");

        assert!(
            repo.exclude_contents()
                .lines()
                .any(|line| line.trim() == "scratch/"),
            "expected the entry in the main repository's exclude file"
        );
        assert!(
            !worktree_path.join(".git/info/exclude").exists(),
            "linked worktrees must not get their own exclude file"
        );
    }

    #[test]
    fn is_inside_panes_dir_only_matches_repo_local_panes_paths() {
        let repo = TempRepo::init();
        let repo_path = repo.path_str();

        assert!(is_inside_panes_dir(
            repo_path,
            repo.path
                .join(".panes/worktrees/feature")
                .to_str()
                .expect("utf-8 path")
        ));
        assert!(!is_inside_panes_dir(
            repo_path,
            repo.path
                .join("worktrees/feature")
                .to_str()
                .expect("utf-8 path")
        ));
        assert!(!is_inside_panes_dir(
            repo_path,
            std::env::temp_dir()
                .join("panes-outside/.panes/worktrees/feature")
                .to_str()
                .expect("utf-8 path")
        ));
    }
}
