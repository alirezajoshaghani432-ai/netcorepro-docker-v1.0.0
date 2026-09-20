import { Hono } from 'hono';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import db from '../db/index.js';
import { adminRequired } from '../middleware/auth.js';
import { getAllSettings, setSetting, logActivity } from '../utils/helpers.js';
import { generateVariantsFor } from '../utils/imggen.js';
const misc = new Hono();
// Newsletter subscribe
misc.post('/newsletter/subscribe', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    // Normalize (trim + lowercase) BEFORE validating so whitespace/case variants of the
    // same address don't create duplicate subscribers and padded input is still accepted.
    const schema = z.object({ email: z.string().trim().toLowerCase().pipe(z.string().email('ایمیل معتبر نیست')) });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const email = parsed.data.email;
    try {
        // Re-subscribe if previously unsubscribed; insert if new.
        const type = (process.env.DB_TYPE || 'mssql').toLowerCase();
        if (type === 'mssql') {
            db.prepare(`MERGE newsletter_subscribers AS tgt
                        USING (SELECT ? AS email) AS src ON tgt.email = src.email
                        WHEN MATCHED THEN UPDATE SET status = N'active'
                        WHEN NOT MATCHED THEN INSERT (email, status) VALUES (src.email, N'active');`).run(email);
        } else {
            db.prepare(`INSERT INTO newsletter_subscribers (email, status) VALUES (?, 'active')
                        ON CONFLICT(email) DO UPDATE SET status = 'active'`).run(email);
        }
        logActivity({ action: 'create', entity_type: 'newsletter', details: { email }, ip_address: c.req.header('x-forwarded-for') || 'local' });
        return c.json({ success: true, message: 'ایمیل شما در خبرنامه ثبت شد', code: 200 });
    }
    catch (e) {
        return c.json({ success: false, message: 'خطا در ثبت', code: 500 }, 500);
    }
});
// Newsletter unsubscribe (public, by email). Idempotent: unknown email still returns success
// to avoid leaking which addresses are subscribed.
misc.post('/newsletter/unsubscribe', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    // Normalize (trim + lowercase) BEFORE validating to match how subscriptions are stored.
    const schema = z.object({ email: z.string().trim().toLowerCase().pipe(z.string().email('ایمیل معتبر نیست')) });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const email = parsed.data.email;
    try {
        db.prepare(`UPDATE newsletter_subscribers SET status = 'unsubscribed' WHERE email = ?`).run(email);
        logActivity({ action: 'update', entity_type: 'newsletter', details: { email, status: 'unsubscribed' }, ip_address: c.req.header('x-forwarded-for') || 'local' });
        return c.json({ success: true, message: 'اشتراک شما در خبرنامه لغو شد', code: 200 });
    }
    catch (e) {
        return c.json({ success: false, message: 'خطا در لغو اشتراک', code: 500 }, 500);
    }
});
// Contact message
misc.post('/messages', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({
        name: z.string().min(2, 'نام معتبر نیست'),
        email: z.string().email('ایمیل معتبر نیست').optional().or(z.literal('')),
        phone: z.string().optional(),
        subject: z.string().optional(),
        body: z.string().min(5, 'متن پیام معتبر نیست')
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const d = parsed.data;
    const r = db.prepare(`INSERT INTO messages (name, email, phone, subject, body) VALUES (?, ?, ?, ?, ?)`).run(d.name, d.email || null, d.phone || null, d.subject || null, d.body);
    logActivity({ action: 'create', entity_type: 'message', entity_id: r.lastInsertRowid, ip_address: c.req.header('x-forwarded-for') || 'local' });
    return c.json({ success: true, message: 'پیام شما با موفقیت ارسال شد', code: 200 });
});
// === Admin: Newsletter ===
misc.get('/admin/newsletter', adminRequired, (c) => {
    const items = db.prepare(`SELECT * FROM newsletter_subscribers ORDER BY created_at DESC`).all();
    return c.json({ success: true, data: items, code: 200 });
});
misc.delete('/admin/newsletter/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    db.prepare(`DELETE FROM newsletter_subscribers WHERE id = ?`).run(id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'newsletter', entity_id: id });
    return c.json({ success: true, message: 'حذف شد', code: 200 });
});
// === Admin: Messages ===
misc.get('/admin/messages', adminRequired, (c) => {
    const items = db.prepare(`SELECT * FROM messages ORDER BY created_at DESC`).all();
    return c.json({ success: true, data: items, code: 200 });
});
misc.put('/admin/messages/:id/read', adminRequired, (c) => {
    const id = parseInt(c.req.param('id') || '0');
    db.prepare(`UPDATE messages SET status = 'read' WHERE id = ?`).run(id);
    return c.json({ success: true, message: 'علامت‌گذاری شد', code: 200 });
});
misc.delete('/admin/messages/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    db.prepare(`DELETE FROM messages WHERE id = ?`).run(id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'message', entity_id: id });
    return c.json({ success: true, message: 'حذف شد', code: 200 });
});
// === Admin: Settings ===
misc.get('/admin/settings', adminRequired, (c) => {
    return c.json({ success: true, data: getAllSettings(), code: 200 });
});
misc.put('/admin/settings', adminRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    if (!body || typeof body !== 'object')
        return c.json({ success: false, message: 'داده نامعتبر', code: 400 }, 400);
    Object.entries(body).forEach(([k, v]) => setSetting(k, String(v ?? '')));
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update', entity_type: 'settings', details: { keys: Object.keys(body) } });
    return c.json({ success: true, message: 'تنظیمات ذخیره شد', code: 200 });
});
// === Admin: Users CRUD ===
misc.get('/admin/users', adminRequired, (c) => {
    const role = c.req.query('role') || '';
    const items = db.prepare(`SELECT id, email, full_name, phone, role, company, status, created_at FROM users ${role ? 'WHERE role = ?' : ''} ORDER BY created_at DESC`).all(...(role ? [role] : []));
    return c.json({ success: true, data: items, code: 200 });
});
misc.put('/admin/users/:id/status', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({ status: z.enum(['active', 'blocked']) });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: 'وضعیت نامعتبر', code: 400 }, 400);
    db.prepare(`UPDATE users SET status = ? WHERE id = ?`).run(parsed.data.status, id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update_status', entity_type: 'user', entity_id: id, details: { new_status: parsed.data.status } });
    return c.json({ success: true, message: 'وضعیت به‌روزرسانی شد', code: 200 });
});
misc.delete('/admin/users/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    if (id === user.id)
        return c.json({ success: false, message: 'نمی‌توانید حساب خود را حذف کنید', code: 400 }, 400);
    const target = db.prepare(`SELECT id FROM users WHERE id = ?`).get(id);
    if (!target)
        return c.json({ success: false, message: 'کاربر یافت نشد', code: 404 }, 404);
    // A user referenced by orders or tickets cannot be hard-deleted (FK -> 500) and
    // deleting them would orphan business records. Block (soft-delete) instead.
    const orderCount = db.prepare(`SELECT COUNT(*) AS t FROM orders WHERE user_id = ?`).get(id).t;
    const ticketCount = db.prepare(`SELECT COUNT(*) AS t FROM tickets WHERE user_id = ?`).get(id).t;
    if (orderCount > 0 || ticketCount > 0) {
        db.prepare(`UPDATE users SET status = 'blocked' WHERE id = ?`).run(id);
        logActivity({ user_id: user.id, user_name: user.full_name, action: 'block', entity_type: 'user', entity_id: id, details: { reason: 'has_orders_or_tickets', orders: orderCount, tickets: ticketCount } });
        return c.json({ success: true, message: 'این کاربر سفارش/تیکت دارد و به‌جای حذف، مسدود شد', code: 200 });
    }
    const tx = db.transaction(() => {
        // Detach every nullable FK that references this user before removing the
        // account. Missing any of these throws SQLITE_CONSTRAINT_FOREIGNKEY -> 500.
        db.prepare(`UPDATE activity_logs SET user_id = NULL WHERE user_id = ?`).run(id);
        db.prepare(`UPDATE comments SET user_id = NULL WHERE user_id = ?`).run(id);
        db.prepare(`UPDATE posts SET author_id = NULL WHERE author_id = ?`).run(id);
        db.prepare(`UPDATE ticket_replies SET user_id = NULL WHERE user_id = ?`).run(id);
        db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
    });
    tx();
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'user', entity_id: id });
    return c.json({ success: true, message: 'کاربر حذف شد', code: 200 });
});
// === Admin: Categories CRUD (nested + SEO) ===
const categorySchema = z.object({
    name: z.string().min(2),
    slug: z.string().min(2),
    description: z.string().optional().nullable(),
    icon: z.string().optional().nullable(),
    image: z.string().optional().nullable(),
    parent_id: z.number().int().positive().optional().nullable(),
    sort_order: z.number().int().optional().nullable(),
    // Admin-controlled visibility in the header mega-menu.
    // Accepts boolean or 0/1 so the checkbox and the API both work.
    show_in_menu: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional().nullable(),
    seo_title: z.string().optional().nullable(),
    seo_description: z.string().optional().nullable(),
    seo_keywords: z.string().optional().nullable()
});

