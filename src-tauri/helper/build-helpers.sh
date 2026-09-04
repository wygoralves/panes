#!/bin/bash
# Compiles the privileged helper and registrar Swift binaries as universal
# (arm64 + x86_64) macOS binaries.
#
# Usage: ./build-helpers.sh [output_dir]
# Default output_dir: src-tauri/helper/build

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${1:-$SCRIPT_DIR/build}"
MIN_MACOS="13.0"

mkdir -p "$OUTPUT_DIR"

echo "Building PanesKeepAwakeHelper (universal)..."
swiftc -O -parse-as-library \
  -target arm64-apple-macos${MIN_MACOS} \
  "$SCRIPT_DIR/keepawake-helper.swift" \
  -o "$OUTPUT_DIR/keepawake-helper-arm64"

swiftc -O -parse-as-library \
  -target x86_64-apple-macos${MIN_MACOS} \
  "$SCRIPT_DIR/keepawake-helper.swift" \
  -o "$OUTPUT_DIR/keepawake-helper-x86_64"

lipo -create \
  "$OUTPUT_DIR/keepawake-helper-arm64" \
  "$OUTPUT_DIR/keepawake-helper-x86_64" \
  -output "$OUTPUT_DIR/com.panes.app.helper.keepawake"

rm "$OUTPUT_DIR/keepawake-helper-arm64" "$OUTPUT_DIR/keepawake-helper-x86_64"

echo "Building PanesHelperRegistrar (universal)..."
swiftc -O \
  -target arm64-apple-macos${MIN_MACOS} \
  "$SCRIPT_DIR/keepawake-registrar.swift" \
  -o "$OUTPUT_DIR/registrar-arm64"

swiftc -O \
  -target x86_64-apple-macos${MIN_MACOS} \
  "$SCRIPT_DIR/keepawake-registrar.swift" \
  -o "$OUTPUT_DIR/registrar-x86_64"

lipo -create \
  "$OUTPUT_DIR/registrar-arm64" \
  "$OUTPUT_DIR/registrar-x86_64" \
  -output "$OUTPUT_DIR/PanesHelperRegistrar"

rm "$OUTPUT_DIR/registrar-arm64" "$OUTPUT_DIR/registrar-x86_64"

# The Tauri bundler picks sidecars up by target-triple suffix and copies them
# into Contents/MacOS/ under the unsuffixed name. Both binaries are already
# universal, so every triple gets the same file. Going through the sidecar list
# rather than bundle.macOS.files is what gets them signed: the bundler signs
# sidecars inside out, before it seals the app, and codesign refuses to sign a
# bundle that still contains unsigned nested code.
for name in com.panes.app.helper.keepawake PanesHelperRegistrar; do
  for triple in aarch64-apple-darwin x86_64-apple-darwin universal-apple-darwin; do
    cp "$OUTPUT_DIR/$name" "$OUTPUT_DIR/$name-$triple"
  done
done

echo "Helper binaries built in $OUTPUT_DIR"
ls -la "$OUTPUT_DIR/com.panes.app.helper.keepawake" "$OUTPUT_DIR/PanesHelperRegistrar"
