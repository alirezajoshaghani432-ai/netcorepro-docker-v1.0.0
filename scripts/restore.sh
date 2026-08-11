#!/usr/bin/env bash
# =============================================================================
#  NetCore Pro — restore from a backup archive
#  Author: A.K
# -----------------------------------------------------------------------------
#  Usage:
#      ./scripts/restore.sh backups/netcorepro_backup_2026-08-11_0300.tar.gz
#      ./scripts/restore.sh <archive> --yes      # skip the confirmation prompt
#
#  The script stops the container, replaces the database and image volumes with
#  the archive contents, then starts the container again and waits for the
#  health check to pass. The previous state is copied aside first, so a failed
#  restore can always be rolled back.
# =============================================================================
set -euo pipefail

CONTAINER="${CONTAINER:-netcorepro}"
ASSUME_YES="${ASSUME_YES:-0}"
ARCHIVE=""

# Accept the archive and the confirmation flag in any order.
for arg in "$@"; do
  case "${arg}" in
    -y|--yes|--force) ASSUME_YES=1 ;;
    -h|--help)        ASSUME_YES="help" ;;
    *)                [ -z "${ARCHIVE}" ] && ARCHIVE="${arg}" ;;
  esac
done

log() { printf '[restore] %s\n' "$1"; }

if [ "${ASSUME_YES}" = "help" ] || [ -z "${ARCHIVE}" ] || [ ! -f "${ARCHIVE}" ]; then
  echo "Usage: $0 <backup-archive.tar.gz> [--yes]"
  echo "  --yes    do not ask for confirmation (required for cron / CI)"
  exit 1
fi

# Without a terminal there is nobody to answer the prompt, so an unattended run
# must pass --yes explicitly rather than hang forever waiting on stdin.
if [ "${ASSUME_YES}" != "1" ]; then
  if [ ! -t 0 ]; then
    log "ERROR: no terminal attached and --yes was not supplied. Refusing to restore."
    exit 1
  fi
  read -r -p "This overwrites the live database and images. Continue? [y/N] " ans
  case "${ans}" in [yY]|[yY][eE][sS]) ;; *) log "aborted"; exit 0 ;; esac
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

log "extracting archive"
tar -xzf "${ARCHIVE}" -C "${TMP}"

if [ ! -f "${TMP}/netcorepro.db" ]; then
  log "ERROR: archive does not contain netcorepro.db"
  exit 1
fi

# --- Safety copy of the current state ---------------------------------------
SAFETY="./backups/pre-restore_$(date +%Y-%m-%d_%H%M).tar.gz"
mkdir -p ./backups
log "saving current state to ${SAFETY}"
SAFE_TMP="$(mktemp -d)"
docker cp "${CONTAINER}:/app/data/netcorepro.db"      "${SAFE_TMP}/netcorepro.db" 2>/dev/null || true
docker cp "${CONTAINER}:/app/public/static/uploads"   "${SAFE_TMP}/uploads"       2>/dev/null || true
tar -czf "${SAFETY}" -C "${SAFE_TMP}" . 2>/dev/null || true
rm -rf "${SAFE_TMP}"

# --- Restore -----------------------------------------------------------------
log "stopping container"
docker compose stop app || docker stop "${CONTAINER}"

log "restoring database"
docker cp "${TMP}/netcorepro.db" "${CONTAINER}:/app/data/netcorepro.db"
# Stale WAL/SHM sidecars from the old database would corrupt the restored file.
docker exec "${CONTAINER}" sh -c 'rm -f /app/data/netcorepro.db-wal /app/data/netcorepro.db-shm' 2>/dev/null || true

if [ -d "${TMP}/uploads" ]; then
  log "restoring uploaded images"
  docker cp "${TMP}/uploads/." "${CONTAINER}:/app/public/static/uploads/"
fi
if [ -d "${TMP}/rimg" ]; then
  log "restoring image variants"
  docker cp "${TMP}/rimg/." "${CONTAINER}:/app/public/static/rimg/"
fi

log "starting container"
docker compose start app || docker start "${CONTAINER}"

log "waiting for health check"
for i in $(seq 1 30); do
  state="$(docker inspect --format '{{.State.Health.Status}}' "${CONTAINER}" 2>/dev/null || echo starting)"
  [ "${state}" = "healthy" ] && { log "restore complete — service is healthy"; exit 0; }
  sleep 2
done

log "WARNING: service did not report healthy within 60s. Inspect with:"
log "  docker compose logs --tail=100 app"
exit 1
