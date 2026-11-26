/**
 * SMS service layer (Kavenegar) — 2026-11-26: event-driven «پنل پیامک».
 *
 * GLOBAL settings (editable from /admin/sms → تنظیمات اتصال):
 *   sms_enabled            فعال | غیرفعال      master switch (off = nothing is sent)
 *   sms_api_key            Kavenegar API key
 *   sms_sender             sender line number (plain-text messages)
 *   sms_admin_phone        shop-owner mobile (target = admin)
 *
 * EVENT rows live in the `sms_events` table — one row per trigger. Each row is
 * editable from /admin/sms WITHOUT a code change or restart:
 *   enabled   این رویداد پیامک دارد؟
 *   target    customer (موبایل مشتریِ رویداد) | admin (sms_admin_phone) | custom
 *   custom_phone  for target = custom
 *   template  Kavenegar lookup/verify template name (empty → plain text below)
 *   body      plain text with {placeholders}, e.g. {name} {order_number} {total}
 *
 * A message is sent with the verify/lookup template when a template name is set
 * (tokens per event = EVENT_TOKENS), otherwise as plain text through the sender
 * line. Every attempt (sent / failed / skipped) is written to `sms_logs` and
 * visible in /admin/sms.
 */
import db from '../db/index.js';
import { getSetting } from './helpers.js';

const API = (process.env.SMS_API_BASE || 'https://api.kavenegar.com/v1').replace(/\/+$/, '');
const MASK = '••••';

export const SMS_MASK = MASK;

export function smsEnabled() {
    return getSetting('sms_enabled', 'غیرفعال') === 'فعال' && !!String(getSetting('sms_api_key', '')).trim();
}

function toApiPhone(p) {
    // Kavenegar accepts 09xxxxxxxxx directly.
    return String(p || '').replace(/[^0-9]/g, '');
}

function cleanToken(v) {
    // Lookup tokens must not contain spaces / newlines.
    return String(v == null ? '' : v).replace(/\s+/g, '_').slice(0, 100);
}

