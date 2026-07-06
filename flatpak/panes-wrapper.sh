#!/bin/sh
set -eu

if [ -f /app/etc/profile.d/mise-env.sh ]; then
  # A failure while sourcing this (e.g. an unbound variable under some
  # future edit) must not block the app from launching under `set -eu`.
  . /app/etc/profile.d/mise-env.sh || true
fi

export SHELL="${SHELL:-/usr/bin/bash}"

exec /app/bin/Panes "$@"
