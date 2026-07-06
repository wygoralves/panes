#!/bin/sh
set -eu

if [ -f /app/etc/profile.d/mise-env.sh ]; then
  . /app/etc/profile.d/mise-env.sh
fi

export SHELL="${SHELL:-/usr/bin/bash}"

exec /app/bin/Panes "$@"
