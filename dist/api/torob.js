import { Hono } from 'hono';
import crypto from 'node:crypto';
import db from '../db/index.js';
import { getAllSettings, resolveSiteBaseUrl, requestOriginFromHono } from '../utils/helpers.js';
import { catVisSql } from '../utils/catvis.js';
import { computeTorobProductData, findActiveProductBySlug } from '../utils/torob.js';
import { adminRequired } from '../middleware/auth.js';

const torobApi = new Hono();

/**
 * Official Torob Ed25519 Public Key (from github.com/torob/Torob-Sync/torob_api_token_guide.md)
 */
const DEFAULT_TOROB_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAt6Mu4T0pBORY11W+QeM35UsmLO3vsf+6yKpFDEImFk0=
-----END PUBLIC KEY-----`;

const PAGE_SIZE = 100;

// Keep recent Torob API request logs in memory (and DB if table exists) for instant admin diagnostics
const recentTorobLogs = [];
function recordTorobLog(entry) {
    recentTorobLogs.unshift({ ...entry, time: new Date().toISOString() });
    if (recentTorobLogs.length > 50)
        recentTorobLogs.length = 50;
}

function getTorobPublicKey(settings) {
    const custom = String((settings && settings.torob_public_key) || '').trim();
    if (custom) {
        const pem = custom.includes('BEGIN PUBLIC KEY')
            ? custom
            : `-----BEGIN PUBLIC KEY-----\n${custom}\n-----END PUBLIC KEY-----`;
        try {
            return crypto.createPublicKey(pem);
        }
        catch { /* fall back to default */ }
    }
    return crypto.createPublicKey(DEFAULT_TOROB_PUBLIC_KEY_PEM);
}

/**
 * Verify EdDSA (Ed25519) JWT sent in `X-Torob-Token`.
 * Validates signature, `alg === 'EdDSA'`, `exp`, `nbf`, and `aud` matching site hostname.
 */
export function verifyTorobJwt(token, expectedHost, settings) {
    if (!token || typeof token !== 'string')
        return { ok: false, error: 'Missing X-Torob-Token header' };
    const parts = token.trim().split('.');
    if (parts.length !== 3)
        return { ok: false, error: 'Malformed JWT token' };
    let header, payload, signature;
    try {
        header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
        payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        signature = Buffer.from(parts[2], 'base64url');
    }
    catch {
        return { ok: false, error: 'Invalid base64url JWT encoding' };
    }
    if (!header || header.alg !== 'EdDSA')
        return { ok: false, error: 'Unsupported JWT algorithm (expected EdDSA)' };

    const pubKey = getTorobPublicKey(settings);
    const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8');
    let sigValid = false;
    try {
        sigValid = crypto.verify(null, signingInput, pubKey, signature);
    }
    catch {
        sigValid = false;
    }
    if (!sigValid)
        return { ok: false, error: 'Invalid JWT signature' };

    const now = Math.floor(Date.now() / 1000);
    const skew = 60; // 60s clock skew tolerance
    if (typeof payload.exp !== 'number' || now > payload.exp + skew)
        return { ok: false, error: 'JWT token expired' };
    if (typeof payload.nbf === 'number' && now + skew < payload.nbf)
        return { ok: false, error: 'JWT token not active yet (nbf)' };

    // Validate `aud` claim against request Host or configured domain
    const allowedAuds = new Set();
    if (expectedHost) {
        allowedAuds.add(String(expectedHost).toLowerCase());
        allowedAuds.add(String(expectedHost).toLowerCase().replace(/^www\./, ''));
    }
    const cfgBase = resolveSiteBaseUrl(settings, '');
    try {
        const u = new URL(cfgBase);
        allowedAuds.add(u.host.toLowerCase());
        allowedAuds.add(u.hostname.toLowerCase());
        allowedAuds.add(u.hostname.toLowerCase().replace(/^www\./, ''));
    }
    catch { /* ignore */ }

    const audClaim = Array.isArray(payload.aud) ? payload.aud.map(x => String(x).toLowerCase()) : [String(payload.aud || '').toLowerCase()];
    const audOk = audClaim.some(a => a && (allowedAuds.has(a) || allowedAuds.has(a.replace(/^www\./, ''))));
    if (!audOk)
        return { ok: false, error: `JWT audience mismatch (got ${payload.aud})` };

    return { ok: true, payload };
}

function formatProductForTorobApiV3(row, settings, reqOrigin) {
    const td = computeTorobProductData(row, { settings, reqOrigin });
    const item = {
        page_unique: td.productId,
        page_url: td.pageUrl,
        title: td.name.slice(0, 500),
        current_price: td.currentPriceToman,
        availability: td.isAvailable,
        image_links: td.imageLinksAbs.slice(0, 10),
        spec: td.spec,
        date_added: td.dateAddedIso,
        date_updated: td.dateUpdatedIso,
    };
    if (td.hasDiscount && td.oldPriceToman > td.currentPriceToman) {
        item.old_price = td.oldPriceToman;
    }
    if (td.categoryName) {
        item.category_name = td.categoryName.slice(0, 200);
    }
    if (td.shortDesc) {
        item.short_desc = td.shortDesc.slice(0, 500);
    }
    if (td.guarantee) {
        item.guarantee = td.guarantee.slice(0, 200);
    }
    return item;
}

function extractSlugOrIdFromPageUrl(rawUrl) {
    const str = String(rawUrl || '').trim();
    let pathname = str;
    try { pathname = new URL(str).pathname; } catch { /* keep str */ }
    const mp = pathname.match(/\/product\/([^/?#]+)/i);
    if (mp && mp[1]) {
        try { return { slug: decodeURIComponent(mp[1]) }; } catch { return { slug: mp[1] }; }
    }
    const mid = pathname.match(/\/p\/(\d+)(?:[/?#]|$)/i);
    if (mid && mid[1]) {
        return { id: parseInt(mid[1], 10) };
    }
    return null;
}

/**
 * POST /products — Official Torob Product API v3 handler
 * Mounted at `/torob_api/v3` and `/api/torob/v3`
 */
torobApi.get('/products', (c) => {
    const settings = getAllSettings();
    const baseUrl = resolveSiteBaseUrl(settings, requestOriginFromHono(c));
    c.header('Cache-Control', 'no-store');
    return c.json({
        status: 'ok',
        api_version: 'torob_api_v3',
        endpoint: `${baseUrl}/torob_api/v3/products`,
        method_required: 'POST',
        jwt_verification: String(settings.torob_require_jwt || 'فعال') !== 'غیرفعال',
        message: 'وب‌سرویس رسمی ترب (Torob Product API v3) فعال است. درخواست‌های همگام‌سازی باید با متد POST ارسال شوند.'
    }, 200);
});

torobApi.post('/products', async (c) => {
    const settings = getAllSettings();
    const reqOrigin = requestOriginFromHono(c);
    const xfHost = String(c.req.header('x-forwarded-host') || '').split(',')[0].trim();
    const reqHost = xfHost || String(c.req.header('host') || '').trim();

    // Require JWT verification unless admin explicitly sets `torob_require_jwt` = 'غیرفعال' for testing
    const requireJwt = String(settings.torob_require_jwt || 'فعال') !== 'غیرفعال';
    if (requireJwt) {
        const token = c.req.header('x-torob-token') || '';
        const v = verifyTorobJwt(token, reqHost, settings);
        if (!v.ok) {
            recordTorobLog({ mode: 'auth_failed', status: 401, error: v.error });
            return c.json({ error: v.error }, 401);
        }
    }

    let body = null;
    try {
        body = await c.req.json();
    }
    catch {
        recordTorobLog({ mode: 'bad_json', status: 400, error: 'Invalid JSON body' });
        return c.json({ error: 'Invalid JSON body' }, 400);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
        recordTorobLog({ mode: 'empty_body', status: 400, error: 'Request body must not be empty' });
        return c.json({ error: 'Request body must not be empty' }, 400);
    }

    const visClause = catVisSql('p.category_id');
    const baseSelect = `SELECT p.*, c.name AS category_name, c.slug AS category_slug, b.name AS brand_name, b.slug AS brand_slug
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN brands b ON p.brand_id = b.id`;

    // Option 1: Fetch products by page_urls
    if ('page_urls' in body) {
        if (!Array.isArray(body.page_urls) || body.page_urls.length === 0) {
            return c.json({ error: 'page_urls must be a non-empty array' }, 400);
        }
        const items = [];
        const seenIds = new Set();
        for (const u of body.page_urls.slice(0, 200)) {
            const parsed = extractSlugOrIdFromPageUrl(u);
            if (!parsed)
                continue;
            const row = parsed.id
                ? db.prepare(`${baseSelect} WHERE p.id = ? AND p.status = 'active'${visClause}`).get(parsed.id)
                : findActiveProductBySlug(parsed.slug, visClause);
            if (row && !seenIds.has(row.id)) {
                seenIds.add(row.id);
                items.push(formatProductForTorobApiV3(row, settings, reqOrigin));
            }
        }
        recordTorobLog({ mode: 'page_urls', count: items.length, status: 200 });
        c.header('Cache-Control', 'no-store');
        return c.json({
            api_version: 'torob_api_v3',
            current_page: 1,
            total: items.length,
            max_pages: 1,
            products: items,
        }, 200);
    }

    // Option 2: Fetch products by page_uniques
    if ('page_uniques' in body) {
        if (!Array.isArray(body.page_uniques) || body.page_uniques.length === 0) {
            return c.json({ error: 'page_uniques must be a non-empty array' }, 400);
        }
        const ids = body.page_uniques
            .slice(0, 200)
            .map(x => parseInt(String(x).trim(), 10))
            .filter(n => Number.isFinite(n) && n > 0);
        let items = [];
        if (ids.length) {
            const rows = db.prepare(`${baseSelect} WHERE p.id IN (${ids.map(() => '?').join(',')}) AND p.status = 'active'${visClause}`).all(...ids);
            const byId = new Map(rows.map(r => [Number(r.id), r]));
            const ordered = [];
            const seen = new Set();
            for (const id of ids) {
                if (seen.has(id))
                    continue;
                seen.add(id);
                const r = byId.get(id);
                if (r)
                    ordered.push(formatProductForTorobApiV3(r, settings, reqOrigin));
            }
            items = ordered;
        }
        recordTorobLog({ mode: 'page_uniques', count: items.length, status: 200 });
        c.header('Cache-Control', 'no-store');
        return c.json({
            api_version: 'torob_api_v3',
            current_page: 1,
            total: items.length,
            max_pages: 1,
            products: items,
        }, 200);
    }

    // Validate `sort` parameter (mandatory for both page and cursor pagination per Torob spec)
    const sort = body.sort;
    if (!sort || typeof sort !== 'string') {
        recordTorobLog({ mode: 'missing_sort', status: 400, error: 'sort parameter is not provided' });
        return c.json({ error: 'sort parameter is not provided' }, 400);
    }
    const ORDER_MAP = {
        date_added_desc: 'p.created_at DESC, p.id DESC',
        date_updated_desc: 'p.updated_at DESC, p.id DESC',
        product_id_desc: 'p.id DESC',
    };
    if (!(sort in ORDER_MAP)) {
        return c.json({ error: 'Invalid sort parameter' }, 400);
    }

    // Option 4: Cursor pagination (`sort === 'product_id_desc'` without `page`)
    if (!('page' in body)) {
        if (sort !== 'product_id_desc') {
            return c.json({ error: 'page parameter is required for non-cursor sort' }, 400);
        }
        if ('limit' in body || 'size' in body) {
            return c.json({ error: 'limit and size are not allowed in cursor pagination' }, 400);
        }
        let cursorId = null;
        if ('cursor' in body && body.cursor !== null && body.cursor !== undefined && body.cursor !== '') {
            cursorId = parseInt(String(body.cursor), 10);
            if (!Number.isFinite(cursorId) || cursorId < 1) {
                return c.json({ error: 'Invalid cursor value' }, 400);
            }
        }
        const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE p.status = 'active'${visClause}`).get().n) || 0;
        const whereCursor = cursorId ? ` AND p.id < ?` : '';
        const params = cursorId ? [cursorId, PAGE_SIZE + 1] : [PAGE_SIZE + 1];
        const rows = db.prepare(`${baseSelect} WHERE p.status = 'active'${visClause}${whereCursor} ORDER BY p.id DESC LIMIT ?`).all(...params);
        const hasMore = rows.length > PAGE_SIZE;
        const slice = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
        const nextCursor = hasMore && slice.length ? String(slice[slice.length - 1].id) : null;
        const items = slice.map(r => formatProductForTorobApiV3(r, settings, reqOrigin));
        recordTorobLog({ mode: 'cursor', cursor: cursorId, count: items.length, status: 200 });
        c.header('Cache-Control', 'no-store');
        return c.json({
            api_version: 'torob_api_v3',
            total,
            max_pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
            next_cursor: nextCursor,
            products: items,
        }, 200);
    }

    // Option 3: Page-based pagination (`page` >= 1 + `sort`)
    const page = Number(body.page);
    if (!Number.isInteger(page) || page < 1) {
        return c.json({ error: 'page must be a positive integer starting from 1' }, 400);
    }
    const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM products p WHERE p.status = 'active'${visClause}`).get().n) || 0;
    const maxPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const offset = (page - 1) * PAGE_SIZE;
    const rows = offset < total
        ? db.prepare(`${baseSelect} WHERE p.status = 'active'${visClause} ORDER BY ${ORDER_MAP[sort]} LIMIT ? OFFSET ?`).all(PAGE_SIZE, offset)
        : [];
    const items = rows.map(r => formatProductForTorobApiV3(r, settings, reqOrigin));
    recordTorobLog({ mode: 'page', page, sort, count: items.length, status: 200 });
    c.header('Cache-Control', 'no-store');
    return c.json({
        api_version: 'torob_api_v3',
        current_page: page,
        total,
        max_pages: maxPages,
        next_cursor: null,
        products: items,
    }, 200);
});

/**
 * Admin diagnostic endpoint: checks every active product for Torob readiness
 * (product_id, valid price, stock status, local image file existence, canonical domain)
 */
torobApi.get('/admin/diagnostics', adminRequired, (c) => {
    const settings = getAllSettings();
    const reqOrigin = requestOriginFromHono(c);
    const baseUrl = resolveSiteBaseUrl(settings, reqOrigin);
    const visClause = catVisSql('p.category_id');
    const rows = db.prepare(`SELECT p.*, c.name AS category_name, b.name AS brand_name
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN brands b ON p.brand_id = b.id
        WHERE p.status = 'active'${visClause}
        ORDER BY p.id DESC`).all();

    let readyInStock = 0;
    let outOfStock = 0;
    let missingImageFallbackUsed = 0;
    let askPriceCount = 0;
    const issues = [];

    for (const r of rows) {
        const td = computeTorobProductData(r, { settings, reqOrigin });
        if (td.isAvailable)
            readyInStock++;
        else
            outOfStock++;
        if (!td.hasValidPrice) {
            askPriceCount++;
            issues.push({ id: r.id, name: r.name, slug: r.slug, type: 'price', msg: Number(r.price) === 0 ? 'استعلام قیمت (در ترب ناموجود رد می‌شود)' : `قیمت زیر ۱٬۰۰۰ تومان (${r.price})` });
        }
        if (!td.hasOriginalMainImage) {
            missingImageFallbackUsed++;
            issues.push({ id: r.id, name: r.name, slug: r.slug, type: 'image', msg: `فایل تصویر اصلی یافت نشد (${r.image || 'خالی'}) — تصویر جایگزین معتبر قرار گرفت` });
        }
    }

    const sampleRow = rows[0] || null;
    const sampleMeta = sampleRow ? computeTorobProductData(sampleRow, { settings, reqOrigin }) : null;

    return c.json({
        success: true,
        data: {
            baseUrl,
            torobApiEndpoint: `${baseUrl}/torob_api/v3/products`,
            requireJwt: String(settings.torob_require_jwt || 'فعال') !== 'غیرفعال',
            totalActive: rows.length,
            readyInStock,
            outOfStock,
            askPriceCount,
            missingImageFallbackUsed,
            sampleProduct: sampleMeta,
            issues: issues.slice(0, 100),
            recentLogs: recentTorobLogs.slice(0, 20),
        },
        code: 200,
    });
});

export default torobApi;