/** Normalise show_in_menu to 0/1; default = visible. */
function menuFlag(v) {
    if (v === undefined || v === null) return 1;
    return (v === true || v === 1) ? 1 : 0;
}
// prevent a category from being its own ancestor (would create a cycle)
function isDescendantOf(candidateParentId, categoryId) {
    let cur = candidateParentId;
    const seen = new Set();
    while (cur) {
        if (cur === categoryId)
            return true;
        if (seen.has(cur))
            return true; // safety: existing cycle
        seen.add(cur);
        const row = db.prepare(`SELECT parent_id FROM categories WHERE id = ?`).get(cur);
        cur = row ? row.parent_id : null;
    }
    return false;
}
// چک‌سام محتوای فایل عکس — برای تشخیص عکس تکراری حتی وقتی نام فایل متفاوت است
const __imgHashCache = new Map();
function imageContentHash(webPath) {
    if (!webPath || typeof webPath !== 'string')
        return null;
    if (!webPath.startsWith('/static/'))
        return null;
    try {
        const abs = path.join(process.cwd(), 'public', webPath.replace(/^\/+/, ''));
        const st = fs.statSync(abs);
        const key = webPath + ':' + st.size + ':' + st.mtimeMs;
        if (__imgHashCache.has(key))
            return __imgHashCache.get(key);
        const h = createHash('md5').update(fs.readFileSync(abs)).digest('hex').slice(0, 12);
        if (__imgHashCache.size > 500)
            __imgHashCache.clear();
        __imgHashCache.set(key, h);
        return h;
    }
    catch {
        return null;
    }
}

