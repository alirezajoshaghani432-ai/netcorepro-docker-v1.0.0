// =====================================================================
//  Product Export / Import (2026-11-03, owner voice note)
//  «یه گزینه export که کل محصولات را خروجی بگیرد و یه گزینه که فایل
//   export (مثلاً از یک سایت دیگر) را بریزیم داخلش تا دونه‌دونه وارد نکنیم»
// ---------------------------------------------------------------------
//  GET  /api/product-io/export?format=json|csv   -> every product (active + inactive)
//  POST /api/product-io/import                   -> { rows, options, dry_run }
//
//  Import accepts rows already parsed in the browser (Excel / CSV / TSV /
//  JSON / pasted table — see the admin page). Column names are matched
//  loosely, so it understands:
//    • this site's own export (English keys or the Persian Excel headers)
//    • WooCommerce product CSV export (English or Persian WordPress)
//    • any simple table with columns like «نام، قیمت، موجودی، دسته، برند»
//  Matching an existing product: SKU -> slug -> exact name.
//  Existing products: only NON-EMPTY cells overwrite (nothing is wiped).
//  Every row is isolated: one bad row never stops the others.
// =====================================================================
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
const __PROJ_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import db from '../db/index.js';
import { adminRequired } from '../middleware/auth.js';
import { logActivity, friendlyDbError, resolveSiteBaseUrl, requestOriginFromHono } from '../utils/helpers.js';
import { generateVariantsFor } from '../utils/imggen.js';
import { saveUploadedImageHybrid } from '../utils/torob.js';

const io = new Hono();

// ---------------------------------------------------------------- helpers
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹', AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function enDigits(s) {
    return String(s ?? '').replace(/[۰-۹]/g, d => FA_DIGITS.indexOf(d)).replace(/[٠-٩]/g, d => AR_DIGITS.indexOf(d));
}
function str(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return ''; } }
    return String(v).trim();
}
/** "1,250,000 تومان" -> 1250000 ; "" -> null */
function num(v) {
    const s = enDigits(str(v)).replace(/[,٬،\s]/g, '').replace(/[^0-9.\-]/g, '');
    if (!s || s === '-' || s === '.') return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}
