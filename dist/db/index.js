import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
// =====================================================================
//  Driver selection: MySQL/MariaDB (production default) or SQLite (dev)
//  DB_TYPE=mysql  -> synchronous mysql2 bridge (dist/db/mysql-sync.js)
//  DB_TYPE=sqlite -> better-sqlite3 (legacy / local development)
// =====================================================================
const SELECTED_DB = (process.env.DB_TYPE || 'mysql').toLowerCase();
let _db;
if (SELECTED_DB === 'mysql') {
    const { createMysqlSyncDb } = await import('./mysql-sync.js');
    _db = createMysqlSyncDb();
    // Initialize MySQL schema (idempotent: CREATE TABLE IF NOT EXISTS; index
    // creation errors on re-run are swallowed one-by-one)
    const mysqlSchema = readFileSync(join(__dirname, 'schema.mysql.sql'), 'utf-8');
    for (const stmt of mysqlSchema.split(';')) {
        const s = stmt.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').trim();
        if (!s)
            continue;
        try {
            _db.exec(s);
        }
        catch (e) {
            if (!/Duplicate key name|already exists|Duplicate entry/i.test(e.message))
                console.error('[db] mysql schema stmt error:', e.message.slice(0, 160));
        }
    }
}
else {
    const { default: Database } = await import('better-sqlite3');
    const dbPath = process.env.DB_PATH || join(__dirname, '../../data/netcorepro.db');
    _db = new Database(dbPath);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    _db.exec(schema);
}
export const db = _db;
// ===== Lightweight migrations: add columns that may be missing on older DBs =====
function ensureColumn(table, column, definition) {
    try {
        const cols = SELECTED_DB === 'mysql'
            ? db.prepare(`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`).all(table)
            : db.prepare(`PRAGMA table_info(${table})`).all();
        if (!cols.some((c) => c.name === column)) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
            console.log(`[db] migrated: added ${table}.${column}`);
        }
    }
    catch (e) {
        console.error(`[db] migration error (${table}.${column}):`, e.message);
    }
}
ensureColumn('categories', 'image', 'TEXT');
ensureColumn('brands', 'logo', 'TEXT');
ensureColumn('site_blocks', 'image', 'TEXT');
// ===== Phase 9: SEO + manual product ordering =====
ensureColumn('products', 'seo_title', 'TEXT');
ensureColumn('products', 'seo_description', 'TEXT');
ensureColumn('products', 'seo_keywords', 'TEXT');
ensureColumn('products', 'sort_order', 'INTEGER DEFAULT 0');
// Key features (bullet list shown under product title) — JSON array of strings
ensureColumn('products', 'key_features', 'TEXT');
// Guarantee type/name shown on the product page buy box (customer voice request)
ensureColumn('products', 'guarantee', 'TEXT');
ensureColumn('categories', 'seo_title', 'TEXT');
ensureColumn('categories', 'seo_description', 'TEXT');
ensureColumn('categories', 'seo_keywords', 'TEXT');
ensureColumn('posts', 'seo_title', 'TEXT');
ensureColumn('posts', 'seo_description', 'TEXT');
ensureColumn('posts', 'seo_keywords', 'TEXT');
ensureColumn('site_pages', 'seo_title', 'TEXT');
ensureColumn('site_pages', 'seo_description', 'TEXT');
ensureColumn('site_pages', 'seo_keywords', 'TEXT');
// Product comments support (comments table originally only had post_id)
ensureColumn('comments', 'product_id', 'INTEGER');
// Hides a category from the header mega-menu without deleting it. Deletion is
// blocked while products are attached, so visibility is the correct switch.
ensureColumn('categories', 'show_in_menu', 'INTEGER DEFAULT 1');
// ===== Schema additions =====
// Accounts created by the OTP flow never chose a password (a random hash is
// stored so the row is valid). `password_set = 0` marks them, which lets the
// account panel show «تعیین رمز عبور» instead of a «تغییر رمز عبور» form the
// customer can never complete.
ensureColumn('users', 'password_set', 'INTEGER DEFAULT 1');
// F8: card-to-card payments need a place to record what the customer sent.
ensureColumn('orders', 'payment_ref', 'TEXT');
ensureColumn('orders', 'payment_note', 'TEXT');
ensureColumn('orders', 'payment_status', "TEXT DEFAULT 'pending'");
ensureColumn('orders', 'paid_at', 'TEXT');
// Back-fill: rows created by OTP auto-registration used a placeholder e-mail.
try {
    db.prepare(`UPDATE users SET password_set = 0
                WHERE password_set IS NULL OR (password_set = 1 AND email LIKE '%@phone.netcorepro.ir')`).run();
}
catch (e) { console.error('[db] password_set backfill error:', e.message); }
// Helpful indexes for sorting/filtering (idempotent)
try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_products_sort ON products(category_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id, sort_order);`);
}
catch (e) { console.error('[db] index migration error:', e.message); }

// ===== Data migration: seed default editable banners on older DBs =====
// If a section has no rows yet (DB seeded before these blocks existed), insert sensible defaults
// so the home page side/mid banners become editable from the admin dashboard without a full re-seed.
function ensureBlockSection(page, section, rows) {
    try {
        const tbl = SELECTED_DB === 'mysql'
            ? db.prepare(`SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'site_blocks'`).get()
            : db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='site_blocks'`).get();
        if (!tbl)
            return; // table not created yet (fresh DB before schema); seed.js will handle it
        const count = db.prepare(`SELECT COUNT(*) AS c FROM site_blocks WHERE page = ? AND section = ?`).get(page, section);
        if (count && count.c > 0)
            return; // already present, don't duplicate
        const insertBlock = db.prepare(`INSERT INTO site_blocks (page, section, icon, image, title, description, href, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`);
        rows.forEach((r, i) => insertBlock.run(page, section, r.icon ?? null, r.image ?? null, r.title ?? null, r.description ?? null, r.href ?? null, i));
        console.log(`[db] migrated: seeded default ${page}/${section} blocks (${rows.length})`);
    }
    catch (e) {
        console.error(`[db] block-seed migration error (${page}/${section}):`, e.message);
    }
}
ensureBlockSection('home', 'side_banner', [
    { icon: 'fa-ethernet', title: 'کابل و پسیو', description: 'Cat6 تمام مس', href: '/products?category=passive', image: '/static/images/banner-side-1-cable.jpg' },
    { icon: 'fa-box', title: 'باکس CamBox', description: 'تا ۳۵٪ تخفیف', href: '/products?category=ebox', image: '/static/images/banner-side-2-ebox.jpg' },
]);
ensureBlockSection('home', 'mid_banner', [
    { icon: 'خرید', title: 'رک ایستاده', description: 'مناسب دیتاسنتر', href: '/products?category=standing-racks', image: '/static/images/banner-mid-1-rack.jpg' },
    { icon: 'خرید', title: 'مودم و روتر', description: '4G LTE و بی‌سیم', href: '/products?category=routers', image: '/static/images/banner-mid-2-router.jpg' },
]);

