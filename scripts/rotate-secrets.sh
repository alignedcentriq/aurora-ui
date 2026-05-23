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
OLD_MINIO_ROOT_USER="${MINIO_ROOT_USER:-}"
OLD_MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-}"

# ── Generate new credentials ───────────────────────────────────────────
NEW_REDIS_PASSWORD=$(openssl rand -base64 32 | tr -d '=/+' | head -c 40)
NEW_MINIO_ROOT_PASSWORD=$(openssl rand -base64 32 | tr -d '=/+' | head -c 40)

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

# ── 2. Rotate MinIO credentials (via mc) ───────────────────────────────
log "Rotating MinIO password..."

# Create a temp container to run mc commands
docker compose -f "$COMPOSE_DIR/docker-compose.yml" run --rm -T createbuckets \
  /bin/sh -c "
    /usr/bin/mc alias set myminio http://minio:9000 $OLD_MINIO_ROOT_USER $OLD_MINIO_ROOT_PASSWORD && \
    /usr/bin/mc admin user svcacct ls myminio 2>/dev/null; \
    echo 'MinIO alias verified'
  " 2>/dev/null

# MinIO root credentials can only be changed via env var + restart
# So we update the env and restart MinIO
log "MinIO root password requires container restart"

# ── 3. Update .env file ────────────────────────────────────────────────
log "Updating .env file..."

# Use sed to replace in place
if grep -q "^REDIS_PASSWORD=" "$ENV_FILE"; then
  sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$NEW_REDIS_PASSWORD|" "$ENV_FILE"
else
  echo "REDIS_PASSWORD=$NEW_REDIS_PASSWORD" >> "$ENV_FILE"
fi

if grep -q "^MINIO_ROOT_PASSWORD=" "$ENV_FILE"; then
  sed -i "s|^MINIO_ROOT_PASSWORD=.*|MINIO_ROOT_PASSWORD=$NEW_MINIO_ROOT_PASSWORD|" "$ENV_FILE"
else
  echo "MINIO_ROOT_PASSWORD=$NEW_MINIO_ROOT_PASSWORD" >> "$ENV_FILE"
fi

log ".env updated"

# ── 4. Restart services that need new credentials ──────────────────────
log "Restarting MinIO (requires restart for root credential change)..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" up -d minio
sleep 5

# Wait for MinIO to be healthy
for i in $(seq 1 30); do
  if docker compose -f "$COMPOSE_DIR/docker-compose.yml" exec -T minio \
    curl -sf http://localhost:9000/minio/health/live > /dev/null 2>&1; then
    log "MinIO healthy after restart"
    break
  fi
  if [ "$i" -eq 30 ]; then
    log "ERROR: MinIO failed to become healthy after restart"
    exit 1
  fi
  sleep 2
done

# Re-run bucket creation with new creds
docker compose -f "$COMPOSE_DIR/docker-compose.yml" up -d createbuckets

log "Restarting backend to pick up new credentials..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" up -d backend

# Wait for backend to be up
sleep 5
log "Backend restarted"

# ── 5. Update Redis container command for next cold start ──────────────
# The --requirepass in docker-compose.yml reads from .env,
# so next `docker compose up` will use the new password automatically.

log "Secret rotation completed successfully"
log "---"
