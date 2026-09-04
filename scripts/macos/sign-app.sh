#!/usr/bin/env bash
# Re-signs a built Panes.app (or the dev binary) with a stable identity and the
# project's entitlements. Useful when you already have a bundle from
# `pnpm tauri:build` or want the `tauri dev` binary to keep its privacy grants
# between rebuilds.
#
# Usage:
#   scripts/macos/sign-app.sh <path-to-Panes.app-or-binary> [identity-name]
#
# The identity defaults to "Panes Dev Signing"; create it with
# scripts/macos/create-dev-signing-identity.sh.
#
# For an .app bundle every nested Mach-O file is signed before the bundle
# itself, deepest path first. codesign refuses to seal a bundle whose nested
# code is unsigned, and signing outside in would invalidate anything signed
# afterwards. This also covers the Mach-O files the Tauri bundler never signs
# on its own, such as the native Claude binaries under Contents/Resources.
set -euo pipefail

TARGET="${1:-}"
IDENTITY="${2:-${APPLE_SIGNING_IDENTITY:-Panes Dev Signing}}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENTITLEMENTS="$ROOT/src-tauri/entitlements.plist"

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <path-to-Panes.app-or-binary> [identity-name]" >&2
  exit 1
fi
if [[ ! -e "$TARGET" ]]; then
  echo "Nothing to sign at $TARGET" >&2
  exit 1
fi

# Hardened runtime plus the project entitlements, the same combination
# tauri.conf.json asks the bundler for. None of those entitlements require a
# provisioning profile or the App Sandbox, so the nested helpers can carry them
# unchanged and still launch as a root launchd daemon.
sign_executable() {
  codesign --force --options runtime --timestamp=none \
    --entitlements "$ENTITLEMENTS" \
    --sign "$IDENTITY" "$@"
}

# Libraries take no entitlements and no runtime flag of their own.
sign_library() {
  codesign --force --timestamp=none --sign "$IDENTITY" "$@"
}

if [[ -d "$TARGET" && "$TARGET" == *.app ]]; then
  APP="$(cd "$TARGET" && pwd)"
  MAIN_EXECUTABLE="$APP/Contents/MacOS/Panes"

  # Deepest path first, so signing a container never invalidates a signature
  # that was just applied inside it.
  while IFS= read -r nested; do
    [[ "$nested" == "$MAIN_EXECUTABLE" ]] && continue
    kind="$(file -b "$nested")"
    case "$kind" in
      *Mach-O*executable*)
        echo "Signing nested executable ${nested#"$APP/"}"
        sign_executable "$nested"
        ;;
      *Mach-O*)
        echo "Signing nested library ${nested#"$APP/"}"
        sign_library "$nested"
        ;;
    esac
  done < <(find "$APP/Contents" -type f -print | awk -F'/' '{ print NF "\t" $0 }' | sort -rn | cut -f2-)

  sign_executable --identifier com.panes.app "$APP"
else
  sign_executable --identifier com.panes.app "$TARGET"
fi

echo "Signed $TARGET with \"$IDENTITY\":"
codesign -dv --verbose=2 "$TARGET" 2>&1 | grep -E 'Identifier|Authority|TeamIdentifier' || true
