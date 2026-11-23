use std::{
    io::Read,
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

use anyhow::Context;

use crate::process_utils;

/// Config overrides applied to every git call Panes makes. A repo's own
/// `.git/config` can name a command in `core.fsmonitor`, and git runs it on
/// any call that refreshes the index (status, diff, add, checkout, ...).
/// Panes opens folders it did not create, so it never lets that run.
const BASE_CONFIG_OVERRIDES: &[&str] = &["-c", "core.fsmonitor=false"];

/// How long a network command (fetch, pull, push) may run before Panes stops
/// it. Generous enough for a large push on a slow link, but bounded so a
/// stalled connection or an ssh prompt cannot pin the sync state forever.
pub const GIT_NETWORK_TIMEOUT: Duration = Duration::from_secs(300);

fn git_command(repo_path: &str) -> Command {
    let mut command = Command::new("git");
    process_utils::configure_std_command(&mut command);
    command
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .arg("-C")
        .arg(repo_path)
        .args(BASE_CONFIG_OVERRIDES);
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

/// Runs a git command that talks to a remote. The child gets no terminal
/// prompts and is stopped once `timeout` passes, so a stalled connection, a
/// credential prompt or an ssh host-key question cannot hang Panes.
pub fn run_git_network(
    repo_path: &str,
    args: &[&str],
    timeout: Duration,
) -> anyhow::Result<String> {
    let mut command = git_command(repo_path);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Put git and the ssh or credential helpers it starts in their own process
    // group so a timeout can stop all of them, not only git.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command
        .spawn()
        .with_context(|| format!("failed to run git command: {}", describe(repo_path, args)))?;

    let stdout_reader = spawn_pipe_reader(child.stdout.take());
    let stderr_reader = spawn_pipe_reader(child.stderr.take());

    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child.try_wait().context("failed to wait for git")? {
            break status;
        }
        if Instant::now() >= deadline {
            kill_process_tree(&mut child);
            let _ = child.wait();
            // The readers are left to finish on their own: on Windows a
            // helper that outlived git can keep the pipes open.
            anyhow::bail!(
                "git command timed out after {} seconds: {}",
                timeout.as_secs(),
                describe(repo_path, args)
            );
        }
        thread::sleep(Duration::from_millis(50));
    };

    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();
    into_stdout(Output {
        status,
        stdout,
        stderr,
    })
}

fn spawn_pipe_reader<R: Read + Send + 'static>(pipe: Option<R>) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut buffer);
        }
        buffer
    })
}

fn kill_process_tree(child: &mut std::process::Child) {
    #[cfg(unix)]
    {
        // The child leads its own process group (see run_git_network).
        let pgid = child.id() as libc::pid_t;
        unsafe {
            libc::kill(-pgid, libc::SIGKILL);
        }
    }
    let _ = child.kill();
}

/// Lists config keys matching `key_regex` that come from the repository
/// itself (`.git/config`, its worktree config, or files they include), as
/// opposed to the user's global or system config. Uses git rather than
/// libgit2 so conditional includes resolve exactly as they would for git.
pub fn repo_scoped_config_keys(repo_path: &str, key_regex: &str) -> anyhow::Result<Vec<String>> {
    let args = ["config", "--show-scope", "-z", "--get-regexp", key_regex];
    let output = git_command(repo_path)
        .args(args)
        .output()
        .with_context(|| format!("failed to run git command: {}", describe(repo_path, &args)))?;

    // `git config --get-regexp` exits with 1 when nothing matches.
    if output.status.code() == Some(1) {
        return Ok(Vec::new());
    }
    let stdout = into_stdout(output).context("failed to read repository git config")?;

    let mut keys = Vec::new();
    let mut fields = stdout.split('\0');
    while let (Some(scope), Some(entry)) = (fields.next(), fields.next()) {
        if scope != "local" && scope != "worktree" {
            continue;
        }
        let key = entry.split_once('\n').map_or(entry, |(key, _)| key);
        if !keys.iter().any(|existing| existing == key) {
            keys.push(key.to_string());
        }
    }
    Ok(keys)
}

/// A `-c` value that turns off every hook for one git call, including the
/// ones a repo ships in `.git/hooks` or points at with `core.hooksPath`.
pub fn hooks_disabled_config() -> anyhow::Result<String> {
    #[cfg(not(target_os = "windows"))]
    {
        // Hooks are looked up as `<hooksPath>/<name>`, which never exists
        // under a file.
        Ok("core.hooksPath=/dev/null".to_string())
    }
    #[cfg(target_os = "windows")]
    {
        let dir = crate::runtime_env::app_data_dir().join("empty-hooks");
        std::fs::create_dir_all(&dir).context("failed to prepare an empty hooks directory")?;
        Ok(format!("core.hooksPath={}", dir.display()))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use std::time::{Duration, Instant};

    use super::{run_git, run_git_network};

    struct TempDir(std::path::PathBuf);

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn temp_repo() -> TempDir {
        let path = std::env::temp_dir().join(format!("panes-cli-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("create temp dir");
        run_git(path.to_str().unwrap(), &["init", "--initial-branch=main"]).expect("git init");
        TempDir(path)
    }

    #[test]
    fn network_command_is_stopped_after_its_timeout() {
        let _env = crate::process_utils::test_env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let repo = temp_repo();

        let started = Instant::now();
        let error = run_git_network(
            repo.0.to_str().unwrap(),
            &["-c", "alias.hang=!sleep 30", "hang"],
            Duration::from_millis(300),
        )
        .expect_err("a hung command must time out");

        assert!(error.to_string().contains("timed out"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn network_command_never_prompts_on_a_terminal() {
        let _env = crate::process_utils::test_env_lock()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let repo = temp_repo();

        let output = run_git_network(
            repo.0.to_str().unwrap(),
            &["-c", "alias.env=!printf %s \"$GIT_TERMINAL_PROMPT\"", "env"],
            Duration::from_secs(10),
        )
        .expect("alias runs");

        assert_eq!(output, "0");
    }
}
