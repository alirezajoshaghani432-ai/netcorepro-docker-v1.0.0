#!/usr/bin/env bash
# =============================================================================
#  NetCore Pro — full backup
#  Author: A.K
# -----------------------------------------------------------------------------
#  Produces one timestamped archive containing:
#    * the SQLite database (hot-copied with `sqlite3 .backup`, so it is
#      transactionally consistent even while the site is serving traffic)
#    * every admin-uploaded image
#    * the generated responsive WebP variants
#
#  Usage:
#      ./scripts/backup.sh [output-directory]     # default: ./backups
#
#  Recommended cron entry (daily 03:00, keep 14 days):
#      0 3 * * * cd /opt/netcorepro && ./scripts/backup.sh >> /var/log/ncp-backup.log 2>&1
# =============================================================================
set -euo pipefail

CONTAINER="${CONTAINER:-netcorepro}"
OUT_DIR="${1:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M)"
ARCHIVE="${OUT_DIR}/netcorepro_backup_${STAMP}.tar.gz"

log() { printf '[backup] %s\n' "$1"; }

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  log "ERROR: container '${CONTAINER}' is not running."
  exit 1
fi

mkdir -p "${OUT_DIR}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

# --- 1) Consistent database snapshot ----------------------------------------
# `VACUUM INTO` produces a compact, fully checkpointed copy without blocking
# writers, and is available in every SQLite build shipped with Node 20.
log "snapshotting database"
docker exec "${CONTAINER}" node -e "
  const D = require('better-sqlite3');
  const db = new D(process.env.DB_PATH || '/app/data/netcorepro.db', { readonly: true });
  db.exec(\"VACUUM INTO '/tmp/ncp-snapshot.db'\");
  db.close();
  console.log('snapshot written');
"
docker cp "${CONTAINER}:/tmp/ncp-snapshot.db" "${TMP}/netcorepro.db"
docker exec "${CONTAINER}" rm -f /tmp/ncp-snapshot.db

# --- 2) Image assets ---------------------------------------------------------
log "copying uploaded images"
docker cp "${CONTAINER}:/app/public/static/uploads" "${TMP}/uploads" 2>/dev/null || mkdir -p "${TMP}/uploads"
log "copying generated image variants"
docker cp "${CONTAINER}:/app/public/static/rimg"    "${TMP}/rimg"    2>/dev/null || mkdir -p "${TMP}/rimg"

# --- 3) Manifest -------------------------------------------------------------
cat > "${TMP}/MANIFEST.txt" <<EOF
NetCore Pro backup
Created : $(date -Iseconds)
Host    : $(hostname)
Image   : $(docker inspect --format '{{.Config.Image}}' "${CONTAINER}")
Contents:
  netcorepro.db  — SQLite database (products, orders, users, settings, content)
  uploads/       — original images uploaded from the admin panel
  rimg/          — generated responsive WebP variants (regenerable)
Restore with: ./scripts/restore.sh <this-archive>
EOF

# --- 4) Archive --------------------------------------------------------------
log "creating ${ARCHIVE}"
tar -czf "${ARCHIVE}" -C "${TMP}" .
log "done — $(du -h "${ARCHIVE}" | cut -f1)"

# --- 5) Retention ------------------------------------------------------------
if [ "${RETENTION_DAYS}" -gt 0 ]; then
  log "pruning archives older than ${RETENTION_DAYS} days"
  find "${OUT_DIR}" -name 'netcorepro_backup_*.tar.gz' -mtime "+${RETENTION_DAYS}" -delete
fi
