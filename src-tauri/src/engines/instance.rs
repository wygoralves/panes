//! Chat provider instances: several installs or accounts of the same engine
//! kind (for example `claude` and `claude_work`) that run side by side with
//! their own binary, home directory, environment, and launch arguments.

use std::{collections::BTreeMap, path::PathBuf};

use crate::config::app_config::ChatProviderInstanceConfig;
use crate::runtime_env;

pub const ENGINE_KINDS: &[&str] = &["codex", "claude", "opencode"];

/// Resolves the engine kind for an engine id. Built-in ids are their own
/// kind; extra instances are named `<kind>_<slug>`.
pub fn engine_kind(engine_id: &str) -> &str {
    if ENGINE_KINDS.contains(&engine_id) {
        return engine_id;
    }
    for kind in ENGINE_KINDS {
        if let Some(rest) = engine_id.strip_prefix(kind) {
            if rest.len() > 1 && rest.starts_with('_') {
                return kind;
            }
        }
    }
    engine_id
}

pub fn is_builtin_engine_id(engine_id: &str) -> bool {
    ENGINE_KINDS.contains(&engine_id)
}

/// Runtime settings applied when an engine instance spawns its process.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EngineInstanceSettings {
    pub binary_path: Option<PathBuf>,
    pub home_path: Option<PathBuf>,
    pub launch_args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

impl EngineInstanceSettings {
    pub fn from_config(config: &ChatProviderInstanceConfig) -> Self {
        Self {
            binary_path: config
                .binary_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(expand_home),
            home_path: config
                .home_path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(expand_home),
            launch_args: config
                .launch_args
                .as_deref()
                .map(shell_split)
                .unwrap_or_default(),
            env: config
                .env
                .iter()
                .filter(|(key, _)| !key.trim().is_empty())
                .map(|(key, value)| (key.trim().to_string(), value.clone()))
                .collect(),
        }
    }

    /// Environment variables to apply on the spawned process, with the kind
    /// specific home variable resolved from `home_path`.
    pub fn process_env(&self, kind: &str) -> BTreeMap<String, String> {
        let mut env = self.env.clone();
        if let Some(home_path) = self.home_path.as_ref() {
            let home_key = match kind {
                "codex" => Some("CODEX_HOME"),
                "claude" => Some("CLAUDE_CONFIG_DIR"),
                _ => None,
            };
            if let Some(key) = home_key {
                env.entry(key.to_string())
                    .or_insert_with(|| home_path.to_string_lossy().to_string());
            }
        }
        env
    }

    /// A configured binary path that exists and is executable.
    pub fn executable_override(&self) -> Option<PathBuf> {
        self.binary_path
            .as_ref()
            .filter(|path| runtime_env::is_executable_file(path))
            .cloned()
    }
}

pub fn expand_home(value: &str) -> PathBuf {
    if value == "~" {
        return runtime_env::home_dir().unwrap_or_else(|| PathBuf::from(value));
    }
    if let Some(rest) = value.strip_prefix("~/") {
        if let Some(home) = runtime_env::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(value)
}

/// Splits a launch-argument string the way a POSIX shell would for the
/// common cases: whitespace separation, single and double quotes, and
/// backslash escapes outside single quotes.
pub fn shell_split(input: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut in_token = false;
    let mut quote: Option<char> = None;
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        match quote {
            Some('\'') => {
                if ch == '\'' {
                    quote = None;
                } else {
                    current.push(ch);
                }
            }
            Some('"') => match ch {
                '"' => quote = None,
                '\\' => {
                    if let Some(next) = chars.next() {
                        if !matches!(next, '"' | '\\' | '$' | '`') {
                            current.push('\\');
                        }
                        current.push(next);
                    }
                }
                _ => current.push(ch),
            },
            _ => match ch {
                '\'' | '"' => {
                    quote = Some(ch);
                    in_token = true;
                }
                '\\' => {
                    if let Some(next) = chars.next() {
                        current.push(next);
                        in_token = true;
                    }
                }
                c if c.is_whitespace() => {
                    if in_token {
                        args.push(std::mem::take(&mut current));
                        in_token = false;
                    }
                }
                _ => {
                    current.push(ch);
                    in_token = true;
                }
            },
        }
    }

    if in_token {
        args.push(current);
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_kind_resolves_builtin_and_instance_ids() {
        assert_eq!(engine_kind("codex"), "codex");
        assert_eq!(engine_kind("claude_work"), "claude");
        assert_eq!(engine_kind("codex_personal-2"), "codex");
        assert_eq!(engine_kind("claude_"), "claude_");
        assert_eq!(engine_kind("claudex"), "claudex");
        assert_eq!(engine_kind("opencode"), "opencode");
    }

    #[test]
    fn shell_split_handles_quotes_and_escapes() {
        assert_eq!(shell_split(""), Vec::<String>::new());
        assert_eq!(shell_split("  --chrome  "), vec!["--chrome"]);
        assert_eq!(
            shell_split(r#"--model "gpt 5" --flag='a b' c\ d"#),
            vec!["--model", "gpt 5", "--flag=a b", "c d"]
        );
    }

    #[test]
    fn process_env_adds_the_kind_home_variable() {
        let settings = EngineInstanceSettings {
            home_path: Some(PathBuf::from("/tmp/claude2")),
            env: BTreeMap::from([("FOO".to_string(), "bar".to_string())]),
            ..Default::default()
        };
        let env = settings.process_env("claude");
        assert_eq!(
            env.get("CLAUDE_CONFIG_DIR").map(String::as_str),
            Some("/tmp/claude2")
        );
        assert_eq!(env.get("FOO").map(String::as_str), Some("bar"));
        assert!(settings.process_env("codex").contains_key("CODEX_HOME"));
        assert!(!settings.process_env("opencode").contains_key("CODEX_HOME"));
    }

    #[test]
    fn explicit_env_wins_over_home_path() {
        let settings = EngineInstanceSettings {
            home_path: Some(PathBuf::from("/tmp/a")),
            env: BTreeMap::from([("CODEX_HOME".to_string(), "/tmp/b".to_string())]),
            ..Default::default()
        };
        assert_eq!(
            settings
                .process_env("codex")
                .get("CODEX_HOME")
                .map(String::as_str),
            Some("/tmp/b")
        );
    }
}
