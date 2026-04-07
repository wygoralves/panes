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

echo "Helper binaries built in $OUTPUT_DIR"
ls -la "$OUTPUT_DIR/com.panes.app.helper.keepawake" "$OUTPUT_DIR/PanesHelperRegistrar"
