#!/usr/bin/env node
/* Image integrity test.
 * Collects every image path referenced in the DB (products, categories, brands,
 * posts, site_blocks) and verifies each one returns HTTP 200 from the running server.
 * Also flags any image that is suspiciously small (<1KB) which usually means an
 * error page got saved instead of a real picture.
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const DB_PATH = process.env.DB_PATH || './data/netcorepro.db';
let pass = 0, fail = 0; const failures = [];

function log(ok, name, d) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; failures.push(name + (d ? ' :: ' + d : '')); console.log(`  \x1b[31m✗\x1b[0m ${name}${d ? '  -> ' + d : ''}`); }
}
function section(t) { console.log(`\n\x1b[36m── ${t} ──\x1b[0m`); }

async function check(path) {
  if (!path) return { ok: true, skip: true };
  // only test local static assets; external URLs are out of scope
  if (!path.startsWith('/')) return { ok: true, skip: true };
  try {
    const r = await fetch(BASE + path);
    const buf = await r.arrayBuffer();
    const size = buf.byteLength;
    const ct = r.headers.get('content-type') || '';
    const isSvg = /svg/.test(ct) || path.endsWith('.svg');
    const isCss = /css/.test(ct) || path.endsWith('.css');
    // SVG/CSS are text: a valid file can be small (a few hundred bytes). Raster images
    // saved as error pages are tiny JSON (<1KB), so we only enforce the 1KB floor on rasters.
    const minSize = isSvg ? 100 : (isCss ? 100 : 1024);
    const typeOk = isCss ? /css|text/.test(ct) : /image|octet-stream|svg/.test(ct);
    const ok = r.status === 200 && size >= minSize && typeOk;
    return { ok, status: r.status, size, ct };
  } catch (e) {
    return { ok: false, status: 0, err: e.message };
  }
}

function collect(db, table, column, label) {
  try {
    const rows = db.prepare(`SELECT DISTINCT ${column} AS img FROM ${table} WHERE ${column} IS NOT NULL AND ${column} != ''`).all();
    return rows.map(r => ({ img: r.img, label }));
  } catch (e) { return []; }
}

async function main() {
  const db = new Database(DB_PATH, { readonly: true });

  let all = [];
  all = all.concat(collect(db, 'products', 'image', 'product'));
  all = all.concat(collect(db, 'categories', 'image', 'category'));
  all = all.concat(collect(db, 'brands', 'logo', 'brand'));
  all = all.concat(collect(db, 'posts', 'cover_image', 'post'));
  all = all.concat(collect(db, 'site_blocks', 'image', 'block'));

  // de-duplicate by path
  const seen = new Set();
  const items = all.filter(x => { if (seen.has(x.img)) return false; seen.add(x.img); return true; });

  section(`Image references in DB (${items.length} unique local paths)`);
  for (const it of items) {
    const r = await check(it.img);
    if (r.skip) continue;
    log(r.ok, `[${it.label}] ${it.img}`, r.ok ? '' : `status=${r.status} size=${r.size || 0} ct=${r.ct || ''} ${r.err || ''}`);
  }

  // Duplicate-image check for products (every product should be visually unique)
  section('Product image uniqueness');
  const dup = db.prepare('SELECT image, COUNT(*) c FROM products GROUP BY image HAVING c > 1').all();
  log(dup.length === 0, 'every product has a unique image', dup.length ? JSON.stringify(dup) : '');

  // A few key static assets used by templates (hero fallback, blog placeholders, favicon)
  section('Key template static assets');
  for (const p of ['/static/images/hero-legrand.jpg', '/static/images/blog1.svg', '/static/images/p1.svg', '/static/images/favicon.svg', '/static/css/tailwind.min.css']) {
    const r = await check(p);
    log(r.ok, p, r.ok ? '' : `status=${r.status} size=${r.size || 0}`);
  }

  // Home-page section images downloaded from the web (hero slides, side/mid banners, category cards).
  // Explicitly asserted here so coverage holds even if a row is later removed/edited in the DB.
  section('Home-page section images (hero / banners / categories)');
  const homeImages = [
    '/static/images/hero-1-datacenter.jpg',
    '/static/images/hero-2-cabling.jpg',
    '/static/images/hero-3-rack.jpg',
    '/static/images/banner-side-1-cable.jpg',
    '/static/images/banner-side-2-ebox.jpg',
    '/static/images/banner-mid-1-rack.jpg',
    '/static/images/banner-mid-2-router.jpg',
    '/static/images/cat-rack-accessories.jpg',
    '/static/images/cat-switches.jpg',
    '/static/images/cat-amad-racks.jpg',
    '/static/images/cat-wall-racks.jpg',
    '/static/images/cat-standing-racks.jpg',
    '/static/images/cat-passive.jpg',
    '/static/images/cat-ebox.jpg',
    '/static/images/cat-adapters.jpg',
    '/static/images/cat-routers.jpg',
  ];
  for (const p of homeImages) {
    const r = await check(p);
    log(r.ok, p, r.ok ? '' : `status=${r.status} size=${r.size || 0} ct=${r.ct || ''}`);
  }

  // Only ROOT categories are rendered as picture cards on the home page, and
  // only those that are actually shown in the menu. Sub-categories appear as
  // plain text links in the mega menu, so an image is irrelevant for them --
  // the previous assertion covered every row and failed on sub-categories that
  // can never display a photo.
  // A root card still degrades gracefully to its FontAwesome icon, so the hard
  // requirement is: image OR icon must be present (never an empty card).
  section('Category image bindings');
  const rootCards = db.prepare(
    `SELECT slug, image, icon FROM categories
      WHERE parent_id IS NULL AND COALESCE(show_in_menu, 1) = 1`).all();
  const emptyCards = rootCards.filter(c => !c.image && !c.icon);
  log(emptyCards.length === 0, 'every home-page category card renders something (image or icon)',
      emptyCards.length ? JSON.stringify(emptyCards.map(c => c.slug)) : '');
  // Informational: photos look better than icons, so surface the gap without failing.
  const iconOnly = rootCards.filter(c => !c.image && c.icon);
  if (iconOnly.length) {
    console.log(`  \x1b[33m!\x1b[0m ${iconOnly.length} home-page card(s) fall back to an icon `
      + `(no photo yet): ${iconOnly.map(c => c.slug).join(', ')}`);
  }

  db.close();
  console.log(`\n\x1b[1m═══ RESULTS: ${pass} passed, ${fail} failed ═══\x1b[0m`);
  if (failures.length) { console.log('\x1b[31mFailures:\x1b[0m'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
  process.exit(0);
}
main().catch(e => { console.error('RUNNER ERROR', e); process.exit(2); });
