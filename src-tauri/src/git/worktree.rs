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

/// What happened to the branch after its worktree was removed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RemoveWorktreeOutcome {
    /// Set when the worktree is gone but git refused to delete its branch,
    /// usually because the branch has commits not merged into HEAD.
    pub branch_delete_error: Option<String>,
}

/// Removes a linked worktree. `force` removes it even with uncommitted or
/// untracked files; `force_branch_delete` deletes the branch with `-D` even
/// when it holds unmerged commits. The two are separate so forcing the
/// directory never implies discarding commits.
///
/// Once the worktree is gone, a refused branch delete is reported in the
/// outcome instead of as an error, so callers can still treat the worktree
/// as removed.
///
/// `git worktree remove` succeeds even when the worktree's detached HEAD holds
/// commits no ref reaches, and those commits go with it. `force` only confirms
/// losing files, so unless `force_branch_delete` says the caller confirmed
/// losing commits, such a removal is refused.
pub fn remove_worktree(
    repo_path: &str,
    worktree_path: &str,
    force: bool,
    branch_name: Option<&str>,
    delete_branch: bool,
    force_branch_delete: bool,
) -> anyhow::Result<RemoveWorktreeOutcome> {
    if !force_branch_delete && Path::new(worktree_path).is_dir() {
        let detached = count_commits_held_only_by_head(repo_path, worktree_path)?;
        if detached > 0 {
            anyhow::bail!(
                "failed to remove worktree: its detached HEAD holds {detached} commit(s) that no branch, tag or remote reaches"
            );
        }
    }

    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(worktree_path);
    run_git(repo_path, &args).context("failed to remove worktree")?;

    let mut outcome = RemoveWorktreeOutcome::default();
    if delete_branch {
        if let Some(branch) = branch_name {
            let flag = if force_branch_delete { "-D" } else { "-d" };
            if let Err(error) = run_git(repo_path, &["branch", flag, branch]) {
                outcome.branch_delete_error = Some(format!(
                    "failed to delete worktree branch '{branch}': {error:#}"
                ));
            }
        }
    }
    Ok(outcome)
}

/// Work that removing a worktree and its branch without force would refuse to
/// throw away.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WorktreeInspection {
    /// Tracked files with staged or unstaged changes.
    pub changed_count: usize,
    /// Untracked files (ignored files are not counted; git removes them).
    pub untracked_count: usize,
    /// Commits that only the branch or the worktree's HEAD hold: reachable from
    /// no other ref (other branches, tags, remote-tracking refs) and from no
    /// other worktree's HEAD, so deleting them with the worktree loses them.
    pub unmerged_commit_count: usize,
    /// Identifies the exact work counted above: the worktree HEAD, the branch
    /// tip, the status entries, the staged blobs and the current content of
    /// every listed path. Equal counts with a different fingerprint mean the
    /// work was replaced, so a confirmation of the old work no longer covers it.
    pub fingerprint: String,
}

