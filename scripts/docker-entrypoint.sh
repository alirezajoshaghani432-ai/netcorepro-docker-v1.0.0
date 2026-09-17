#!/bin/sh
# ===================================================================
#  NetCore Pro — docker entrypoint
#  1) منتظر آماده‌شدن MySQL/MariaDB می‌ماند (تا ۶۰ ثانیه)
#  2) اگر دیتابیس خالی بود و فایل SQLite قدیمی موجود بود → مهاجرت خودکار
#  3) seed امن (فقط وقتی دیتابیس کاملاً خالی است — گارد داخل seed.js)
#  4) اجرای سرور
# ===================================================================
set -u

# توجه: نام متغیر عمداً DB_HOST/DB_PORT است تا متغیر محیطی PORT
# (پورت خود سرور Node) بازنویسی نشود.
DB_HOST="${MYSQL_HOST:-db}"
DB_PORT="${MYSQL_PORT:-3306}"

echo "[entrypoint] waiting for MySQL at $DB_HOST:$DB_PORT ..."
i=0
while [ $i -lt 60 ]; do
  if node -e "
    const net = require('net');
    const s = net.connect({ host: '$DB_HOST', port: $DB_PORT, timeout: 2000 });
    s.on('connect', () => { s.end(); process.exit(0); });
    s.on('error', () => process.exit(1));
    s.on('timeout', () => process.exit(1));
  " 2>/dev/null; then
    echo "[entrypoint] MySQL is up."
    break
  fi
  i=$((i+1))
  sleep 1
done

# مهاجرت خودکار: فقط اگر جدول users در MySQL خالی/غایب است و SQLite قدیمی وجود دارد
if [ -f /app/data/netcorepro.db ]; then
  node -e "
    import('mysql2/promise').then(async (mysql) => {
      const c = await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'db',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER || 'netcore',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'netcorepro',
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
node dist/db/seed.js || true

echo "[entrypoint] starting server ..."
exec node dist/server.js
