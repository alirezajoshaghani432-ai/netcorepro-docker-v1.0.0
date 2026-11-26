#!/usr/bin/env node
/**
 * Precompress text assets under public/static into .gz / .br siblings.
 *
 * Served by the `precompressedStatic` middleware in dist/server.js when the
 * browser advertises gzip / br support, so the server never pays for on-the-fly
 * compression on large static files (Tailwind CSS alone is ~170 KB raw).
 * Run once after any CSS/JS/font update:
 *    node scripts/perf/precompress.mjs
 * (also wired as `npm run precompress`)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.join(process.cwd(), 'public/static');
const EXTS = new Set(['.css', '.js', '.svg', '.json', '.txt', '.xml']);
const MIN_BYTES = 1024; // smaller files are not worth the extra request complexity

let made = { gz: 0, br: 0 };
function walk(dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) {
            if (!EXTS.has(path.extname(e.name)) || e.name.endsWith('.gz') || e.name.endsWith('.br')) continue;
            const buf = fs.readFileSync(full);
            if (buf.length < MIN_BYTES) continue;
            fs.writeFileSync(full + '.gz', zlib.gzipSync(buf, { level: 9 }));
            fs.writeFileSync(full + '.br', zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }));
            made.gz++; made.br++;
        }
    }
}
walk(ROOT);
console.log(`[precompress] wrote ${made.gz} .gz and ${made.br} .br files under public/static`);
