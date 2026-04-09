use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use anyhow::Context;

use crate::models::{FileTreeEntryDto, ReadFileResultDto};

const READ_FILE_MAX_SIZE: u64 = 10 * 1024 * 1024; // 10 MB
const BINARY_DETECT_SCAN_SIZE: usize = 8192;

pub fn validate_repo_relative_path(path: &str) -> anyhow::Result<&Path> {
    let mut has_component = false;
    for component in Path::new(path).components() {
        match component {
            Component::Normal(_) => has_component = true,
            _ => anyhow::bail!("invalid file or directory path"),
        }
    }

    anyhow::ensure!(has_component, "invalid file or directory path");
    Ok(Path::new(path))
}

pub fn list_dir(repo_path: &str, dir_path: &str) -> anyhow::Result<Vec<FileTreeEntryDto>> {
    let repo_root = PathBuf::from(repo_path)
        .canonicalize()
        .context("failed to canonicalize repo path")?;
    let target = if dir_path.is_empty() {
        repo_root.clone()
    } else {
        repo_root
            .join(dir_path)
            .canonicalize()
            .context("directory not found")?
    };
    anyhow::ensure!(target.starts_with(&repo_root), "path traversal not allowed");
    anyhow::ensure!(target.is_dir(), "path is not a directory");

    let mut entries = Vec::new();
    for entry in fs::read_dir(&target).context("failed to read directory")? {
        let entry = match entry {
            Ok(v) => v,
            Err(e) => {
                log::debug!("skipping unreadable dir entry in {}: {e}", target.display());
                continue;
            }
        };
        let path = entry.path();

        if path.file_name().is_some_and(|name| name == ".git") {
            continue;
        }

        // Skip symlinks pointing outside the repo
        if path.is_symlink() {
            if let Ok(canonical) = path.canonicalize() {
                if !canonical.starts_with(&repo_root) {
                    continue;
                }
            } else {
                // Broken symlink — skip
                continue;
            }
        }

        let relative = path
            .strip_prefix(&repo_root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| path.to_string_lossy().to_string());

        entries.push(FileTreeEntryDto {
            path: relative,
            is_dir: path.is_dir(),
        });
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.path.cmp(&b.path),
    });

    Ok(entries)
}

pub fn read_file(repo_path: &str, file_path: &str) -> anyhow::Result<ReadFileResultDto> {
    let repo_root = PathBuf::from(repo_path)
        .canonicalize()
        .context("failed to canonicalize repo path")?;
    let abs_path = repo_root
        .join(file_path)
        .canonicalize()
        .context("file not found or cannot be read")?;
    anyhow::ensure!(
        abs_path.starts_with(&repo_root),
        "path traversal not allowed"
    );
    let metadata = fs::metadata(&abs_path).context("failed to read file metadata")?;
    let size_bytes = metadata.len();
    anyhow::ensure!(
        size_bytes <= READ_FILE_MAX_SIZE,
        "file too large to open in editor (max 10 MB)"
    );
    let raw = fs::read(&abs_path).context("failed to read file")?;
    let is_binary = raw.iter().take(BINARY_DETECT_SCAN_SIZE).any(|&b| b == 0);
    let content = if is_binary {
        String::new()
    } else {
        String::from_utf8_lossy(&raw).to_string()
    };
    Ok(ReadFileResultDto {
        content,
        size_bytes,
        is_binary,
    })
}

pub fn create_file(repo_path: &str, file_path: &str) -> anyhow::Result<()> {
    let repo_root = PathBuf::from(repo_path)
        .canonicalize()
        .context("failed to canonicalize repo path")?;
    let target = repo_root.join(validate_repo_relative_path(file_path)?);

    let parent = target.parent().context("invalid file path")?;
    if parent.exists() {
        let parent_canonical = parent
            .canonicalize()
            .context("parent directory not found")?;
        anyhow::ensure!(
            parent_canonical.starts_with(&repo_root),
            "path traversal not allowed"
        );
    } else {
        // Verify the deepest existing ancestor is inside repo root
        let mut ancestor = parent;
        while !ancestor.exists() {
            ancestor = ancestor.parent().context("invalid file path")?;
        }
        let ancestor_canonical = ancestor
            .canonicalize()
            .context("ancestor directory not found")?;
        anyhow::ensure!(
            ancestor_canonical.starts_with(&repo_root),
            "path traversal not allowed"
        );
        fs::create_dir_all(parent).context("failed to create parent directories")?;
    }

    anyhow::ensure!(!target.exists(), "file already exists");
    fs::write(&target, "").context("failed to create file")?;
    Ok(())
}

pub fn create_dir(repo_path: &str, dir_path: &str) -> anyhow::Result<()> {
    let repo_root = PathBuf::from(repo_path)
        .canonicalize()
        .context("failed to canonicalize repo path")?;
    let target = repo_root.join(validate_repo_relative_path(dir_path)?);

    let mut ancestor = target.as_path();
    while !ancestor.exists() {
        ancestor = ancestor.parent().context("invalid directory path")?;
    }
    let ancestor_canonical = ancestor
        .canonicalize()
        .context("ancestor directory not found")?;
    anyhow::ensure!(
        ancestor_canonical.starts_with(&repo_root),
        "path traversal not allowed"
    );

    anyhow::ensure!(!target.exists(), "directory already exists");
    fs::create_dir_all(&target).context("failed to create directory")?;
    Ok(())
}

fn validate_rename_name(new_name: &str) -> anyhow::Result<&Path> {
    let mut components = Path::new(new_name).components();
    let Some(Component::Normal(name)) = components.next() else {
        anyhow::bail!("invalid file or folder name");
    };
    anyhow::ensure!(components.next().is_none(), "invalid file or folder name");
    Ok(Path::new(name))
}

