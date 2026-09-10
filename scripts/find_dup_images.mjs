// گزارش گروه‌های عکس یکسان بین دسته‌بندی‌ها (بر اساس محتوای فایل، نه مسیر)
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

const db = new Database('./data/netcorepro.db', { readonly: true });
const rows = db.prepare(
  `SELECT id, name, image FROM categories
    WHERE image IS NOT NULL AND TRIM(image) <> ''
    ORDER BY id`
).all();

const byHash = new Map();
const missing = [];

for (const c of rows) {
  const file = './public' + c.image;
  try {
    const hash = createHash('md5').update(readFileSync(file)).digest('hex');
    if (!byHash.has(hash)) byHash.set(hash, []);
    byHash.get(hash).push({ ...c, file });
  } catch {
    missing.push(c);
  }
}

console.log(`دسته‌های دارای عکس: ${rows.length}`);
console.log(`عکس‌های یکتا (بر اساس محتوا): ${byHash.size}`);

let dupGroups = 0;
for (const [hash, list] of byHash) {
  if (list.length > 1) {
    dupGroups++;
    console.log(`\n⚠️  ${hash.slice(0, 8)} — ${list.length} دسته این عکس را مشترک دارند:`);
    for (const c of list) console.log(`     • #${c.id} ${c.name}  ← ${c.image}`);
  }
}

if (missing.length) {
  console.log('\n❌ فایل عکس پیدا نشد:');
  for (const c of missing) console.log(`     • #${c.id} ${c.name}  ← ${c.image}`);
}

console.log(`\nگروه‌های تکراری: ${dupGroups}`);
db.close();
