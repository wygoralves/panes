use std::{fs, path::PathBuf};

use anyhow::Context;

use crate::models::{FileTreeEntryDto, ReadFileResultDto};

const READ_FILE_MAX_SIZE: u64 = 10 * 1024 * 1024; // 10 MB
const BINARY_DETECT_SCAN_SIZE: usize = 8192;

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
    anyhow::ensure!(
        target.starts_with(&repo_root),
        "path traversal not allowed"
    );
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
