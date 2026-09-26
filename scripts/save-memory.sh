#!/usr/bin/env bash
# ============================================================================
#  save-memory.sh — به‌روزرسانی خودکار «حافظهٔ پروژه»
# ----------------------------------------------------------------------------
#  کاربرد ساده:
#     bash scripts/save-memory.sh          → وضعیت را می‌سنجد و در فایل می‌نویسد
#     bash scripts/save-memory.sh --show   → فقط نشان می‌دهد، فایل را دست نمی‌زند
#     bash scripts/save-memory.sh --commit → می‌نویسد و بعد کامیت هم می‌کند
#     bash scripts/save-memory.sh --full   → ثبت + کامیت + پشتیبان + کپی روی فضای ابری
#                                            (کامل‌ترین حالت — برای پایان هر نشست)
#
#  این اسکریپت بخش «وضعیت زندهٔ سیستم» در PROJECT-MEMORY.md را بازنویسی می‌کند
#  تا بعد از هر ری‌استارت، عکس دقیقی از وضعیت پروژه در دسترس باشد.
# ============================================================================
set -uo pipefail

PROJ="/home/root/webapp/netcorepro"
REPO="/home/root/webapp"
MEM="$PROJ/PROJECT-MEMORY.md"
BASE="${BASE:-http://127.0.0.1:8090}"
ADMIN_EMAIL="admin@netcorepro.ir"
ADMIN_PASS="${ADMIN_PASSWORD:-admin123}"

AIDRIVE="/mnt/aidrive"

MODE="write"
case "${1:-}" in
  --show)   MODE="show" ;;
  --commit) MODE="commit" ;;
  --full)   MODE="full" ;;
esac

cd "$PROJ" || { echo "خطا: پوشهٔ پروژه پیدا نشد: $PROJ"; exit 1; }

# ---------- گردآوری اطلاعات ---------------------------------------------------
NOW="$(date '+%Y-%m-%d %H:%M:%S %Z')"

PM2_LINE="$(pm2 list 2>/dev/null | grep -E '\bnetcorepro\b' | head -1 || true)"
if [ -n "$PM2_LINE" ]; then
  PM2_STATUS="$(echo "$PM2_LINE" | grep -oE 'online|stopped|errored|launching' | head -1)"
  PM2_UPTIME="$(echo "$PM2_LINE" | awk -F'│' '{gsub(/ /,"",$8); print $8}')"
  [ -z "${PM2_STATUS:-}" ] && PM2_STATUS="نامشخص"
else
  PM2_STATUS="ثبت نشده"
  PM2_UPTIME="-"
fi

# توجه: صفحه‌های سایت فروشگاه زیر پیشوند / هستند و «/» به آن ریدایرکت می‌شود.
# پس 404 روی /products ایراد نیست — مسیر درست /products است.
http_code() { curl -s -o /dev/null -m 8 -w '%{http_code}' "$1" 2>/dev/null || echo "000"; }
C_ROOT="$(http_code "$BASE/")"
C_HOME="$(http_code "$BASE/")"
C_PRODUCTS="$(http_code "$BASE/products")"
C_CATS="$(http_code "$BASE/categories")"
C_MENUB="$(http_code "$BASE/admin/menu-builder")"
C_ADMIN="$(http_code "$BASE/admin")"

# ورود مدیر — با تحمل محدودیت نرخ (429)
LOGIN_RESULT="؟"
for i in 1 2 3; do
  LC="$(curl -s -o /dev/null -m 10 -w '%{http_code}' \
        -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
        -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" 2>/dev/null || echo 000)"
  if [ "$LC" = "200" ]; then LOGIN_RESULT="✅ موفق (200)"; break; fi
  if [ "$LC" = "429" ]; then LOGIN_RESULT="⏳ محدودیت نرخ (429) — یعنی سرویس سالم است، فقط باید کمی صبر کرد"; sleep 6; continue; fi
  LOGIN_RESULT="❌ ناموفق ($LC)"; break
done

