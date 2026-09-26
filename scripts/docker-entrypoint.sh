#!/bin/sh
# ===================================================================
#  NetCore Pro — docker entrypoint
#  1) منتظر login واقعی MySQL/MariaDB می‌ماند (نه فقط باز بودن پورت TCP)
#  2) اگر دیتابیس خالی بود و فایل SQLite قدیمی موجود بود → مهاجرت خودکار
#  3) seed امن (فقط وقتی دیتابیس کاملاً خالی است — گارد داخل seed.js)
#  4) اجرای سرور
#
#  هرگز seed.js --force صدا زده نمی‌شود تا دادهٔ موجود پاک نشود.
# ===================================================================
set -u

# توجه: نام متغیر عمداً DB_HOST/DB_PORT است تا متغیر محیطی PORT
# (پورت خود سرور Node) بازنویسی نشود.
DB_HOST="${MYSQL_HOST:-db}"
DB_PORT="${MYSQL_PORT:-3306}"
WAIT_MAX="${MYSQL_WAIT_SECONDS:-180}"

echo "[entrypoint] waiting for MySQL/MariaDB auth at $DB_HOST:$DB_PORT (up to ${WAIT_MAX}s) ..."
i=0
ready=0
while [ "$i" -lt "$WAIT_MAX" ]; do
  if node -e "
    import('mysql2/promise').then(async (mysql) => {
      const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'db',
        port: parseInt(process.env.MYSQL_PORT || '3306', 10),
        user: process.env.MYSQL_USER || 'netcore',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'netcorepro',
        connectTimeout: 4000,
      });
      await c.query('SELECT 1 AS ok');
      await c.end();
      process.exit(0);
    }).catch(() => process.exit(1));
  " 2>/dev/null; then
    echo "[entrypoint] MySQL is ready (authenticated SELECT 1)."
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 1
done

if [ "$ready" != "1" ]; then
  echo "[entrypoint] ERROR: MySQL did not accept app login within ${WAIT_MAX}s"
  echo "[entrypoint] Check MYSQL_USER/MYSQL_PASSWORD vs the existing dbdata volume, then retry."
  exit 1
fi

# مهاجرت خودکار: فقط اگر جدول users در MySQL خالی/غایب است و SQLite قدیمی وجود دارد
if [ -f /app/data/netcorepro.db ]; then
  node -e "
    import('mysql2/promise').then(async (mysql) => {
      const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'db',
        port: parseInt(process.env.MYSQL_PORT || '3306', 10),
        user: process.env.MYSQL_USER || 'netcore',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'netcorepro',
        connectTimeout: 4000,
      });
      try {
        const [[{ c: n }]] = await c.query('SELECT COUNT(*) AS c FROM users');
        process.exit(n > 0 ? 1 : 0); // 0 => empty, migrate
      } catch (e) { process.exit(0); } // table missing => migrate
      finally { await c.end(); }
    }).catch(() => process.exit(2));
  "
  MIGRATE=$?
  if [ "$MIGRATE" = "0" ]; then
    echo "[entrypoint] MySQL empty + old SQLite found → running one-time migration ..."
    node scripts/migrate-sqlite-to-mysql.mjs || echo "[entrypoint] migration failed (continuing; seed may fill defaults)"
  fi
fi

# seed فقط دیتابیسِ کاملاً خالی را پر می‌کند (گارد امنیتی داخل خود seed.js)
# هرگز --force: دادهٔ موجود پاک نمی‌شود
node dist/db/seed.js || true

echo "[entrypoint] starting server ..."
exec node dist/server.js
