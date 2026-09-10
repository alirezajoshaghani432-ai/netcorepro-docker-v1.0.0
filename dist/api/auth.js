import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import db from '../db/index.js';
import { signToken } from '../utils/jwt.js';
import { authRequired } from '../middleware/auth.js';
import { logActivity } from '../utils/helpers.js';
const auth = new Hono();
const loginSchema = z.object({
    email: z.string().email('ایمیل معتبر نیست'),
    password: z.string().min(4, 'رمز عبور حداقل 4 کاراکتر')
});
const registerSchema = z.object({
    email: z.string().email('ایمیل معتبر نیست'),
    password: z.string().min(6, 'رمز عبور حداقل 6 کاراکتر'),
    full_name: z.string().min(2, 'نام معتبر نیست'),
    phone: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : normalizeIranPhone(v)), z.string().regex(/^09\d{9}$/, 'شماره موبایل معتبر نیست (مثال: 09123456789)').optional()),
    company: z.string().optional()
});
// ===== Phone OTP login (demo/test mode) =====
// No SMS gateway is configured, so a fixed demo code is issued and also
// returned in the API response, which lets staff and testers log in without
// a real SMS provider. Once a gateway (Kavenegar/IPPanel/...) is available,
// replace sendSms() below with a real API call and stop returning
// `debug_code` in production.
const DEMO_OTP_CODE = '12345';
const OTP_TTL_MINUTES = 5;
/**
 * F6 — Iranian mobile normalisation.
 * The old code only accepted the exact form `09xxxxxxxxx`, so anything the
 * customer actually typed (+98..., 0098..., 98..., spaces/dashes, or Persian
 * digits pasted from a contact card) was rejected with a validation error.
 * Everything is now folded to the canonical `09xxxxxxxxx` BEFORE validation.
 */
