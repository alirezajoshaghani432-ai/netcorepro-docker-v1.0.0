/**
 * F2f — Responsive image helper (SSR)
 * ------------------------------------------------------------------
 * Reads public/static/rimg/manifest.json (produced by
 * scripts/perf/build_images.py) once at module load and turns a plain
 * image URL into a fully-specified <img> tag with:
 *   - srcset / sizes        -> the browser downloads only what it needs
 *   - width / height        -> reserves layout space, kills CLS
 *   - loading / decoding    -> off-screen images never block the LCP
 *   - fetchpriority="high"  -> for the single LCP image
 *
 * The original file is always kept as the `src` fallback, so a browser
 * without WebP (or a URL that was never processed) degrades gracefully.
 * Nothing here ever mutates or deletes a source image.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(HERE, '../..');
const MANIFEST_FILE = path.resolve(ROOT_DIR, 'public/static/rimg/manifest.json');

const CATEGORY_FALLBACK_IMAGES = {
    'routers': '/static/images/prod-router4g.jpg',
    'switches': '/static/images/prod-switch8.jpg',
    'amad-racks': '/static/images/prod-rack.jpg',
    'wall-racks': '/static/images/prod-rack.jpg',
    'standing-racks': '/static/images/prod-rack.jpg',
    'rack-accessories': '/static/images/prod-patchpanel.jpg',
    'passive': '/static/images/prod-cat6.jpg',
    'ebox': '/static/images/prod-cambox.jpg',
    'adapters': '/static/images/prod-adapter.jpg',
};

/**
 * Verify whether a local /static/* or /uploads/* raster image actually exists on disk
 * (checks public/, persistent uploads/ volume, and responsive rimg variants).
 */
