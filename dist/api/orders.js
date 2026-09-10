import { Hono } from 'hono';
import { z } from 'zod';
import db from '../db/index.js';
import { authOptional, authRequired, adminRequired } from '../middleware/auth.js';
import { generateOrderNumber, getSetting, logActivity } from '../utils/helpers.js';
import { toEnDigits } from '../utils/contact.js';
const orders = new Hono();
const orderSchema = z.object({
    customer_name: z.string().min(2, 'نام معتبر نیست'),
    customer_phone: z.string().min(10, 'شماره تلفن معتبر نیست'),
    customer_email: z.string().email('ایمیل معتبر نیست').optional().or(z.literal('')),
    shipping_address: z.string().min(5, 'آدرس معتبر نیست'),
    shipping_city: z.string().optional(),
    shipping_postal: z.string().optional(),
    notes: z.string().optional(),
    payment_method: z.enum(['card', 'gateway', 'cod']).optional(),
    items: z.array(z.object({
        product_id: z.number().int().positive(),
        quantity: z.number().int().positive()
    })).min(1, 'سبد خرید خالی است')
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
        const p = db.prepare(`SELECT * FROM products WHERE id = ? AND status = 'active'`).get(productId);
        if (!p)
            return c.json({ success: false, message: `محصول با شناسه ${productId} یافت نشد`, code: 400 }, 400);
        if (p.stock < quantity) {
            return c.json({ success: false, message: `موجودی محصول «${p.name}» کافی نیست (موجودی: ${p.stock})`, code: 400 }, 400);
        }
        const unitPrice = p.discount_price || p.price;
        const itemTotal = unitPrice * quantity;
        subtotal += itemTotal;
        validatedItems.push({ product: p, quantity, unit_price: unitPrice, total: itemTotal });
    }
    const shippingCost = parseInt(getSetting('shipping_cost', '500000'));
    const total = subtotal + shippingCost;
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
    const tx = db.transaction(() => {
        const result = db.prepare(`INSERT INTO orders (order_number, user_id, customer_name, customer_phone, customer_email, shipping_address, shipping_city, shipping_postal, notes, subtotal, shipping_cost, total, status, payment_method, payment_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'pending')`).run(orderNumber, user?.id || null, d.customer_name, d.customer_phone, d.customer_email || null, d.shipping_address, d.shipping_city || null, d.shipping_postal || null, d.notes || null, subtotal, shippingCost, total, payMethod);
        const orderId = result.lastInsertRowid;
        const itemStmt = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity, total) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const stockStmt = db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ?`);
        for (const v of validatedItems) {
            itemStmt.run(orderId, v.product.id, v.product.name, v.product.sku, v.unit_price, v.quantity, v.total);
            stockStmt.run(v.quantity, v.product.id);
        }
        return orderId;
    });
    const orderId = tx();
    logActivity({
        user_id: user?.id || null, user_name: user?.full_name || d.customer_name,
        action: 'create', entity_type: 'order', entity_id: orderId,
        details: { order_number: orderNumber, total },
        ip_address: c.req.header('x-forwarded-for') || 'local'
    });
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
    const items = db.prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) AS t FROM orders ${where}`).get(...params).t;
    return c.json({ success: true, data: { items, total, page, limit }, code: 200 });
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
            const deduct = db.prepare(`UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?`);
            for (const it of its)
                if (it.product_id)
                    deduct.run(it.quantity, it.product_id);
        }
        db.prepare(`UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newStatus, id);
    });
    tx();
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update_status', entity_type: 'order', entity_id: id, details: { new_status: newStatus } });
    return c.json({ success: true, message: 'وضعیت به‌روزرسانی شد', code: 200 });
});
orders.delete('/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const existing = db.prepare(`SELECT status FROM orders WHERE id = ?`).get(id);
    if (!existing)
        return c.json({ success: false, message: 'سفارش یافت نشد', code: 404 }, 404);
    const tx = db.transaction(() => {
        // If the order still held stock (not cancelled), return it to inventory before deleting
        if (existing.status !== 'cancelled') {
            const its = db.prepare(`SELECT product_id, quantity FROM order_items WHERE order_id = ?`).all(id);
            const restore = db.prepare(`UPDATE products SET stock = stock + ? WHERE id = ?`);
            for (const it of its)
                if (it.product_id)
                    restore.run(it.quantity, it.product_id);
        }
        db.prepare(`DELETE FROM order_items WHERE order_id = ?`).run(id);
        db.prepare(`DELETE FROM orders WHERE id = ?`).run(id);
    });
    tx();
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'order', entity_id: id });
    return c.json({ success: true, message: 'سفارش حذف شد', code: 200 });
});
export default orders;
