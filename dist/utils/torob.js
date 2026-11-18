import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db/index.js';
import { getAllSettings, resolveSiteBaseUrl, toAbsoluteUrl } from './helpers.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const PUBLIC_STATIC_UPLOADS = path.join(ROOT, 'public', 'static', 'uploads');
const PERSISTENT_UPLOADS = path.join(ROOT, 'uploads');

/**
 * Default raster fallback image for crawlers (Torob / Google / Telegram / WhatsApp).
 * Never use .svg for Torob or OpenGraph because crawlers require JPEG/PNG/WebP.
 */
export const DEFAULT_RASTER_PRODUCT_IMAGE = '/static/images/og-logo.png';

/**
 * Category-aware high-resolution raster fallback map when a product has no local image file.
 */
const CATEGORY_FALLBACK_IMAGES = [
    { match: /سوئیچ|سوییچ|switch/i, img: '/static/images/prod-switch8.jpg' },
    { match: /روتر|مودم|router|modem|lte/i, img: '/static/images/prod-router4g.jpg' },
    { match: /رک|rack/i, img: '/static/images/prod-rack.jpg' },
    { match: /پچ\s*پنل|patch\s*panel/i, img: '/static/images/prod-patchpanel.jpg' },
    { match: /کابل|پچ\s*کورد|فیبر|کیستون|پسیو|cable|fiber|patch/i, img: '/static/images/prod-cat6.jpg' },
    { match: /آداپتور|اداپتور|پاور|برق|adapter|power/i, img: '/static/images/prod-adapter.jpg' },
    { match: /باکس|کم\s*باکس|box/i, img: '/static/images/prod-cambox.jpg' },
    { match: /چسب|تولز|ابزار/i, img: '/static/images/prod-tape.jpg' },
];

/**
 * Check if a local image URL actually exists on disk (either in public/... or ./uploads/...).
 * External http(s) URLs are assumed valid unless pointing to localhost/raw IP.
 */
