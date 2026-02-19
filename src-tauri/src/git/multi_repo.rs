use std::{collections::VecDeque, fs, path::PathBuf};

use git2::Repository;

#[derive(Debug, Clone)]
pub struct DetectedRepo {
  pub name: String,
  pub path: String,
  pub default_branch: String,
}

pub fn scan_git_repositories(root_path: &str, max_depth: usize) -> anyhow::Result<Vec<DetectedRepo>> {
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

        let default_branch = repository
          .head()
          .ok()
          .and_then(|head| head.shorthand().map(ToOwned::to_owned))
          .unwrap_or_else(|| "main".to_string());

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
