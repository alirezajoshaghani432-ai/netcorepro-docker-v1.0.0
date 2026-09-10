// =====================================================================
//  SQLite -> MySQL/MariaDB data migration for NetCore Pro
// ---------------------------------------------------------------------
//  - Reads every row from the SQLite file (DB_PATH or data/netcorepro.db)
//  - Creates the MySQL schema (dist/db/schema.mysql.sql)
//  - Copies all rows table-by-table preserving IDs (FKs stay valid)
//  - Verifies row counts per table at the end and exits non-zero on any
//    mismatch, so data loss can never go unnoticed.
//
//  Usage:
//    MYSQL_HOST=127.0.0.1 MYSQL_USER=netcore MYSQL_PASSWORD=... \
//    MYSQL_DATABASE=netcorepro node scripts/migrate-sqlite-to-mysql.mjs
// =====================================================================
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const sqlitePath = process.env.DB_PATH || join(root, 'data/netcorepro.db');

const TABLE_ORDER = [
    // parents first (FK-safe insert order)
    'users', 'categories', 'brands', 'products',
    'orders', 'order_items', 'tickets', 'ticket_replies',
    'posts', 'comments', 'newsletter_subscribers', 'messages',
    'settings', 'activity_logs', 'site_blocks', 'site_pages', 'otp_codes',
];

function fixValue(v) {
    if (v === undefined) return null;
    if (typeof v === 'string') {
        const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?$/);
        if (m) return `${m[1]} ${m[2]}`;
    }
    return v;
}

const main = async () => {
    console.log(`[migrate] SQLite source: ${sqlitePath}`);
    const sq = new Database(sqlitePath, { readonly: true });

    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST || '127.0.0.1',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER || 'netcore',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'netcorepro',
        charset: 'utf8mb4',
        multipleStatements: false,
        supportBigNumbers: true,
    });
    console.log('[migrate] MySQL connected');

    // 1) Create schema
    const schema = readFileSync(join(root, 'dist/db/schema.mysql.sql'), 'utf-8');
    for (const stmt of schema.split(';')) {
        // strip comment lines first (a leading header comment must not swallow the statement)
        const s = stmt.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
        if (!s) continue;
        try { await conn.query(s); }
        catch (e) {
            if (!/Duplicate key name|already exists/i.test(e.message)) {
                console.error('[migrate] schema stmt failed:', e.message.slice(0, 200));
            }
        }
    }
    console.log('[migrate] schema ensured');

    // 2) Copy data
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    const report = [];
    for (const table of TABLE_ORDER) {
        // does the table exist in sqlite?
        const exists = sq.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
        if (!exists) { report.push({ table, sqlite: 0, mysql: 0, note: 'missing in sqlite' }); continue; }

        const rows = sq.prepare(`SELECT * FROM "${table}"`).all();
        // intersect columns: only copy columns that exist on the MySQL side
        const [mysqlColsRaw] = await conn.query(
            `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]);
        const mysqlCols = new Set(mysqlColsRaw.map((c) => c.name));

        await conn.query(`DELETE FROM \`${table}\``); // idempotent re-run
        if (rows.length) {
            const cols = Object.keys(rows[0]).filter((c) => mysqlCols.has(c));
            const skipped = Object.keys(rows[0]).filter((c) => !mysqlCols.has(c));
            if (skipped.length) console.warn(`[migrate] ${table}: skipping sqlite-only columns: ${skipped.join(', ')}`);
            const colSql = cols.map((c) => `\`${c}\``).join(',');
            const placeholders = `(${cols.map(() => '?').join(',')})`;
            const BATCH = 200;
            for (let i = 0; i < rows.length; i += BATCH) {
                const chunk = rows.slice(i, i + BATCH);
                const values = [];
                for (const r of chunk) for (const c of cols) values.push(fixValue(r[c]));
                await conn.query(
                    `INSERT INTO \`${table}\` (${colSql}) VALUES ${chunk.map(() => placeholders).join(',')}`, values);
            }
            // bump AUTO_INCREMENT past the max id
            if (cols.includes('id')) {
                const maxId = rows.reduce((m, r) => Math.max(m, r.id || 0), 0);
                try { await conn.query(`ALTER TABLE \`${table}\` AUTO_INCREMENT = ${maxId + 1}`); } catch (e) { /* ignore */ }
            }
        }
        const [[{ c: mysqlCount }]] = await conn.query(`SELECT COUNT(*) AS c FROM \`${table}\``);
        report.push({ table, sqlite: rows.length, mysql: Number(mysqlCount) });
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');

    // 3) Verify
    console.log('\n===== MIGRATION VERIFICATION =====');
    let ok = true;
    for (const r of report) {
        const match = r.sqlite === r.mysql;
        if (!match) ok = false;
        console.log(`${match ? '✅' : '❌'} ${r.table.padEnd(24)} sqlite=${String(r.sqlite).padStart(6)}  mysql=${String(r.mysql).padStart(6)} ${r.note || ''}`);
    }
    await conn.end();
    sq.close();
    if (!ok) {
        console.error('\n❌ MIGRATION FAILED: row-count mismatch detected!');
        process.exit(1);
    }
    console.log('\n✅ Migration complete — every table matches row-for-row.');
};

main().catch((e) => { console.error('[migrate] fatal:', e); process.exit(1); });
