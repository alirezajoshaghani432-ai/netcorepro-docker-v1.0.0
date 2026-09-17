// Create the application database on SQL Server if it does not exist.
// Connects to `master` so it can run even when MSSQL_DATABASE is missing.
import sql from 'mssql';

const database = process.env.MSSQL_DATABASE || 'netcorepro';
if (!/^[A-Za-z0-9_]+$/.test(database)) {
    console.error('[mssql-ensure-db] invalid database name');
    process.exit(1);
}

const cfg = {
    server: process.env.MSSQL_SERVER || process.env.MSSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MSSQL_PORT || '1433'),
    user: process.env.MSSQL_USER || 'sa',
    password: process.env.MSSQL_PASSWORD || '',
    database: 'master',
    options: {
        encrypt: (process.env.MSSQL_ENCRYPT || 'false').toLowerCase() === 'true',
        trustServerCertificate: (process.env.MSSQL_TRUST_CERT || 'true').toLowerCase() !== 'false',
        enableArithAbort: true,
    },
    connectionTimeout: 20000,
    requestTimeout: 30000,
};

try {
    const pool = await sql.connect(cfg);
    await pool.request().query(`IF DB_ID(N'${database}') IS NULL CREATE DATABASE [${database}]`);
    console.log(`[mssql-ensure-db] database [${database}] is ready`);
    await pool.close();
} catch (e) {
    console.error('[mssql-ensure-db]', e.message || e);
    process.exit(1);
}
