/**
 * Backup module (پشتیبان‌گیری از پیشخوان) — 2026-11-26.
 *
 * createBackup() writes ./backups/backup-<timestamp>.zip containing:
 *   database.sql   full data dump of every table (INSERT statements; the schema
 *                  itself is auto-created on boot, so a restore = empty DB + re-run)
 *   uploads/**     every uploaded image (public/static/uploads + persistent ./uploads)
 *   meta.json      date, table/row counts, file counts
 *
 * The zip writer is pure Node (zlib.deflateRawSync) so no new dependency is
 * needed — images are stored uncompressed (method 0) because JPEG/WebP/PNG are
 * already compressed, everything else is deflated.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import db from '../db/index.js';

const BACKUP_DIR = path.join(process.cwd(), 'backups');
const NAME_RE = /^backup-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}[-\w]*\.zip$/;
const MAX_KEEP = 10; // retention: keep the newest 10 backups

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c;
    }
    return t;
})();
function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- minimal ZIP writer ----------
function dosDateTime(d = new Date()) {
    const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
    const date = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
    return { time, date };
}

/**
 * files: [{ name: 'dir/file.txt', data: Buffer }]
 * Returns a Buffer of a valid .zip archive.
 */
export function buildZip(files) {
    const { time, date } = dosDateTime();
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const f of files) {
        const nameBuf = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8');
        const crc = crc32(f.data);
        let method = 8; // deflate
        let payload = zlib.deflateRawSync(f.data, { level: 6 });
        if (payload.length >= f.data.length) { method = 0; payload = f.data; } // store already-compressed data
        const lh = Buffer.alloc(30);
        lh.writeUInt32LE(0x04034b50, 0);
        lh.writeUInt16LE(20, 4);           // version needed
        lh.writeUInt16LE(0x0800, 6);       // UTF-8 flag
        lh.writeUInt16LE(method, 8);
        lh.writeUInt16LE(time, 10);
        lh.writeUInt16LE(date, 12);
        lh.writeUInt32LE(crc, 14);
        lh.writeUInt32LE(payload.length, 18);
        lh.writeUInt32LE(f.data.length, 22);
        lh.writeUInt16LE(nameBuf.length, 26);
        locals.push(lh, nameBuf, payload);

        const ch = Buffer.alloc(46);
        ch.writeUInt32LE(0x02014b50, 0);
        ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6);
        ch.writeUInt16LE(0x0800, 8);
        ch.writeUInt16LE(method, 10);
        ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
        ch.writeUInt32LE(crc, 16);
        ch.writeUInt32LE(payload.length, 20);
        ch.writeUInt32LE(f.data.length, 24);
        ch.writeUInt16LE(nameBuf.length, 28);
        ch.writeUInt32LE(offset, 42);
        centrals.push(ch, nameBuf);
        offset += lh.length + nameBuf.length + payload.length;
    }
    const cdSize = centrals.reduce((s, b) => s + b.length, 0);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, ...centrals, eocd]);
}

// ---------- SQL dump (portable: SQLite & MySQL via the db bridge) ----------
function sqlQuote(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (Buffer.isBuffer(v)) return `X'${v.toString('hex').slice(0, 200000)}'`;
    return `'${String(v).replace(/'/g, "''")}'`;
}

function listTables() {
    try {
        return db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(r => r.name);
    } catch {
        const rows = db.prepare(`SHOW TABLES`).all();
        return rows.map(r => Object.values(r)[0]);
    }
}

