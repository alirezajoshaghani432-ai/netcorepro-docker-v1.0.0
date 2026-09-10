import { verifyToken } from '../utils/jwt.js';
// Methods that never change state — safe to authenticate from the SSR cookie.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
function extractToken(c) {
    const auth = c.req.header('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
        return auth.substring(7);
    }
    // Cookie fallback (used only so SSR pages can read the logged-in user).
    // For CSRF safety, the cookie is honored ONLY on safe/idempotent methods.
    // Any state-changing request (POST/PUT/DELETE/PATCH) MUST send the
    // Authorization: Bearer header, which a cross-site attacker cannot forge.
    const method = (c.req.method || 'GET').toUpperCase();
    if (!SAFE_METHODS.has(method))
        return null;
    const cookieHeader = c.req.header('Cookie') || '';
    const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
    if (match)
        return decodeURIComponent(match[1]);
    return null;
}
export async function authOptional(c, next) {
    const token = extractToken(c);
    const user = token ? verifyToken(token) : null;
    c.set('user', user);
    await next();
}
export async function authRequired(c, next) {
    const token = extractToken(c);
    const user = token ? verifyToken(token) : null;
    if (!user) {
        return c.json({ success: false, message: 'احراز هویت لازم است', code: 401 }, 401);
    }
    c.set('user', user);
    await next();
}
export async function adminRequired(c, next) {
    const token = extractToken(c);
    const user = token ? verifyToken(token) : null;
    if (!user) {
        return c.json({ success: false, message: 'احراز هویت لازم است', code: 401 }, 401);
    }
    if (user.role !== 'admin') {
        return c.json({ success: false, message: 'دسترسی فقط برای مدیر', code: 403 }, 403);
    }
    c.set('user', user);
    await next();
}
