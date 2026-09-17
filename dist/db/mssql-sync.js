// =====================================================================
//  Synchronous SQL Server bridge (better-sqlite3 compatible API)
//  Same Atomics.wait + worker-thread pattern as mysql-sync.js.
// =====================================================================
import { Worker, receiveMessageOnPort, MessageChannel } from 'worker_threads';

function splitCsv(str) {
    const out = [];
    let cur = '';
    let depth = 0;
    let quote = null;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (quote) {
            cur += ch;
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
        if (ch === '(') { depth++; cur += ch; continue; }
        if (ch === ')') { depth = Math.max(0, depth - 1); cur += ch; continue; }
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

function convertOnConflict(sql) {
    const re = /INSERT\s+INTO\s+([^\s(]+)\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]*?)\)\s*ON\s+CONFLICT\s*\(([^)]+)\)\s*DO\s+UPDATE\s+SET\s+([\s\S]+)$/i;
    const m = sql.match(re);
    if (!m) return sql;
    const table = m[1];
    const cols = splitCsv(m[2]);
    const vals = splitCsv(m[3]);
    const conflictCols = splitCsv(m[4]);
    let setClause = m[5].trim().replace(/;+\s*$/, '');
    setClause = setClause.replace(/\bexcluded\./gi, 'src.');
    const bracket = (c) => {
        const n = String(c).replace(/[\[\]`]/g, '');
        return `[${n}]`;
    };
    const on = conflictCols.map((c) => `tgt.${bracket(c)} = src.${bracket(c)}`).join(' AND ');
    const srcSelect = cols.map((c, i) => `${vals[i] ?? 'NULL'} AS ${bracket(c)}`).join(', ');
    const insertCols = cols.map(bracket).join(', ');
    const insertVals = cols.map((c) => `src.${bracket(c)}`).join(', ');
    return `MERGE ${table} AS tgt USING (SELECT ${srcSelect}) AS src ON ${on} WHEN MATCHED THEN UPDATE SET ${setClause} WHEN NOT MATCHED THEN INSERT (${insertCols}) VALUES (${insertVals});`;
}

function translateSql(sql, params) {
    let s = sql;
    const p = (params || []).slice();

    s = s.replace(/datetime\(\s*'now'\s*,\s*'-(\d+)\s+days?'\s*\)/gi, 'DATEADD(day, -$1, SYSUTCDATETIME())');
    s = s.replace(/datetime\(\s*'now'\s*,\s*'\+(\d+)\s+days?'\s*\)/gi, 'DATEADD(day, $1, SYSUTCDATETIME())');
    s = s.replace(/datetime\(\s*'now'\s*\)/gi, 'SYSUTCDATETIME()');
    s = s.replace(/UTC_TIMESTAMP\(\)/gi, 'SYSUTCDATETIME()');
    s = s.replace(/CURRENT_TIMESTAMP/gi, 'SYSUTCDATETIME()');

    // LIKE ESCAPE '\' is valid; keep a single backslash for MSSQL.
    s = s.replace(/ESCAPE\s+'\\\\'/gi, "ESCAPE '\\'");

    // Bare `key` (reserved) -> [key]
    s = s.replace(/`key`/gi, '[key]');
    s = s.replace(/(^|[^[\]\w."'])key([^[\]\w."']|$)/g, '$1[key]$2');

    // Backticks -> brackets
    s = s.replace(/`([A-Za-z_][A-Za-z0-9_]*)`/g, '[$1]');

    // IFNULL -> ISNULL
    s = s.replace(/\bIFNULL\s*\(/gi, 'ISNULL(');

    // SQLite UPSERT -> MERGE (must run before ? -> @pN)
    s = convertOnConflict(s);

    // LIMIT / OFFSET  (must run before ? -> @pN)
    // 1) LIMIT ? OFFSET ?
    if (/LIMIT\s*\?\s*OFFSET\s*\?/i.test(s)) {
        s = s.replace(/\s*LIMIT\s*\?\s*OFFSET\s*\?/i, '');
        if (!/\bORDER\s+BY\b/i.test(s)) s += ' ORDER BY (SELECT NULL)';
        s += ' OFFSET ? ROWS FETCH NEXT ? ROWS ONLY';
        if (p.length >= 2) {
            const offset = p[p.length - 1];
            const limit = p[p.length - 2];
            p[p.length - 2] = offset;
            p[p.length - 1] = limit;
        }
    } else {
        // 2) LIMIT n OFFSET m  (literals)
        const lit = s.match(/\s*LIMIT\s+(\d+)\s+OFFSET\s+(\d+)\s*$/i);
        if (lit) {
            s = s.replace(/\s*LIMIT\s+\d+\s+OFFSET\s+\d+\s*$/i, '');
            if (!/\bORDER\s+BY\b/i.test(s)) s += ' ORDER BY (SELECT NULL)';
            s += ` OFFSET ${lit[2]} ROWS FETCH NEXT ${lit[1]} ROWS ONLY`;
        } else {
            // 3) LIMIT ?  / LIMIT n  -> SELECT TOP
            const limQ = s.match(/\s*LIMIT\s*(\?|\d+)\s*$/i);
            if (limQ) {
                s = s.replace(/\s*LIMIT\s*(?:\?|\d+)\s*$/i, '');
                const n = limQ[1];
                if (n === '?') {
                    s = s.replace(/^\s*(SELECT(?:\s+DISTINCT)?)\s+/i, `$1 TOP (?) `);
                    const limit = p.length ? p.pop() : 1;
                    p.unshift(limit);
                } else {
                    s = s.replace(/^\s*(SELECT(?:\s+DISTINCT)?)\s+/i, `$1 TOP (${n}) `);
                }
            }
        }
    }

    // AUTO_INCREMENT reset (used by seed) — identity reseed
    s = s.replace(/ALTER\s+TABLE\s+(\S+)\s+AUTO_INCREMENT\s*=\s*(\d+)/gi,
        'DBCC CHECKIDENT ($1, RESEED, $2)');

    // SET FOREIGN_KEY_CHECKS
    if (/^\s*SET\s+FOREIGN_KEY_CHECKS\s*=\s*0\s*$/i.test(s))
        s = 'EXEC sp_msforeachtable "ALTER TABLE ? NOCHECK CONSTRAINT all"';
    if (/^\s*SET\s+FOREIGN_KEY_CHECKS\s*=\s*1\s*$/i.test(s))
        s = 'EXEC sp_msforeachtable "ALTER TABLE ? WITH CHECK CHECK CONSTRAINT all"';

    // Convert ? placeholders to @p0, @p1, ...
    let i = 0;
    const converted = s.replace(/\?/g, () => `@p${i++}`);

    // For INSERT, append identity select so run() can return lastInsertRowid
    const isInsert = /^\s*INSERT\s/i.test(s);
    const isMerge = /^\s*MERGE\s/i.test(s);
    const finalSql = (isInsert || isMerge)
        ? `${converted}; SELECT CAST(SCOPE_IDENTITY() AS INT) AS insertId;`
        : converted;

    return { sql: finalSql, params: p };
}

function normalizeParam(v) {
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
        const m = v.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?$/);
        if (m) return `${m[1]} ${m[2]}`;
    }
    return v;
}

export function createMssqlSyncDb() {
    const { port1, port2 } = new MessageChannel();
    const signal = new Int32Array(new SharedArrayBuffer(4));
    const encrypt = (process.env.MSSQL_ENCRYPT || 'false').toLowerCase() === 'true';
    const trust = (process.env.MSSQL_TRUST_CERT || 'true').toLowerCase() === 'true';
    const worker = new Worker(new URL('./mssql-sync-worker.js', import.meta.url), {
        workerData: {
            port: port2,
            signal,
            config: {
                server: process.env.MSSQL_SERVER || process.env.MSSQL_HOST || '127.0.0.1',
                port: parseInt(process.env.MSSQL_PORT || '1433', 10),
                user: process.env.MSSQL_USER || 'sa',
                password: process.env.MSSQL_PASSWORD || '',
                database: process.env.MSSQL_DATABASE || 'netcorepro',
                options: {
                    encrypt,
                    trustServerCertificate: trust,
                    enableArithAbort: true,
                },
                pool: {
                    max: parseInt(process.env.MSSQL_POOL_MAX || '8', 10),
                    min: 0,
                    idleTimeoutMillis: 30000,
                },
            },
        },
        transferList: [port2],
    });
    worker.unref();

    Atomics.wait(signal, 0, 0);
    const readyMsg = receiveMessageOnPort(port1);
    if (readyMsg && readyMsg.message && readyMsg.message.error) {
        throw new Error('[mssql-sync] startup failed: ' + readyMsg.message.error);
    }

    function call(method, sql, params) {
        const t = translateSql(sql, (params || []).map(normalizeParam));
        Atomics.store(signal, 0, 0);
        port1.postMessage({ method, sql: t.sql, params: t.params });
        Atomics.wait(signal, 0, 0);
        const out = receiveMessageOnPort(port1);
        const msg = out && out.message;
        if (!msg) throw new Error('[mssql-sync] empty response');
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
            const raw = String(sql || '').trim();
            if (!raw) return;
            // Schema batches (IF OBJECT_ID ... BEGIN ... END) must run as one T-SQL batch.
            if (/\bBEGIN\b/i.test(raw) || /\bIF\s+OBJECT_ID\b/i.test(raw) || /\bIF\s+NOT\s+EXISTS\b/i.test(raw) || raw.length > 800) {
                const cleaned = raw.split('\n').filter((l) => !/^\s*PRAGMA/i.test(l)).join('\n');
                try { call('run', cleaned, []); }
                catch (e) {
                    if (!/already an object named|already exists|duplicate key/i.test(e.message || ''))
                        throw e;
                }
                return;
            }
            const stmts = raw.split(';').map((s) => s.trim()).filter((s) => s && !s.startsWith('--'));
            for (const s of stmts) {
                if (/^PRAGMA/i.test(s)) continue;
                try { call('run', s, []); }
                catch (e) {
                    if (!/already an object named|already exists|duplicate key/i.test(e.message || ''))
                        throw e;
                }
            }
        },
        pragma() { return []; },
        transaction(fn) {
            const wrapped = (...args) => {
                call('run', 'BEGIN TRANSACTION', []);
                try {
                    const out = fn(...args);
                    call('run', 'COMMIT', []);
                    return out;
                } catch (e) {
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
            try { port1.postMessage({ method: 'close' }); } catch (_) { /* ignore */ }
            try { worker.terminate(); } catch (_) { /* ignore */ }
        },
    };

    const ping = db.prepare('SELECT 1 AS ok').get();
    if (!ping || Number(ping.ok) !== 1) throw new Error('[mssql-sync] connection test failed');
    console.log(`[mssql-sync] connected to ${process.env.MSSQL_SERVER || process.env.MSSQL_HOST || '127.0.0.1'}:${process.env.MSSQL_PORT || 1433}/${process.env.MSSQL_DATABASE || 'netcorepro'}`);
    return db;
}

export { translateSql };
