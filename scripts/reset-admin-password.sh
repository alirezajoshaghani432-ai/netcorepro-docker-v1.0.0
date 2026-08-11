#!/usr/bin/env bash
# =============================================================================
#  NetCore Pro — reset the administrator password
#  Author: A.K
# -----------------------------------------------------------------------------
#  The delivered database ships with a well-known development password.
#  Run this ONCE immediately after the first deployment.
#
#  Usage:
#      ./scripts/reset-admin-password.sh 'NewStr0ng!Passphrase'
#      ./scripts/reset-admin-password.sh 'NewStr0ng!Passphrase' admin@example.com
#
#  Notes:
#    * Passwords are hashed with bcrypt (cost 10) and stored in users.password.
#      There is NO `password_hash` column — that is a common mistake.
#    * The account is forced back to status='active' and password_set=1.
#    * Every existing session keeps working; rotate JWT_SECRET to kill them all.
# =============================================================================
set -euo pipefail

CONTAINER="${CONTAINER:-netcorepro}"
NEW_PASSWORD="${1:-}"
ADMIN_EMAIL="${2:-admin@netcorepro.ir}"

log() { printf '[admin-reset] %s\n' "$1"; }

if [ -z "${NEW_PASSWORD}" ]; then
  echo "Usage: $0 '<new-password>' [admin-email]"
  exit 1
fi

if [ "${#NEW_PASSWORD}" -lt 10 ]; then
  log "ERROR: choose a password of at least 10 characters."
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  log "ERROR: container '${CONTAINER}' is not running."
  exit 1
fi

log "updating credentials for ${ADMIN_EMAIL}"
docker exec -e NCP_PW="${NEW_PASSWORD}" -e NCP_EMAIL="${ADMIN_EMAIL}" "${CONTAINER}" node -e "
  const Database = require('better-sqlite3');
  const bcrypt   = require('bcryptjs');
  const db = new Database(process.env.DB_PATH || '/app/data/netcorepro.db');
  const hash = bcrypt.hashSync(process.env.NCP_PW, 10);
  const res = db.prepare(
    \"UPDATE users SET password = ?, password_set = 1, status = 'active' WHERE email = ? AND role = 'admin'\"
  ).run(hash, process.env.NCP_EMAIL);
  if (res.changes === 0) {
    console.error('No admin account found with that e-mail address.');
    process.exit(2);
  }
  console.log('Password updated for ' + process.env.NCP_EMAIL);
  db.close();
"

log "done. Sign in at  http(s)://<your-domain>/admin"
log "Reminder: also rotate JWT_SECRET in .env to invalidate old sessions."
