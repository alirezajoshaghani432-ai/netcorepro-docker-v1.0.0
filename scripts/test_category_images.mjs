#!/usr/bin/env node
/**
 * test_category_images.mjs
 * ---------------------------------------------------------------------------
 * نگهبان کیفیت «داده» (نه کد) برای عکس دسته‌بندی‌ها.
 *
 * چرا این تست وجود دارد؟
 * اشتباه در انتخاب عکس یک دسته از دید تست‌های معمول پنهان می‌ماند، چون از نظر
 * فنی همه‌چیز درست است: فایل موجود است و پاسخ 200 می‌دهد. ایراد در «معنا»ی
 * داده است — مثلاً چند دسته به یک فایل عکس یکسان اشاره کنند و کاربر عکسی
 * ببیند که با نام دسته نمی‌خواند.
 *
 * پس این تست سه چیز را می‌سنجد:
 *   ۱) فایل عکس هر دسته روی دیسک واقعاً موجود باشد و خالی نباشد
 *   ۲) هیچ دو دسته‌ای عکس *یکسان* (چک‌سام برابر) نداشته باشند
 *   ۳) هر دستهٔ اصلی چیزی برای نمایش داشته باشد (عکس یا آیکن)
 *
 * مورد ۲ به‌صورت پیش‌فرض «هشدار» است نه «خطا»، چون انتخاب نهایی عکس یک تصمیم
 * محتوایی است. برای سخت‌گیرانه شدن:
 *     STRICT_DUP=1 node scripts/test_category_images.mjs
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT      = new URL('..', import.meta.url).pathname;
const DB_PATH   = process.env.DB_PATH || join(ROOT, 'data', 'netcorepro.db');
const PUBLIC    = join(ROOT, 'public');
const STRICT_DUP = process.env.STRICT_DUP === '1';

let pass = 0, fail = 0;
const log = (cond, name, extra = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}${extra ? '  ' + extra : ''}`); }
  else      { fail++; console.log(`  \x1b[31m✗\x1b[0m ${name}${extra ? '  ' + extra : ''}`); }
};
const warn = (msg) => console.log(`  \x1b[33m!\x1b[0m ${msg}`);

// عکس در پایگاه‌داده مثل /static/uploads/x.webp ذخیره می‌شود و روی دیسک
// زیر public/static/uploads/x.webp قرار دارد.
const toDisk = (webPath) => join(PUBLIC, webPath.replace(/^\//, ''));

const db = new Database(DB_PATH, { readonly: true });

console.log('\x1b[36m── سلامت عکس دسته‌بندی‌ها ──\x1b[0m');

const roots = db.prepare(`
  SELECT id, name, slug, image, icon
    FROM categories
   WHERE (parent_id IS NULL OR parent_id = 0)
     AND COALESCE(show_in_menu, 1) = 1
   ORDER BY sort_order, name
`).all();

// بررسی فقط دسته‌های اصلی کافی نیست: یک زیردسته می‌تواند فایلی با نام متفاوت
// ولی محتوای یکسان داشته باشد. بنابراین تکراری‌بودن روی *همهٔ* دسته‌ها سنجیده
// می‌شود (اصلی و زیردسته)، چون هر دو در پنل مدیریت قابل ویرایش‌اند.
const allCats = db.prepare(`
  SELECT id, name, slug, image, icon, parent_id
    FROM categories
   WHERE image IS NOT NULL AND TRIM(image) <> ''
   ORDER BY sort_order, name
`).all();

log(roots.length > 0, 'دسته‌های اصلی قابل نمایش پیدا شدند', `تعداد=${roots.length}`);

// ۱) هر دستهٔ اصلی چیزی برای نمایش دارد (عکس یا آیکن)
const nothingToShow = roots.filter(c => !c.image && !c.icon);
log(nothingToShow.length === 0,
    'هر دستهٔ اصلی چیزی برای نمایش دارد (عکس یا آیکن)',
    nothingToShow.length ? `بدون هیچ‌چیز: ${nothingToShow.map(c => c.slug || c.name).join(', ')}` : '');

// ۲) فایل عکس‌ها روی دیسک موجود و غیرخالی‌اند
const withImage = allCats;   // همهٔ دسته‌های دارای عکس، نه فقط اصلی‌ها
const missing = [], emptyFiles = [];
const sums = new Map();          // چک‌سام → آرایهٔ نام دسته‌ها

for (const c of withImage) {
  const disk = toDisk(c.image);
  if (!existsSync(disk)) { missing.push(`${c.name} → ${c.image}`); continue; }
  const size = statSync(disk).size;
  if (size === 0) { emptyFiles.push(`${c.name} → ${c.image}`); continue; }
  const sum = createHash('md5').update(readFileSync(disk)).digest('hex');
  if (!sums.has(sum)) sums.set(sum, []);
  sums.get(sum).push(c.name);
}

log(missing.length === 0, 'فایل عکس همهٔ دسته‌ها روی دیسک موجود است',
    missing.length ? `گمشده: ${missing.join(' | ')}` : `بررسی‌شده=${withImage.length}`);
log(emptyFiles.length === 0, 'هیچ فایل عکسی خالی (صفر بایت) نیست',
    emptyFiles.length ? `خالی: ${emptyFiles.join(' | ')}` : '');

// ۳) هیچ دو دستهٔ اصلی عکس یکسان ندارند
const dupGroups = [...sums.entries()].filter(([, names]) => names.length > 1);
const dupDesc = dupGroups.map(([sum, names]) => `«${names.join(' / ')}» (چک‌سام ${sum.slice(0, 8)})`).join(' ، ');

if (STRICT_DUP) {
  log(dupGroups.length === 0, 'هیچ دو دسته‌ای (اصلی یا زیردسته) عکس یکسان ندارند', dupDesc);
} else {
  // حالت پیش‌فرض: هشدار می‌دهیم ولی تست را رد نمی‌کنیم، چون انتخاب عکس
  // یک تصمیم محتوایی است و نباید مجموعهٔ تست را قفل کند.
  log(true, 'بررسی عکس تکراری انجام شد (حالت هشدار)',
      dupGroups.length ? `${dupGroups.length} گروه تکراری` : 'تکراری نبود');
  if (dupGroups.length) {
    warn(`⚠️ این دسته‌ها عکس کاملاً یکسان دارند و احتمالاً عکس اشتباه گرفته‌اند: ${dupDesc}`);
    warn('   برای رفع: در پنل → مدیریت دسته‌بندی‌ها عکس درست هر دسته را بارگذاری کنید.');
    warn('   برای اینکه این مورد باعث رد شدن تست شود: STRICT_DUP=1 اجرا کنید.');
  }
}

// ۴) گزارش تشریحی وضعیت عکس دسته‌ها
console.log('\x1b[36m── فهرست عکس همهٔ دسته‌ها ──\x1b[0m');
for (const c of [...roots, ...allCats.filter(a => a.parent_id)]) {
  const disk = c.image ? toDisk(c.image) : null;
  const okFile = disk && existsSync(disk);
  const sum = okFile ? createHash('md5').update(readFileSync(disk)).digest('hex').slice(0, 8) : '--------';
  const shared = okFile && (sums.get(
    createHash('md5').update(readFileSync(disk)).digest('hex')) || []).length > 1;
  const state = !c.image ? `آیکن: ${c.icon || '(ندارد)'}`
              : !okFile  ? 'فایل گمشده ❌'
              : shared   ? `${sum} ⚠️ تکراری`
              :            `${sum} ✅`;
  console.log(`  ${String(c.id).padStart(3)} ${(c.name || '').padEnd(24)} ${state}`);
}

db.close();

console.log(`\n\x1b[1m═══ RESULTS: ${pass} passed, ${fail} failed ═══\x1b[0m`);
process.exit(fail ? 1 : 0);
