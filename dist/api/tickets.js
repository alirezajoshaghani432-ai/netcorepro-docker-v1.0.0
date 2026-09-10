import { Hono } from 'hono';
import { z } from 'zod';
import db from '../db/index.js';
import { authOptional, authRequired, adminRequired } from '../middleware/auth.js';
import { generateTicketNumber, logActivity } from '../utils/helpers.js';
const tickets = new Hono();
const ticketSchema = z.object({
    subject: z.string().min(3, 'موضوع حداقل 3 کاراکتر'),
    message: z.string().min(5, 'پیام حداقل 5 کاراکتر'),
    guest_name: z.string().optional(),
    guest_email: z.string().email().optional().or(z.literal('')),
    guest_phone: z.string().optional(),
    priority: z.enum(['low', 'normal', 'high']).optional()
});
// Create ticket (logged-in or guest)
tickets.post('/', authOptional, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const parsed = ticketSchema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const d = parsed.data;
    if (!user && !d.guest_name)
        return c.json({ success: false, message: 'نام و ایمیل برای کاربر مهمان لازم است', code: 400 }, 400);
    const ticketNumber = generateTicketNumber();
    const r = db.prepare(`INSERT INTO tickets (ticket_number, user_id, guest_name, guest_email, guest_phone, subject, message, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`).run(ticketNumber, user?.id || null, d.guest_name || null, d.guest_email || null, d.guest_phone || null, d.subject, d.message, d.priority || 'normal');
    logActivity({ user_id: user?.id || null, user_name: user?.full_name || d.guest_name, action: 'create', entity_type: 'ticket', entity_id: r.lastInsertRowid, details: { ticket_number: ticketNumber } });
    return c.json({ success: true, data: { id: r.lastInsertRowid, ticket_number: ticketNumber }, message: 'تیکت با موفقیت ثبت شد', code: 200 });
});
// List
tickets.get('/', authRequired, (c) => {
    const user = c.get('user');
    let where = '';
    const params = [];
    if (user.role !== 'admin') {
        where = 'WHERE user_id = ?';
        params.push(user.id);
    }
    const items = db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM ticket_replies WHERE ticket_id = t.id) AS replies_count FROM tickets t ${where} ORDER BY created_at DESC`).all(...params);
    return c.json({ success: true, data: items, code: 200 });
});
// Get one with replies
tickets.get('/:id', authRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(id);
    if (!ticket)
        return c.json({ success: false, message: 'تیکت یافت نشد', code: 404 }, 404);
    if (user.role !== 'admin' && ticket.user_id !== user.id) {
        return c.json({ success: false, message: 'دسترسی غیرمجاز', code: 403 }, 403);
    }
    const replies = db.prepare(`SELECT * FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at ASC`).all(id);
    return c.json({ success: true, data: { ...ticket, replies }, code: 200 });
});
// Add reply
tickets.post('/:id/replies', authRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(id);
    if (!ticket)
        return c.json({ success: false, message: 'تیکت یافت نشد', code: 404 }, 404);
    if (user.role !== 'admin' && ticket.user_id !== user.id) {
        return c.json({ success: false, message: 'دسترسی غیرمجاز', code: 403 }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({ message: z.string().min(2, 'پیام معتبر نیست') });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const isAdmin = user.role === 'admin' ? 1 : 0;
    db.prepare(`INSERT INTO ticket_replies (ticket_id, user_id, is_admin, author_name, message) VALUES (?, ?, ?, ?, ?)`).run(id, user.id, isAdmin, user.full_name, parsed.data.message);
    // Update status
    const newStatus = isAdmin ? 'answered' : 'open';
    db.prepare(`UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(newStatus, id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'reply', entity_type: 'ticket', entity_id: id });
    return c.json({ success: true, message: 'پاسخ ثبت شد', code: 200 });
});
// Update status (admin)
tickets.put('/:id/status', adminRequired, async (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({ status: z.enum(['open', 'answered', 'closed']) });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: 'وضعیت نامعتبر', code: 400 }, 400);
    db.prepare(`UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(parsed.data.status, id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update_status', entity_type: 'ticket', entity_id: id, details: { new_status: parsed.data.status } });
    return c.json({ success: true, message: 'وضعیت به‌روزرسانی شد', code: 200 });
});
tickets.delete('/:id', adminRequired, (c) => {
    const user = c.get('user');
    const id = parseInt(c.req.param('id') || '0');
    db.prepare(`DELETE FROM tickets WHERE id = ?`).run(id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'delete', entity_type: 'ticket', entity_id: id });
    return c.json({ success: true, message: 'تیکت حذف شد', code: 200 });
});
export default tickets;
