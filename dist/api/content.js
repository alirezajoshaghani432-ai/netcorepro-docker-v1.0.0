// Content management API for site_blocks + site_pages
// Public read endpoints + Admin CRUD + SSR helpers exported for view templates.
import { Hono } from 'hono';
import { z } from 'zod';
import db from '../db/index.js';
import { adminRequired } from '../middleware/auth.js';
import { logActivity } from '../utils/helpers.js';

const content = new Hono();

// ---------------- Public read endpoints ----------------

// GET /api/content/blocks?page=home&section=features
content.get('/blocks', (c) => {
    const page = c.req.query('page') || '';
    const section = c.req.query('section') || '';
    let sql = `SELECT id, page, section, icon, image, title, description, href, sort_order, is_active
               FROM site_blocks WHERE is_active = 1`;
    const args = [];
    if (page) { sql += ' AND page = ?'; args.push(page); }
    if (section) { sql += ' AND section = ?'; args.push(section); }
    sql += ' ORDER BY sort_order ASC, id ASC';
    const items = db.prepare(sql).all(...args);
    return c.json({ success: true, data: items, code: 200 });
});

// GET /api/content/pages?page=about&section=intro
content.get('/pages', (c) => {
    const page = c.req.query('page') || '';
    const section = c.req.query('section') || '';
    let sql = `SELECT id, page, section, title, subtitle, body, is_active
               FROM site_pages WHERE is_active = 1`;
    const args = [];
    if (page) { sql += ' AND page = ?'; args.push(page); }
    if (section) { sql += ' AND section = ?'; args.push(section); }
    sql += ' ORDER BY page ASC, section ASC';
    const items = db.prepare(sql).all(...args);
    return c.json({ success: true, data: items, code: 200 });
});

// ---------------- Admin: site_blocks CRUD ----------------

content.get('/admin/blocks', adminRequired, (c) => {
    const page = c.req.query('page') || '';
    const section = c.req.query('section') || '';
    let sql = `SELECT * FROM site_blocks WHERE 1=1`;
    const args = [];
    if (page) { sql += ' AND page = ?'; args.push(page); }
    if (section) { sql += ' AND section = ?'; args.push(section); }
    sql += ' ORDER BY page ASC, section ASC, sort_order ASC, id ASC';
    const items = db.prepare(sql).all(...args);
    return c.json({ success: true, data: items, code: 200 });
});

const blockSchema = z.object({
    page: z.string().min(1, 'page الزامی است'),
    section: z.string().min(1, 'section الزامی است'),
    icon: z.string().optional().nullable(),
    image: z.string().optional().nullable(),
    title: z.string().min(1, 'عنوان الزامی است'),
    description: z.string().optional().nullable(),
    href: z.string().optional().nullable(),
    sort_order: z.coerce.number().int().optional().default(0),
    is_active: z.coerce.number().int().min(0).max(1).optional().default(1)
});