function normKey(k) {
    return enDigits(String(k || '')).toLowerCase()
        .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[\u200c\u200f\u200e]/g, '')
        .replace(/[\s_\-?:.()\[\]«»"']/g, '');
}
function slugify(s) {
    return enDigits(String(s || '')).trim().toLowerCase()
        .replace(/[\u064A]/g, '\u06CC').replace(/[\u0643]/g, '\u06A9')
        .replace(/[^0-9a-z\u0600-\u06FF\s-]/g, '')
        .replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '')
        .slice(0, 180);
}
/** WooCommerce descriptions are HTML; the site shows description as plain text. */
function htmlToText(s) {
    let t = str(s);
    if (!/[<&]/.test(t)) return t;
    t = t.replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, '\n')
        .replace(/<\s*li[^>]*>/gi, '• ')
        .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&zwnj;/g, '\u200c').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
        .replace(/&#(\d+);/g, (m, d) => { try { return String.fromCodePoint(+d); } catch { return ''; } });
    return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Column-name synonyms (normalized with normKey). Order inside a list = priority.
const FIELD_SYNONYMS = {
    name: ['name', 'نام', 'نامکالا', 'ناممحصول', 'عنوان', 'عنوانمحصول', 'title', 'productname', 'posttitle', 'product'],
    slug: ['slug', 'نامک', 'postname', 'urlkey', 'پیوند'],
    sku: ['sku', 'کدمحصول', 'شناسهمحصول', 'کدکالا', 'کد', 'code', 'productcode', 'partnumber', 'پارتنامبر'],
    price: ['price', 'regularprice', 'قیمتعادی', 'قیمت', 'قیمتاصلی', 'قیمتتومان', 'قیمتریال', 'قیمتفروش'],
    discount_price: ['discountprice', 'saleprice', 'قیمتفروشفوقالعاده', 'قیمتحراج', 'قیمتفروشویژه', 'قیمتویژه', 'قیمتتخفیف', 'قیمتباتخفیف', 'specialprice'],
    stock: ['stock', 'موجودی', 'stockquantity', 'quantity', 'qty', 'inventory', 'تعداد', 'موجودیانبار'],
    in_stock: ['instock', 'درانبار', 'موجوددرانبار', 'stockstatus', 'وضعیتموجودی'],
    category: ['category', 'categories', 'categorypath', 'دسته', 'دستهبندی', 'دستهها', 'دستهبندیها', 'گروه', 'گروهکالا'],
    brand: ['brand', 'brands', 'برند', 'برندها', 'نامتجاری', 'manufacturer', 'سازنده'],
    description: ['description', 'توضیحات', 'توضیح', 'postcontent', 'content', 'شرح', 'نقدوبررسی'],
    short_description: ['shortdescription', 'توضیحاتکوتاه', 'توضیحکوتاه', 'postexcerpt', 'excerpt', 'خلاصه'],
    image: ['image', 'images', 'تصویر', 'تصاویر', 'عکس', 'imageurl', 'تصویراصلی', 'mainimage', 'picture'],
    gallery: ['gallery', 'گالری', 'گالریتصاویر', 'galleryimages'],
    status: ['status', 'وضعیت', 'published', 'منتشرشده', 'poststatus', 'فعال'],
    featured: ['featured', 'isfeatured', 'ویژه', 'محصولویژه', 'آیامحصولویژهاست'],
    specs: ['specs', 'مشخصات', 'مشخصاتفنی'],
    key_features: ['keyfeatures', 'ویژگیها', 'ویژگیهایکلیدی'],
    guarantee: ['guarantee', 'warranty', 'گارانتی', 'ضمانت'],
    tax_percent: ['taxpercent', 'درصدمالیات', 'مالیات'],
    seo_title: ['seotitle', 'عنوانسئو', 'metatitle'],
    seo_description: ['seodescription', 'توضیحاتسئو', 'metadescription'],
    seo_keywords: ['seokeywords', 'کلماتکلیدی', 'metakeywords', 'tags', 'برچسبها'],
    sort_order: ['sortorder', 'ترتیب', 'position'],
    type: ['type', 'نوع'],
};
const KEY_TO_FIELD = (() => {
    const m = {};
    for (const [field, list] of Object.entries(FIELD_SYNONYMS))
        for (const k of list) if (!(k in m)) m[k] = field;
    return m;
})();
/** Map a raw parsed row (any headers) to our field names. */
function mapRow(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [k, v] of Object.entries(raw)) {
        const f = KEY_TO_FIELD[normKey(k)];
        if (!f) continue;
        if (out[f] === undefined || str(out[f]) === '') out[f] = v; // first non-empty wins
    }
    return out;
}
function parseStatus(v) {
    const s = normKey(str(v));
    if (!s) return null;
    if (['1', 'active', 'publish', 'published', 'فعال', 'منتشرشده', 'yes', 'true', 'بله'].includes(s)) return 'active';
    if (['0', '-1', 'inactive', 'draft', 'private', 'pending', 'غیرفعال', 'پیشنویس', 'no', 'false', 'خیر'].includes(s)) return 'inactive';
    return null;
}
function parseBool(v) {
    const s = normKey(str(v));
    if (!s) return null;
    if (['1', 'yes', 'true', 'بله', 'فعال', 'instock', 'موجود'].includes(s)) return 1;
    if (['0', 'no', 'false', 'خیر', 'غیرفعال', 'outofstock', 'ناموجود'].includes(s)) return 0;
    return null;
}
/** "a.jpg, b.jpg" | '["a","b"]' | array -> [urls] */
function listOfUrls(v) {
    if (Array.isArray(v)) return v.map(str).filter(Boolean);
    const s = str(v);
    if (!s) return [];
    if (s.startsWith('[')) { try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map(str).filter(Boolean); } catch { } }
    return s.split(/\s*[,|\n]\s*/).map(x => x.trim()).filter(Boolean);
}
/** first category path of a Woo cell: "A > B, C" -> ["A","B"] */
function categoryPath(v) {
    const s = str(v);
    if (!s) return [];
    const first = s.split(/\s*,\s*(?![^>]*>)/)[0] || s; // first path
    return first.split(/\s*(?:>|›|»|\/|\\)\s*/).map(x => x.trim()).filter(Boolean).slice(0, 4);
}
function jsonArrayOrNull(v) {
    if (v === undefined || v === null || v === '') return null;
    if (Array.isArray(v)) return JSON.stringify(v);
    const s = str(v);
    try { const a = JSON.parse(s); return Array.isArray(a) ? JSON.stringify(a) : null; } catch { }
    return null;
}
function featuresFrom(v) {
    const j = jsonArrayOrNull(v);
    if (j) return j;
    const s = str(v);
    if (!s) return null;
    const parts = s.split(/\s*[\n|؛;]\s*/).map(x => x.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean);
    return parts.length ? JSON.stringify(parts) : null;
}
function specsFrom(v) {
    const j = jsonArrayOrNull(v);
    if (j) return j;
    const s = str(v);
    if (!s) return null;
    // "کلید: مقدار | کلید: مقدار"
    const rows = s.split(/\s*[\n|؛;]\s*/).map(x => {
        const i = x.search(/[:：]/);
        return i > 0 ? { key: x.slice(0, i).trim(), value: x.slice(i + 1).trim() } : null;
    }).filter(r => r && r.key && r.value);
    return rows.length ? JSON.stringify(rows) : null;
}

