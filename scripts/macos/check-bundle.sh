#!/usr/bin/env bash
# Asserts that a built Panes.app carries the complete macOS keep-awake helper
# payload, and that the payload is signed when the bundle itself is signed.
#
# Usage:
#   scripts/macos/check-bundle.sh <path-to-Panes.app>
#
# Exits non-zero with a per-check message on the first failure, so it is safe to
# use as a CI gate right after the macOS bundle step.
set -uo pipefail

APP="${1:-}"

if [[ -z "$APP" ]]; then
  echo "Usage: $0 <path-to-Panes.app>" >&2
  exit 2
fi
if [[ ! -d "$APP" ]]; then
  echo "No app bundle at $APP" >&2
  exit 2
fi

APP="$(cd "$APP" && pwd)"
FAILURES=0

fail() {
  echo "FAIL: $*" >&2
  FAILURES=$((FAILURES + 1))
}

ok() {
  echo "ok: $*"
}

# Bundle-relative path -> what it has to be.
# Both binaries ship as Tauri sidecars (externalBin in tauri.macos.conf.json)
# rather than bundle.macOS.files, because the bundler signs sidecars inside out
# and leaves custom files untouched.
# The registrar has to sit next to the main executable because
# power::macos_helper::resolve_registrar_path looks for a sibling of
# std::env::current_exe(). The launch daemon plist has to sit in
# Contents/Library/LaunchDaemons because that is the only place
# SMAppService.daemon(plistName:) reads from, and its BundleProgram points at
# the helper binary in Contents/MacOS.
EXPECTED_MACHO=(
  "Contents/MacOS/Panes"
  "Contents/MacOS/PanesHelperRegistrar"
  "Contents/MacOS/com.panes.app.helper.keepawake"
)
EXPECTED_PLIST=(
  "Contents/Library/LaunchDaemons/com.panes.app.helper.keepawake.plist"
)

echo "Checking helper payload in $APP"

for relative in "${EXPECTED_MACHO[@]}"; do
  path="$APP/$relative"
  if [[ ! -f "$path" ]]; then
    fail "missing $relative"
    continue
  fi
  if [[ ! -x "$path" ]]; then
    fail "$relative is not executable"
    continue
  fi
  kind="$(file -b "$path" | head -1)"
  if [[ "$kind" != *Mach-O* ]]; then
    fail "$relative is not a Mach-O binary: $kind"
    continue
  fi
  ok "$relative ($kind)"
done

for relative in "${EXPECTED_PLIST[@]}"; do
  path="$APP/$relative"
  if [[ ! -f "$path" ]]; then
    fail "missing $relative"
    continue
  fi
  if ! plutil -lint "$path" >/dev/null 2>&1; then
    fail "$relative is not a readable property list"
    continue
  fi
  ok "$relative"
done

# A universal app has to carry universal helpers, otherwise the feature dies on
# whichever architecture the helper was not built for.
MAIN_EXECUTABLE="$APP/Contents/MacOS/Panes"
if [[ -f "$MAIN_EXECUTABLE" ]] && lipo -info "$MAIN_EXECUTABLE" 2>/dev/null | grep -q 'Architectures in the fat file'; then
  MAIN_ARCHS="$(lipo -archs "$MAIN_EXECUTABLE" 2>/dev/null | tr ' ' '\n' | sort | tr '\n' ' ')"
  for relative in "Contents/MacOS/PanesHelperRegistrar" "Contents/MacOS/com.panes.app.helper.keepawake"; do
    path="$APP/$relative"
    [[ -f "$path" ]] || continue
    helper_archs="$(lipo -archs "$path" 2>/dev/null | tr ' ' '\n' | sort | tr '\n' ' ')"
    if [[ "$helper_archs" != "$MAIN_ARCHS" ]]; then
      fail "$relative has architectures [$helper_archs], expected [$MAIN_ARCHS] to match the app binary"
    else
      ok "$relative matches the app architectures [$helper_archs]"
    fi
  done
fi

# The daemon plist has to describe the binary that actually shipped.
DAEMON_PLIST="$APP/Contents/Library/LaunchDaemons/com.panes.app.helper.keepawake.plist"
if [[ -f "$DAEMON_PLIST" ]]; then
  LABEL="$(/usr/libexec/PlistBuddy -c 'Print :Label' "$DAEMON_PLIST" 2>/dev/null || true)"
  if [[ "$LABEL" != "com.panes.app.helper.keepawake" ]]; then
    fail "daemon Label is \"$LABEL\", expected com.panes.app.helper.keepawake to match the plist file name"
  else
    ok "daemon Label matches the plist file name"
  fi

  BUNDLE_PROGRAM="$(/usr/libexec/PlistBuddy -c 'Print :BundleProgram' "$DAEMON_PLIST" 2>/dev/null || true)"
  if [[ -z "$BUNDLE_PROGRAM" ]]; then
    fail "daemon plist has no BundleProgram key, so SMAppService cannot resolve the helper inside the bundle"
  elif [[ ! -f "$APP/$BUNDLE_PROGRAM" ]]; then
    fail "daemon BundleProgram \"$BUNDLE_PROGRAM\" does not exist in the bundle"
  else
    ok "daemon BundleProgram resolves to $BUNDLE_PROGRAM"
  fi
fi

# Signature checks only make sense once something signed the bundle. A local
# unsigned build still has to pass the payload checks above. The main
# executable is deliberately not verified on its own: inside a bundle it is
# only valid through the bundle's own signature.
NESTED_MACHO=(
  "Contents/MacOS/PanesHelperRegistrar"
  "Contents/MacOS/com.panes.app.helper.keepawake"
)

if [[ -f "$APP/Contents/_CodeSignature/CodeResources" ]]; then
  echo "Bundle is signed, verifying nested code"

  for relative in "${NESTED_MACHO[@]}"; do
    path="$APP/$relative"
    [[ -f "$path" ]] || continue
    if ! nested_output="$(codesign --verify --strict "$path" 2>&1)"; then
      fail "$relative is not validly signed: $(echo "$nested_output" | head -3 | tr '\n' ' ')"
      continue
    fi
    ok "$relative signature verifies"
  done

  if ! verify_output="$(codesign --verify --deep --strict --verbose=2 "$APP" 2>&1)"; then
    fail "codesign --verify --deep --strict failed: $(echo "$verify_output" | tr '\n' ' ')"
  else
    ok "codesign --verify --deep --strict passes"
  fi

  # Ad-hoc signatures carry no authority, so this only runs for real identities.
  app_authority="$(codesign -dv --verbose=2 "$APP" 2>&1 | awk -F'=' '/^Authority=/ {print $2; exit}')"
  if [[ -n "$app_authority" ]]; then
    for relative in "${NESTED_MACHO[@]}"; do
      path="$APP/$relative"
      [[ -f "$path" ]] || continue
      nested_authority="$(codesign -dv --verbose=2 "$path" 2>&1 | awk -F'=' '/^Authority=/ {print $2; exit}')"
      if [[ "$nested_authority" != "$app_authority" ]]; then
        fail "$relative is signed by \"$nested_authority\", expected the app identity \"$app_authority\""
      else
        ok "$relative shares the app signing identity"
      fi
    done
  fi
else
  echo "Bundle carries no signature, skipping codesign verification"
fi

if [[ "$FAILURES" -gt 0 ]]; then
  echo "$FAILURES bundle check(s) failed for $APP" >&2
  exit 1
fi

echo "Bundle check passed for $APP"