# گیت
GIT_BRANCH="$(git -C "$REPO" branch --show-current 2>/dev/null || echo '?')"
GIT_LAST="$(git -C "$REPO" log --oneline -1 2>/dev/null || echo '?')"
GIT_DIRTY_N="$(git -C "$REPO" status --porcelain -- netcorepro 2>/dev/null | grep -c . || echo 0)"
GIT_DIRTY_LIST="$(git -C "$REPO" status --porcelain -- netcorepro 2>/dev/null | head -15 || true)"
GIT_RECENT="$(git -C "$REPO" log --oneline -10 -- netcorepro 2>/dev/null || true)"

# پایگاه‌داده
DB_INFO="$(node -e "
try{
  const D=require('better-sqlite3');
  const db=new D('$PROJ/data/netcorepro.db',{readonly:true, fileMustExist:true});
  const one=(q)=>{try{return Object.values(db.prepare(q).get())[0]}catch(e){return 'n/a'}};
  const cols=db.prepare('PRAGMA table_info(categories)').all().map(c=>c.name);
  console.log([
    'محصولات: '        + one('SELECT COUNT(*) FROM products'),
    'دسته‌بندی‌ها: '    + one('SELECT COUNT(*) FROM categories'),
    'سفارش‌ها: '       + one('SELECT COUNT(*) FROM orders'),
    'کاربران: '        + one('SELECT COUNT(*) FROM users'),
    'ستون show_in_menu: ' + (cols.includes('show_in_menu') ? 'دارد ✅' : 'ندارد (سازگاری با COALESCE)'),
    'مخفی‌شده در منو: ' + (cols.includes('show_in_menu') ? one('SELECT COUNT(*) FROM categories WHERE COALESCE(show_in_menu,1)=0') : '0')
  ].join(' | '));
  db.close();
}catch(e){ console.log('خطا در خواندن پایگاه‌داده: '+e.message); }
" 2>/dev/null || echo "خطا در خواندن پایگاه‌داده")"

# فایل‌های کلیدی
key_file() { # مسیر ، برچسب
  if [ -f "$PROJ/$1" ]; then
    printf '| `%s` | ✅ موجود | %s بایت |\n' "$1" "$(stat -c%s "$PROJ/$1")"
  else
    printf '| `%s` | ❌ نیست | - |\n' "$1"
  fi
}
KEYFILES="$(
  key_file "dist/views/admin/menu-builder.js"
  key_file "dist/server.js"
  key_file "dist/views/admin/layout.js"
  key_file "dist/views/admin/pages.js"
  key_file "dist/views/site/pages.js"
  key_file "dist/views/shared/layout.js"
  key_file "public/static/css/nc-site.min.css"
  key_file "scripts/qa/test_menu_builder.py"
  key_file "PROJECT-MEMORY.md"
)"