/// Counts the uncommitted files in `worktree_path` and the commits that
/// removing it and deleting `branch_name` would lose. A worktree
/// directory that no longer exists has no files to lose.
pub fn inspect_worktree(
    repo_path: &str,
    worktree_path: &str,
    branch_name: Option<&str>,
) -> anyhow::Result<WorktreeInspection> {
    let mut inspection = WorktreeInspection::default();
    let mut fingerprint = Vec::new();
    // Commits reachable from these may be lost with the worktree and branch.
    let mut tips = Vec::new();

    if Path::new(worktree_path).is_dir() {
        let status = run_git(
            worktree_path,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        )
        .context("failed to read worktree status")?;
        let (changed, untracked) = count_porcelain_entries(&status);
        inspection.changed_count = changed;
        inspection.untracked_count = untracked;

        // Commits made on a detached HEAD belong to no branch; removing the
        // worktree drops the only reference to them.
        if let Some(head) = worktree_head(worktree_path) {
            tips.push(head);
        }

        let head = run_git(worktree_path, &["rev-parse", "HEAD"]).unwrap_or_default();
        let staged = run_git(
            worktree_path,
            &["diff", "--cached", "--raw", "--no-abbrev", "-z"],
        )
        .unwrap_or_default();
        fingerprint.extend_from_slice(format!("head\0{}\0", head.trim()).as_bytes());
        fingerprint.extend_from_slice(b"status\0");
        fingerprint.extend_from_slice(status.as_bytes());
        fingerprint.extend_from_slice(b"staged\0");
        fingerprint.extend_from_slice(staged.as_bytes());
        for path in porcelain_paths(&status) {
            fingerprint.extend_from_slice(format!("path\0{path}\0").as_bytes());
            fingerprint_path(&Path::new(worktree_path).join(path), &mut fingerprint);
        }
    }

    let mut removed_branch = None;
    if let Some(branch) = branch_name.filter(|branch| !branch.trim().is_empty()) {
        let branch_ref = format!("refs/heads/{branch}");
        if let Ok(tip) = run_git(
            repo_path,
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{branch_ref}^{{commit}}"),
            ],
        ) {
            let tip = tip.trim().to_string();
            fingerprint.extend_from_slice(format!("branch\0{tip}\0").as_bytes());
            tips.push(tip);
            removed_branch = Some(branch);
        }
    }

    inspection.unmerged_commit_count =
        count_commits_at_risk(repo_path, worktree_path, &tips, removed_branch)?;

    inspection.fingerprint = git2::Oid::hash_object(git2::ObjectType::Blob, &fingerprint)
        .context("failed to hash worktree fingerprint")?
        .to_string();
    Ok(inspection)
}

/// Commits reachable from the worktree's HEAD but from no ref and no other
/// worktree's HEAD: the ones a detached HEAD alone keeps alive.
fn count_commits_held_only_by_head(repo_path: &str, worktree_path: &str) -> anyhow::Result<usize> {
    let tips: Vec<String> = worktree_head(worktree_path).into_iter().collect();
    count_commits_at_risk(repo_path, worktree_path, &tips, None)
}

/// The commit the worktree's HEAD points at, if it has one.
fn worktree_head(worktree_path: &str) -> Option<String> {
    run_git(
        worktree_path,
        &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
    )
    .ok()
    .map(|head| head.trim().to_string())
    .filter(|head| !head.is_empty())
}

/// Counts the commits reachable from `tips` that nothing surviving the removal
/// of `worktree_path` (and of `removed_branch`, when given) still reaches.
///
/// Survivors are every ref except the removed branch and `refs/stash`, plus
/// the HEAD of every other worktree. A stash only keeps commits as the parent
/// of a stash entry, which is not where anyone looks for branch work, so it
/// does not count. Another worktree's detached HEAD does count: it keeps the
/// commits alive while that worktree exists, and removing that worktree later
/// runs this same check for its own HEAD. `--all` is not used because it also
/// adds the HEAD of the worktree being removed.
fn count_commits_at_risk(
    repo_path: &str,
    worktree_path: &str,
    tips: &[String],
    removed_branch: Option<&str>,
) -> anyhow::Result<usize> {
    if tips.is_empty() {
        return Ok(0);
    }
    let other_heads: Vec<String> = list_worktrees(repo_path)?
        .into_iter()
        .filter(|worktree| !worktree.is_prunable)
        .filter(|worktree| !worktree_paths_match(&worktree.path, worktree_path))
        .filter_map(|worktree| worktree.head_sha)
        .filter(|head| !head.is_empty() && head.bytes().any(|byte| byte != b'0'))
        .collect();

    let excluded_branch = removed_branch.map(|branch| format!("--exclude=refs/heads/{branch}"));
    let mut args = vec!["rev-list", "--count"];
    args.extend(tips.iter().map(String::as_str));
    args.extend(["--not", "--exclude=refs/stash"]);
    if let Some(excluded) = excluded_branch.as_deref() {
        args.push(excluded);
    }
    // `--exclude` only applies to the next ref selector, so it comes first.
    args.push("--glob=refs/*");
    args.extend(other_heads.iter().map(String::as_str));

    let count = run_git(repo_path, &args).context("failed to count unmerged commits")?;
    Ok(count.trim().parse::<usize>().unwrap_or(0))
}

