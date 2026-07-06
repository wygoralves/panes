#!/bin/sh

XDG_DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
XDG_STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"

export MISE_DATA_DIR="${MISE_DATA_DIR:-$XDG_DATA_HOME/mise}"
export MISE_CONFIG_DIR="${MISE_CONFIG_DIR:-$XDG_CONFIG_HOME/mise}"
export MISE_STATE_DIR="${MISE_STATE_DIR:-$XDG_STATE_HOME/mise}"

case ":${PATH:-}:" in
  *":/app/bin:"*) ;;
  *) PATH="/app/bin:/usr/bin:/bin${PATH:+:$PATH}" ;;
esac

case ":$PATH:" in
  *":$MISE_DATA_DIR/shims:"*) ;;
  *) PATH="$MISE_DATA_DIR/shims:$PATH" ;;
esac

export PATH