// ---------------------------------------------------------------- export
function categoryPathMap() {
    const cats = db.prepare(`SELECT id, parent_id, name FROM categories`).all();
    const byId = Object.fromEntries(cats.map(c => [c.id, c]));
    const out = {};
    for (const c of cats) {
        const parts = []; let cur = c, guard = 0;
        while (cur && guard++ < 10) { parts.unshift(cur.name); cur = byId[cur.parent_id]; }
        out[c.id] = parts.join(' > ');
    }
    return out;
}
const EXPORT_COLS = ['sku', 'name', 'slug', 'category', 'brand', 'price', 'discount_price', 'stock', 'status', 'featured',
    'image', 'gallery', 'short_description', 'description', 'key_features', 'specs', 'guarantee', 'tax_percent',
    'seo_title', 'seo_description', 'seo_keywords', 'sort_order'];
function absUrl(base, u) {
    const s = str(u);
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    return base + (s.startsWith('/') ? s : '/' + s);
}
io.get('/export', adminRequired, (c) => {
    const format = (c.req.query('format') || 'json').toLowerCase();
    const base = resolveSiteBaseUrl(null, requestOriginFromHono(c));
    const paths = categoryPathMap();
    const rows = db.prepare(`SELECT p.*, b.name AS brand_name FROM products p LEFT JOIN brands b ON b.id = p.brand_id ORDER BY p.id`).all();
    const items = rows.map(p => {
        let gallery = [];
        try { const g = JSON.parse(p.gallery || '[]'); if (Array.isArray(g)) gallery = g; } catch { }
        return {
            sku: p.sku || '', name: p.name, slug: p.slug,
            category: paths[p.category_id] || '', brand: p.brand_name || '',
            price: Number(p.price || 0), discount_price: p.discount_price == null ? '' : Number(p.discount_price),
            stock: Number(p.stock || 0), status: p.status, featured: Number(p.featured || 0),
            image: absUrl(base, p.image), gallery: gallery.map(g => absUrl(base, g)),
            short_description: p.short_description || '', description: p.description || '',
            key_features: p.key_features ? (() => { try { return JSON.parse(p.key_features); } catch { return []; } })() : [],
            specs: p.specs ? (() => { try { return JSON.parse(p.specs); } catch { return []; } })() : [],
            guarantee: p.guarantee || '', tax_percent: p.tax_percent == null ? '' : p.tax_percent,
            seo_title: p.seo_title || '', seo_description: p.seo_description || '', seo_keywords: p.seo_keywords || '',
            sort_order: Number(p.sort_order || 0),
        };
    });
    const user = c.get('user');
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'export', entity_type: 'product', entity_id: 0, details: { format, count: items.length } });
    const stamp = new Date().toISOString().slice(0, 10);
    c.header('Cache-Control', 'no-store');
    if (format === 'csv') {
        const cell = (v) => {
            let s = Array.isArray(v) ? (v.length && typeof v[0] === 'object' ? JSON.stringify(v) : v.join(', ')) : str(v);
            if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = "'" + s; // CSV/Excel formula-injection guard
            return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        };
        const lines = [EXPORT_COLS.join(',')].concat(items.map(it => EXPORT_COLS.map(k => cell(it[k])).join(',')));
        c.header('Content-Type', 'text/csv; charset=utf-8');
        c.header('Content-Disposition', `attachment; filename="products-${stamp}.csv"`);
        return c.body('\uFEFF' + lines.join('\r\n'));
    }
    return c.json({ success: true, data: { format: 'netcorepro-products', version: 1, exported_at: new Date().toISOString(), source: base, columns: EXPORT_COLS, count: items.length, items }, code: 200 });
});

