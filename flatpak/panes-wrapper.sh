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
export CODEX_HOME="${CODEX_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/codex}"
export CLAUDE_CONFIG_DIR="${CLAUDE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/claude}"
mkdir -p "$CODEX_HOME" "$CLAUDE_CONFIG_DIR" || true

exec /app/bin/Panes "$@"