function normalizeIranPhone(p) {
    let d = String(p == null ? '' : p)
        .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06F0)) // Persian digits
        .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660)) // Arabic-Indic digits
        .replace(/[^0-9+]/g, '');
    if (d.startsWith('+98'))
        d = '0' + d.slice(3);
    else if (d.startsWith('0098'))
        d = '0' + d.slice(4);
    else if (d.startsWith('98') && d.length >= 12)
        d = '0' + d.slice(2);
    else if (d.startsWith('9') && d.length === 10)
        d = '0' + d;
    return d.replace(/[^0-9]/g, '');
}
const iranMobile = z.preprocess((v) => normalizeIranPhone(v), z.string().regex(/^09\d{9}$/, 'شماره موبایل معتبر نیست (مثال: 09123456789)'));
const phoneSchema = z.object({ phone: iranMobile });
auth.post('/otp/send', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = phoneSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    }
    const phone = normalizeIranPhone(parsed.data.phone);
    const blocked = db.prepare(`SELECT status FROM users WHERE phone = ?`).get(phone);
    if (blocked && blocked.status === 'blocked') {
        return c.json({ success: false, message: 'حساب کاربری شما مسدود شده است', code: 403 }, 403);
    }
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();
    // TODO: once an SMS gateway service is purchased, generate a random code
    // and send it via the gateway instead of using the fixed demo code.
    const code = DEMO_OTP_CODE;
    db.prepare(`INSERT INTO otp_codes (phone, code, expires_at) VALUES (?, ?, ?)`).run(phone, code, expiresAt);
    logActivity({ action: 'create', entity_type: 'otp', details: { phone }, ip_address: c.req.header('x-forwarded-for') || 'local' });
    return c.json({
        success: true,
        message: 'کد تایید ارسال شد (حالت آزمایشی — سرویس پیامک هنوز فعال نشده است)',
        // debug_code is exposed only because no SMS provider is connected yet;
        // remove this field once a real gateway is purchased and wired up.
        data: { debug_code: code, expires_in: OTP_TTL_MINUTES * 60 },
        code: 200
    });
});
const otpVerifySchema = z.object({
    phone: iranMobile,
    code: z.string().trim().min(4, 'کد معتبر نیست'),
    full_name: z.string().min(2).optional()
});
auth.post('/otp/verify', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = otpVerifySchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    }
    const { phone, code } = parsed.data;
    const row = db.prepare(`SELECT * FROM otp_codes WHERE phone = ? AND is_used = 0 AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1`).get(phone);
    if (!row || row.code !== code) {
        return c.json({ success: false, message: 'کد وارد شده اشتباه یا منقضی شده است', code: 400 }, 400);
    }
    db.prepare(`UPDATE otp_codes SET is_used = 1 WHERE id = ?`).run(row.id);
    let user = db.prepare(`SELECT * FROM users WHERE phone = ?`).get(phone);
    if (!user) {
        // First-time login with this phone → auto-create a lightweight customer account.
        const placeholderEmail = `${phone}@phone.netcorepro.ir`;
        const randomPass = bcrypt.hashSync(Math.random().toString(36) + Date.now(), 10);
        const fullName = parsed.data.full_name || `کاربر ${phone}`;
        // F5: password_set = 0 → the account panel offers «تعیین رمز عبور»
        // instead of a «تغییر رمز عبور» form that could never be completed.
        const result = db.prepare(`INSERT INTO users (email, password, full_name, phone, role, password_set) VALUES (?, ?, ?, ?, 'customer', 0)`).run(placeholderEmail, randomPass, fullName, phone);
        user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(result.lastInsertRowid);
        logActivity({ user_id: user.id, user_name: user.full_name, action: 'register', entity_type: 'user', entity_id: user.id, details: { via: 'otp' } });
    }
    else if (user.status === 'blocked') {
        return c.json({ success: false, message: 'حساب کاربری شما مسدود شده است', code: 403 }, 403);
    }
    const token = signToken({ id: user.id, email: user.email, role: user.role, full_name: user.full_name });
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'login', entity_type: 'user', entity_id: user.id, details: { via: 'otp' }, ip_address: c.req.header('x-forwarded-for') || 'local' });
    return c.json({
        success: true,
        data: {
            token,
            user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, phone: user.phone, company: user.company }
        },
        message: 'ورود موفقیت‌آمیز',
        code: 200
    });
});
auth.post('/login', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    }
    const { email, password } = parsed.data;
    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
    if (!user) {
        return c.json({ success: false, message: 'ایمیل یا رمز عبور اشتباه است', code: 401 }, 401);
    }
    if (user.status === 'blocked') {
        return c.json({ success: false, message: 'حساب کاربری شما مسدود شده است', code: 403 }, 403);
    }
    const ok = bcrypt.compareSync(password, user.password);
    if (!ok) {
        return c.json({ success: false, message: 'ایمیل یا رمز عبور اشتباه است', code: 401 }, 401);
    }
    const token = signToken({ id: user.id, email: user.email, role: user.role, full_name: user.full_name });
    logActivity({
        user_id: user.id, user_name: user.full_name, action: 'login',
        entity_type: 'user', entity_id: user.id,
        ip_address: c.req.header('x-forwarded-for') || 'local',
        user_agent: c.req.header('user-agent') || ''
    });
    return c.json({
        success: true,
        data: {
            token,
            user: {
                id: user.id, email: user.email, full_name: user.full_name,
                role: user.role, phone: user.phone, company: user.company
            }
        },
        message: 'ورود موفقیت‌آمیز',
        code: 200
    });
});
auth.post('/register', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    }
    const { email, password, full_name, phone, company } = parsed.data;
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) {
        return c.json({ success: false, message: 'این ایمیل قبلاً ثبت شده است', code: 409 }, 409);
    }
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`INSERT INTO users (email, password, full_name, phone, company, role) VALUES (?, ?, ?, ?, ?, 'customer')`).run(email, hash, full_name, phone || null, company || null);
    const userId = result.lastInsertRowid;
    const token = signToken({ id: userId, email, role: 'customer', full_name });
    logActivity({
        user_id: userId, user_name: full_name, action: 'register',
        entity_type: 'user', entity_id: userId,
        ip_address: c.req.header('x-forwarded-for') || 'local'
    });
    return c.json({
        success: true,
        data: { token, user: { id: userId, email, full_name, role: 'customer', phone, company } },
        message: 'ثبت‌نام موفقیت‌آمیز',
        code: 200
    });
});
auth.post('/logout', authRequired, (c) => {
    const user = c.get('user');
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'logout', entity_type: 'user', entity_id: user.id });
    return c.json({ success: true, message: 'خروج موفقیت‌آمیز', code: 200 });
});
auth.get('/me', authRequired, (c) => {
    const user = c.get('user');
    const row = db.prepare(`SELECT id, email, full_name, phone, role, company, address, city, postal_code, password_set FROM users WHERE id = ?`).get(user.id);
    if (!row)
        return c.json({ success: false, message: 'کاربر یافت نشد', code: 404 }, 404);
    // F5: the storefront needs to know whether this account has a real password
    // and whether its e-mail is just the OTP placeholder (…@phone.netcorepro.ir).
    const isPlaceholderEmail = /@phone\.netcorepro\.ir$/i.test(row.email || '');
    return c.json({
        success: true,
        data: {
            ...row,
            email: isPlaceholderEmail ? '' : row.email,
            has_password: row.password_set !== 0,
            is_phone_account: isPlaceholderEmail || row.password_set === 0
        },
        code: 200
    });
});

