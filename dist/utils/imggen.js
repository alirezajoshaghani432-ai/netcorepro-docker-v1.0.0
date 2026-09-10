/**
 * On-upload responsive variant generation.
 * ------------------------------------------------------------------
 * The build-time pipeline (scripts/perf/build_images.py) only knows about
 * images that existed when it ran. Product photos are added from the admin
 * panel continuously, and without this module those new photos would be
 * served at full size forever, so the responsive-image win would silently
 * decay away again.
 *
 * So: whenever an image is uploaded we generate the same WebP ladder and
 * append it to the manifest, in the background, never blocking the response.
 * Failure is always non-fatal — the original file is already saved and the
 * <img> falls back to it, exactly as for any un-processed image.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadImageManifest } from './img.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const STATIC = path.join(ROOT, 'public', 'static');
const OUT_DIR = path.join(STATIC, 'rimg');
const MANIFEST = path.join(OUT_DIR, 'manifest.json');

const WIDTHS = [320, 480, 640, 960, 1280, 1600];
const QUALITY = 78;
const MAX_VARIANTS = 4;

function run(cmd, args) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: 30000 }, (err) => resolve(!err));
    });
}

/** Intrinsic size via cwebp's sibling tool, else a minimal JPEG/PNG probe. */
function probeSize(file) {
    try {
        const b = fs.readFileSync(file);
        // PNG
        if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
            return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
        }
        // JPEG — walk the segment markers
        if (b[0] === 0xFF && b[1] === 0xD8) {
            let i = 2;
            while (i < b.length - 9) {
                if (b[i] !== 0xFF) { i++; continue; }
                const m = b[i + 1];
                const len = b.readUInt16BE(i + 2);
                if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
                    return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
                }
                i += 2 + len;
            }
        }
        // WebP (VP8X / VP8 lossy / VP8L)
        if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF') {
            const fmt = b.toString('ascii', 12, 16);
            if (fmt === 'VP8X') return { w: (b.readUIntLE(24, 3) & 0xFFFFFF) + 1, h: (b.readUIntLE(27, 3) & 0xFFFFFF) + 1 };
            if (fmt === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3FFF, h: b.readUInt16LE(28) & 0x3FFF };
            if (fmt === 'VP8L') {
                const n = b.readUInt32LE(21);
                return { w: (n & 0x3FFF) + 1, h: ((n >> 14) & 0x3FFF) + 1 };
            }
        }
    }
    catch (e) { /* fall through */ }
    return null;
}

let queue = Promise.resolve();

/**
 * Queue variant generation for a freshly uploaded file.
 * @param {string} url  public URL, e.g. /static/uploads/up-123.jpg
 */
export function generateVariantsFor(url) {
    queue = queue.then(() => build(url)).catch(() => { });
    return queue;
}

async function build(url) {
    const clean = String(url || '').split('?')[0];
    if (!/^\/static\/(images|uploads)\/.+\.(jpe?g|png|webp)$/i.test(clean)) return;

    const src = path.join(ROOT, 'public', clean.replace(/^\//, ''));
    if (!fs.existsSync(src)) return;

    const size = probeSize(src);
    if (!size || !size.w || !size.h) return;

    const rel = clean.replace('/static/', '');            // images/x.jpg
    const relNoExt = rel.replace(/\.[^.]+$/, '');
    const targets = WIDTHS.filter(w => w <= size.w).slice(-MAX_VARIANTS);
    if (!targets.includes(size.w) && targets.length < MAX_VARIANTS && size.w < WIDTHS[WIDTHS.length - 1]) {
        targets.push(size.w);
    }
    if (!targets.length) targets.push(size.w);

    const variants = {};
    for (const w of targets) {
        const dst = path.join(OUT_DIR, `${relNoExt}-${w}.webp`);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        const okCwebp = await run('cwebp', ['-quiet', '-q', String(QUALITY),
            '-resize', String(w), '0', '-metadata', 'none', src, '-o', dst]);
        if (!okCwebp || !fs.existsSync(dst)) continue;
        const bytes = fs.statSync(dst).size;
        // never ship a "variant" that is bigger than the source
        if (bytes >= fs.statSync(src).size && w >= size.w) { fs.unlinkSync(dst); continue; }
        variants[String(w)] = { u: `/static/rimg/${relNoExt}-${w}.webp`, s: bytes };
    }
    if (!Object.keys(variants).length) return;

    // merge into the manifest (read-modify-write, single-queued so no races)
    let man = {};
    try { man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) { man = {}; }
    man[clean] = { w: size.w, h: size.h, v: variants };
    const tmp = MANIFEST + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(man));
    fs.renameSync(tmp, MANIFEST);   // atomic swap; readers never see a half file
    loadImageManifest();            // hot-reload so the very next SSR sees it
}

export default { generateVariantsFor };