/// Every path named in `git status --porcelain=v1 -z` output, rename and copy
/// sources included.
fn porcelain_paths(status: &str) -> Vec<&str> {
    let mut paths = Vec::new();
    let mut entries = status.split('\0').filter(|entry| !entry.is_empty());
    while let Some(entry) = entries.next() {
        let code = entry.get(..2).unwrap_or("");
        if let Some(path) = entry.get(3..) {
            paths.push(path);
        }
        if code != "??" && code != "!!" && code.contains(['R', 'C']) {
            if let Some(source) = entries.next() {
                paths.push(source);
            }
        }
    }
    paths
}

/// Appends what is on disk at `path` to `out`: a blob id for a file, the target
/// for a symlink, and every entry recursively for a directory (an untracked
/// nested repository is listed as one directory).
fn fingerprint_path(path: &Path, out: &mut Vec<u8>) {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        out.extend_from_slice(b"missing\0");
        return;
    };
    if metadata.file_type().is_symlink() {
        let target = std::fs::read_link(path).unwrap_or_default();
        out.extend_from_slice(format!("link\0{}\0", target.display()).as_bytes());
    } else if metadata.is_dir() {
        let mut children = std::fs::read_dir(path)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.file_name())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        children.sort();
        out.extend_from_slice(b"dir\0");
        for child in children {
            out.extend_from_slice(format!("{}\0", child.to_string_lossy()).as_bytes());
            fingerprint_path(&path.join(&child), out);
        }
        out.extend_from_slice(b"end\0");
    } else if metadata.is_file() {
        match git2::Oid::hash_file(git2::ObjectType::Blob, path) {
            Ok(oid) => out.extend_from_slice(format!("file\0{oid}\0").as_bytes()),
            Err(_) => out.extend_from_slice(b"unreadable\0"),
        }
    } else {
        // A FIFO, socket or device holds no content git could keep, and
        // opening a FIFO with no writer would block the inspection forever.
        out.extend_from_slice(b"special\0");
    }
}

