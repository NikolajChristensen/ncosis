#!/usr/bin/env bash
# One-time: generates a release keystore (if one doesn't exist yet) and pushes it to this repo's
# GitHub secrets, so every CI build is signed with the same key and installs as an update over
# the last one instead of requiring an uninstall. Keep the keystore around locally too — losing
# both it and the GitHub secret means future updates can never again install over an existing one.
set -euo pipefail
cd "$(dirname "$0")/../web/android"

if [ ! -f release.jks ]; then
  pass=$(openssl rand -base64 24 | tr -d '/+=')
  keytool -genkeypair -v -keystore release.jks -alias ncosis -keyalg RSA -keysize 4096 \
    -validity 36500 -storepass "$pass" -keypass "$pass" -dname "CN=ncosis"
  printf 'storeFile=release.jks\nstorePassword=%s\nkeyAlias=ncosis\nkeyPassword=%s\n' "$pass" "$pass" > keystore.properties
  echo "Generated web/android/release.jks and keystore.properties"
else
  echo "web/android/release.jks already exists, reusing it"
fi

pass=$(grep '^storePassword=' keystore.properties | cut -d= -f2)

if command -v gh >/dev/null; then
  base64 -w0 release.jks | gh secret set KEYSTORE_BASE64
  printf '%s' "$pass" | gh secret set KEYSTORE_PASSWORD
  echo "Pushed KEYSTORE_BASE64 and KEYSTORE_PASSWORD to the repo's GitHub secrets"
else
  echo "gh CLI not found; set these secrets manually on the repo:"
  echo "KEYSTORE_PASSWORD=$pass"
  echo "KEYSTORE_BASE64=$(base64 -w0 release.jks)"
fi