misc.get('/admin/categories', adminRequired, (c) => {
    const items = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id) AS product_count, (SELECT name FROM categories p WHERE p.id = c.parent_id) AS parent_name FROM categories c ORDER BY sort_order, name`).all();
    // image_hash: دسته‌هایی که این مقدار یکسان دارند، عکسشان واقعاً یکی است
    for (const it of items)
        it.image_hash = imageContentHash(it.image);
    return c.json({ success: true, data: items, code: 200 });
});
misc.post('/admin/categories', adminRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json();
    const parsed = categorySchema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const d = parsed.data;
    if (d.parent_id) {
        const p = db.prepare(`SELECT id FROM categories WHERE id = ?`).get(d.parent_id);
        if (!p)
            return c.json({ success: false, message: 'دسته مادر یافت نشد', code: 400 }, 400);
    }
    try {
        const r = db.prepare(`INSERT INTO categories (name, slug, description, icon, image, parent_id, sort_order, show_in_menu, seo_title, seo_description, seo_keywords) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.name, d.slug, d.description || null, d.icon || null, d.image || null, d.parent_id || null, d.sort_order ?? 0, menuFlag(d.show_in_menu), d.seo_title || null, d.seo_description || null, d.seo_keywords || null);
        logActivity({ user_id: user.id, user_name: user.full_name, action: 'create', entity_type: 'category', entity_id: r.lastInsertRowid });
        return c.json({ success: true, data: { id: r.lastInsertRowid }, message: 'دسته ایجاد شد', code: 200 });
    }
    catch (e) {
        return c.json({ success: false, message: 'خطا: ' + e.message, code: 400 }, 400);
    }
});
misc.put('/admin/categories/:id', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json().catch(() => ({}));
    const parsed = categorySchema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const exists = db.prepare(`SELECT id FROM categories WHERE id = ?`).get(id);
    if (!exists)
        return c.json({ success: false, message: 'دسته یافت نشد', code: 404 }, 404);
    const d = parsed.data;
    if (d.parent_id) {
        if (d.parent_id === id)
            return c.json({ success: false, message: 'دسته نمی‌تواند مادر خودش باشد', code: 400 }, 400);
        const p = db.prepare(`SELECT id FROM categories WHERE id = ?`).get(d.parent_id);
        if (!p)
            return c.json({ success: false, message: 'دسته مادر یافت نشد', code: 400 }, 400);
        if (isDescendantOf(d.parent_id, id))
            return c.json({ success: false, message: 'نمی‌توان یک زیرشاخه را به‌عنوان مادر انتخاب کرد (حلقه ایجاد می‌شود)', code: 400 }, 400);
    }
    try {
        db.prepare(`UPDATE categories SET name = ?, slug = ?, description = ?, icon = ?, image = ?, parent_id = ?, sort_order = ?, show_in_menu = ?, seo_title = ?, seo_description = ?, seo_keywords = ? WHERE id = ?`)
            .run(d.name, d.slug, d.description || null, d.icon || null, d.image || null, d.parent_id || null, d.sort_order ?? 0, menuFlag(d.show_in_menu), d.seo_title || null, d.seo_description || null, d.seo_keywords || null, id);
        logActivity({ user_id: user.id, user_name: user.full_name, action: 'update', entity_type: 'category', entity_id: id });
        return c.json({ success: true, message: 'دسته به‌روزرسانی شد', code: 200 });
    }
    catch (e) {
        return c.json({ success: false, message: 'خطا: ' + e.message, code: 400 }, 400);
    }
});
misc.delete('/admin/categories/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const exists = db.prepare(`SELECT id FROM categories WHERE id = ?`).get(id);
    if (!exists)
        return c.json({ success: false, message: 'دسته یافت نشد', code: 404 }, 404);
    // Guard FK integrity: category referenced by products or sub-categories cannot be hard-deleted
    const prodCount = db.prepare(`SELECT COUNT(*) AS t FROM products WHERE category_id = ?`).get(id).t;
    if (prodCount > 0)
        return c.json({ success: false, message: `این دسته ${prodCount} محصول دارد؛ ابتدا محصول‌ها را جابه‌جا یا حذف کنید`, code: 400 }, 400);
    const childCount = db.prepare(`SELECT COUNT(*) AS t FROM categories WHERE parent_id = ?`).get(id).t;
    if (childCount > 0)
        return c.json({ success: false, message: `این دسته ${childCount} زیرشاخه دارد؛ ابتدا زیرشاخه‌ها را حذف کنید`, code: 400 }, 400);
    db.prepare(`DELETE FROM categories WHERE id = ?`).run(id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'category', entity_id: id });
    return c.json({ success: true, message: 'حذف شد', code: 200 });
});
/* =====================================================================
   Menu Builder endpoints — simplified navigation editor
   ---------------------------------------------------------------------
   These three lightweight endpoints power /admin/menu-builder. Each one is
   deliberately narrow (a single concern) so an accidental action can never
   damage unrelated fields of a category.
   ===================================================================== */

