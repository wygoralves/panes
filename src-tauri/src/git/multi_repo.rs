use std::{collections::VecDeque, fs, path::PathBuf};

use git2::{Reference, Repository};

#[derive(Debug, Clone)]
pub struct DetectedRepo {
    pub name: String,
    pub path: String,
    pub default_branch: String,
}

pub fn scan_git_repositories(
    root_path: &str,
    max_depth: usize,
) -> anyhow::Result<Vec<DetectedRepo>> {
    let root = PathBuf::from(root_path);
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut queue = VecDeque::from([(root, 0usize)]);
    let mut repos = Vec::new();

    while let Some((path, depth)) = queue.pop_front() {
        if depth > max_depth {
            continue;
        }

        if path.join(".git").exists() {
            if let Ok(repository) = Repository::open(&path) {
                let name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_else(|| "repo".to_string());

                let default_branch = detect_default_branch(&repository);

                repos.push(DetectedRepo {
                    name,
                    path: path.to_string_lossy().to_string(),
                    default_branch,
                });
            }
            continue;
        }

        if depth == max_depth {
            continue;
        }

        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let entry_path = entry.path();
            if !entry_path.is_dir() {
                continue;
            }
            if entry_path.file_name().is_some_and(|name| name == ".git") {
                continue;
            }
            queue.push_back((entry_path, depth + 1));
        }
    }

    Ok(repos)
}

fn detect_default_branch(repository: &Repository) -> String {
    resolve_remote_head_branch(repository, "origin")
        .or_else(|| resolve_any_remote_head_branch(repository))
        .or_else(|| local_branch_if_exists(repository, "main"))
        .or_else(|| local_branch_if_exists(repository, "master"))
        .or_else(|| {
            repository
                .head()
                .ok()
                .and_then(|head| head.shorthand().map(ToOwned::to_owned))
        })
        .unwrap_or_else(|| "main".to_string())
}

fn resolve_remote_head_branch(repository: &Repository, remote_name: &str) -> Option<String> {
    let reference_name = format!("refs/remotes/{remote_name}/HEAD");
    let reference = repository.find_reference(&reference_name).ok()?;
    branch_from_remote_head_reference(&reference_name, &reference)
}

fn resolve_any_remote_head_branch(repository: &Repository) -> Option<String> {
    let mut references = repository.references_glob("refs/remotes/*/HEAD").ok()?;
    for reference in references.by_ref().flatten() {
        let reference_name = match reference.name() {
            Some(name) => name,
            None => continue,
        };
        if let Some(branch) = branch_from_remote_head_reference(reference_name, &reference) {
            return Some(branch);
        }
    }
    None
}

fn branch_from_remote_head_reference(
    reference_name: &str,
    reference: &Reference<'_>,
) -> Option<String> {
    let prefix = reference_name.strip_suffix("HEAD")?;
    let target = reference.symbolic_target()?;
    target.strip_prefix(prefix).map(ToOwned::to_owned)
}

fn local_branch_if_exists(repository: &Repository, branch: &str) -> Option<String> {
    let reference_name = format!("refs/heads/{branch}");
    if repository.find_reference(&reference_name).is_ok() {
        return Some(branch.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::detect_default_branch;
    use git2::{Repository, Signature};
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn prefers_origin_head_over_checked_out_branch() {
        let temp_dir = create_temp_dir("origin-head");
        let repo = Repository::init(&temp_dir).expect("init repo");
        let commit_id = write_commit(&repo, "first");
        let commit = repo.find_commit(commit_id).expect("find commit");

        ensure_local_branch(&repo, "main", &commit);
        repo.branch("feature/test", &commit, true)
            .expect("create feature");
        repo.set_head("refs/heads/feature/test")
            .expect("set head to feature");

        repo.reference("refs/remotes/origin/main", commit_id, true, "test")
            .expect("create origin/main");
        repo.reference_symbolic(
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
            true,
            "test",
        )
        .expect("create origin/HEAD");

        assert_eq!(detect_default_branch(&repo), "main");
    }

    #[test]
    fn prefers_local_main_when_remote_head_is_missing() {
        let temp_dir = create_temp_dir("local-main");
        let repo = Repository::init(&temp_dir).expect("init repo");
        let commit_id = write_commit(&repo, "first");
        let commit = repo.find_commit(commit_id).expect("find commit");

        ensure_local_branch(&repo, "main", &commit);
        repo.branch("feature/test", &commit, true)
            .expect("create feature");
        repo.set_head("refs/heads/feature/test")
            .expect("set head to feature");

        assert_eq!(detect_default_branch(&repo), "main");
    }

    #[test]
    fn falls_back_to_head_when_no_default_candidates_exist() {
        let temp_dir = create_temp_dir("head-fallback");
        let repo = Repository::init(&temp_dir).expect("init repo");
        let _ = write_commit(&repo, "first");

        let head_name = repo
            .head()
            .expect("head")
            .shorthand()
            .expect("head shorthand")
            .to_string();
        assert_eq!(detect_default_branch(&repo), head_name);
    }

    fn write_commit(repo: &Repository, contents: &str) -> git2::Oid {
        let file_path = repo.workdir().expect("workdir").join("README.md");
        fs::write(&file_path, contents).expect("write file");

        let mut index = repo.index().expect("open index");
        index
            .add_path(Path::new("README.md"))
            .expect("add file to index");
        index.write().expect("write index");

        let tree_id = index.write_tree().expect("write tree");
        let tree = repo.find_tree(tree_id).expect("find tree");
        let signature =
            Signature::now("Panes Test", "panes-test@example.com").expect("build signature");

        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            "test commit",
            &tree,
            &[],
        )
        .expect("commit")
    }

    fn create_temp_dir(suffix: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "panes-default-branch-{suffix}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn ensure_local_branch(repo: &Repository, name: &str, commit: &git2::Commit<'_>) {
        if repo.find_branch(name, git2::BranchType::Local).is_ok() {
            return;
        }
        repo.branch(name, commit, false)
            .expect("create local branch");
    }
}
