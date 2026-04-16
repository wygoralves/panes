#!/usr/bin/env bash
# Build, sign, bundle, and run one of the audio-capture smoke tests.
# Usage: ./build-and-run.sh mic   (AVAudioEngine mic capture)
#        ./build-and-run.sh tap   (Core Audio process tap for system audio)
#
# Prereqs:
#   - macOS 14.2+ (Core Audio taps). Tested on 26.4 (Tahoe).
#   - A self-signed code-signing identity named "Panes Dev Signing" in
#     the login keychain (created via Keychain Access > Certificate
#     Assistant > Create a Certificate, Code Signing, self-signed root).
#
# The .app bundle + LaunchServices launch (open) is required on Tahoe —
# plain executables get silent TCC failure, no permission prompt.

set -euo pipefail
cd "$(dirname "$0")"

TARGET="${1:-mic}"
case "$TARGET" in
    mic)
        SRC=mic_smoke.swift
        NAME=PanesMicSmoke
        ID=dev.panes.mic-smoke
        USAGE_KEY=NSMicrophoneUsageDescription
        USAGE_TEXT="Testing microphone capture for the Panes Meetings feature."
        LOG=/tmp/panes-mic-smoke.log
        ;;
    tap)
        SRC=tap_smoke.swift
        NAME=PanesTapSmoke
        ID=dev.panes.tap-smoke
        USAGE_KEY=NSAudioCaptureUsageDescription
        USAGE_TEXT="Testing Core Audio process tap for the Panes Meetings feature."
        LOG=/tmp/panes-tap-smoke.log
        ;;
    *)
        echo "usage: $0 mic|tap" >&2
        exit 1
        ;;
esac

BUILD=build
APP="$BUILD/$NAME.app"
mkdir -p "$BUILD"
swiftc "$SRC" -o "$BUILD/$NAME"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BUILD/$NAME" "$APP/Contents/MacOS/$NAME"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>$NAME</string>
    <key>CFBundleIdentifier</key>
    <string>$ID</string>
    <key>CFBundleName</key>
    <string>$NAME</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSUIElement</key>
    <true/>
    <key>$USAGE_KEY</key>
    <string>$USAGE_TEXT</string>
</dict>
</plist>
PLIST
codesign --force --deep -s "Panes Dev Signing" "$APP"
rm -f "$LOG"
open "$APP"
echo "launched $NAME — waiting 9s for capture to finish..."
sleep 9
echo "--- $LOG ---"
cat "$LOG"
