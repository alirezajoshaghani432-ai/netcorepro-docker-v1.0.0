/**
 * SMS service layer (Kavenegar).
 *
 * Everything is configured from the admin panel (Settings → SMS service), no
 * code change or restart is needed:
 *   sms_enabled            فعال | غیرفعال      master switch (off = demo mode, nothing is sent)
 *   sms_api_key            Kavenegar API key
 *   sms_sender             sender line number (used for plain-text messages)
 *   sms_otp_template       verify/lookup template name for the login code (token = code)
 *   sms_order_new_enabled  customer SMS after an order is placed
 *   sms_order_new_template lookup template  (token = order number, token2 = payable amount)
 *   sms_order_new_text     plain-text alternative, placeholders: {name} {order_number} {total} {shop}
 *   sms_order_admin_enabled / sms_admin_phone / sms_order_admin_text   notify the shop owner
 *   sms_status_enabled     customer SMS when an order status / payment status changes
 *   sms_status_template    lookup template  (token = order number, token2 = status)
 *   sms_status_text        plain-text alternative, placeholders: {name} {order_number} {status} {shop}
 *
 * A message is sent with the lookup template when a template name is set,
 * otherwise as plain text through the sender line.
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
    ['token', 'token2', 'token3'].forEach((k, i) => { if (tokens && tokens[i] !== undefined) p[k] = cleanToken(tokens[i]); });
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

const STATUS_FA = {
    pending: 'در انتظار بررسی', confirmed: 'تایید شده', shipping: 'در حال ارسال', delivered: 'تحویل شده', cancelled: 'لغو شده',
    paid: 'پرداخت شده', failed: 'ناموفق', refunded: 'بازگشت وجه', awaiting_review: 'در انتظار تایید پرداخت'
};
export const statusLabel = (s) => STATUS_FA[s] || s;

function amount(n) { return String(Math.round(Number(n) || 0)); }

/** Fire-and-forget notification after an order is created. */
export function notifyOrderCreated(order) {
    (async () => {
        try {
            if (!smsEnabled()) return;
            const shop = getSetting('site_name', 'فروشگاه');
            const vars = { name: order.customer_name || '', order_number: order.order_number, total: amount(order.total), shop };
            if (getSetting('sms_order_new_enabled', 'غیرفعال') === 'فعال' && order.customer_phone) {
                const tpl = String(getSetting('sms_order_new_template', '')).trim();
                if (tpl) await sendTemplate(order.customer_phone, tpl, [order.order_number, amount(order.total)], 'order_new');
                else await sendText(order.customer_phone,
                    fill(getSetting('sms_order_new_text', '{name} عزیز، سفارش {order_number} با مبلغ {total} تومان در {shop} ثبت شد.'), vars), 'order_new');
            }
            const admin = String(getSetting('sms_admin_phone', '')).trim();
            if (getSetting('sms_order_admin_enabled', 'غیرفعال') === 'فعال' && admin) {
                await sendText(admin, fill(getSetting('sms_order_admin_text', 'سفارش جدید {order_number} از {name} به مبلغ {total} تومان ثبت شد.'), vars), 'order_admin');
            }
        } catch (e) { console.error('[sms] order notify error:', e && e.message); }
    })();
}

/** Fire-and-forget notification when an order's status (or payment status) changes. */
export function notifyOrderStatus(orderId, statusKey) {
    (async () => {
        try {
            if (!smsEnabled() || getSetting('sms_status_enabled', 'غیرفعال') !== 'فعال') return;
            const o = db.prepare(`SELECT order_number, customer_name, customer_phone FROM orders WHERE id = ?`).get(orderId);
            if (!o || !o.customer_phone) return;
            const label = statusLabel(statusKey);
            const shop = getSetting('site_name', 'فروشگاه');
            const tpl = String(getSetting('sms_status_template', '')).trim();
            if (tpl) await sendTemplate(o.customer_phone, tpl, [o.order_number, label], 'order_status');
            else await sendText(o.customer_phone,
                fill(getSetting('sms_status_text', '{name} عزیز، وضعیت سفارش {order_number}: {status} ({shop})'),
                    { name: o.customer_name || '', order_number: o.order_number, status: label, shop }), 'order_status');
        } catch (e) { console.error('[sms] status notify error:', e && e.message); }
    })();
}

/** Remaining credit (Kavenegar account/info). */
export async function accountInfo() {
    if (!String(getSetting('sms_api_key', '')).trim()) return { ok: false, message: 'کلید API وارد نشده است' };
    return callKavenegar('account/info', {});
}