// ---------------------------------------------------------------- image download (SSRF-guarded)
const UPLOAD_DIR = path.resolve(__PROJ_ROOT, 'public/static/uploads');
const MAX_IMG = 5 * 1024 * 1024;
function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split('.').map(Number);
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    }
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80')) return true;
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivateIp(m[1]) : false;
}
async function assertPublicHost(u) {
    const blocked = (m) => Object.assign(new Error(m), { code: 'BLOCKED' });
    if (!/^https?:$/.test(u.protocol)) throw blocked('فقط لینک http/https مجاز است');
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.promises.lookup(host, { all: true });
    if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw blocked('آدرس داخلی/خصوصی مجاز نیست');
}
function sniffExt(buf) {
    if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'jpg';
    if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'png';
    if (buf.length > 6 && buf.slice(0, 3).toString() === 'GIF') return 'gif';
    if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
    return null;
}
async function downloadImage(url) {
    let u = new URL(url);
    for (let hop = 0; hop < 4; hop++) {
        await assertPublicHost(u);
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 15000);
        let res;
        try { res = await fetch(u, { redirect: 'manual', signal: ac.signal, headers: { 'User-Agent': 'Mozilla/5.0 (product-import)' } }); }
        finally { clearTimeout(t); }
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { u = new URL(res.headers.get('location'), u); continue; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const len = Number(res.headers.get('content-length') || 0);
        if (len > MAX_IMG) throw new Error('حجم تصویر بیش از ۵ مگابایت');
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > MAX_IMG) throw new Error('حجم تصویر بیش از ۵ مگابایت');
        const ext = sniffExt(buf);
        if (!ext) throw new Error('فایل تصویر معتبر نیست');
        const fname = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const mime = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
        const st = saveUploadedImageHybrid(fname, mime, buf);
        const local = `/static/uploads/${fname}`;
        if (st.savedDisk) generateVariantsFor(local).catch(() => { });
        return local;
    }
    throw new Error('ریدایرکت بیش از حد');
}

