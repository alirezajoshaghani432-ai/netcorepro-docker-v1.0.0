import bcrypt from 'bcryptjs';
import db from './index.js';
// ===== SAFETY GUARD: never wipe an existing database by accident =====
// The container runs `node dist/db/seed.js || true` at every boot; if real
// data already exists we must NOT reseed. Pass --force to reseed explicitly.
const FORCE = process.argv.includes('--force');
try {
    const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get();
    if (existing && existing.c > 0 && !FORCE) {
        console.log(`ℹ️ Database already has data (${existing.c} users) — skipping seed. Use --force to reseed.`);
        process.exit(0);
    }
}
catch (e) { /* tables may not exist yet — proceed with seeding */ }
console.log('🌱 Seeding NetCore Pro database...');
const DBT = (process.env.DB_TYPE || 'mssql').toLowerCase();
const IS_MYSQL = DBT === 'mysql';
const IS_MSSQL = DBT === 'mssql';
// Reset autoincrement counters BEFORE the transaction (FKs are off only during clear)
if (IS_MYSQL) {
    db.exec('SET FOREIGN_KEY_CHECKS = 0');
}
else if (IS_MSSQL) {
    db.exec("EXEC sp_msforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL'");
}
else {
    db.pragma('foreign_keys = OFF');
}
db.exec(`
  DELETE FROM activity_logs;
  DELETE FROM ticket_replies;
  DELETE FROM tickets;
  DELETE FROM order_items;
  DELETE FROM orders;
  DELETE FROM comments;
  DELETE FROM posts;
  DELETE FROM messages;
  DELETE FROM newsletter_subscribers;
  DELETE FROM products;
  DELETE FROM brands;
  DELETE FROM categories;
  DELETE FROM users;
  DELETE FROM settings;
  DELETE FROM site_blocks;
  DELETE FROM site_pages;
`);
if (IS_MYSQL) {
    for (const t of ['activity_logs', 'ticket_replies', 'tickets', 'order_items', 'orders', 'comments', 'posts', 'messages', 'newsletter_subscribers', 'products', 'brands', 'categories', 'users', 'site_blocks', 'site_pages']) {
        try { db.exec(`ALTER TABLE ${t} AUTO_INCREMENT = 1`); } catch (e) { /* ignore */ }
    }
    db.exec('SET FOREIGN_KEY_CHECKS = 1');
}
else if (IS_MSSQL) {
    for (const t of ['activity_logs', 'ticket_replies', 'tickets', 'order_items', 'orders', 'comments', 'posts', 'messages', 'newsletter_subscribers', 'products', 'brands', 'categories', 'users', 'site_blocks', 'site_pages']) {
        try { db.exec(`DBCC CHECKIDENT ('${t}', RESEED, 0)`); } catch (e) { /* ignore */ }
    }
    try { db.exec("EXEC sp_msforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL'"); } catch (e) { /* ignore */ }
}
else {
    try { db.exec('DELETE FROM sqlite_sequence'); } catch (e) { /* ignore */ }
    db.pragma('foreign_keys = ON');
}
const tx = db.transaction(() => {
    // Users
    const adminPass = bcrypt.hashSync('admin123', 10);
    const customerPass = bcrypt.hashSync('123456', 10);
    db.prepare(`INSERT INTO users (email, password, full_name, phone, role, company, address, city)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('admin@netcorepro.ir', adminPass, 'مدیر سیستم', '025-37165', 'admin', 'NetCore Pro', 'قم، خیابان آذر', 'قم');
    db.prepare(`INSERT INTO users (email, password, full_name, phone, role, company, address, city)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('customer@example.com', customerPass, 'مشتری نمونه', '09121234567', 'customer', 'شرکت تست', 'تهران، خیابان آزادی', 'تهران');
    // Categories — matching the storefront catalog
    const cats = [
        { name: 'متعلقات رک', slug: 'rack-accessories', icon: 'fa-screwdriver-wrench', desc: 'پیچ، فن، پنل و متعلقات رک', img: '/static/images/cat-rack-accessories.jpg' },
        { name: 'سوییچ شبکه', slug: 'switches', icon: 'fa-network-wired', desc: 'سوییچ‌های مدیریتی و غیرمدیریتی', img: '/static/images/cat-switches.jpg' },
        { name: 'رک های آماد سیستم', slug: 'amad-racks', icon: 'fa-server', desc: 'رک‌های آماد سیستم', img: '/static/images/cat-amad-racks.jpg' },
        { name: 'رک دیواری آماد سیستم', slug: 'wall-racks', icon: 'fa-box-archive', desc: 'رک‌های دیواری', img: '/static/images/cat-wall-racks.jpg' },
        { name: 'رک ایستاده آماد سیستم', slug: 'standing-racks', icon: 'fa-warehouse', desc: 'رک‌های ایستاده', img: '/static/images/cat-standing-racks.jpg' },
        { name: 'تجهیزات پسیو', slug: 'passive', icon: 'fa-ethernet', desc: 'کابل، پچ پنل و کیستون', img: '/static/images/cat-passive.jpg' },
        { name: 'ای باکس', slug: 'ebox', icon: 'fa-box', desc: 'باکس و جعبه تقسیم', img: '/static/images/cat-ebox.jpg' },
        { name: 'آداپتور', slug: 'adapters', icon: 'fa-plug', desc: 'آداپتورهای برق', img: '/static/images/cat-adapters.jpg' },
        { name: 'روتر و مودم', slug: 'routers', icon: 'fa-wifi', desc: 'روتر و مودم بی‌سیم', img: '/static/images/cat-routers.jpg' }
    ];
    const insertCat = db.prepare(`INSERT INTO categories (name, slug, icon, description, sort_order, image) VALUES (?, ?, ?, ?, ?, ?)`);
    cats.forEach((c, i) => insertCat.run(c.name, c.slug, c.icon, c.desc, i, c.img || null));
    // Brands — from the storefront
    const brands = [
        { name: 'Legrand', slug: 'legrand' },
        { name: 'Mercusys', slug: 'mercusys' },
        { name: 'neterbit', slug: 'neterbit' },
        { name: 'TP-Link', slug: 'tp-link' },
        { name: 'D-Link', slug: 'd-link' },
        { name: 'Tenda', slug: 'tenda' },
        { name: 'VTOOLS', slug: 'vtools' },
        { name: 'لکسوس', slug: 'lexus' },
        { name: 'آماد سیستم', slug: 'amad-system' }
    ];
    const insertBrand = db.prepare(`INSERT INTO brands (name, slug) VALUES (?, ?)`);
    brands.forEach(b => insertBrand.run(b.name, b.slug));
    // Products — toman prices, fa numerals shown via formatPrice. views = sold count.
    // cat/brand are 1-based ids matching arrays above.
    const products = [
        // ----- Special offers (پیشنهاد لحظه‌ای) -----
        { name: 'مودم روتر 4G LTE بی‌سیم دی لینک مدل DWR-M921', slug: 'dlink-dwr-m921', sku: 'DL-M921', cat: 9, brand: 5, price: 5300000, dprice: 4550000, stock: 9, sold: 1, image: '/static/images/prod-router-a.jpg', short: 'مودم روتر 4G LTE بی‌سیم با پشتیبانی سیم‌کارت', desc: 'مودم روتر 4G LTE دی‌لینک با امکان اتصال مستقیم سیم‌کارت و پوشش وای‌فای مناسب منزل و دفتر کار.', featured: 1 },
        { name: 'نوار چسب برق VTOOLS', slug: 'vtools-tape', sku: 'VT-TAPE', cat: 1, brand: 7, price: 65000, dprice: 62000, stock: 300, sold: 200, image: '/static/images/prod-tape.jpg', short: 'نوار چسب برق PVC عایق دار', desc: 'نوار چسب برق PVC با کیفیت بالا، عایق مطمئن برای اتصالات برق و شبکه.', featured: 1 },
        { name: 'پچ پنل 24 پورت لگراند Cat6 UTP وارداتی', slug: 'legrand-patch-24', sku: 'LG-PP24', cat: 6, brand: 1, price: 5250000, dprice: 5250000, stock: 12, sold: 5, image: '/static/images/prod-patchpanel-a.jpg', short: 'پچ پنل 24 پورت Cat6 UTP رک مونت', desc: 'پچ پنل 24 پورت لگراند Cat6 وارداتی مناسب رک‌های 19 اینچ.', featured: 1 },
        { name: 'سوییچ شبکه 8 پورت تی پی لینک مدل LS-1008', slug: 'tplink-ls1008', sku: 'TP-LS1008', cat: 2, brand: 4, price: 1600000, dprice: 1500000, stock: 15, sold: 10, image: '/static/images/prod-switch8.jpg', short: 'سوییچ غیرمدیریتی 8 پورت ده/صد', desc: 'سوییچ 8 پورت تی‌پی‌لینک LS-1008 مناسب شبکه‌های کوچک و خانگی.', featured: 1 },
        { name: 'آداپتور 12 ولت 2 آمپر لکسوس', slug: 'lexus-adapter-12-2', sku: 'LX-12-2', cat: 8, brand: 8, price: 450000, dprice: 420000, stock: 100, sold: 65, image: '/static/images/prod-adapter-a.jpg', short: 'آداپتور 12 ولت 2 آمپر', desc: 'آداپتور 12 ولت 2 آمپر لکسوس مناسب دوربین مداربسته و تجهیزات شبکه.', featured: 1 },
        { name: 'مودم روتر 4G LTE نتربیت مدل NW-431F', slug: 'neterbit-nw431f', sku: 'NB-431F', cat: 9, brand: 3, price: 6800000, dprice: 6300000, stock: 15, sold: 6, image: '/static/images/prod-router-b.jpg', short: 'مودم روتر 4G LTE نتربیت', desc: 'مودم روتر 4G LTE نتربیت با آنتن قوی و پوشش بالا.', featured: 1 },
        // ----- Weekly best (برترین انتخاب‌های هفته) -----
        { name: 'رک دیواری 4 یونیت عمق 45 آماد سیستم', slug: 'amad-wall-4u', sku: 'AM-W4U', cat: 4, brand: 9, price: 6200000, dprice: 5890000, stock: 20, sold: 14, image: '/static/images/prod-rack.jpg', short: 'رک دیواری 4 یونیت عمق 45', desc: 'رک دیواری 4 یونیت آماد سیستم با درب شیشه‌ای و کیفیت ساخت بالا.', featured: 0 },
        { name: 'سوییچ 5 پورت مرکوسیس مدل MS105', slug: 'mercusys-ms105', sku: 'MC-105', cat: 2, brand: 2, price: 1500000, dprice: 1365000, stock: 30, sold: 18, image: '/static/images/prod-switch5-a.jpg', short: 'سوییچ غیرمدیریتی 5 پورت', desc: 'سوییچ 5 پورت مرکوسیس MS105 مناسب شبکه‌های خانگی.', featured: 0 },
        { name: 'آداپتور 12 ولت 5 آمپر دلتا', slug: 'delta-adapter-12-5', sku: 'DT-12-5', cat: 8, brand: 8, price: 620000, dprice: 620000, stock: 50, sold: 33, image: '/static/images/prod-adapter.jpg', short: 'آداپتور 12 ولت 5 آمپر', desc: 'آداپتور 12 ولت 5 آمپر دلتا با کیفیت بالا.', featured: 0 },
        { name: 'سوییچ 5 پورت مرکوسیس مدل MS105G', slug: 'mercusys-ms105g', sku: 'MC-105G', cat: 2, brand: 2, price: 3000000, dprice: 3000000, stock: 25, sold: 12, image: '/static/images/prod-switch5-b.jpg', short: 'سوییچ گیگابیت 5 پورت', desc: 'سوییچ گیگابیت 5 پورت مرکوسیس MS105G.', featured: 0 },
        { name: 'سوییچ 5 پورت نتربیت مدل NES-1005C', slug: 'neterbit-nes1005c', sku: 'NB-1005C', cat: 2, brand: 3, price: 1300000, dprice: 1209000, stock: 40, sold: 22, image: '/static/images/prod-switch5-c.jpg', short: 'سوییچ غیرمدیریتی 5 پورت', desc: 'سوییچ 5 پورت نتربیت NES-1005C.', featured: 0 },
        // ----- Best sellers (پرفروش‌ترین محصولات) -----
        { name: 'مودم روتر بی‌سیم دی لینک مدل /891', slug: 'dlink-891', sku: 'DL-891', cat: 9, brand: 5, price: 5000000, dprice: 5000000, stock: 0, sold: 80, image: '/static/images/prod-router-c.jpg', short: 'مودم روتر بی‌سیم دی لینک', desc: 'مودم روتر بی‌سیم دی‌لینک.', featured: 0 },
        { name: 'پچ پنل 24 پورت لگراند Cat6 UTP وارداتی', slug: 'legrand-patch-24b', sku: 'LG-PP24B', cat: 6, brand: 1, price: 5200000, dprice: 5200000, stock: 10, sold: 60, image: '/static/images/prod-patchpanel.jpg', short: 'پچ پنل 24 پورت Cat6 UTP', desc: 'پچ پنل 24 پورت لگراند Cat6 وارداتی.', featured: 0 },
        { name: 'کابل شبکه Cat6 UTP تمام مس لگراند مغزی 0.40', slug: 'legrand-cat6-cable', sku: 'LG-C6-040', cat: 6, brand: 1, price: 16775000, dprice: 16775000, stock: 25, sold: 120, image: '/static/images/prod-cat6.jpg', short: 'کابل شبکه Cat6 UTP تمام مس', desc: 'کابل شبکه Cat6 UTP تمام مس لگراند با مغزی 0.40 و کیفیت عالی.', featured: 0 },
        { name: 'روتر تندا N300 مدل N301', slug: 'tenda-n301', sku: 'TD-N301', cat: 9, brand: 6, price: 2950000, dprice: 2950000, stock: 18, sold: 95, image: '/static/images/prod-router4g.jpg', short: 'روتر بی‌سیم N300', desc: 'روتر بی‌سیم تندا N301 با پوشش مناسب.', featured: 0 },
        { name: 'سوییچ 5 پورت نتربیت مدل NES-1005C', slug: 'neterbit-nes1005c-b', sku: 'NB-1005C-B', cat: 2, brand: 3, price: 1209000, dprice: 1209000, stock: 40, sold: 70, image: '/static/images/prod-switch5.jpg', short: 'سوییچ 5 پورت', desc: 'سوییچ 5 پورت نتربیت.', featured: 0 },
        { name: 'سوییچ شبکه 8 پورت تی پی لینک مدل LS-1008', slug: 'tplink-ls1008-b', sku: 'TP-LS1008-B', cat: 2, brand: 4, price: 1500000, dprice: 1500000, stock: 15, sold: 88, image: '/static/images/prod-switch8-b.jpg', short: 'سوییچ 8 پورت', desc: 'سوییچ 8 پورت تی‌پی‌لینک LS-1008.', featured: 0 },
        // ----- Most discount (بیشترین تخفیف) — CamBox -----
        { name: 'باکس تقسیم گرد CamBox مدل 8x8', slug: 'cambox-round-8', sku: 'CB-R8', cat: 7, brand: 9, price: 180000, dprice: 117000, stock: 200, sold: 40, image: '/static/images/prod-cambox-round8.jpg', short: 'باکس تقسیم گرد ضدآب', desc: 'باکس تقسیم گرد CamBox ضدآب مناسب دوربین مداربسته.', featured: 0 },
        { name: 'باکس تقسیم CamBox پلاس مدل 14x14', slug: 'cambox-plus-14', sku: 'CB-P14', cat: 7, brand: 9, price: 320000, dprice: 208000, stock: 150, sold: 35, image: '/static/images/prod-cambox-plus14.jpg', short: 'باکس تقسیم بزرگ ضدآب', desc: 'باکس تقسیم CamBox پلاس 14x14 ضدآب.', featured: 0 },
        { name: 'باکس تقسیم CamBox مدل 12x12', slug: 'cambox-12', sku: 'CB-12', cat: 7, brand: 9, price: 260000, dprice: 169000, stock: 180, sold: 28, image: '/static/images/prod-cambox-12.jpg', short: 'باکس تقسیم متوسط', desc: 'باکس تقسیم CamBox 12x12 ضدآب.', featured: 0 },
        { name: 'باکس تقسیم CamBox مدل 10x10', slug: 'cambox-10', sku: 'CB-10', cat: 7, brand: 9, price: 220000, dprice: 143000, stock: 220, sold: 50, image: '/static/images/prod-cambox-10.jpg', short: 'باکس تقسیم کوچک', desc: 'باکس تقسیم CamBox 10x10 ضدآب.', featured: 0 },
        { name: 'باکس تقسیم CamBox شش‌ضلعی مدل 14x14', slug: 'cambox-hex-14', sku: 'CB-H14', cat: 7, brand: 9, price: 340000, dprice: 221000, stock: 120, sold: 19, image: '/static/images/prod-cambox-hex14.jpg', short: 'باکس تقسیم شش‌ضلعی', desc: 'باکس تقسیم CamBox شش‌ضلعی 14x14.', featured: 0 },
        { name: 'باکس تقسیم CamBox مدل 16x16', slug: 'cambox-16', sku: 'CB-16', cat: 7, brand: 9, price: 380000, dprice: 247000, stock: 90, sold: 15, image: '/static/images/prod-cambox-16.jpg', short: 'باکس تقسیم بزرگ', desc: 'باکس تقسیم CamBox 16x16 ضدآب.', featured: 0 }
    ];
    const insertProduct = db.prepare(`INSERT INTO products (name, slug, sku, category_id, brand_id, price, discount_price, stock, views, image, short_description, description, featured, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`);
    products.forEach(p => insertProduct.run(p.name, p.slug, p.sku, p.cat, p.brand, p.price, p.dprice, p.stock, p.sold || 0, p.image, p.short, p.desc, p.featured));
    // Posts
    const posts = [
        { title: 'راهنمای انتخاب ماژول SFP مناسب برای شبکه فیبر نوری', slug: 'sfp-module-guide', excerpt: 'تفاوت ماژول‌های سینگل‌مود و مالتی‌مود، برد و طول موج را بشناسید.', content: '<p>ماژول‌های SFP نقش مهمی در شبکه‌های فیبر نوری دارند. در این مقاله تفاوت سینگل‌مود و مالتی‌مود و نکات انتخاب را بررسی می‌کنیم.</p><h3>سینگل‌مود یا مالتی‌مود؟</h3><p>برای مسافت‌های طولانی از سینگل‌مود و برای مسافت‌های کوتاه از مالتی‌مود استفاده می‌شود.</p>', cover: '/static/images/blog1.svg', cat: 'فیبر نوری' },
        { title: 'تفاوت WiFi 5 و WiFi 6 در شبکه‌های سازمانی', slug: 'wifi5-vs-wifi6', excerpt: 'چرا باید به WiFi 6 ارتقا دهید؟ مزایا و سناریوهای کاربردی.', content: '<p>استاندارد WiFi 6 با ظرفیت بالاتر، تأخیر کمتر و پوشش بهتر طراحی شده است.</p>', cover: '/static/images/blog2.svg', cat: 'وایرلس' },
        { title: 'فایروال نسل جدید (NGFW) چیست و چه تفاوتی دارد؟', slug: 'ngfw-introduction', excerpt: 'قابلیت‌های IPS، کنترل اپلیکیشن و SSL Inspection را بشناسید.', content: '<p>فایروال‌های NGFW علاوه بر فیلترینگ معمولی، قابلیت‌های IPS، Application Control و SSL Inspection را دارند.</p>', cover: '/static/images/blog3.svg', cat: 'امنیت شبکه' }
    ];
    const insertPost = db.prepare(`INSERT INTO posts (title, slug, excerpt, content, cover_image, author_id, category, status) VALUES (?, ?, ?, ?, ?, 1, ?, 'published')`);
    posts.forEach(p => insertPost.run(p.title, p.slug, p.excerpt, p.content, p.cover, p.cat));
    // Settings
    const settings = [
        { k: 'site_name', v: 'NetCore Pro' },
        { k: 'site_tagline', v: 'تجهیزات شبکه حرفه‌ای' },
        { k: 'site_title', v: 'NetCore Pro - فروشگاه تخصصی تجهیزات شبکه' },
        { k: 'site_description', v: 'فروشگاه آنلاین تخصصی تجهیزات شبکه، فیبر نوری و برقی شامل سوییچ، روتر، رک، کابل و باکس' },
        { k: 'phone', v: '۰۲۵-۳۷۱۶۵' },
        { k: 'mobile', v: '۰۹۱۲-۳۴۵-۶۷۸۹' },
        { k: 'email', v: 'info@netcorepro.ir' },
        { k: 'address', v: 'قم، خیابان آذر، طالقانی، پاساژ سعدی، طبقه همکف، پلاک ۲۸' },
        { k: 'shipping_cost', v: '500000' },
        { k: 'currency', v: 'تومان' },
        { k: 'footer_about', v: 'NetCore Pro مرجع تخصصی فروش تجهیزات شبکه، فیبر نوری و برقی برای کسب‌وکارها و سازمان‌ها. ما تامین تجهیزات اصلی با گارانتی معتبر را تضمین می‌کنیم.' },
        { k: 'og_image', v: '/static/images/og-default.svg' },
        { k: 'instagram', v: 'https://instagram.com/netcorepro' },
        { k: 'telegram', v: 'https://t.me/netcorepro' },
        { k: 'whatsapp', v: '+989121234567' }
    ];
    const insertSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`);
    settings.forEach(s => insertSetting.run(s.k, s.v));
    // ----- Site content blocks (was hardcoded in views) -----
    const insertBlock = db.prepare(`INSERT INTO site_blocks (page, section, icon, image, title, description, href, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`);
    // Home → hero slider (editable from admin: icon = CTA label, image = slide image, description = subtitle)
    [
        { img: '/static/images/hero-1-datacenter.jpg', title: 'تجهیزات شبکه لگراند',    sub: 'اورجینال با گارانتی اصالت کالا',        cta: 'مشاهده محصولات', href: '/products' },
        { img: '/static/images/hero-3-rack.jpg', title: 'رک و متعلقات آماد سیستم', sub: 'رک ایستاده و دیواری با بهترین قیمت',     cta: 'خرید رک',        href: '/products?category=amad-racks' },
        { img: '/static/images/hero-2-cabling.jpg', title: 'سوییچ و روتر شبکه',       sub: 'برندهای معتبر، ارسال سریع',            cta: 'مشاهده',         href: '/products?category=switches' }
    ].forEach((s, i) => insertBlock.run('home', 'hero', s.cta, s.img, s.title, s.sub, s.href, i));
    // Home → side banners (next to hero) — icon = FontAwesome class, image = optional bg, title = main label, description = small label
    [
        { icon: 'fa-ethernet', title: 'کابل و پسیو',  sub: 'Cat6 تمام مس',  href: '/products?category=passive', img: '/static/images/banner-side-1-cable.jpg' },
        { icon: 'fa-box',      title: 'باکس CamBox',  sub: 'تا ۳۵٪ تخفیف',  href: '/products?category=ebox',    img: '/static/images/banner-side-2-ebox.jpg' }
    ].forEach((s, i) => insertBlock.run('home', 'side_banner', s.icon, s.img || null, s.title, s.sub, s.href, i));
    // Home → mid banners (between product rows) — icon = CTA label, image = optional bg
    [
        { cta: 'خرید', title: 'رک ایستاده',  sub: 'مناسب دیتاسنتر',   href: '/products?category=standing-racks', img: '/static/images/banner-mid-1-rack.jpg' },
        { cta: 'خرید', title: 'مودم و روتر', sub: '4G LTE و بی‌سیم',  href: '/products?category=routers',        img: '/static/images/banner-mid-2-router.jpg' }
    ].forEach((s, i) => insertBlock.run('home', 'mid_banner', s.cta, s.img || null, s.title, s.sub, s.href, i));
    // Home → features
    [
        { icon: 'fa-shipping-fast', title: 'ارسال سریع',     desc: 'ارسال به سراسر کشور در کمترین زمان' },
        { icon: 'fa-shield-halved', title: 'گارانتی اصالت',  desc: 'تضمین اصالت کالا از برندهای مطرح' },
        { icon: 'fa-headset',       title: 'پشتیبانی فنی',   desc: 'مشاوره تخصصی رایگان قبل و بعد از خرید' },
        { icon: 'fa-credit-card',   title: 'پرداخت امن',     desc: 'درگاه‌های پرداخت معتبر و رمزنگاری شده' }
    ].forEach((f, i) => insertBlock.run('home', 'features', f.icon, null, f.title, f.desc, null, i));
    // About → why us list
    [
        { icon: 'fa-check', title: 'تضمین اصالت کالا', desc: '' },
        { icon: 'fa-check', title: 'گارانتی معتبر و خدمات پس از فروش', desc: '' },
        { icon: 'fa-check', title: 'مشاوره فنی رایگان', desc: '' },
        { icon: 'fa-check', title: 'ارسال سریع به سراسر کشور', desc: '' },
        { icon: 'fa-check', title: 'قیمت‌گذاری شفاف و رقابتی', desc: '' }
    ].forEach((f, i) => insertBlock.run('about', 'why_us', f.icon, null, f.title, f.desc, null, i));
    // Footer → quick links
    [
        { title: 'محصولات',         href: '/products' },
        { title: 'دسته‌بندی‌ها',   href: '/categories' },
        { title: 'مقالات',           href: '/blog' },
        { title: 'درباره ما',       href: '/about' },
        { title: 'تماس با ما',       href: '/contact' }
    ].forEach((f, i) => insertBlock.run('footer', 'quick_links', null, null, f.title, null, f.href, i));

    // ----- Site page sections (rich content) -----
    const insertPage = db.prepare(`INSERT INTO site_pages (page, section, title, subtitle, body, is_active) VALUES (?, ?, ?, ?, ?, 1)`);
    insertPage.run('home', 'hero',
        'راهکار <span class="gradient-text">تجهیزات شبکه</span><br>برای کسب‌وکار شما',
        'از سوییچ و روتر تا فایروال و اکسس‌پوینت، تمام نیازهای زیرساختی شبکه شما در یک‌جا.',
        null);
    insertPage.run('about', 'intro',
        'درباره NetCore Pro',
        'فروشگاه تخصصی B2B تجهیزات شبکه',
        '<p>NetCore Pro یک فروشگاه آنلاین تخصصی B2B در زمینه تجهیزات شبکه است که هدف آن ارائه راهکارهای زیرساختی شبکه برای سازمان‌ها، کسب‌وکارها و متخصصان IT می‌باشد.</p>');
    insertPage.run('about', 'mission',
        'ماموریت ما',
        null,
        '<p>عرضه تجهیزات اصلی و گارانتی‌دار از برندهای مطرح جهان نظیر Cisco، Mikrotik، HP، Juniper، Fortinet و Ubiquiti همراه با مشاوره فنی تخصصی.</p>');
    insertPage.run('privacy', 'body',
        'حریم خصوصی کاربران',
        'سیاست رازداری NetCore Pro',
        '<h3>اطلاعات جمع‌آوری شده</h3><p>ما تنها اطلاعات لازم برای ارائه خدمات (نام، ایمیل، شماره تماس، آدرس ارسال) را دریافت می‌کنیم.</p><h3>محرمانگی</h3><p>اطلاعات کاربران به هیچ شخص ثالثی فروخته نمی‌شود و فقط برای پردازش سفارش‌ها و ارتباط با شما استفاده می‌گردد.</p>');
    insertPage.run('terms', 'body',
        'شرایط و قوانین استفاده',
        null,
        '<h3>پذیرش قوانین</h3><p>با استفاده از این وب‌سایت، شما تمام قوانین زیر را پذیرفته‌اید.</p><h3>ثبت سفارش</h3><p>سفارشات پس از تایید موجودی توسط واحد فروش پردازش می‌شوند.</p><h3>گارانتی</h3><p>کلیه محصولات دارای گارانتی شرکتی هستند.</p>');

    // Sample comments
    db.prepare(`INSERT INTO comments (post_id, author_name, author_email, content, status) VALUES (1, 'علی محمدی', 'ali@example.com', 'مقاله بسیار مفیدی بود، تشکر.', 'approved')`).run();
    db.prepare(`INSERT INTO comments (post_id, author_name, author_email, content, status) VALUES (1, 'رضا احمدی', 'reza@example.com', 'لطفا درباره سوییچ‌های لایه 3 هم بنویسید.', 'pending')`).run();
    // Sample order
    const orderRes = db.prepare(`INSERT INTO orders (order_number, user_id, customer_name, customer_phone, customer_email, shipping_address, shipping_city, subtotal, shipping_cost, total, status) VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).run('NCP-' + Date.now().toString().slice(-8), 'مشتری نمونه', '09121234567', 'customer@example.com', 'تهران، خیابان آزادی', 'تهران', 18500000, 500000, 19000000);
    db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, product_sku, unit_price, quantity, total) VALUES (?, 2, ?, ?, ?, 1, ?)`).run(orderRes.lastInsertRowid, 'روتر میکروتیک RB4011iGS+RM', 'MKT-RB4011', 18500000, 18500000);
    // Sample ticket
    db.prepare(`INSERT INTO tickets (ticket_number, user_id, subject, message, status) VALUES (?, 2, ?, ?, 'open')`).run('TKT-' + Date.now().toString().slice(-6), 'سوال درباره گارانتی محصولات', 'سلام، گارانتی روتر میکروتیک چقدره؟');
    // Sample message
    db.prepare(`INSERT INTO messages (name, email, phone, subject, body) VALUES (?, ?, ?, ?, ?)`).run('حسین رضایی', 'hossein@test.com', '09131111111', 'درخواست همکاری', 'علاقه‌مند به همکاری با شرکت شما هستم.');
    // Newsletter
    db.prepare(`INSERT INTO newsletter_subscribers (email) VALUES (?)`).run('subscriber@example.com');
});
tx();
console.log('✅ Database seeded successfully!');
console.log('   Admin: admin@netcorepro.ir / admin123');
console.log('   Customer: customer@example.com / 123456');
process.exit(0);
