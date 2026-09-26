#!/bin/sh
# NAVIGATION HEADER
# FILE: scripts/railway-start.sh
# LAYER: Maintenance and operational scripts
# PURPOSE: Provides a safe Railway boot flow with health sidecar, preflight checks, and guarded boot tasks.
# LOOK HERE FIRST WHEN DEBUGGING: Read the command sequence top to bottom before editing.
# RELATED FLOW: Railway staging -> production deployment and runtime startup.
# NOTE: Keep defaults conservative so repeated deploys are safe.

# Railway start script — health server opens FIRST, then setup, then bot
set -e

APP_ENV=${APP_ENV:-production}
RELEASE_CHANNEL=${RELEASE_CHANNEL:-stable}
RUN_PRISMA_MIGRATIONS_ON_BOOT=${RUN_PRISMA_MIGRATIONS_ON_BOOT:-false}
RUN_DB_BOOTSTRAP_ON_BOOT=${RUN_DB_BOOTSTRAP_ON_BOOT:-false}
RUN_JSON_MIGRATION_ON_BOOT=${RUN_JSON_MIGRATION_ON_BOOT:-false}
ENABLE_QUEUE_WORKER=${ENABLE_QUEUE_WORKER:-true}

# ── Persistent storage ───────────────────────────────────────────────────────
if [ -z "$BOT_DATA_DIR" ]; then
  echo "[railway-start] ⚠️  BOT_DATA_DIR is not set."
  echo "[railway-start]    Defaulting to /tmp/nofunleague-data — state will be lost on restart."
  echo "[railway-start]    To fix: add a Railway Volume, mount it at /data, and set BOT_DATA_DIR=/data"
  export BOT_DATA_DIR="/tmp/nofunleague-data"
elif echo "$BOT_DATA_DIR" | grep -q "^/tmp"; then
  echo "[railway-start] ⚠️  BOT_DATA_DIR=$BOT_DATA_DIR is inside /tmp — ephemeral, state lost on restart."
  echo "[railway-start]    To fix: add a Railway Volume, mount it at /data, and set BOT_DATA_DIR=/data"
else
  echo "[railway-start] ✅ BOT_DATA_DIR=$BOT_DATA_DIR (persistent)"
fi

mkdir -p "$BOT_DATA_DIR" 2>/dev/null || true
echo "[railway-start] Using BOT_DATA_DIR=$BOT_DATA_DIR"

# ── Dependency availability checks ───────────────────────────────────────────
if [ -z "$REDIS_URL" ]; then
  echo "[railway-start] ⚠️  REDIS_URL is not set — BullMQ worker may not start."
  echo "[railway-start]    Background jobs and storage sync are inert until Redis is added."
  echo "[railway-start]    To fix: add a Railway Redis service and set REDIS_URL from its Variables tab."
fi

if [ -z "$DATABASE_URL" ]; then
  echo "[railway-start] ⚠️  DATABASE_URL is not set — Prisma writes will be skipped."
  echo "[railway-start]    State will not persist across restarts."
  echo "[railway-start]    To fix: add a Railway Postgres service and set DATABASE_URL from its Variables tab."
fi

if [ -z "$COMMISSIONER_ROLE_ID" ]; then
  echo "[railway-start] ⚠️  COMMISSIONER_ROLE_ID is not set."
  echo "[railway-start]    Commissioner auth falls back to Discord Administrator permission."
  echo "[railway-start]    To fix: set COMMISSIONER_ROLE_ID to your commissioner role's Discord ID."
fi

echo "[railway-start] Running boot preflight..."
node scripts/boot-preflight.js

# ── Start health server ───────────────────────────────────────────────────────
echo "[railway-start] Starting health server on PORT=${PORT:-3000}..."
node health-server.js &
HEALTH_PID=$!

# Give health server 1 second to open the port before running setup
sleep 1

# ── Prisma client generation ─────────────────────────────────────────────────
PRISMA_CLIENT_DTS="node_modules/.prisma/client/index.d.ts"
if [ -f "$PRISMA_CLIENT_DTS" ]; then
  echo "[railway-start] Prisma client already present. Skipping runtime generate."
elif [ -w "node_modules" ] || [ -w "node_modules/.prisma" ] || [ ! -d "node_modules/.prisma" ]; then
  echo "[railway-start] Running Prisma generate..."
  npx prisma generate || echo "[railway-start] prisma generate skipped"
else
  echo "[railway-start] node_modules is read-only at runtime. Skipping Prisma generate."
fi

# ── Guarded DB boot steps ────────────────────────────────────────────────────
if [ -n "$DATABASE_URL" ]; then
  if [ "$RUN_PRISMA_MIGRATIONS_ON_BOOT" = "true" ]; then
    echo "[railway-start] Running Prisma migrations..."
    npx prisma migrate deploy || echo "[railway-start] prisma migrate deploy skipped (non-fatal)"
  else
    echo "[railway-start] Skipping Prisma migrations (RUN_PRISMA_MIGRATIONS_ON_BOOT=$RUN_PRISMA_MIGRATIONS_ON_BOOT)"
  fi

  if [ "$RUN_DB_BOOTSTRAP_ON_BOOT" = "true" ]; then
    echo "[railway-start] Running DB bootstrap..."
    node scripts/db-bootstrap.js || echo "[railway-start] db-bootstrap skipped"
  else
    echo "[railway-start] Skipping DB bootstrap (RUN_DB_BOOTSTRAP_ON_BOOT=$RUN_DB_BOOTSTRAP_ON_BOOT)"
  fi

  if [ "$RUN_JSON_MIGRATION_ON_BOOT" = "true" ]; then
    echo "[railway-start] Running JSON migration..."
    node scripts/migrate-json-to-postgres.js || echo "[railway-start] migrate-json skipped"
  else
    echo "[railway-start] Skipping JSON migration (RUN_JSON_MIGRATION_ON_BOOT=$RUN_JSON_MIGRATION_ON_BOOT)"
  fi
else
  echo "[railway-start] Skipping DB setup — DATABASE_URL not set."
fi

# Keep health-server.js alive as a sidecar for the container lifetime.
echo "[railway-start] Health server stays alive as sidecar on PORT=${PORT:-3000}"

echo "[railway-start] Starting bot..."
if [ "$ENABLE_QUEUE_WORKER" = "true" ] && [ -n "$REDIS_URL" ]; then
  echo "[railway-start] Starting BullMQ worker..."
  node src/queue/worker.js &
  WORKER_PID=$!
  trap 'kill $WORKER_PID 2>/dev/null || true' EXIT INT TERM
else
  echo "[railway-start] Queue worker disabled or REDIS_URL missing."
fi

exec node index.js
