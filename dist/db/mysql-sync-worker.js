// Worker thread for the synchronous MySQL bridge (see mysql-sync.js).
// Executes queries with mysql2/promise and wakes the main thread via Atomics.
import { workerData } from 'worker_threads';
import mysql from 'mysql2/promise';

const { port, signal, config } = workerData;

function wake(payload) {
    port.postMessage(payload);
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
}

let pool = null;
// mysql2's pool.query() can't run START TRANSACTION/COMMIT on the *same*
// connection across calls, so we keep one dedicated connection instead.
let conn = null;

async function ensureConn() {
    if (conn) return conn;
    if (!pool) {
        pool = mysql.createPool({
            ...config,
            waitForConnections: true,
            queueLimit: 0,
            charset: 'utf8mb4',
            timezone: '+00:00',
            dateStrings: true, // return DATETIME as strings like SQLite does
            supportBigNumbers: true,
            decimalNumbers: true, // SUM()/AVG() as numbers, matching better-sqlite3
        });
    }
    conn = await pool.getConnection();
    return conn;
}

(async () => {
    try {
        const c = await ensureConn();
        await c.query('SELECT 1');
        wake({ ready: true });
    }
    catch (e) {
        wake({ error: String(e.message || e) });
        return;
    }

    port.on('message', async (msg) => {
        if (!msg || msg.method === 'close') {
            try { if (conn) conn.release(); if (pool) await pool.end(); } catch (_) { }
            wake({ result: null });
            return;
        }
        try {
            const c = await ensureConn();
            const [result] = await c.query(msg.sql, msg.params || []);
            if (msg.method === 'all') {
                wake({ result: Array.isArray(result) ? result : [] });
            }
            else {
                const r = result || {};
                wake({ result: { affectedRows: r.affectedRows || 0, insertId: Number(r.insertId || 0) } });
            }
        }
        catch (e) {
            wake({ error: String(e.message || e), code: e.code });
        }
    });
})();
