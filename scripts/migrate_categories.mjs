// Category restructure migration.
// - Mega menu must show CATEGORY names, not product names
// - Create logical subcategories and assign products by name patterns
// - Group rack categories under "رک های آماد سیستم"
// - Fix miscategorized products (42U rack in Passive) and deactivate duplicates
import Database from 'better-sqlite3';
const db = new Database(process.env.DB_PATH || 'data/netcorepro.db');
db.pragma('journal_mode = WAL');

const now = () => new Date().toISOString().replace('T',' ').slice(0,19);

function ensureCat(name, slug, parent_id, sort_order = 0) {
  const ex = db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug);
  if (ex) { db.prepare('UPDATE categories SET name=?, parent_id=?, sort_order=? WHERE id=?').run(name, parent_id, sort_order, ex.id); return ex.id; }
  const r = db.prepare('INSERT INTO categories (name, slug, parent_id, sort_order) VALUES (?,?,?,?)').run(name, slug, parent_id, sort_order);
  return r.lastInsertRowid;
}
function moveByPattern(catId, targetId, patterns) {
  const rows = db.prepare('SELECT id, name FROM products WHERE category_id = ?').all(catId);
  let n = 0;
  for (const p of rows) {
    if (patterns.some(rx => rx.test(p.name))) {
      db.prepare('UPDATE products SET category_id=?, updated_at=? WHERE id=?').run(targetId, now(), p.id); n++;
    }
  }
  return n;
}
const log = [];
const tx = db.transaction(() => {
  // --- 1) Rack family: children of "رک های آماد سیستم" (id lookup by slug) ---
  const rackRoot = db.prepare("SELECT id FROM categories WHERE slug='amad-racks'").get();
  const rackWall = db.prepare("SELECT id FROM categories WHERE slug='wall-racks'").get();
  const rackStand = db.prepare("SELECT id FROM categories WHERE slug='standing-racks'").get();
  if (rackRoot && rackWall) db.prepare('UPDATE categories SET parent_id=? WHERE id=?').run(rackRoot.id, rackWall.id);
  if (rackRoot && rackStand) db.prepare('UPDATE categories SET parent_id=? WHERE id=?').run(rackRoot.id, rackStand.id);
  log.push('rack tree: wall+standing → children of amad-racks');

  const cat = slug => { const r = db.prepare('SELECT id FROM categories WHERE slug=?').get(slug); return r && r.id; };
  const rackAcc = cat('rack-accessories'), sw = cat('switches'), passive = cat('passive'),
        ebox = cat('ebox'), adapters = cat('adapters'), routers = cat('routers'),
        cable = cat('کابل-شبکه'), cambox = cat('کم-باکس');

  // --- 2) Subcategories per root ---
  const sw5   = ensureCat('سوییچ 5 پورت', 'switch-5-port', sw, 0);
  const sw8   = ensureCat('سوییچ 8 پورت', 'switch-8-port', sw, 1);
  log.push(`switches: 5p moved=${moveByPattern(sw, sw5, [/[5۵]\s*پورت/])}, 8p moved=${moveByPattern(sw, sw8, [/[8۸]\s*پورت/])}`);

  const cUtp  = ensureCat('کابل Cat6 UTP', 'cable-cat6-utp', cable, 0);
  const cOut  = ensureCat('کابل اوت دور و SFTP', 'cable-outdoor-sftp', cable, 1);
  log.push(`cable: sftp/outdoor moved=${moveByPattern(cable, cOut, [/اوت\s*دور/i, /sftp/i])}, utp moved=${moveByPattern(cable, cUtp, [/utp/i, /cat\s*6/i])}`);

  const a12   = ensureCat('آداپتور 12 ولت', 'adapter-12v', adapters, 0);
  const a48   = ensureCat('آداپتور 48 ولت', 'adapter-48v', adapters, 1);
  log.push(`adapters: 48v moved=${moveByPattern(adapters, a48, [/[4۴][8۸]\s*ولت/])}, 12v moved=${moveByPattern(adapters, a12, [/[1۱][2۲]\s*ولت/])}`);

  const modem = ensureCat('مودم روتر 4G LTE', 'modem-4g-lte', routers, 0);
  const wrt   = ensureCat('روتر بی‌سیم', 'wireless-router', routers, 1);
  log.push(`routers: modem moved=${moveByPattern(routers, modem, [/مودم/])}, router moved=${moveByPattern(routers, wrt, [/روتر/])}`);

  const tray  = ensureCat('سینی رک', 'rack-tray', rackAcc, 0);
  const blank = ensureCat('بلانک پنل', 'blank-panel', rackAcc, 1);
  const inst  = ensureCat('ملزومات نصب رک', 'rack-install-acc', rackAcc, 2);
  log.push(`rackAcc: tray=${moveByPattern(rackAcc, tray, [/سینی/])}, blank=${moveByPattern(rackAcc, blank, [/بلانک/])}, inst=${moveByPattern(rackAcc, inst, [/پیچ/])}`);

  const patch = ensureCat('پچ پنل', 'patch-panel', passive, 0);
  const tools = ensureCat('ملزومات و ابزار', 'passive-tools', passive, 3);
  // keep existing children فلکسی/پلی فلکس order
  db.prepare("UPDATE categories SET sort_order=1 WHERE slug='فلکسی'").run();
  db.prepare("UPDATE categories SET sort_order=2 WHERE slug='پلی-فلکس'").run();
  log.push(`passive: patch=${moveByPattern(passive, patch, [/پچ\s*پنل/])}, tools=${moveByPattern(passive, tools, [/نوار\s*چسب/])}`);

  // miscategorized 42U rack sitting in Passive → standing racks
  const fix42 = db.prepare("UPDATE products SET category_id=?, updated_at=? WHERE category_id=? AND name LIKE '%رک ایستاده%'").run(rackStand.id, now(), passive);
  log.push(`fix 42U rack moved from passive: ${fix42.changes}`);

  const cbPro = ensureCat('کم باکس پرو', 'cambox-pro', cambox, 0);
  const cb360 = ensureCat('کم باکس گرد و 360 درجه', 'cambox-round-360', cambox, 1);
  log.push(`cambox: 360/round=${moveByPattern(cambox, cb360, [/گرد/, /[3۳][6۶][0۰]/])}, pro=${moveByPattern(cambox, cbPro, [/پرو/, /کم\s*باکس/])}`);

  const eb20 = ensureCat('ای باکس 25×20', 'ebox-25x20', ebox, 0);
  const eb35 = ensureCat('ای باکس 35×25', 'ebox-35x25', ebox, 1);
  log.push(`ebox: 25x20=${moveByPattern(ebox, eb20, [/25\s*[×x*]\s*20/, /20\s*[×x*]\s*25/])}, 35x25=${moveByPattern(ebox, eb35, [/35\s*[×x*]\s*25/, /25\s*[×x*]\s*35/])}`);

  // --- 3) duplicate placeholder product (price=5, no sku, wrong category) -> inactive ---
  const dup = db.prepare("SELECT id FROM products WHERE slug='فلکسی-سفید-سایز-21-2' AND (sku IS NULL OR sku='') AND price <= 10").get();
  if (dup) { db.prepare("UPDATE products SET status='inactive', featured=0, updated_at=? WHERE id=?").run(now(), dup.id); log.push(`deactivated junk dup product #${dup.id}`); }
});
tx();
console.log(log.join('\n'));
// summary
const tree = db.prepare('SELECT id,parent_id,name,slug FROM categories ORDER BY COALESCE(parent_id,0), sort_order, name').all();
console.log('--- TREE ---');
for (const c of tree) console.log((c.parent_id ? '  └ ' : '') + c.name + ' (' + c.slug + ')');
const orphan = db.prepare("SELECT c.name, COUNT(p.id) n FROM categories c LEFT JOIN products p ON p.category_id=c.id AND p.status='active' GROUP BY c.id ORDER BY n DESC").all();
console.log('--- ACTIVE PRODUCT COUNTS ---');
for (const o of orphan) console.log(o.n + '  ' + o.name);
// (v4.1) shorter child names under رک های آماد سیستم
db.prepare("UPDATE categories SET name='رک دیواری' WHERE slug='wall-racks'").run();
db.prepare("UPDATE categories SET name='رک ایستاده' WHERE slug='standing-racks'").run();
