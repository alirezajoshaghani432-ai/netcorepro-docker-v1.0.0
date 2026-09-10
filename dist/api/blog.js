import { Hono } from 'hono';
import { z } from 'zod';
import db from '../db/index.js';
import { authOptional, adminRequired } from '../middleware/auth.js';
import { logActivity } from '../utils/helpers.js';
const blog = new Hono();
// Public posts list
blog.get('/posts', (c) => {
    let page = parseInt(c.req.query('page') || '1', 10);
    let limit = parseInt(c.req.query('limit') || '9', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 9;
    if (limit > 100) limit = 100;
    const offset = (page - 1) * limit;
    const q = c.req.query('q') || '';
    let where = `WHERE status = 'published'`;
    const params = [];
    if (q) {
        // Escape LIKE metacharacters (\ % _) so a literal % or _ in the query
        // is matched as text instead of acting as a wildcard.
        const esc = q.replace(/[\\%_]/g, (ch) => '\\' + ch);
        where += ` AND (title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\')`;
        params.push(`%${esc}%`, `%${esc}%`);
    }
    const items = db.prepare(`SELECT id, title, slug, excerpt, cover_image, category, views, created_at FROM posts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS t FROM posts ${where}`).get(...params).t;
    return c.json({ success: true, data: { items, total, page, limit, pages: Math.ceil(total / limit) }, code: 200 });
});
// Single post by slug + approved comments
blog.get('/posts/:slug', (c) => {
    const slug = c.req.param('slug');
    const post = db.prepare(`SELECT * FROM posts WHERE slug = ? AND status = 'published'`).get(slug);
    if (!post)
        return c.json({ success: false, message: 'مقاله یافت نشد', code: 404 }, 404);
    db.prepare(`UPDATE posts SET views = views + 1 WHERE id = ?`).run(post.id);
    const comments = db.prepare(`SELECT id, author_name, content, created_at FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at DESC`).all(post.id);
    return c.json({ success: true, data: { post, comments }, code: 200 });
});
// Submit a comment (any visitor)
blog.post('/posts/:id/comments', authOptional, async (c) => {
    const user = c.get('user');
    const postId = parseInt(c.req.param('id') || '0');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({
        author_name: z.string().min(2, 'نام معتبر نیست'),
        author_email: z.string().email('ایمیل معتبر نیست').optional().or(z.literal('')),
        content: z.string().min(3, 'متن دیدگاه معتبر نیست')
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const post = db.prepare(`SELECT id FROM posts WHERE id = ?`).get(postId);
    if (!post)
        return c.json({ success: false, message: 'مقاله یافت نشد', code: 404 }, 404);
    const r = db.prepare(`INSERT INTO comments (post_id, user_id, author_name, author_email, content, status) VALUES (?, ?, ?, ?, ?, 'pending')`).run(postId, user?.id || null, parsed.data.author_name, parsed.data.author_email || null, parsed.data.content);
    logActivity({ user_id: user?.id || null, user_name: parsed.data.author_name, action: 'create', entity_type: 'comment', entity_id: r.lastInsertRowid });
    return c.json({ success: true, message: 'دیدگاه شما ثبت شد و پس از تایید نمایش داده می‌شود', code: 200 });
});
// === Admin Posts CRUD ===
const postSchema = z.object({
    title: z.string().min(3),
    slug: z.string().min(3),
    excerpt: z.string().optional(),
    content: z.string().min(10),
    cover_image: z.string().optional(),
    category: z.string().optional(),
    tags: z.string().optional(),
    status: z.enum(['draft', 'published']).optional()
});
blog.post('/admin/posts', adminRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json();
    const parsed = postSchema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const d = parsed.data;
    try {
        const r = db.prepare(`INSERT INTO posts (title, slug, excerpt, content, cover_image, author_id, category, tags, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.title, d.slug, d.excerpt || null, d.content, d.cover_image || null, user.id, d.category || null, d.tags || null, d.status || 'published');
        logActivity({ user_id: user.id, user_name: user.full_name, action: 'create', entity_type: 'post', entity_id: r.lastInsertRowid, details: { title: d.title } });
        return c.json({ success: true, data: { id: r.lastInsertRowid }, message: 'مقاله ایجاد شد', code: 200 });
    }
    catch (e) {
        return c.json({ success: false, message: 'خطا: ' + e.message, code: 400 }, 400);
    }
});
blog.put('/admin/posts/:id', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json();
    const parsed = postSchema.partial().safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const fields = [];
    const vals = [];
    Object.entries(parsed.data).forEach(([k, v]) => { if (v !== undefined) {
        fields.push(`${k} = ?`);
        vals.push(v);
    } });
    if (!fields.length)
        return c.json({ success: false, message: 'فیلدی برای ویرایش نیست', code: 400 }, 400);
    vals.push(id);
    try {
        db.prepare(`UPDATE posts SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...vals);
    }
    catch (e) {
        // UNIQUE slug conflict etc. -> clear 400 instead of a 500 crash
        const msg = /UNIQUE/i.test(e?.message || '') ? 'این نامک (slug) قبلاً برای مقالهٔ دیگری استفاده شده است' : 'خطا در به‌روزرسانی مقاله';
        return c.json({ success: false, message: msg, code: 400 }, 400);
    }
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update', entity_type: 'post', entity_id: id });
    return c.json({ success: true, message: 'مقاله به‌روزرسانی شد', code: 200 });
});
blog.delete('/admin/posts/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    db.prepare(`DELETE FROM posts WHERE id = ?`).run(id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'post', entity_id: id });
    return c.json({ success: true, message: 'مقاله حذف شد', code: 200 });
});
blog.get('/admin/posts', adminRequired, (c) => {
    const items = db.prepare(`SELECT * FROM posts ORDER BY created_at DESC`).all();
    return c.json({ success: true, data: items, code: 200 });
});
// === Admin Comments ===
blog.get('/admin/comments', adminRequired, (c) => {
    const status = c.req.query('status') || '';
    let where = '';
    const params = [];
    if (status) {
        where = `WHERE c.status = ?`;
        params.push(status);
    }
    const items = db.prepare(`SELECT c.*, p.title AS post_title, p.slug AS post_slug FROM comments c LEFT JOIN posts p ON c.post_id = p.id ${where} ORDER BY c.created_at DESC`).all(...params);
    return c.json({ success: true, data: items, code: 200 });
});
blog.put('/admin/comments/:id/status', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({ status: z.enum(['pending', 'approved', 'rejected']) });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: 'وضعیت نامعتبر', code: 400 }, 400);
    db.prepare(`UPDATE comments SET status = ? WHERE id = ?`).run(parsed.data.status, id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: parsed.data.status === 'approved' ? 'approve' : (parsed.data.status === 'rejected' ? 'reject' : 'update'), entity_type: 'comment', entity_id: id });
    return c.json({ success: true, message: 'وضعیت به‌روزرسانی شد', code: 200 });
});
blog.delete('/admin/comments/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    db.prepare(`DELETE FROM comments WHERE id = ?`).run(id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'comment', entity_id: id });
    return c.json({ success: true, message: 'دیدگاه حذف شد', code: 200 });
});
export default blog;
