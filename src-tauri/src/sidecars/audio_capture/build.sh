#!/usr/bin/env bash
# Build, sign, and bundle PanesAudioCapture for local testing.
#
# Produces a signed .app bundle at .build/PanesAudioCapture.app that can be
# launched via LaunchServices (required on macOS Tahoe for TCC prompts).
#
# Configuration via env vars:
#   PANES_SIGNING_ID   Code-signing identity name (default: "Panes Dev Signing")
#   PANES_BUNDLE_ID    Bundle identifier (default: "dev.panes.audio-capture")

set -euo pipefail
cd "$(dirname "$0")"

SIGNING_ID="${PANES_SIGNING_ID:-Panes Dev Signing}"
BUNDLE_ID="${PANES_BUNDLE_ID:-dev.panes.audio-capture}"
NAME="PanesAudioCapture"
BUILD_DIR=".build"
APP_BUNDLE="$BUILD_DIR/${NAME}.app"

echo "[1/4] swift build -c release"
swift build -c release

RELEASE_BIN="$BUILD_DIR/release/$NAME"
if [ ! -f "$RELEASE_BIN" ]; then
    echo "build failed — binary not found at $RELEASE_BIN" >&2
    exit 1
fi

echo "[2/4] assembling .app bundle at $APP_BUNDLE"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
cp "$RELEASE_BIN" "$APP_BUNDLE/Contents/MacOS/$NAME"

cat > "$APP_BUNDLE/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>${NAME}</string>
    <key>CFBundleIdentifier</key>
    <string>${BUNDLE_ID}</string>
    <key>CFBundleName</key>
    <string>${NAME}</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSMicrophoneUsageDescription</key>
    <string>Panes records microphone audio during meetings to produce a transcript.</string>
    <key>NSAudioCaptureUsageDescription</key>
    <string>Panes captures system audio during meetings so remote participants are included in the transcript.</string>
</dict>
</plist>
PLIST

echo "[3/4] signing with identity: $SIGNING_ID"
codesign --force --deep -s "$SIGNING_ID" "$APP_BUNDLE"

echo "[4/4] verifying signature"
codesign -dvv "$APP_BUNDLE" 2>&1 | grep -E "Authority|Identifier|Format" || true

echo ""
echo "Bundle ready: $APP_BUNDLE"
echo ""
echo "Quick test (10s mic capture to a PCM file):"
echo "  rm -f /tmp/panes-audio-test.pcm"
echo "  open \"$APP_BUNDLE\" --args --output-file /tmp/panes-audio-test.pcm --duration 10"
echo "  # (click Allow on the mic prompt on first run; wait ~11s)"
echo "  ls -la /tmp/panes-audio-test.pcm"
echo ""
echo "Verify non-silent (amplitude > 0):"
echo "  python3 -c \"import struct,sys; d=open('/tmp/panes-audio-test.pcm','rb').read(); n=len(d)//4; s=struct.unpack(f'{n}f',d); print('samples',n,'mean|amp|',sum(abs(x) for x in s)/max(n,1))\""
