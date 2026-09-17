#!/bin/sh
# ===================================================================
#  NetCore Pro — docker entrypoint (SQL Server)
#  1) منتظر آماده‌شدن SQL Server می‌ماند (تا ۱۲۰ ثانیه)
#  2) اگر دیتابیس خالی بود و فایل SQLite قدیمی موجود بود → مهاجرت خودکار
#     (هرگز دیتابیس پر را پاک نمی‌کند)
#  3) seed امن (فقط وقتی دیتابیس کاملاً خالی است — گارد داخل seed.js)
#  4) اجرای سرور SSR
# ===================================================================
set -u

DB_HOST="${MSSQL_HOST:-${MSSQL_SERVER:-db}}"
DB_PORT="${MSSQL_PORT:-1433}"
DB_NAME="${MSSQL_DATABASE:-netcorepro}"
DB_USER="${MSSQL_USER:-sa}"
DB_PASS="${MSSQL_PASSWORD:-}"

echo "[entrypoint] waiting for SQL Server at $DB_HOST:$DB_PORT ..."
i=0
while [ $i -lt 120 ]; do
  if node -e "
    const net = require('net');
    const s = net.connect({ host: '$DB_HOST', port: $DB_PORT, timeout: 2000 });
    s.on('connect', () => { s.end(); process.exit(0); });
    s.on('error', () => process.exit(1));
    s.on('timeout', () => process.exit(1));
  " 2>/dev/null; then
    echo "[entrypoint] SQL Server port is open."
    break
  fi
  i=$((i+1))
  sleep 1
done

# Create the application database if it does not exist yet (connect to master)
echo "[entrypoint] ensuring database $DB_NAME exists ..."
node -e "
  import('mssql').then(async (m) => {
    const sql = m.default;
    const cfg = {
      server: process.env.MSSQL_SERVER || process.env.MSSQL_HOST || 'db',
      port: parseInt(process.env.MSSQL_PORT || '1433', 10),
      user: process.env.MSSQL_USER || 'sa',
      password: process.env.MSSQL_PASSWORD || '',
      database: 'master',
      options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    };
    try {
      const pool = await sql.connect(cfg);
      const name = (process.env.MSSQL_DATABASE || 'netcorepro').replace(/[^A-Za-z0-9_]/g, '');
      await pool.request().query(\"IF DB_ID('\" + name + \"') IS NULL CREATE DATABASE [\" + name + \"]\");
      await pool.close();
      process.exit(0);
    } catch (e) {
      console.error('[entrypoint] ensure-db:', e.message);
      process.exit(0); // continue; app schema apply will retry
    }
  });
" || true

# مهاجرت خودکار: فقط اگر جدول users در SQL Server خالی/غایب است و SQLite قدیمی وجود دارد
if [ -f /app/data/netcorepro.db ]; then
  node -e "
    import('mssql').then(async (m) => {
      const sql = m.default;
      const cfg = {
        server: process.env.MSSQL_SERVER || process.env.MSSQL_HOST || 'db',
        port: parseInt(process.env.MSSQL_PORT || '1433', 10),
        user: process.env.MSSQL_USER || 'sa',
        password: process.env.MSSQL_PASSWORD || '',
        database: process.env.MSSQL_DATABASE || 'netcorepro',
        options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
      };
      try {
        const pool = await sql.connect(cfg);
        const r = await pool.request().query('SELECT COUNT(*) AS c FROM users');
        const n = Number(r.recordset[0] && r.recordset[0].c || 0);
        await pool.close();
        process.exit(n > 0 ? 1 : 0); // 0 => empty, migrate
      } catch (e) { process.exit(0); } // table missing => migrate
    }).catch(() => process.exit(2));
  "
  MIGRATE=$?
  if [ "$MIGRATE" = "0" ]; then
    echo "[entrypoint] SQL Server empty + old SQLite found → running one-time migration (IDs preserved) ..."
    node scripts/migrate-sqlite-to-mssql.mjs || echo "[entrypoint] migration failed (continuing; seed may fill defaults)"
  else
    echo "[entrypoint] SQL Server already has data — skipping migration. Existing rows were NOT deleted."
  fi
fi

# seed فقط دیتابیسِ کاملاً خالی را پر می‌کند (گارد امنیتی داخل خود seed.js)
node dist/db/seed.js || true

echo "[entrypoint] starting SSR server ..."
exec node dist/server.js