/** Inline rename — only the display name changes; slug/SEO/links stay intact
 *  so existing Google rankings and shared links keep working. */
misc.patch('/admin/categories/:id/name', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name ?? '').trim();
    if (name.length < 2)
        return c.json({ success: false, message: 'نام باید حداقل ۲ حرف باشد', code: 400 }, 400);
    if (name.length > 80)
        return c.json({ success: false, message: 'نام حداکثر ۸۰ حرف باشد', code: 400 }, 400);
    const row = db.prepare(`SELECT id, name FROM categories WHERE id = ?`).get(id);
    if (!row)
        return c.json({ success: false, message: 'دسته یافت نشد', code: 404 }, 404);
    db.prepare(`UPDATE categories SET name = ? WHERE id = ?`).run(name, id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update', entity_type: 'category', entity_id: id, details: `نام: «${row.name}» → «${name}»` });
    return c.json({ success: true, message: 'نام دسته تغییر کرد', code: 200 });
});

/** Show / hide a category in the header mega-menu without deleting it. */
misc.patch('/admin/categories/:id/menu-visibility', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json().catch(() => ({}));
    const flag = menuFlag(body.show_in_menu);
    const row = db.prepare(`SELECT id, name FROM categories WHERE id = ?`).get(id);
    if (!row)
        return c.json({ success: false, message: 'دسته یافت نشد', code: 404 }, 404);
    db.prepare(`UPDATE categories SET show_in_menu = ? WHERE id = ?`).run(flag, id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update', entity_type: 'category', entity_id: id, details: `${flag ? 'نمایش' : 'پنهان‌سازی'} «${row.name}» در منو` });
    return c.json({ success: true, message: flag ? 'در منو نمایش داده می‌شود' : 'از منو پنهان شد', code: 200 });
});

