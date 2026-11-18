import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { getConnInfo } from '@hono/node-server/conninfo';
import nodeFs from 'node:fs';
import nodePath from 'node:path';
import { imgEntry, bestUrl } from './utils/img.js';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { compress } from 'hono/compress';
import { etag } from 'hono/etag';
import db, { closeDatabase } from './db/index.js';
import { rateLimit } from './middleware/rate-limit.js';
import { knownDbError } from './utils/helpers.js';
import authApi from './api/auth.js';
import productsApi from './api/products.js';
import ordersApi from './api/orders.js';
import ticketsApi from './api/tickets.js';
import blogApi from './api/blog.js';
import miscApi from './api/misc.js';
import contentApi from './api/content.js';
import productIoApi from './api/product-io.js'; // 2026-11-03: products export / import
import torobApi from './api/torob.js'; // 2026-11-17: Torob Product API v3 + diagnostics
import { resolveSiteBaseUrl, requestOriginFromHono } from './utils/helpers.js';
import { syncPersistentUploads, localImageFilePath } from './utils/torob.js';
import { homeLandingPage, homePage, productsPage, productPage, categoriesPage, blogListPage, blogPostPage, cartPage, checkoutPage, orderSuccessPage, loginPage, registerPage, accountPage, aboutPage, contactPage, privacyPage, termsPage, notFoundPage } from './views/site/pages.js';
import { adminLoginPage, dashboardPage, adminProductsPage, adminOrdersPage, adminTicketsPage, adminCommentsPage, adminPostsPage, adminCategoriesPage, adminBrandsPage, adminCustomersPage, adminMessagesPage, adminNewsletterPage, adminActivityLogsPage, adminReportsPage, adminSettingsPage, adminProfilePage, adminSiteContentPage, adminBannersPage, adminHomePagesPage, adminProductOrderPage, adminPricingPage, adminNotFoundPage } from './views/admin/pages.js';
import { adminMenuBuilderPage } from './views/admin/menu-builder.js';
import { catVisSql, visibleCats } from './utils/catvis.js';
// Sync persistent ./uploads volume with ./public/static/uploads on boot so Docker rebuilds never 404 product images
syncPersistentUploads();
const app = new Hono();
// ===== Global middleware =====
const isProd = process.env.NODE_ENV === 'production';
const maxBodyMb = parseInt(process.env.MAX_BODY_SIZE_MB || '10');
if (!isProd)
    app.use('*', logger());
// Compression (gzip/deflate) - skip in development to ease debugging
if (isProd)
    app.use('*', compress());
