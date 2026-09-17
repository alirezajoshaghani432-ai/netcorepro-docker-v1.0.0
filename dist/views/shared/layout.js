import { getAllSettings } from '../../utils/helpers.js';
import { ncImg } from '../../utils/img.js';
import { getBlocks } from '../../api/content.js';
import { getChannels, primaryChannel } from '../../utils/contact.js';
import db from '../../db/index.js';

/**
 * Self-hosted assets. NO external CDN.
 * All files are served from /static/* by the same Hono server.
 */
// Bump ASSET_V on every CSS/JS change: /static/* is served with
// "immutable, max-age=1y", so without a version query browsers keep
// the old (purple/unstyled) files forever.
export const ASSET_V = '20260911a';
/**
 * Performance: the storefront loads ONE render-blocking stylesheet
 * (`nc-site.min.css`, built by `scripts/perf/build_css.py`) instead of four.
 *   vazirmatn.css + fontawesome.min.css + tailwind.min.css + app.css
 *   = 345 KB over 4 requests  ->  ~102 KB over 1 request (~18 KB gzipped).
 * Fonts are subsetted (same Vazirmatn typeface, ~32 % smaller; FontAwesome
 * 283 KB -> 13.6 KB) and the above-the-fold faces are preloaded so they are
 * fetched in parallel with the CSS instead of after it (kills the 790 ms
 * "font-display" and the 4388 ms critical-path findings).
 * /admin/* deliberately keeps the legacy four-file head.
 */
const LOCAL_HEAD = `
<link rel="preload" href="/static/fonts/vazirmatn/Vazirmatn-var.sub.woff2?v=${ASSET_V}" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/static/webfonts/fa-solid-900.sub.woff2?v=${ASSET_V}" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/css/nc-site.min.css?v=${ASSET_V}">
<script src="/static/js/axios.min.js" defer></script>
`;

/**
 * Bidi-safe product counts for the mega-menu.
 *
 * In an RTL paragraph the Unicode Bidi Algorithm reorders a trailing "(5)"
 * that follows a LATIN run to the LEFT of that run, so a reader scanning
 * right-to-left meets the count in the MIDDLE of a mixed Persian+Latin label:
 *     source 'کابل Cat6 UTP (5)'  ->  visual order 'کابل)5(PTU6taC'
 * Pure-Persian labels are unaffected, which is why only mixed labels break.
 * A per-character probe is available in scripts/qa/bidi_probe.py.
 *
 * The label and the count are therefore rendered as two separate flex cells
 * (see .nc-megacol-links li a in app.css) so the count can never be pulled
 * into the name. Counts use Persian digits for a native look.
 */
function faDigits(n) {
    return String(n).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[+d]);
}

