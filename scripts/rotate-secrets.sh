#!/bin/bash
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────
COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$COMPOSE_DIR/.env"
LOG_FILE="$COMPOSE_DIR/logs/secret-rotation.log"
BACKUP_DIR="$COMPOSE_DIR/secrets-backup"

mkdir -p "$(dirname "$LOG_FILE")" "$BACKUP_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# ── Load current env ────────────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  log "ERROR: $ENV_FILE not found"
  exit 1
fi
source "$ENV_FILE"

OLD_REDIS_PASSWORD="${REDIS_PASSWORD:-}"

# ── Generate new credentials ───────────────────────────────────────────
NEW_REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '=/+' | head -c 40)

log "Starting secret rotation..."

# ── Backup current env ─────────────────────────────────────────────────
cp "$ENV_FILE" "$BACKUP_DIR/.env.$(date '+%Y%m%d_%H%M%S')"
# Keep only last 10 backups
ls -t "$BACKUP_DIR"/.env.* 2>/dev/null | tail -n +11 | xargs -r rm

# ── 1. Rotate Redis password (hot, no restart needed) ──────────────────
log "Rotating Redis password..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" exec -T redis \
  redis-cli -a "$OLD_REDIS_PASSWORD" CONFIG SET requirepass "$NEW_REDIS_PASSWORD" \
  2>/dev/null

# Verify new password works
docker compose -f "$COMPOSE_DIR/docker-compose.yml" exec -T redis \
  redis-cli -a "$NEW_REDIS_PASSWORD" ping 2>/dev/null | grep -q PONG
log "Redis password rotated successfully"

# ── 2. Update .env file ────────────────────────────────────────────────
log "Updating .env file..."

if grep -q "^REDIS_PASSWORD=" "$ENV_FILE"; then
  sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$NEW_REDIS_PASSWORD|" "$ENV_FILE"
else
  echo "REDIS_PASSWORD=$NEW_REDIS_PASSWORD" >> "$ENV_FILE"
fi

log ".env updated"

# ── 3. Restart backend to pick up new credentials ─────────────────────
log "Restarting backend to pick up new credentials..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" up -d backend

sleep 5
log "Backend restarted"

# ── 4. Redis container reads new password from .env on next cold start ─
# The --requirepass in docker-compose.yml reads from .env automatically.

log "Secret rotation completed successfully"
log "---"
