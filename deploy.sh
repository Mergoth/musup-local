#!/usr/bin/env bash
# Deploy musup to the NAS: build the image locally, ship it via docker save/load,
# sync compose + .env, restart. NAS settings live in deploy.local.sh (git-ignored).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

LOCAL_CONFIG="${SCRIPT_DIR}/deploy.local.sh"
if [[ ! -f "$LOCAL_CONFIG" ]]; then
  echo "ERROR: $LOCAL_CONFIG not found."
  echo "       Copy deploy.local.sh.example → deploy.local.sh and fill in your values."
  exit 1
fi
source "$LOCAL_CONFIG"

: "${NAS_USER:?deploy.local.sh must set NAS_USER}"
: "${NAS_HOST:?deploy.local.sh must set NAS_HOST}"
: "${NAS_PORT:?deploy.local.sh must set NAS_PORT}"
: "${NAS_DIR:?deploy.local.sh must set NAS_DIR}"
: "${REMOTE_DOCKER:?deploy.local.sh must set REMOTE_DOCKER}"

SSH="ssh -p ${NAS_PORT} ${NAS_USER}@${NAS_HOST}"
SCP="scp -O -P ${NAS_PORT}"

echo "==> Building image musup:latest..."
docker build --platform linux/amd64 -t musup:latest "${SCRIPT_DIR}/musup"

echo "==> Shipping image to NAS..."
docker save musup:latest | gzip | $SSH "gzip -d | ${REMOTE_DOCKER} load"

echo "==> Syncing compose file and .env..."
$SCP "${SCRIPT_DIR}/compose.nas.yml" "${NAS_USER}@${NAS_HOST}:${NAS_DIR}/docker-compose.yml"
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
  $SCP "${SCRIPT_DIR}/.env" "${NAS_USER}@${NAS_HOST}:${NAS_DIR}/.env"
else
  $SSH "touch '${NAS_DIR}/.env'"
fi

# --remove-orphans stops the old collector/processor containers, which would
# otherwise share the WhatsApp session with the new app.
echo "==> Restarting on NAS..."
$SSH "cd '${NAS_DIR}' && ${REMOTE_DOCKER} compose up -d --remove-orphans"

echo "==> Last 50 log lines:"
$SSH "${REMOTE_DOCKER} compose -f '${NAS_DIR}/docker-compose.yml' logs --tail=50 musup"
