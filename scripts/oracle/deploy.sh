#!/usr/bin/env bash
# Deploy musup to a VM (Oracle Cloud Always Free ARM by default).
#   scripts/oracle/deploy.sh setup   one-time: install Docker on a fresh Ubuntu VM
#   scripts/oracle/deploy.sh         build image, ship it, restart
#   scripts/oracle/deploy.sh tunnel  open the admin UI at http://localhost:8787
#   scripts/oracle/deploy.sh logs    last 100 log lines
# Host settings live in scripts/oracle/deploy.local.sh (git-ignored); .env is read from the repo root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

LOCAL_CONFIG="${SCRIPT_DIR}/deploy.local.sh"
if [[ ! -f "$LOCAL_CONFIG" ]]; then
  echo "ERROR: $LOCAL_CONFIG not found."
  echo "       Copy deploy.local.sh.example → deploy.local.sh and fill in your values."
  exit 1
fi
source "$LOCAL_CONFIG"

: "${DEPLOY_USER:?deploy.local.sh must set DEPLOY_USER}"
: "${DEPLOY_HOST:?deploy.local.sh must set DEPLOY_HOST}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/${DEPLOY_USER}/musup}"
DEPLOY_PLATFORM="${DEPLOY_PLATFORM:-linux/arm64}"
APP_PORT="${APP_PORT:-8787}"

SSH_OPTS=(-p "${DEPLOY_PORT}")
[[ -n "${SSH_KEY:-}" ]] && SSH_OPTS+=(-i "${SSH_KEY}")
TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
remote() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }
upload() { scp -P "${DEPLOY_PORT}" ${SSH_KEY:+-i "$SSH_KEY"} "$1" "${TARGET}:$2"; }

case "${1:-deploy}" in
  setup)
    echo "==> Installing Docker on ${DEPLOY_HOST}..."
    remote "set -e
      sudo apt-get update -q
      sudo apt-get install -y -q docker.io docker-compose-v2
      sudo usermod -aG docker \$USER
      if [ ! -f /swapfile ]; then
        sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
        sudo mkswap /swapfile && sudo swapon /swapfile
        echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
      fi
      mkdir -p '${DEPLOY_DIR}/data'"
    echo "Done. Run $0 to deploy."
    ;;
  deploy)
    echo "==> Building musup:latest for ${DEPLOY_PLATFORM}..."
    docker build --platform "${DEPLOY_PLATFORM}" -t musup:latest "${REPO_ROOT}/musup"

    echo "==> Shipping image..."
    docker save musup:latest | gzip | remote "gzip -d | docker load"

    echo "==> Syncing compose file and .env..."
    remote "mkdir -p '${DEPLOY_DIR}/data'"
    upload "${SCRIPT_DIR}/compose.prod.yml" "${DEPLOY_DIR}/compose.yml"
    if [[ -f "${REPO_ROOT}/.env" ]]; then
      upload "${REPO_ROOT}/.env" "${DEPLOY_DIR}/.env"
    else
      remote "touch '${DEPLOY_DIR}/.env'"
    fi

    echo "==> Restarting..."
    remote "cd '${DEPLOY_DIR}' && docker compose up -d --remove-orphans && docker image prune -f >/dev/null"
    remote "cd '${DEPLOY_DIR}' && docker compose logs --tail=50 musup"
    ;;
  tunnel)
    echo "Admin UI: http://localhost:${APP_PORT}  (Ctrl+C to close)"
    ssh "${SSH_OPTS[@]}" -N -L "${APP_PORT}:127.0.0.1:${APP_PORT}" "$TARGET"
    ;;
  logs)
    remote "cd '${DEPLOY_DIR}' && docker compose logs --tail=100 musup"
    ;;
  *)
    echo "Usage: $0 [setup|deploy|tunnel|logs]"
    exit 1
    ;;
esac
