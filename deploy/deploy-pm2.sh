#!/usr/bin/env bash
# Runs ON the EC2 instance. GitHub Actions pipes this file over SSH:
#
#   ssh ec2 "bash -s -- <commit-sha>" < deploy/deploy-pm2.sh
#
# Server layout (see deploy/README.md):
#   /opt/mywiki/api           git clone of this repo, run by pm2 as "mywiki-api"
#   /opt/mywiki/shared/.env   production settings (never in git)
#
# Steps: fetch → check out the exact commit → npm ci → pm2 restart → wait for /api/health.
# If the new version isn't healthy, it goes back to the previous commit, restarts that,
# and exits non-zero so the GitHub run is marked failed.
set -euo pipefail

SHA="${1:?usage: deploy-pm2.sh <commit-sha>}"
APP_DIR="${APP_DIR:-/opt/mywiki/api}"
ENV_FILE="${ENV_FILE:-/opt/mywiki/shared/.env}"
PM2_NAME="${PM2_NAME:-mywiki-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:5000/api/health}"

log() { printf '[deploy] %s\n' "$*"; }

[ -d "$APP_DIR/.git" ] || { log "$APP_DIR is not a git clone (see deploy/README.md)"; exit 1; }
[ -f "$ENV_FILE" ] || { log "missing $ENV_FILE"; exit 1; }
command -v pm2 >/dev/null || { log "pm2 is not installed (sudo npm install -g pm2)"; exit 1; }

cd "$APP_DIR"
PREVIOUS="$(git rev-parse HEAD)"
log "live: ${PREVIOUS:0:7} → deploying: ${SHA:0:7} (node $(node --version))"

install_and_restart() {
  git checkout --quiet --force --detach "$1"
  npm ci --omit=dev --no-audit --no-fund --loglevel=error
  if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    pm2 restart "$PM2_NAME" --update-env >/dev/null
  else
    # First deploy on a fresh server: create the process (ONE instance, never cluster mode).
    pm2 start src/index.js --name "$PM2_NAME" --node-args="--env-file=$ENV_FILE" \
      -i 1 --max-memory-restart 400M --time >/dev/null
  fi
  pm2 save >/dev/null # so a reboot brings back this version
}

healthy() { # the server only listens after MongoDB and S3 checks pass, so this covers them
  for _ in $(seq 1 40); do
    curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

git fetch --quiet origin
git cat-file -e "$SHA^{commit}" 2>/dev/null || { log "commit $SHA not found on origin"; exit 1; }

install_and_restart "$SHA"
if healthy; then
  log "healthy: $(curl -fsS "$HEALTH_URL")"
  log "done"
  exit 0
fi

log "health check FAILED — recent logs:"
pm2 logs "$PM2_NAME" --lines 40 --nostream 2>/dev/null || true
if [ "$PREVIOUS" != "$(git rev-parse "$SHA")" ]; then
  log "rolling back to ${PREVIOUS:0:7}"
  install_and_restart "$PREVIOUS"
  healthy && log "rollback healthy" || log "rollback ALSO unhealthy — check the server"
fi
exit 1
