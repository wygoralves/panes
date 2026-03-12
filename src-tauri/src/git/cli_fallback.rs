use std::process::Command;

use anyhow::Context;

use crate::process_utils;

pub fn run_git(repo_path: &str, args: &[&str]) -> anyhow::Result<String> {
    let mut command = Command::new("git");
    process_utils::configure_std_command(&mut command);
    let output = command
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .with_context(|| {
            format!(
                "failed to run git command: git -C {repo_path} {}",
                args.join(" ")
            )
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git command failed: {}", stderr.trim());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
