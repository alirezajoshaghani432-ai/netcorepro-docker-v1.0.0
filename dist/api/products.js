import { Hono } from 'hono';
import { z } from 'zod';
import db from '../db/index.js';
import { adminRequired } from '../middleware/auth.js';
import { logActivity } from '../utils/helpers.js';
const products = new Hono();
// Collect a category id and all of its descendant ids (nested subcategories)
export function categoryDescendantIds(rootId) {
    const ids = [rootId];
    const stmt = db.prepare(`SELECT id FROM categories WHERE parent_id = ?`);
    const queue = [rootId];
    while (queue.length) {
        const cur = queue.shift();
        for (const row of stmt.all(cur)) {
            if (!ids.includes(row.id)) {
                ids.push(row.id);
                queue.push(row.id);
            }
        }
    }
    return ids;
}
// Public list with filters
products.get('/', (c) => {
    const q = c.req.query('q') || '';
    const category = c.req.query('category') || '';
    const brand = c.req.query('brand') || '';
    const sort = c.req.query('sort') || 'newest';
    // sanitize pagination: reject NaN / negative / oversized values to avoid
    // SQL "LIMIT NaN" 500s and prevent pulling the whole table (DoS).
    let page = parseInt(c.req.query('page') || '1', 10);
    let limit = parseInt(c.req.query('limit') || '12', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 12;
    if (limit > 100) limit = 100;
    const offset = (page - 1) * limit;
    let where = `WHERE p.status = 'active'`;
    const params = [];
    if (q) {
        // Escape LIKE metacharacters (\ % _) so a literal % or _ in the query
        // is matched as text instead of acting as a wildcard.
        const esc = q.replace(/[\\%_]/g, (ch) => '\\' + ch);
        where += ` AND (p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\')`;
        params.push(`%${esc}%`, `%${esc}%`, `%${esc}%`);
    }
    if (category) {
        // include nested subcategories: products in the category OR any descendant
        const cat = db.prepare(`SELECT id FROM categories WHERE slug = ?`).get(category);
        if (cat) {
            const ids = categoryDescendantIds(cat.id);
            where += ` AND p.category_id IN (${ids.map(() => '?').join(',')})`;
            params.push(...ids);
        }
        else {
            where += ` AND c.slug = ?`;
            params.push(category);
        }
    }
    if (brand) {
        where += ` AND b.slug = ?`;
        params.push(brand);
    }
    // Default: inside a category the manual drag & drop ordering
    // (sort_order) wins with created_at as tie-breaker; the global list stays
    // newest-first (sort_order values are per-category positions).
    let order = category ? 'p.sort_order ASC, p.created_at DESC' : 'p.created_at DESC';
    if (sort === 'price_asc')
        order = 'COALESCE(p.discount_price, p.price) ASC';
    else if (sort === 'price_desc')
        order = 'COALESCE(p.discount_price, p.price) DESC';
    else if (sort === 'popular')
        order = 'p.views DESC';
    else if (sort === 'manual')
        order = 'p.sort_order ASC, p.id ASC';
    const sql = `SELECT p.*, c.name AS category_name, c.slug AS category_slug, b.name AS brand_name, b.slug AS brand_slug
               FROM products p
               LEFT JOIN categories c ON p.category_id = c.id
               LEFT JOIN brands b ON p.brand_id = b.id
               ${where} ORDER BY ${order} LIMIT ? OFFSET ?`;
    const items = db.prepare(sql).all(...params, limit, offset);
    const countSql = `SELECT COUNT(*) AS total FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    LEFT JOIN brands b ON p.brand_id = b.id ${where}`;
    const total = db.prepare(countSql).get(...params).total;
    return c.json({ success: true, data: { items, total, page, limit, pages: Math.ceil(total / limit) }, code: 200 });
});
products.get('/featured', (c) => {
    const items = db.prepare(`SELECT p.*, c.name AS category_name, c.slug AS category_slug, b.name AS brand_name FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN brands b ON p.brand_id = b.id WHERE p.featured = 1 AND p.status = 'active' LIMIT 8`).all();
    return c.json({ success: true, data: items, code: 200 });
});
products.get('/categories', (c) => {
    const cats = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id AND status = 'active') AS product_count FROM categories c ORDER BY sort_order, name`).all();
    return c.json({ success: true, data: cats, code: 200 });
});
products.get('/brands', (c) => {
    const brands = db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM products WHERE brand_id = b.id AND status = 'active') AS product_count FROM brands b ORDER BY name`).all();
    return c.json({ success: true, data: brands, code: 200 });
});
// Admin: fetch one product by id (always fresh from DB — used by the edit modal
// so it never shows stale data from the previously rendered list row)
products.get('/id/:id', adminRequired, (c) => {
    const id = parseInt(c.req.param('id') || '0');
    const product = db.prepare(`SELECT p.* FROM products p WHERE p.id = ?`).get(id);
    if (!product)
        return c.json({ success: false, message: 'محصول یافت نشد', code: 404 }, 404);
    c.header('Cache-Control', 'no-store');
    return c.json({ success: true, data: product, code: 200 });
});
products.get('/:slug', (c) => {
    const slug = c.req.param('slug');
    const product = db.prepare(`SELECT p.*, c.name AS category_name, c.slug AS category_slug, b.name AS brand_name, b.slug AS brand_slug FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN brands b ON p.brand_id = b.id WHERE p.slug = ? AND p.status = 'active'`).get(slug);
    if (!product)
        return c.json({ success: false, message: 'محصول یافت نشد', code: 404 }, 404);
    db.prepare(`UPDATE products SET views = views + 1 WHERE slug = ?`).run(slug);
    const related = db.prepare(`SELECT p.*, b.name AS brand_name FROM products p LEFT JOIN brands b ON p.brand_id = b.id WHERE p.category_id = ? AND p.id != ? AND p.status = 'active' LIMIT 4`).all(product.category_id, product.id);
    return c.json({ success: true, data: { product, related }, code: 200 });
});
// Admin CRUD
const productSchema = z.object({
    name: z.string().min(2),
    slug: z.string().min(2),
    sku: z.string().optional(),
    category_id: z.number().int().positive(),
    brand_id: z.number().int().positive().optional().nullable(),
    description: z.string().optional(),
    short_description: z.string().optional(),
    price: z.number().int().nonnegative(),
    discount_price: z.number().int().nonnegative().optional().nullable(),
    stock: z.number().int().nonnegative(),
    image: z.string().optional(),
    gallery: z.string().optional().nullable(), // JSON array of image URLs
    specs: z.string().optional().nullable(), // JSON array of {group?,key,value}
    key_features: z.string().optional().nullable(), // JSON array of strings
    guarantee: z.string().optional().nullable(), // guarantee type shown on PDP
    seo_title: z.string().optional().nullable(),
    seo_description: z.string().optional().nullable(),
    seo_keywords: z.string().optional().nullable(),
    sort_order: z.number().int().optional(),
    featured: z.number().optional(),
    status: z.enum(['active', 'inactive']).optional()
});
function validJsonOrNull(v) {
    if (v === undefined || v === null || v === '')
        return null;
    try {
        JSON.parse(v);
        return v;
    }
    catch {
        return null;
    }
}
// Public: submit a comment on a product (pending moderation)
products.post('/:id/comments', async (c) => {
    const id = parseInt(c.req.param('id') || '0');
    const p = db.prepare(`SELECT id FROM products WHERE id = ? AND status = 'active'`).get(id);
    if (!p)
        return c.json({ success: false, message: 'محصول یافت نشد', code: 404 }, 404);
    let body;
    try {
        body = await c.req.json();
    }
    catch {
        return c.json({ success: false, message: 'درخواست نامعتبر', code: 400 }, 400);
    }
    const name = String(body.author_name || '').trim();
    const content = String(body.content || '').trim();
    const email = String(body.author_email || '').trim() || null;
    if (name.length < 2 || content.length < 3)
        return c.json({ success: false, message: 'نام و متن دیدگاه الزامی است', code: 400 }, 400);
    if (name.length > 100 || content.length > 2000)
        return c.json({ success: false, message: 'متن دیدگاه بیش از حد طولانی است', code: 400 }, 400);
    db.prepare(`INSERT INTO comments (product_id, author_name, author_email, content, status) VALUES (?, ?, ?, ?, 'pending')`).run(id, name, email, content);
    return c.json({ success: true, message: 'دیدگاه شما ثبت شد و پس از تایید نمایش داده می‌شود', code: 200 });
});
products.post('/', adminRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json();
    const parsed = productSchema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const d = parsed.data;
    // F2: never fail on a duplicate slug — auto-append -2, -3, ... to make it unique.
    // (A duplicate SKU is a real business conflict and still returns a clear error.)
    {
        const base = d.slug;
        let candidate = base;
        let n = 2;
        while (db.prepare(`SELECT id FROM products WHERE slug = ?`).get(candidate)) {
            candidate = `${base}-${n++}`;
        }
        d.slug = candidate;
    }
    if (d.sku) {
        const dupSku = db.prepare(`SELECT id, name FROM products WHERE sku = ?`).get(d.sku);
        if (dupSku)
            return c.json({ success: false, message: `کد محصول (SKU) تکراری است — قبلاً برای «${dupSku.name}» ثبت شده`, code: 400 }, 400);
    }
    try {
        const r = db.prepare(`INSERT INTO products (name, slug, sku, category_id, brand_id, description, short_description, price, discount_price, stock, image, gallery, specs, key_features, guarantee, seo_title, seo_description, seo_keywords, sort_order, featured, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(d.name, d.slug, d.sku || null, d.category_id, d.brand_id || null, d.description || null, d.short_description || null, d.price, d.discount_price || null, d.stock, d.image || null, validJsonOrNull(d.gallery), validJsonOrNull(d.specs), validJsonOrNull(d.key_features), d.guarantee || null, d.seo_title || null, d.seo_description || null, d.seo_keywords || null, d.sort_order ?? 0, d.featured || 0, d.status || 'active');
        logActivity({ user_id: user.id, user_name: user.full_name, action: 'create', entity_type: 'product', entity_id: r.lastInsertRowid, details: { name: d.name } });
        return c.json({ success: true, data: { id: r.lastInsertRowid }, message: 'محصول ایجاد شد', code: 200 });
    }
    catch (e) {
        const msg = /UNIQUE/i.test(e?.message || '') ? 'نامک (slug) یا کد محصول (SKU) تکراری است' : 'خطا: ' + (e.message || '');
        return c.json({ success: false, message: msg, code: 400 }, 400);
    }
});
products.put('/:id', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json();
    const parsed = productSchema.partial().safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const d = parsed.data;
    if ('gallery' in d)
        d.gallery = validJsonOrNull(d.gallery);
    if ('specs' in d)
        d.specs = validJsonOrNull(d.specs);
    if ('key_features' in d)
        d.key_features = validJsonOrNull(d.key_features);
    const fields = [];
    const vals = [];
    Object.entries(d).forEach(([k, v]) => { if (v !== undefined) {
        fields.push(`${k} = ?`);
        vals.push(v);
    } });
    if (!fields.length)
        return c.json({ success: false, message: 'هیچ فیلدی برای ویرایش نیست', code: 400 }, 400);
    vals.push(id);
    try {
        db.prepare(`UPDATE products SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...vals);
    }
    catch (e) {
        // UNIQUE slug/sku conflict etc. -> clear 400 instead of a 500 crash
        const msg = /UNIQUE/i.test(e?.message || '') ? 'نامک (slug) یا کد محصول (SKU) تکراری است' : 'خطا در به‌روزرسانی محصول';
        return c.json({ success: false, message: msg, code: 400 }, 400);
    }
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update', entity_type: 'product', entity_id: id });
    return c.json({ success: true, message: 'محصول به‌روزرسانی شد', code: 200 });
});
// Admin: drag & drop reorder — receives ordered array of product ids
products.post('/reorder', adminRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({ ids: z.array(z.number().int().positive()).min(1) });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: 'لیست شناسه‌ها نامعتبر است', code: 400 }, 400);
    const stmt = db.prepare(`UPDATE products SET sort_order = ? WHERE id = ?`);
    const tx = db.transaction((ids) => { ids.forEach((pid, i) => stmt.run(i + 1, pid)); });
    tx(parsed.data.ids);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'reorder', entity_type: 'product', entity_id: 0, details: { count: parsed.data.ids.length } });
    return c.json({ success: true, message: 'ترتیب محصولات ذخیره شد', code: 200 });
});
// Admin: bulk price adjustment by category (percent +/- ), includes nested subcategories
products.post('/bulk-price', adminRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({
        // target: category (with optional children) OR brand OR all products
        category_id: z.number().int().positive().optional(),
        brand_id: z.number().int().positive().optional(),
        // mode: percent (default, -90..500) OR fixed amount in toman (+/-)
        mode: z.enum(['percent', 'amount']).optional(),
        percent: z.number().min(-90).max(500).optional(),
        amount: z.number().int().optional(),
        apply_to: z.enum(['price', 'discount_price', 'both']).optional(),
        include_children: z.boolean().optional()
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: 'ورودی نامعتبر است (درصد بین ۹۰- تا ۵۰۰)', code: 400 }, 400);
    const d2 = parsed.data;
    const mode = d2.mode || 'percent';
    if (mode === 'percent' && typeof d2.percent !== 'number')
        return c.json({ success: false, message: 'درصد تغییر را وارد کنید', code: 400 }, 400);
    if (mode === 'amount' && (typeof d2.amount !== 'number' || d2.amount === 0))
        return c.json({ success: false, message: 'مبلغ تغییر را وارد کنید', code: 400 }, 400);
    if (!d2.category_id && !d2.brand_id)
        return c.json({ success: false, message: 'دسته‌بندی یا برند هدف را انتخاب کنید', code: 400 }, 400);
    const applyTo = d2.apply_to || 'both';
    // Build target WHERE
    let targetWhere = '';
    const targetParams = [];
    if (d2.category_id) {
        const ids = d2.include_children === false ? [d2.category_id] : categoryDescendantIds(d2.category_id);
        targetWhere = `category_id IN (${ids.map(() => '?').join(',')})`;
        targetParams.push(...ids);
    }
    if (d2.brand_id) {
        targetWhere = (targetWhere ? targetWhere + ' AND ' : '') + 'brand_id = ?';
        targetParams.push(d2.brand_id);
    }
    let changed = 0;
    const tx = db.transaction(() => {
        if (mode === 'percent') {
            const factor = 1 + d2.percent / 100;
            if (applyTo === 'price' || applyTo === 'both') {
                const r = db.prepare(`UPDATE products SET price = MAX(0, CAST(ROUND(price * ?) AS INTEGER)), updated_at = CURRENT_TIMESTAMP WHERE ${targetWhere}`).run(factor, ...targetParams);
                changed += r.changes;
            }
            if (applyTo === 'discount_price' || applyTo === 'both') {
                const r = db.prepare(`UPDATE products SET discount_price = MAX(0, CAST(ROUND(discount_price * ?) AS INTEGER)), updated_at = CURRENT_TIMESTAMP WHERE ${targetWhere} AND discount_price IS NOT NULL`).run(factor, ...targetParams);
                if (applyTo === 'discount_price') changed += r.changes;
            }
        }
        else {
            const amt = d2.amount;
            if (applyTo === 'price' || applyTo === 'both') {
                const r = db.prepare(`UPDATE products SET price = MAX(0, price + ?), updated_at = CURRENT_TIMESTAMP WHERE ${targetWhere}`).run(amt, ...targetParams);
                changed += r.changes;
            }
            if (applyTo === 'discount_price' || applyTo === 'both') {
                const r = db.prepare(`UPDATE products SET discount_price = MAX(0, discount_price + ?), updated_at = CURRENT_TIMESTAMP WHERE ${targetWhere} AND discount_price IS NOT NULL`).run(amt, ...targetParams);
                if (applyTo === 'discount_price') changed += r.changes;
            }
        }
    });
    tx();
    const magnitude = mode === 'percent' ? Math.abs(d2.percent) + '٪' : new Intl.NumberFormat('fa-IR').format(Math.abs(d2.amount)) + ' تومان';
    const dir = (mode === 'percent' ? d2.percent : d2.amount) >= 0 ? 'افزایش' : 'کاهش';
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'bulk_price', entity_type: 'product', entity_id: d2.category_id || d2.brand_id || 0, details: { mode, percent: d2.percent, amount: d2.amount, applyTo, changed } });
    return c.json({ success: true, message: `قیمت ${changed} محصول ${dir} یافت (${magnitude})`, data: { changed }, code: 200 });
});
products.delete('/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const exists = db.prepare(`SELECT id FROM products WHERE id = ?`).get(id);
    if (!exists)
        return c.json({ success: false, message: 'محصول یافت نشد', code: 404 }, 404);
    // If the product is referenced by existing order items, a hard delete would
    // violate the FK constraint (SQLITE_CONSTRAINT_FOREIGNKEY -> 500) and would
    // also corrupt order history. Soft-delete (deactivate) instead so past orders
    // keep their reference; only hard-delete products that were never ordered.
    const referenced = db.prepare(`SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1`).get(id);
    if (referenced) {
        db.prepare(`UPDATE products SET status = 'inactive', featured = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
        logActivity({ user_id: user.id, user_name: user.full_name, action: 'archive', entity_type: 'product', entity_id: id, details: { reason: 'referenced_by_orders' } });
        return c.json({ success: true, message: 'این محصول در سفارش‌ها استفاده شده و بایگانی (غیرفعال) شد', code: 200 });
    }
    db.prepare(`DELETE FROM products WHERE id = ?`).run(id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'product', entity_id: id });
    return c.json({ success: true, message: 'محصول حذف شد', code: 200 });
});
export default products;
