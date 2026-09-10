const buckets = new Map();
// periodic cleanup
setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets.entries()) {
        if (b.resetAt < now)
            buckets.delete(k);
    }
}, 60_000).unref?.();
export function rateLimit(opts) {
    const { windowMs, max } = opts;
    const keyFn = opts.keyFn || ((c) => {
        const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim()
            || c.req.header('x-real-ip')
            || 'unknown';
        return `${ip}:${c.req.path}`;
    });
    return async (c, next) => {
        const key = keyFn(c);
        const now = Date.now();
        let b = buckets.get(key);
        if (!b || b.resetAt < now) {
            b = { count: 0, resetAt: now + windowMs };
            buckets.set(key, b);
        }
        b.count += 1;
        const remaining = Math.max(0, max - b.count);
        c.header('X-RateLimit-Limit', String(max));
        c.header('X-RateLimit-Remaining', String(remaining));
        c.header('X-RateLimit-Reset', String(Math.ceil(b.resetAt / 1000)));
        if (b.count > max) {
            const retryAfter = Math.ceil((b.resetAt - now) / 1000);
            c.header('Retry-After', String(retryAfter));
            return c.json({
                success: false,
                message: `درخواست‌های شما بیش از حد مجاز است. لطفا ${retryAfter} ثانیه دیگر تلاش کنید.`,
                code: 429
            }, 429);
        }
        await next();
    };
}