content.post('/admin/blocks', adminRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = blockSchema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const d = parsed.data;
    const r = db.prepare(`INSERT INTO site_blocks (page, section, icon, image, title, description, href, sort_order, is_active)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(d.page, d.section, d.icon || null, d.image || null, d.title, d.description || null, d.href || null, d.sort_order, d.is_active);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'create', entity_type: 'site_block', entity_id: r.lastInsertRowid });
    return c.json({ success: true, data: { id: r.lastInsertRowid }, message: 'بلوک ایجاد شد', code: 200 });
});

content.put('/admin/blocks/:id', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json().catch(() => ({}));
    const parsed = blockSchema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const d = parsed.data;
    db.prepare(`UPDATE site_blocks
                SET page = ?, section = ?, icon = ?, image = ?, title = ?, description = ?, href = ?,
                    sort_order = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`)
        .run(d.page, d.section, d.icon || null, d.image || null, d.title, d.description || null, d.href || null, d.sort_order, d.is_active, id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update', entity_type: 'site_block', entity_id: id });
    return c.json({ success: true, message: 'بلوک به‌روزرسانی شد', code: 200 });
});

content.delete('/admin/blocks/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    db.prepare(`DELETE FROM site_blocks WHERE id = ?`).run(id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'site_block', entity_id: id });
    return c.json({ success: true, message: 'بلوک حذف شد', code: 200 });
});

// ---------------- Admin: site_pages CRUD (upsert by page+section) ----------------

content.get('/admin/pages', adminRequired, (c) => {
    const items = db.prepare(`SELECT * FROM site_pages ORDER BY page ASC, section ASC`).all();
    return c.json({ success: true, data: items, code: 200 });
});

const pageSchema = z.object({
    page: z.string().min(1, 'page الزامی است'),
    section: z.string().min(1, 'section الزامی است'),
    title: z.string().optional().nullable(),
    subtitle: z.string().optional().nullable(),
    body: z.string().optional().nullable(),
    seo_title: z.string().optional().nullable(),
    seo_description: z.string().optional().nullable(),
    seo_keywords: z.string().optional().nullable(),
    is_active: z.coerce.number().int().min(0).max(1).optional().default(1)
});

content.post('/admin/pages', adminRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = pageSchema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const d = parsed.data;
    const r = db.prepare(`INSERT INTO site_pages (page, section, title, subtitle, body, seo_title, seo_description, seo_keywords, is_active)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                          ON CONFLICT(page, section) DO UPDATE SET
                              title = excluded.title,
                              subtitle = excluded.subtitle,
                              body = excluded.body,
                              seo_title = excluded.seo_title,
                              seo_description = excluded.seo_description,
                              seo_keywords = excluded.seo_keywords,
                              is_active = excluded.is_active,
                              updated_at = CURRENT_TIMESTAMP`)
        .run(d.page, d.section, d.title || null, d.subtitle || null, d.body || null, d.seo_title || null, d.seo_description || null, d.seo_keywords || null, d.is_active);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'upsert', entity_type: 'site_page', entity_id: r.lastInsertRowid });
    return c.json({ success: true, data: { id: r.lastInsertRowid }, message: 'صفحه ذخیره شد', code: 200 });
});

content.put('/admin/pages/:id', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json().catch(() => ({}));
    const parsed = pageSchema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const d = parsed.data;
    db.prepare(`UPDATE site_pages
                SET page = ?, section = ?, title = ?, subtitle = ?, body = ?,
                    seo_title = ?, seo_description = ?, seo_keywords = ?,
                    is_active = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`)
        .run(d.page, d.section, d.title || null, d.subtitle || null, d.body || null, d.seo_title || null, d.seo_description || null, d.seo_keywords || null, d.is_active, id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update', entity_type: 'site_page', entity_id: id });
    return c.json({ success: true, message: 'صفحه به‌روزرسانی شد', code: 200 });
});

content.delete('/admin/pages/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    db.prepare(`DELETE FROM site_pages WHERE id = ?`).run(id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'site_page', entity_id: id });
    return c.json({ success: true, message: 'صفحه حذف شد', code: 200 });
});

// ---------------- SSR helpers ----------------
// Synchronous helpers used directly from view templates to fetch content blocks/pages.
// Returns [] / null if the tables don't exist yet (graceful on first boot before seed).

export function getBlocks(page, section) {
    try {
        return db.prepare(`SELECT id, page, section, icon, image, title, description, href, sort_order
                           FROM site_blocks
                           WHERE is_active = 1 AND page = ? AND section = ?
                           ORDER BY sort_order ASC, id ASC`).all(page, section);
    } catch (e) {
        return [];
    }
}

export function getPage(page, section) {
    try {
        return db.prepare(`SELECT id, page, section, title, subtitle, body
                           FROM site_pages
                           WHERE is_active = 1 AND page = ? AND section = ?
                           LIMIT 1`).get(page, section) || null;
    } catch (e) {
        return null;
    }
}

export default content;