// ETag for cacheable GET responses
app.use('*', etag());
// Security headers (helmet-like)
app.use('*', secureHeaders({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: 'cross-origin'
}));
// CORS - configurable per env
const corsOrigins = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());
// API responses must never be cached by the browser (admin edit modals were
// re-showing stale data from disk cache after a successful save).
app.use('/api/*', async (c, next) => {
    await next();
    if (c.req.method === 'GET' && !c.res.headers.get('Cache-Control'))
        c.header('Cache-Control', 'no-store');
});
app.use('/api/*', cors({
    origin: corsOrigins.includes('*') ? '*' : corsOrigins,
    credentials: !corsOrigins.includes('*')
}));
// Body limit on POST/PUT
app.use('/api/*', bodyLimit({
    maxSize: maxBodyMb * 1024 * 1024,
    onError: (c) => c.json({ success: false, message: `حجم درخواست از ${maxBodyMb}MB بیشتر است`, code: 413 }, 413)
}));
// Rate limit on /api/auth/*
app.use('/api/auth/*', (c, next) => authLimiter(c, next));
// Round 9 (2026-11-03): anti-spam for PUBLIC write endpoints (POST only — admin
// GET lists such as GET /api/orders are never limited). One bucket per IP and
// group (not per path), limits generous enough that real customers never hit them.
// Round 10: spoof-resistant client IP.
//  - socket address is PUBLIC  -> the site is exposed directly; proxy headers are
//    client-controlled there, so they are IGNORED (a bot cannot fake its IP).
//  - socket is loopback/private -> we sit behind a reverse proxy (nginx, docker):
//    use X-Real-IP (set by the proxy), else the LAST X-Forwarded-For entry (the
//    one the proxy appended itself; earlier entries can be forged by the client).
//  - behind a proxy without any header -> '' (caller decides: fail-open).
function isPrivateIp(ip) {
    if (!ip) return true;
    if (ip === '::1' || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip)) return true;
    const m = ip.match(/^(\d+)\.(\d+)\./);
    if (!m) return false;
    const a = +m[1], b = +m[2];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function clientIp(c) {
    let sock = '';
    try { sock = getConnInfo(c).remote.address || ''; } catch { sock = ''; }
    sock = sock.replace(/^::ffff:/i, '');
    if (sock && !isPrivateIp(sock)) return sock;
    const real = (c.req.header('x-real-ip') || '').trim();
    if (real) return real.replace(/^::ffff:/i, '');
    const xff = (c.req.header('x-forwarded-for') || '').split(',').map(x => x.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1].replace(/^::ffff:/i, '');
    return '';
}
function postLimit(group, windowMs, max) {
    const lim = rateLimit({ windowMs, max, keyFn: (c) => `${clientIp(c)}:pub:${group}` });
    return (c, next) => {
        if (c.req.method !== 'POST') return next();
        const ip = clientIp(c);
        // Fail-open: unknown or loopback address = a reverse proxy that does not pass
        // the visitor IP. Limiting then would put ALL customers in one bucket.
        if (!ip) return next();
        return lim(c, next);
    };
}
// Round 10: auth limiter keyed by the spoof-resistant IP (same window/limit as before)
const authLimiter = rateLimit({ windowMs: 60_000, max: 10, keyFn: (c) => `${clientIp(c) || 'unknown'}:${c.req.path}` });
app.use('/api/messages', postLimit('messages', 10 * 60_000, 5));
app.use('/api/products/:id/comments', postLimit('comments', 10 * 60_000, 10));
app.use('/api/blog/posts/:id/comments', postLimit('comments', 10 * 60_000, 10));
app.use('/api/newsletter/subscribe', postLimit('newsletter', 10 * 60_000, 10));
app.use('/api/orders', postLimit('orders', 10 * 60_000, 20));
app.use('/api/tickets', postLimit('tickets', 10 * 60_000, 10)); // Round 12: guest tickets (exact path; replies need login)
// ===== F3: SPA (pjax) fragment responses =====
// `site.js` navigates by fetching the next page with `X-NC-PJAX: 1`. Instead of
// shipping the whole document (header + mega-menu + footer ≈ 60 % of the bytes)
// we slice out <main id="main-content"> and answer with a small JSON payload.
// Everything stays server-rendered, so crawlers and no-JS visitors are
// unaffected — they simply never send the header and get the full document.
app.use('*', pjaxFragment); // only acts when the X-NC-PJAX header is present (storefront pages)
async function pjaxFragment(c, next) {
    await next();
    if (c.req.header('X-NC-PJAX') !== '1')
        return;
    const res = c.res;
    if (!res || res.status !== 200)
        return;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html'))
        return;
    try {
        const html = await res.clone().text();
        const open = html.indexOf('<main id="main-content"');
        if (open === -1)
            return;
        const start = html.indexOf('>', open) + 1;
        const end = html.lastIndexOf('</main>');
        if (start <= 0 || end <= start)
            return;
        const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
        const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
        c.res = new Response(JSON.stringify({
            html: html.slice(start, end),
            title: titleMatch ? decodeEntities(titleMatch[1]) : '',
            desc: descMatch ? decodeEntities(descMatch[1]) : ''
        }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
                'Vary': 'X-NC-PJAX'
            }
        });
    }
    catch (e) {
        /* fall through: the browser receives the full document and reloads */
    }
}
function decodeEntities(s) {
    return String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
// ===== Static (with long-term cache headers in production) =====
app.use('/static/*', async (c, next) => {
    await next();
    if (isProd) {
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
    }
    else {
        c.header('Cache-Control', 'public, max-age=300');
    }
});
// --- F2f: WebP content negotiation -------------------------------------
// Legacy URLs such as /static/uploads/u-123.jpg are still requested by CSS
// background-image rules, client-rendered cards and the admin panel, where a
// srcset cannot be used. When the browser advertises WebP support we quietly
// answer with the pre-built variant (~65% smaller) under the SAME URL.
// The original file is never modified and is still served to anything that
// does not ask for WebP, so this is a pure, reversible bandwidth win.
app.use('/static/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD')
        return next();
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(c.req.url).pathname);
    }
    catch (e) {
        return next();
    }
    // Only raster source images take part in negotiation.
    if (!/^\/static\/(images|uploads)\/.+\.(jpe?g|png|webp)$/i.test(pathname))
        return next();
    const entry = imgEntry(pathname);
    if (!entry)
        return next();
    // IMPORTANT: `Vary: Accept` must be present on BOTH branches. If only the
    // WebP answer carried it, a shared proxy could cache the original under a
    // key that ignores Accept and then hand a JPEG to a WebP client (or the
    // reverse) for the whole `immutable` year.
    const accept = c.req.header('accept') || '';
    if (!accept.includes('image/webp')) {
        await next();
        c.header('Vary', 'Accept');
        c.header('X-NC-Img', 'original');
        return;
    }
    const variantUrl = bestUrl(pathname, 1600);
    if (!variantUrl || variantUrl === pathname) {
        await next();
        c.header('Vary', 'Accept');
        return;
    }
    const file = nodePath.join(process.cwd(), 'public', variantUrl.replace(/^\//, ''));
    try {
        const buf = await nodeFs.promises.readFile(file);
        c.header('Content-Type', 'image/webp');
        c.header('Vary', 'Accept');
        c.header('X-NC-Img', 'webp');
        return c.body(buf);
    }
    catch (e) {
        await next();
        c.header('Vary', 'Accept');
        return;
    }
});
// Fallback for /static/uploads/* -> ./uploads/* if file only exists on persistent volume
// (Must run BEFORE serveStatic('./public') because serveStatic stops calling next() on missing files!)
app.use('/static/uploads/*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') {
        try {
            const pathname = decodeURIComponent(new URL(c.req.url).pathname);
            const primaryFile = nodePath.join(process.cwd(), 'public', pathname.replace(/^\//, ''));
            if (!nodeFs.existsSync(primaryFile)) {
                const fp = localImageFilePath(pathname);
                if (fp && nodeFs.existsSync(fp)) {
                    const buf = await nodeFs.promises.readFile(fp);
                    const ext = nodePath.extname(fp).toLowerCase();
                    const mime = ext === '.webp' ? 'image/webp' : ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
                    return c.body(buf, 200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' });
                }
            }
        } catch { /* fall through */ }
    }
    return next();
});
app.use('/static/*', serveStatic({ root: './public' }));
app.use('/uploads/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'public, max-age=86400');
});
app.use('/uploads/*', serveStatic({ root: './' }));
// Favicon: serve the real .ico from public/, fall back to 204 if missing
app.use('/favicon.ico', serveStatic({ path: './public/favicon.ico' }));
app.get('/favicon.ico', (c) => c.body(null, 204));
// ===== Change report (v3) =====
// A permanent, always-reachable link to the Persian change report so the owner
// never has to hunt for a download. Served from disk on every request so an
// updated report file goes live without a restart.
app.get('/report', async (c) => {
    try {
        const html = await nodeFs.promises.readFile(nodePath.join(process.cwd(), 'REPORT_V3.html'), 'utf8');
        c.header('Cache-Control', 'no-cache');
        return c.html(html);
    }
    catch (e) {
        return c.text('گزارش در دسترس نیست.', 404);
    }
});
// ===== Health =====
app.get('/api/health', (c) => {
    let dbOk = false;
    try {
        db.prepare('SELECT 1').get();
        dbOk = true;
    }
    catch { /* ignore */ }
    return c.json({
        success: true,
        data: {
            status: 'ok',
            uptime: Math.round(process.uptime()),
            memory: process.memoryUsage().rss,
            db: dbOk ? 'ok' : 'down',
            env: process.env.NODE_ENV || 'development',
            time: new Date().toISOString()
        },
        code: 200
    });
});
app.get('/api', (c) => {
    return c.json({
        success: true,
        data: {
            name: 'رادیس API',
            version: '1.0.0',
            endpoints: ['/api/health', '/api/auth', '/api/products', '/api/orders', '/api/tickets', '/api/blog']
        },
        code: 200
    });
});
// ===== API mounts =====
// ===== SSR micro-cache (declared before API routes so the invalidation
// middleware below can reference it) =====
const ssrCache = new Map();
function cachedHtml(key, ttlMs, render) {
    const now = Date.now();
    const hit = ssrCache.get(key);
    if (hit && hit.exp > now) return hit.html;
    const html = render();
    // cap cache size to avoid unbounded growth from many product slugs
    if (ssrCache.size > 300) ssrCache.clear();
    ssrCache.set(key, { html, exp: now + ttlMs });
    return html;
}
// Invalidate the SSR cache after ANY mutating API call (admin edits, reorder,
// bulk price, settings, banners, ...) so changes show up on the site instantly
// instead of waiting out the TTL.
app.use('/api/*', async (c, next) => {
    await next();
    if (c.req.method !== 'GET' && c.res.status < 400)
        ssrCache.clear();
});
app.route('/api/auth', authApi);
app.route('/api/products', productsApi);
app.route('/api/orders', ordersApi);
app.route('/api/tickets', ticketsApi);
app.route('/api/blog', blogApi);
app.route('/api/content', contentApi);
app.route('/api/product-io', productIoApi);
app.route('/torob_api/v3', torobApi);
app.route('/api/torob/v3', torobApi);
app.route('/api', miscApi);
// ===== Site Routes =====
// ===== Backward-compat: old /site1 URLs permanently redirect to the new root paths =====
app.get('/site1', (c) => {
    const q = new URL(c.req.url).search || '';
    return c.redirect('/' + q, 301);
});
app.get('/site1/*', (c) => {
    const p = c.req.path.replace(/^\/site1/, '') || '/';
    const q = new URL(c.req.url).search || '';
    return c.redirect(p + q, 301);
});
app.get('/', (c) => {
    const reqOrigin = requestOriginFromHono(c);
    return c.html(cachedHtml('home:' + reqOrigin, 30_000, () => homePage(reqOrigin)));
});
// Multiple home/landing pages (voice n9): admin-defined mini-homes per product family
app.get('/h/:slug', (c) => {
    const slug = c.req.param('slug') || '';
    const reqOrigin = requestOriginFromHono(c);
    const html = cachedHtml('hl:' + reqOrigin + ':' + slug, 30_000, () => homeLandingPage(slug, reqOrigin));
    if (!html)
        return c.html(notFoundPage('صفحه'), 404);
    return c.html(html);
});
app.get('/products', (c) => {
    const q = c.req.query();
    const reqOrigin = requestOriginFromHono(c);
    // Only cache the parameterized listing briefly (filters vary a lot)
    const key = 'plist:' + reqOrigin + ':' + JSON.stringify(q);
    return c.html(cachedHtml(key, 20_000, () => productsPage(q, reqOrigin)));
});
// Short permanent product link by numeric ID (`/p/123` -> 301 redirect to `/product/:slug`)
// Ensures even if a product slug is edited later, ID-based links never 404!
app.get('/p/:id', (c) => {
    const id = parseInt(c.req.param('id') || '0', 10);
    if (!Number.isFinite(id) || id < 1) return c.html(notFoundPage('محصول'), 404);
    const row = db.prepare(`SELECT slug FROM products WHERE id = ? AND status = 'active'${catVisSql('category_id')}`).get(id);
    if (!row || !row.slug) return c.html(notFoundPage('محصول'), 404);
    const q = new URL(c.req.url).search || '';
    return c.redirect('/product/' + encodeURIComponent(row.slug) + q, 301);
});
app.get('/product/:slug', (c) => {
    const slug = c.req.param('slug') || '';
    const reqOrigin = requestOriginFromHono(c);
    const html = cachedHtml('prod:' + reqOrigin + ':' + slug, 20_000, () => productPage(slug, reqOrigin));
    // S4 (2026-11-03): a missing / inactive product must answer HTTP 404 (was a «soft 404» = 200,
    // so Google kept deleted or deactivated products indexed).
    return c.html(html, html.includes('class="nc-error-page') ? 404 : 200);
});
app.get('/categories', (c) => {
    const reqOrigin = requestOriginFromHono(c);
    return c.html(cachedHtml('cats:' + reqOrigin, 30_000, () => categoriesPage(reqOrigin)));
});
app.get('/blog', (c) => {
    const reqOrigin = requestOriginFromHono(c);
    return c.html(cachedHtml('blog:' + reqOrigin, 30_000, () => blogListPage(reqOrigin)));
});
app.get('/blog/:slug', (c) => { const html = blogPostPage(c.req.param('slug') || '', requestOriginFromHono(c)); return c.html(html, html.includes('class="nc-error-page') ? 404 : 200); });
app.get('/cart', (c) => c.html(cartPage()));
app.get('/checkout', (c) => c.html(checkoutPage()));
app.get('/order-success/:orderNumber', (c) => c.html(orderSuccessPage(c.req.param('orderNumber') || '')));
app.get('/login', (c) => c.html(loginPage()));
app.get('/register', (c) => c.html(registerPage()));
app.get('/account', (c) => c.html(accountPage()));
app.get('/about', (c) => c.html(aboutPage()));
app.get('/contact', (c) => c.html(contactPage()));
app.get('/privacy', (c) => c.html(privacyPage()));
app.get('/terms', (c) => c.html(termsPage()));
// ===== Admin Routes =====
app.get('/admin/login', (c) => c.html(adminLoginPage()));
app.get('/admin', (c) => c.html(dashboardPage()));
app.get('/admin/products', (c) => c.html(adminProductsPage()));
app.get('/admin/orders', (c) => c.html(adminOrdersPage()));
app.get('/admin/tickets', (c) => c.html(adminTicketsPage()));
app.get('/admin/comments', (c) => c.html(adminCommentsPage()));
app.get('/admin/posts', (c) => c.html(adminPostsPage()));
app.get('/admin/categories', (c) => c.html(adminCategoriesPage()));
app.get('/admin/menu-builder', (c) => c.html(adminMenuBuilderPage()));
app.get('/admin/brands', (c) => c.html(adminBrandsPage()));
app.get('/admin/customers', (c) => c.html(adminCustomersPage('customer')));
app.get('/admin/users', (c) => c.html(adminCustomersPage('admin')));
app.get('/admin/messages', (c) => c.html(adminMessagesPage()));
app.get('/admin/newsletter', (c) => c.html(adminNewsletterPage()));
app.get('/admin/activity-logs', (c) => c.html(adminActivityLogsPage()));
app.get('/admin/reports', (c) => c.html(adminReportsPage()));
app.get('/admin/settings', (c) => c.html(adminSettingsPage()));
app.get('/admin/profile', (c) => c.html(adminProfilePage()));
app.get('/admin/site-content', (c) => c.html(adminSiteContentPage()));
app.get('/admin/banners', (c) => c.html(adminBannersPage()));
app.get('/admin/home-pages', (c) => c.html(adminHomePagesPage()));
app.get('/admin/product-order', (c) => c.html(adminProductOrderPage()));
app.get('/admin/pricing', (c) => c.html(adminPricingPage()));
// ===== sitemap.xml =====
app.get('/sitemap.xml', (c) => {
    const baseUrl = resolveSiteBaseUrl(null, requestOriginFromHono(c));
    const products = db.prepare(`SELECT slug, updated_at FROM products WHERE status = 'active'${catVisSql('category_id')}`).all();
    const posts = db.prepare(`SELECT slug, updated_at FROM posts WHERE status = 'published'`).all();
    const cats = visibleCats(db.prepare(`SELECT id, slug FROM categories`).all());
    const staticUrls = ['/', '/products', '/categories', '/blog', '/about', '/contact'];
    const xmlEsc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const encSeg = (v) => encodeURIComponent(String(v || ''));
    const safeIsoDate = (d) => { try { const x = new Date(d); return Number.isNaN(x.getTime()) ? '' : x.toISOString().split('T')[0]; } catch { return ''; } };
    const urls = [
        ...staticUrls.map(u => ({ loc: baseUrl + u, priority: u === '/' ? '1.0' : '0.8' })),
        ...cats.map(c => ({ loc: `${baseUrl}/products?category=${encSeg(c.slug)}`, priority: '0.7' })),
        ...products.map(p => ({ loc: `${baseUrl}/product/${encSeg(p.slug)}`, lastmod: safeIsoDate(p.updated_at), priority: '0.9' })),
        ...posts.map(p => ({ loc: `${baseUrl}/blog/${encSeg(p.slug)}`, lastmod: safeIsoDate(p.updated_at), priority: '0.6' }))
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${xmlEsc(u.loc)}</loc>
    ${u.lastmod ? `<lastmod>${xmlEsc(u.lastmod)}</lastmod>` : ''}
    <priority>${u.priority || '0.5'}</priority>
  </url>`).join('\n')}
</urlset>`;
    return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
});
// ===== robots.txt =====
app.get('/robots.txt', (c) => {
    const baseUrl = resolveSiteBaseUrl(null, requestOriginFromHono(c));
    const txt = `User-agent: *
Allow: /
Allow: /product/
Allow: /products
Allow: /static/
Allow: /torob_api/
Disallow: /admin/
Disallow: /api/
Disallow: /checkout
Disallow: /cart
Disallow: /account

Sitemap: ${baseUrl}/sitemap.xml
`;
    return c.body(txt, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});
// ===== 404 handlers =====
app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) {
        return c.json({ success: false, message: 'منبع یافت نشد', code: 404 }, 404);
    }
    if (c.req.path.startsWith('/admin')) {
        return c.html(adminNotFoundPage(), 404);
    }
    return c.html(notFoundPage('صفحه'), 404);
});
app.onError((err, c) => {
    console.error('[ERROR]', err);
    if (c.req.path.startsWith('/api/')) {
        // Round 15: a recognised DB error (value too long / duplicate / bad number)
        // is the user's input, not a server fault -> 400 with a Persian message.
        const known = knownDbError(err);
        if (known)
            return c.json({ success: false, message: known, code: 400 }, 400);
        return c.json({ success: false, message: 'خطای داخلی سرور', code: 500 }, 500);
    }
    if (c.req.path.startsWith('/admin')) {
        return c.html(adminNotFoundPage(), 500);
    }
    return c.html(notFoundPage('صفحه', 500), 500);
});
// ===== Start =====
const PORT = parseInt(process.env.PORT || '3000');
const server = serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
    console.log(`✅ رادیس server running on http://localhost:${info.port}`);
    console.log(`   📦 Site:   http://localhost:${info.port}/`);
    console.log(`   🛡️  Admin:  http://localhost:${info.port}/admin/login`);
    console.log(`   ❤️  Health: http://localhost:${info.port}/api/health`);
});
// ===== Graceful shutdown =====
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    console.log(`\n[${signal}] Graceful shutdown initiated...`);
    // Stop accepting new connections
    try {
        server.close?.(() => console.log('[shutdown] HTTP server closed.'));
    }
    catch { }
    // Close DB
    try {
        closeDatabase();
        console.log('[shutdown] Database closed.');
    }
    catch (e) {
        console.error(e);
    }
    // Force exit after 5s
    setTimeout(() => { console.log('[shutdown] Force exit'); process.exit(0); }, 5000);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
export default app;
