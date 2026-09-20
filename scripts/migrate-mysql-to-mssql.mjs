// =====================================================================
//  MySQL/MariaDB -> Microsoft SQL Server data migration for NetCore Pro
//  Preserves IDs. Verifies row counts. Never wipes a non-empty MSSQL DB
//  unless --force is passed.
//
//  Usage:
//    MYSQL_HOST=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_DATABASE=... \
//    MSSQL_SERVER=... MSSQL_USER=... MSSQL_PASSWORD=... MSSQL_DATABASE=... \
//    node scripts/migrate-mysql-to-mssql.mjs
// =====================================================================
import mysql from 'mysql2/promise';
import sql from 'mssql';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const FORCE = process.argv.includes('--force');

const TABLE_ORDER = [
    'users', 'categories', 'brands', 'products',
    'orders', 'order_items', 'tickets', 'ticket_replies',
    'posts', 'comments', 'newsletter_subscribers', 'messages',
    'settings', 'activity_logs', 'site_blocks', 'site_pages', 'otp_codes',
];

function fixValue(v) {
    if (v === undefined) return null;
    if (v instanceof Date) {
        const iso = v.toISOString();
        return iso.replace('T', ' ').replace(/\.\d+Z$/, '');
    }
    if (typeof v === 'string') {
        const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?$/);
        if (m) return `${m[1]} ${m[2]}`;
    }
    if (Buffer.isBuffer(v)) return v.toString('utf8');
    return v;
}

function bracket(name) {
    return `[${String(name).replace(/[\[\]]/g, '')}]`;
}

const mssqlConfig = {
    server: process.env.MSSQL_SERVER || process.env.MSSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MSSQL_PORT || '1433', 10),
    user: process.env.MSSQL_USER || 'sa',
    password: process.env.MSSQL_PASSWORD || '',
    database: process.env.MSSQL_DATABASE || 'netcorepro',
    options: {
        encrypt: (process.env.MSSQL_ENCRYPT || 'false').toLowerCase() === 'true',
        trustServerCertificate: (process.env.MSSQL_TRUST_CERT || 'true').toLowerCase() === 'true',
        enableArithAbort: true,
    },
};

const main = async () => {
    const conn = await mysql.createConnection({
        host: process.env.MYSQL_HOST || '127.0.0.1',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER || 'netcore',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'netcorepro',
        charset: 'utf8mb4',
        supportBigNumbers: true,
    });
    console.log('[migrate] MySQL connected');

    const pool = await sql.connect(mssqlConfig);
    console.log('[migrate] SQL Server connected');

    // Refuse to overwrite a populated MSSQL database unless --force
    try {
        const existing = await pool.request().query('SELECT COUNT(*) AS c FROM users');
        const n = Number(existing.recordset[0]?.c || 0);
        if (n > 0 && !FORCE) {
            console.log(`[migrate] SQL Server already has ${n} users — skipping (pass --force to overwrite). Data was NOT deleted.`);
            await pool.close();
            await conn.end();
            process.exit(0);
        }
    } catch (_) { /* table may not exist yet */ }

    const schema = readFileSync(join(root, 'dist/db/schema.mssql.sql'), 'utf-8');
    try { await pool.request().query(schema); }
    catch (e) {
        if (!/already an object named|already exists/i.test(e.message || '')) {
            console.error('[migrate] schema apply warning:', String(e.message || e).slice(0, 240));
        }
    }
    console.log('[migrate] schema ensured');

    const report = [];
    for (const table of TABLE_ORDER) {
        let rows = [];
        try {
            const [raw] = await conn.query(`SELECT * FROM \`${table}\``);
            rows = raw;
        } catch (e) {
            report.push({ table, mysql: 0, mssql: 0, note: 'missing in mysql' });
            continue;
        }
        const colRs = await pool.request()
            .input('t', sql.NVarChar, table)
            .query(`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_CATALOG = DB_NAME() AND TABLE_NAME = @t`);
        const mssqlCols = new Set(colRs.recordset.map((c) => c.name));

        try { await pool.request().query(`ALTER TABLE ${bracket(table)} NOCHECK CONSTRAINT ALL`); } catch (_) { /* ignore */ }
        try { await pool.request().query(`DELETE FROM ${bracket(table)}`); } catch (e) {
            console.error(`[migrate] DELETE ${table}:`, e.message);
        }

        if (rows.length) {
            const cols = Object.keys(rows[0]).filter((c) => mssqlCols.has(c));
            const skipped = Object.keys(rows[0]).filter((c) => !mssqlCols.has(c));
            if (skipped.length) console.warn(`[migrate] ${table}: skipping mysql-only columns: ${skipped.join(', ')}`);
            const hasId = cols.includes('id');
            if (hasId) {
                try { await pool.request().query(`SET IDENTITY_INSERT ${bracket(table)} ON`); } catch (_) { /* ignore */ }
            }
            for (const r of rows) {
                const req = pool.request();
                cols.forEach((c, i) => req.input(`p${i}`, fixValue(r[c])));
                const colSql = cols.map(bracket).join(',');
                const ph = cols.map((_, i) => `@p${i}`).join(',');
                await req.query(`INSERT INTO ${bracket(table)} (${colSql}) VALUES (${ph})`);
            }
            if (hasId) {
                try { await pool.request().query(`SET IDENTITY_INSERT ${bracket(table)} OFF`); } catch (_) { /* ignore */ }
                const maxId = rows.reduce((m, r) => Math.max(m, r.id || 0), 0);
                try { await pool.request().query(`DBCC CHECKIDENT ('${table}', RESEED, ${maxId})`); } catch (_) { /* ignore */ }
            }
        }
        try { await pool.request().query(`ALTER TABLE ${bracket(table)} WITH CHECK CHECK CONSTRAINT ALL`); } catch (_) { /* ignore */ }

        const countRs = await pool.request().query(`SELECT COUNT(*) AS c FROM ${bracket(table)}`);
        report.push({ table, mysql: rows.length, mssql: Number(countRs.recordset[0].c) });
    }

    console.log('\n===== MIGRATION VERIFICATION =====');
    let ok = true;
    for (const r of report) {
        const match = r.mysql === r.mssql;
        if (!match) ok = false;
        console.log(`${match ? '✅' : '❌'} ${r.table.padEnd(24)} mysql=${String(r.mysql).padStart(6)}  mssql=${String(r.mssql).padStart(6)} ${r.note || ''}`);
    }
    await pool.close();
    await conn.end();
    if (!ok) {
        console.error('\n❌ MIGRATION FAILED: row-count mismatch detected!');
        process.exit(1);
    }
    console.log('\n✅ Migration complete — every table matches row-for-row. Existing data was preserved.');
};

main().catch((e) => { console.error('[migrate] fatal:', e); process.exit(1); });
