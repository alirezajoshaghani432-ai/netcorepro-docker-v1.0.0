import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
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
import authApi from './api/auth.js';
import productsApi from './api/products.js';
import ordersApi from './api/orders.js';
import ticketsApi from './api/tickets.js';
import blogApi from './api/blog.js';
import miscApi from './api/misc.js';
import contentApi from './api/content.js';
import { homePage, productsPage, productPage, categoriesPage, blogListPage, blogPostPage, cartPage, checkoutPage, orderSuccessPage, loginPage, registerPage, accountPage, aboutPage, contactPage, privacyPage, termsPage, notFoundPage } from './views/site/pages.js';
import { adminLoginPage, dashboardPage, adminProductsPage, adminOrdersPage, adminTicketsPage, adminCommentsPage, adminPostsPage, adminCategoriesPage, adminBrandsPage, adminCustomersPage, adminMessagesPage, adminNewsletterPage, adminActivityLogsPage, adminReportsPage, adminSettingsPage, adminProfilePage, adminSiteContentPage, adminBannersPage, adminProductOrderPage, adminPricingPage, adminNotFoundPage } from './views/admin/pages.js';
import { adminMenuBuilderPage } from './views/admin/menu-builder.js';
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
    crossOriginResourcePolicy: 'same-site'
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
app.use('/api/auth/*', rateLimit({ windowMs: 60_000, max: 10 }));
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
app.use('/static/*', serveStatic({ root: './public' }));
app.use('/uploads/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'public, max-age=86400');
});
app.use('/uploads/*', serveStatic({ root: './' }));
// Favicon: serve the real .ico from public/, fall back to 204 if missing
app.use('/favicon.ico', serveStatic({ path: './public/favicon.ico' }));
app.get('/favicon.ico', (c) => c.body(null, 204));
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
            name: 'NetCore Pro API',
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
app.get('/', (c) => c.html(cachedHtml('home', 30_000, () => homePage())));
app.get('/products', (c) => {
    const q = c.req.query();
    // Only cache the parameterized listing briefly (filters vary a lot)
    const key = 'plist:' + JSON.stringify(q);
    return c.html(cachedHtml(key, 20_000, () => productsPage(q)));
});
app.get('/product/:slug', (c) => {
    const slug = c.req.param('slug') || '';
    return c.html(cachedHtml('prod:' + slug, 20_000, () => productPage(slug)));
});
app.get('/categories', (c) => c.html(cachedHtml('cats', 30_000, () => categoriesPage())));
app.get('/blog', (c) => c.html(cachedHtml('blog', 30_000, () => blogListPage())));
app.get('/blog/:slug', (c) => c.html(blogPostPage(c.req.param('slug') || '')));
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
app.get('/admin/product-order', (c) => c.html(adminProductOrderPage()));
app.get('/admin/pricing', (c) => c.html(adminPricingPage()));
// ===== sitemap.xml =====
app.get('/sitemap.xml', (c) => {
    const baseUrl = (c.req.header('host') ? `${c.req.header('x-forwarded-proto') || 'http'}://${c.req.header('host')}` : 'https://netcorepro.ir');
    const products = db.prepare(`SELECT slug, updated_at FROM products WHERE status = 'active'`).all();
    const posts = db.prepare(`SELECT slug, updated_at FROM posts WHERE status = 'published'`).all();
    const cats = db.prepare(`SELECT slug FROM categories`).all();
    const staticUrls = ['/', '/products', '/categories', '/blog', '/about', '/contact'];
    const urls = [
        ...staticUrls.map(u => ({ loc: baseUrl + u, priority: u === '/' ? '1.0' : '0.8' })),
        ...cats.map(c => ({ loc: `${baseUrl}/products?category=${c.slug}`, priority: '0.7' })),
        ...products.map(p => ({ loc: `${baseUrl}/product/${p.slug}`, lastmod: p.updated_at, priority: '0.9' })),
        ...posts.map(p => ({ loc: `${baseUrl}/blog/${p.slug}`, lastmod: p.updated_at, priority: '0.6' }))
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    ${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString().split('T')[0]}</lastmod>` : ''}
    <priority>${u.priority || '0.5'}</priority>
  </url>`).join('\n')}
</urlset>`;
    return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
});
// ===== robots.txt =====
app.get('/robots.txt', (c) => {
    const baseUrl = (c.req.header('host') ? `${c.req.header('x-forwarded-proto') || 'http'}://${c.req.header('host')}` : 'https://netcorepro.ir');
    const txt = `User-agent: *
Allow: /
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
    console.log(`✅ NetCore Pro server running on http://localhost:${info.port}`);
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