/// Splits `git status --porcelain=v1 -z` output into (changed, untracked)
/// counts. Renames and copies carry their source path as an extra entry.
fn count_porcelain_entries(status: &str) -> (usize, usize) {
    let mut changed = 0;
    let mut untracked = 0;
    let mut entries = status.split('\0').filter(|entry| !entry.is_empty());
    while let Some(entry) = entries.next() {
        let code = entry.get(..2).unwrap_or("");
        if code == "??" {
            untracked += 1;
            continue;
        }
        if code == "!!" {
            continue;
        }
        changed += 1;
        if code.contains(['R', 'C']) {
            entries.next();
        }
    }
    (changed, untracked)
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

    fn add_panes_worktree(repo: &TempRepo, branch: &str) -> String {
        let worktree_path = repo.path.join(".panes/worktrees").join(branch);
        fs::create_dir_all(worktree_path.parent().expect("parent")).expect("create parent");
        let worktree_path = worktree_path
            .to_str()
            .expect("utf-8 worktree path")
            .to_string();
        add_worktree(repo.path_str(), &worktree_path, branch, None).expect("add worktree");
        worktree_path
    }

    fn commit_in(worktree_path: &str, file: &str) {
        fs::write(Path::new(worktree_path).join(file), "agent work\n").expect("write file");
        run_git(worktree_path, &["add", "-A"]).expect("git add");
        run_git(worktree_path, &["commit", "-m", "agent work"]).expect("git commit");
    }

    fn branch_exists(repo: &TempRepo, branch: &str) -> bool {
        run_git(
            repo.path_str(),
            &[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("refs/heads/{branch}"),
            ],
        )
        .is_ok()
    }

    #[test]
    fn unforced_removal_keeps_a_worktree_with_untracked_files() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        fs::write(Path::new(&worktree_path).join("new.txt"), "unsaved\n").expect("write");

        remove_worktree(
            repo.path_str(),
            &worktree_path,
            false,
            Some("agent"),
            true,
            false,
        )
        .expect_err("git must refuse removing a worktree with untracked files");

        assert!(Path::new(&worktree_path).join("new.txt").is_file());
        assert!(branch_exists(&repo, "agent"));
    }

    #[test]
    fn forced_worktree_removal_keeps_an_unmerged_branch_unless_branch_delete_is_forced() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        commit_in(&worktree_path, "agent.txt");
        fs::write(Path::new(&worktree_path).join("scratch.txt"), "unsaved\n").expect("write");

        let outcome = remove_worktree(
            repo.path_str(),
            &worktree_path,
            true,
            Some("agent"),
            true,
            false,
        )
        .expect("forced worktree removal succeeds");

        assert!(!Path::new(&worktree_path).exists());
        assert!(
            branch_exists(&repo, "agent"),
            "forcing the directory must not imply -D on the branch"
        );
        assert!(
            outcome.branch_delete_error.is_some(),
            "the refused branch delete must be reported"
        );
    }

    #[test]
    fn removal_reports_a_refused_branch_delete_after_removing_the_worktree() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        commit_in(&worktree_path, "agent.txt");

        let outcome = remove_worktree(
            repo.path_str(),
            &worktree_path,
            false,
            Some("agent"),
            true,
            false,
        )
        .expect("a refused branch delete is not a failed removal");

        assert!(!Path::new(&worktree_path).exists());
        assert!(branch_exists(&repo, "agent"));
        assert!(outcome
            .branch_delete_error
            .as_deref()
            .is_some_and(|error| error.contains("agent")));
    }

    #[test]
    fn forced_branch_delete_drops_an_unmerged_branch() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        commit_in(&worktree_path, "agent.txt");

        let outcome = remove_worktree(
            repo.path_str(),
            &worktree_path,
            true,
            Some("agent"),
            true,
            true,
        )
        .expect("forced removal succeeds");

        assert_eq!(outcome, RemoveWorktreeOutcome::default());
        assert!(!branch_exists(&repo, "agent"));
    }

    #[test]
    fn inspect_worktree_counts_changed_untracked_and_unmerged_work() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");

        assert_eq!(
            counts(
                &inspect_worktree(repo.path_str(), &worktree_path, Some("agent")).expect("inspect")
            ),
            (0, 0, 0),
            "a fresh worktree has nothing to lose"
        );

        commit_in(&worktree_path, "agent.txt");
        commit_in(&worktree_path, "agent2.txt");
        fs::write(Path::new(&worktree_path).join("a.txt"), "changed\n").expect("modify");
        fs::create_dir_all(Path::new(&worktree_path).join("out")).expect("mkdir");
        fs::write(Path::new(&worktree_path).join("out/one.txt"), "1\n").expect("write");
        fs::write(Path::new(&worktree_path).join("out/two.txt"), "2\n").expect("write");

        assert_eq!(
            counts(
                &inspect_worktree(repo.path_str(), &worktree_path, Some("agent")).expect("inspect")
            ),
            (1, 2, 2)
        );
    }

    fn counts(inspection: &WorktreeInspection) -> (usize, usize, usize) {
        (
            inspection.changed_count,
            inspection.untracked_count,
            inspection.unmerged_commit_count,
        )
    }

    #[test]
    fn inspect_worktree_fingerprint_changes_when_work_is_replaced_at_equal_counts() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        commit_in(&worktree_path, "agent.txt");
        let file = Path::new(&worktree_path).join("a.txt");
        let nested = Path::new(&worktree_path).join("nested/inner.txt");
        fs::write(&file, "first edit\n").expect("modify");
        fs::create_dir_all(nested.parent().expect("parent")).expect("mkdir");
        run_git(&worktree_path, &["init", "nested"]).expect("nested repo");
        fs::write(&nested, "one\n").expect("write nested");

        let inspect =
            || inspect_worktree(repo.path_str(), &worktree_path, Some("agent")).expect("inspect");
        let confirmed = inspect();
        assert_eq!(counts(&confirmed), (1, 1, 1));
        assert_eq!(
            inspect().fingerprint,
            confirmed.fingerprint,
            "unchanged work keeps its fingerprint"
        );

        fs::write(&file, "second edit\n").expect("modify again");
        let edited = inspect();
        assert_eq!(counts(&edited), counts(&confirmed));
        assert_ne!(
            edited.fingerprint, confirmed.fingerprint,
            "same file, new content"
        );

        fs::write(&file, "first edit\n").expect("restore");
        fs::write(&nested, "two\n").expect("edit nested repo");
        let nested_edit = inspect();
        assert_eq!(counts(&nested_edit), counts(&confirmed));
        assert_ne!(
            nested_edit.fingerprint, confirmed.fingerprint,
            "a nested repository counted once still changes the fingerprint"
        );

        fs::write(&nested, "one\n").expect("restore nested");
        fs::write(Path::new(&worktree_path).join("agent.txt"), "amended\n").expect("amend file");
        run_git(&worktree_path, &["add", "agent.txt"]).expect("stage amend");
        run_git(&worktree_path, &["commit", "--amend", "-m", "amended"]).expect("amend");
        let amended = inspect();
        assert_eq!(counts(&amended), counts(&confirmed));
        assert_ne!(
            amended.fingerprint, confirmed.fingerprint,
            "an amended commit is not the commit the user saw"
        );
    }

    #[cfg(unix)]
    #[test]
    fn inspect_worktree_does_not_block_on_a_fifo_inside_an_untracked_directory() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        run_git(&worktree_path, &["init", "nested"]).expect("nested repo");
        let fifo = Path::new(&worktree_path).join("nested/pipe");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("run mkfifo");
        assert!(status.success(), "mkfifo failed");

        let (sender, receiver) = std::sync::mpsc::channel();
        let repo_path = repo.path_str().to_string();
        let inspected_path = worktree_path.clone();
        std::thread::spawn(move || {
            let _ = sender.send(inspect_worktree(&repo_path, &inspected_path, Some("agent")));
        });
        let inspection = receiver
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("inspection must not wait for a FIFO writer")
            .expect("inspect");
        assert_eq!(counts(&inspection), (0, 1, 0));
    }

    #[test]
    fn unforced_removal_keeps_a_worktree_whose_detached_head_holds_unreachable_commits() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        run_git(&worktree_path, &["checkout", "--detach"]).expect("detach");
        commit_in(&worktree_path, "detached.txt");

        remove_worktree(repo.path_str(), &worktree_path, false, None, false, false)
            .expect_err("an unforced removal must not drop commits only HEAD reaches");
        assert!(Path::new(&worktree_path).join("detached.txt").is_file());

        fs::write(Path::new(&worktree_path).join("notes.txt"), "draft\n").expect("write");
        remove_worktree(repo.path_str(), &worktree_path, true, None, false, false)
            .expect_err("confirming files alone must not drop commits only HEAD reaches");
        assert!(Path::new(&worktree_path).join("detached.txt").is_file());

        remove_worktree(
            repo.path_str(),
            &worktree_path,
            true,
            Some("agent"),
            true,
            true,
        )
        .expect("confirming the files and the commits allows the removal");
        assert!(!Path::new(&worktree_path).exists());
    }

    #[test]
    fn inspect_worktree_counts_commits_held_only_by_a_detached_head() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        run_git(&worktree_path, &["checkout", "--detach"]).expect("detach");
        commit_in(&worktree_path, "detached.txt");

        assert_eq!(
            inspect_worktree(repo.path_str(), &worktree_path, Some("agent"))
                .expect("inspect")
                .unmerged_commit_count,
            1
        );
    }

    #[test]
    fn inspect_worktree_does_not_count_commits_already_on_the_upstream() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        commit_in(&worktree_path, "pushed.txt");
        // A remote-tracking ref stands in for a pushed branch.
        run_git(
            repo.path_str(),
            &[
                "update-ref",
                "refs/remotes/origin/agent",
                "refs/heads/agent",
            ],
        )
        .expect("create remote-tracking ref");
        run_git(
            repo.path_str(),
            &["config", "branch.agent.remote", "origin"],
        )
        .expect("set remote");
        run_git(
            repo.path_str(),
            &["config", "branch.agent.merge", "refs/heads/agent"],
        )
        .expect("set merge");
        run_git(
            repo.path_str(),
            &[
                "config",
                "remote.origin.fetch",
                "+refs/heads/*:refs/remotes/origin/*",
            ],
        )
        .expect("set fetch refspec");
        commit_in(&worktree_path, "local.txt");

        assert_eq!(
            inspect_worktree(repo.path_str(), &worktree_path, Some("agent"))
                .expect("inspect")
                .unmerged_commit_count,
            1,
            "only the commit missing from both HEAD and the upstream is at risk"
        );
    }

    fn unmerged_commits(repo: &TempRepo, worktree_path: &str) -> usize {
        inspect_worktree(repo.path_str(), worktree_path, Some("agent"))
            .expect("inspect")
            .unmerged_commit_count
    }

    #[test]
    fn inspect_worktree_does_not_count_commits_another_local_branch_reaches() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        commit_in(&worktree_path, "agent.txt");
        run_git(repo.path_str(), &["branch", "keep", "agent"]).expect("create branch");

        assert_eq!(unmerged_commits(&repo, &worktree_path), 0);
    }

    #[test]
    fn inspect_worktree_does_not_count_commits_a_tag_reaches() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        commit_in(&worktree_path, "agent.txt");
        run_git(repo.path_str(), &["tag", "v1", "agent"]).expect("create tag");

        assert_eq!(unmerged_commits(&repo, &worktree_path), 0);
    }

    #[test]
    fn inspect_worktree_does_not_count_commits_on_a_remote_ref_that_is_not_the_upstream() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        commit_in(&worktree_path, "agent.txt");
        run_git(
            repo.path_str(),
            &[
                "update-ref",
                "refs/remotes/fork/agent-copy",
                "refs/heads/agent",
            ],
        )
        .expect("create remote-tracking ref");

        assert_eq!(unmerged_commits(&repo, &worktree_path), 0);
    }

    #[test]
    fn inspect_worktree_counts_commits_only_the_branch_holds() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        run_git(repo.path_str(), &["tag", "base"]).expect("tag the base");
        commit_in(&worktree_path, "agent.txt");
        commit_in(&worktree_path, "agent2.txt");
        // A stash entry has the branch tip as parent but is not a place to
        // find branch work, so it does not keep the commits.
        fs::write(Path::new(&worktree_path).join("a.txt"), "stashed\n").expect("modify");
        run_git(&worktree_path, &["stash"]).expect("stash");

        assert_eq!(unmerged_commits(&repo, &worktree_path), 2);
    }

    #[test]
    fn unforced_removal_still_refuses_a_detached_head_nothing_else_reaches() {
        let repo = TempRepo::init();
        let worktree_path = add_panes_worktree(&repo, "agent");
        run_git(repo.path_str(), &["tag", "base"]).expect("tag the base");
        run_git(&worktree_path, &["checkout", "--detach"]).expect("detach");
        commit_in(&worktree_path, "detached.txt");
        fs::write(Path::new(&worktree_path).join("a.txt"), "stashed\n").expect("modify");
        run_git(&worktree_path, &["stash"]).expect("stash");

        remove_worktree(repo.path_str(), &worktree_path, true, None, false, false)
            .expect_err("commits only the detached HEAD reaches must not be dropped");
        assert!(Path::new(&worktree_path).join("detached.txt").is_file());

        run_git(repo.path_str(), &["tag", "kept", "agent"]).expect("tag unrelated");
        remove_worktree(repo.path_str(), &worktree_path, true, None, false, false)
            .expect_err("a ref that does not reach the commits does not keep them");

        let head = run_git(&worktree_path, &["rev-parse", "HEAD"]).expect("read head");
        run_git(repo.path_str(), &["tag", "saved", head.trim()]).expect("tag the head");
        remove_worktree(repo.path_str(), &worktree_path, true, None, false, false)
            .expect("a tag on the detached HEAD keeps its commits");
        assert!(!Path::new(&worktree_path).exists());
    }

    #[test]
    fn count_porcelain_entries_skips_rename_sources() {
        assert_eq!(
            count_porcelain_entries("R  new.txt\0old.txt\0 M a.txt\0?? b.txt\0"),
            (2, 1)
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
