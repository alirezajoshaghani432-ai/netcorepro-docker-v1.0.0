import db from '../db/index.js';
export function generateOrderNumber() {
    const ts = Date.now().toString().slice(-8);
    const rnd = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `NCP-${ts}${rnd}`;
}
export function generateTicketNumber() {
    const ts = Date.now().toString().slice(-6);
    const rnd = Math.floor(Math.random() * 100).toString().padStart(2, '0');
    return `TKT-${ts}${rnd}`;
}
export function getSetting(key, defaultValue = '') {
    const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
    return row?.value ?? defaultValue;
}
export function getAllSettings() {
    const rows = db.prepare(`SELECT key, value FROM settings`).all();
    const obj = {};
    rows.forEach(r => obj[r.key] = r.value);
    return obj;
}
export function setSetting(key, value) {
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`).run(key, value);
}
export function formatPrice(n) {
    if (!n)
        return '0';
    return new Intl.NumberFormat('fa-IR').format(n);
}
export function jsonResponse(success, data = null, message = '', code = 200) {
    return { success, data, message, code };
}
export function logActivity(opts) {
    try {
        db.prepare(`INSERT INTO activity_logs (user_id, user_name, action, entity_type, entity_id, details, ip_address, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(opts.user_id ?? null, opts.user_name ?? null, opts.action, opts.entity_type ?? null, opts.entity_id ?? null, opts.details ? JSON.stringify(opts.details) : null, opts.ip_address ?? null, opts.user_agent ?? null);
    }
    catch (e) {
        console.error('logActivity error:', e);
    }
}
