#!/bin/sh
set -eu

if [ -f /app/etc/profile.d/mise-env.sh ]; then
  # A failure while sourcing this (e.g. an unbound variable under some
  # future edit) must not block the app from launching under `set -eu`.
  . /app/etc/profile.d/mise-env.sh || true
fi

export SHELL="${SHELL:-/usr/bin/bash}"

# $HOME is a tmpfs inside the sandbox, so ~/.codex, ~/.claude and
# ~/.claude.json would be lost on exit. Point both CLIs at the persistent
# XDG config dir (~/.var/app/com.panes.app/config on the host). Values the
# user already set, and per-instance homes configured in Panes, still win.
# A home that already holds a login (a user who bind-mounted ~/.codex or
# ~/.claude into the sandbox and signed in there) is left in use, so
# updating does not sign them out.
config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
if [ -z "${CODEX_HOME:-}" ] && [ ! -f "$HOME/.codex/auth.json" ]; then
  export CODEX_HOME="$config_home/codex"
  mkdir -p "$CODEX_HOME" || true
fi
if [ -z "${CLAUDE_CONFIG_DIR:-}" ] && [ ! -f "$HOME/.claude/.credentials.json" ]; then
  export CLAUDE_CONFIG_DIR="$config_home/claude"
  mkdir -p "$CLAUDE_CONFIG_DIR" || true
fi

exec /app/bin/Panes "$@"