ASSET_V="$(grep -oE "ASSET_V *= *'[^']+'" dist/views/shared/layout.js 2>/dev/null | head -1 | grep -oE "'[^']+'" | tr -d "'" || echo '?')"
ROUTE_OK="$(grep -c "admin/menu-builder" dist/server.js 2>/dev/null || echo 0)"
SIDEBAR_OK="$(grep -c "menu-builder" dist/views/admin/layout.js 2>/dev/null || echo 0)"
# پشتیبان‌های گیت (bundle) مهم‌ترین‌اند چون کل تاریخ پروژه را دارند
BUNDLES="$(ls -1sh "$PROJ/backups" 2>/dev/null | grep -i 'bundle' || echo 'هیچ فایل bundle ندارد ⚠️')"
DBBAKS="$(ls -1sh "$PROJ/backups" 2>/dev/null | grep -iE '\.db$' | tail -3 || echo 'ندارد')"

# ---------- ساخت متن بخش ------------------------------------------------------
BLOCK="$(cat <<EOF
<!-- LIVE-STATUS-START -->
> 🕐 آخرین به‌روزرسانی خودکار: **$NOW**
> (با اجرای \`bash scripts/save-memory.sh\` ساخته شده — دستی ویرایش نکنید)

### سرویس

| مورد | وضعیت |
|---|---|
| pm2 \`netcorepro\` | **$PM2_STATUS** (مدت روشن بودن: $PM2_UPTIME) |
| آدرس پایه | \`$BASE\` |
| \`/\` (باید ۳۰۲ به / باشد) | HTTP **$C_ROOT** |
| \`/\` صفحهٔ اصلی سایت | HTTP **$C_HOME** |
| \`/products\` | HTTP **$C_PRODUCTS** |
| \`/categories\` | HTTP **$C_CATS** |
| \`/admin\` | HTTP **$C_ADMIN** |
| \`/admin/menu-builder\` | HTTP **$C_MENUB** |
| ورود مدیر با \`admin123\` | $LOGIN_RESULT |

> 💡 نکته: صفحه‌های سایت فروشگاه مستقیم روی ریشه (\`/\`) قرار دارند.
> بنابراین \`404\` روی \`/products\` **ایراد نیست** — مسیر درست \`/products\` است.

### پایگاه‌داده

$DB_INFO

### گیت

| مورد | مقدار |
|---|---|
| شاخه | \`$GIT_BRANCH\` |
| آخرین کامیت | \`$GIT_LAST\` |
| فایل‌های کامیت‌نشده در netcorepro | **$GIT_DIRTY_N** |

$( [ "$GIT_DIRTY_N" != "0" ] && printf '⚠️ **کامیت‌نشده:**\n```\n%s\n```\n' "$GIT_DIRTY_LIST" || printf '✅ همه‌چیز کامیت شده است.\n' )

**۱۰ کامیت آخر:**
\`\`\`
$GIT_RECENT
\`\`\`

### فایل‌های کلیدی

| فایل | وضعیت | حجم |
|---|---|---|
$KEYFILES

### سنجه‌های یکپارچگی

| بررسی | نتیجه |
|---|---|
| نسخهٔ فایل‌های ثابت (\`ASSET_V\`) | \`$ASSET_V\` |
| مسیر \`/admin/menu-builder\` در server.js | $( [ "$ROUTE_OK" -gt 0 ] && echo 'ثبت شده ✅' || echo 'ثبت نشده ❌' ) |
| لینک منوی کناره | $( [ "$SIDEBAR_OK" -gt 0 ] && echo 'موجود ✅' || echo 'نیست ❌' ) |

### نسخه‌های پشتیبان

**پشتیبان کامل گیت (مهم‌ترین — کل تاریخ پروژه):**
\`\`\`
$BUNDLES
\`\`\`
بازگرداندن روی هر کامپیوتری:
\`git clone netcorepro/backups/repo_v4_latest.bundle بازیابی-پروژه\`

**آخرین پشتیبان‌های پایگاه‌داده:**
\`\`\`
$DBBAKS
\`\`\`
<!-- LIVE-STATUS-END -->
EOF
)"

if [ "$MODE" = "show" ]; then
  echo "$BLOCK"
  exit 0
fi

# ---------- جایگذاری در فایل --------------------------------------------------
if [ ! -f "$MEM" ]; then
  echo "خطا: فایل حافظه پیدا نشد: $MEM"; exit 1
fi

BLOCK="$BLOCK" python3 - "$MEM" <<'PY'
import os, re, sys
path  = sys.argv[1]
block = os.environ['BLOCK']
src   = open(path, encoding='utf-8').read()
pat   = re.compile(r'<!-- LIVE-STATUS-START -->.*?<!-- LIVE-STATUS-END -->', re.S)
if pat.search(src):
    out = pat.sub(lambda m: block, src, count=1)
else:
    out = src.rstrip() + "\n\n" + block + "\n"
open(path, 'w', encoding='utf-8').write(out)
print("✅ بخش «وضعیت زندهٔ سیستم» در PROJECT-MEMORY.md به‌روز شد.")
PY

if [ "$MODE" = "commit" ] || [ "$MODE" = "full" ]; then
  cd "$REPO" || exit 1
  # همهٔ فایل‌های حافظه را کامیت می‌کنیم، نه فقط یکی
  git add netcorepro/PROJECT-MEMORY.md 2>/dev/null
  git add "netcorepro/دفتر-کار.md" 2>/dev/null
  git add "netcorepro/شروع-از-اینجا.md" 2>/dev/null
  git add netcorepro/scripts/save-memory.sh 2>/dev/null
  if [ -n "$(git diff --cached --name-only)" ]; then
    git commit -q -m "chore(netcorepro): به‌روزرسانی خودکار حافظهٔ پروژه ($NOW)"
    echo "✅ کامیت شد: $(git log --oneline -1)"
  else
    echo "ℹ️ تغییری برای کامیت نبود."
  fi
fi

# ---------- حالت کامل: پشتیبان + کپی بیرون از سندباکس -------------------------
if [ "$MODE" = "full" ]; then
  cd "$REPO" || exit 1
  DAY="$(date +%F)"
  BUNDLE="$PROJ/backups/repo_${DAY}_all.bundle"

  echo ""
  echo "── ساخت پشتیبان کامل گیت ──"
  mkdir -p "$PROJ/backups"
  if git bundle create "$BUNDLE" --all >/dev/null 2>&1; then
    # حتماً صحت پشتیبان را بسنجیم — پشتیبان نامعتبر بدتر از نبودن است
    if git bundle verify "$BUNDLE" >/dev/null 2>&1; then
      echo "✅ پشتیبان ساخته و صحتش تأیید شد: $(du -h "$BUNDLE" | cut -f1) → $BUNDLE"
      HEAD_SHA="$(git rev-parse HEAD)"
      if git bundle list-heads "$BUNDLE" 2>/dev/null | grep -q "$HEAD_SHA"; then
        echo "✅ آخرین کامیت ($(git rev-parse --short HEAD)) داخل پشتیبان هست."
      else
        echo "⚠️ هشدار: آخرین کامیت در پشتیبان پیدا نشد!"
      fi
    else
      echo "❌ پشتیبان ساخته شد ولی صحتش تأیید نشد — به آن اعتماد نکنید."
    fi
  else
    echo "❌ ساخت پشتیبان ناموفق بود."
  fi

  # کپی بیرون از سندباکس (فضای ابری کارفرما) — مهم‌ترین لایهٔ محافظت
  # نکته: این پوشه کند است، پس فقط چند فایل تکی کپی می‌کنیم، هرگز کپی بازگشتی.
  echo ""
  echo "── کپی روی فضای ابری (بیرون از سندباکس) ──"
  if [ -d "$AIDRIVE" ]; then
    ok=0
    cp "$BUNDLE" "$AIDRIVE/netcorepro_git_backup_${DAY}.bundle" 2>/dev/null && { echo "✅ پشتیبان گیت"; ok=$((ok+1)); }
    cp "$MEM" "$AIDRIVE/netcorepro_PROJECT-MEMORY_${DAY}.md" 2>/dev/null && { echo "✅ فایل حافظه"; ok=$((ok+1)); }
    cp "$PROJ/دفتر-کار.md" "$AIDRIVE/netcorepro_WORK-JOURNAL_${DAY}.md" 2>/dev/null && { echo "✅ دفتر کار"; ok=$((ok+1)); }
    cp "$PROJ/شروع-از-اینجا.md" "$AIDRIVE/netcorepro_START-HERE_${DAY}.md" 2>/dev/null && { echo "✅ راهنمای شروع"; ok=$((ok+1)); }
    cp "$PROJ/data/netcorepro.db" "$AIDRIVE/netcorepro_db_${DAY}.db" 2>/dev/null && { echo "✅ پایگاه‌داده"; ok=$((ok+1)); }
    echo "→ $ok فایل روی فضای ابری ذخیره شد ($AIDRIVE)"
  else
    echo "⚠️ فضای ابری در دسترس نیست ($AIDRIVE) — فقط پشتیبان محلی ساخته شد."
  fi

  echo ""
  echo "══════════════════════════════════════════════"
  echo " ✅ همه‌چیز ذخیره شد. اگر محیط ری‌استارت شد بگویید:"
  echo "    «فایل netcorepro/PROJECT-MEMORY.md را بخوان و ادامه بده»"
  echo "══════════════════════════════════════════════"
fi
