import db from '../db/index.js';
export function generateOrderNumber() {
    const ts = Date.now().toString().slice(-8);
    const rnd = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `NCP-${ts}${rnd}`;
}
export function generateTicketNumber() {
    const ts = Date.now().toString().slice(-6);
    const rnd = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return `TKT-${ts}${rnd}`;
}
export function getSetting(key, defaultValue = '') {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
    return row?.value ?? defaultValue;
}
export function getAllSettings() {
    const rows = db.prepare(`SELECT key, value FROM settings`).all();
    const obj = {};
    rows.forEach(r => obj[r.key] = r.value);
    return obj;
}
export function setSetting(key, value) {
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(key, value);
}
export function formatPrice(n) {
    if (!n)
        return '0';
    return new Intl.NumberFormat('fa-IR').format(n);
}
export function jsonResponse(success, data = null, message = '', code = 200) {
    return { success, data, message, code };
}
export function logActivity(opts) {
    try {
        db.prepare(`INSERT INTO activity_logs (user_id, user_name, action, entity_type, entity_id, details, ip_address, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(opts.user_id ?? null, opts.user_name ?? null, opts.action, opts.entity_type ?? null, opts.entity_id ?? null, opts.details ? JSON.stringify(opts.details) : null, opts.ip_address ?? null, opts.user_agent ?? null);
    }
    catch (e) {
        console.error('logActivity error:', e);
    }
}

// Round 14 (2026-11-03): turn raw DB errors into a short Persian message for the
// owner (raw English like «Data too long for column 'name' at row 1» used to be
// shown in the panel). The raw text is still logged on the server.
const DB_FIELD_FA = {
    name: 'نام', title: 'عنوان', slug: 'نامک (slug)', sku: 'کد محصول (SKU)', icon: 'آیکون',
    image: 'آدرس تصویر', logo: 'آدرس لوگو', cover_image: 'آدرس تصویر کاور', category: 'دسته',
    guarantee: 'نوع گارانتی', seo_title: 'عنوان سئو', email: 'ایمیل', phone: 'شماره تماس',
    full_name: 'نام', company: 'نام شرکت', city: 'شهر', postal_code: 'کد پستی', subject: 'موضوع',
    description: 'توضیحات', short_description: 'توضیح کوتاه', tags: 'برچسب‌ها', href: 'لینک',
    section: 'بخش', page: 'صفحه', author_name: 'نام', customer_name: 'نام مشتری',
    subtitle: 'زیرعنوان', tagline: 'شعار', hero_title: 'عنوان بنر', hero_sub: 'زیرعنوان بنر', hero_link: 'لینک بنر',
    hero_image: 'تصویر بنر', seo_description: 'توضیحات سئو', seo_keywords: 'کلمات کلیدی سئو', sort_order: 'ترتیب', address: 'آدرس', notes: 'یادداشت'
};
// Returns a Persian message for a *recognised* DB error (too long / duplicate /
// foreign key / bad number), or null for anything else. Does not log.
export function knownDbError(e) {
    const msg = String((e && e.message) || e || '');
    let m = msg.match(/Data too long for column '([^']+)'/i) || msg.match(/value too long.*column "?([a-z_]+)/i);
    if (m) return `مقدار «${DB_FIELD_FA[m[1]] || m[1]}» بیش از حد طولانی است`;
    if (/UNIQUE constraint|Duplicate entry/i.test(msg)) {
        m = msg.match(/for key '(?:[^'.]*\.)?([^']+)'/i) || msg.match(/UNIQUE constraint failed: [a-z_]+\.([a-z_]+)/i);
        const f = m ? m[1].replace(/^(uq_|idx_)/, '') : '';
        return DB_FIELD_FA[f] ? `«${DB_FIELD_FA[f]}» تکراری است — مقدار دیگری وارد کنید` : 'این مقدار تکراری است (نامک یا کد) — مقدار دیگری وارد کنید';
    }
    if (/foreign key constraint/i.test(msg)) return 'این مورد به اطلاعات دیگری وابسته است و این تغییر ممکن نیست';
    if (/Incorrect (integer|decimal|double) value|Out of range value/i.test(msg)) return 'یکی از مقادیر عددی نامعتبر یا بیش از حد بزرگ است';
    return null;
}
export function friendlyDbError(e, fallback = 'خطا در ذخیرهٔ اطلاعات') {
    const msg = String((e && e.message) || e || '');
    if (msg) console.error('[db]', msg);
    return knownDbError(e) || fallback;
}