function getNavCategories() {
    try {
        // `show_in_menu` hides a category from the header menu (managed in
        // /admin/menu-builder) without deleting it, since deletion is blocked
        // while products are still attached. Older databases lack the column,
        // so COALESCE keeps this backward-compatible.
        const all = db.prepare(`SELECT id, parent_id, name, slug, icon FROM categories
                                WHERE COALESCE(show_in_menu, 1) = 1
                                ORDER BY sort_order, name`).all();
        const roots = all.filter(c => !c.parent_id);
        const byParent = {};
        for (const c of all) {
            if (c.parent_id) {
                (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c);
            }
        }
        // The mega menu lists CATEGORY names only, never individual products.
        // Each root column shows its sub-categories with active-product counts;
        // products appear on the listing pages.
        const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM products WHERE status = 'active' AND category_id IN (SELECT id FROM categories WHERE id = ? OR parent_id = ?)`);
        return roots.map(r => ({
            ...r,
            children: (byParent[r.id] || []).map(ch => ({ ...ch, count: countStmt.get(ch.id, ch.id).n })),
            count: countStmt.get(r.id, r.id).n
        }));
    } catch { return []; }
}

// G1 (barghchi-style mega board): brand logos strip at the bottom of the open menu
function getNavBrands() {
    try {
        return db.prepare("SELECT name, slug, logo FROM brands WHERE logo IS NOT NULL AND logo != '' ORDER BY id LIMIT 8").all();
    } catch { return []; }
}
export function siteLayout(opts, content) {
    const settings = getAllSettings();
    const siteName = settings.site_name || 'NetCore Pro';
    const tagline = settings.site_tagline || 'تجهیزات شبکه حرفه‌ای';
    const desc = opts.description || settings.site_description || '';
    const path = opts.currentPath || '/';
    const phone = settings.phone || '۰۲۵-۳۷۱۶۵';
    const navCats = getNavCategories();
    const navBrands = getNavBrands();
    // F1: every contact/chat button below is data-driven from /admin/settings
    const channels = getChannels(settings);
    const expert = primaryChannel(settings);
    const callCh = channels.find(c => c.key === 'call') || channels.find(c => c.key === 'mobile');
    const telHref = callCh ? callCh.href : 'tel:' + String(phone).replace(/[^+0-9]/g, '');
    const expertLabel = (settings.chan_expert_label || '').trim() || 'گفتگو با کارشناسان';
    const chanLink = (c, cls) => `<a href="${escapeAttr(c.href)}"${c.external ? ' target="_blank" rel="noopener"' : ''} class="${cls}" aria-label="${escapeAttr(c.label)}"><i class="${c.icon}"></i></a>`;

    const isActive = (p) => path === p || (p !== '/' && p !== '/' && path.startsWith(p));
    const topNav = (href, label, icon) => `<a href="${href}" class="nc-topnav-link ${isActive(href) ? 'is-active' : ''}"><i class="fas ${icon} ml-1.5 text-[13px]"></i>${label}</a>`;

    const ogTitle = `${opts.title} | ${siteName}`;
    const ogDesc = desc || 'فروشگاه آنلاین تخصصی تجهیزات شبکه، فیبر نوری و برق';
    const ogImage = opts.ogImage || settings.og_image || '/static/images/og-default.svg';
    const metaKeywords = opts.keywords ? `<meta name="keywords" content="${escapeAttr(opts.keywords)}">` : '';
    // SEO: canonical URL (path only — the host is prepended by search engines from the fetch URL,
    // and settings.site_url lets the admin pin an absolute canonical domain)
    const siteUrl = String(settings.site_url || '').replace(/\/+$/, '');
    const canonicalHref = siteUrl ? siteUrl + path : path;
    const canonicalTag = `<link rel="canonical" href="${escapeAttr(canonicalHref)}">`;
    // SEO: JSON-LD structured data (page-specific blocks can be passed via opts.jsonLd)
    // Security: escape <, >, & as \u003c etc. so user-controlled strings (e.g. a product
    // name containing "</script>") cannot break out of the JSON-LD <script> block (XSS).
    const jsonLdSafe = opts.jsonLd ? JSON.stringify(opts.jsonLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026') : '';
    const jsonLdTag = jsonLdSafe ? `<script type="application/ld+json">${jsonLdSafe}</script>` : '';
    // Always emit WebSite + Organization so Google never indexes a leftover "site1" brand.
    const websiteLd = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebSite',
                '@id': (siteUrl || 'https://netcorepro.ir') + '/#website',
                name: siteName,
                url: siteUrl || 'https://netcorepro.ir',
                inLanguage: 'fa-IR',
                description: ogDesc,
                publisher: { '@id': (siteUrl || 'https://netcorepro.ir') + '/#organization' },
            },
            {
                '@type': 'Organization',
                '@id': (siteUrl || 'https://netcorepro.ir') + '/#organization',
                name: siteName,
                url: siteUrl || 'https://netcorepro.ir',
                logo: ogImage,
            },
        ],
    };
    const websiteLdSafe = JSON.stringify(websiteLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    const websiteLdTag = `<script type="application/ld+json">${websiteLdSafe}</script>`;

    return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#1d6ef5">
<title>${escapeHtml(opts.title)} | ${escapeHtml(siteName)}</title>
<meta name="description" content="${escapeHtml(ogDesc)}">
<meta name="robots" content="index, follow">${metaKeywords}
<meta name="format-detection" content="telephone=no">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(siteName)}">
<meta property="og:title" content="${escapeHtml(ogTitle)}">
<meta property="og:description" content="${escapeHtml(ogDesc)}">
<meta property="og:image" content="${escapeAttr(ogImage)}">
<meta property="og:locale" content="fa_IR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(ogTitle)}">
<meta name="twitter:description" content="${escapeHtml(ogDesc)}">
<meta name="twitter:image" content="${escapeAttr(ogImage)}">
${canonicalTag}${websiteLdTag}${jsonLdTag}
<link rel="icon" type="image/svg+xml" href="/static/images/favicon.svg">
<link rel="alternate icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/static/images/favicon.svg">
${LOCAL_HEAD}
${opts.extraHead || ''}
<script>
  /* ncpReady(cb): run cb only after the site runtime (window.NCPCart from site.js,
     loaded with defer) is available. Inline page scripts execute before deferred
     scripts, so calling NCPCart directly at parse time throws
     "Cannot read properties of undefined". This guard waits for readiness. */
  (function () {
    window.ncpReady = function (cb) {
      if (typeof cb !== 'function') return;
      function ready() { return window.NCPCart && typeof window.NCPCart.get === 'function'; }
      function run() {
        if (ready()) { try { cb(); } catch (e) { console.error('[ncpReady]', e); } return true; }
        return false;
      }
      if (run()) return;
      var tries = 0;
      var timer = setInterval(function () {
        if (run() || ++tries > 100) clearInterval(timer); // up to ~5s
      }, 50);
      // also hook DOMContentLoaded (fires after deferred scripts complete)
      document.addEventListener('DOMContentLoaded', function () { if (ready()) { clearInterval(timer); run(); } });
    };
  })();
</script>
</head>
<body class="${opts.bodyClass || ''} nc-body">

<a href="#main-content" class="skip-link">پرش به محتوای اصلی</a>

<!-- ===== Top utility bar (desktop) ===== -->
<div class="nc-topbar">
  <div class="nc-container nc-topbar-inner">
    <div class="flex items-center gap-5">
      <span class="nc-topbar-item"><i class="far fa-clock"></i> از ساعت ۹ تا ۱۷ در روزهای کاری پاسخگوی شما هستیم</span>
    </div>
    <div class="flex items-center gap-5">
      ${expert ? `<a href="${escapeAttr(expert.href)}"${expert.external ? ' target="_blank" rel="noopener"' : ''} class="nc-topbar-item"><i class="far fa-comment-dots"></i> ${escapeHtml(expertLabel)}</a>` : ''}
      <a href="${escapeAttr(telHref)}" class="nc-topbar-item"><i class="fas fa-phone-volume"></i> ${escapeHtml(phone)}</a>
    </div>
  </div>
</div>

<!-- ===== Main header ===== -->
<header class="nc-header" role="banner">
  <div class="nc-container nc-header-inner">
    <!-- right: logo -->
    <a href="/" class="nc-logo" aria-label="صفحه اصلی ${escapeHtml(siteName)}">
      ${settings.site_logo ? `${ncImg(settings.site_logo, { alt: siteName, cls: 'nc-logo-img', sizes: '170px', ratio: false, loading: 'eager', fetchpriority: 'high' })}` : ''}
      <div class="nc-logo-text">
        <span class="nc-logo-title">${escapeHtml(siteName)}</span>
        <span class="nc-logo-sub">${escapeHtml(tagline)}</span>
      </div>
      <span class="nc-logo-home"><i class="fas fa-home"></i></span>
    </a>

    <!-- center: search -->
    <form class="nc-search" id="nc-search-form" role="search">
      <button type="submit" class="nc-search-btn" aria-label="جستجو"><i class="fas fa-search"></i></button>
      <input id="nc-search-input" type="text" name="q" placeholder="جستجو در میان هزاران محصول..." autocomplete="off" aria-label="جستجوی محصول">
    </form>

    <!-- special offer badge (desktop) -->
    <a href="/products?sort=discount" class="nc-offer-badge">
      <span class="nc-offer-icon"><i class="fas fa-percent"></i></span>
      <span class="nc-offer-text"><b>تخفیفات ویژه</b><i>ارزان بخر</i></span>
    </a>

    <!-- left: actions -->
    <div class="nc-actions">
      <a href="/account" class="nc-icon-btn nc-hide-mobile" title="علاقه‌مندی‌ها" aria-label="علاقه‌مندی‌ها"><i class="far fa-heart"></i></a>
      <a href="/cart" class="nc-icon-btn nc-cart-btn" title="سبد خرید" aria-label="سبد خرید">
        <i class="fas fa-shopping-cart"></i>
        <span id="cart-count" class="nc-cart-badge hidden">0</span>
      </a>
      <div id="header-user-area" class="nc-hide-mobile"></div>
    </div>
  </div>

  <!-- ===== Nav row (desktop) ===== -->
  <nav class="nc-navrow nc-hide-mobile" role="navigation" aria-label="منوی اصلی">
    <div class="nc-container nc-navrow-inner">
      <div class="nc-cats" id="nc-cats">
        <button class="nc-cats-btn" id="nc-cats-btn" aria-haspopup="true" aria-expanded="false">
          <i class="fas fa-th-large"></i> دسته‌بندی کالاها <i class="fas fa-chevron-down text-[11px] mr-1"></i>
        </button>
        <div class="nc-cats-menu nc-megamenu nc-megaboard" id="nc-cats-menu">
          <div class="nc-megaboard-cols">
            ${navCats.map(c => `
            <div class="nc-megacol">
              <a href="/products?category=${escapeAttr(c.slug)}" class="nc-megacol-head">${escapeHtml(c.name)}</a>
              <ul class="nc-megacol-links">
                ${(c.children || []).map(sc => `<li><a href="/products?category=${escapeAttr(sc.slug)}"><span class="nc-megalabel">${escapeHtml(sc.name)}</span>${sc.count ? `<span class="nc-megacount">${faDigits(sc.count)}</span>` : ''}</a></li>`).join('')}
                <li class="more"><a href="/products?category=${escapeAttr(c.slug)}"><span class="nc-megalabel">مشاهده همه${c.count ? ` (${faDigits(c.count)} کالا)` : ''}</span> <i class="fas fa-angle-left"></i></a></li>
              </ul>
            </div>`).join('')}
          </div>
          ${navBrands.length ? `<div class="nc-megaboard-brands">${navBrands.map(b => `<a href="/products?brand=${escapeAttr(b.slug)}" title="${escapeAttr(b.name)}">${ncImg(b.logo, { alt: b.name, sizes: '120px', ratio: false })}</a>`).join('')}</div>` : ''}
        </div>
      </div>
      <div class="nc-topnav">
        ${topNav('/products', 'محصولات', 'fa-box')}
        ${topNav('/blog', 'مجله', 'fa-newspaper')}
        ${topNav('/about', 'درباره ما', 'fa-circle-info')}
        ${topNav('/terms', 'شرایط گارانتی', 'fa-shield-halved')}
        ${topNav('/cart', 'صدور پیش‌فاکتور', 'fa-file-invoice')}
        ${topNav('/contact', 'تماس با ما', 'fa-envelope')}
      </div>
      <a href="${escapeAttr(telHref)}" class="nc-navphone"><i class="fas fa-phone"></i> ${escapeHtml(phone)}</a>
    </div>
  </nav>

  <!-- ===== Mobile top bar ===== -->
  <div class="nc-mobilebar nc-show-mobile">
    <button id="mobile-menu-btn" class="nc-icon-btn" aria-label="منو"><i class="fas fa-bars"></i></button>
    <a href="/" class="nc-mobile-logo">${escapeHtml(siteName)}</a>
    <a href="/account" class="nc-icon-btn" aria-label="حساب کاربری"><i class="far fa-user"></i></a>
  </div>
  <form class="nc-search nc-search-mobile nc-show-mobile" id="nc-search-form-m" role="search">
    <button type="submit" class="nc-search-btn" aria-label="جستجو"><i class="fas fa-search"></i></button>
    <input type="text" name="q" placeholder="جستجو در میان هزاران محصول..." autocomplete="off" aria-label="جستجوی محصول">
  </form>
</header>

<!-- ===== Mobile drawer ===== -->
<div id="nc-drawer-overlay" class="nc-drawer-overlay"></div>
<aside id="nc-drawer" class="nc-drawer" aria-label="منوی موبایل">
  <div class="nc-drawer-head">
    <span class="font-extrabold text-lg">${escapeHtml(siteName)}</span>
    <button id="nc-drawer-close" class="nc-icon-btn" aria-label="بستن"><i class="fas fa-times"></i></button>
  </div>
  <div id="nc-drawer-user" class="nc-drawer-user"></div>
  <div class="nc-drawer-section-title">دسته‌بندی کالاها</div>
  <div class="nc-drawer-cats">
    ${navCats.map(c => `<a href="/products?category=${escapeAttr(c.slug)}" class="nc-drawer-link"><i class="fas ${escapeAttr(c.icon || 'fa-network-wired')} ml-2 text-blue-600"></i>${escapeHtml(c.name)}</a>`).join('')}
  </div>
  <div class="nc-drawer-section-title">دسترسی سریع</div>
  <a href="/products" class="nc-drawer-link"><i class="fas fa-box ml-2 text-blue-600"></i>محصولات</a>
  <a href="/blog" class="nc-drawer-link"><i class="fas fa-newspaper ml-2 text-blue-600"></i>مجله</a>
  <a href="/about" class="nc-drawer-link"><i class="fas fa-circle-info ml-2 text-blue-600"></i>درباره ما</a>
  <a href="/contact" class="nc-drawer-link"><i class="fas fa-envelope ml-2 text-blue-600"></i>تماس با ما</a>
  <a href="/terms" class="nc-drawer-link"><i class="fas fa-shield-halved ml-2 text-blue-600"></i>شرایط گارانتی</a>
  ${channels.length ? `
  <div class="nc-drawer-section-title">${escapeHtml(expertLabel)}</div>
  <div class="nc-drawer-chans">
    ${channels.map(c => `<a href="${escapeAttr(c.href)}"${c.external ? ' target="_blank" rel="noopener"' : ''} class="nc-chan-chip ${c.cls}"><i class="${c.icon}"></i><span>${escapeHtml(c.display || c.label)}</span></a>`).join('')}
  </div>` : ''}
</aside>

<main id="main-content" class="flex-1" role="main" tabindex="-1">
${content}
</main>

<!-- ===== Footer ===== -->
<footer class="nc-footer" role="contentinfo">
  <div class="nc-container nc-footer-grid">
    <div>
      <h4 class="nc-footer-title">${escapeHtml(siteName)}</h4>
      <p class="nc-footer-about">${escapeHtml(settings.footer_about || `${siteName} مرجع تخصصی فروش تجهیزات شبکه، فیبر نوری و برقی برای کسب‌وکارها و سازمان‌ها. ما تامین تجهیزات اصلی با گارانتی معتبر را تضمین می‌کنیم.`)}</p>
      <div class="nc-footer-social">
        ${channels.map(c => chanLink(c, `nc-social-${c.cls}`)).join('')}
      </div>
    </div>
    <div>
      <h4 class="nc-footer-title">دسترسی سریع</h4>
      <ul class="nc-footer-links">
        ${(() => {
            const links = getBlocks('footer', 'quick_links');
            const fallback = [
                { title: 'محصولات', href: '/products' },
                { title: 'دسته‌بندی‌ها', href: '/categories' },
                { title: 'پیشنهاد لحظه‌ای', href: '/products?sort=discount' },
                { title: 'مجله ' + siteName, href: '/blog' },
                { title: 'درباره ما', href: '/about' }
            ];
            const items = links.length ? links : fallback;
            return items.map(l => `<li><a href="${escapeAttr(l.href || '#')}">${escapeHtml(l.title)}</a></li>`).join('');
        })()}
      </ul>
    </div>
    <div>
      <h4 class="nc-footer-title">خدمات مشتریان</h4>
      <ul class="nc-footer-links">
        <li><a href="/account">حساب کاربری</a></li>
        <li><a href="/account">سفارش‌های من</a></li>
        <li><a href="/cart">سبد خرید</a></li>
        <li><a href="/terms">شرایط گارانتی</a></li>
        <li><a href="/privacy">حریم خصوصی</a></li>
        <li><a href="/terms">شرایط استفاده</a></li>
      </ul>
    </div>
    <div>
      <h4 class="nc-footer-title">تماس با ما</h4>
      <ul class="nc-footer-contact">
        ${settings.phone   ? `<li><i class="fas fa-phone"></i><span>${escapeHtml(settings.phone)}</span></li>` : ''}
        ${settings.email   ? `<li><i class="far fa-envelope"></i><span>${escapeHtml(settings.email)}</span></li>` : ''}
        ${settings.address ? `<li><i class="fas fa-location-dot"></i><span>${escapeHtml(settings.address)}</span></li>` : ''}
      </ul>
      <form id="newsletter-form" class="nc-newsletter">
        <input type="email" name="email" required placeholder="ایمیل خود را برای دریافت تخفیف‌ها وارد کنید" aria-label="ایمیل">
        <button type="submit" class="nc-newsletter-btn"><i class="fas fa-paper-plane ml-2"></i>عضویت در خبرنامه</button>
      </form>
    </div>
  </div>
  <div class="nc-footer-bottom">
    <span>© ${new Date().getFullYear()} ${escapeHtml(siteName)} — تمام حقوق محفوظ است.</span>
    <span>طراحی و توسعه: تیم فنی ${escapeHtml(siteName)}</span>
  </div>
</footer>

<!-- ===== Mobile bottom nav ===== -->
<nav class="nc-bottomnav nc-show-mobile" aria-label="ناوبری موبایل">
  <a href="/" class="nc-bottomnav-item ${path === '/' ? 'is-active' : ''}"><i class="fas fa-home"></i><span>خانه</span></a>
  <a href="/categories" class="nc-bottomnav-item ${isActive('/categories') ? 'is-active' : ''}"><i class="fas fa-th-large"></i><span>دسته‌ها</span></a>
  <a href="/products" class="nc-bottomnav-item ${isActive('/products') ? 'is-active' : ''}"><i class="fas fa-box"></i><span>محصولات</span></a>
  <a href="/cart" class="nc-bottomnav-item nc-bottomnav-cart ${isActive('/cart') ? 'is-active' : ''}"><i class="fas fa-shopping-cart"></i><span id="cart-count-m" class="nc-bottomnav-badge hidden">0</span><span>سبد</span></a>
  <a href="/account" class="nc-bottomnav-item ${isActive('/account') ? 'is-active' : ''}"><i class="far fa-user"></i><span>حساب</span></a>
</nav>

<div id="toast-container" class="fixed top-24 left-4 z-[200] space-y-2" role="region" aria-live="polite" aria-label="اعلان‌ها"></div>

<script>
  document.addEventListener('DOMContentLoaded', function () {
    // mobile drawer
    var openBtn = document.getElementById('mobile-menu-btn');
    var drawer = document.getElementById('nc-drawer');
    var overlay = document.getElementById('nc-drawer-overlay');
    var closeBtn = document.getElementById('nc-drawer-close');
    function openDrawer(){ drawer.classList.add('open'); overlay.classList.add('open'); document.body.style.overflow='hidden'; }
    function closeDrawer(){ drawer.classList.remove('open'); overlay.classList.remove('open'); document.body.style.overflow=''; }
    if (openBtn) openBtn.addEventListener('click', openDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (overlay) overlay.addEventListener('click', closeDrawer);

    // ================================================================
    // Categories mega-menu (desktop).
    // Two pointer-behaviour details are handled here:
    //  * there is a 10px gap between the button and the panel; a CSS
    //    hover-bridge covers it, and an intent delay below keeps the panel
    //    open during a fast diagonal sweep instead of snapping it shut;
    //  * after clicking a category, pjax swaps the page while the pointer is
    //    still over the menu, so the .nc-cats:hover rule would re-show the
    //    panel on top of the new content. It is hard-closed and stays shut
    //    until the pointer genuinely leaves.
    // ================================================================
    var catsBtn = document.getElementById('nc-cats-btn');
    var cats = document.getElementById('nc-cats');
    if (catsBtn && cats) {
      var catsMenu = document.getElementById('nc-cats-menu');
      var closeT = null;

      function setExpanded(v){ try { catsBtn.setAttribute('aria-expanded', v ? 'true' : 'false'); } catch(e){} }
      function openCats(){
        clearTimeout(closeT);
        cats.classList.remove('nc-force-closed');
        cats.classList.add('open');
        setExpanded(true);
      }
      /** Hard close: beats the :hover rule until the pointer leaves. */
      function closeCats(){
        clearTimeout(closeT);
        cats.classList.remove('open');
        setExpanded(false);
        // the lock is only needed while the pointer is still inside the menu
        var inside = false;
        try { inside = cats.matches(':hover'); } catch(e){}
        if (inside) {
          cats.classList.add('nc-force-closed');
          var release = function(){
            cats.classList.remove('nc-force-closed');
            cats.removeEventListener('mouseleave', release);
          };
          cats.addEventListener('mouseleave', release);
        }
      }
      window.NCPCloseCats = closeCats;

      catsBtn.addEventListener('click', function(e){
        e.preventDefault();
        cats.classList.contains('open') ? closeCats() : openCats();
      });
      // hover intent — open at once, close after a short grace period
      cats.addEventListener('mouseenter', openCats);
      cats.addEventListener('mouseleave', function(){
        clearTimeout(closeT);
        closeT = setTimeout(function(){ cats.classList.remove('open'); setExpanded(false); }, 240);
      });
      // D2: any link inside the panel closes it immediately on click, so the
      // destination page is never hidden behind the menu (covers both the
      // pjax path and a hard navigation).
      if (catsMenu) {
        catsMenu.addEventListener('click', function(e){
          var a = e.target && e.target.closest ? e.target.closest('a') : null;
          if (a) closeCats();
        });
      }
      document.addEventListener('click', function(e){ if(!cats.contains(e.target)) closeCats(); });
      document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeCats(); });
    }
    // mega menu: hovering a root category shows its sub-category flyout panel
    (function(){
      var items = document.querySelectorAll('#nc-cats-menu .nc-cats-item[data-mega]');
      var panels = document.querySelectorAll('#nc-mega-panel .nc-mega-sub');
      if (!items.length || !panels.length) return;
      items.forEach(function(it){
        it.addEventListener('mouseenter', function(){
          var idx = it.getAttribute('data-mega');
          items.forEach(function(x){ x.classList.remove('is-hover'); });
          it.classList.add('is-hover');
          panels.forEach(function(p){ p.classList.toggle('active', p.getAttribute('data-mega-panel') === idx); });
        });
      });
    })();

    // search submit -> products page
    function bindSearch(formId){
      var f = document.getElementById(formId);
      if(!f) return;
      f.addEventListener('submit', function(e){
        e.preventDefault();
        var inp = f.querySelector('input[name=q]');
        var q = (inp && inp.value || '').trim();
        location.href = '/products' + (q ? ('?q=' + encodeURIComponent(q)) : '');
      });
    }
    bindSearch('nc-search-form');
    bindSearch('nc-search-form-m');
  });
</script>
<script src="/static/js/site.js?v=${ASSET_V}" defer></script>
</body>
</html>`;
}

function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
