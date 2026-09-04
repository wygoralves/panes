#!/usr/bin/env bash
# Creates a self-signed code-signing certificate in the login keychain so local
# Panes builds keep one stable code identity across rebuilds. macOS keys its
# privacy (TCC) grants to that identity: with ad-hoc signing every rebuild is a
# brand-new app and every permission has to be granted again.
#
# Usage:
#   scripts/macos/create-dev-signing-identity.sh [identity-name]
#
# Then build with the identity so the bundler signs the app:
#   APPLE_SIGNING_IDENTITY="Panes Dev Signing" pnpm tauri:build
#
# Only for local use. Release builds need an Apple Developer ID certificate.
set -euo pipefail

IDENTITY="${1:-Panes Dev Signing}"
KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script only applies to macOS." >&2
  exit 1
fi

if security find-identity -v -p codesigning "$KEYCHAIN" | grep -q "\"$IDENTITY\""; then
  echo "Identity \"$IDENTITY\" already exists in the login keychain."
  exit 0
fi

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

cat > "$WORKDIR/openssl.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no

[dn]
CN = $IDENTITY

[ext]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
EOF

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$WORKDIR/key.pem" -out "$WORKDIR/cert.pem" -config "$WORKDIR/openssl.cnf" >/dev/null 2>&1

P12_PASSWORD="panes-dev-$(date +%s)"
openssl pkcs12 -export -inkey "$WORKDIR/key.pem" -in "$WORKDIR/cert.pem" \
  -name "$IDENTITY" -out "$WORKDIR/identity.p12" -passout "pass:$P12_PASSWORD"

echo "Importing \"$IDENTITY\" into the login keychain (macOS may ask for your login password)."
security import "$WORKDIR/identity.p12" -k "$KEYCHAIN" -P "$P12_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null

# Trust the certificate for code signing so codesign accepts it without the
# per-use Keychain Access prompt.
security add-trusted-cert -d -r trustRoot -p codeSign -k "$KEYCHAIN" "$WORKDIR/cert.pem" || {
  echo "Could not mark the certificate as trusted automatically." >&2
  echo "Open Keychain Access, find \"$IDENTITY\", and set Code Signing to Always Trust." >&2
}

echo
echo "Done. Sign local builds with:"
echo "  APPLE_SIGNING_IDENTITY=\"$IDENTITY\" pnpm tauri:build"
echo
echo "Privacy grants given to a build signed this way survive rebuilds. Grants"
echo "given to an ad-hoc build or to a Developer ID build are separate."
