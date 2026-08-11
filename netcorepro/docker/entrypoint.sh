#!/bin/sh
# =============================================================================
#  NetCore Pro — container entrypoint
#  Author: A.K
# -----------------------------------------------------------------------------
#  Responsibilities (all idempotent — safe to run on every boot):
#    1. Refuse to start with the placeholder JWT_SECRET in production.
#    2. Restore the seed database into an empty /app/data volume.
#    3. Restore the seed image sets into empty uploads / rimg volumes.
#    4. Hand over to the Node process via `exec` so it becomes PID 1's child
#       and receives SIGTERM directly (clean SQLite WAL checkpoint on stop).
# =============================================================================
set -e

log() { printf '[entrypoint] %s\n' "$1"; }

DATA_DIR="${DATA_DIR:-/app/data}"
DB_FILE="${DB_PATH:-$DATA_DIR/netcorepro.db}"
UPLOAD_DIR="/app/public/static/uploads"
RIMG_DIR="/app/public/static/rimg"
SEED_DIR="/app/seed"

# --- 1) Secret sanity check --------------------------------------------------
if [ "${NODE_ENV}" = "production" ]; then
  case "${JWT_SECRET}" in
    ""|CHANGE_ME*|changeme*)
      log "FATAL: JWT_SECRET is unset or still the placeholder value."
      log "       Generate one with:  openssl rand -hex 64"
      log "       Then set it in .env before starting the stack."
      exit 1
      ;;
  esac
  if [ "${#JWT_SECRET}" -lt 32 ]; then
    log "FATAL: JWT_SECRET is shorter than 32 characters. Refusing to start."
    exit 1
  fi
fi

# --- 2) Database bootstrap ---------------------------------------------------
mkdir -p "$DATA_DIR"
if [ ! -f "$DB_FILE" ]; then
  if [ -f "$SEED_DIR/netcorepro.db" ]; then
    log "empty data volume detected — restoring seed database"
    cp "$SEED_DIR/netcorepro.db" "$DB_FILE"
  else
    log "no seed database found — the app will create an empty schema"
  fi
else
  log "existing database found at $DB_FILE (left untouched)"
fi

# --- 3) Image volume bootstrap ----------------------------------------------
restore_if_empty() {
  target="$1"; source="$2"; label="$3"
  mkdir -p "$target"
  if [ -d "$source" ] && [ -z "$(ls -A "$target" 2>/dev/null)" ]; then
    log "empty $label volume detected — restoring bundled assets"
    cp -a "$source/." "$target/" 2>/dev/null || true
  fi
}
restore_if_empty "$UPLOAD_DIR" "$SEED_DIR/uploads" "uploads"
restore_if_empty "$RIMG_DIR"   "$SEED_DIR/rimg"    "responsive-image"

# --- 4) Go ------------------------------------------------------------------
log "starting NetCore Pro on port ${PORT:-3000} (NODE_ENV=${NODE_ENV:-production})"
exec "$@"