export function localImageExists(src) {
    const clean = normalize(src);
    if (!clean)
        return false;
    if (/^https?:\/\//i.test(clean))
        return true;
    if (/\.svg$/i.test(clean))
        return false; // crawlers like Torob require raster (JPG/PNG/WebP), not SVG
    if (clean.startsWith('/static/uploads/') || clean.startsWith('/uploads/')) {
        const fname = path.basename(clean);
        if (fs.existsSync(path.join(ROOT_DIR, 'public/static/uploads', fname)))
            return true;
        if (fs.existsSync(path.join(ROOT_DIR, 'uploads', fname)))
            return true;
        try {
            const row = db.prepare('SELECT size FROM uploaded_files WHERE fname = ?').get(fname);
            if (row && Number(row.size) > 200)
                return true;
        } catch { /* ignore */ }
    }
    else if (clean.startsWith('/static/')) {
        if (fs.existsSync(path.join(ROOT_DIR, 'public', clean.replace(/^\//, ''))))
            return true;
    }
    // Also check if a pre-built responsive WebP variant exists on disk
    const e = imgEntry(clean);
    if (e) {
        const best = bestUrl(clean, 1600);
        if (best && fs.existsSync(path.join(ROOT_DIR, 'public', best.replace(/^\//, ''))))
            return true;
    }
    return false;
}

/**
 * Resolve a guaranteed-existing raster image path for a product (for Torob / OG / JSON-LD).
 * Priority: main image -> gallery images -> category image -> high-res category/brand fallback -> og-logo.png.
 */
export function resolveProductImage(product, galleryList = []) {
    const candidates = [];
    if (product && product.image)
        candidates.push(product.image);
    if (Array.isArray(galleryList)) {
        for (const g of galleryList) {
            if (g)
                candidates.push(g);
        }
    }
    for (const c of candidates) {
        if (localImageExists(c))
            return normalize(c);
    }
    if (product && product.category_slug && CATEGORY_FALLBACK_IMAGES[product.category_slug]) {
        const cf = CATEGORY_FALLBACK_IMAGES[product.category_slug];
        if (localImageExists(cf))
            return cf;
    }
    if (product && product.category_image && localImageExists(product.category_image)) {
        return normalize(product.category_image);
    }
    return '/static/images/og-logo.png';
}

let MANIFEST = {};
let MANIFEST_OK = false;

export function loadImageManifest() {
    try {
        MANIFEST = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
        MANIFEST_OK = true;
    }
    catch (e) {
        MANIFEST = {};
        MANIFEST_OK = false;
    }
    return MANIFEST_OK;
}
loadImageManifest();

export function imageManifestReady() { return MANIFEST_OK; }
export function imageManifestSize() { return Object.keys(MANIFEST).length; }

function attrEsc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Strip query-string / hash so `/x.jpg?v=2` still matches the manifest. */
function normalize(src) {
    if (!src) return '';
    let s = String(src).trim();
    const q = s.indexOf('?');
    if (q !== -1) s = s.slice(0, q);
    const h = s.indexOf('#');
    if (h !== -1) s = s.slice(0, h);
    return s;
}

/** Manifest record for a URL, only when real WebP variants exist. */
export function imgEntry(src) {
    const e = MANIFEST[normalize(src)];
    return (e && e.v && Object.keys(e.v).length) ? e : null;
}

function widthsOf(entry) {
    return Object.keys(entry.v).map(Number).filter(n => n > 0).sort((a, b) => a - b);
}

/** `"/a-320.webp 320w, /a-640.webp 640w, ..."` */
export function srcsetOf(entry) {
    return widthsOf(entry).map(w => `${entry.v[String(w)].u} ${w}w`).join(', ');
}

/**
 * Best single WebP URL at (or just above) a target CSS width.
 * Used for CSS background-image / og:image where srcset is unavailable.
 * Falls back to the original URL when nothing was generated.
 */
export function bestUrl(src, targetWidth = 1280) {
    const e = imgEntry(src);
    if (!e) return src || '';
    const ws = widthsOf(e);
    const pick = ws.find(w => w >= targetWidth) ?? ws[ws.length - 1];
    return e.v[String(pick)].u;
}

/** Intrinsic dimensions of the original, or null. */
export function imgSize(src) {
    const e = MANIFEST[normalize(src)];
    return (e && e.w && e.h) ? { w: e.w, h: e.h } : null;
}

/**
 * Build a responsive <img> tag.
 *
 * @param {string} src   original URL (e.g. /static/uploads/u-123.jpg)
 * @param {object} opts
 *   alt          {string}  alt text (already raw, escaped here)
 *   sizes        {string}  the `sizes` attribute (default '100vw')
 *   cls          {string}  class attribute
 *   id           {string}  id attribute
 *   lcp          {bool}    true -> eager + fetchpriority=high + no lazy
 *   loading      {string}  override ('lazy' | 'eager')
 *   fetchpriority{string}  override
 *   ratio        {bool}    emit width/height (default true)
 *   maxWidth     {number}  cap the `src` fallback variant width
 *   attrs        {string}  extra raw attributes appended verbatim
 */
export function ncImg(src, opts = {}) {
    const url = normalize(src);
    if (!url) return '';
    const {
        alt = '', sizes = '100vw', cls = '', id = '',
        lcp = false, ratio = true, attrs = '', style = '',
    } = opts;

    const loading = opts.loading || (lcp ? 'eager' : 'lazy');
    const fetchpriority = opts.fetchpriority || (lcp ? 'high' : '');
    const e = imgEntry(url);

    let out = '<img';
    if (id) out += ` id="${attrEsc(id)}"`;
    if (cls) out += ` class="${attrEsc(cls)}"`;
    out += ` src="${attrEsc(url)}"`;
    if (e && localImageExists(url)) {
        out += ` srcset="${attrEsc(srcsetOf(e))}"`;
        out += ` sizes="${attrEsc(sizes)}"`;
        if (ratio && e.w && e.h) out += ` width="${e.w}" height="${e.h}"`;
    }
    out += ` alt="${attrEsc(alt)}"`;
    out += ` loading="${attrEsc(loading)}" decoding="${lcp ? 'sync' : 'async'}"`;
    if (fetchpriority) out += ` fetchpriority="${attrEsc(fetchpriority)}"`;
    if (style) out += ` style="${attrEsc(style)}"`;
    if (!/\bonerror\s*=/i.test(attrs)) {
        const fb = opts.fallback || '/static/images/p1.svg';
        if (url !== fb) out += ` onerror="this.onerror=null;this.removeAttribute('srcset');this.src='${attrEsc(fb)}'"`;
    }
    if (attrs) out += ' ' + attrs;
    out += '>';
    return out;
}

/**
 * <link rel="preload" as="image"> for the LCP candidate so the browser
 * starts the download during HTML parsing instead of after CSS+JS.
 */
export function imgPreload(src, sizes = '100vw') {
    const url = normalize(src);
    if (!url) return '';
    const e = imgEntry(url);
    if (!e) {
        return `<link rel="preload" as="image" href="${attrEsc(url)}" fetchpriority="high">`;
    }
    return `<link rel="preload" as="image" href="${attrEsc(bestUrl(url, 1280))}"`
        + ` imagesrcset="${attrEsc(srcsetOf(e))}" imagesizes="${attrEsc(sizes)}" fetchpriority="high">`;
}

export default { ncImg, imgPreload, bestUrl, imgEntry, imgSize, srcsetOf, loadImageManifest, localImageExists, resolveProductImage };