export function dumpDatabase() {
    const tables = listTables();
    const out = [`-- رادیس backup ${new Date().toISOString()}`, `-- Data-only dump (schema is created automatically on server boot).`, `SET foreign_key_checks = 0;`];
    const counts = {};
    for (const t of tables) {
        let cols = [];
        let rows = [];
        try {
            rows = db.prepare(`SELECT * FROM ${t}`).all();
            cols = rows.length ? Object.keys(rows[0]) : [];
        } catch (e) {
            out.push(`-- table ${t} skipped: ${e.message}`);
            continue;
        }
        counts[t] = rows.length;
        out.push(``, `-- ==== ${t} (${rows.length} rows) ====`);
        if (!rows.length) continue;
        const colList = cols.map(c => `\`${c}\``).join(', ');
        const CHUNK = 100;
        for (let i = 0; i < rows.length; i += CHUNK) {
            const chunk = rows.slice(i, i + CHUNK);
            const values = chunk.map(r => '(' + cols.map(c => sqlQuote(r[c])).join(', ') + ')').join(',\n  ');
            out.push(`INSERT INTO \`${t}\` (${colList}) VALUES\n  ${values};`);
        }
    }
    out.push('', `SET foreign_key_checks = 1;`, '');
    return { sql: out.join('\n'), counts, tables };
}

// ---------- uploads walker ----------
function walkFiles(dir, base, files, limit = 4000) {
    if (files.length >= limit) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        if (files.length >= limit) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walkFiles(full, base, files, limit);
        else if (e.isFile()) {
            try {
                if (fs.statSync(full).size <= 30 * 1024 * 1024) {
                    files.push({ name: 'uploads/' + path.relative(base, full).replace(/\\/g, '/'), data: fs.readFileSync(full) });
                }
            } catch { /* unreadable file is skipped */ }
        }
    }
}

// ---------- public API ----------
function ensureDir() { try { fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch { /* exists */ } }

export function listBackups() {
    ensureDir();
    const items = [];
    for (const name of fs.readdirSync(BACKUP_DIR)) {
        if (!NAME_RE.test(name)) continue;
        try {
            const st = fs.statSync(path.join(BACKUP_DIR, name));
            items.push({ name, size: st.size, created_at: st.mtime.toISOString() });
        } catch { /* raced delete */ }
    }
    return items.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function backupFilePath(name) {
    if (!NAME_RE.test(name)) return null; // path traversal guard
    const p = path.join(BACKUP_DIR, name);
    return fs.existsSync(p) ? p : null;
}

export function deleteBackup(name) {
    const p = backupFilePath(name);
    if (!p) return false;
    try { fs.unlinkSync(p); return true; } catch { return false; }
}

/** Create a full backup zip. Returns the list entry of the new file. */
export function createBackup() {
    ensureDir();
    const { sql, counts } = dumpDatabase();
    const meta = {
        created_at: new Date().toISOString(),
        app: 'radys',
        tables: counts,
        note: 'Restore: deploy the app (schema auto-creates), empty the tables, then import database.sql. uploads/ holds public/static/uploads content.'
    };
    const files = [
        { name: 'database.sql', data: Buffer.from(sql, 'utf8') },
        { name: 'meta.json', data: Buffer.from(JSON.stringify(meta, null, 2), 'utf8') }
    ];
    // Uploads live in public/static/uploads (and a mirrored persistent ./uploads).
    walkFiles(path.join(process.cwd(), 'public/static/uploads'), path.join(process.cwd(), 'public/static/uploads'), files);
    const seen = new Set(files.map(f => f.name));
    const uploadsAlt = [];
    walkFiles(path.join(process.cwd(), 'uploads'), path.join(process.cwd(), 'uploads'), uploadsAlt);
    for (const f of uploadsAlt) {
        if (!seen.has(f.name)) { seen.add(f.name); files.push(f); }
    }
    const stamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '');
    const name = `backup-${stamp}.zip`;
    const zip = buildZip(files);
    fs.writeFileSync(path.join(BACKUP_DIR, name), zip);
    // retention: newest 10
    const all = listBackups();
    for (const old of all.slice(MAX_KEEP)) deleteBackup(old.name);
    return { name, size: zip.length, created_at: new Date().toISOString(), tables: counts, files: files.length };
}
