// =====================================================================
//  Synchronous MySQL bridge (better-sqlite3 compatible API)
// ---------------------------------------------------------------------
//  The whole codebase talks to the DB with better-sqlite3's synchronous
//  API (db.prepare(sql).get()/all()/run(), db.transaction(), db.exec()).
//  MySQL drivers for Node are async-only, so this module runs mysql2 in
//  a worker thread and blocks the main thread with Atomics.wait until
//  the result arrives (same technique as the `synckit` package).
//
//  It also translates the few SQLite-dialect constructs used in the
//  codebase into MySQL/MariaDB equivalents:
//    datetime('now')                  -> UTC_TIMESTAMP()
//    datetime('now','-N days')        -> DATE_SUB(UTC_TIMESTAMP(), INTERVAL N DAY)
//    ON CONFLICT(..) DO UPDATE SET    -> ON DUPLICATE KEY UPDATE
//    excluded.col                     -> VALUES(col)
//    bare `key` column (reserved)     -> `key`
//  PRAGMA statements are ignored (no-op).
// =====================================================================
import { Worker, receiveMessageOnPort, MessageChannel } from 'worker_threads';

const SIG_READY = 1;
const SIG_DONE = 2;

function translateSql(sql) {
    let s = sql;
    // datetime('now','-7 days') -> DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
    s = s.replace(/datetime\(\s*'now'\s*,\s*'-(\d+)\s+days?'\s*\)/gi, 'DATE_SUB(UTC_TIMESTAMP(), INTERVAL $1 DAY)');
    s = s.replace(/datetime\(\s*'now'\s*,\s*'\+(\d+)\s+days?'\s*\)/gi, 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL $1 DAY)');
    // datetime('now') -> UTC_TIMESTAMP()
    s = s.replace(/datetime\(\s*'now'\s*\)/gi, 'UTC_TIMESTAMP()');
    // UPSERT: ON CONFLICT(cols) DO UPDATE SET a = excluded.a  ->  ON DUPLICATE KEY UPDATE a = VALUES(a)
    s = s.replace(/ON\s+CONFLICT\s*\([^)]*\)\s*DO\s+UPDATE\s+SET/gi, 'ON DUPLICATE KEY UPDATE');
    s = s.replace(/excluded\.([a-zA-Z_][a-zA-Z0-9_]*)/g, 'VALUES($1)');
    // `key` is a reserved word in MySQL — backtick every standalone use
    s = s.replace(/(^|[^`\w."'])key([^`\w."']|$)/g, '$1`key`$2');
    // LIKE ... ESCAPE '\' : legal in SQLite, but in MySQL a lone backslash
    // inside a string literal escapes the closing quote -> ER_PARSE_ERROR.
    // Double it so MySQL sees a literal backslash as the escape character.
    s = s.replace(/ESCAPE\s+'\\'/gi, "ESCAPE '\\\\'");
    return s;
}

function normalizeParam(v) {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
        // ISO date strings (new Date().toISOString()) -> MySQL DATETIME format (UTC)
        const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?$/);
        if (m) return `${m[1]} ${m[2]}`;
    }
    return v;
}

export function createMysqlSyncDb() {
    const { port1, port2 } = new MessageChannel();
    const signal = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(new URL('./mysql-sync-worker.js', import.meta.url), {
        workerData: {
            port: port2,
            signal,
            config: {
                host: process.env.MYSQL_HOST || '127.0.0.1',
                port: parseInt(process.env.MYSQL_PORT || '3306'),
                user: process.env.MYSQL_USER || 'netcore',
                password: process.env.MYSQL_PASSWORD || '',
                database: process.env.MYSQL_DATABASE || 'netcorepro',
                connectionLimit: parseInt(process.env.MYSQL_POOL_LIMIT || '4'),
            },
        },
        transferList: [port2],
    });
    worker.unref();

    // Block until the worker's pool is ready (or it reports a startup error)
    Atomics.wait(signal, 0, 0);
    const readyMsg = receiveMessageOnPort(port1);
    if (readyMsg && readyMsg.message && readyMsg.message.error) {
        throw new Error('[mysql-sync] startup failed: ' + readyMsg.message.error);
    }

    function call(method, sql, params) {
        Atomics.store(signal, 0, 0);
        port1.postMessage({ method, sql: translateSql(sql), params: (params || []).map(normalizeParam) });
        Atomics.wait(signal, 0, 0);
        const out = receiveMessageOnPort(port1);
        const msg = out && out.message;
        if (!msg) throw new Error('[mysql-sync] empty response');
        if (msg.error) {
            const e = new Error(msg.error);
            e.code = msg.code;
            throw e;
        }
        return msg.result;
    }

    const db = {
        prepare(sql) {
            return {
                get(...params) {
                    const rows = call('all', sql, params);
                    return rows && rows.length ? rows[0] : undefined;
                },
                all(...params) {
                    return call('all', sql, params) || [];
                },
                run(...params) {
                    const r = call('run', sql, params);
                    return { changes: r.affectedRows || 0, lastInsertRowid: r.insertId || 0 };
                },
                pluck() {
                    const self = this;
                    return {
                        get(...params) {
                            const row = self.get(...params);
                            if (row === undefined) return undefined;
                            return row[Object.keys(row)[0]];
                        },
                        all(...params) {
                            return self.all(...params).map((row) => row[Object.keys(row)[0]]);
                        },
                    };
                },
            };
        },
        exec(sql) {
            // Split on semicolons (schema/DDL only; app code passes single statements)
            const stmts = sql.split(';').map((s) => s.trim()).filter((s) => s && !s.startsWith('--'));
            for (const s of stmts) {
                if (/^PRAGMA/i.test(s)) continue;
                call('run', s, []);
            }
        },
        pragma() { return []; },
        transaction(fn) {
            const wrapped = (...args) => {
                call('run', 'START TRANSACTION', []);
                try {
                    const out = fn(...args);
                    call('run', 'COMMIT', []);
                    return out;
                }
                catch (e) {
                    try { call('run', 'ROLLBACK', []); } catch (_) { /* ignore */ }
                    throw e;
                }
            };
            wrapped.deferred = wrapped;
            wrapped.immediate = wrapped;
            wrapped.exclusive = wrapped;
            return wrapped;
        },
        get open() { return true; },
        close() {
            try { port1.postMessage({ method: 'close' }); } catch (_) { }
            try { worker.terminate(); } catch (_) { }
        },
    };
    // health check
    const ping = db.prepare('SELECT 1 AS ok').get();
    if (!ping || ping.ok !== 1) throw new Error('[mysql-sync] connection test failed');
    console.log(`[mysql-sync] connected to ${process.env.MYSQL_HOST || '127.0.0.1'}:${process.env.MYSQL_PORT || 3306}/${process.env.MYSQL_DATABASE || 'netcorepro'}`);
    return db;
}