// ---------------------------------------------------------------- import
const MAX_ROWS = 300;
io.post('/import', adminRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.rows))
        return c.json({ success: false, message: 'داده‌ای برای ورود ارسال نشده است', code: 400 }, 400);
    if (body.rows.length > MAX_ROWS)
        return c.json({ success: false, message: `حداکثر ${MAX_ROWS} ردیف در هر درخواست`, code: 400 }, 400);
    const o = body.options || {};
    const dry = !!body.dry_run;
    const mode = ['upsert', 'create', 'update'].includes(o.mode) ? o.mode : 'upsert';
    const rial = o.price_unit === 'rial';
    const createMissing = o.create_missing !== false;
    const downloadImages = !!o.download_images;
    const defaultStock = Number.isFinite(Number(o.default_stock)) && o.default_stock !== '' && o.default_stock !== null ? Math.max(0, Math.round(Number(o.default_stock))) : null;
    const forceStatus = ['active', 'inactive'].includes(o.status) ? o.status : null;
    const rowOffset = Math.max(0, parseInt(body.row_offset || 0, 10) || 0);
    // the site's own host -> imported absolute URLs of this host become local paths again
    const ownHosts = new Set([c.req.header('host'), c.req.header('x-forwarded-host')].filter(Boolean).map(h => h.toLowerCase()));

    // caches (per request)
    const cats = db.prepare(`SELECT id, parent_id, name, slug FROM categories`).all();
    const catKey = (pid, name) => (pid || 0) + '|' + normKey(name);
    const catByKey = new Map(cats.map(x => [catKey(x.parent_id, x.name), x.id]));
    const catBySlug = new Map(cats.map(x => [x.slug, x.id]));
    const brands = db.prepare(`SELECT id, name, slug FROM brands`).all();
    const brandByKey = new Map(brands.map(b => [normKey(b.name), b.id]));
    const plannedCats = new Set(), plannedBrands = new Set();
    const imgCache = new Map();
    let fakeId = -1;

    function uniqueSlug(table, base) {
        let s = base || ('item-' + Date.now()), n = 2;
        while (db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(s)) s = `${base}-${n++}`;
        return s;
    }
    function resolveCategory(parts) {
        if (!parts.length) return null;
        let pid = null;
        for (const name of parts) {
            const k = catKey(pid, name);
            let id = catByKey.get(k);
            if (!id && !pid) { // root lookup also by slug / name anywhere (for flat files)
                const s = catBySlug.get(slugify(name));
                if (s) id = s;
                else { const any = cats.find(x => normKey(x.name) === normKey(name)); if (any) id = any.id; }
            }
            if (!id) {
                if (!createMissing) return { error: `دستهٔ «${parts.join(' > ')}» وجود ندارد` };
                if (dry) { id = fakeId--; plannedCats.add(parts.slice(0, parts.indexOf(name) + 1).join(' > ')); }
                else {
                    const slug = uniqueSlug('categories', slugify(name) || 'cat');
                    id = Number(db.prepare(`INSERT INTO categories (name, slug, parent_id, sort_order, show_in_menu, is_active) VALUES (?, ?, ?, 0, 1, 1)`).run(name.slice(0, 180), slug, pid && pid > 0 ? pid : null).lastInsertRowid);
                    cats.push({ id, parent_id: pid, name, slug }); catBySlug.set(slug, id);
                    plannedCats.add(parts.slice(0, parts.indexOf(name) + 1).join(' > '));
                }
                catByKey.set(k, id);
            }
            pid = id;
        }
        return { id: pid };
    }
    function resolveBrand(name) {
        const n = str(name).split(/\s*[,|]\s*/)[0];
        if (!n) return null;
        let id = brandByKey.get(normKey(n));
        if (!id) {
            if (!createMissing) return null;
            if (dry) id = fakeId--;
            else {
                const slug = uniqueSlug('brands', slugify(n) || 'brand');
                id = Number(db.prepare(`INSERT INTO brands (name, slug) VALUES (?, ?)`).run(n.slice(0, 180), slug).lastInsertRowid);
            }
            brandByKey.set(normKey(n), id);
            plannedBrands.add(n);
        }
        return id;
    }
    async function localizeImage(u, warn) {
        let s = str(u);
        if (!s) return '';
        if (/^https?:\/\//i.test(s)) {
            try {
                const url = new URL(s);
                if (ownHosts.has(url.host.toLowerCase()) && url.pathname.startsWith('/static/')) return url.pathname;
            } catch { return ''; }
            if (!downloadImages || dry) return s;
            if (imgCache.has(s)) return imgCache.get(s);
            try { const local = await downloadImage(s); imgCache.set(s, local); return local; }
            catch (e) {
                // a blocked (internal/private/non-http) address is never stored; a temporary
                // network failure keeps the original link so the photo still shows.
                const blocked = e && e.code === 'BLOCKED';
                warn.push('تصویر دانلود نشد (' + (e.message || 'خطا') + ')' + (blocked ? ' — لینک نادیده گرفته شد' : ' — لینک اصلی ذخیره شد'));
                const keep = blocked ? '' : s;
                imgCache.set(s, keep); return keep;
            }
        }
        return s.startsWith('/') ? s : '';
    }

    const results = [];
    const summary = { create: 0, update: 0, skip: 0, error: 0 };
    for (let i = 0; i < body.rows.length; i++) {
        const rowNo = rowOffset + i + 1;
        const r = mapRow(body.rows[i]);
        const warn = [];
        try {
            // Woo variation rows belong to a parent product -> skip, they'd duplicate it
            if (normKey(str(r.type)) === 'variation') { summary.skip++; results.push({ row: rowNo, action: 'skip', name: str(r.name), message: 'ردیف «variation» ووکامرس (زیرمحصول) — نادیده گرفته شد' }); continue; }
            const name = str(r.name).slice(0, 250);
            const sku = str(r.sku).slice(0, 100) || null;
            const slugIn = slugify(r.slug);
            if (!name && !sku && !slugIn) { summary.skip++; results.push({ row: rowNo, action: 'skip', message: 'ردیف خالی' }); continue; }

            // ---- find existing
            let ex = null;
            if (sku) ex = db.prepare(`SELECT id, name, price FROM products WHERE sku = ?`).get(sku);
            if (!ex && slugIn) ex = db.prepare(`SELECT id, name, price FROM products WHERE slug = ?`).get(slugIn);
            if (!ex && name) ex = db.prepare(`SELECT id, name, price FROM products WHERE name = ?`).get(name);
            if (ex && mode === 'create') { summary.skip++; results.push({ row: rowNo, action: 'skip', name: ex.name, message: 'قبلاً وجود دارد (حالت «فقط محصولات جدید»)' }); continue; }
            if (!ex && mode === 'update') { summary.skip++; results.push({ row: rowNo, action: 'skip', name: name || sku, message: 'محصولی با این کد/نامک/نام پیدا نشد (حالت «فقط به‌روزرسانی»)' }); continue; }

            // ---- build field values (only non-empty)
            const f = {};
            if (name) f.name = name;
            let price = num(r.price), dprice = num(r.discount_price);
            if (rial) { if (price != null) price = Math.round(price / 10); if (dprice != null) dprice = Math.round(dprice / 10); }
            if (price != null) f.price = Math.max(0, Math.round(price));
            if (dprice != null) {
                const base = f.price ?? (ex ? Number(ex.price) : 0);
                f.discount_price = (dprice > 0 && dprice < base) ? Math.round(dprice) : null;
            }
            let stock = num(r.stock);
            if (stock == null) { const ins = parseBool(r.in_stock); if (ins === 0) stock = 0; else if (!ex && defaultStock != null) stock = defaultStock; }
            if (stock != null) f.stock = Math.max(0, Math.round(stock));
            const st = forceStatus || parseStatus(r.status);
            if (st) f.status = st;
            const fe = parseBool(r.featured); if (fe != null) f.featured = fe;
            const desc = htmlToText(r.description); if (desc) f.description = desc;
            const sdesc = htmlToText(r.short_description); if (sdesc) f.short_description = sdesc.slice(0, 2000);
            const kf = featuresFrom(r.key_features); if (kf) f.key_features = kf;
            const sp = specsFrom(r.specs); if (sp) f.specs = sp;
            if (str(r.guarantee)) f.guarantee = str(r.guarantee).slice(0, 250);
            const tp = num(r.tax_percent); if (tp != null && tp >= 0 && tp <= 25) f.tax_percent = tp;
            for (const k of ['seo_title', 'seo_description', 'seo_keywords']) if (str(r[k])) f[k] = str(r[k]).slice(0, k === 'seo_title' ? 250 : 2000);
            const so = num(r.sort_order); if (so != null) f.sort_order = Math.round(so);

            const cp = categoryPath(r.category);
            if (cp.length) { const cr = resolveCategory(cp); if (cr && cr.error) warn.push(cr.error); else if (cr) f.category_id = cr.id; }
            if (str(r.brand)) { const b = resolveBrand(r.brand); if (b) f.brand_id = b; }

            const imgs = listOfUrls(r.image);
            const gal = listOfUrls(r.gallery);
            if (imgs.length) { const m = await localizeImage(imgs[0], warn); if (m) f.image = m; }
            const galAll = imgs.slice(1).concat(gal);
            if (galAll.length) {
                const g = [];
                for (const u of galAll.slice(0, 12)) { const m = await localizeImage(u, warn); if (m) g.push(m); }
                if (g.length) f.gallery = JSON.stringify(g);
            }

            if (ex) {
                if (sku) {
                    const dup = db.prepare(`SELECT id FROM products WHERE sku = ? AND id <> ?`).get(sku, ex.id);
                    if (!dup) f.sku = sku;
                }
                const keys = Object.keys(f).filter(k => !(k === 'category_id' && f[k] < 0) && !(k === 'brand_id' && f[k] < 0));
                if (!keys.length) { summary.skip++; results.push({ row: rowNo, action: 'skip', name: ex.name, message: 'هیچ مقدار جدیدی برای به‌روزرسانی نبود' }); continue; }
                if (!dry) {
                    db.prepare(`UPDATE products SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...keys.map(k => f[k]), ex.id);
                    // keep the discount rule (discount < price) after a price-only update
                    db.prepare(`UPDATE products SET discount_price = NULL WHERE id = ? AND discount_price IS NOT NULL AND (discount_price <= 0 OR discount_price >= price)`).run(ex.id);
                }
                summary.update++;
                results.push({ row: rowNo, action: 'update', id: ex.id, name: f.name || ex.name, fields: keys.length, message: warn.join(' | ') });
            }
            else {
                if (!name) { summary.error++; results.push({ row: rowNo, action: 'error', name: sku || slugIn, message: 'نام محصول خالی است' }); continue; }
                if (f.category_id == null && !warn.length) {
                    // no category given -> put it in «سایر محصولات» so it is still visible & editable
                    const cr = resolveCategory(['سایر محصولات']);
                    if (cr && cr.id) f.category_id = cr.id;
                }
                if (f.category_id == null) { summary.error++; results.push({ row: rowNo, action: 'error', name, message: warn.join(' | ') || 'دسته‌بندی مشخص نیست' }); continue; }
                if (sku && db.prepare(`SELECT id FROM products WHERE sku = ?`).get(sku)) { summary.error++; results.push({ row: rowNo, action: 'error', name, message: 'کد محصول (SKU) تکراری است' }); continue; }
                let newId = null;
                if (!dry) {
                    const slug = uniqueSlug('products', slugIn || slugify(name) || ('p-' + Date.now()));
                    const cols = { name, slug, sku, category_id: f.category_id, brand_id: f.brand_id ?? null, price: f.price ?? 0,
                        discount_price: f.discount_price ?? null, stock: f.stock ?? 0, status: f.status || 'active', featured: f.featured ?? 0,
                        image: f.image || null, gallery: f.gallery || null, description: f.description || null, short_description: f.short_description || null,
                        key_features: f.key_features || null, specs: f.specs || null, guarantee: f.guarantee || null, tax_percent: f.tax_percent ?? null,
                        seo_title: f.seo_title || null, seo_description: f.seo_description || null, seo_keywords: f.seo_keywords || null, sort_order: f.sort_order ?? 0 };
                    const ks = Object.keys(cols);
                    newId = Number(db.prepare(`INSERT INTO products (${ks.join(', ')}) VALUES (${ks.map(() => '?').join(', ')})`).run(...ks.map(k => cols[k])).lastInsertRowid);
                }
                if ((f.price ?? 0) === 0) warn.push('قیمت ندارد (در سایت «استعلام قیمت» نمایش داده می‌شود)');
                summary.create++;
                results.push({ row: rowNo, action: 'create', id: newId, name, message: warn.join(' | ') });
            }
        }
        catch (e) {
            summary.error++;
            results.push({ row: rowNo, action: 'error', name: str(r.name), message: /UNIQUE|Duplicate/i.test(e?.message || '') ? 'نامک یا کد محصول تکراری است' : friendlyDbError(e, 'خطا در ذخیرهٔ این ردیف') });
        }
    }
    if (!dry && (summary.create || summary.update)) {
        logActivity({ user_id: user.id, user_name: user.full_name, action: 'import', entity_type: 'product', entity_id: 0, details: { ...summary, rows: body.rows.length, categories_created: [...plannedCats].length, brands_created: [...plannedBrands].length } });
    }
    return c.json({ success: true, data: { dry_run: dry, summary, results, new_categories: [...plannedCats], new_brands: [...plannedBrands] }, message: dry ? 'پیش‌نمایش آماده شد' : 'ورود اطلاعات انجام شد', code: 200 });
});

export default io;
