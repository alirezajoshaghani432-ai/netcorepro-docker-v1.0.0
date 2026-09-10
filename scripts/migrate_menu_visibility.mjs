/**
 * NetCore Pro — categories: menu visibility migration.
 *
 * Adds `show_in_menu` to `categories` so a category can be hidden from the
 * header mega-menu without being deleted. Deletion is intentionally blocked
 * while products are still attached (referential integrity), so visibility is
 * the correct switch for temporarily retiring a category.
 *
 * Idempotent: safe to run repeatedly.
 */
import db from '../dist/db/index.js';

const cols = db.prepare(`PRAGMA table_info(categories)`).all().map(c => c.name);

if (!cols.includes('show_in_menu')) {
    db.exec(`ALTER TABLE categories ADD COLUMN show_in_menu INTEGER DEFAULT 1`);
    console.log('✓ added categories.show_in_menu');
} else {
    console.log('· categories.show_in_menu already present');
}

// Backfill: everything currently in the menu stays in the menu.
const n = db.prepare(`UPDATE categories SET show_in_menu = 1 WHERE show_in_menu IS NULL`).run().changes;
console.log(`✓ backfilled ${n} row(s) to show_in_menu = 1`);

const total = db.prepare(`SELECT COUNT(*) AS t FROM categories`).get().t;
const shown = db.prepare(`SELECT COUNT(*) AS t FROM categories WHERE show_in_menu = 1`).get().t;
console.log(`  categories: ${total} total, ${shown} visible in menu`);