// ===== Data migration: backfill images for home-page sections on older DBs =====
// Idempotent: only fills rows that currently have no image (or the old duplicated hero image),
// so manual admin edits are never overwritten.
function ensureImagesByMatch(sql, rows) {
    try {
        const stmt = db.prepare(sql);
        let updated = 0;
        rows.forEach((r) => { const info = stmt.run(r.image, r.key); updated += info.changes || 0; });
        if (updated > 0)
            console.log(`[db] migrated: backfilled ${updated} image(s)`);
    }
    catch (e) {
        console.error('[db] image-backfill migration error:', e.message);
    }
}
// Categories: set image where currently NULL/empty, matched by slug
try {
    const hasImageCol = (SELECTED_DB === 'mysql'
        ? db.prepare(`SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'categories'`).all()
        : db.prepare(`PRAGMA table_info(categories)`).all()).some((c) => c.name === 'image');
    if (hasImageCol) {
        ensureImagesByMatch(`UPDATE categories SET image = ? WHERE slug = ? AND (image IS NULL OR image = '')`, [
            { key: 'rack-accessories', image: '/static/images/cat-rack-accessories.jpg' },
            { key: 'switches', image: '/static/images/cat-switches.jpg' },
            { key: 'amad-racks', image: '/static/images/cat-amad-racks.jpg' },
            { key: 'wall-racks', image: '/static/images/cat-wall-racks.jpg' },
            { key: 'standing-racks', image: '/static/images/cat-standing-racks.jpg' },
            { key: 'passive', image: '/static/images/cat-passive.jpg' },
            { key: 'ebox', image: '/static/images/cat-ebox.jpg' },
            { key: 'adapters', image: '/static/images/cat-adapters.jpg' },
            { key: 'routers', image: '/static/images/cat-routers.jpg' },
        ]);
    }
}
catch (e) { console.error('[db] category image migration error:', e.message); }
// Side/mid banners: fill rows that have no image yet, matched by title
ensureImagesByMatch(`UPDATE site_blocks SET image = ? WHERE section = 'side_banner' AND title = ? AND (image IS NULL OR image = '')`, [
    { key: 'کابل و پسیو', image: '/static/images/banner-side-1-cable.jpg' },
    { key: 'باکس CamBox', image: '/static/images/banner-side-2-ebox.jpg' },
]);
ensureImagesByMatch(`UPDATE site_blocks SET image = ? WHERE section = 'mid_banner' AND title = ? AND (image IS NULL OR image = '')`, [
    { key: 'رک ایستاده', image: '/static/images/banner-mid-1-rack.jpg' },
    { key: 'مودم و روتر', image: '/static/images/banner-mid-2-router.jpg' },
]);
// Hero slides: replace the old single duplicated image with distinct images, matched by title
ensureImagesByMatch(`UPDATE site_blocks SET image = ? WHERE section = 'hero' AND title = ? AND (image IS NULL OR image = '' OR image = '/static/images/hero-legrand.jpg')`, [
    { key: 'تجهیزات شبکه لگراند', image: '/static/images/hero-1-datacenter.jpg' },
    { key: 'رک و متعلقات آماد سیستم', image: '/static/images/hero-3-rack.jpg' },
    { key: 'سوییچ و روتر شبکه', image: '/static/images/hero-2-cabling.jpg' },
]);

// Graceful close (called on SIGINT/SIGTERM from server.ts)
export function closeDatabase() {
    try {
        if (db.open) {
            if (SELECTED_DB !== 'mysql')
                db.pragma('wal_checkpoint(TRUNCATE)');
            db.close();
        }
    }
    catch (e) {
        console.error('[db] close error:', e);
    }
}
export default db;
// ===== Multi-driver helper (Phase 8.4) =====
// When DB_TYPE=mssql or mysql, prefer the corresponding driver via these helpers.
// The default `db` export above remains the better-sqlite3 instance for development.
export const DB_TYPE = (process.env.DB_TYPE || 'sqlite').toLowerCase();
export const isSqlite = DB_TYPE === 'sqlite';
export const isMysql = DB_TYPE === 'mysql';
export const isMssql = DB_TYPE === 'mssql';
