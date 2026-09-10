// SQL Server driver wrapper for NetCore Pro
// Used when DB_TYPE=mssql (Windows Server / IIS deployment)
//
// IMPORTANT: This module is loaded dynamically only when DB_TYPE=mssql.
// On Linux/SQLite deployments, the `mssql` package is NOT required at runtime.
//
// Usage (set in .env):
//   DB_TYPE=mssql
//   MSSQL_SERVER=localhost
//   MSSQL_DATABASE=netcorepro
//   MSSQL_USER=sa
//   MSSQL_PASSWORD=YourStrong!Passw0rd
//   MSSQL_PORT=1433
//   MSSQL_ENCRYPT=false
//   MSSQL_TRUST_CERT=true
let pool = null;
let mssqlLib = null;
function readOptionsFromEnv() {
    return {
        server: process.env.MSSQL_SERVER || 'localhost',
        database: process.env.MSSQL_DATABASE || 'netcorepro',
        user: process.env.MSSQL_USER || 'sa',
        password: process.env.MSSQL_PASSWORD || '',
        port: parseInt(process.env.MSSQL_PORT || '1433'),
        encrypt: (process.env.MSSQL_ENCRYPT || 'false').toLowerCase() === 'true',
        trustServerCertificate: (process.env.MSSQL_TRUST_CERT || 'true').toLowerCase() === 'true',
        poolMax: parseInt(process.env.MSSQL_POOL_MAX || '10'),
        poolMin: parseInt(process.env.MSSQL_POOL_MIN || '0')
    };
}
export async function getMssqlPool() {
    if (pool && pool.connected)
        return pool;
    if (!mssqlLib) {
        try {
            mssqlLib = await import('mssql');
        }
        catch (e) {
            throw new Error('Package "mssql" is not installed. Run: npm install mssql');
        }
    }
    const opts = readOptionsFromEnv();
    const config = {
        server: opts.server,
        database: opts.database,
        user: opts.user,
        password: opts.password,
        port: opts.port,
        options: {
            encrypt: opts.encrypt,
            trustServerCertificate: opts.trustServerCertificate,
            enableArithAbort: true
        },
        pool: {
            max: opts.poolMax,
            min: opts.poolMin,
            idleTimeoutMillis: 30000
        }
    };
    pool = await mssqlLib.connect(config);
    console.log(`[mssql] Connected to ${opts.server}:${opts.port}/${opts.database}`);
    // Auto-reconnect on disconnect
    pool.on('error', (err) => {
        console.error('[mssql] Pool error:', err.message);
        pool = null;
    });
    return pool;
}
/**
 * Run a parameterized query.
 * Convert SQLite-style `?` placeholders to MSSQL @p0, @p1, ... automatically.
 */
export async function mssqlQuery(sql, params = []) {
    const p = await getMssqlPool();
    const req = p.request();
    // Convert ? to @p0 @p1 ...
    let i = 0;
    const converted = sql.replace(/\?/g, () => `@p${i++}`);
    params.forEach((v, idx) => req.input(`p${idx}`, v));
    // For INSERT, append SELECT SCOPE_IDENTITY() so we can return insertId
    const isInsert = /^\s*INSERT\s/i.test(sql);
    const finalSql = isInsert ? `${converted}; SELECT CAST(SCOPE_IDENTITY() AS INT) AS insertId;` : converted;
    const result = await req.query(finalSql);
    const rows = result.recordset || [];
    const rowsAffected = result.rowsAffected?.[0] || 0;
    let insertId;
    if (isInsert && Array.isArray(result.recordsets)) {
        const last = result.recordsets[result.recordsets.length - 1];
        if (last && last[0])
            insertId = last[0].insertId;
    }
    return { rows, rowsAffected, insertId };
}
/**
 * Health check (used by /api/health when DB_TYPE=mssql)
 */
export async function mssqlPing() {
    try {
        const p = await getMssqlPool();
        await p.request().query('SELECT 1 AS ok');
        return true;
    }
    catch {
        return false;
    }
}
export async function closeMssql() {
    try {
        if (pool) {
            await pool.close();
            pool = null;
            console.log('[mssql] Pool closed');
        }
    }
    catch (e) {
        console.error('[mssql] close error:', e);
    }
}