/**
 * F5 — first-time password for OTP accounts.
 * `/change-password` requires the current password, which an OTP user has never
 * chosen, so they were stuck. This endpoint sets one (only when none exists).
 */
auth.post('/set-password', authRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({
        new_password: z.string().min(6, 'رمز عبور باید حداقل ۶ کاراکتر باشد'),
        email: z.string().email('ایمیل معتبر نیست').optional()
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    const dbUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
    if (!dbUser)
        return c.json({ success: false, message: 'کاربر یافت نشد', code: 404 }, 404);
    if (dbUser.password_set !== 0)
        return c.json({ success: false, message: 'برای این حساب رمز عبور تعیین شده است؛ از «تغییر رمز عبور» استفاده کنید', code: 400 }, 400);
    // An optional real e-mail lets the customer log in with e-mail as well.
    if (parsed.data.email) {
        const taken = db.prepare(`SELECT id FROM users WHERE email = ? AND id <> ?`).get(parsed.data.email, user.id);
        if (taken)
            return c.json({ success: false, message: 'این ایمیل قبلاً ثبت شده است', code: 400 }, 400);
    }
    const hash = bcrypt.hashSync(parsed.data.new_password, 10);
    db.prepare(`UPDATE users SET password = ?, password_set = 1, email = COALESCE(?, email), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(hash, parsed.data.email || null, user.id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'set_password', entity_type: 'user', entity_id: user.id });
    return c.json({ success: true, message: 'رمز عبور با موفقیت تعیین شد', code: 200 });
});
auth.put('/profile', authRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({
        full_name: z.string().min(2, 'نام و نام خانوادگی معتبر نیست'),
        phone: z.preprocess((v) => (v === undefined || v === null || v === '' ? undefined : normalizeIranPhone(v)), z.string().regex(/^09\d{9}$/, 'شماره موبایل معتبر نیست (مثال: 09123456789)').optional()),
        company: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        postal_code: z.string().optional()
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    }
    const d = parsed.data;
    db.prepare(`UPDATE users SET full_name=?, phone=?, company=?, address=?, city=?, postal_code=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(d.full_name, d.phone || null, d.company || null, d.address || null, d.city || null, d.postal_code || null, user.id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'update', entity_type: 'profile', entity_id: user.id });
    return c.json({ success: true, message: 'پروفایل به‌روزرسانی شد', code: 200 });
});
auth.post('/change-password', authRequired, async (c) => {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const schema = z.object({ old_password: z.string().min(1), new_password: z.string().min(6, 'رمز جدید حداقل 6 کاراکتر') });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        return c.json({ success: false, message: parsed.error.issues[0].message, code: 400 }, 400);
    }
    const dbUser = db.prepare(`SELECT * FROM users WHERE id = ?`).get(user.id);
    if (!dbUser)
        return c.json({ success: false, message: 'کاربر یافت نشد', code: 404 }, 404);
    if (dbUser.password_set === 0)
        return c.json({ success: false, message: 'هنوز رمز عبوری برای حساب شما تعیین نشده است؛ از «تعیین رمز عبور» استفاده کنید', code: 400 }, 400);
    if (!bcrypt.compareSync(parsed.data.old_password, dbUser.password)) {
        return c.json({ success: false, message: 'رمز فعلی اشتباه است', code: 400 }, 400);
    }
    const hash = bcrypt.hashSync(parsed.data.new_password, 10);
    db.prepare(`UPDATE users SET password=?, password_set=1, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(hash, user.id);
    logActivity({ user_id: user.id, user_name: user.full_name, action: 'change_password', entity_type: 'user', entity_id: user.id });
    return c.json({ success: true, message: 'رمز عبور با موفقیت تغییر کرد', code: 200 });
});
export default auth;
