// Worker thread for the synchronous MSSQL bridge (see mssql-sync.js).
import { workerData } from 'worker_threads';

const { port, signal, config } = workerData;

function wake(payload) {
    port.postMessage(payload);
    Atomics.store(signal, 0, 1);
    Atomics.notify(signal, 0);
}

let sql = null;
let pool = null;

function bindParams(request, params) {
    (params || []).forEach((v, idx) => {
        request.input(`p${idx}`, v === undefined ? null : v);
    });
}

(async () => {
    try {
        sql = await import('mssql');
        pool = await sql.default.connect(config);
        await pool.request().query('SELECT 1 AS ok');
        wake({ ready: true });
    } catch (e) {
        wake({ error: String(e.message || e) });
        return;
    }

    port.on('message', async (msg) => {
        if (!msg || msg.method === 'close') {
            try { if (pool) await pool.close(); } catch (_) { /* ignore */ }
            wake({ result: null });
            return;
        }
        try {
            const req = pool.request();
            bindParams(req, msg.params);
            const result = await req.query(msg.sql);
            if (msg.method === 'all') {
                const rows = result.recordset || [];
                wake({ result: Array.isArray(rows) ? rows : [] });
            } else {
                const rowsAffected = Array.isArray(result.rowsAffected)
                    ? result.rowsAffected.reduce((a, b) => a + (b || 0), 0)
                    : (result.rowsAffected || 0);
                let insertId = 0;
                if (Array.isArray(result.recordsets) && result.recordsets.length) {
                    const last = result.recordsets[result.recordsets.length - 1];
                    if (last && last[0] && last[0].insertId != null)
                        insertId = Number(last[0].insertId) || 0;
                } else if (result.recordset && result.recordset[0] && result.recordset[0].insertId != null) {
                    insertId = Number(result.recordset[0].insertId) || 0;
                }
                wake({ result: { affectedRows: rowsAffected, insertId } });
            }
        } catch (e) {
            wake({ error: String(e.message || e), code: e.code || e.number });
        }
    });
})();
