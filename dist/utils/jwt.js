import jwt from 'jsonwebtoken';
const FALLBACK_SECRET = 'netcorepro-dev-fallback-do-not-use-in-production';
const JWT_SECRET = process.env.JWT_SECRET || FALLBACK_SECRET;
const JWT_EXPIRES = '7d';
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === FALLBACK_SECRET || process.env.JWT_SECRET.length < 32)) {
    console.error('❌ FATAL: JWT_SECRET is missing or too weak for production. Set JWT_SECRET env var to a random string of at least 32 characters.');
    process.exit(1);
}
export function signToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}
export function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    }
    catch {
        return null;
    }
}