export function localImageFilePath(urlOrPath) {
    const raw = String(urlOrPath || '').trim().split('?')[0].split('#')[0];
    if (!raw || /^https?:\/\//i.test(raw))
        return null;
    if (raw.startsWith('/static/uploads/')) {
        const fname = path.basename(raw);
        const p1 = path.join(PUBLIC_STATIC_UPLOADS, fname);
        if (fs.existsSync(p1))
            return p1;
        const p2 = path.join(PERSISTENT_UPLOADS, fname);
        if (fs.existsSync(p2))
            return p2;
        return null;
    }
    if (raw.startsWith('/uploads/')) {
        const fname = path.basename(raw);
        const p1 = path.join(PERSISTENT_UPLOADS, fname);
        if (fs.existsSync(p1))
            return p1;
        const p2 = path.join(PUBLIC_STATIC_UPLOADS, fname);
        if (fs.existsSync(p2))
            return p2;
        return null;
    }
    if (raw.startsWith('/static/')) {
        const p = path.join(ROOT, 'public', raw.replace(/^\//, ''));
        return fs.existsSync(p) ? p : null;
    }
    return null;
}

export function isValidRasterImageUrl(urlOrPath) {
    const raw = String(urlOrPath || '').trim();
    if (!raw)
        return false;
    const clean = raw.split('?')[0].split('#')[0];
    if (/\.svg$/i.test(clean))
        return false;
    if (/^https?:\/\//i.test(clean))
        return true;
    const fp = localImageFilePath(clean);
    if (!fp)
        return false;
    try {
        const st = fs.statSync(fp);
        // Reject tiny 70-byte placeholder files left over from early dev seeds
        return st.isFile() && st.size > 200;
    }
    catch {
        return false;
    }
}

/**
 * Sync images between `./uploads` (Docker persistent volume) and `./public/static/uploads`
 * on server startup so container rebuilds NEVER cause 404 errors on newly uploaded product images!
 */
export function syncPersistentUploads() {
    try {
        fs.mkdirSync(PUBLIC_STATIC_UPLOADS, { recursive: true });
        fs.mkdirSync(PERSISTENT_UPLOADS, { recursive: true });
        let restoredToStatic = 0;
        let backedUpToPersistent = 0;
        for (const f of fs.readdirSync(PERSISTENT_UPLOADS)) {
            if (!/\.(jpe?g|png|webp|gif)$/i.test(f))
                continue;
            const src = path.join(PERSISTENT_UPLOADS, f);
            const dst = path.join(PUBLIC_STATIC_UPLOADS, f);
            if (!fs.existsSync(dst)) {
                fs.copyFileSync(src, dst);
                restoredToStatic++;
            }
        }
        for (const f of fs.readdirSync(PUBLIC_STATIC_UPLOADS)) {
            if (!/\.(jpe?g|png|webp|gif)$/i.test(f))
                continue;
            const src = path.join(PUBLIC_STATIC_UPLOADS, f);
            const dst = path.join(PERSISTENT_UPLOADS, f);
            if (!fs.existsSync(dst)) {
                fs.copyFileSync(src, dst);
                backedUpToPersistent++;
            }
        }
        if (restoredToStatic > 0 || backedUpToPersistent > 0) {
            console.log(`[uploads-sync] restored=${restoredToStatic} to /static/uploads, backedUp=${backedUpToPersistent} to ./uploads`);
        }
    }
    catch (e) {
        console.error('[uploads-sync] warning:', e.message);
    }
}

/**
 * Save an uploaded image buffer to BOTH `public/static/uploads` AND `./uploads` (persistent volume).
 */
export function writeUploadedImageBothDirs(fname, buffer) {
    fs.mkdirSync(PUBLIC_STATIC_UPLOADS, { recursive: true });
    fs.writeFileSync(path.join(PUBLIC_STATIC_UPLOADS, fname), buffer);
    try {
        fs.mkdirSync(PERSISTENT_UPLOADS, { recursive: true });
        fs.writeFileSync(path.join(PERSISTENT_UPLOADS, fname), buffer);
    }
    catch { /* ignore if secondary dir is read-only */ }
}

/**
 * Pick the best guaranteed-existing raster image path/URL for a product (and its gallery).
 */
export function resolveProductImages(product, settings = null) {
    let gallery = [];
    try {
        gallery = JSON.parse(product.gallery || '[]') || [];
    }
    catch {
        gallery = [];
    }
    const candidates = [product.image, ...gallery].map(x => String(x || '').trim()).filter(Boolean);
    const valid = [];
    for (const c of candidates) {
        if (isValidRasterImageUrl(c) && !valid.includes(c)) {
            valid.push(c);
        }
    }
    if (!valid.length) {
        const hint = `${product.name || ''} ${product.category_name || ''} ${product.slug || ''}`;
        const matched = CATEGORY_FALLBACK_IMAGES.find(x => x.match.test(hint));
        if (matched && isValidRasterImageUrl(matched.img)) {
            valid.push(matched.img);
        }
        else {
            const s = settings || getAllSettings();
            const ogCfg = s && s.og_image && isValidRasterImageUrl(s.og_image) ? s.og_image : DEFAULT_RASTER_PRODUCT_IMAGE;
            valid.push(ogCfg);
        }
    }
    return {
        mainImage: valid[0],
        allValidImages: valid,
        hasOriginalMainImage: !!(product.image && isValidRasterImageUrl(product.image)),
    };
}

/**
 * Extract product guarantee from `product.guarantee` column OR from `product.specs` JSON
 * (mirrors Torob's official WooCommerce plugin guarantee extraction logic).
 */
export function extractProductGuarantee(product) {
    const direct = String(product.guarantee || '').trim();
    if (direct)
        return direct.slice(0, 200);
    let specs = [];
    try {
        specs = JSON.parse(product.specs || '[]') || [];
    }
    catch {
        specs = [];
    }
    const keys = new Set(['گارانتی', 'گارانتی:', 'گارانتی محصول', 'گارانتی محصول:', 'ضمانت', 'ضمانت:', 'guarantee', 'warranty', 'garanty']);
    for (const row of specs) {
        if (!row || typeof row !== 'object')
            continue;
        const k = String(row.key || '').trim().toLowerCase();
        const v = String(row.value || '').trim();
        if (v && keys.has(k))
            return v.slice(0, 200);
    }
    return 'گارانتی اصالت و سلامت فیزیکی کالا';
}

/**
 * Convert specs array `[{group, key, value}]` into flat key-value dictionary for Torob API v3.
 */
export function extractProductSpecDict(product) {
    const out = {};
    let specs = [];
    try {
        specs = JSON.parse(product.specs || '[]') || [];
    }
    catch {
        specs = [];
    }
    for (const row of specs) {
        if (!row || typeof row !== 'object')
            continue;
        const k = String(row.key || '').trim();
        const v = String(row.value || '').trim();
        if (k && v && !(k in out)) {
            out[k] = v;
        }
    }
    if (product.sku && !('شناسه کالا' in out)) {
        out['شناسه کالا'] = String(product.sku).trim();
    }
    if (product.brand_name && !('برند' in out)) {
        out['برند'] = String(product.brand_name).trim();
    }
    return out;
}

/**
 * Compute exact Torob pricing & availability for a product (single source of truth
 * shared between SSR HTML meta tags, OpenGraph, Schema.org JSON-LD, and Torob API v3).
 *
 * Rules:
 * - Prices in the DB (`price`, `discount_price`) are stored in Toman (integer).
 * - Suspicious prices (0 or < 1000 Toman, e.g. "استعلام قیمت" or accidental "5" instead of "5,000,000"):
 *   Torob strictly forbids "free" or "call for price" items from being marked available (`instock`).
 *   If `effectivePrice < 1000`, `isPurchasable` is `false`, `availability` becomes `outofstock` / `false`,
 *   and `currentPrice` is reported as `0` so Torob never displays a false 5-Toman or free product!
 */
export function computeTorobProductData(product, opts = {}) {
    const settings = opts.settings || getAllSettings();
    const baseUrl = resolveSiteBaseUrl(settings, opts.reqOrigin || '');
    const rawPrice = Math.max(0, Math.round(Number(product.price) || 0));
    const rawDiscount = (product.discount_price !== null && product.discount_price !== undefined && product.discount_price !== '')
        ? Math.max(0, Math.round(Number(product.discount_price) || 0))
        : 0;
    const hasValidDiscount = rawDiscount > 0 && rawDiscount < rawPrice;
    const effectivePrice = hasValidDiscount ? rawDiscount : rawPrice;
    const stock = Math.max(0, Math.round(Number(product.stock) || 0));

    // Products with price == 0 («استعلام قیمت») or accidental < 1000 Toman typos must NOT be instock on Torob
    const hasValidPrice = effectivePrice >= 1000;
    const isAvailable = product.status === 'active' && stock > 0 && hasValidPrice;

    const currentPriceToman = isAvailable ? effectivePrice : (hasValidPrice ? effectivePrice : 0);
    const oldPriceToman = (hasValidPrice && hasValidDiscount) ? rawPrice : currentPriceToman;

    const { mainImage, allValidImages, hasOriginalMainImage } = resolveProductImages(product, settings);
    const absMainImage = toAbsoluteUrl(mainImage, baseUrl);
    const absImages = allValidImages.map(img => toAbsoluteUrl(img, baseUrl));
    // Encode non-ASCII slug segments cleanly for canonical / page_url
    const encodedSlug = encodeURIComponent(String(product.slug || '')).replace(/%2F/gi, '/');
    const pageUrl = `${baseUrl}/product/${encodedSlug}`;
    const guarantee = extractProductGuarantee(product);

    return {
        productId: String(product.id),
        sku: product.sku ? String(product.sku).trim() : '',
        name: String(product.name || '').trim(),
        pageUrl,
        canonicalUrl: pageUrl,
        currentPriceToman,
        oldPriceToman,
        hasDiscount: hasValidPrice && hasValidDiscount,
        isAvailable,
        availabilityMeta: isAvailable ? 'instock' : 'outofstock',
        guarantee,
        mainImageRel: mainImage,
        mainImageAbs: absMainImage,
        imageLinksAbs: absImages,
        hasOriginalMainImage,
        hasValidPrice,
        stock,
        categoryName: String(product.category_name || '').trim(),
        brandName: String(product.brand_name || '').trim(),
        shortDesc: String(product.short_description || product.seo_description || '').replace(/\s+/g, ' ').trim().slice(0, 500),
        spec: extractProductSpecDict(product),
        dateAddedIso: toTehranIso(product.created_at),
        dateUpdatedIso: toTehranIso(product.updated_at || product.created_at),
    };
}

export function toTehranIso(dt) {
    if (!dt)
        return new Date().toISOString();
    const s = String(dt).trim();
    // SQLite / MySQL DATETIME strings like "2026-10-08 09:30:40"
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) {
        return s.replace(' ', 'T') + '+03:30';
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/**
 * Render all HTML `<meta>` tags required by Torob's HTML crawler + Emalls + OpenGraph Product.
 * Placed directly inside `<head>` on every `/product/:slug` server-rendered response.
 */
export function renderTorobMetaTags(torobData) {
    const esc = (s) => String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const lines = [
        `<!-- Torob & Price Comparison Product Meta Tags -->`,
        `<meta name="product_id" content="${esc(torobData.productId)}">`,
        `<meta name="product_name" content="${esc(torobData.name)}">`,
        `<meta name="product_price" content="${esc(torobData.currentPriceToman)}">`,
        `<meta name="product_old_price" content="${esc(torobData.oldPriceToman)}">`,
        `<meta name="availability" content="${esc(torobData.availabilityMeta)}">`,
    ];
    if (torobData.guarantee) {
        lines.push(`<meta name="guarantee" content="${esc(torobData.guarantee)}">`);
    }
    // OpenGraph Product standard tags (used as secondary signal by Torob, Emalls, Google, Telegram)
    lines.push(`<meta property="product:price:amount" content="${esc(torobData.currentPriceToman)}">`);
    lines.push(`<meta property="product:price:currency" content="IRT">`);
    lines.push(`<meta property="product:availability" content="${torobData.isAvailable ? 'in stock' : 'out of stock'}">`);
    if (torobData.brandName) {
        lines.push(`<meta property="product:brand" content="${esc(torobData.brandName)}">`);
    }
    if (torobData.sku) {
        lines.push(`<meta property="product:retailer_item_id" content="${esc(torobData.sku)}">`);
    }
    return lines.join('\n');
}

/**
 * Flexible slug lookup: handles URL-encoded slugs, NFC/NFD Unicode differences,
 * and Arabic/Persian character variants (ک/ك, ی/ي, ۰-۹/0-9) so Torob crawler URLs never 404.
 */
export function findActiveProductBySlug(rawSlug, catVisClause = '') {
    let decoded = String(rawSlug || '').trim();
    try {
        decoded = decodeURIComponent(decoded);
    }
    catch { /* keep raw */ }
    decoded = decoded.replace(/^\/+|\/+$/g, '');
    if (!decoded)
        return null;

    const baseSql = `SELECT p.*, c.name AS category_name, c.slug AS category_slug, b.name AS brand_name, b.slug AS brand_slug, b.logo AS brand_logo
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN brands b ON p.brand_id = b.id
        WHERE p.slug = ? AND p.status = 'active'${catVisClause}`;

    let row = db.prepare(baseSql).get(decoded);
    if (row)
        return row;

    // Try NFC normalized form
    const nfc = decoded.normalize ? decoded.normalize('NFC') : decoded;
    if (nfc !== decoded) {
        row = db.prepare(baseSql).get(nfc);
        if (row)
            return row;
    }

    // Try Persian/Arabic character normalization & digit conversion
    const normSlug = (s) => String(s || '')
        .replace(/ي/g, 'ی').replace(/ئ/g, 'ی').replace(/ك/g, 'ک')
        .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .toLowerCase();

    const targetNorm = normSlug(nfc);
    const allSlugs = db.prepare(`SELECT id, slug FROM products WHERE status = 'active'${catVisClause}`).all();
    const matched = allSlugs.find(r => normSlug(r.slug) === targetNorm);
    if (matched) {
        return db.prepare(`SELECT p.*, c.name AS category_name, c.slug AS category_slug, b.name AS brand_name, b.slug AS brand_slug, b.logo AS brand_logo
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN brands b ON p.brand_id = b.id
            WHERE p.id = ?`).get(matched.id) || null;
    }
    return null;
}
