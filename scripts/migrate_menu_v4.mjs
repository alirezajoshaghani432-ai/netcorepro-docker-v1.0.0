/**
 * Radis — migration V4 (2026-08-05)
 *
 * Owner request (voice note): "give me a panel where I can change these names
 * myself, add or remove a category, so I don't have to call you every time."
 *
 * Adds `show_in_menu` to categories so the owner can hide a category from the
 * header mega-menu WITHOUT deleting it (deleting is blocked when products are
 * attached, which used to be a dead end for him).
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