function fill(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

function writeLog(phone, event, kind, status, response) {
    try {
        db.prepare(`INSERT INTO sms_logs (phone, event, kind, status, response) VALUES (?, ?, ?, ?, ?)`)
            .run(phone, event, kind, status, String(response || '').slice(0, 500));
    } catch (e) { /* logging must never break the request */ }
}

async function callKavenegar(path, params) {
    const key = String(getSetting('sms_api_key', '')).trim();
    const body = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') body.append(k, String(v)); });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
        const res = await fetch(`${API}/${encodeURIComponent(key)}/${path}.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            signal: ctrl.signal
        });
        let json = null;
        try { json = await res.json(); } catch (e) { /* non-JSON answer */ }
        const status = json && json.return ? json.return.status : res.status;
        const message = json && json.return ? json.return.message : `HTTP ${res.status}`;
        return { ok: status === 200, status, message, entries: json ? json.entries : null };
    } catch (e) {
        return { ok: false, status: 0, message: e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'network error' };
    } finally {
        clearTimeout(timer);
    }
}

/** Plain text through the sender line. */
export async function sendText(phone, message, event = 'custom') {
    const receptor = toApiPhone(phone);
    if (!smsEnabled()) { writeLog(receptor, event, 'text', 'skipped', 'sms disabled'); return { ok: false, skipped: true, message: 'سرویس پیامک غیرفعال است' }; }
    const sender = String(getSetting('sms_sender', '')).trim();
    const r = await callKavenegar('sms/send', { receptor, sender, message });
    writeLog(receptor, event, 'text', r.ok ? 'sent' : 'failed', r.message);
    return r;
}

/** Template based message (verify/lookup). */
export async function sendTemplate(phone, template, tokens, event = 'custom') {
    const receptor = toApiPhone(phone);
    if (!smsEnabled()) { writeLog(receptor, event, 'template', 'skipped', 'sms disabled'); return { ok: false, skipped: true, message: 'سرویس پیامک غیرفعال است' }; }
    const p = { receptor, template };
    ['token', 'token2', 'token3'].forEach((k, i) => { if (tokens && tokens[i] !== undefined && tokens[i] !== '') p[k] = cleanToken(tokens[i]); });
    const r = await callKavenegar('verify/lookup', p);
    writeLog(receptor, event, 'template', r.ok ? 'sent' : 'failed', r.message);
    return r;
}

/** Login code. Returns { ok, message }. */
export async function sendOtp(phone, code) {
    const tpl = String(getSetting('sms_otp_template', '')).trim();
    if (tpl) return sendTemplate(phone, tpl, [code], 'otp');
    const shop = getSetting('site_name', 'فروشگاه');
    return sendText(phone, `${shop}\nکد تایید شما: ${code}`, 'otp');
}

// =====================================================================
//  Event patterns (پترن‌های پیامک) — the /admin/sms panel CRUDs these.
// =====================================================================

/** Placeholders each event understands (shown as chips in the panel). */
export const EVENT_VARS = {
    order_new: ['name', 'order_number', 'total', 'shop', 'date'],
    order_admin: ['name', 'order_number', 'total', 'shop'],
    order_status: ['name', 'order_number', 'status', 'shop'],
    payment_status: ['name', 'order_number', 'status', 'shop'],
    order_cancelled: ['name', 'order_number', 'shop'],
    ticket_new: ['ticket_number', 'name', 'subject', 'shop'],
    ticket_reply: ['name', 'ticket_number', 'shop'],
    user_registered: ['name', 'shop'],
    contact_message: ['name', 'phone', 'message_short', 'shop']
};

/** Kavenegar lookup tokens (token, token2, token3) when the row uses a template. */
const EVENT_TOKENS = {
    order_new: ['order_number', 'total', 'name'],
    order_admin: ['order_number', 'total', 'name'],
    order_status: ['order_number', 'status', 'name'],
    payment_status: ['order_number', 'status', 'name'],
    order_cancelled: ['order_number', 'name', 'shop'],
    ticket_new: ['ticket_number', 'name', 'subject'],
    ticket_reply: ['ticket_number', 'name', 'shop'],
    user_registered: ['name', 'shop', ''],
    contact_message: ['name', 'phone', 'message_short']
};

export function getSmsEvents() {
    try {
        return db.prepare(`SELECT * FROM sms_events ORDER BY rowid`).all();
    } catch {
        return [];
    }
}

export function getSmsEvent(key) {
    try {
        return db.prepare(`SELECT * FROM sms_events WHERE event_key = ?`).get(key) || null;
    } catch {
        return null;
    }
}

/** Validate + persist one event row from the admin panel. */
export function updateSmsEvent(key, patch = {}) {
    const row = getSmsEvent(key);
    if (!row) return null;
    const enabled = (patch.enabled === 'فعال' || patch.enabled === 1 || patch.enabled === '1' || patch.enabled === true) ? 1
        : (patch.enabled === 'غیرفعال' || patch.enabled === 0 || patch.enabled === '0' || patch.enabled === false) ? 0
        : row.enabled;
    const target = ['customer', 'admin', 'custom'].includes(patch.target) ? patch.target : row.target;
    const custom_phone = patch.custom_phone !== undefined ? String(patch.custom_phone || '').slice(0, 32) : row.custom_phone;
    const template = patch.template !== undefined ? String(patch.template || '').trim().slice(0, 190) : row.template;
    const body = patch.body !== undefined ? String(patch.body || '').slice(0, 1000) : row.body;
    db.prepare(`UPDATE sms_events SET enabled = ?, target = ?, custom_phone = ?, template = ?, body = ?, updated_at = datetime('now') WHERE event_key = ?`)
        .run(enabled, target, custom_phone, template, body, key);
    return getSmsEvent(key);
}

/**
 * Fire a configured event. Never throws — a broken SMS must not break the
 * customer flow. Resolves the recipient from the row's target:
 *   customer → ctx.phone   |   admin → settings sms_admin_phone   |   custom → row.custom_phone
 */
export function fireSmsEvent(key, vars = {}, ctx = {}) {
    (async () => {
        try {
            const row = getSmsEvent(key);
            if (!row || !row.enabled) return;
            const shop = getSetting('site_name', 'فروشگاه');
            const allVars = { shop, ...vars };
            let phone = '';
            if (row.target === 'admin') phone = String(getSetting('sms_admin_phone', '')).trim();
            else if (row.target === 'custom') phone = String(row.custom_phone || '').trim();
            else phone = String(ctx.phone || '').trim();
            if (!phone) { writeLog('-', key, 'event', 'skipped', 'شماره گیرنده پیدا نشد'); return; }
            const tpl = String(row.template || '').trim();
            if (tpl) {
                // Lookup template: tokens are the event's canonical variables.
                const tokenVars = (EVENT_TOKENS[key] || []).map(k => (k && allVars[k] !== undefined ? String(allVars[k]) : ''));
                await sendTemplate(phone, tpl, tokenVars, key);
            } else {
                await sendText(phone, fill(row.body, allVars), key);
            }
        } catch (e) { console.error(`[sms] event ${key} error:`, e && e.message); }
    })();
}

const STATUS_FA = {
    pending: 'در انتظار بررسی', confirmed: 'تایید شده', shipping: 'در حال ارسال', delivered: 'تحویل شده', cancelled: 'لغو شده',
    paid: 'پرداخت شده', failed: 'ناموفق', refunded: 'بازگشت وجه', awaiting_review: 'در انتظار تایید پرداخت'
};
export const statusLabel = (s) => STATUS_FA[s] || s;

function amount(n) { return String(Math.round(Number(n) || 0)); }

function faDate() {
    try {
        return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'short' }).format(new Date());
    } catch { return ''; }
}

/** Fire-and-forget notification after an order is created (customer + admin events). */
export function notifyOrderCreated(order) {
    const vars = { name: order.customer_name || '', order_number: order.order_number, total: amount(order.total), date: faDate() };
    fireSmsEvent('order_new', vars, { phone: order.customer_phone });
    fireSmsEvent('order_admin', vars, {});
}

/** Fire-and-forget notification when an order's status changes (customer). */
export function notifyOrderStatus(orderId, statusKey) {
    (async () => {
        try {
            const o = db.prepare(`SELECT order_number, customer_name, customer_phone FROM orders WHERE id = ?`).get(orderId);
            if (!o) return;
            const vars = { name: o.customer_name || '', order_number: o.order_number, status: statusLabel(statusKey) };
            if (statusKey === 'cancelled') fireSmsEvent('order_cancelled', vars, { phone: o.customer_phone });
            else fireSmsEvent('order_status', vars, { phone: o.customer_phone });
        } catch (e) { console.error('[sms] status notify error:', e && e.message); }
    })();
}

/** Fire-and-forget notification when the PAYMENT status changes (customer). */
export function notifyOrderPayment(orderId, paymentStatus) {
    (async () => {
        try {
            const o = db.prepare(`SELECT order_number, customer_name, customer_phone FROM orders WHERE id = ?`).get(orderId);
            if (!o) return;
            fireSmsEvent('payment_status', {
                name: o.customer_name || '', order_number: o.order_number, status: statusLabel(paymentStatus)
            }, { phone: o.customer_phone });
        } catch (e) { console.error('[sms] payment notify error:', e && e.message); }
    })();
}

/** New ticket created (notify the shop admin). */
export function notifyTicketCreated(ticket) {
    fireSmsEvent('ticket_new', {
        ticket_number: ticket.ticket_number, name: ticket.customer_name || '', subject: String(ticket.subject || '').slice(0, 60)
    }, {});
}

/** Admin replied to a ticket (notify the customer). */
export function notifyTicketReply(ticket) {
    fireSmsEvent('ticket_reply', {
        ticket_number: ticket.ticket_number, name: ticket.customer_name || ''
    }, { phone: ticket.customer_phone });
}

/** Welcome SMS after a successful registration. */
export function notifyUserRegistered(user) {
    fireSmsEvent('user_registered', { name: user.full_name || '' }, { phone: user.phone });
}

/** New contact-form message (notify the shop admin). */
export function notifyContactMessage(msg) {
    fireSmsEvent('contact_message', {
        name: msg.name || '', phone: msg.phone || '', message_short: String(msg.body || '').replace(/\s+/g, ' ').slice(0, 50)
    }, {});
}

/** Remaining credit (Kavenegar account/info). */
export async function accountInfo() {
    if (!String(getSetting('sms_api_key', '')).trim()) return { ok: false, message: 'کلید API وارد نشده است' };
    return callKavenegar('account/info', {});
}
