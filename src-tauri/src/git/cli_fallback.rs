use std::process::{Command, Output};

use anyhow::Context;

use crate::process_utils;

/// Config overrides applied to every git call Panes makes. A repo's own
/// `.git/config` can name a command in `core.fsmonitor`, and git runs it on
/// any call that refreshes the index (status, diff, add, checkout, ...).
/// Panes opens folders it did not create, so it never lets that run.
const BASE_CONFIG_OVERRIDES: &[&str] = &["-c", "core.fsmonitor=false"];

fn git_command(repo_path: &str) -> Command {
    let mut command = Command::new("git");
    process_utils::configure_std_command(&mut command);
    command.arg("-C").arg(repo_path).args(BASE_CONFIG_OVERRIDES);
    command
}

fn describe(repo_path: &str, args: &[&str]) -> String {
    format!("git -C {repo_path} {}", args.join(" "))
}

fn into_stdout(output: Output) -> anyhow::Result<String> {
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("git command failed: {}", stderr.trim());
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Runs a git command the user asked for (stage, commit, checkout, ...).
pub fn run_git(repo_path: &str, args: &[&str]) -> anyhow::Result<String> {
    let output = git_command(repo_path)
        .args(args)
        .output()
        .with_context(|| format!("failed to run git command: {}", describe(repo_path, args)))?;
    into_stdout(output)
}

/// Runs a git command that only reads the repo (status, diff, log, ...).
/// Panes runs these in the background, without a click, for every repo it
/// shows. `--no-optional-locks` keeps `git status` from rewriting the index,
/// which would otherwise run the repo's `post-index-change` hook.
pub fn run_git_read(repo_path: &str, args: &[&str]) -> anyhow::Result<String> {
    let output = git_command(repo_path)
        .arg("--no-optional-locks")
        .args(args)
        .output()
        .with_context(|| format!("failed to run git command: {}", describe(repo_path, args)))?;
    into_stdout(output)
}
