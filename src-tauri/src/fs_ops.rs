use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use anyhow::Context;

use crate::models::{FileTreeEntryDto, ReadFileResultDto};

const READ_FILE_MAX_SIZE: u64 = 10 * 1024 * 1024; // 10 MB
const BINARY_DETECT_SCAN_SIZE: usize = 8192;
/// Returned by `write_file` when the file no longer holds the content the
/// caller checked; the frontend matches on this text to raise its conflict banner.
pub const FILE_CHANGED_ON_DISK: &str = "file changed on disk after the save checked it";

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
    let (content, is_lossy_decode) = if is_binary {
        (String::new(), false)
    } else {
        match String::from_utf8(raw) {
            Ok(text) => (text, false),
            // Keep the replacement-character text for display only; the
            // frontend opens these files read-only and write_file refuses them.
            Err(error) => (String::from_utf8_lossy(error.as_bytes()).to_string(), true),
        }
    };
    Ok(ReadFileResultDto {
        content,
        size_bytes,
        is_binary,
        is_lossy_decode,
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

    // symlink_metadata also sees dangling links, which exists() reports as
    // missing; create_new refuses to follow a link that appears in between.
    anyhow::ensure!(
        fs::symlink_metadata(&target).is_err(),
        "file already exists"
    );
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .context("failed to create file")?;
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

fn resolve_existing_repo_entry(
    repo_root: &Path,
    relative_path: &str,
    missing_message: &str,
) -> anyhow::Result<PathBuf> {
    let target = repo_root.join(validate_repo_relative_path(relative_path)?);
    fs::symlink_metadata(&target).with_context(|| missing_message.to_string())?;

    let parent = target.parent().context("invalid path")?;
    let parent_canonical = parent
        .canonicalize()
        .context("parent directory not found")?;
    anyhow::ensure!(
        parent_canonical.starts_with(repo_root),
        "path traversal not allowed"
    );

    Ok(target)
}

fn delete_existing_entry(target: &Path) -> anyhow::Result<()> {
    let metadata = fs::symlink_metadata(target).context("path not found")?;
    let file_type = metadata.file_type();

    if file_type.is_symlink() {
        #[cfg(target_os = "windows")]
        {
            if target.is_dir() {
                fs::remove_dir(target).context("failed to delete directory symlink")?;
            } else {
                fs::remove_file(target).context("failed to delete file symlink")?;
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            fs::remove_file(target).context("failed to delete symlink")?;
        }

        return Ok(());
    }

    if file_type.is_dir() {
        fs::remove_dir_all(target).context("failed to delete directory")?;
    } else {
        fs::remove_file(target).context("failed to delete file")?;
    }

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
    let source = resolve_existing_repo_entry(&repo_root, old_path, "source not found")?;

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
    let target = resolve_existing_repo_entry(&repo_root, file_path, "path not found")?;
    anyhow::ensure!(target != repo_root, "cannot delete the repository root");
    delete_existing_entry(&target)
}

/// With `expected_content`, the write happens only if the file on disk still
/// holds exactly those bytes, checked in the same call as the write.
pub fn write_file(
    repo_path: &str,
    file_path: &str,
    content: &str,
    expected_content: Option<&str>,
) -> anyhow::Result<()> {
    let repo_root = PathBuf::from(repo_path)
        .canonicalize()
        .context("failed to canonicalize repo path")?;
    let target = repo_root.join(file_path);

    // A symlink whose target is missing would be followed by fs::write and
    // create a file wherever it points, so it must resolve inside the repo.
    let is_symlink = fs::symlink_metadata(&target)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false);
    anyhow::ensure!(
        !is_symlink || target.exists(),
        "cannot write through a broken symlink"
    );

    // If the file already exists, canonicalize and verify the full path
    if target.exists() {
        let canonical = target
            .canonicalize()
            .context("failed to resolve file path")?;
        anyhow::ensure!(
            canonical.starts_with(&repo_root),
            "path traversal not allowed"
        );
        // The editor decodes non-UTF-8 files lossily for display; writing that
        // text back would replace every invalid byte with U+FFFD.
        if canonical.is_file() {
            let existing = fs::read(&canonical).context("failed to read existing file")?;
            anyhow::ensure!(
                std::str::from_utf8(&existing).is_ok(),
                "refusing to overwrite a file that is not valid UTF-8"
            );
            if let Some(expected) = expected_content {
                anyhow::ensure!(existing == expected.as_bytes(), FILE_CHANGED_ON_DISK);
            }
        } else {
            anyhow::ensure!(expected_content.is_none(), FILE_CHANGED_ON_DISK);
        }
    } else {
        anyhow::ensure!(expected_content.is_none(), FILE_CHANGED_ON_DISK);
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

    use super::{
        create_dir, create_file, delete_path, read_file, rename_path, write_file,
        FILE_CHANGED_ON_DISK,
    };
    use uuid::Uuid;

    #[cfg(unix)]
    use std::os::unix::fs::symlink;

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

    #[cfg(unix)]
    #[test]
    fn rename_path_renames_symlink_entry_instead_of_target() {
        with_temp_repo(|root| {
            fs::write(root.join("target.txt"), "hello").expect("target should exist");
            symlink("target.txt", root.join("link.txt")).expect("symlink should exist");

            rename_path(
                root.to_string_lossy().as_ref(),
                "link.txt",
                "renamed-link.txt",
            )
            .expect("symlink rename should succeed");

            assert!(root.join("target.txt").is_file());
            assert!(fs::symlink_metadata(root.join("link.txt")).is_err());
            assert_eq!(
                fs::read_link(root.join("renamed-link.txt")).expect("renamed symlink should exist"),
                PathBuf::from("target.txt"),
            );
        });
    }

    #[cfg(unix)]
    #[test]
    fn delete_path_deletes_symlink_entry_instead_of_target() {
        with_temp_repo(|root| {
            fs::write(root.join("target.txt"), "hello").expect("target should exist");
            symlink("target.txt", root.join("link.txt")).expect("symlink should exist");

            delete_path(root.to_string_lossy().as_ref(), "link.txt")
                .expect("symlink delete should succeed");

            assert!(root.join("target.txt").is_file());
            assert!(fs::symlink_metadata(root.join("link.txt")).is_err());
        });
    }

    #[test]
    fn read_file_flags_non_utf8_content_as_lossy() {
        with_temp_repo(|root| {
            fs::write(root.join("latin1.txt"), b"caf\xe9\n").expect("file should exist");
            fs::write(root.join("utf8.txt"), "\u{feff}café\r\n").expect("file should exist");

            let lossy = read_file(root.to_string_lossy().as_ref(), "latin1.txt")
                .expect("lossy read should succeed");
            assert!(lossy.is_lossy_decode);
            assert!(!lossy.is_binary);

            let clean = read_file(root.to_string_lossy().as_ref(), "utf8.txt")
                .expect("utf-8 read should succeed");
            assert!(!clean.is_lossy_decode);
            assert_eq!(clean.content, "\u{feff}café\r\n");
        });
    }

    #[test]
    fn write_file_refuses_to_overwrite_non_utf8_files() {
        with_temp_repo(|root| {
            fs::write(root.join("latin1.txt"), b"caf\xe9\n").expect("file should exist");

            let error = write_file(
                root.to_string_lossy().as_ref(),
                "latin1.txt",
                "caf\u{fffd}\n",
                None,
            )
            .expect_err("lossy overwrite should be refused");

            assert!(error.to_string().contains("not valid UTF-8"));
            assert_eq!(
                fs::read(root.join("latin1.txt")).expect("file should stay readable"),
                b"caf\xe9\n"
            );

            fs::write(root.join("utf8.txt"), "old\n").expect("file should exist");
            write_file(root.to_string_lossy().as_ref(), "utf8.txt", "new\n", None)
                .expect("utf-8 overwrite should succeed");
            assert_eq!(
                fs::read_to_string(root.join("utf8.txt")).expect("file should be readable"),
                "new\n"
            );
        });
    }

    #[test]
    fn write_file_refuses_when_disk_no_longer_holds_the_checked_content() {
        with_temp_repo(|root| {
            let repo = root.to_string_lossy();
            fs::write(root.join("notes.md"), "agent edit\n").expect("file should exist");

            let error = write_file(repo.as_ref(), "notes.md", "mine\n", Some("checked\n"))
                .expect_err("a changed file should not be overwritten");
            assert_eq!(error.to_string(), FILE_CHANGED_ON_DISK);
            assert_eq!(
                fs::read_to_string(root.join("notes.md")).expect("file should be readable"),
                "agent edit\n"
            );

            let error = write_file(repo.as_ref(), "gone.md", "mine\n", Some("checked\n"))
                .expect_err("a deleted file should not be recreated");
            assert_eq!(error.to_string(), FILE_CHANGED_ON_DISK);
            assert!(!root.join("gone.md").exists());

            write_file(repo.as_ref(), "notes.md", "mine\n", Some("agent edit\n"))
                .expect("an unchanged file should be written");
            assert_eq!(
                fs::read_to_string(root.join("notes.md")).expect("file should be readable"),
                "mine\n"
            );
        });
    }

    #[cfg(unix)]
    #[test]
    fn write_file_refuses_dangling_symlink_pointing_outside_repo() {
        with_temp_repo(|sandbox| {
            let repo = sandbox.join("repo");
            let outside = sandbox.join("outside");
            fs::create_dir_all(&repo).expect("repo should exist");
            fs::create_dir_all(&outside).expect("outside should exist");
            symlink(outside.join("pwned.txt"), repo.join("notes.md")).expect("symlink");

            write_file(repo.to_string_lossy().as_ref(), "notes.md", "hello", None)
                .expect_err("write through a dangling symlink should be refused");

            assert!(!outside.join("pwned.txt").exists());
        });
    }

    #[cfg(unix)]
    #[test]
    fn create_file_refuses_dangling_symlink_pointing_outside_repo() {
        with_temp_repo(|sandbox| {
            let repo = sandbox.join("repo");
            let outside = sandbox.join("outside");
            fs::create_dir_all(&repo).expect("repo should exist");
            fs::create_dir_all(&outside).expect("outside should exist");
            symlink(outside.join("pwned.txt"), repo.join("new.txt")).expect("symlink");

            create_file(repo.to_string_lossy().as_ref(), "new.txt")
                .expect_err("create over a dangling symlink should be refused");

            assert!(!outside.join("pwned.txt").exists());
        });
    }
}