/** Bulk reorder from the drag-and-drop list. Written in ONE transaction so a
 *  half-applied order can never be persisted. */
misc.post('/admin/categories/reorder', adminRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items || !items.length)
        return c.json({ success: false, message: 'لیست ترتیب خالی است', code: 400 }, 400);
    if (items.length > 500)
        return c.json({ success: false, message: 'تعداد آیتم‌ها بیش از حد مجاز است', code: 400 }, 400);
    const upd = db.prepare(`UPDATE categories SET sort_order = ? WHERE id = ?`);
    const run = db.transaction((rows) => {
        for (const it of rows) {
            const id = parseInt(it.id);
            const so = parseInt(it.sort_order);
            if (!Number.isInteger(id) || !Number.isInteger(so)) continue;
            upd.run(so, id);
        }
    });
    try {
        run(items);
        logActivity({ user_id: user.id, user_name: user.full_name, action: 'update', entity_type: 'category', entity_id: 0, details: `ترتیب ${items.length} دسته در منو تغییر کرد` });
        return c.json({ success: true, message: 'ترتیب منو ذخیره شد', code: 200 });
    }
    catch (e) {
        return c.json({ success: false, message: 'خطا: ' + e.message, code: 400 }, 400);
    }
});

// === Admin: Brands CRUD ===
misc.get('/admin/brands', adminRequired, (c) => {
    const items = db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM products WHERE brand_id = b.id) AS product_count FROM brands b ORDER BY name`).all();
    return c.json({ success: true, data: items, code: 200 });
});
misc.post('/admin/brands', adminRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json();
    const schema = z.object({ name: z.string().min(2), slug: z.string().min(2), logo: z.string().optional().nullable() });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    try {
        const r = db.prepare(`INSERT INTO brands (name, slug, logo) VALUES (?, ?, ?)`).run(parsed.data.name, parsed.data.slug, parsed.data.logo || null);
        logActivity({ user_id: user.id, user_name: user.full_name, action: 'create', entity_type: 'brand', entity_id: r.lastInsertRowid });
        return c.json({ success: true, data: { id: r.lastInsertRowid }, message: 'برند ایجاد شد', code: 200 });
    }
    catch (e) {
        return c.json({ success: false, message: 'خطا: ' + e.message, code: 400 }, 400);
    }
});
misc.put('/admin/brands/:id', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({ name: z.string().min(2), slug: z.string().min(2), logo: z.string().optional().nullable() });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const exists = db.prepare(`SELECT id FROM brands WHERE id = ?`).get(id);
    if (!exists)
        return c.json({ success: false, message: 'برند یافت نشد', code: 404 }, 404);
    try {
        db.prepare(`UPDATE brands SET name = ?, slug = ?, logo = ? WHERE id = ?`).run(parsed.data.name, parsed.data.slug, parsed.data.logo || null, id);
        logActivity({ user_id: user.id, user_name: user.full_name, action: 'update', entity_type: 'brand', entity_id: id });
        return c.json({ success: true, message: 'برند به‌روزرسانی شد', code: 200 });
    }
    catch (e) {
        return c.json({ success: false, message: 'خطا: ' + e.message, code: 400 }, 400);
    }
});
misc.delete('/admin/brands/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const exists = db.prepare(`SELECT id FROM brands WHERE id = ?`).get(id);
    if (!exists)
        return c.json({ success: false, message: 'برند یافت نشد', code: 404 }, 404);
    // Guard FK integrity: brand referenced by products cannot be hard-deleted
    const prodCount = db.prepare(`SELECT COUNT(*) AS t FROM products WHERE brand_id = ?`).get(id).t;
    if (prodCount > 0)
        return c.json({ success: false, message: `این برند ${prodCount} محصول دارد؛ ابتدا محصول‌ها را جابه‌جا یا حذف کنید`, code: 400 }, 400);
    db.prepare(`DELETE FROM brands WHERE id = ?`).run(id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'brand', entity_id: id });
    return c.json({ success: true, message: 'حذف شد', code: 200 });
});
// === Admin: Dashboard summary + badges + sales/profit stats ===
misc.get('/admin/dashboard', adminRequired, (c) => {
    // Sales analytics: sold vs unsold, revenue vs lost (cancelled) amounts
    const soldQty = db.prepare(`SELECT COALESCE(SUM(oi.quantity),0) AS t FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.status != 'cancelled'`).get().t;
    const soldProducts = db.prepare(`SELECT COUNT(DISTINCT oi.product_id) AS t FROM order_items oi JOIN orders o ON oi.order_id = o.id WHERE o.status != 'cancelled'`).get().t;
    const activeProducts = db.prepare(`SELECT COUNT(*) AS t FROM products WHERE status = 'active'`).get().t;
    const revenueDelivered = db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM orders WHERE status = 'delivered'`).get().t;
    const revenueInProgress = db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM orders WHERE status IN ('pending','confirmed','shipping')`).get().t;
    const lostCancelled = db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM orders WHERE status = 'cancelled'`).get().t;
    // Weekly report (last 7 days) — for the donut chart at the top of dashboard
    const week = {
        orders: db.prepare(`SELECT COUNT(*) AS t FROM orders WHERE created_at >= datetime('now','-7 days')`).get().t,
        income: db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM orders WHERE created_at >= datetime('now','-7 days') AND status != 'cancelled'`).get().t,
        loss: db.prepare(`SELECT COALESCE(SUM(total),0) AS t FROM orders WHERE created_at >= datetime('now','-7 days') AND status = 'cancelled'`).get().t,
        by_status: db.prepare(`SELECT status, COUNT(*) AS cnt, COALESCE(SUM(total),0) AS amount FROM orders WHERE created_at >= datetime('now','-7 days') GROUP BY status`).all(),
        daily: db.prepare(`SELECT date(created_at) AS day, COUNT(*) AS cnt, COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END),0) AS income FROM orders WHERE created_at >= datetime('now','-7 days') GROUP BY date(created_at) ORDER BY day`).all()
    };
    const stats = {
        products: activeProducts,
        products_low_stock: db.prepare(`SELECT COUNT(*) AS t FROM products WHERE stock < 5`).get().t,
        customers: db.prepare(`SELECT COUNT(*) AS t FROM users WHERE role = 'customer'`).get().t,
        orders_total: db.prepare(`SELECT COUNT(*) AS t FROM orders`).get().t,
        orders_revenue: db.prepare(`SELECT COALESCE(SUM(total), 0) AS t FROM orders WHERE status != 'cancelled'`).get().t,
        posts: db.prepare(`SELECT COUNT(*) AS t FROM posts WHERE status = 'published'`).get().t,
        sales: {
            sold_qty: soldQty,
            sold_products: soldProducts,
            unsold_products: Math.max(0, activeProducts - soldProducts),
            revenue_delivered: revenueDelivered,
            revenue_in_progress: revenueInProgress,
            lost_cancelled: lostCancelled
        },
        week,
        badges: {
            orders_pending: db.prepare(`SELECT COUNT(*) AS t FROM orders WHERE status = 'pending'`).get().t,
            tickets_open: db.prepare(`SELECT COUNT(*) AS t FROM tickets WHERE status = 'open'`).get().t,
            messages_unread: db.prepare(`SELECT COUNT(*) AS t FROM messages WHERE status = 'unread'`).get().t,
            comments_pending: db.prepare(`SELECT COUNT(*) AS t FROM comments WHERE status = 'pending'`).get().t
        },
        recent_orders: db.prepare(`SELECT id, order_number, customer_name, total, status, created_at FROM orders ORDER BY created_at DESC LIMIT 5`).all(),
        recent_activity: db.prepare(`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 8`).all()
    };
    return c.json({ success: true, data: stats, code: 200 });
});
// === Admin: Activity Logs ===
misc.get('/admin/activity-logs', adminRequired, (c) => {
    let page = parseInt(c.req.query('page') || '1', 10);
    let limit = parseInt(c.req.query('limit') || '50', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;
    const offset = (page - 1) * limit;
    const items = db.prepare(`SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS t FROM activity_logs`).get().t;
    return c.json({ success: true, data: { items, total, page, limit }, code: 200 });
});
// === Admin: Image Upload ===
// Accepts either multipart/form-data (field "file") OR JSON { data: "data:image/...;base64,...", filename }
const UPLOAD_DIR = path.resolve(process.cwd(), 'public/static/uploads');
// NOTE: SVG is intentionally excluded — SVG files can embed <script> and would
// execute as stored XSS when opened directly from /static/uploads/. Raster only.
const ALLOWED_EXT = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_IMG_BYTES = 5 * 1024 * 1024; // 5MB
function ensureUploadDir() {
    try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch { /* ignore */ }
}
function safeName(ext) {
    const rnd = Math.random().toString(36).slice(2, 8);
    return `up-${Date.now()}-${rnd}.${ext}`;
}
misc.post('/admin/upload', adminRequired, async (c) => {
    const user = c.get('user');
    ensureUploadDir();
    const ctype = c.req.header('content-type') || '';
    try {
        let buffer = null;
        let ext = null;
        if (ctype.includes('multipart/form-data')) {
            const form = await c.req.parseBody();
            const file = form['file'];
            if (!file || typeof file === 'string')
                return c.json({ success: false, message: 'فایلی ارسال نشد', code: 400 }, 400);
            ext = ALLOWED_EXT[file.type];
            if (!ext)
                return c.json({ success: false, message: 'فرمت تصویر مجاز نیست (jpg, png, webp, gif)', code: 400 }, 400);
            const ab = await file.arrayBuffer();
            buffer = Buffer.from(ab);
        }
        else {
            const body = await c.req.json().catch(() => ({}));
            const dataUrl = body.data || '';
            const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
            if (!m)
                return c.json({ success: false, message: 'داده تصویر معتبر نیست', code: 400 }, 400);
            ext = ALLOWED_EXT[m[1]];
            if (!ext)
                return c.json({ success: false, message: 'فرمت تصویر مجاز نیست (jpg, png, webp, gif)', code: 400 }, 400);
            buffer = Buffer.from(m[2], 'base64');
        }
        if (!buffer || !buffer.length)
            return c.json({ success: false, message: 'فایل خالی است', code: 400 }, 400);
        if (buffer.length > MAX_IMG_BYTES)
            return c.json({ success: false, message: 'حجم تصویر بیش از ۵ مگابایت است', code: 400 }, 400);
        const fname = safeName(ext);
        fs.writeFileSync(path.join(UPLOAD_DIR, fname), buffer);
        const url = `/static/uploads/${fname}`;
        // F2f: build the responsive WebP ladder for this new photo in the
        // background so images added from the admin panel stay as fast as the
        // ones processed at build time. Never blocks or fails the upload.
        generateVariantsFor(url).catch(() => { });
        logActivity({ user_id: user.id, user_name: user.full_name, action: 'upload', entity_type: 'image', details: { url, size: buffer.length } });
        return c.json({ success: true, data: { url }, message: 'تصویر آپلود شد', code: 200 });
    }
    catch (e) {
        return c.json({ success: false, message: 'خطا در آپلود تصویر: ' + (e?.message || ''), code: 500 }, 500);
    }
});
// list uploaded images (media library)
misc.get('/admin/uploads', adminRequired, (c) => {
    ensureUploadDir();
    let files = [];
    try {
        files = fs.readdirSync(UPLOAD_DIR)
            .filter(f => /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(f))
            .map(f => ({ url: `/static/uploads/${f}`, name: f, mtime: fs.statSync(path.join(UPLOAD_DIR, f)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
    }
    catch { /* ignore */ }
    return c.json({ success: true, data: files, code: 200 });
});
export default misc;
