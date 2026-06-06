#!/usr/bin/env bash
# Deploy musup to NAS.
# Builds Docker images locally, ships them to the NAS via docker save/load,
# syncs config, and restarts the affected services.
#
# System-specific settings live in deploy.local.sh (git-ignored).
# Copy deploy.local.sh.example → deploy.local.sh and fill in your values.
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

TARGET="${1:-all}"  # all | collector | processor

# ---------------------------------------------------------------------------
build_processor() {
  echo "==> Compiling processor..."
  cd "${SCRIPT_DIR}/processor"
  ./gradlew clean installDist
  cd "${SCRIPT_DIR}"
}

build_image() {
  local service="$1"   # collector | processor
  echo "==> Building image: musup-${service}..."
  docker build --platform linux/amd64 -t "musup-${service}:latest" "${SCRIPT_DIR}/${service}"
}

ship_image() {
  local service="$1"
  echo "==> Shipping musup-${service} to NAS..."
  docker save "musup-${service}:latest" \
    | gzip \
    | $SSH "gzip -d | ${REMOTE_DOCKER} load"
  echo "    musup-${service} loaded on NAS."
}

sync_compose() {
  echo "==> Syncing docker-compose and .env to NAS..."
  scp -O -P "${NAS_PORT}" \
    "${SCRIPT_DIR}/docker-compose.nas.yml" \
    "${NAS_USER}@${NAS_HOST}:${NAS_DIR}/docker-compose.yml"
  scp -O -P "${NAS_PORT}" \
    "${SCRIPT_DIR}/.env" \
    "${NAS_USER}@${NAS_HOST}:${NAS_DIR}/.env"
}

remote_restart() {
  local services="$*"
  echo "==> Restarting on NAS: ${services:-all services}..."
  $SSH "
    set -e
    cd '${NAS_DIR}'
    ${REMOTE_DOCKER} compose up -d ${services}
  "
}

tail_logs() {
  local services="$*"
  echo "==> Tailing logs (Ctrl-C to stop)..."
  $SSH "${REMOTE_DOCKER} compose -f '${NAS_DIR}/docker-compose.yml' logs -f --tail=50 ${services}"
}

# ---------------------------------------------------------------------------
case "$TARGET" in
  collector)
    build_image collector
    ship_image collector
    sync_compose
    remote_restart collector
    tail_logs collector
    ;;
  processor)
    build_processor
    build_image processor
    ship_image processor
    sync_compose
    remote_restart processor
    tail_logs processor
    ;;
  all)
    build_processor
    build_image collector
    build_image processor
    ship_image collector
    ship_image processor
    sync_compose
    remote_restart
    tail_logs
    ;;
  *)
    echo "Usage: $0 [all|collector|processor]"
    exit 1
    ;;
esac
