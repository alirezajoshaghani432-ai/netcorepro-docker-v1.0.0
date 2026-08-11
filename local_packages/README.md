# local_packages/ — بسته‌های آفلاین برای دیپلوی در شرایط فیلترینگ ایران

این پوشه شامل تمام بسته‌های native و باینری‌هایی است که با احتمال زیاد در شرایط
فیلترینگ شدید اینترنت ایران از طریق npm registry رسمی قابل دانلود نیستند
(چون GitHub releases برای دانلود prebuild باینری مسدود است).

## محتوا

| فایل | شرح | اندازه تقریبی |
|------|-----|---------------|
| `better-sqlite3.tgz` | بسته‌ی منبع `better-sqlite3@11.5.0` (همان tarball رسمی) | ~2.5 MB |
| `prebuilt/better_sqlite3.node` | باینری از پیش کامپایل‌شده برای Linux x64 + Node 20 | ~2 MB |

## چرا این فایل‌ها لازم‌اند؟

پکیج `better-sqlite3` یک native module است که هنگام نصب سعی می‌کند:
1. ابتدا فایل `better-sqlite3-vN.x.x-node-v115-linux-x64.tar.gz` را از
   `https://github.com/WiseLibs/better-sqlite3/releases/...` دانلود کند
2. در صورت شکست، با `node-gyp` + `python3` + `gcc` از سورس build کند

در شرایط فیلترینگ ایران:
- **مسیر 1 شکست می‌خورد** چون GitHub releases مسدود است (سایر CDNها هم همینطور)
- **مسیر 2 کار می‌کند** ولی به ابزارهای build روی image پایه نیاز دارد و حدود
  1-2 دقیقه زمان می‌برد

## دو روش استفاده

### روش 1 (سریع‌ترین) — استفاده از باینری از پیش کامپایل‌شده

اگر سرور Production شما `Linux x64` با `Node.js 20` است، می‌توانید مستقیماً
از `prebuilt/better_sqlite3.node` استفاده کنید. این روش در `Dockerfile` پروژه
به‌طور پیش‌فرض پیاده‌سازی شده است:

```dockerfile
COPY local_packages/better-sqlite3.tgz /tmp/better-sqlite3.tgz
RUN npm install --ignore-scripts /tmp/better-sqlite3.tgz
COPY local_packages/prebuilt/better_sqlite3.node \
     /app/node_modules/better-sqlite3/build/Release/
```

### روش 2 (مطمئن‌ترین) — Build از سورس داخل Docker

اگر معماری/نسخه Node شما متفاوت است (مثلاً arm64 یا Node 22)، فایل باینری
سازگار نخواهد بود. در این حالت `Dockerfile.build-from-source` را استفاده کنید
که داخل image با `python3 + make + g++` از سورس می‌سازد. این روش حدود
1-2 دقیقه به زمان build اضافه می‌کند ولی همیشه کار می‌کند.

## بازسازی باینری برای معماری دلخواه

اگر می‌خواهید باینری را برای پلتفرم خودتان از نو بسازید (مثلاً arm64):

```bash
# روی سرور خودتان (با اتصال به Liara mirror):
npm config set registry https://package-mirror.liara.ir/repository/npm/
npm install better-sqlite3@11.5.0 --build-from-source

# سپس فایل را برمی‌داریم:
cp node_modules/better-sqlite3/build/Release/better_sqlite3.node \
   /path/to/netcorepro/local_packages/prebuilt/
```

## اعتبارسنجی

برای اطمینان از سلامت باینری، روی یک container ساده تست بگیرید:

```bash
docker run --rm -v $(pwd)/local_packages/prebuilt:/p node:20 \
  node -e "process.dlopen({exports: {}}, '/p/better_sqlite3.node'); console.log('✅ binary OK')"
```

---

**نکته:** این پوشه عمداً درون مخزن Git قرار می‌گیرد (فایل `.gitignore`
آن را Allow می‌کند) چون بدون این فایل‌ها deployment در شرایط فیلترینگ
ممکن نیست.
