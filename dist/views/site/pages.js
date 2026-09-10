import db from '../../db/index.js';
import { siteLayout } from '../shared/layout.js';
import { getAllSettings, formatPrice } from '../../utils/helpers.js';
import { getBlocks, getPage } from '../../api/content.js';
import { getChannels, primaryChannel } from '../../utils/contact.js';
import { ncImg, imgPreload, bestUrl } from '../../utils/img.js';
// F2f — `sizes` presets: tell the browser the real rendered width so it
// never downloads a 1600px file for a 160px card.
const SZ_PROD = '(max-width:520px) 150px, (max-width:980px) 200px, 240px';
const SZ_HERO = '(max-width:980px) 100vw, 66vw';
const SZ_PDP  = '(max-width:700px) 92vw, 308px';

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Safely serialize a value for embedding inside an inline <script> block.
// JSON.stringify alone does NOT escape "</script>" or the line/paragraph
// separators, which lets attacker-controlled strings (e.g. a product name)
// break out of the script context (stored XSS). Escape those sequences.
function safeJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}
// Lightweight HTML sanitizer for admin-authored rich content (blog posts).
// Strips dangerous tags (script/style/iframe/...), inline event handlers
// (onerror=, onload=, ...) and javascript:/data: URLs while keeping common
// formatting tags. Defense-in-depth against stored XSS in rich-text fields.
function sanitizeHtml(s) {
    if (s == null) return '';
    let html = String(s);
    // Apply the removal passes repeatedly until the string stops changing so that
    // "nested" reconstruction tricks (e.g. <scr<script>ipt>) and residue left by
    // one pass are caught on the next. Bounded to avoid pathological loops.
    for (let i = 0; i < 5; i++) {
        const before = html;
        // remove dangerous elements entirely (with their content)
        html = html.replace(/<\s*(script|style|iframe|object|embed|form|link|meta|base|svg|math)[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
        // remove self-closing / unclosed dangerous tags
        html = html.replace(/<\s*(script|style|iframe|object|embed|form|link|meta|base|svg|math)\b[^>]*>/gi, '');
        // strip inline event handlers. The separator before "on" may be whitespace
        // OR a slash — browsers treat <img/src=x/onerror=..> like whitespace-separated
        // attributes, so requiring \s alone let /onerror= slip through (stored XSS).
        html = html.replace(/[\s/]on[a-z]+\s*=\s*"[^"]*"/gi, ' ');
        html = html.replace(/[\s/]on[a-z]+\s*=\s*'[^']*'/gi, ' ');
        html = html.replace(/[\s/]on[a-z]+\s*=\s*[^\s>]+/gi, ' ');
        // neutralize javascript:/vbscript:/data: in href/src (optionally slash-separated)
        html = html.replace(/((?:href|src)\s*=\s*)(["']?)\s*(?:javascript|vbscript|data)\s*:[^"'>\s]*/gi, '$1$2#');
        if (html === before)
            break;
    }
    return html;
}
// Strip ALL html tags from admin-authored text (for contexts where raw tags
// were being shown literally, e.g. about/terms/privacy bodies pasted with <p>/<h3>).
function stripTags(s) {
    if (s == null) return '';
    return String(s)
        .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<li[^>]*>/gi, '\u2022 ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
// Render admin-authored body text safely:
// - if it contains HTML tags -> sanitize (keep basic formatting like <p>, <strong>)
// - otherwise -> escape and preserve line breaks
function richText(s) {
    if (s == null) return '';
    const str = String(s);
    if (/<[a-z][\s\S]*>/i.test(str)) {
        return sanitizeHtml(str);
    }
    return esc(str).replace(/\n/g, '<br>');
}
// ===== Helpers for shared markup =====
function discountPct(p) {
    if (p.discount_price && p.discount_price < p.price && p.price > 0) {
        return Math.round((1 - p.discount_price / p.price) * 100);
    }
    return 0;
}

// Standard light product card (used in grids / scrollers).
// opts.variant: 'default' | 'offer' (with progress bar) | 'weekly' (with stock pill)
function productCard(p, opts = {}) {
    const variant = opts.variant || 'default';
    const price = p.discount_price || p.price;
    const hasDiscount = p.discount_price && p.discount_price < p.price;
    const pct = discountPct(p);
    const sold = Number(p.views || 0);
    const stock = Number(p.stock || 0);
    const totalPool = sold + stock || 1;
    const soldRatio = Math.min(100, Math.round((sold / totalPool) * 100));

    const badge = pct > 0
        ? `<span class="nc-prod-badge">${formatPrice(pct)}٪${variant === 'offer' ? ' <i class="fas fa-bolt"></i>' : ''}</span>`
        : '';

    let foot = '';
    if (variant === 'weekly') {
        foot = `
      <div class="nc-prod-foot">
        <div class="nc-prod-price">
          ${hasDiscount ? `<span class="nc-prod-old">${formatPrice(p.price)}</span>` : ''}
          <span class="nc-prod-new">${formatPrice(price)} <small>تومان</small></span>
        </div>
        <button class="nc-prod-cart" onclick="addToCartQuick(&#39;${esc(p.slug)}&#39;, event)" aria-label="افزودن به سبد"><i class="fas fa-cart-shopping"></i></button>
      </div>
      <div class="nc-prod-stock ${stock > 0 ? '' : 'out'}">${stock > 0 ? 'موجود' : 'ناموجود'}</div>`;
    } else if (variant === 'offer') {
        foot = `
      <div class="nc-prod-foot">
        <div class="nc-prod-price">
          ${hasDiscount ? `<span class="nc-prod-old">${formatPrice(p.price)}</span>` : ''}
          <span class="nc-prod-new">${formatPrice(price)} <small>تومان</small></span>
        </div>
        <button class="nc-prod-cart" onclick="addToCartQuick(&#39;${esc(p.slug)}&#39;, event)" aria-label="افزودن به سبد"><i class="fas fa-cart-shopping"></i></button>
      </div>
      <div class="nc-prod-progress"><span style="width:${soldRatio}%"></span></div>
      <div class="nc-prod-sold">${formatPrice(sold)} فروخته شده از ${formatPrice(totalPool)}</div>`;
    } else {
        foot = `
      <div class="nc-prod-foot">
        <div class="nc-prod-price">
          ${hasDiscount ? `<span class="nc-prod-old">${formatPrice(p.price)}</span>` : ''}
          <span class="nc-prod-new">${formatPrice(price)} <small>تومان</small></span>
        </div>
        <button class="nc-prod-cart" onclick="addToCartQuick(&#39;${esc(p.slug)}&#39;, event)" aria-label="افزودن به سبد"><i class="fas fa-cart-shopping"></i></button>
      </div>
      <div class="nc-prod-stock ${stock > 0 ? '' : 'out'}">${stock > 0 ? 'موجود' : 'ناموجود'}</div>`;
    }

    return `
  <div class="nc-prod">
    ${badge}
    <a href="/product/${esc(p.slug)}" class="nc-prod-img">
      ${ncImg(p.image || '/static/images/p1.svg', { alt: p.name, sizes: SZ_PROD, ratio: false })}
    </a>
    <div class="nc-prod-body">
      ${p.brand_name ? `<div class="nc-prod-brand">${esc(p.brand_name)}</div>` : '<div class="nc-prod-brand">&nbsp;</div>'}
      <a href="/product/${esc(p.slug)}" class="nc-prod-name line-clamp-2">${esc(p.name)}</a>
      ${foot}
    </div>
  </div>`;
}
// ===== Home =====
export function homePage() {
    const sel = `SELECT p.*, c.name AS category_name, c.slug AS category_slug, b.name AS brand_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN brands b ON p.brand_id = b.id
    WHERE p.status = 'active'`;
    const offers = db.prepare(`${sel} AND p.featured = 1 ORDER BY p.id LIMIT 8`).all();
    const weekly = db.prepare(`${sel} AND p.featured = 0 ORDER BY p.views DESC LIMIT 8`).all();
    const bestSellers = db.prepare(`${sel} ORDER BY p.views DESC LIMIT 10`).all();
    const discounted = db.prepare(`${sel} AND p.discount_price > 0 AND p.discount_price < p.price ORDER BY (1.0 - p.discount_price * 1.0 / p.price) DESC LIMIT 8`).all();
    const newest = db.prepare(`${sel} ORDER BY p.created_at DESC, p.id DESC LIMIT 8`).all();
    const cats = db.prepare(`SELECT * FROM categories WHERE (parent_id IS NULL OR parent_id = 0) AND COALESCE(show_in_menu, 1) = 1 ORDER BY sort_order, name LIMIT 9`).all();
    const brands = db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM products WHERE brand_id = b.id AND status = 'active') AS pc FROM brands b ORDER BY pc DESC, name LIMIT 12`).all();
    const posts = db.prepare(`SELECT id, title, slug, excerpt, cover_image, category, created_at FROM posts WHERE status = 'published' ORDER BY created_at DESC LIMIT 3`).all();

    // Hero slides are editable from the admin dashboard (site_blocks page='home' section='hero').
    // description = subtitle line, href = link, title from .cta? we map: title->title, description->sub, href->href, image->img.
    const heroBlocks = getBlocks('home', 'hero');
    const defaultSlides = [
        { img: '/static/images/hero-1-datacenter.jpg', title: 'تجهیزات شبکه لگراند', sub: 'اورجینال با گارانتی اصالت کالا', cta: 'مشاهده محصولات', href: '/products' },
        { img: '/static/images/hero-3-rack.jpg', title: 'رک و متعلقات آماد سیستم', sub: 'رک ایستاده و دیواری با بهترین قیمت', cta: 'خرید رک', href: '/products?category=amad-racks' },
        { img: '/static/images/hero-2-cabling.jpg', title: 'سوییچ و روتر شبکه', sub: 'برندهای معتبر، ارسال سریع', cta: 'مشاهده', href: '/products?category=switches' },
    ];
    const slides = (heroBlocks && heroBlocks.length)
        ? heroBlocks.map((b, i) => ({
            img: b.image || defaultSlides[i % defaultSlides.length].img,
            title: b.title || '',
            sub: b.description || '',
            cta: b.icon || 'مشاهده',   // 'icon' field reused as CTA label for hero blocks
            href: b.href || '/products',
        }))
        : defaultSlides;

    // Side banners (next to hero) — editable from admin (site_blocks page='home' section='side_banner').
    // mapping: title->main label, description->small label, icon->FontAwesome class, href->link, image->bg image (optional)
    const sideBlocks = getBlocks('home', 'side_banner');
    const defaultSideBanners = [
        { title: 'کابل و پسیو', sub: 'Cat6 تمام مس', icon: 'fa-ethernet', href: '/products?category=passive', img: '/static/images/banner-side-1-cable.jpg', alt: false },
        { title: 'باکس CamBox', sub: 'تا ۳۵٪ تخفیف', icon: 'fa-box', href: '/products?category=ebox', img: '/static/images/banner-side-2-ebox.jpg', alt: true },
    ];
    const sideBanners = (sideBlocks && sideBlocks.length)
        ? sideBlocks.map((b, i) => ({
            title: b.title || '',
            sub: b.description || '',
            icon: b.icon || 'fa-bolt',
            href: b.href || '/products',
            img: b.image || (defaultSideBanners[i % defaultSideBanners.length] || {}).img || '',
            alt: i % 2 === 1,
        }))
        : defaultSideBanners;

    // Mid banners — editable from admin (site_blocks page='home' section='mid_banner').
    const midBlocks = getBlocks('home', 'mid_banner');
    const defaultMidBanners = [
        { title: 'رک ایستاده', sub: 'مناسب دیتاسنتر', cta: 'خرید', href: '/products?category=standing-racks', img: '/static/images/banner-mid-1-rack.jpg', b: false },
        { title: 'مودم و روتر', sub: '4G LTE و بی‌سیم', cta: 'خرید', href: '/products?category=routers', img: '/static/images/banner-mid-2-router.jpg', b: true },
    ];
    const midBanners = (midBlocks && midBlocks.length)
        ? midBlocks.map((b, i) => ({
            title: b.title || '',
            sub: b.description || '',
            cta: b.icon || 'خرید',
            href: b.href || '/products',
            img: b.image || (defaultMidBanners[i % defaultMidBanners.length] || {}).img || '',
            b: i % 2 === 1,
        }))
        : defaultMidBanners;

    const articleIcons = { 'فیبر نوری': 'fa-circle-nodes', 'وایرلس': 'fa-wifi', 'امنیت شبکه': 'fa-shield-halved' };
    const faDate = (d) => { try { return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(d)); } catch (e) { return ''; } };

    const content = `
    <!-- Hero slider + side banners -->
    <section class="nc-container">
      <div class="nc-hero-grid">
        <div class="nc-slider" id="nc-slider">
          ${slides.map((s, i) => `
            <div class="nc-slide${i === 0 ? ' active' : ''}">
              ${ncImg(s.img, { cls: 'nc-slide-bg', alt: s.title || '', sizes: SZ_HERO, lcp: i === 0, loading: i === 0 ? 'eager' : 'lazy', ratio: false })}
              <div class="nc-slide-overlay"></div>
              <div class="nc-slide-content">
                <h2>${esc(s.title)}</h2>
                <p>${esc(s.sub)}</p>
                <a href="${esc(s.href)}" class="nc-slide-btn">${esc(s.cta)} <i class="fas fa-arrow-left"></i></a>
              </div>
            </div>
          `).join('')}
          <button class="nc-slider-arrow prev" id="nc-slider-prev" aria-label="قبلی"><i class="fas fa-chevron-right"></i></button>
          <button class="nc-slider-arrow next" id="nc-slider-next" aria-label="بعدی"><i class="fas fa-chevron-left"></i></button>
          <div class="nc-slider-dots" id="nc-slider-dots">
            ${slides.map((_, i) => `<span class="nc-dot${i === 0 ? ' active' : ''}" data-i="${i}"></span>`).join('')}
          </div>
        </div>
        <div class="nc-side-banners">
          ${sideBanners.map(s => `
          <a href="${esc(s.href)}" class="nc-side-banner${s.alt ? ' alt' : ''}${s.img ? ' has-img' : ''}"${s.img ? ` style="background-image:linear-gradient(135deg,rgba(29,110,245,.78),rgba(44,26,138,.82)),url('${esc(bestUrl(s.img, 640))}')"` : ''}>
            <div class="nc-side-banner-text"><span>${esc(s.title)}</span><small>${esc(s.sub)}</small></div>
            <i class="fas ${esc(s.icon)}"></i>
          </a>
          `).join('')}
        </div>
      </div>
    </section>

    <!-- Features strip -->
    <section class="nc-container">
      <div class="nc-features">
        ${[
            { icon: 'fa-truck-fast', title: 'ارسال سریع', desc: 'به سراسر کشور' },
            { icon: 'fa-shield-halved', title: 'گارانتی اصالت', desc: 'تضمین کالای اصل' },
            { icon: 'fa-headset', title: 'پشتیبانی', desc: 'مشاوره تخصصی' },
            { icon: 'fa-credit-card', title: 'پرداخت امن', desc: 'درگاه معتبر' },
        ].map(f => `
          <div class="nc-feature">
            <i class="fas ${f.icon}"></i>
            <div><strong>${f.title}</strong><span>${f.desc}</span></div>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- Categories -->
    <section class="nc-container">
      <div class="nc-section-head">
        <h2><i class="fas fa-grip ml-2"></i>دسته‌بندی محصولات</h2>
        <a href="/categories" class="nc-more">مشاهده همه <i class="fas fa-arrow-left"></i></a>
      </div>
      <div class="nc-cat-grid">
        ${cats.map(c => `
          <a href="/products?category=${esc(c.slug)}" class="nc-cat-card">
            <span class="nc-cat-ico">${c.image
                ? ncImg(c.image, { alt: c.name, cls: 'nc-cat-img', sizes: '54px', ratio: false })
                : `<i class="fas ${esc(c.icon || 'fa-network-wired')}"></i>`}</span>
            <span class="nc-cat-name">${esc(c.name)}</span>
          </a>
        `).join('')}
      </div>
    </section>

    <!-- Special offers (red, compact) with corner timer -->
    <section class="nc-container">
      <div class="nc-offers compact">
        <div class="nc-offers-side">
          <div class="nc-offers-title-v"><i class="fas fa-bolt"></i><strong>پیشنهاد<br>شگفت‌انگیز</strong><span>تخفیف‌های ویژه روز</span></div>
          <div class="nc-timer-v" id="nc-timer">
            <div class="nc-timer-box"><b id="t-h">۰۰</b><small>ساعت</small></div>
            <div class="nc-timer-box"><b id="t-m">۰۰</b><small>دقیقه</small></div>
            <div class="nc-timer-box"><b id="t-s">۰۰</b><small>ثانیه</small></div>
          </div>
          <a href="/products" class="nc-offers-more-v">مشاهده همه <i class="fas fa-arrow-left"></i></a>
        </div>
        <div class="nc-prod-scroller nc-offers-scroll nc-carousel" id="nc-offers-scroll" data-auto="1">
          ${offers.map(p => productCard(p, { variant: 'offer' })).join('')}
        </div>
      </div>
    </section>

    <!-- Best sellers: auto-sliding carousel with full-card snap -->
    <section class="nc-container">
      <div class="nc-section-head">
        <h2><i class="fas fa-star ml-2"></i>پرفروش‌ترین محصولات</h2>
        <div class="nc-carousel-nav">
          <button class="nc-car-btn" data-target="best-carousel" data-dir="1" aria-label="قبلی"><i class="fas fa-chevron-right"></i></button>
          <button class="nc-car-btn" data-target="best-carousel" data-dir="-1" aria-label="بعدی"><i class="fas fa-chevron-left"></i></button>
          <a href="/products?sort=views" class="nc-more">مشاهده همه <i class="fas fa-arrow-left"></i></a>
        </div>
      </div>
      <div class="nc-prod-scroller nc-carousel" id="best-carousel" data-auto="1">
        ${bestSellers.map(p => productCard(p)).join('')}
      </div>
    </section>

    <!-- Mid banners -->
    <section class="nc-container">
      <div class="nc-midbanners">
        ${midBanners.map(m => `
        <a href="${esc(m.href)}" class="nc-midbanner${m.b ? ' b' : ''}${m.img ? ' has-img' : ''}"${m.img ? ` style="background-image:linear-gradient(120deg,rgba(58,42,158,.78),rgba(29,110,245,.80)),url('${esc(bestUrl(m.img, 960))}')"` : ''}>
          <div class="nc-midbanner-text"><span>${esc(m.title)}</span><small>${esc(m.sub)}</small><em>${esc(m.cta)}</em></div>
        </a>
        `).join('')}
      </div>
    </section>

    <!-- Weekly picks -->
    <section class="nc-container">
      <div class="nc-section-head">
        <h2><i class="fas fa-medal ml-2"></i>بهترین انتخاب هفته</h2>
        <div class="nc-carousel-nav">
          <button class="nc-car-btn" data-target="weekly-carousel" data-dir="1" aria-label="قبلی"><i class="fas fa-chevron-right"></i></button>
          <button class="nc-car-btn" data-target="weekly-carousel" data-dir="-1" aria-label="بعدی"><i class="fas fa-chevron-left"></i></button>
          <a href="/products" class="nc-more">مشاهده همه <i class="fas fa-arrow-left"></i></a>
        </div>
      </div>
      <div class="nc-prod-scroller nc-carousel" id="weekly-carousel" data-auto="1">
        ${weekly.map(p => productCard(p, { variant: 'weekly' })).join('')}
      </div>
    </section>

    <!-- Pre-invoice CTA strip -->
    <section class="nc-container">
      <div class="nc-invoice-cta">
        <div class="nc-invoice-txt">
          <i class="fas fa-file-invoice"></i>
          <div><strong>نیاز به پیش‌فاکتور رسمی دارید؟</strong><span>محصولات را به سبد اضافه کنید و در یک کلیک پیش‌فاکتور بگیرید</span></div>
        </div>
        <a href="/cart" class="nc-invoice-btn">صدور پیش‌فاکتور <i class="fas fa-arrow-left"></i></a>
      </div>
    </section>

    <!-- Most discount -->
    <section class="nc-container">
      <div class="nc-section-head">
        <h2><i class="fas fa-tags ml-2"></i>بیشترین تخفیف</h2>
        <div class="nc-carousel-nav">
          <button class="nc-car-btn" data-target="disc-carousel" data-dir="1" aria-label="قبلی"><i class="fas fa-chevron-right"></i></button>
          <button class="nc-car-btn" data-target="disc-carousel" data-dir="-1" aria-label="بعدی"><i class="fas fa-chevron-left"></i></button>
          <a href="/products?sort=discount" class="nc-more">مشاهده همه <i class="fas fa-arrow-left"></i></a>
        </div>
      </div>
      <div class="nc-prod-scroller nc-carousel" id="disc-carousel" data-auto="1">
        ${discounted.map(p => productCard(p, { variant: 'weekly' })).join('')}
      </div>
    </section>

    <!-- Newest products -->
    <section class="nc-container">
      <div class="nc-section-head">
        <h2><i class="fas fa-wand-magic-sparkles ml-2"></i>جدیدترین محصولات</h2>
        <div class="nc-carousel-nav">
          <button class="nc-car-btn" data-target="new-carousel" data-dir="1" aria-label="قبلی"><i class="fas fa-chevron-right"></i></button>
          <button class="nc-car-btn" data-target="new-carousel" data-dir="-1" aria-label="بعدی"><i class="fas fa-chevron-left"></i></button>
          <a href="/products?sort=newest" class="nc-more">مشاهده همه <i class="fas fa-arrow-left"></i></a>
        </div>
      </div>
      <div class="nc-prod-scroller nc-carousel" id="new-carousel">
        ${newest.map(p => productCard(p)).join('')}
      </div>
    </section>

    <!-- Articles -->
    <section class="nc-container">
      <div class="nc-section-head">
        <h2><i class="fas fa-newspaper ml-2"></i>آخرین مقالات</h2>
        <a href="/blog" class="nc-more">همه مقالات <i class="fas fa-arrow-left"></i></a>
      </div>

      <div class="nc-articles">
        ${posts.map(p => `
          <a href="/blog/${esc(p.slug)}" class="nc-article">
            <div class="nc-article-img" style="background-image:url('${esc(p.cover_image || '/static/images/blog1.svg')}')">
              <span class="nc-article-cat"><i class="fas ${articleIcons[p.category] || 'fa-newspaper'}"></i> ${esc(p.category || 'مقاله')}</span>
            </div>
            <div class="nc-article-body">
              <h3 class="line-clamp-2">${esc(p.title)}</h3>
              <p class="line-clamp-2">${esc(p.excerpt || '')}</p>
              <div class="nc-article-meta"><i class="far fa-calendar"></i> ${faDate(p.created_at)}</div>
            </div>
          </a>
        `).join('')}
      </div>
    </section>

    <!-- Popular brands (end of page) -->
    <section class="nc-container">
      <div class="nc-section-head">
        <h2><i class="fas fa-award ml-2"></i>برندهای محبوب ما</h2>
      </div>
      <div class="nc-brands-marquee">
        <div class="nc-brands-track">
          ${[...brands, ...brands].map(b => `
          <a href="/products?brand=${esc(b.slug)}" class="nc-brand-card" title="${esc(b.name)}">
            ${b.logo ? ncImg(b.logo, { alt: b.name, sizes: '178px', ratio: false }) : `<span class="nc-brand-name">${esc(b.name)}</span>`}
          </a>`).join('')}
        </div>
      </div>
    </section>

    <script>
      // Hero slider
      (function () {
        var slider = document.getElementById('nc-slider');
        if (!slider) return;
        var slides = slider.querySelectorAll('.nc-slide');
        var dots = slider.querySelectorAll('.nc-dot');
        var idx = 0, timer = null;
        function go(n) {
          idx = (n + slides.length) % slides.length;
          slides.forEach(function (s, i) { s.classList.toggle('active', i === idx); });
          dots.forEach(function (d, i) { d.classList.toggle('active', i === idx); });
        }
        function next() { go(idx + 1); }
        function prev() { go(idx - 1); }
        function start() { stop(); timer = setInterval(next, 5000); }
        function stop() { if (timer) clearInterval(timer); }
        var nx = document.getElementById('nc-slider-next');
        var pv = document.getElementById('nc-slider-prev');
        if (nx) nx.addEventListener('click', function () { next(); start(); });
        if (pv) pv.addEventListener('click', function () { prev(); start(); });
        dots.forEach(function (d) { d.addEventListener('click', function () { go(parseInt(d.dataset.i, 10)); start(); }); });
        slider.addEventListener('mouseenter', stop);
        slider.addEventListener('mouseleave', start);
        start();
      })();

      // Countdown timer (resets every 6h window)
      (function () {
        var elH = document.getElementById('t-h'), elM = document.getElementById('t-m'), elS = document.getElementById('t-s');
        if (!elH) return;
        function fa(n) { return new Intl.NumberFormat('fa-IR', { minimumIntegerDigits: 2, useGrouping: false }).format(n); }
        function tick() {
          var now = new Date();
          var end = new Date(now); end.setHours(23, 59, 59, 0);
          var diff = Math.max(0, Math.floor((end - now) / 1000));
          var h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), s = diff % 60;
          elH.textContent = fa(h); elM.textContent = fa(m); elS.textContent = fa(s);
        }
        tick(); setInterval(tick, 1000);
      })();

      // Product carousels: arrow buttons + auto-slide (full-card steps, RTL-aware)
      // FIX (video report): the old version fought with scroll-snap "mandatory" and
      // mis-read scrollLeft in RTL (browsers disagree: negative vs positive-descending),
      // causing the rails to jump back and forth erratically. Now we normalize the RTL
      // scroll position, move with exact scrollTo targets, and pause on any user scroll.
      (function () {
        function cardStep(el) {
          var card = el.querySelector('.nc-prod');
          if (!card) return 230;
          var gap = parseFloat(getComputedStyle(el).columnGap || getComputedStyle(el).gap || '14') || 14;
          return card.offsetWidth + gap;
        }
        // Normalized "distance scrolled from the start" that works in every RTL mode
        function rtlPos(el) { return Math.abs(el.scrollLeft); }
        // Convert a normalized position back to a real scrollLeft for this browser
        function toScrollLeft(el, pos) { return el.scrollLeft <= 0 ? -pos : pos; }
        function maxScroll(el) { return Math.max(0, el.scrollWidth - el.clientWidth); }
        function goTo(el, pos) {
          pos = Math.max(0, Math.min(pos, maxScroll(el)));
          el.scrollTo({ left: pos === 0 ? 0 : toScrollLeft(el, pos), behavior: 'smooth' });
        }
        function advance(el, dir) {
          // dir=-1 => next (content advances), dir=1 => previous
          var step = cardStep(el);
          var cur = rtlPos(el);
          // Round current position to the card grid so we always land flush on a card
          var idx = Math.round(cur / step);
          goTo(el, (idx + (dir === -1 ? 1 : -1)) * step);
        }
        function pause(el, ms) {
          el.dataset.paused = '1';
          clearTimeout(el._pt);
          if (ms) el._pt = setTimeout(function () { delete el.dataset.paused; }, ms);
        }
        document.querySelectorAll('.nc-car-btn').forEach(function (b) {
          b.addEventListener('click', function () {
            var el = document.getElementById(b.dataset.target);
            if (el) { advance(el, parseInt(b.dataset.dir, 10)); pause(el, 8000); }
          });
        });
        document.querySelectorAll('.nc-carousel[data-auto]').forEach(function (el) {
          el.addEventListener('mouseenter', function () { pause(el); });
          el.addEventListener('mouseleave', function () { pause(el, 1500); });
          el.addEventListener('touchstart', function () { pause(el, 10000); }, { passive: true });
          el.addEventListener('wheel', function () { pause(el, 8000); }, { passive: true });
          var lastAuto = 0;
          el.addEventListener('scroll', function () {
            // A scroll we didn't trigger = the user dragging -> back off
            if (Date.now() - lastAuto > 1200) pause(el, 8000);
          }, { passive: true });
          setInterval(function () {
            if (el.dataset.paused || document.hidden) return;
            var max = maxScroll(el);
            if (max <= 4) return;
            lastAuto = Date.now();
            if (rtlPos(el) >= max - 8) goTo(el, 0);
            else advance(el, -1);
          }, 7500); // slower auto-slide per customer request (voice: "با سرعت خیلی کم")
        });
      })();

      /* addToCartQuick() now lives in /static/js/site.js (single source of truth,
         F7: it must unwrap { product, related } from /api/products/:slug). */
    </script>
  `;
    return siteLayout({
        title: 'صفحه اصلی', currentPath: '/',
        // F2f: start the LCP download during HTML parsing, not after CSS/JS.
        extraHead: slides.length ? imgPreload(slides[0].img, SZ_HERO) : ''
    }, content);
}
// ===== Products List =====
export function productsPage(query) {
    // V4: hierarchical dropdown — roots first, then their children indented,
    // so the filter mirrors the mega-menu structure instead of a flat list.
    const catsRaw = db.prepare(`SELECT * FROM categories ORDER BY sort_order, name`).all();
    const cats = (() => {
        const roots = catsRaw.filter(c => !c.parent_id);
        const kids = pid => catsRaw.filter(c => c.parent_id === pid);
        const out = [];
        for (const r of roots) {
            out.push(r);
            for (const k of kids(r.id)) out.push({ ...k, name: '\u2014 ' + k.name });
        }
        return out;
    })();
    const brands = db.prepare(`SELECT * FROM brands ORDER BY name`).all();
    // Category-specific SEO meta when filtering by a category
    let seoCat = null;
    if (query.category) {
        try {
            seoCat = db.prepare(`SELECT name, seo_title, seo_description, seo_keywords, image FROM categories WHERE slug = ?`).get(query.category) || null;
        }
        catch (e) { seoCat = null; }
    }
    // SSR first page of results so users see products instantly (no client fetch wait).
    // The client script re-fetches only when filters change.
    let ssrItems = [];
    try {
        const conds = [`p.status = 'active'`];
        const params = [];
        if (query.q) {
            // همانند API: جستجو در نام + توضیحات + SKU با escape کاراکترهای LIKE
            const qEsc = String(query.q).replace(/[\\%_]/g, (ch) => '\\' + ch);
            conds.push(`(p.name LIKE ? ESCAPE '\\\\' OR p.description LIKE ? ESCAPE '\\\\' OR p.sku LIKE ? ESCAPE '\\\\')`);
            params.push(`%${qEsc}%`, `%${qEsc}%`, `%${qEsc}%`);
        }
        if (query.category) {
            const cat = db.prepare(`SELECT id FROM categories WHERE slug = ?`).get(query.category);
            if (cat) {
                // include nested sub-categories
                const ids = [cat.id];
                let frontier = [cat.id];
                while (frontier.length) {
                    const kids = db.prepare(`SELECT id FROM categories WHERE parent_id IN (${frontier.map(() => '?').join(',')})`).all(...frontier).map(r => r.id);
                    frontier = kids.filter(k => !ids.includes(k));
                    ids.push(...frontier);
                }
                conds.push(`p.category_id IN (${ids.map(() => '?').join(',')})`);
                params.push(...ids);
            }
        }
        if (query.brand) {
            const br = db.prepare(`SELECT id FROM brands WHERE slug = ?`).get(query.brand);
            if (br) { conds.push(`p.brand_id = ?`); params.push(br.id); }
        }
        // Default order: inside a category the manual drag & drop
        // ordering (sort_order) wins; global list stays newest-first.
        // Mirrors /api/products behavior.
        let order = query.category
            ? `p.sort_order ASC, p.created_at DESC, p.id DESC`
            : `p.created_at DESC, p.id DESC`;
        if (query.sort === 'views' || query.sort === 'popular') order = `p.views DESC`;
        else if (query.sort === 'price_asc') order = `COALESCE(NULLIF(p.discount_price,0), p.price) ASC`;
        else if (query.sort === 'price_desc') order = `COALESCE(NULLIF(p.discount_price,0), p.price) DESC`;
        else if (query.sort === 'discount') order = `(1.0 - COALESCE(NULLIF(p.discount_price,0), p.price) * 1.0 / p.price) DESC`;
        else if (query.sort === 'manual') order = `p.sort_order ASC, p.id ASC`;
        ssrItems = db.prepare(`SELECT p.*, c.name AS category_name, b.name AS brand_name
            FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN brands b ON p.brand_id = b.id
            WHERE ${conds.join(' AND ')} ORDER BY ${order} LIMIT 12`).all(...params);
    } catch (e) { ssrItems = []; }
    const content = `
    <div class="nc-container nc-page">
      <nav class="nc-breadcrumb"><a href="/">خانه</a> <i class="fas fa-angle-left"></i> <span>محصولات</span></nav>
      <h1 class="nc-page-title">محصولات</h1>
      <!-- F4: on phones the sidebar becomes a bottom-sheet opened from here -->
      <div class="nc-shop-toolbar nc-show-mobile">
        <button type="button" id="shop-filter-open" class="nc-shop-filterbtn">
          <i class="fas fa-filter"></i><span>فیلتر و مرتب‌سازی</span>
          <b id="shop-filter-count" class="nc-shop-filterbadge hidden">0</b>
        </button>
        <span class="nc-shop-count" id="shop-count"></span>
      </div>
      <div class="nc-shop-grid">
        <div id="shop-filter-overlay" class="nc-filter-overlay"></div>
        <aside class="nc-filter-card" id="shop-filters">
          <div class="nc-filter-head nc-show-mobile">
            <b>فیلتر و مرتب‌سازی</b>
            <button type="button" id="shop-filter-close" class="nc-icon-btn" aria-label="بستن"><i class="fas fa-times"></i></button>
          </div>
          <div class="nc-filter-group">
            <label>جستجو</label>
            <input id="filter-q" type="text" placeholder="نام محصول..." class="nc-input" value="${esc(query.q || '')}">
          </div>
          <div class="nc-filter-group">
            <label>دسته‌بندی</label>
            <select id="filter-category" class="nc-input">
              <option value="">همه دسته‌ها</option>
              ${cats.map(c => `<option value="${esc(c.slug)}" ${query.category === c.slug ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="nc-filter-group">
            <label>برند</label>
            <select id="filter-brand" class="nc-input">
              <option value="">همه برندها</option>
              ${brands.map(b => `<option value="${esc(b.slug)}" ${query.brand === b.slug ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
            </select>
          </div>
          <div class="nc-filter-group">
            <label>مرتب‌سازی</label>
            <select id="filter-sort" class="nc-input">
              <option value="newest">جدیدترین</option>
              <option value="price_asc">ارزان‌ترین</option>
              <option value="price_desc">گران‌ترین</option>
              <option value="popular">پربازدیدترین</option>
            </select>
          </div>
          <div class="nc-filter-actions">
            <button id="reset-filters" type="button" class="nc-btn-ghost">حذف فیلترها</button>
            <button id="apply-filters" type="button" class="nc-btn-primary">اعمال فیلتر</button>
          </div>
        </aside>
        <div class="nc-shop-main">
          <div id="products-list" class="nc-prod-grid nc-shop-list" data-ssr="1">
            ${ssrItems.length ? ssrItems.map(p => productCard(p)).join('') : '<div class="nc-empty">محصولی یافت نشد</div>'}
          </div>
          <div id="pagination" class="nc-pagination"></div>
        </div>
      </div>
    </div>
    <script>
      var currentPage = 1;
      async function loadProducts(page = 1) {
        currentPage = page;
        const q = document.getElementById('filter-q').value;
        const category = document.getElementById('filter-category').value;
        const brand = document.getElementById('filter-brand').value;
        const sort = document.getElementById('filter-sort').value;
        const list = document.getElementById('products-list');
        list.innerHTML = '<div class="nc-empty"><span class="spinner"></span></div>';
        try {
          const r = await axios.get('/api/products', { params: { q, category, brand, sort, page, limit: 12 } });
          const { items, total, pages } = r.data.data;
          if (!items.length) {
            list.innerHTML = '<div class="nc-empty">محصولی یافت نشد</div>';
            document.getElementById('pagination').innerHTML = '';
            return;
          }
          list.innerHTML = items.map(p => productCardHTML(p)).join('');
          renderPagination(page, pages);
          if (window.__ncSetCount) window.__ncSetCount(total);
        } catch (e) { list.innerHTML = '<div class="nc-empty">خطا در دریافت اطلاعات</div>'; }
      }
      function productCardHTML(p) {
        const price = p.discount_price || p.price;
        const has = p.discount_price && p.discount_price < p.price;
        const pct = has ? Math.round((1 - p.discount_price / p.price) * 100) : 0;
        return \`<div class="nc-prod">
          \${pct > 0 ? '<span class="nc-prod-badge">' + formatPrice(pct) + '٪</span>' : ''}
          <a href="/product/\${ncpEsc(p.slug)}" class="nc-prod-img">
            <img loading="lazy" decoding="async" src="\${ncpEsc(p.image || '/static/images/p1.svg')}" alt="\${ncpEsc(p.name)}">
          </a>
          <div class="nc-prod-body">
            <div class="nc-prod-brand">\${ncpEsc(p.brand_name || '\u00a0')}</div>
            <a href="/product/\${ncpEsc(p.slug)}" class="nc-prod-name line-clamp-2">\${ncpEsc(p.name)}</a>
            <div class="nc-prod-foot">
              <div class="nc-prod-price">
                \${has ? '<span class="nc-prod-old">' + formatPrice(p.price) + '</span>' : ''}
                <span class="nc-prod-new">\${formatPrice(price)} <small>تومان</small></span>
              </div>
              <button class="nc-prod-cart" onclick='addCartFromList(\${ncpEsc(JSON.stringify(p))})' aria-label="افزودن به سبد"><i class="fas fa-cart-shopping"></i></button>
            </div>
            <div class="nc-prod-stock \${p.stock > 0 ? '' : 'out'}">\${p.stock > 0 ? 'موجود' : 'ناموجود'}</div>
          </div>
        </div>\`;
      }
      function renderPagination(current, pages) {
        const c = document.getElementById('pagination');
        if (pages <= 1) { c.innerHTML = ''; return; }
        let html = '';
        for (let i = 1; i <= pages; i++) {
          html += \`<button onclick="loadProducts(\${i})" class="nc-page-btn \${i === current ? 'is-active' : ''}"\${i === current ? ' aria-current="page"' : ''}>\${i}</button>\`;
        }
        c.innerHTML = html;
      }
      window.addCartFromList = (p) => window.NCPCart.add(p, 1);
      /* addToCartQuick() now lives in /static/js/site.js (single source of truth,
         F7: it must unwrap { product, related } from /api/products/:slug). */
      // ---------- F4: mobile filter bottom-sheet ----------
      var sheet    = document.getElementById('shop-filters');
      var sheetOvl = document.getElementById('shop-filter-overlay');
      var isPhone  = () => window.matchMedia('(max-width: 980px)').matches;
      function openSheet()  { sheet.classList.add('is-open');  sheetOvl.classList.add('is-open');  document.body.classList.add('nc-noscroll'); }
      function closeSheet() { sheet.classList.remove('is-open'); sheetOvl.classList.remove('is-open'); document.body.classList.remove('nc-noscroll'); }
      document.getElementById('shop-filter-open').addEventListener('click', openSheet);
      document.getElementById('shop-filter-close').addEventListener('click', closeSheet);
      sheetOvl.addEventListener('click', closeSheet);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

      function activeFilterCount() {
        return ['filter-q', 'filter-category', 'filter-brand'].filter(id => (document.getElementById(id).value || '').trim()).length
             + (document.getElementById('filter-sort').value !== 'newest' ? 1 : 0);
      }
      // site.js is deferred, so formatPrice() may not exist yet when this
      // inline script runs — fall back to the raw number until it does.
      var fp = (n) => (window.formatPrice ? window.formatPrice(n) : String(n));
      function refreshFilterBadge() {
        const n = activeFilterCount();
        const b = document.getElementById('shop-filter-count');
        b.textContent = fp(n);
        b.classList.toggle('hidden', n === 0);
      }
      function setCount(total) {
        const el = document.getElementById('shop-count');
        if (el) el.textContent = total ? fp(total) + ' کالا' : '';
      }
      window.__ncSetCount = setCount;

      document.getElementById('apply-filters').addEventListener('click', () => { closeSheet(); loadProducts(1); });
      document.getElementById('reset-filters').addEventListener('click', () => {
        document.getElementById('filter-q').value = '';
        document.getElementById('filter-category').value = '';
        document.getElementById('filter-brand').value = '';
        document.getElementById('filter-sort').value = 'newest';
        refreshFilterBadge(); closeSheet(); loadProducts(1);
      });
      // On desktop a <select> change applies instantly; on phones the user
      // keeps tuning inside the sheet and confirms with «اعمال فیلتر».
      ['filter-category', 'filter-brand', 'filter-sort'].forEach(id =>
        document.getElementById(id).addEventListener('change', () => { refreshFilterBadge(); if (!isPhone()) loadProducts(1); }));
      document.getElementById('filter-q').addEventListener('input', refreshFilterBadge);
      document.getElementById('filter-q').addEventListener('keypress', (e) => { if (e.key === 'Enter') { closeSheet(); loadProducts(1); } });
      refreshFilterBadge();
      // First page is server-rendered (data-ssr) — only fetch pagination info in
      // the background; full refetch happens when the user changes filters.
      ncpReady(async () => {
        try {
          const q = document.getElementById('filter-q').value;
          const category = document.getElementById('filter-category').value;
          const brand = document.getElementById('filter-brand').value;
          const r = await axios.get('/api/products', { params: { q, category, brand, page: 1, limit: 12 } });
          renderPagination(1, r.data.data.pages);
          if (window.__ncSetCount) window.__ncSetCount(r.data.data.total);
        } catch (e) { /* silent */ }
      });
    </script>
  `;
    return siteLayout({
        title: seoCat ? (seoCat.seo_title || seoCat.name) : 'محصولات',
        description: seoCat ? (seoCat.seo_description || `خرید ${seoCat.name} با گارانتی اصالت و بهترین قیمت`) : '',
        keywords: seoCat ? (seoCat.seo_keywords || '') : '',
        ogImage: seoCat && seoCat.image ? seoCat.image : '',
        currentPath: '/products'
    }, content);
}
// ===== Single Product =====
export function productPage(slug) {
    const p = db.prepare(`SELECT p.*, c.name AS category_name, c.slug AS category_slug, b.name AS brand_name, b.slug AS brand_slug, b.logo AS brand_logo FROM products p LEFT JOIN categories c ON p.category_id = c.id LEFT JOIN brands b ON p.brand_id = b.id WHERE p.slug = ? AND p.status = 'active'`).get(slug);
    if (!p)
        return notFoundPage('محصول');
    db.prepare(`UPDATE products SET views = views + 1 WHERE id = ?`).run(p.id);
    const related = db.prepare(`SELECT p.*, b.name AS brand_name FROM products p LEFT JOIN brands b ON p.brand_id = b.id WHERE p.category_id = ? AND p.id != ? AND p.status = 'active' LIMIT 8`).all(p.category_id, p.id);
    const comments = db.prepare(`SELECT author_name, content, created_at FROM comments WHERE product_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 20`).all?.(p.id) || [];
    const price = p.discount_price || p.price;
    const has = p.discount_price && p.discount_price < p.price;
    const pct = has ? Math.round((1 - p.discount_price / p.price) * 100) : 0;
    const profit = has ? (p.price - p.discount_price) : 0;
    // gallery / specs stored as JSON strings
    let gallery = [];
    let specs = [];
    let keyFeatures = [];
    try { gallery = JSON.parse(p.gallery || '[]') || []; } catch (e) { gallery = []; }
    try { specs = JSON.parse(p.specs || '[]') || []; } catch (e) { specs = []; }
    try { keyFeatures = (JSON.parse(p.key_features || '[]') || []).filter(f => typeof f === 'string' && f.trim()); } catch (e) { keyFeatures = []; }
    // Grouped specs: preserve insertion order of groups; ungrouped rows go under ''
    const specGroups = [];
    specs.forEach(s => {
        const g = (s.group || '').trim();
        let bucket = specGroups.find(x => x.name === g);
        if (!bucket) { bucket = { name: g, rows: [] }; specGroups.push(bucket); }
        bucket.rows.push(s);
    });
    const hasGroups = specGroups.some(g => g.name);
    const allImages = [p.image || '/static/images/p1.svg', ...gallery.filter(g => g && g !== p.image)];
    const settings = getAllSettings();
    // F1: all contact buttons on this page come from the admin-managed
    // channel list (utils/contact.js) — labels, links and visibility included.
    const channels = getChannels(settings);
    const expert = primaryChannel(settings);
    const chatLink = expert ? expert.href : '/contact';
    const chatExternal = expert ? expert.external : false;
    const expertLabel = (settings.chan_expert_label || '').trim() || 'گفتگو با کارشناسان';
    const expertNote = (settings.chan_expert_note || '').trim() || 'استعلام قیمت کالا برای همکاران و کارفرمایان';
    const ctaBtns = channels.map(c => `<a href="${esc(c.href)}"${c.external ? ' target="_blank" rel="noopener"' : ''} class="nc-cta-btn ${c.cls}"><i class="${c.icon}"></i> ${esc(c.display || c.label)}</a>`).join('');
    const expertBtns = channels.map(c => `<a href="${esc(c.href)}"${c.external ? ' target="_blank" rel="noopener"' : ''} class="nc-expert-btn ${c.cls}"><i class="${c.icon}"></i><span>${esc(c.display || c.label)}</span></a>`).join('');
    // V6d: small promo banner under the PDP gallery (editable from admin: site_blocks page='product' section='promo_banner')
    const promoBlocks = getBlocks('product', 'promo_banner');
    const promoBanner = (promoBlocks && promoBlocks.length)
        ? { image: promoBlocks[0].image || '/static/images/banner-mid-2-router.jpg', href: promoBlocks[0].href || '/products', title: promoBlocks[0].title || 'پیشنهاد ویژه' }
        : { image: '/static/images/banner-mid-2-router.jpg', href: '/products?category=routers', title: 'پیشنهاد ویژه' };
    const faDate2 = (d) => { try { return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(d)); } catch (e) { return ''; } };
    const content = `
    <div class="nc-container nc-page">
      <nav class="nc-breadcrumb">
        <a href="/">خانه</a> <i class="fas fa-angle-left"></i>
        <a href="/products">محصولات</a> <i class="fas fa-angle-left"></i>
        ${p.category_name ? `<a href="/products?category=${esc(p.category_slug || '')}">${esc(p.category_name)}</a> <i class="fas fa-angle-left"></i>` : ''}
        <span>${esc(p.name)}</span>
      </nav>

      <div class="nc-pdp3">
        <!-- gallery -->
        <div class="nc-pdp-gallery">
          ${pct > 0 ? `<span class="nc-prod-badge">${formatPrice(pct)}٪</span>` : ''}
          ${p.brand_logo ? `<a href="/products?brand=${esc(p.brand_slug || '')}" class="nc-pdp-brandlogo" title="${esc(p.brand_name || '')}">${ncImg(p.brand_logo, { alt: p.brand_name || '', sizes: '82px', ratio: false })}</a>` : ''}
          ${ncImg(allImages[0], { id: 'pdp-main-img', alt: p.name, sizes: SZ_PDP, lcp: true, ratio: false })}
          ${allImages.length > 1 ? `
          <div class="nc-pdp-thumbs">
            ${allImages.map((g, i) => `<button class="nc-pdp-thumb${i === 0 ? ' active' : ''}" data-src="${esc(g)}" aria-label="تصویر ${i + 1}">${ncImg(g, { alt: '', sizes: '58px', ratio: false })}</button>`).join('')}
          </div>` : ''}
          <a href="${esc(promoBanner.href)}" class="nc-pdp-promobanner" aria-label="${esc(promoBanner.title)}">
            ${ncImg(promoBanner.image, { alt: promoBanner.title, sizes: SZ_PDP, ratio: false })}
          </a>
        </div>

        <!-- info -->
        <div class="nc-pdp-info">
          <div class="nc-pdp-meta">${esc(p.brand_name || '')} ${p.category_name ? '• ' + esc(p.category_name) : ''}</div>
          <h1 class="nc-pdp-title">${esc(p.name)}</h1>
          <div class="nc-pdp-metaline">
            ${p.sku ? `<span class="nc-metaline-item sku"><i class="fas fa-barcode"></i> کد کالا: <b dir="ltr">${esc(p.sku)}</b></span><span class="nc-metaline-sep">|</span>` : ''}
            <span class="nc-metaline-item star"><i class="fas fa-star"></i> (${formatPrice(comments.length)})</span>
            <span class="nc-metaline-sep">|</span>
            <a href="#pdp-tabs" onclick="switchTab('comments')" class="nc-metaline-item link"><i class="far fa-comment"></i> دیدگاه</a>
            <span class="nc-metaline-sep">|</span>
            <a href="#pdp-tabs" onclick="switchTab('qa')" class="nc-metaline-item link"><i class="far fa-circle-question"></i> پرسش</a>
            <span class="nc-metaline-sep">|</span>
            <span class="nc-metaline-item views"><i class="far fa-eye"></i> ${formatPrice(p.views || 0)} بازدید</span>
          </div>
          ${p.brand_name ? `<div class="nc-pdp-inforows"><div class="nc-inforow r-brand"><span class="nc-inforow-l"><i class="fas fa-tag"></i> برند</span><a class="nc-inforow-v link" href="/products?brand=${esc(p.brand_slug || '')}">${esc(p.brand_name)}</a></div></div>` : ''}
          ${keyFeatures.length ? `
          <div class="nc-pdp-keyfeats">
            <strong><i class="fas fa-star"></i> ویژگی‌های کلیدی:</strong>
            <ul>${keyFeatures.map(f => `<li><i class="fas fa-check-circle"></i><span>${esc(f)}</span></li>`).join('')}</ul>
          </div>` : ''}
          <p class="nc-pdp-short">${esc(p.short_description || '')}</p>
          ${specs.length ? `<a href="#pdp-tabs" onclick="switchTab('specs')" class="nc-pdp-morespecs standalone"><i class="fas fa-list-ul ml-1"></i>مشاهده مشخصات فنی کامل <i class="fas fa-angle-down"></i></a>` : ''}
          <div class="nc-pdp-cta">
            <div class="nc-pdp-cta-text">
              <i class="fas fa-headset"></i>
              <div><b>نیاز به مشاوره قبل از خرید دارید؟</b><span>کارشناسان ما آماده پاسخگویی هستند — استعلام قیمت و موجودی</span></div>
            </div>
            <div class="nc-pdp-cta-actions">${ctaBtns}</div>
          </div>
        </div>

        <!-- buy box (side) -->
        <aside class="nc-buybox">
          <div class="nc-buybox-guarantee"><i class="fas fa-shield-halved"></i> ${esc(p.guarantee || 'گارانتی اصالت و سلامت فیزیکی کالا')}</div>
          <div class="nc-buybox-rows">
            ${has ? `
            <div class="nc-buybox-row"><span>قیمت:</span><b class="nc-buybox-old">${formatPrice(p.price)} تومان</b></div>
            <div class="nc-buybox-row profit"><span>سود شما:</span><b>${formatPrice(profit)} تومان (${formatPrice(pct)}٪)</b></div>` : ''}
            <div class="nc-buybox-row final"><span>قیمت نهایی:</span><b>${formatPrice(price)} <small>تومان</small></b></div>
          </div>
          <div class="nc-pdp-stock ${p.stock > 0 ? 'in' : 'out'}">
            <i class="fas ${p.stock > 0 ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
            ${p.stock > 0 ? `${formatPrice(p.stock)} عدد موجود در انبار` : 'ناموجود'}
          </div>
          ${p.stock > 0 ? `
          <div class="nc-buybox-qty">
            <div class="nc-qty">
              <button onclick="changeQty(-1)" aria-label="کاهش"><i class="fas fa-minus"></i></button>
              <input id="qty" type="number" min="1" max="${p.stock}" value="1">
              <button onclick="changeQty(1)" aria-label="افزایش"><i class="fas fa-plus"></i></button>
            </div>
          </div>
          <button onclick="addNow()" class="nc-btn-primary nc-buybox-add"><i class="fas fa-cart-plus ml-2"></i>افزودن به سبد خرید</button>` : '<div class="nc-pdp-unavailable">این محصول در حال حاضر موجود نیست</div>'}
          <a href="${esc(chatLink)}"${chatExternal ? ' target="_blank" rel="noopener"' : ''} class="nc-buybox-chat"><i class="fas fa-headset ml-2"></i>${esc(expertLabel)}</a>
          <a href="/cart" class="nc-buybox-invoice"><i class="fas fa-file-invoice ml-2"></i>دریافت پیش‌فاکتور</a>
          <div class="nc-expert-block">
            <div class="nc-expert-head">
              <span class="nc-expert-avatar"><img src="/static/images/expert.svg" alt="کارشناس فروش"><i class="nc-expert-dot"></i></span>
              <div><b>${esc(expertLabel)}</b><span>${esc(expertNote)}</span></div>
            </div>
            <div class="nc-expert-btns">${expertBtns}</div>
          </div>
          <div class="nc-pdp-trust">
            <span><i class="fas fa-truck-fast"></i> ارسال سریع</span>
            <span><i class="fas fa-rotate-left"></i> ۷ روز ضمانت بازگشت</span>
            <span><i class="fas fa-credit-card"></i> پرداخت امن</span>
          </div>
        </aside>
      </div>

      <!-- tabs -->
      <div class="nc-pdp-tabs" id="pdp-tabs">
        <div class="nc-pdp-tabbar" role="tablist">
          ${specs.length ? '<button class="nc-pdp-tab active" data-tab="specs" role="tab">مشخصات فنی</button>' : ''}
          <button class="nc-pdp-tab${specs.length ? '' : ' active'}" data-tab="review" role="tab">نقد و بررسی</button>
          <button class="nc-pdp-tab" data-tab="comments" role="tab">دیدگاه‌ها (${comments.length})</button>
          <button class="nc-pdp-tab" data-tab="qa" role="tab">پرسش و پاسخ</button>
        </div>
        ${specs.length ? `
        <div class="nc-pdp-panel active" id="tab-specs">
          <table class="nc-specs-table">
            ${hasGroups
        ? specGroups.map(g => `
              ${g.name ? `<tr class="nc-specs-group"><th colspan="2">${esc(g.name)}</th></tr>` : ''}
              ${g.rows.map(s => `<tr><td>${esc(s.key)}</td><td>${esc(s.value)}</td></tr>`).join('')}`).join('')
        : specs.map(s => `<tr><td>${esc(s.key)}</td><td>${esc(s.value)}</td></tr>`).join('')}
          </table>
        </div>` : ''}
        <div class="nc-pdp-panel${specs.length ? '' : ' active'}" id="tab-review">
          <div class="prose-rtl">${p.description ? sanitizeHtml(esc(p.description).replace(/\n/g, '<br>')) : 'توضیحات تکمیلی در دسترس نیست.'}</div>
        </div>
        <div class="nc-pdp-panel" id="tab-comments">
          ${comments.length ? comments.map(cm => `
            <div class="nc-comment">
              <div class="nc-comment-head"><b>${esc(cm.author_name)}</b><span>${faDate2(cm.created_at)}</span></div>
              <p>${esc(cm.content)}</p>
            </div>`).join('') : '<p class="nc-empty-inline">هنوز دیدگاهی ثبت نشده است. اولین نفر باشید!</p>'}
          <div class="nc-comment-form">
            <h3>ثبت دیدگاه</h3>
            <div class="grid md:grid-cols-2 gap-3 mb-3">
              <input id="cm-name" class="nc-input" placeholder="نام شما *">
              <input id="cm-email" class="nc-input" placeholder="ایمیل (اختیاری)">
            </div>
            <textarea id="cm-content" class="nc-input" rows="3" placeholder="دیدگاه شما *"></textarea>
            <button onclick="submitComment()" class="nc-btn-primary mt-3">ارسال دیدگاه</button>
          </div>
        </div>
        <div class="nc-pdp-panel" id="tab-qa">
          <p class="nc-empty-inline">سوالی درباره این محصول دارید؟ از طریق <a href="${esc(chatLink)}" target="_blank" rel="noopener" style="color:var(--nc-primary);font-weight:700">گفتگو با کارشناس‌ها</a> یا فرم <a href="/contact" style="color:var(--nc-primary);font-weight:700">تماس با ما</a> بپرسید — در سریع‌ترین زمان پاسخ می‌دهیم.</p>
        </div>
      </div>

      ${related.length ? `
      <div class="nc-section-head" style="margin-top:28px">
        <h2><i class="fas fa-layer-group ml-2"></i>محصولات مرتبط</h2>
        <div class="nc-carousel-nav">
          <button class="nc-car-btn" data-target="rel-carousel" data-dir="1" aria-label="قبلی"><i class="fas fa-chevron-right"></i></button>
          <button class="nc-car-btn" data-target="rel-carousel" data-dir="-1" aria-label="بعدی"><i class="fas fa-chevron-left"></i></button>
        </div>
      </div>
      <div class="nc-prod-scroller nc-carousel" id="rel-carousel">
        ${related.map(r => productCard(r)).join('')}
      </div>` : ''}
    </div>
    <script>
      var PRODUCT = ${safeJson({ id: p.id, name: p.name, slug: p.slug, image: p.image, price: p.price, discount_price: p.discount_price, stock: p.stock })};
      function changeQty(d) {
        const i = document.getElementById('qty');
        let v = parseInt(i.value) + d;
        if (v < 1) v = 1;
        if (v > PRODUCT.stock) { v = PRODUCT.stock; toast('حداکثر موجودی ' + PRODUCT.stock + ' عدد است', 'warning'); }
        i.value = v;
      }
      function addNow() {
        const q = parseInt(document.getElementById('qty').value) || 1;
        window.NCPCart.add(PRODUCT, q);
      }
      /* addToCartQuick() now lives in /static/js/site.js (single source of truth,
         F7: it must unwrap { product, related } from /api/products/:slug). */
      // gallery thumbs
      document.querySelectorAll('.nc-pdp-thumb').forEach(function (t) {
        t.addEventListener('click', function () {
          var __m = document.getElementById('pdp-main-img');
          __m.removeAttribute('srcset'); __m.removeAttribute('sizes');
          __m.src = t.dataset.src;
          document.querySelectorAll('.nc-pdp-thumb').forEach(function (x) { x.classList.remove('active'); });
          t.classList.add('active');
        });
      });
      // tabs
      window.switchTab = function (name) {
        document.querySelectorAll('.nc-pdp-tab').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
        document.querySelectorAll('.nc-pdp-panel').forEach(function (pl) { pl.classList.toggle('active', pl.id === 'tab-' + name); });
      };
      document.querySelectorAll('.nc-pdp-tab').forEach(function (b) {
        b.addEventListener('click', function () { switchTab(b.dataset.tab); });
      });
      // carousel arrows (related)
      document.querySelectorAll('.nc-car-btn').forEach(function (b) {
        b.addEventListener('click', function () {
          var el = document.getElementById(b.dataset.target);
          if (!el) return;
          var card = el.querySelector('.nc-prod');
          var step = card ? card.offsetWidth + 14 : 230;
          el.scrollBy({ left: parseInt(b.dataset.dir, 10) * step, behavior: 'smooth' });
        });
      });
      // comment submit
      window.submitComment = async function () {
        var name = document.getElementById('cm-name').value.trim();
        var email = document.getElementById('cm-email').value.trim();
        var body = document.getElementById('cm-content').value.trim();
        if (!name || !body) return toast('نام و متن دیدگاه الزامی است', 'warning');
        try {
          await axios.post('/api/products/' + PRODUCT.id + '/comments', { author_name: name, author_email: email, content: body });
          toast('دیدگاه شما ثبت شد و پس از تایید نمایش داده می‌شود', 'success');
          document.getElementById('cm-content').value = '';
        } catch (e) { toast((e.response && e.response.data && e.response.data.message) || 'خطا در ثبت دیدگاه', 'error'); }
      };
    </script>
  `;
    return siteLayout({
        title: p.seo_title || p.name,
        description: p.seo_description || p.short_description || '',
        keywords: p.seo_keywords || '',
        ogImage: p.image || '',
        currentPath: '/product/' + p.slug,
        // SEO: schema.org Product structured data for rich results
        jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: p.name,
            sku: p.sku || undefined,
            image: p.image || undefined,
            description: p.short_description || p.seo_description || undefined,
            brand: p.brand_name ? { '@type': 'Brand', name: p.brand_name } : undefined,
            offers: {
                '@type': 'Offer',
                priceCurrency: 'IRR',
                price: (p.discount_price || p.price) * 10,
                availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            },
        }
    }, content);
}
// ===== Categories Page =====
export function categoriesPage() {
    const cats = db.prepare(`SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id AND status = 'active') AS product_count FROM categories c ORDER BY sort_order, name`).all();
    const content = `
    <div class="nc-container nc-page">
      <nav class="nc-breadcrumb"><a href="/">خانه</a> <i class="fas fa-angle-left"></i> <span>دسته‌بندی‌ها</span></nav>
      <h1 class="nc-page-title">دسته‌بندی محصولات</h1>
      <div class="nc-catpage-grid">
        ${cats.map(c => `
          <a href="/products?category=${esc(c.slug)}" class="nc-catpage-card">
            <span class="nc-catpage-ico"><i class="fas ${esc(c.icon || 'fa-network-wired')}"></i></span>
            <h3>${esc(c.name)}</h3>
            <p>${esc(c.description || '')}</p>
            <span class="nc-catpage-count">${formatPrice(c.product_count)} محصول</span>
          </a>
        `).join('')}
      </div>
    </div>
  `;
    return siteLayout({ title: 'دسته‌بندی‌ها', currentPath: '/categories' }, content);
}
// ===== Blog =====
export function blogListPage() {
    const posts = db.prepare(`SELECT id, title, slug, excerpt, cover_image, category, views, created_at FROM posts WHERE status = 'published' ORDER BY created_at DESC`).all();
    const content = `
    <div class="nc-container nc-page">
      <nav class="nc-breadcrumb"><a href="/">خانه</a> <i class="fas fa-angle-left"></i> <span>مقالات</span></nav>
      <h1 class="nc-page-title">مقالات و راهنماها</h1>
      ${posts.length ? `
      <div class="nc-articles">
        ${posts.map(p => `
          <a href="/blog/${esc(p.slug)}" class="nc-article">
            <div class="nc-article-img" style="background-image:url('${esc(p.cover_image || '/static/images/blog1.svg')}')">
              <span class="nc-article-cat"><i class="fas fa-newspaper"></i> ${esc(p.category || 'مقاله')}</span>
            </div>
            <div class="nc-article-body">
              <h3 class="line-clamp-2">${esc(p.title)}</h3>
              <p class="line-clamp-2">${esc(p.excerpt || '')}</p>
              <div class="nc-article-meta"><i class="far fa-eye"></i> ${formatPrice(p.views || 0)} بازدید</div>
            </div>
          </a>
        `).join('')}
      </div>` : '<div class="nc-empty">هنوز مقاله‌ای منتشر نشده است.</div>'}
    </div>
  `;
    return siteLayout({ title: 'مقالات', currentPath: '/blog' }, content);
}
export function blogPostPage(slug) {
    const post = db.prepare(`SELECT * FROM posts WHERE slug = ? AND status = 'published'`).get(slug);
    if (!post)
        return notFoundPage('مقاله');
    db.prepare(`UPDATE posts SET views = views + 1 WHERE id = ?`).run(post.id);
    const comments = db.prepare(`SELECT id, author_name, content, created_at FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at DESC`).all(post.id);
    const content = `
    <article class="nc-container nc-page nc-blogpost">
      <nav class="nc-breadcrumb">
        <a href="/">خانه</a> <i class="fas fa-angle-left"></i>
        <a href="/blog">مقالات</a> <i class="fas fa-angle-left"></i>
        <span>${esc(post.title)}</span>
      </nav>
      <div class="nc-blogpost-cover" style="background-image:url('${esc(post.cover_image || '/static/images/blog1.svg')}')"></div>
      <span class="nc-blogpost-cat">${esc(post.category || '')}</span>
      <h1 class="nc-blogpost-title">${esc(post.title)}</h1>
      <div class="nc-blogpost-meta">
        <span><i class="far fa-calendar ml-1"></i>${new Date(post.created_at).toLocaleDateString('fa-IR')}</span>
        <span><i class="far fa-eye ml-1"></i>${formatPrice(post.views)} بازدید</span>
      </div>
      <div class="prose-rtl">${sanitizeHtml(post.content)}</div>

      <div class="nc-comments">
        <h2><i class="far fa-comments ml-2"></i>دیدگاه‌ها (${formatPrice(comments.length)})</h2>
        ${comments.length ? comments.map(c => `
          <div class="nc-comment">
            <div class="nc-comment-head">
              <div class="nc-comment-avatar">${esc(c.author_name.charAt(0))}</div>
              <div>
                <div class="nc-comment-name">${esc(c.author_name)}</div>
                <div class="nc-comment-date">${new Date(c.created_at).toLocaleDateString('fa-IR')}</div>
              </div>
            </div>
            <p>${esc(c.content)}</p>
          </div>
        `).join('') : '<p class="nc-muted">هنوز دیدگاهی ثبت نشده است. اولین نفر باشید!</p>'}

        <div class="nc-form-card">
          <h3>ثبت دیدگاه</h3>
          <form id="comment-form">
            <div class="nc-form-row">
              <input name="author_name" required placeholder="نام شما" class="nc-input">
              <input name="author_email" type="email" placeholder="ایمیل (اختیاری)" class="nc-input">
            </div>
            <textarea name="content" required placeholder="دیدگاه شما..." rows="4" class="nc-input"></textarea>
            <button type="submit" class="nc-btn-primary">ثبت دیدگاه</button>
          </form>
        </div>
      </div>
    </article>
    <script>
      document.getElementById('comment-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>';
        try {
          const r = await axios.post('/api/blog/posts/${post.id}/comments', data);
          toast(r.data.message, 'success');
          e.target.reset();
        } catch (err) { toast(err.response?.data?.message || 'خطا در ثبت', 'error'); }
        finally { btn.disabled = false; btn.innerHTML = orig; }
      });
    </script>
  `;
    return siteLayout({ title: post.title, description: post.excerpt || '', currentPath: '/blog' }, content);
}
// ===== Cart =====
export function cartPage() {
    const settings = getAllSettings();
    const content = `
    <div class="nc-container nc-page">
      <nav class="nc-breadcrumb"><a href="/">خانه</a> <i class="fas fa-angle-left"></i> <span>سبد خرید</span></nav>
      <h1 class="nc-page-title">سبد خرید</h1>
      <div id="cart-content"></div>
    </div>
    <script>
      var SHIPPING = ${parseInt(settings.shipping_cost || '500000')};
      function renderCart() {
        const items = window.NCPCart.get();
        const c = document.getElementById('cart-content');
        if (!items.length) {
          c.innerHTML = '<div class="nc-empty-box"><i class="fas fa-cart-shopping"></i><p>سبد خرید شما خالی است</p><a href="/products" class="nc-btn-primary">مشاهده محصولات</a></div>';
          return;
        }
        const subtotal = window.NCPCart.subtotal();
        const total = subtotal + SHIPPING;
        c.innerHTML = \`
          <div class="nc-cart-grid">
            <div class="nc-cart-items">
              \${items.map(it => \`
                <div class="nc-cart-item">
                  <img loading="lazy" decoding="async" src="\${ncpEsc(it.image || '/static/images/p1.svg')}" alt="\${ncpEsc(it.name)}">
                  <div class="nc-cart-item-info">
                    <a href="/product/\${ncpEsc(it.slug)}" class="nc-cart-item-name">\${ncpEsc(it.name)}</a>
                    <div class="nc-cart-item-unit">\${formatPrice(it.price)} تومان</div>
                  </div>
                  <div class="nc-qty sm">
                    <button onclick="updQty(\${it.product_id}, \${it.quantity - 1})" aria-label="کاهش"><i class="fas fa-minus"></i></button>
                    <span>\${formatPrice(it.quantity)}</span>
                    <button onclick="updQty(\${it.product_id}, \${it.quantity + 1})" aria-label="افزایش"><i class="fas fa-plus"></i></button>
                  </div>
                  <div class="nc-cart-item-total">
                    <div class="nc-cart-item-sum">\${formatPrice(it.price * it.quantity)}</div>
                    <button onclick="rem(\${it.product_id})" class="nc-cart-remove"><i class="fas fa-trash"></i> حذف</button>
                  </div>
                </div>
              \`).join('')}
            </div>
            <div class="nc-cart-summary">
              <h3>خلاصه سفارش</h3>
              <div class="nc-sum-row"><span>جمع کل</span><span>\${formatPrice(subtotal)} تومان</span></div>
              <div class="nc-sum-row"><span>هزینه ارسال</span><span>\${formatPrice(SHIPPING)} تومان</span></div>
              <div class="nc-sum-row total"><span>قابل پرداخت</span><span>\${formatPrice(total)} تومان</span></div>
              <a href="/checkout" class="nc-btn-primary w-full">تکمیل خرید <i class="fas fa-arrow-left mr-2"></i></a>
            </div>
          </div>\`;
      }
      window.updQty = (id, q) => { window.NCPCart.update(id, q); renderCart(); };
      window.rem = (id) => { window.NCPCart.remove(id); renderCart(); toast('از سبد حذف شد', 'success'); };
      ncpReady(renderCart);
    </script>
  `;
    return siteLayout({ title: 'سبد خرید', currentPath: '/cart' }, content);
}
// ===== Checkout =====
export function checkoutPage() {
    const settings = getAllSettings();
    const cardNumRaw = String(settings.pay_card_number || '').replace(/[^0-9]/g, '');
    const cardOn = (settings.pay_card_enabled || '') === 'فعال' && cardNumRaw.length >= 12;
    const gwOn = (settings.pay_gateway_enabled || '') === 'فعال';
    const cardGrouped = cardNumRaw.replace(/(\d{4})(?=\d)/g, '$1 ');
    // Payment-method chooser: a real, tappable choice instead of a cramped info box.
    const methods = [];
    if (cardOn) {
        methods.push({
            v: 'card', i: 'fas fa-money-check-dollar', t: 'کارت به کارت',
            d: 'شماره کارت را همین‌جا می‌بینید و پس از ثبت سفارش، رسید واریز را در همان صفحه ثبت می‌کنید.',
            extra: '<div class="nc-paycard" id="paycard-box">'
                + '<div class="nc-paycard-top"><span class="nc-paycard-label">شماره کارت</span>'
                + (settings.pay_card_bank ? '<span class="nc-paycard-bank">بانک ' + esc(settings.pay_card_bank) + '</span>' : '')
                + '</div>'
                + '<div class="nc-paycard-numrow"><b dir="ltr" class="nc-paycard-num" id="paycard-num" data-raw="' + esc(cardNumRaw) + '">' + esc(cardGrouped) + '</b>'
                + '<button type="button" class="nc-copy-btn" data-copy="' + esc(cardNumRaw) + '" aria-label="کپی شماره کارت"><i class="fas fa-copy"></i><span>کپی</span></button></div>'
                + (settings.pay_card_holder ? '<div class="nc-paycard-holder"><i class="fas fa-user"></i>به نام: <b>' + esc(settings.pay_card_holder) + '</b></div>' : '')
                + '</div>'
        });
    }
    if (gwOn) {
        methods.push({
            v: 'gateway', i: 'fas fa-shield-halved', t: 'پرداخت آنلاین' + (settings.pay_gateway_name ? ' — درگاه ' + esc(settings.pay_gateway_name) : ''),
            d: 'پس از تایید سفارش، لینک پرداخت امن برای شما ارسال می‌شود.', extra: ''
        });
    }
    methods.push({
        v: 'cod', i: 'fas fa-handshake', t: 'هماهنگی با کارشناس فروش',
        d: 'کارشناسان ما برای تسویه و روش پرداخت با شما تماس می‌گیرند.', extra: ''
    });
    let payBlock = '<div class="nc-paymethods"><h3><i class="fas fa-credit-card"></i> روش پرداخت</h3>';
    methods.forEach((m, ix) => {
        payBlock += '<label class="nc-paymethod' + (ix === 0 ? ' is-active' : '') + '">'
            + '<input type="radio" name="payment_method" value="' + m.v + '"' + (ix === 0 ? ' checked' : '') + '>'
            + '<span class="nc-paymethod-mark"></span>'
            + '<span class="nc-paymethod-body"><span class="nc-paymethod-title"><i class="' + m.i + '"></i>' + m.t + '</span>'
            + '<span class="nc-paymethod-desc">' + m.d + '</span>'
            + (m.extra ? '<span class="nc-paymethod-extra">' + m.extra + '</span>' : '')
            + '</span></label>';
    });
    if ((settings.pay_gateway_desc || '').trim()) {
        payBlock += '<p class="nc-payinfo-desc"><i class="fas fa-circle-info"></i>' + esc(settings.pay_gateway_desc) + '</p>';
    }
    payBlock += '</div>';
    const content = `
    <div class="nc-container nc-page">
      <nav class="nc-breadcrumb"><a href="/">خانه</a> <i class="fas fa-angle-left"></i> <a href="/cart">سبد خرید</a> <i class="fas fa-angle-left"></i> <span>تکمیل سفارش</span></nav>
      <h1 class="nc-page-title">تکمیل سفارش</h1>
      <div id="checkout-root"></div>
    </div>
    <script>
      var SHIPPING = ${parseInt(settings.shipping_cost || '500000')};
      async function renderCheckout() {
        const root = document.getElementById('checkout-root');
        const items = window.NCPCart.get();
        if (!items.length) {
          root.innerHTML = '<div class="nc-empty-box"><i class="fas fa-cart-shopping"></i><p>سبد خرید شما خالی است</p><a href="/products" class="nc-btn-primary">مشاهده محصولات</a></div>';
          return;
        }
        let user = window.NCPAuth.getUser();
        if (window.NCPAuth.isLoggedIn()) {
          try { const r = await axios.get('/api/auth/me'); user = r.data.data || user; } catch {}
        }
        const subtotal = window.NCPCart.subtotal();
        const total = subtotal + SHIPPING;
        root.innerHTML = \`
          <div class="nc-checkout-grid">
            <form id="checkout-form" class="nc-checkout-form">
              <h3>اطلاعات گیرنده</h3>
              \${!user ? '<div class="nc-notice"><i class="fas fa-circle-info ml-1"></i>برای پیگیری سفارش، <a href="/login">وارد شوید</a> یا <a href="/register">ثبت‌نام کنید</a>.</div>' : ''}
              <div class="nc-form-row">
                <div><label>نام و نام خانوادگی *</label><input name="customer_name" required value="\${user?.full_name || ''}" class="nc-input"></div>
                <div><label>شماره تماس *</label><input name="customer_phone" required value="\${user?.phone || ''}" class="nc-input" data-nc-phone dir="ltr" inputmode="tel" maxlength="11" pattern="0?9[0-9]{9}" data-error-required="شماره تماس را وارد کنید" data-error-pattern="شماره موبایل معتبر نیست (مثال: 09123456789)"></div>
              </div>
              <div><label>ایمیل</label><input name="customer_email" type="email" value="\${user?.email || ''}" class="nc-input"></div>
              <div class="nc-form-row">
                <div><label>شهر *</label><input name="shipping_city" required value="\${user?.city || ''}" class="nc-input"></div>
                <div><label>کد پستی</label><input name="shipping_postal" value="\${user?.postal_code || ''}" class="nc-input"></div>
              </div>
              <div><label>آدرس کامل *</label><textarea name="shipping_address" required rows="3" class="nc-input">\${user?.address || ''}</textarea></div>
              <div><label>یادداشت سفارش</label><textarea name="notes" rows="2" class="nc-input"></textarea></div>
              ${payBlock.replace(/`/g, '')}
              <button type="submit" class="nc-btn-primary w-full"><i class="fas fa-check ml-2"></i>ثبت نهایی سفارش و رفتن به مرحله پرداخت</button>
            </form>
            <div class="nc-cart-summary">
              <h3>سفارش شما (\${formatPrice(items.length)} قلم)</h3>
              <div class="nc-checkout-items">
                \${items.map(it => \`<div class="nc-checkout-line"><span class="line-clamp-1">\${ncpEsc(it.name)} × \${formatPrice(it.quantity)}</span><span>\${formatPrice(it.price * it.quantity)}</span></div>\`).join('')}
              </div>
              <div class="nc-sum-row"><span>جمع کل</span><span>\${formatPrice(subtotal)}</span></div>
              <div class="nc-sum-row"><span>ارسال</span><span>\${formatPrice(SHIPPING)}</span></div>
              <div class="nc-sum-row total"><span>پرداخت</span><span>\${formatPrice(total)}</span></div>
              <div class="nc-sum-secure"><i class="fas fa-lock"></i>اطلاعات شما محفوظ است و فقط برای پردازش سفارش استفاده می‌شود.</div>
            </div>
          </div>\`;
        const cf = document.getElementById('checkout-form');
        cf.addEventListener('submit', submitOrder);
        cf.addEventListener('change', (ev) => {
          if (ev.target && ev.target.name === 'payment_method') {
            cf.querySelectorAll('.nc-paymethod').forEach(l => l.classList.toggle('is-active', l.contains(ev.target)));
          }
        });
        if (window.ncpBindPhoneInputs) window.ncpBindPhoneInputs(cf);
        if (window.ncpBindCopy) window.ncpBindCopy(cf);
      }
      async function submitOrder(e) {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        data.items = window.NCPCart.get().map(i => ({ product_id: i.product_id, quantity: i.quantity }));
        if (data.customer_phone && window.ncpNormalizePhone) data.customer_phone = window.ncpNormalizePhone(data.customer_phone);
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> در حال ثبت...';
        try {
          const r = await axios.post('/api/orders', data);
          if (r.data.success) {
            window.NCPCart.clear();
            toast('سفارش با موفقیت ثبت شد', 'success');
            setTimeout(() => location.href = '/order-success/' + r.data.data.order_number, 600);
          } else { toast(r.data.message || 'خطا', 'error'); btn.disabled = false; btn.innerHTML = orig; }
        } catch (err) {
          toast(err.response?.data?.message || 'خطا در ثبت سفارش', 'error');
          btn.disabled = false; btn.innerHTML = orig;
        }
      }
      ncpReady(renderCheckout);
    </script>
  `;
    return siteLayout({ title: 'تکمیل سفارش', currentPath: '/checkout' }, content);
}
// ===== Order Success =====
export function orderSuccessPage(orderNumber) {
    const settings = getAllSettings();
    const cardNumRaw = String(settings.pay_card_number || '').replace(/[^0-9]/g, '');
    const cardGrouped = cardNumRaw.replace(/(\d{4})(?=\d)/g, '$1 ');
    const payCfg = {
        cardEnabled: (settings.pay_card_enabled || '') === 'فعال' && cardNumRaw.length >= 12,
        cardNumber: cardNumRaw,
        cardGrouped,
        cardHolder: settings.pay_card_holder || '',
        cardBank: settings.pay_card_bank || '',
        gatewayName: settings.pay_gateway_name || '',
        gatewayDesc: settings.pay_gateway_desc || ''
    };
    const content = `
    <div class="nc-container nc-page nc-narrow">
      <ol class="nc-steps" aria-label="مراحل سفارش">
        <li class="is-done"><span>۱</span>سبد خرید</li>
        <li class="is-done"><span>۲</span>ثبت سفارش</li>
        <li class="is-current"><span>۳</span>پرداخت</li>
      </ol>
      <div class="nc-success-card">
        <div class="nc-success-icon"><i class="fas fa-circle-check"></i></div>
        <h1>سفارش شما با موفقیت ثبت شد!</h1>
        <p class="nc-success-num">شماره سفارش: <span id="ord-num">${esc(orderNumber)}</span>
          <button type="button" class="nc-copy-btn sm" data-copy="${esc(orderNumber)}" aria-label="کپی شماره سفارش"><i class="fas fa-copy"></i></button>
        </p>
        <div id="order-info"></div>
        <div id="pay-step"></div>
        <div class="nc-success-actions">
          <a href="/products" class="nc-btn-outline">ادامه خرید</a>
          <a href="/account?tab=orders" class="nc-btn-primary">پنل سفارش‌های من</a>
        </div>
      </div>
    </div>
    <script>
      var PAYCFG = ${safeJson(payCfg)};
      var ORDER_NO = ${safeJson(String(orderNumber))};
      var PAY_LABEL = { card: 'کارت به کارت', gateway: 'پرداخت آنلاین', cod: 'هماهنگی با کارشناس فروش' };
      var PAYST_LABEL = { pending: ['در انتظار پرداخت', 'nc-pending'], awaiting_review: ['رسید ثبت شد — در انتظار بررسی', 'nc-review'], paid: ['پرداخت شده', 'nc-paid'], failed: ['ناموفق', 'nc-failed'], refunded: ['بازگشت وجه', 'nc-refunded'] };

      function renderPayStep(o) {
        const host = document.getElementById('pay-step');
        const method = o.payment_method || (PAYCFG.cardEnabled ? 'card' : 'cod');
        const pst = o.payment_status || 'pending';
        if (pst === 'paid') {
          host.innerHTML = '<div class="nc-pay-done"><i class="fas fa-circle-check"></i><div><b>پرداخت این سفارش تایید شده است.</b><span>سفارش شما در حال آماده‌سازی است.</span></div></div>';
          return;
        }
        if (method === 'gateway') {
          host.innerHTML = '<div class="nc-pay-panel"><h2><i class="fas fa-shield-halved"></i>مرحله پرداخت — درگاه آنلاین</h2>'
            + '<p class="nc-pay-lead">' + ncpEsc(PAYCFG.gatewayDesc || 'لینک پرداخت امن پس از بررسی سفارش، از طریق پیامک برای شما ارسال می‌شود.') + '</p></div>';
          return;
        }
        if (method === 'cod' || !PAYCFG.cardEnabled) {
          host.innerHTML = '<div class="nc-pay-panel"><h2><i class="fas fa-handshake"></i>مرحله بعد — تماس کارشناس</h2>'
            + '<p class="nc-pay-lead">کارشناسان ما در اولین فرصت کاری برای هماهنگی پرداخت و ارسال با شما تماس می‌گیرند.</p></div>';
          return;
        }
        const submitted = pst === 'awaiting_review';
        host.innerHTML = \`
          <div class="nc-pay-panel">
            <h2><i class="fas fa-money-check-dollar"></i>مرحله پرداخت — کارت به کارت</h2>
            <p class="nc-pay-lead">مبلغ زیر را به شماره کارت زیر واریز کنید، سپس شماره پیگیری واریز را در فرم پایین ثبت کنید تا سفارش شما تایید شود.</p>
            <div class="nc-paycard lg">
              <div class="nc-paycard-top">
                <span class="nc-paycard-label">شماره کارت</span>
                \${PAYCFG.cardBank ? '<span class="nc-paycard-bank">بانک ' + ncpEsc(PAYCFG.cardBank) + '</span>' : ''}
              </div>
              <div class="nc-paycard-numrow">
                <b dir="ltr" class="nc-paycard-num">\${ncpEsc(PAYCFG.cardGrouped)}</b>
                <button type="button" class="nc-copy-btn" data-copy="\${ncpEsc(PAYCFG.cardNumber)}" aria-label="کپی شماره کارت"><i class="fas fa-copy"></i><span>کپی</span></button>
              </div>
              \${PAYCFG.cardHolder ? '<div class="nc-paycard-holder"><i class="fas fa-user"></i>به نام: <b>' + ncpEsc(PAYCFG.cardHolder) + '</b></div>' : ''}
            </div>
            <div class="nc-payamount">
              <span>مبلغ قابل پرداخت</span>
              <b>\${formatPrice(o.total)} تومان</b>
              <button type="button" class="nc-copy-btn sm" data-copy="\${o.total}" aria-label="کپی مبلغ"><i class="fas fa-copy"></i></button>
            </div>
            \${submitted
              ? '<div class="nc-pay-submitted"><i class="fas fa-hourglass-half"></i><div><b>رسید شما ثبت شد.</b><span>شماره پیگیری: <span class="nc-mono" dir="ltr">' + ncpEsc(o.payment_ref || '') + '</span> — پس از بررسی، وضعیت سفارش به «پرداخت شده» تغییر می‌کند.</span></div></div>'
              : \`<form id="receipt-form" class="nc-form nc-receipt-form">
                  <h3><i class="fas fa-receipt"></i>ثبت رسید واریز</h3>
                  <div><label class="nc-form-label">شماره پیگیری واریز *</label>
                    <input name="payment_ref" required minlength="4" maxlength="40" inputmode="numeric" dir="ltr" class="nc-input" placeholder="مثال: 123456789"
                      data-error-required="شماره پیگیری واریز را وارد کنید" data-error-minlength="شماره پیگیری حداقل ۴ رقم است">
                    <small class="nc-field-hint">شماره پیگیری/رهگیری تراکنش که در پیامک یا رسید بانک درج شده است.</small></div>
                  <div><label class="nc-form-label">توضیحات (اختیاری)</label>
                    <textarea name="payment_note" rows="2" maxlength="500" class="nc-input" placeholder="مثلاً: از کارت به نام ... واریز شد"></textarea></div>
                  <button type="submit" class="nc-btn-primary w-full"><i class="fas fa-paper-plane ml-2"></i>ثبت رسید و تکمیل پرداخت</button>
                </form>\`}
          </div>\`;
        if (window.ncpBindCopy) window.ncpBindCopy(host);
        const rf = document.getElementById('receipt-form');
        if (rf) rf.addEventListener('submit', async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target).entries());
          if (window.ncpToEnDigits) data.payment_ref = window.ncpToEnDigits(data.payment_ref).replace(/[^0-9]/g, '');
          const btn = e.target.querySelector('button[type=submit]');
          btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> در حال ثبت...';
          try {
            const rr = await axios.post('/api/orders/by-number/' + encodeURIComponent(ORDER_NO) + '/receipt', data);
            toast(rr.data.message || 'رسید پرداخت ثبت شد', 'success');
            loadOrder();
          } catch (err) {
            toast(err.response?.data?.message || 'خطا در ثبت رسید', 'error');
            btn.disabled = false; btn.innerHTML = orig;
          }
        });
      }

      async function loadOrder() {
        try {
          const r = await axios.get('/api/orders/by-number/' + encodeURIComponent(ORDER_NO));
          if (!r.data.success) return;
          const o = r.data.data;
          const ps = PAYST_LABEL[o.payment_status || 'pending'] || PAYST_LABEL.pending;
          document.getElementById('order-info').innerHTML = \`
            <div class="nc-order-info">
              <div class="nc-sum-row"><span>گیرنده</span><span>\${ncpEsc(o.customer_name)}</span></div>
              <div class="nc-sum-row"><span>تماس</span><span class="nc-mono" dir="ltr">\${ncpEsc(o.customer_phone)}</span></div>
              <div class="nc-sum-row"><span>آدرس</span><span>\${ncpEsc(o.shipping_city || '')} - \${ncpEsc(o.shipping_address)}</span></div>
              <div class="nc-sum-row"><span>روش پرداخت</span><span>\${ncpEsc(PAY_LABEL[o.payment_method] || 'هماهنگی با کارشناس فروش')}</span></div>
              <div class="nc-sum-row total"><span>مبلغ کل</span><span>\${formatPrice(o.total)} تومان</span></div>
              <div class="nc-sum-row"><span>وضعیت پرداخت</span><span class="\${ps[1]}">\${ps[0]}</span></div>
            </div>\`;
          renderPayStep(o);
        } catch (e) {}
      }
      ncpReady(() => { loadOrder(); if (window.ncpBindCopy) window.ncpBindCopy(document); });
    </script>
  `;
    return siteLayout({ title: 'پرداخت سفارش', currentPath: '/' }, content);
}
// ===== Auth pages =====
export function loginPage() {
    const content = `
    <div class="nc-container nc-page nc-auth">
      <div class="nc-auth-card">
        <div class="nc-auth-head">
          <div class="nc-auth-icon"><i class="fas fa-right-to-bracket"></i></div>
          <h1>ورود به حساب</h1>
          <p>به فروشگاه نت‌کور پرو خوش آمدید</p>
        </div>

        <div class="nc-auth-tabs" role="tablist" aria-label="روش ورود">
          <button type="button" id="tab-phone" class="nc-auth-tab is-active" role="tab" aria-selected="true" aria-controls="panel-phone"><i class="fas fa-mobile-screen ml-1"></i>ورود با شماره موبایل</button>
          <button type="button" id="tab-email" class="nc-auth-tab" role="tab" aria-selected="false" aria-controls="panel-email"><i class="fas fa-envelope ml-1"></i>ورود با ایمیل</button>
        </div>

        <!-- ===== Phone/OTP login (default) ===== -->
        <div id="panel-phone">
          <div class="nc-notice" style="background:#fff7e6;border:1px solid #ffe1a8;color:#8a5a00;border-radius:8px;padding:.6rem .8rem;font-size:.82rem;margin-bottom:.8rem">
            <i class="fas fa-flask ml-1"></i> سرویس پیامک هنوز فعال نشده؛ در حالت آزمایشی، کد تایید به‌صورت خودکار روی صفحه نمایش داده می‌شود.
          </div>
          <form id="otp-send-form">
            <div class="nc-filter-group"><label for="otp-phone">شماره موبایل</label><input id="otp-phone" name="phone" type="tel" inputmode="tel" required
                     data-nc-phone pattern="0?9[0-9]{9}" maxlength="11" dir="ltr"
                     placeholder="09123456789" autocomplete="tel" class="nc-input"
                     data-error-required="شماره موبایل خود را وارد کنید"
                     data-error-pattern="شماره موبایل معتبر نیست — مثال: 09123456789">
              <small class="nc-field-hint">می‌توانید با +۹۸ یا ۰۰۹۸ هم وارد کنید؛ خودکار اصلاح می‌شود.</small></div>
            <button type="submit" class="nc-btn-primary w-full" id="otp-send-btn">دریافت کد تایید</button>
          </form>
          <form id="otp-verify-form" style="display:none">
            <div class="nc-filter-group"><label for="otp-code">کد تایید</label><input id="otp-code" name="code" type="text" inputmode="numeric" required maxlength="5" placeholder="&#9679;&#9679;&#9679;&#9679;&#9679;" class="nc-input" dir="ltr" style="letter-spacing:.4em;text-align:center;font-size:1.2rem" data-error-required="کد تایید پیامک‌شده را وارد کنید"></div>
            <div id="otp-demo-hint" style="font-size:.8rem;color:var(--nc-muted,#888);margin-bottom:.6rem"></div>
            <button type="submit" class="nc-btn-primary w-full">تایید و ورود</button>
            <button type="button" id="otp-change-phone" class="nc-btn-outline w-full" style="margin-top:.5rem">تغییر شماره موبایل</button>
          </form>
        </div>

        <!-- ===== Email/password login ===== -->
        <div id="panel-email" style="display:none">
          <form id="login-form">
            <div class="nc-filter-group"><label for="site-login-email">ایمیل</label><input id="site-login-email" name="email" type="email" required autocomplete="username" dir="ltr" class="nc-input" data-error-required="ایمیل خود را وارد کنید"></div>
            <div class="nc-filter-group"><label for="site-login-password">رمز عبور</label><input id="site-login-password" name="password" type="password" required autocomplete="current-password" class="nc-input" data-error-required="رمز عبور خود را وارد کنید"></div>
            <button type="submit" class="nc-btn-primary w-full">ورود</button>
          </form>
        </div>

        <div class="nc-auth-foot">حساب ندارید؟ <a href="/register">ثبت‌نام کنید</a></div>
      </div>
    </div>
    <script>
      (function () {
        var tabPhone = document.getElementById('tab-phone');
        var tabEmail = document.getElementById('tab-email');
        var panelPhone = document.getElementById('panel-phone');
        var panelEmail = document.getElementById('panel-email');
        function activate(which) {
          var phoneOn = which === 'phone';
          panelPhone.style.display = phoneOn ? '' : 'none';
          panelEmail.style.display = phoneOn ? 'none' : '';
          tabPhone.classList.toggle('is-active', phoneOn);
          tabEmail.classList.toggle('is-active', !phoneOn);
          tabPhone.setAttribute('aria-selected', phoneOn ? 'true' : 'false');
          tabEmail.setAttribute('aria-selected', phoneOn ? 'false' : 'true');
          // colours/underline come from .nc-auth-tab / .is-active in app.css
        }
        tabPhone.addEventListener('click', function () { activate('phone'); });
        tabEmail.addEventListener('click', function () { activate('email'); });

        function afterLoginSuccess(token, user) {
          window.NCPAuth.setSession(token, user);
          if (user.role === 'admin') {
            localStorage.setItem('admin_token', token);
            sessionStorage.setItem('admin_info', JSON.stringify(user));
          }
          toast('ورود موفقیت‌آمیز', 'success');
          const redirect = new URLSearchParams(location.search).get('redirect');
          setTimeout(() => location.href = redirect || (user.role === 'admin' ? '/admin' : '/account'), 500);
        }

        // ---- Email/password ----
        document.getElementById('login-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const data = Object.fromEntries(fd.entries());
          const btn = e.target.querySelector('button[type=submit]');
          btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> در حال ورود...';
          try {
            const r = await axios.post('/api/auth/login', data);
            if (r.data.success) { afterLoginSuccess(r.data.data.token, r.data.data.user); }
          } catch (err) {
            toast(err.response?.data?.message || 'خطا در ورود', 'error');
            btn.disabled = false; btn.innerHTML = orig;
          }
        });

        // ---- Phone/OTP ----
        var currentPhone = '';
        document.getElementById('otp-send-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          // F6: normalise +98/0098/98/Persian digits before it reaches the API
          const phone = window.ncpNormalizePhone ? window.ncpNormalizePhone(fd.get('phone')) : fd.get('phone');
          const btn = document.getElementById('otp-send-btn');
          btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> در حال ارسال...';
          try {
            const r = await axios.post('/api/auth/otp/send', { phone });
            if (r.data.success) {
              currentPhone = phone;
              document.getElementById('otp-send-form').style.display = 'none';
              document.getElementById('otp-verify-form').style.display = '';
              var hint = document.getElementById('otp-demo-hint');
              if (r.data.data && r.data.data.debug_code) {
                hint.textContent = 'کد آزمایشی: ' + r.data.data.debug_code + ' (سرویس پیامک بعداً فعال می‌شود)';
                document.getElementById('otp-code').value = r.data.data.debug_code;
              }
              toast(r.data.message || 'کد ارسال شد', 'success');
            }
          } catch (err) {
            toast(err.response?.data?.message || 'خطا در ارسال کد', 'error');
          } finally {
            btn.disabled = false; btn.innerHTML = orig;
          }
        });
        document.getElementById('otp-change-phone').addEventListener('click', function () {
          document.getElementById('otp-verify-form').style.display = 'none';
          document.getElementById('otp-send-form').style.display = '';
          document.getElementById('otp-code').value = '';
        });
        document.getElementById('otp-verify-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const code = fd.get('code');
          const btn = e.target.querySelector('button[type=submit]');
          btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> در حال تایید...';
          try {
            const r = await axios.post('/api/auth/otp/verify', { phone: currentPhone, code });
            if (r.data.success) { afterLoginSuccess(r.data.data.token, r.data.data.user); }
          } catch (err) {
            toast(err.response?.data?.message || 'کد اشتباه است', 'error');
          } finally {
            btn.disabled = false; btn.innerHTML = orig;
          }
        });
      })();
    </script>
  `;
    return siteLayout({ title: 'ورود', currentPath: '/login' }, content);
}
export function registerPage() {
    const content = `
    <div class="nc-container nc-page nc-auth">
      <div class="nc-auth-card">
        <div class="nc-auth-head">
          <div class="nc-auth-icon"><i class="fas fa-user-plus"></i></div>
          <h1>ایجاد حساب</h1>
        </div>
        <form id="reg-form">
          <div class="nc-filter-group"><label>نام و نام خانوادگی</label><input name="full_name" required minlength="2" autocomplete="name" class="nc-input" data-error-required="نام و نام خانوادگی را وارد کنید"></div>
          <div class="nc-filter-group"><label>ایمیل</label><input name="email" type="email" required autocomplete="email" dir="ltr" class="nc-input" data-error-required="ایمیل خود را وارد کنید"></div>
          <div class="nc-filter-group"><label>شماره موبایل</label><input name="phone" type="tel" inputmode="tel" data-nc-phone pattern="0?9[0-9]{9}" maxlength="11" dir="ltr" placeholder="09123456789" autocomplete="tel" class="nc-input" data-error-pattern="شماره موبایل معتبر نیست — مثال: 09123456789"></div>
          <div class="nc-filter-group"><label>نام شرکت</label><input name="company" autocomplete="organization" class="nc-input"></div>
          <div class="nc-filter-group"><label>رمز عبور (حداقل ۶ کاراکتر)</label><input name="password" type="password" required minlength="6" autocomplete="new-password" class="nc-input" data-error-required="یک رمز عبور انتخاب کنید"></div>
          <button type="submit" class="nc-btn-primary w-full">ایجاد حساب</button>
        </form>
        <div class="nc-auth-foot">حساب دارید؟ <a href="/login">وارد شوید</a></div>
      </div>
    </div>
    <script>
      document.getElementById('reg-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        if (data.phone && window.ncpNormalizePhone) data.phone = window.ncpNormalizePhone(data.phone);
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>';
        try {
          const r = await axios.post('/api/auth/register', data);
          if (r.data.success) {
            window.NCPAuth.setSession(r.data.data.token, r.data.data.user);
            toast('ثبت‌نام موفقیت‌آمیز', 'success');
            setTimeout(() => location.href = '/account', 500);
          }
        } catch (err) {
          toast(err.response?.data?.message || 'خطا در ثبت‌نام', 'error');
          btn.disabled = false; btn.innerHTML = orig;
        }
      });
    </script>
  `;
    return siteLayout({ title: 'ثبت‌نام', currentPath: '/register' }, content);
}
// ===== Account =====
export function accountPage() {
    const content = `
    <div class="nc-container nc-page">
      <nav class="nc-breadcrumb"><a href="/">خانه</a> <i class="fas fa-angle-left"></i> <span>پنل کاربری</span></nav>
      <h1 class="nc-page-title">پنل کاربری من</h1>
      <div id="account-root">
        <div class="nc-empty"><span class="spinner"></span></div>
      </div>
    </div>
    <script>
      var tab = new URLSearchParams(location.search).get('tab') || 'profile';
      var ME = null;
      async function fetchMe(force) {
        if (ME && !force) return ME;
        const r = await axios.get('/api/auth/me');
        ME = (r.data && r.data.data) || r.data || {};
        return ME;
      }
      function ncpMaskEmail(e) { return String(e || '').replace(/(.{2}).*(@.*)/, '$1***$2'); }
      async function loadAccount() {
        if (!window.NCPAuth.isLoggedIn()) { location.href = '/login?redirect=/account'; return; }
        const root = document.getElementById('account-root');
        let me = null;
        try { me = await fetchMe(); } catch (e) { me = null; }
        const hasPw = !(me && me.has_password === false);
        const isPhoneAcc = !!(me && me.is_phone_account);
        const tabs = [
          { k: 'profile', l: 'پروفایل', i: 'fa-user' },
          { k: 'orders', l: 'سفارش‌های من', i: 'fa-cart-shopping' },
          { k: 'tickets', l: 'تیکت‌های من', i: 'fa-headset' },
          { k: 'password', l: hasPw ? 'تغییر رمز عبور' : 'تعیین رمز عبور', i: hasPw ? 'fa-key' : 'fa-lock-open' }
        ];
        const uname = (me && (me.full_name || me.company)) || 'کاربر نت‌کور';
        const uid = (me && me.phone) ? me.phone : (isPhoneAcc ? '' : ((me && me.email) || ''));
        const initial = ncpEsc(String(uname).trim().charAt(0) || 'ن');
        root.innerHTML = \`
          <div class="nc-account-grid">
            <aside class="nc-account-side">
              <div class="nc-account-user">
                <span class="nc-account-avatar">\${initial}</span>
                <span class="nc-account-user-meta">
                  <b>\${ncpEsc(uname)}</b>
                  \${uid ? \`<small class="nc-mono" dir="ltr">\${ncpEsc(uid)}</small>\` : ''}
                </span>
              </div>
              <nav class="nc-account-nav" id="account-nav" aria-label="منوی حساب کاربری">
                \${tabs.map(t => \`<a href="/account?tab=\${t.k}" class="nc-account-link \${tab === t.k ? 'is-active' : ''}"\${tab === t.k ? ' aria-current="page"' : ''}><i class="fas \${t.i}"></i><span>\${t.l}</span></a>\`).join('')}
                <a href="#" id="account-logout" class="nc-account-link nc-account-logout"><i class="fas fa-right-from-bracket"></i><span>خروج</span></a>
              </nav>
            </aside>
            <div id="tab-content" class="nc-account-main"></div>
          </div>\`;
        const lo = document.getElementById('account-logout');
        if (lo) lo.addEventListener('click', (e) => { e.preventDefault(); if (window.NCPAuth?.logout) window.NCPAuth.logout(); location.href = '/'; });
        try {
          const nav = document.getElementById('account-nav');
          const act = nav && nav.querySelector('.is-active');
          if (act && nav.scrollWidth > nav.clientWidth + 4) act.scrollIntoView({ block: 'nearest', inline: 'center' });
        } catch (e) {}
        if (tab === 'profile') loadProfile();
        else if (tab === 'orders') loadOrders();
        else if (tab === 'tickets') loadTickets();
        else if (tab === 'password') loadPassword();
      }
      async function loadProfile() {
        const c = document.getElementById('tab-content');
        c.innerHTML = '<div class="nc-static-card nc-pending"><span class="spinner"></span></div>';
        try {
          const u = await fetchMe(true);
          const emailField = u.is_phone_account
            ? '<div><label class="nc-form-label">ایمیل</label><input name="email" type="email" value="" placeholder="اختیاری — برای دریافت فاکتور" class="nc-input" dir="ltr" data-error-type="ایمیل معتبر وارد کنید"><small class="nc-field-hint">حساب شما با شماره موبایل ساخته شده است.</small></div>'
            : '<div><label class="nc-form-label">ایمیل (غیرقابل تغییر)</label><input value="' + ncpEsc(u.email || '') + '" disabled class="nc-input" dir="ltr"></div>';
          c.innerHTML = \`
            <div class="nc-static-card">
              <h2 class="nc-card-title">اطلاعات پروفایل</h2>
              <form id="profile-form" class="nc-form">
                <div class="nc-form-row">
                  <div><label class="nc-form-label">نام و نام خانوادگی *</label><input name="full_name" value="\${ncpEsc(u.full_name || '')}" required class="nc-input" data-error-required="نام و نام خانوادگی را وارد کنید"></div>
                  \${emailField}
                </div>
                <div class="nc-form-row">
                  <div><label class="nc-form-label">موبایل</label><input name="phone" value="\${ncpEsc(u.phone || '')}" class="nc-input" data-nc-phone dir="ltr" maxlength="11" pattern="0?9[0-9]{9}" data-error-pattern="شماره موبایل معتبر نیست (مثال: 09123456789)"></div>
                  <div><label class="nc-form-label">شرکت</label><input name="company" value="\${ncpEsc(u.company || '')}" class="nc-input"></div>
                </div>
                <div class="nc-form-row">
                  <div><label class="nc-form-label">شهر</label><input name="city" value="\${ncpEsc(u.city || '')}" class="nc-input"></div>
                  <div><label class="nc-form-label">کد پستی</label><input name="postal_code" value="\${ncpEsc(u.postal_code || '')}" class="nc-input"></div>
                </div>
                <div><label class="nc-form-label">آدرس</label><textarea name="address" rows="3" class="nc-input">\${ncpEsc(u.address || '')}</textarea></div>
                <button type="submit" class="nc-btn-primary">ذخیره تغییرات</button>
              </form>
            </div>\`;
          if (window.ncpBindPhoneInputs) window.ncpBindPhoneInputs(c);
          document.getElementById('profile-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const data = Object.fromEntries(fd.entries());
            if (data.phone && window.ncpNormalizePhone) data.phone = window.ncpNormalizePhone(data.phone);
            Object.keys(data).forEach(k => { if (typeof data[k] === 'string' && !data[k].trim()) delete data[k]; });
            const btn = e.target.querySelector('button[type=submit]');
            btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>';
            try {
              await axios.put('/api/auth/profile', data);
              ME = null;
              toast('پروفایل به‌روزرسانی شد', 'success');
            } catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); }
            finally { btn.disabled = false; btn.innerHTML = orig; }
          });
        } catch (e) { c.innerHTML = '<div class="nc-notice">خطا در بارگذاری</div>'; }
      }
      async function loadOrders() {
        const c = document.getElementById('tab-content');
        c.innerHTML = '<div class="nc-static-card nc-pending"><span class="spinner"></span></div>';
        try {
          const r = await axios.get('/api/orders');
          const items = r.data.data.items;
          if (!items.length) { c.innerHTML = '<div class="nc-empty-box"><i class="fas fa-cart-shopping"></i>هنوز سفارشی ثبت نکرده‌اید.</div>'; return; }
          const map = { pending: ['در انتظار', 'badge-pending'], confirmed: ['تایید شده', 'badge-confirmed'], shipping: ['در حال ارسال', 'badge-shipping'], delivered: ['تحویل شده', 'badge-delivered'], cancelled: ['لغو شده', 'badge-cancelled'] };
          c.innerHTML = '<div class="nc-static-card nc-table-wrap"><table class="nc-table"><thead><tr><th>شماره سفارش</th><th>تاریخ</th><th>مبلغ</th><th>وضعیت</th></tr></thead><tbody>' +
            items.map(o => \`<tr><td class="nc-mono">\${ncpEsc(o.order_number)}</td><td>\${formatDate(o.created_at)}</td><td>\${formatPrice(o.total)} تومان</td><td><span class="badge \${(map[o.status]||['','badge-closed'])[1]}">\${(map[o.status]||[o.status])[0]}</span></td></tr>\`).join('') +
            '</tbody></table></div>';
        } catch (e) { c.innerHTML = '<div class="nc-notice">خطا</div>'; }
      }
      async function loadTickets() {
        const c = document.getElementById('tab-content');
        c.innerHTML = '<div class="nc-static-card nc-pending"><span class="spinner"></span></div>';
        try {
          const r = await axios.get('/api/tickets');
          const items = r.data.data;
          let html = \`<div class="nc-static-card" style="margin-bottom:16px">
            <h3 class="nc-card-title">تیکت جدید</h3>
            <form id="new-ticket" class="nc-form">
              <input name="subject" placeholder="موضوع" required class="nc-input">
              <textarea name="message" placeholder="پیام شما..." rows="3" required class="nc-input"></textarea>
              <button type="submit" class="nc-btn-primary">ارسال تیکت</button>
            </form>
          </div>\`;
          if (!items.length) html += '<div class="nc-empty-box"><i class="fas fa-headset"></i>هنوز تیکتی ندارید.</div>';
          else {
            const map = { open: ['باز', 'badge-open'], answered: ['پاسخ داده شده', 'badge-answered'], closed: ['بسته', 'badge-closed'] };
            html += '<div class="nc-static-card nc-table-wrap"><table class="nc-table"><thead><tr><th>شماره</th><th>موضوع</th><th>وضعیت</th><th>عملیات</th></tr></thead><tbody>' +
              items.map(t => \`<tr><td class="nc-mono">\${ncpEsc(t.ticket_number)}</td><td>\${ncpEsc(t.subject)}</td><td><span class="badge \${(map[t.status]||['','badge-closed'])[1]}">\${(map[t.status]||[t.status])[0]}</span></td><td><button onclick="viewTicket(\${t.id})" class="nc-link-btn">مشاهده</button></td></tr>\`).join('') +
              '</tbody></table></div>';
          }
          c.innerHTML = html;
          document.getElementById('new-ticket').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const btn = e.target.querySelector('button'); btn.disabled = true;
            try { await axios.post('/api/tickets', Object.fromEntries(fd.entries())); toast('تیکت ارسال شد', 'success'); loadTickets(); }
            catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); btn.disabled = false; }
          });
        } catch (e) { c.innerHTML = '<div class="nc-notice">خطا</div>'; }
      }
      window.viewTicket = async function (id) {
        const c = document.getElementById('tab-content');
        c.innerHTML = '<div class="nc-static-card nc-pending"><span class="spinner"></span></div>';
        try {
          const r = await axios.get('/api/tickets/' + id);
          const t = r.data.data;
          let html = \`<button onclick="loadTickets()" class="nc-link-btn" style="margin-bottom:12px"><i class="fas fa-arrow-right ml-1"></i>بازگشت به لیست</button>
            <div class="nc-static-card" style="margin-bottom:16px">
              <h3 class="nc-card-title" style="margin-bottom:6px">\${ncpEsc(t.subject)}</h3>
              <div class="nc-comment-date" style="margin-bottom:12px">\${ncpEsc(t.ticket_number)} • \${formatDate(t.created_at)}</div>
              <p style="line-height:1.9;color:var(--nc-ink)">\${ncpEsc(t.message)}</p>
            </div>\`;
          (t.replies || []).forEach(rp => {
            html += \`<div class="nc-static-card \${rp.is_admin ? 'nc-reply-admin' : ''}" style="margin-bottom:12px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span style="font-weight:700;font-size:14px;color:\${rp.is_admin ? 'var(--nc-primary)' : 'var(--nc-ink)'}">\${ncpEsc(rp.author_name)} \${rp.is_admin ? '(پشتیبانی)' : ''}</span>
                <span class="nc-comment-date">\${formatDate(rp.created_at)}</span>
              </div>
              <p style="font-size:14px;line-height:1.9;color:#555c75">\${ncpEsc(rp.message)}</p>
            </div>\`;
          });
          if (t.status !== 'closed') {
            html += \`<div class="nc-static-card">
              <form id="reply-form" class="nc-form">
                <textarea name="message" required rows="3" placeholder="پاسخ شما..." class="nc-input"></textarea>
                <button type="submit" class="nc-btn-primary">ارسال پاسخ</button>
              </form>
            </div>\`;
          }
          c.innerHTML = html;
          const f = document.getElementById('reply-form');
          if (f) f.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const btn = e.target.querySelector('button'); btn.disabled = true;
            try { await axios.post('/api/tickets/' + id + '/replies', { message: fd.get('message') }); toast('پاسخ ارسال شد', 'success'); viewTicket(id); }
            catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); btn.disabled = false; }
          });
        } catch (e) { c.innerHTML = '<div class="nc-notice">خطا</div>'; }
      };
      window.loadTickets = loadTickets;
      async function loadPassword() {
        const c = document.getElementById('tab-content');
        c.innerHTML = '<div class="nc-static-card nc-pending"><span class="spinner"></span></div>';
        let me = null;
        try { me = await fetchMe(); } catch (e) { me = null; }
        const hasPw = !(me && me.has_password === false);
        const isPhoneAcc = !!(me && me.is_phone_account);
        if (hasPw) {
          c.innerHTML = \`<div class="nc-static-card">
            <h2 class="nc-card-title">تغییر رمز عبور</h2>
            <form id="pw-form" class="nc-form nc-form-narrow">
              <div><label class="nc-form-label">رمز فعلی</label><input name="old_password" type="password" required autocomplete="current-password" class="nc-input" data-error-required="رمز فعلی را وارد کنید"></div>
              <div><label class="nc-form-label">رمز جدید (حداقل ۶ کاراکتر)</label><input name="new_password" type="password" minlength="6" required autocomplete="new-password" class="nc-input" data-error-required="رمز جدید را وارد کنید" data-error-minlength="رمز عبور باید حداقل ۶ کاراکتر باشد"></div>
              <div><label class="nc-form-label">تکرار رمز جدید</label><input name="confirm_password" type="password" minlength="6" required autocomplete="new-password" class="nc-input" data-error-required="تکرار رمز جدید را وارد کنید"></div>
              <button type="submit" class="nc-btn-primary">تغییر رمز</button>
            </form>
          </div>\`;
        } else {
          c.innerHTML = \`<div class="nc-static-card">
            <h2 class="nc-card-title">تعیین رمز عبور</h2>
            <div class="nc-inline-note"><i class="fas fa-circle-info"></i><span>شما با <b>کد یک‌بارمصرف پیامکی</b> وارد شده‌اید و هنوز رمز عبوری ندارید. اگر می‌خواهید علاوه بر پیامک، با رمز عبور هم وارد شوید، اینجا یک رمز تعیین کنید. در غیر این صورت نیازی به این کار نیست.</span></div>
            <form id="pw-set-form" class="nc-form nc-form-narrow">
              \${isPhoneAcc ? '<div><label class="nc-form-label">ایمیل (برای ورود با ایمیل و رمز)</label><input name="email" type="email" class="nc-input" dir="ltr" placeholder="you@example.com" data-error-type="ایمیل معتبر وارد کنید"><small class="nc-field-hint">اختیاری است؛ اگر خالی بماند فقط با شماره موبایل وارد می‌شوید.</small></div>' : ''}
              <div><label class="nc-form-label">رمز عبور جدید (حداقل ۶ کاراکتر)</label><input name="new_password" type="password" minlength="6" required autocomplete="new-password" class="nc-input" data-error-required="رمز عبور را وارد کنید" data-error-minlength="رمز عبور باید حداقل ۶ کاراکتر باشد"></div>
              <div><label class="nc-form-label">تکرار رمز عبور</label><input name="confirm_password" type="password" minlength="6" required autocomplete="new-password" class="nc-input" data-error-required="تکرار رمز عبور را وارد کنید"></div>
              <button type="submit" class="nc-btn-primary">ثبت رمز عبور</button>
            </form>
          </div>\`;
        }
        const form = document.getElementById(hasPw ? 'pw-form' : 'pw-set-form');
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const data = Object.fromEntries(fd.entries());
          if (data.new_password !== data.confirm_password) { toast('رمز جدید و تکرار آن یکسان نیستند', 'error'); return; }
          delete data.confirm_password;
          Object.keys(data).forEach(k => { if (typeof data[k] === 'string' && !data[k].trim()) delete data[k]; });
          const btn = e.target.querySelector('button[type=submit]');
          btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>';
          try {
            await axios.post(hasPw ? '/api/auth/change-password' : '/api/auth/set-password', data);
            ME = null;
            toast(hasPw ? 'رمز با موفقیت تغییر کرد' : 'رمز عبور شما با موفقیت تعیین شد', 'success');
            e.target.reset();
            if (!hasPw) setTimeout(loadAccount, 700);
          }
          catch (err) { toast(err.response?.data?.message || 'خطا در ثبت رمز عبور', 'error'); }
          finally { btn.disabled = false; btn.innerHTML = orig; }
        });
      }
      ncpReady(loadAccount);
    </script>
  `;
    return siteLayout({ title: 'پنل کاربری', currentPath: '/account' }, content);
}
// ===== About =====
export function aboutPage() {
    const settings = getAllSettings();
    const intro = getPage('about', 'intro');
    const mission = getPage('about', 'mission');
    const whyUs = getBlocks('about', 'why_us');
    const whyFallback = [
        { title: 'تضمین اصالت کالا' },
        { title: 'گارانتی معتبر و خدمات پس از فروش' },
        { title: 'مشاوره فنی رایگان' },
        { title: 'ارسال سریع به سراسر کشور' },
        { title: 'قیمت‌گذاری شفاف و رقابتی' }
    ];
    const whyItems = whyUs.length ? whyUs : whyFallback;
    const introTitle = intro?.title || `درباره ${settings.site_name || 'NetCore Pro'}`;
    const introBody = intro?.body || `${settings.site_name || 'NetCore Pro'} یک فروشگاه آنلاین تخصصی B2B در زمینه تجهیزات شبکه است که هدف آن ارائه راهکارهای زیرساختی شبکه برای سازمان‌ها، کسب‌وکارها و متخصصان IT می‌باشد.`;
    const missionTitle = mission?.title || 'ماموریت ما';
    const missionBody = mission?.body || 'عرضه تجهیزات اصلی و گارانتی‌دار از برندهای مطرح جهان نظیر Cisco، Mikrotik، HP، Juniper، Fortinet و Ubiquiti همراه با مشاوره فنی تخصصی.';
    // Animated stat counters (count-up on scroll into view)
    let productCount = 0;
    try {
        productCount = db.prepare(`SELECT COUNT(*) AS c FROM products WHERE status = 'active'`).get().c;
    }
    catch (e) { productCount = 0; }
    const stats = [
        { value: parseInt(settings.stat_years || '25', 10) || 25, suffix: '+', label: 'سال تجربه', icon: 'fa-award' },
        { value: parseInt(settings.stat_customers || '4800', 10) || 4800, suffix: '+', label: 'مشتری راضی', icon: 'fa-users' },
        { value: Math.max(productCount, parseInt(settings.stat_products || '0', 10) || 0), suffix: '+', label: 'محصول فعال', icon: 'fa-boxes-stacked' },
        { value: parseInt(settings.stat_projects || '650', 10) || 650, suffix: '+', label: 'پروژه اجرا شده', icon: 'fa-diagram-project' }
    ];
    const content = `
    <div class="nc-container nc-page nc-narrow">
      <nav class="nc-breadcrumb"><a href="/">خانه</a> <i class="fas fa-angle-left"></i> <span>درباره ما</span></nav>

      <div class="nc-about-stats" id="about-stats">
        ${stats.map(s => `
        <div class="nc-stat-card">
          <i class="fas ${esc(s.icon)}"></i>
          <div class="nc-stat-num" data-target="${s.value}" data-suffix="${esc(s.suffix)}">۰</div>
          <div class="nc-stat-label">${esc(s.label)}</div>
        </div>`).join('')}
      </div>

      <div class="nc-static-card prose-rtl">
        <h1>${esc(introTitle)}</h1>
        <div class="nc-rich-body">${richText(introBody)}</div>
        <h2>${esc(missionTitle)}</h2>
        <div class="nc-rich-body">${richText(missionBody)}</div>
        <h2>چرا ما؟</h2>
        <ul class="nc-why-list">
          ${whyItems.map(w => `<li><i class="fas ${esc(w.icon || 'fa-check')}"></i><span>${esc(w.title)}${w.description ? ` — <small>${esc(w.description)}</small>` : ''}</span></li>`).join('')}
        </ul>
      </div>
    </div>
    <script>
    (function(){
      var faFmt = new Intl.NumberFormat('fa-IR');
      function animate(el){
        var target = parseInt(el.getAttribute('data-target') || '0', 10);
        var suffix = el.getAttribute('data-suffix') || '';
        var dur = 1600, start = null;
        function step(ts){
          if (!start) start = ts;
          var p = Math.min((ts - start) / dur, 1);
          // easeOutCubic
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = faFmt.format(Math.round(target * eased)) + (p >= 1 ? suffix : '');
          if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      }
      var nums = document.querySelectorAll('#about-stats .nc-stat-num');
      if (!nums.length) return;
      if ('IntersectionObserver' in window) {
        var seen = false;
        var io = new IntersectionObserver(function(entries){
          entries.forEach(function(en){
            if (en.isIntersecting && !seen) {
              seen = true;
              nums.forEach(animate);
              io.disconnect();
            }
          });
        }, { threshold: 0.3 });
        io.observe(document.getElementById('about-stats'));
      } else {
        nums.forEach(animate);
      }
    })();
    </script>
  `;
    return siteLayout({ title: 'درباره ما', currentPath: '/about' }, content);
}

// ===== Privacy =====
export function privacyPage() {
    const p = getPage('privacy', 'body');
    const title = p?.title || 'حریم خصوصی';
    const body = p?.body || 'سیاست حریم خصوصی این سایت در حال تدوین است. اطلاعات شما طبق قوانین جمهوری اسلامی ایران محافظت می‌شود و بدون رضایت شما به اشخاص ثالث منتقل نخواهد شد.';
    const content = `
    <div class="nc-container nc-page nc-narrow">
      <nav class="nc-breadcrumb"><a href="/">خانه</a> <i class="fas fa-angle-left"></i> <span>${esc(title)}</span></nav>
      <div class="nc-static-card prose-rtl">
        <h1>${esc(title)}</h1>
        <div class="nc-rich-body">${richText(body)}</div>
      </div>
    </div>
  `;
    return siteLayout({ title: title, currentPath: '/privacy' }, content);
}

// ===== Terms =====
export function termsPage() {
    const p = getPage('terms', 'body');
    const title = p?.title || 'شرایط استفاده';
    const body = p?.body || 'استفاده از این سایت به منزله پذیرش کلیه شرایط و قوانین آن است. کلیه معاملات مطابق قوانین تجارت الکترونیک ایران انجام می‌گردد.';
    const content = `
    <div class="nc-container nc-page nc-narrow">
      <nav class="nc-breadcrumb"><a href="/">خانه</a> <i class="fas fa-angle-left"></i> <span>${esc(title)}</span></nav>
      <div class="nc-static-card prose-rtl">
        <h1>${esc(title)}</h1>
        <div class="nc-rich-body">${richText(body)}</div>
      </div>
    </div>
  `;
    return siteLayout({ title: title, currentPath: '/terms' }, content);
}
// ===== Contact =====
export function contactPage() {
    const settings = getAllSettings();
    const content = `
    <div class="nc-container nc-page">
      <nav class="nc-breadcrumb"><a href="/">خانه</a> <i class="fas fa-angle-left"></i> <span>تماس با ما</span></nav>
      <h1 class="nc-page-title">تماس با ما</h1>
      <div class="nc-contact-grid">
        <div class="nc-static-card">
          <h2 class="nc-card-title">اطلاعات تماس</h2>
          <ul class="nc-contact-list">
            <li><span class="nc-contact-ico"><i class="fas fa-phone"></i></span><div><div class="nc-contact-label">تلفن</div><div class="nc-contact-val">${esc(settings.phone || '۰۲۱-۹۱۰۰۱۰۰۰')}</div></div></li>
            <li><span class="nc-contact-ico"><i class="fas fa-mobile-screen"></i></span><div><div class="nc-contact-label">موبایل</div><div class="nc-contact-val">${esc(settings.mobile || '۰۹۱۲۰۰۰۰۰۰۰')}</div></div></li>
            <li><span class="nc-contact-ico"><i class="fas fa-envelope"></i></span><div><div class="nc-contact-label">ایمیل</div><div class="nc-contact-val">${esc(settings.email || 'info@netcorepro.ir')}</div></div></li>
            <li><span class="nc-contact-ico"><i class="fas fa-location-dot"></i></span><div><div class="nc-contact-label">آدرس</div><div class="nc-contact-val">${esc(settings.address || 'تهران، خیابان ولیعصر')}</div></div></li>
          </ul>
        </div>
        <div class="nc-form-card">
          <h2 class="nc-card-title">ارسال پیام / تیکت</h2>
          <form id="contact-form" class="nc-form">
            <input name="name" placeholder="نام شما *" required class="nc-input">
            <div class="nc-form-row">
              <input name="email" type="email" placeholder="ایمیل" class="nc-input">
              <input name="phone" placeholder="تلفن" class="nc-input">
            </div>
            <input name="subject" placeholder="موضوع" class="nc-input">
            <textarea name="body" rows="5" placeholder="متن پیام *" required class="nc-input"></textarea>
            <button type="submit" class="nc-btn-primary nc-btn-block">ارسال پیام</button>
          </form>
        </div>
      </div>
    </div>
    <script>
      document.getElementById('contact-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const btn = e.target.querySelector('button[type=submit]');
        btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>';
        try {
          await axios.post('/api/messages', Object.fromEntries(fd.entries()));
          toast('پیام شما ارسال شد', 'success');
          e.target.reset();
        } catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); }
        finally { btn.disabled = false; btn.innerHTML = orig; }
      });
    </script>
  `;
    return siteLayout({ title: 'تماس با ما', currentPath: '/contact' }, content);
}
// ===== 404 / Error =====
export function notFoundPage(label = 'صفحه', code = 404) {
    const isServerError = code === 500;
    const title = isServerError ? 'خطای داخلی سرور' : `${label} مورد نظر یافت نشد`;
    const subtitle = isServerError
        ? 'متأسفانه هنگام پردازش درخواست شما خطایی رخ داد. لطفاً چند لحظه دیگر دوباره تلاش کنید.'
        : 'آدرس وارد شده اشتباه است یا این محتوا حذف شده است.';
    const icon = isServerError ? 'fa-triangle-exclamation' : 'fa-compass';
    const content = `
    <section class="nc-error-page${isServerError ? ' is-error' : ''}" role="alert" aria-live="assertive">
      <div class="nc-error-icon">
        <i class="fas ${icon}" aria-hidden="true"></i>
      </div>
      <div class="nc-error-code" aria-hidden="true">${code}</div>
      <h1 class="nc-error-title">${title}</h1>
      <p class="nc-error-sub">${subtitle}</p>
      <div class="nc-error-actions">
        <a href="/" class="nc-btn-primary">
          <i class="fas fa-home ml-2" aria-hidden="true"></i>بازگشت به خانه
        </a>
        <a href="/products" class="nc-btn-outline">
          <i class="fas fa-box ml-2" aria-hidden="true"></i>مشاهده محصولات
        </a>
        <a href="/contact" class="nc-btn-outline">
          <i class="fas fa-headset ml-2" aria-hidden="true"></i>تماس با پشتیبانی
        </a>
      </div>
      ${!isServerError ? `
      <div class="nc-error-search">
        <h2 class="nc-error-search-title">جستجو در سایت</h2>
        <form action="/products" method="get" class="nc-error-search-form">
          <label for="error-search" class="sr-only">جستجو</label>
          <input id="error-search" type="search" name="q" placeholder="نام محصول مورد نظر را وارد کنید…"
                 class="nc-input" aria-label="جستجو در محصولات">
          <button type="submit" class="nc-btn-primary" aria-label="جستجو">
            <i class="fas fa-search" aria-hidden="true"></i>
          </button>
        </form>
      </div>` : ''}
    </section>
  `;
    return siteLayout({ title: title, currentPath: '/' }, content);
}
