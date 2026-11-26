import { Hono } from 'hono';
import { z } from 'zod';
import db from '../db/index.js';
import { authOptional, authRequired, adminRequired } from '../middleware/auth.js';
import { generateOrderNumber, getSetting, logActivity, friendlyDbError } from '../utils/helpers.js';
import { toEnDigits } from '../utils/contact.js';
import { notifyOrderCreated, notifyOrderStatus } from '../utils/sms.js';
import { catVisSql } from '../utils/catvis.js';
import { searchClause } from '../utils/search.js';
const orders = new Hono();
// Round 11 (2026-11-03): max lengths = DB column sizes. Longer input used to hit
// MySQL «Data too long» -> «خطای داخلی سرور» for the customer at checkout.
const orderSchema = z.object({
    customer_name: z.string().trim().min(2, 'نام معتبر نیست').max(190, 'نام بیش از حد طولانی است'),
    customer_phone: z.string().trim().min(10, 'شماره تلفن معتبر نیست').max(32, 'شماره تلفن معتبر نیست'),
    customer_email: z.string().trim().max(190, 'ایمیل بیش از حد طولانی است').email('ایمیل معتبر نیست').optional().or(z.literal('')),
    shipping_address: z.string().trim().min(5, 'آدرس معتبر نیست').max(1000, 'آدرس بیش از حد طولانی است'),
    shipping_city: z.string().trim().max(100, 'نام شهر بیش از حد طولانی است').optional(),
    shipping_postal: z.string().trim().max(20, 'کد پستی معتبر نیست').optional(),
    notes: z.string().trim().max(2000, 'توضیحات بیش از حد طولانی است (حداکثر ۲۰۰۰ کاراکتر)').optional(),
    payment_method: z.enum(['card', 'gateway', 'cod']).optional(),
    torob_clid: z.string().trim().max(190).optional(),
    items: z.array(z.object({
        product_id: z.number().int().positive(),
        quantity: z.number().int().positive().max(10000, 'تعداد سفارش بیش از حد مجاز است')
    })).min(1, 'سبد خرید خالی است').max(100, 'تعداد اقلام سبد خرید بیش از حد مجاز است')
});
// Create order (guest or logged-in)
orders.post('/', authOptional, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = orderSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    }
    const d = parsed.data;
    // Merge duplicate product lines first: the same product_id may appear more than
    // once in the cart, and validating each line independently against the original
    // stock lets a client oversell (stock goes negative). Aggregate quantities per
    // product so the cumulative amount is checked against available stock.
    const mergedQty = new Map();
    for (const it of d.items) {
        mergedQty.set(it.product_id, (mergedQty.get(it.product_id) || 0) + it.quantity);
    }
    // Validate stock and compute totals
    let subtotal = 0;
    const validatedItems = [];
    for (const [productId, quantity] of mergedQty) {
        const p = db.prepare(`SELECT * FROM products WHERE id = ? AND status = 'active'${catVisSql('category_id')}`).get(productId);
        if (!p)
            return c.json({ success: false, message: `محصول با شناسه ${productId} یافت نشد`, code: 400 }, 400);
        if (p.stock < quantity) {
            return c.json({ success: false, message: `موجودی محصول «${p.name}» کافی نیست (موجودی: ${p.stock})`, code: 400 }, 400);
        }
        const unitPrice = p.discount_price || p.price;
        // S2 (2026-11-03): a product without a price («استعلام قیمت») must never be
        // ordered for 0 toman.
        if (!(Number(unitPrice) > 0))
            return c.json({ success: false, message: `قیمت «${p.name}» مشخص نیست — برای استعلام قیمت با کارشناسان تماس بگیرید`, code: 400 }, 400);
        const itemTotal = unitPrice * quantity;
        subtotal += itemTotal;
        validatedItems.push({ product: p, quantity, unit_price: unitPrice, total: itemTotal });
    }
    const shippingCost = parseInt(getSetting('shipping_cost', '500000'));
    // VAT (voice n9): computed ONLY here, at order submission — the storefront
    // does not show it while browsing; the final payable amount (incl. tax)
    // appears on the payment step / gateway. Per-product tax_percent overrides
    // the global setting; tax_enabled=غیرفعال disables it entirely.
    const taxEnabled = getSetting('tax_enabled', 'فعال') !== 'غیرفعال';
    const globalTaxPct = Math.max(0, Math.min(25, parseFloat(getSetting('tax_percent', '9')) || 0));
    let taxTotal = 0;
    if (taxEnabled && globalTaxPct >= 0) {
        for (const v of validatedItems) {
            const pct = (v.product.tax_percent !== null && v.product.tax_percent !== undefined && v.product.tax_percent !== '')
                ? Math.max(0, Math.min(25, parseFloat(v.product.tax_percent) || 0))
                : globalTaxPct;
            taxTotal += Math.round(v.total * pct / 100);
        }
    }
    const total = subtotal + shippingCost + taxTotal;
    const orderNumber = generateOrderNumber();
    // Resolve the payment method against what the shop actually has enabled, so a
    // client cannot pick a channel the admin turned off.
    const cardOn = getSetting('pay_card_enabled', '') === 'فعال' && String(getSetting('pay_card_number', '') || '').trim();
    const gwOn = getSetting('pay_gateway_enabled', '') === 'فعال';
    const allowed = [];
    if (cardOn) allowed.push('card');
    if (gwOn) allowed.push('gateway');
    allowed.push('cod');
    const payMethod = allowed.includes(d.payment_method) ? d.payment_method : allowed[0];
    let orderId;
    try {
        const tx = db.transaction(() => {
            const stockStmt = db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`);
            for (const v of validatedItems) {
                const sr = stockStmt.run(v.quantity, v.product.id, v.quantity);
                if (!sr || Number(sr.changes) === 0) {
                    const err = new Error(`موجودی محصول «${v.product.name}» در لحظه ثبت سفارش به پایان رسید`);
                    err.isStockRace = true;
                    throw err;
                }
            }
            const result = db.prepare(`INSERT INTO orders (order_number, user_id, customer_name, customer_phone, customer_email, shipping_address, shipping_city, shipping_postal, notes, subtotal, shipping_cost, tax, total, status, payment_method, payment_status, torob_clid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'pending', ?)`).run(orderNumber, user?.id || null, d.customer_name, d.customer_phone, d.customer_email || null, d.shipping_address, d.shipping_city || null, d.shipping_postal || null, d.notes || null, subtotal, shippingCost, taxTotal, total, payMethod, d.torob_clid || null);
            const createdOrderId = result.lastInsertRowid;
            const itemStmt = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity, total) VALUES (?, ?, ?, ?, ?, ?, ?)`);
            for (const v of validatedItems) {
                itemStmt.run(createdOrderId, v.product.id, v.product.name, v.product.sku, v.unit_price, v.quantity, v.total);
            }
            return createdOrderId;
        });
        orderId = tx();
    }
    catch (e) {
        if (e && e.isStockRace) {
            return c.json({ success: false, message: e.message, code: 409 }, 409);
        }
        throw e;
    }
    logActivity({
        user_id: user?.id || null, user_name: user?.full_name || d.customer_name,
        action: 'create', entity_type: 'order', entity_id: orderId,
        details: { order_number: orderNumber, total },
        ip_address: c.req.header('x-forwarded-for') || 'local'
    });
    notifyOrderCreated({ order_number: orderNumber, customer_name: d.customer_name, customer_phone: d.customer_phone, total });
    return c.json({ success: true, data: { id: orderId, order_number: orderNumber, total, payment_method: payMethod }, message: 'سفارش با موفقیت ثبت شد', code: 200 });
});
// List orders (admin sees all, user sees own)
orders.get('/', authRequired, (c) => {
    const user = c.get('user');
    let page = parseInt(c.req.query('page') || '1', 10);
    let limit = parseInt(c.req.query('limit') || '20', 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100;
    const status = c.req.query('status') || '';
    const offset = (page - 1) * limit;
    let where = '';
    const params = [];
    if (user.role !== 'admin') {
        where += `WHERE user_id = ?`;
        params.push(user.id);
    }
    if (status) {
        where += where ? ` AND status = ?` : `WHERE status = ?`;
        params.push(status);
    }
    // Round 6 (2026-11-03): admin search by order number / customer name / phone / email
    // (Persian-normalized: ی/ي، ک/ك، ارقام فارسی/عربی). Ignored for non-admins.
    const q = String(c.req.query('q') || '').trim().slice(0, 100);
    if (q && user.role === 'admin') {
        const sc = searchClause(q, ['order_number', 'customer_name', 'customer_phone', 'customer_email']);
        if (sc.sql) {
            where += where ? sc.sql : 'WHERE 1=1' + sc.sql;
            params.push(...sc.params);
        }
    }
    const items = db.prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS t FROM orders ${where}`).get(...params).t;
    let counts;
    if (user.role === 'admin') {
        counts = {};
        for (const r of db.prepare(`SELECT status, COUNT(*) AS n FROM orders GROUP BY status`).all()) counts[r.status] = Number(r.n);
    }
    return c.json({ success: true, data: { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), counts }, code: 200 });
});
// Get one order (admin or owner)
orders.get('/:id', authRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id);
    if (!order)
        return c.json({ success: false, message: 'سفارش یافت نشد', code: 404 }, 404);
    if (user.role !== 'admin' && order.user_id !== user.id) {
        return c.json({ success: false, message: 'دسترسی غیرمجاز', code: 403 }, 403);
    }
    const items = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).all(id);
    return c.json({ success: true, data: { ...order, items }, code: 200 });
});
// Get by order number (for confirmation page)
orders.get('/by-number/:orderNumber', authOptional, (c) => {
    const user = c.get('user');
    const orderNumber = c.req.param('orderNumber');
    const order = db.prepare(`SELECT * FROM orders WHERE order_number = ?`).get(orderNumber);
    if (!order)
        return c.json({ success: false, message: 'سفارش یافت نشد', code: 404 }, 404);
    if (user && user.role !== 'admin' && order.user_id && order.user_id !== user.id) {
        return c.json({ success: false, message: 'دسترسی غیرمجاز', code: 403 }, 403);
    }
    const items = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).all(order.id);
    return c.json({ success: true, data: { ...order, items }, code: 200 });
});
// Submit a card-to-card transfer receipt (guest or owner) — the actual "payment step"
const receiptSchema = z.object({
    payment_ref: z.preprocess((v) => (typeof v === 'string' ? toEnDigits(v).replace(/[^0-9]/g, '') : v), z.string().min(4, 'شماره پیگیری/۴ رقم آخر کارت را وارد کنید').max(40, 'شماره پیگیری بیش از حد طولانی است')),
    payment_note: z.string().max(500, 'توضیحات بیش از حد طولانی است').optional().or(z.literal(''))
});
orders.post('/by-number/:orderNumber/receipt', authOptional, async (c) => {
    const user = c.get('user');
    const orderNumber = c.req.param('orderNumber');
    const order = db.prepare(`SELECT * FROM orders WHERE order_number = ?`).get(orderNumber);
    if (!order)
        return c.json({ success: false, message: 'سفارش یافت نشد', code: 404 }, 404);
    if (user && user.role !== 'admin' && order.user_id && order.user_id !== user.id)
        return c.json({ success: false, message: 'دسترسی غیرمجاز', code: 403 }, 403);
    if (order.payment_status === 'paid')
        return c.json({ success: false, message: 'این سفارش قبلاً پرداخت‌شده ثبت شده است', code: 400 }, 400);
    const body = await c.req.json().catch(() => ({}));
    const parsed = receiptSchema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const d = parsed.data;
    db.prepare(`UPDATE orders SET payment_ref = ?, payment_note = ?, payment_status = 'awaiting_review', payment_method = COALESCE(payment_method, 'card'), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(d.payment_ref, (d.payment_note || '').trim() || null, order.id);
    logActivity({
        user_id: user?.id || null, user_name: user?.full_name || order.customer_name,
        action: 'payment_receipt', entity_type: 'order', entity_id: order.id,
        details: { order_number: orderNumber, payment_ref: d.payment_ref },
        ip_address: c.req.header('x-forwarded-for') || 'local'
    });
    return c.json({ success: true, message: 'رسید پرداخت شما ثبت شد و پس از بررسی تایید می‌شود', code: 200 });
});

// Update payment status (admin only)
orders.put('/:id/payment', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({ payment_status: z.enum(['pending', 'awaiting_review', 'paid', 'failed', 'refunded']) });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: 'وضعیت پرداخت نامعتبر', code: 400 }, 400);
    const existing = db.prepare(`SELECT id FROM orders WHERE id = ?`).get(id);
    if (!existing)
        return c.json({ success: false, message: 'سفارش یافت نشد', code: 404 }, 404);
    const ps = parsed.data.payment_status;
    db.prepare(`UPDATE orders SET payment_status = ?, paid_at = CASE WHEN ? = 'paid' THEN CURRENT_TIMESTAMP ELSE paid_at END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(ps, ps, id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update_payment', entity_type: 'order', entity_id: id, details: { payment_status: ps } });
    if (ps === 'paid' || ps === 'failed' || ps === 'refunded') notifyOrderStatus(id, ps);
    return c.json({ success: true, message: 'وضعیت پرداخت به‌روزرسانی شد', code: 200 });
});

// Update status (admin only)
orders.put('/:id/status', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({ status: z.enum(['pending', 'confirmed', 'shipping', 'delivered', 'cancelled']) });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: 'وضعیت نامعتبر', code: 400 }, 400);
    const existing = db.prepare(`SELECT status FROM orders WHERE id = ?`).get(id);
    if (!existing)
        return c.json({ success: false, message: 'سفارش یافت نشد', code: 404 }, 404);
    const newStatus = parsed.data.status;
    const tx = db.transaction(() => {
        // Restore stock when an order transitions INTO cancelled (only once)
        if (newStatus === 'cancelled' && existing.status !== 'cancelled') {
            const its = db.prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`).all(id);
            const restore = db.prepare(`UPDATE products SET stock = stock + ? WHERE id = ?`);
            for (const it of its)
                if (it.product_id)
                    restore.run(it.quantity, it.product_id);
        }
        // Re-deduct stock when an order is reactivated OUT of cancelled
        if (existing.status === 'cancelled' && newStatus !== 'cancelled') {
            const its = db.prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`).all(id);
            const deduct = db.prepare(`UPDATE products SET stock = CASE WHEN stock - ? < 0 THEN 0 ELSE stock - ? END WHERE id = ?`); // portable (MAX(0,x) is SQLite-only)
            for (const it of its)
                if (it.product_id)
                    deduct.run(it.quantity, it.quantity, it.product_id);
        }
        db.prepare(`UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newStatus, id);
    });
    tx();
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update_status', entity_type: 'order', entity_id: id, details: { new_status: newStatus } });
    if (existing.status !== newStatus) notifyOrderStatus(id, newStatus);
    return c.json({ success: true, message: 'وضعیت به‌روزرسانی شد', code: 200 });
});
// =====================================================================
//  2026-11-03 (owner voice note): «یه گزینه پاک شدن بذار ... سفارش‌های تستی
//  در انتظار رو با یه دکمه پاک کنم». Bulk delete by ids OR by status filter.
//  Same safety rules as the single delete: stock that an order still holds
//  (pending / confirmed / shipping) goes back to inventory; delivered and
//  cancelled orders never touch stock again.
// =====================================================================
const STOCK_HOLDING = new Set(['pending', 'confirmed', 'shipping']);
function deleteOrdersTx(rows) {
    const itemsStmt = db.prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`);
    const restore = db.prepare(`UPDATE products SET stock = stock + ? WHERE id = ?`);
    const delItems = db.prepare(`DELETE FROM order_items WHERE order_id = ?`);
    const delOrder = db.prepare(`DELETE FROM orders WHERE id = ?`);
    const tx = db.transaction(() => {
        for (const o of rows) {
            if (STOCK_HOLDING.has(o.status)) {
                for (const it of itemsStmt.all(o.id))
                    if (it.product_id) restore.run(it.quantity, it.product_id);
            }
            delItems.run(o.id);
            delOrder.run(o.id);
        }
    });
    tx();
}
orders.post('/bulk-delete', adminRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({
        ids: z.array(z.number().int().positive()).max(2000).optional(),
        status: z.enum(['all', 'pending', 'confirmed', 'shipping', 'delivered', 'cancelled']).optional(),
        confirm: z.string().optional()
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: 'ورودی نامعتبر است', code: 400 }, 400);
    const d = parsed.data;
    let rows = [];
    if (d.ids && d.ids.length) {
        rows = db.prepare(`SELECT id, status FROM orders WHERE id IN (${d.ids.map(() => '?').join(',')})`).all(...d.ids);
    }
    else if (d.status) {
        // deleting by filter is destructive -> the client must echo a confirm word
        if (d.confirm !== 'DELETE')
            return c.json({ success: false, message: 'تأیید حذف گروهی ارسال نشده است', code: 400 }, 400);
        rows = d.status === 'all'
            ? db.prepare(`SELECT id, status FROM orders`).all()
            : db.prepare(`SELECT id, status FROM orders WHERE status = ?`).all(d.status);
    }
    else {
        return c.json({ success: false, message: 'سفارشی برای حذف انتخاب نشده است', code: 400 }, 400);
    }
    if (!rows.length)
        return c.json({ success: true, data: { deleted: 0 }, message: 'سفارشی برای حذف پیدا نشد', code: 200 });
    try { deleteOrdersTx(rows); }
    catch (e) {
        console.error('[orders.bulk-delete]', e?.message);
        return c.json({ success: false, message: friendlyDbError(e, 'خطا در حذف سفارش‌ها'), code: 400 }, 400);
    }
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'bulk_delete', entity_type: 'order', entity_id: 0, details: { count: rows.length, by: d.ids ? 'ids' : 'status:' + d.status } });
    return c.json({ success: true, data: { deleted: rows.length }, message: `${rows.length} سفارش حذف شد`, code: 200 });
});
orders.delete('/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const existing = db.prepare(`SELECT id, status FROM orders WHERE id = ?`).get(id);
    if (!existing)
        return c.json({ success: false, message: 'سفارش یافت نشد', code: 404 }, 404);
    try { deleteOrdersTx([existing]); }
    catch (e) { return c.json({ success: false, message: friendlyDbError(e, 'خطا در حذف سفارش'), code: 400 }, 400); }
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'order', entity_id: id });
    return c.json({ success: true, message: 'سفارش حذف شد', code: 200 });
});
export default orders;
