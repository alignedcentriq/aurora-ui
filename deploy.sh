#!/bin/bash
# Centriq AI — rsync + bring-up script.
#
# Usage (Git Bash / WSL / Linux — needs rsync + ssh in PATH):
#   SSH_HOST=optimize@hackathon.alignedautomation.com bash deploy.sh
#
# Optional env vars:
#   REMOTE_DIR — deployment dir on the server, relative to home or absolute
#                (default: centriq_ai)
#   BRANCH     — A | B | C  (default: B — Phase 0 confirmed for this server)
#                B = host nginx forwards hackathon.alignedautomation.com → :8090
#
# Branch B (current): just run this script for every deploy.
# Branch A (we own 80/443): change docker-compose.yml ports to "80:80" first,
#   then after first deploy run: ssh $SSH_HOST "cd ~/centriq_ai && bash first-deploy.sh"

set -euo pipefail

SSH_HOST="${SSH_HOST:-}"
REMOTE_DIR="${REMOTE_DIR:-/data/optimize/centriq_ai}"
BRANCH="${BRANCH:-B}"

# ── guards ────────────────────────────────────────────────────────────────────
if [[ -z "$SSH_HOST" ]]; then
    echo "ERROR: set SSH_HOST. Example:"
    echo "  SSH_HOST=optimize@hackathon.alignedautomation.com bash deploy.sh"
    exit 1
fi

for f in .env backend/.env; do
    if [[ ! -f "$f" ]]; then
        echo "ERROR: $f missing. Copy from ${f}.example and fill in real values first."
        exit 1
    fi
done

echo "Branch: $BRANCH  |  Host: $SSH_HOST  |  Remote dir: $REMOTE_DIR"
echo ""

# ── local frontend build ──────────────────────────────────────────────────────
# Build runs locally (not in Docker) — avoids Vinxi/workerd inter-process issues
# that occur in the Docker build environment when wrangler.jsonc is present.
# Requires .env to exist with VITE_MSAL_* values so they're baked into the bundle.
echo "=== Building frontend locally ==="
npm run build
# TanStack Start SPA mode emits the shell as _shell.html; copy to index.html so
# nginx's try_files and any static server find the conventional entrypoint.
cp dist/client/_shell.html dist/client/index.html
echo ""

# ── sync to server ────────────────────────────────────────────────────────────
# dist/ is included — the server-side Dockerfile just COPYs the pre-built bundle.
# rsync is preferred (incremental); tar+ssh is the fallback (works in Git Bash
# on Windows where rsync isn't bundled).
echo "=== Syncing to $SSH_HOST:$REMOTE_DIR ==="
if command -v rsync &>/dev/null; then
    rsync -avz --progress \
        --exclude '.git' \
        --exclude 'node_modules' \
        --exclude '__pycache__' \
        --exclude '*.pyc' \
        --exclude 'backend/venv' \
        --exclude 'backend/.venv' \
        ./ "$SSH_HOST:$REMOTE_DIR/"
else
    echo "[deploy] rsync not found — using tar+ssh"
    ssh "$SSH_HOST" "mkdir -p $REMOTE_DIR"
    tar \
        --exclude='./.git' \
        --exclude='./node_modules' \
        --exclude='./__pycache__' \
        --exclude='./backend/venv' \
        --exclude='./backend/.venv' \
        -czf - . \
        | ssh "$SSH_HOST" "tar -xzf - -C $REMOTE_DIR"
fi
echo ""

# ── remote bring-up ───────────────────────────────────────────────────────────
# Quoted heredoc ('REMOTE') — nothing expands locally; $1/$2 are the args below.
echo "=== Bringing up stack on server (Branch $BRANCH) ==="
ssh "$SSH_HOST" bash -s -- "$REMOTE_DIR" "$BRANCH" << 'REMOTE'
REMOTE_DIR="$1"
BRANCH="$2"

set -euo pipefail
cd "$REMOTE_DIR"

# Branch B/C: host nginx terminates (or forwards) TLS — our nginx runs HTTP-only.
# Copy the no-SSL conf so nginx doesn't try to load certs that don't exist here.
if [[ "$BRANCH" == "B" || "$BRANCH" == "C" ]]; then
    cp nginx/nginx.nossl.conf nginx/nginx.conf
    echo "[deploy] Branch $BRANCH — using nginx.nossl.conf"
fi

# Pull stable base images in background; build the nginx/backend images fresh.
docker compose pull redis langfuse-db langfuse-server 2>/dev/null || true

# --remove-orphans cleans up containers that are no longer in the compose file.
docker compose up -d --build --remove-orphans

echo ""
echo "=== Container status ==="
docker compose ps
REMOTE

echo ""
echo "=== Deploy complete ==="
HOST="${SSH_HOST##*@}"
echo "App: http://$HOST/centriq  (host nginx → :8090 → our nginx → SPA)"
echo "API health check: curl http://$HOST/api/health/llm"
echo "Langfuse: http://$HOST:3003"
