#!/usr/bin/env bash
# Official-client contract test: drives @bitwarden/cli (pinned in
# ./cli-version) against a NodeWarden server. Passing this flow is the
# repo's definition of "official Bitwarden clients can connect".
# Usage: run.sh [BASE_URL]   (no arg = boot wrangler dev locally over HTTPS)
#
# APPROVED DEVIATION FROM THE ORIGINAL BRIEF: as of @bitwarden/cli 2025.11+,
# the official CLI's ApiService.fetch() unconditionally rejects any
# non-"https://" URL (InsecureUrlNotAllowedError) -- this is baked in at
# publish time (isDev() compiles to the literal `"production" ===
# "development"`), so there is no env var or flag to disable it. Plain HTTP
# wrangler dev can therefore never satisfy the current pinned CLI. Instead of
# pinning an old CLI (rejected -- the pin is meant to track current
# releases), we serve wrangler dev over HTTPS locally with a throwaway
# self-signed cert and make both curl and the CLI trust it.
set -euo pipefail
cd "$(dirname "$0")/../.."

BASE="${1:-}"
WRANGLER_PID=""
CERT_DIR=""
cleanup() { [ -n "$WRANGLER_PID" ] && kill "$WRANGLER_PID" 2>/dev/null || true; }
trap cleanup EXIT

CURL_CACERT=()
if [ -z "$BASE" ]; then
  BASE="https://127.0.0.1:8787"
  grep -q JWT_SECRET .dev.vars 2>/dev/null || echo "JWT_SECRET=$(openssl rand -hex 32)" >> .dev.vars

  # Throwaway self-signed cert for 127.0.0.1, valid 2 days. Regenerated every
  # run; never reused, never committed.
  CERT_DIR="$(mktemp -d)"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
    -days 2 -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" \
    > /dev/null 2>&1

  # A contract run always starts from an empty DB so the first-user
  # (invite-code-free) registration path is deterministic.
  WRANGLER_HTTPS_KEY_PATH="$CERT_DIR/key.pem" \
  WRANGLER_HTTPS_CERT_PATH="$CERT_DIR/cert.pem" \
    npx wrangler dev -c wrangler.toml --ip 127.0.0.1 --port 8787 \
      --local-protocol https --persist-to "$(mktemp -d)" \
      > /tmp/wrangler-compat.log 2>&1 &
  WRANGLER_PID=$!

  # Make curl (health check) and Node/the CLI (all bw + seed-account.mjs
  # calls) trust the cert we just generated.
  CURL_CACERT=(--cacert "$CERT_DIR/cert.pem")
  export NODE_EXTRA_CA_CERTS="$CERT_DIR/cert.pem"
fi

echo "waiting for $BASE ..."
for i in $(seq 1 60); do
  curl -sf "${CURL_CACERT[@]}" "$BASE/api/config" > /dev/null && break
  [ "$i" -eq 60 ] && { echo "server never became healthy"; tail -50 /tmp/wrangler-compat.log 2>/dev/null; exit 1; }
  sleep 3
done

# Install the pinned CLI into an isolated prefix (works locally and in CI).
CLI_VERSION="$(cat scripts/client-compat/cli-version)"
CLI_DIR="$(mktemp -d)"
npm install --prefix "$CLI_DIR" --no-save --loglevel=error "@bitwarden/cli@${CLI_VERSION}"
BW="$CLI_DIR/node_modules/.bin/bw"
export BITWARDENCLI_APPDATA_DIR="$(mktemp -d)"

EMAIL="compat-$(date +%s)@example.com"
PASSWORD="CompatPassw0rd!$RANDOM"
node scripts/client-compat/seed-account.mjs "$BASE" "$EMAIL" "$PASSWORD"

fail() { echo "FAIL: $1"; exit 1; }

"$BW" config server "$BASE"
export BW_SESSION="$("$BW" login "$EMAIL" "$PASSWORD" --raw)"
[ -n "$BW_SESSION" ] || fail "login returned empty session"
"$BW" sync || fail "initial sync"

FOLDER_ID="$("$BW" get template folder | jq -c '.name="compat-folder"' | "$BW" encode | "$BW" create folder | jq -r '.id')"
[ -n "$FOLDER_ID" ] && [ "$FOLDER_ID" != "null" ] || fail "folder create"

ITEM_ID="$("$BW" get template item \
  | jq -c --arg fid "$FOLDER_ID" '.type=1 | .name="compat-item" | .notes="compat note" | .folderId=$fid
      | .login={"username":"compat-user","password":"compat-pass","uris":[{"uri":"https://example.com"}]}' \
  | "$BW" encode | "$BW" create item | jq -r '.id')"
[ -n "$ITEM_ID" ] && [ "$ITEM_ID" != "null" ] || fail "item create"

"$BW" sync || fail "post-create sync"
"$BW" get item "$ITEM_ID" | jq -e '.name=="compat-item" and .login.username=="compat-user"' > /dev/null || fail "item read-back"

"$BW" get item "$ITEM_ID" | jq -c '.name="compat-item-edited"' | "$BW" encode | "$BW" edit item "$ITEM_ID" > /dev/null || fail "item edit"

# Fresh login proves server-side persistence AND that a brand-new client
# session can decrypt everything (keys round-trip through the server).
"$BW" logout
export BW_SESSION="$("$BW" login "$EMAIL" "$PASSWORD" --raw)"
"$BW" sync || fail "fresh-login sync"
"$BW" get item "$ITEM_ID" | jq -e '.name=="compat-item-edited"' > /dev/null || fail "edit persisted across fresh login"

"$BW" delete item "$ITEM_ID" || fail "item delete"
"$BW" sync || fail "post-delete sync"
"$BW" list items | jq -e --arg id "$ITEM_ID" 'map(select(.id==$id)) | length == 0' > /dev/null || fail "item still listed after delete"
"$BW" delete folder "$FOLDER_ID" || fail "folder delete"

echo "CLIENT-COMPAT PASS (cli v${CLI_VERSION}, server ${BASE})"
