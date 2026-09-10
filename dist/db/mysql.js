// MySQL 8 driver wrapper for NetCore Pro
// Used when DB_TYPE=mysql (production Linux deployment)
let pool = null;
let mysqlLib = null;
function readOptionsFromEnv() {
    return {
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT || '3306'),
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        database: process.env.MYSQL_DATABASE || 'netcorepro',
        connectionLimit: parseInt(process.env.MYSQL_POOL_LIMIT || '10')
    };
}
export async function getMysqlPool() {
    if (pool)
        return pool;
    if (!mysqlLib) {
        try {
            mysqlLib = await import('mysql2/promise');
        }
        catch (e) {
            throw new Error('Package "mysql2" is not installed. Run: npm install mysql2');
        }
    }
    const opts = readOptionsFromEnv();
    pool = mysqlLib.createPool({
        host: opts.host,
        port: opts.port,
        user: opts.user,
        password: opts.password,
        database: opts.database,
        waitForConnections: true,
        connectionLimit: opts.connectionLimit,
        queueLimit: 0,
        charset: 'utf8mb4',
        timezone: '+00:00'
    });
    console.log(`[mysql] Pool created for ${opts.host}:${opts.port}/${opts.database}`);
    return pool;
}
export async function mysqlQuery(sql, params = []) {
    const p = await getMysqlPool();
    const [result] = await p.query(sql, params);
    if (Array.isArray(result)) {
        return { rows: result, rowsAffected: result.length };
    }
    const r = result;
    return { rows: [], rowsAffected: r.affectedRows, insertId: r.insertId };
}
export async function mysqlPing() {
    try {
        const p = await getMysqlPool();
        await p.query('SELECT 1');
        return true;
    }
    catch {
        return false;
    }
}
export async function closeMysql() {
    try {
        if (pool) {
            await pool.end();
            pool = null;
            console.log('[mysql] Pool closed');
        }
    }
    catch (e) {
        console.error('[mysql] close error:', e);
    }
}
