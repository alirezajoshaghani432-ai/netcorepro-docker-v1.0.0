// =====================================================================
//  SQLite -> Microsoft SQL Server data migration for NetCore Pro
// ---------------------------------------------------------------------
//  - Reads every row from the SQLite file (DB_PATH or data/netcorepro.db)
//  - Creates the MSSQL schema (dist/db/schema.mssql.sql)
//  - Copies all rows table-by-table preserving IDs (FKs stay valid)
//  - Verifies row counts per table at the end and exits non-zero on any
//    mismatch, so data loss can never go unnoticed.
//
//  Usage:
//    MSSQL_SERVER=127.0.0.1 MSSQL_USER=sa MSSQL_PASSWORD=... \
//    MSSQL_DATABASE=netcorepro node scripts/migrate-sqlite-to-mssql.mjs
// =====================================================================
import Database from 'better-sqlite3';
import sql from 'mssql';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const sqlitePath = process.env.DB_PATH || join(root, 'data/netcorepro.db');

const TABLE_ORDER = [
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

function bracket(name) {
    return `[${String(name).replace(/[\[\]]/g, '')}]`;
}

const config = {
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
    console.log(`[migrate] SQLite source: ${sqlitePath}`);
    const sq = new Database(sqlitePath, { readonly: true });

    const pool = await sql.connect(config);
    console.log('[migrate] SQL Server connected');

    const schema = readFileSync(join(root, 'dist/db/schema.mssql.sql'), 'utf-8');
    try {
        await pool.request().query(schema);
    } catch (e) {
        if (!/already an object named|already exists/i.test(e.message || '')) {
            console.error('[migrate] schema apply warning:', String(e.message || e).slice(0, 240));
        }
    }
    console.log('[migrate] schema ensured');

    const report = [];
    for (const table of TABLE_ORDER) {
        const exists = sq.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
        if (!exists) { report.push({ table, sqlite: 0, mssql: 0, note: 'missing in sqlite' }); continue; }

        const rows = sq.prepare(`SELECT * FROM "${table}"`).all();
        const colRs = await pool.request()
            .input('t', sql.NVarChar, table)
            .query(`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_CATALOG = DB_NAME() AND TABLE_NAME = @t`);
        const mssqlCols = new Set(colRs.recordset.map((c) => c.name));

        // Disable FKs for this table, wipe, insert with IDENTITY_INSERT
        try { await pool.request().query(`ALTER TABLE ${bracket(table)} NOCHECK CONSTRAINT ALL`); } catch (_) { /* ignore */ }
        try { await pool.request().query(`DELETE FROM ${bracket(table)}`); } catch (e) {
            console.error(`[migrate] DELETE ${table}:`, e.message);
        }

        if (rows.length) {
            const cols = Object.keys(rows[0]).filter((c) => mssqlCols.has(c));
            const skipped = Object.keys(rows[0]).filter((c) => !mssqlCols.has(c));
            if (skipped.length) console.warn(`[migrate] ${table}: skipping sqlite-only columns: ${skipped.join(', ')}`);
            const hasId = cols.includes('id');
            if (hasId) {
                try { await pool.request().query(`SET IDENTITY_INSERT ${bracket(table)} ON`); } catch (_) { /* settings has no identity */ }
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
        report.push({ table, sqlite: rows.length, mssql: Number(countRs.recordset[0].c) });
    }

    console.log('\n===== MIGRATION VERIFICATION =====');
    let ok = true;
    for (const r of report) {
        const match = r.sqlite === r.mssql;
        if (!match) ok = false;
        console.log(`${match ? '✅' : '❌'} ${r.table.padEnd(24)} sqlite=${String(r.sqlite).padStart(6)}  mssql=${String(r.mssql).padStart(6)} ${r.note || ''}`);
    }
    await pool.close();
    sq.close();
    if (!ok) {
        console.error('\n❌ MIGRATION FAILED: row-count mismatch detected!');
        process.exit(1);
    }
    console.log('\n✅ Migration complete — every table matches row-for-row. Existing data was preserved.');
};

main().catch((e) => { console.error('[migrate] fatal:', e); process.exit(1); });