pub fn rename_path(repo_path: &str, old_path: &str, new_name: &str) -> anyhow::Result<()> {
    let repo_root = PathBuf::from(repo_path)
        .canonicalize()
        .context("failed to canonicalize repo path")?;
    let source = repo_root
        .join(old_path)
        .canonicalize()
        .context("source not found")?;
    anyhow::ensure!(source.starts_with(&repo_root), "path traversal not allowed");

    let parent = source.parent().context("invalid path")?;
    let dest = parent.join(validate_rename_name(new_name)?);
    if dest.exists() {
        let dest_canonical = dest
            .canonicalize()
            .context("failed to resolve rename destination")?;
        anyhow::ensure!(
            dest_canonical == source,
            "a file or folder with that name already exists"
        );
    }
    fs::rename(&source, &dest).context("failed to rename")?;
    Ok(())
}

pub fn delete_path(repo_path: &str, file_path: &str) -> anyhow::Result<()> {
    let repo_root = PathBuf::from(repo_path)
        .canonicalize()
        .context("failed to canonicalize repo path")?;
    let target = repo_root
        .join(file_path)
        .canonicalize()
        .context("path not found")?;
    anyhow::ensure!(target.starts_with(&repo_root), "path traversal not allowed");
    anyhow::ensure!(target != repo_root, "cannot delete the repository root");

    if target.is_dir() {
        fs::remove_dir_all(&target).context("failed to delete directory")?;
    } else {
        fs::remove_file(&target).context("failed to delete file")?;
    }
    Ok(())
}

pub fn write_file(repo_path: &str, file_path: &str, content: &str) -> anyhow::Result<()> {
    let repo_root = PathBuf::from(repo_path)
        .canonicalize()
        .context("failed to canonicalize repo path")?;
    let target = repo_root.join(file_path);

    // If the file already exists, canonicalize and verify the full path
    if target.exists() {
        let canonical = target
            .canonicalize()
            .context("failed to resolve file path")?;
        anyhow::ensure!(
            canonical.starts_with(&repo_root),
            "path traversal not allowed"
        );
    } else {
        // New file — verify the parent directory is inside the repo
        let parent = target.parent().context("invalid file path")?;
        let parent_canonical = parent
            .canonicalize()
            .context("parent directory not found")?;
        anyhow::ensure!(
            parent_canonical.starts_with(&repo_root),
            "path traversal not allowed"
        );
    }

    fs::write(&target, content).context("failed to write file")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::{create_dir, create_file, rename_path};
    use uuid::Uuid;

    fn with_temp_repo<T>(f: impl FnOnce(PathBuf) -> T) -> T {
        let root = std::env::temp_dir().join(format!("panes-fs-ops-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("temp repo should exist");
        let result = f(root.clone());
        let _ = fs::remove_dir_all(&root);
        result
    }

    #[test]
    fn create_file_creates_missing_parent_directories() {
        with_temp_repo(|root| {
            create_file(
                root.to_string_lossy().as_ref(),
                "src/components/FileExplorer.tsx",
            )
            .expect("nested file create should succeed");

            assert!(root.join("src/components/FileExplorer.tsx").is_file());
        });
    }

    #[test]
    fn create_file_rejects_parent_dir_components_before_touching_the_filesystem() {
        with_temp_repo(|sandbox| {
            let repo = sandbox.join("repo");
            let escaped = sandbox.join("outside.txt");
            fs::create_dir_all(&repo).expect("repo should exist");

            let error = create_file(repo.to_string_lossy().as_ref(), "missing/../../outside.txt")
                .expect_err("parent traversal should be rejected");

            assert!(error.to_string().contains("invalid file or directory path"));
            assert!(!repo.join("missing").exists());
            assert!(!escaped.exists());
        });
    }

    #[test]
    fn create_dir_rejects_parent_dir_components_before_touching_the_filesystem() {
        with_temp_repo(|sandbox| {
            let repo = sandbox.join("repo");
            let escaped = sandbox.join("outside");
            fs::create_dir_all(&repo).expect("repo should exist");

            let error = create_dir(repo.to_string_lossy().as_ref(), "missing/../../outside")
                .expect_err("parent traversal should be rejected");

            assert!(error.to_string().contains("invalid file or directory path"));
            assert!(!repo.join("missing").exists());
            assert!(!escaped.exists());
        });
    }

    #[test]
    fn rename_path_rejects_new_names_with_path_components() {
        with_temp_repo(|root| {
            fs::write(root.join("file.txt"), "hello").expect("file should exist");

            let error = rename_path(
                root.to_string_lossy().as_ref(),
                "file.txt",
                "../outside.txt",
            )
            .expect_err("rename should reject path traversal");

            assert!(error.to_string().contains("invalid file or folder name"));
            assert!(root.join("file.txt").is_file());
        });
    }

    #[test]
    fn rename_path_allows_case_only_changes() {
        with_temp_repo(|root| {
            fs::write(root.join("file.txt"), "hello").expect("file should exist");

            rename_path(root.to_string_lossy().as_ref(), "file.txt", "File.txt")
                .expect("case-only rename should succeed");

            let names = fs::read_dir(&root)
                .expect("repo root should stay readable")
                .map(|entry| {
                    entry
                        .expect("entry should decode")
                        .file_name()
                        .to_string_lossy()
                        .to_string()
                })
                .collect::<Vec<_>>();

            assert!(names.iter().any(|name| name == "File.txt"));
        });
    }
}
