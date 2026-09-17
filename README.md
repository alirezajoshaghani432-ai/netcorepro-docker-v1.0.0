# NetCore Pro — فروشگاه B2B تجهیزات شبکه

فروشگاه اینترنتی و پنل مدیریت تجهیزات شبکه، با رابط کاربری کامل فارسی و راست‌به‌چپ.
سمت سرور با **Hono** و رندر سمت سرور (SSR) نوشته شده، دیتابیس **MySQL/MariaDB** است و
تمام دارایی‌های ظاهری (فونت، آیکن، CSS و JS) به‌صورت **محلی** ارائه می‌شوند تا اپلیکیشن
بدون هیچ وابستگی به CDN خارجی و در شبکه‌های بسته هم کار کند.

## مرور پروژه

| | |
|---|---|
| **نام** | NetCore Pro |
| **نوع** | فروشگاه B2B + پنل مدیریت |
| **استک** | Node.js 20 · Hono 4 · MySQL/MariaDB · Tailwind CSS |
| **معماری** | SSR کامل (بدون React/Next) + ناوبری pjax + API با JSON |
| **زبان / جهت** | فارسی، RTL — فونت Vazirmatn |
| **دارایی‌های استاتیک** | همه محلی؛ بدون CDN |

> **نکتهٔ مهم دربارهٔ ساختار کد:** پوشهٔ `dist/` کدِ **سورس** واقعی و قابل‌ویرایش پروژه است
> (ماژول‌های ES خوانا)، نه خروجی minify شده. برای کد سرور هیچ مرحلهٔ build وجود ندارد؛
> تنها Tailwind CSS اسکریپت build دارد (`npm run build:tailwind`).

## ویژگی‌ها

### بخش فروشگاه

- صفحهٔ اصلی با بلوک‌های قابل‌ویرایش از پنل (بنر اصلی، بنر کناری، بنر میانی)
- مِگا‌منوی دسته‌بندی با شمارش محصولات فعال و ترتیب قابل تنظیم
- فهرست محصولات با فیلتر دسته/برند، جست‌وجو، مرتب‌سازی و صفحه‌بندی
- صفحهٔ محصول: گالری تصاویر، مشخصات، تب پرسش و پاسخ، جعبهٔ خرید
- سبد خرید، تسویه‌حساب و ثبت سفارش (میهمان یا کاربر عضو)
- ارسال رسید کارت‌به‌کارت برای سفارش
- وبلاگ با دیدگاه کاربران، صفحات ثابت (درباره ما، تماس، قوانین، حریم خصوصی)
- خبرنامه، فرم تماس و سیستم تیکت پشتیبانی
- ورود/ثبت‌نام با ایمیل و رمز، یا ورود با کد یک‌بارمصرف پیامکی
- پنل کاربری: سفارش‌ها، تیکت‌ها، ویرایش پروفایل، تغییر رمز

### پنل مدیریت (`/admin/*`)

- داشبورد با آمار فروش و نمودار (Chart.js محلی)
- محصولات: افزودن/ویرایش/حذف، بارگذاری تصویر، قیمت‌گذاری گروهی، ترتیب دستی (Drag & Drop)
- دسته‌بندی‌ها و برندها + صفحهٔ سادهٔ «مدیریت منوی سایت» برای تغییر نام،
  پنهان‌سازی و جابجایی آیتم‌های منو
- سفارش‌ها: تغییر وضعیت، تأیید پرداخت، مدیریت موجودی
- مشتریان و کاربران، تیکت‌ها، دیدگاه‌ها، پیام‌های فرم تماس، خبرنامه
- وبلاگ (نوشته‌ها و دیدگاه‌ها)، محتوای سایت (بلوک‌ها و صفحات ثابت)
- تنظیمات سایت: عنوان، شعار، اطلاعات تماس و کانال‌های گفتگو، تصویر OG
- گزارش‌ها و گزارش فعالیت کاربران (Activity Log)

### امنیت

- احراز هویت JWT با نقش‌های `admin` / `customer`؛ رمزها با bcrypt
- محدودسازی نرخ درخواست (rate limit) روی `/api/auth/*`
- اعتبارسنجی همهٔ ورودی‌ها با zod
- پاک‌سازی HTML محتوای وبلاگ و توضیحات محصول با فهرست سفید (`sanitizeHtml`)
- فرار دادن (escape) خروجی در سرور (`escapeHtml` / `escapeAttr` / `safeJson`) و در
  سمت کلاینت (`escAdmin` / `ncpEsc`) برای جلوگیری از XSS ذخیره‌شده
- عملیات نوشتن فقط با هدر `Authorization: Bearer` (محافظت CSRF)
- رد کردن بارگذاری فایل SVG، محدودیت حجم بدنهٔ درخواست
- فرار دادن کاراکترهای ویژهٔ `LIKE` در جست‌وجو با `ESCAPE '\'`
- حذف‌های سازگار با کلید خارجی: در صورت وابستگی، آرشیو یا خطای 400 — هرگز 500

### اجرای کاملاً آفلاین

Tailwind از پیش build شده، فونت Vazirmatn (۹ وزن، woff2)، FontAwesome 6.4، Axios و
Chart.js همه در `public/static/` قرار دارند. بستهٔ `better-sqlite3` به‌صورت آرشیو
محلی در `local_packages/` همراه پروژه است تا نصب بدون دسترسی به رجیستری هم کار کند.

## آدرس‌ها

### صفحات عمومی

| مسیر | توضیح |
|---|---|
| `/` | صفحهٔ اصلی |
| `/products` | فهرست محصولات (`?category=`، `?brand=`، `?q=`، `?sort=`، `?page=`) |
| `/product/:slug` | صفحهٔ محصول |
| `/categories` | فهرست دسته‌بندی‌ها |
| `/blog` · `/blog/:slug` | وبلاگ و نوشته |
| `/cart` · `/checkout` | سبد خرید و تسویه |
| `/order-success/:orderNumber` | تأیید سفارش |
| `/login` · `/register` · `/account` | ورود، ثبت‌نام، پنل کاربری |
| `/about` · `/contact` · `/privacy` · `/terms` | صفحات ثابت |
| `/sitemap.xml` · `/robots.txt` | سئو |
| `/api/health` | بررسی سلامت سرویس و اتصال دیتابیس |

### پنل مدیریت

| مسیر | توضیح |
|---|---|
| `/admin/login` | ورود مدیر |
| `/admin` | داشبورد |
| `/admin/products` · `/admin/product-order` · `/admin/pricing` | محصولات، ترتیب، قیمت‌گذاری گروهی |
| `/admin/categories` · `/admin/menu-builder` · `/admin/brands` | دسته‌بندی، منو، برند |
| `/admin/orders` | سفارش‌ها |
| `/admin/customers` · `/admin/users` | مشتریان و کاربران |
| `/admin/tickets` · `/admin/messages` · `/admin/comments` | تیکت، پیام، دیدگاه |
| `/admin/posts` | وبلاگ |
| `/admin/site-content` · `/admin/banners` | محتوای سایت و بنرها |
| `/admin/newsletter` | خبرنامه |
| `/admin/reports` · `/admin/activity-logs` | گزارش‌ها |
| `/admin/settings` · `/admin/profile` | تنظیمات و پروفایل مدیر |

### API

عمومی:

```
GET    /api/products                 فهرست محصولات (فیلتر و صفحه‌بندی)
GET    /api/products/:slug           جزئیات محصول
GET    /api/products/featured        محصولات ویژه
GET    /api/products/categories      دسته‌بندی‌ها
GET    /api/products/brands          برندها
POST   /api/products/:id/comments    ثبت پرسش/دیدگاه محصول
GET    /api/blog/posts               فهرست نوشته‌ها
GET    /api/blog/posts/:slug         یک نوشته
POST   /api/blog/posts/:id/comments  ثبت دیدگاه
GET    /api/content/blocks           بلوک‌های صفحهٔ اصلی
GET    /api/content/pages            صفحات ثابت
POST   /api/orders                   ثبت سفارش (میهمان یا کاربر)
GET    /api/orders/by-number/:no     پیگیری سفارش با شمارهٔ آن
POST   /api/orders/by-number/:no/receipt   ارسال رسید پرداخت
POST   /api/tickets                  ثبت تیکت
POST   /api/messages                 فرم تماس
POST   /api/newsletter/subscribe     عضویت در خبرنامه
POST   /api/newsletter/unsubscribe   لغو عضویت
POST   /api/auth/register            ثبت‌نام
POST   /api/auth/login               ورود
POST   /api/auth/otp/send            ارسال کد یک‌بارمصرف
POST   /api/auth/otp/verify          تأیید کد
```

نیازمند JWT مشتری:

```
GET    /api/auth/me                  اطلاعات کاربر جاری
PUT    /api/auth/profile             ویرایش پروفایل
POST   /api/auth/change-password     تغییر رمز
POST   /api/auth/set-password        تعیین رمز (حساب‌های ساخته‌شده با کد پیامکی)
POST   /api/auth/logout              خروج
GET    /api/orders                   سفارش‌های من
GET    /api/orders/:id               یک سفارش
GET    /api/tickets                  تیکت‌های من
GET    /api/tickets/:id              یک تیکت
POST   /api/tickets/:id/replies      پاسخ به تیکت
```

نیازمند JWT مدیر:

```
GET    /api/admin/dashboard          آمار داشبورد
POST   /api/products                 افزودن محصول
PUT    /api/products/:id             ویرایش محصول
DELETE /api/products/:id             حذف محصول
POST   /api/products/reorder         تغییر ترتیب محصولات
POST   /api/products/bulk-price      قیمت‌گذاری گروهی
PUT    /api/orders/:id/status        تغییر وضعیت سفارش
PUT    /api/orders/:id/payment       تأیید پرداخت
DELETE /api/orders/:id               حذف سفارش
GET    /api/admin/categories         مدیریت دسته‌بندی‌ها (POST/PUT/DELETE)
POST   /api/admin/categories/reorder تغییر ترتیب دسته‌ها
GET    /api/admin/brands             مدیریت برندها (POST/PUT/DELETE)
GET    /api/admin/users              مدیریت کاربران (PUT status / DELETE)
GET    /api/admin/messages           پیام‌ها (PUT read / DELETE)
GET    /api/admin/newsletter         مشترکان (DELETE)
GET    /api/admin/settings           خواندن و ذخیرهٔ تنظیمات (PUT)
GET    /api/admin/activity-logs      گزارش فعالیت
POST   /api/admin/upload             بارگذاری تصویر
GET    /api/admin/uploads            کتابخانهٔ فایل‌ها
GET    /api/blog/admin/posts         مدیریت وبلاگ (POST/PUT/DELETE)
GET    /api/blog/admin/comments      مدیریت دیدگاه‌ها (PUT status / DELETE)
GET    /api/content/admin/blocks     مدیریت بلوک‌ها (POST/PUT/DELETE)
GET    /api/content/admin/pages      مدیریت صفحات ثابت (POST/PUT/DELETE)
PUT    /api/tickets/:id/status       تغییر وضعیت تیکت
```

## معماری داده

- **دیتابیس:** MySQL / MariaDB (پیش‌فرض). برای توسعهٔ محلی یا نسخه‌های قدیمی
  می‌توان با `DB_TYPE=sqlite` از SQLite استفاده کرد؛ لایهٔ دسترسی به داده یکسان است.
- **اسکیما:** `dist/db/schema.sql` — با اجرای اپلیکیشن به‌صورت خودکار ساخته/به‌روزرسانی می‌شود.
- **دادهٔ نمونه:** `npm run seed`
- **مهاجرت از SQLite به MySQL:** `node scripts/migrate-sqlite-to-mysql.mjs`
- **فایل‌های بارگذاری‌شده:** `uploads/` و نسخه‌های ریسپانسیو در `public/static/rimg/`

### جداول کلیدی

| جدول | نقش |
|---|---|
| `users` | مدیران و مشتریان (نقش، وضعیت، اطلاعات شرکت) |
| `categories` | دسته‌بندی درختی (`parent_id`, `sort_order`, `show_in_menu`) |
| `brands` | برندها و لوگو |
| `products` | محصولات، قیمت، موجودی، گالری، وضعیت، ترتیب درون دسته |
| `orders` / `order_items` | سفارش‌ها و اقلام آن‌ها |
| `tickets` / `ticket_replies` | پشتیبانی |
| `posts` / `comments` | وبلاگ و دیدگاه‌ها (دیدگاه محصول هم در همین جدول) |
| `messages` | پیام‌های فرم تماس |
| `newsletter_subscribers` | مشترکان خبرنامه (ایمیل نرمال‌شده) |
| `settings` | تنظیمات کلید/مقدار سایت |
| `site_blocks` / `site_pages` | محتوای قابل‌ویرایش صفحهٔ اصلی و صفحات ثابت |
| `activity_logs` | گزارش عملیات مدیران |
| `otp_codes` | کدهای یک‌بارمصرف ورود |

بلوک‌های قابل‌ویرایش صفحهٔ اصلی (`site_blocks.section`):

| مقدار | جایگاه |
|---|---|
| `hero` | بنر اصلی بالای صفحه |
| `side_banner` | بنر ستون کناری |
| `mid_banner` | بنر میانی صفحه |

## راه‌اندازی

### اجرای محلی

```bash
cp .env.example .env          # سپس JWT_SECRET و اطلاعات دیتابیس را پر کنید
npm install
npm run seed                  # ساخت جداول + دادهٔ نمونه (فقط بار اول)
npm start                     # پیش‌فرض روی PORT=3000
```

### Docker (توصیه‌شده)

`docker-compose.yml` دو سرویس بالا می‌آورد: MariaDB 10.11 و اپلیکیشن.

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f app
```

سایت روی `http://localhost:8090` در دسترس است.

```bash
docker compose down       # خاموش کردن (داده حفظ می‌شود)
docker compose down -v    # خاموش + حذف volume (داده پاک می‌شود)
```

### اجرا با PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 logs netcorepro
pm2 save
```

مسیرها در `ecosystem.config.cjs` از محل خود فایل محاسبه می‌شوند، پس پروژه را
می‌توان در هر پوشه‌ای قرار داد.

### دیپلوی روی سرور

- **Linux / VPS:** راهنمای کامل (Nginx، گرفتن گواهی SSL از ZeroSSL/Buypass با
  `acme.sh`، تنظیم دامنه و سرویس) در `DEPLOY_REPORT.html` آمده است.
- **Windows / IIS:** اسکریپت‌های آماده در `deploy/windows/`
  (`install.ps1`، `install_sql.ps1`، `uninstall.ps1`، `web.config`).

### متغیرهای محیطی مهم

| متغیر | توضیح |
|---|---|
| `JWT_SECRET` | کلید امضای توکن — **حتماً تغییر دهید** (`openssl rand -hex 64`) |
| `PORT` | پورت سرور (پیش‌فرض 3000؛ در docker روی 8090 نگاشت می‌شود) |
| `DB_TYPE` | `mysql` (پیش‌فرض) یا `sqlite` |
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | اتصال دیتابیس |
| `DB_PATH` | مسیر فایل SQLite (وقتی `DB_TYPE=sqlite`) |
| `CORS_ORIGINS` | دامنه‌های مجاز، جدا شده با ویرگول یا `*` |
| `MAX_BODY_SIZE_MB` | بیشینهٔ حجم بدنهٔ درخواست (پیش‌فرض 10) |

## حساب‌های پیش‌فرض (پس از seed)

| نقش | ایمیل | رمز |
|---|---|---|
| مدیر | `admin@netcorepro.ir` | `admin123` |
| مشتری | `customer@example.com` | `123456` |

> این رمزها فقط برای شروع و آزمایش‌اند؛ پیش از انتشار عمومی آن‌ها را تغییر دهید.

## تست

مجموعهٔ تست‌ها روی یک نمونهٔ **در حال اجرا** کار می‌کند (پیش‌فرض `http://127.0.0.1:8090`؛
با متغیر `BASE` قابل تغییر است):

```bash
node scripts/run_all.mjs                 # اجرای همهٔ مجموعه‌ها + خلاصهٔ کل
node scripts/test_order_flow.mjs         # اجرای یک مجموعهٔ خاص
BASE=http://127.0.0.1:3000 node scripts/run_all.mjs
```

| مجموعه | موضوع |
|---|---|
| `test_admin_api` | نقاط انتهایی پنل مدیریت |
| `test_dashboard_to_site` | انتشار تغییرات پنل روی سایت |
| `test_pages` | بارگذاری همهٔ صفحات عمومی |
| `test_images` | دسترس‌پذیری تصاویر و نسخه‌های ریسپانسیو |
| `test_ui_health` | سلامت ساختار HTML و دارایی‌های صفحه |
| `test_links` | نبود لینک شکسته |
| `test_forms` | فرم‌ها و اعتبارسنجی فارسی |
| `test_order_flow` | چرخهٔ کامل خرید و موجودی |
| `test_security` | سرصفحه‌های امنیتی و کنترل دسترسی |
| `test_access_control` | تفکیک نقش مدیر/مشتری |
| `test_dashboard_sync` | همگام‌سازی بلوک‌های صفحهٔ اصلی |
| `test_edge_cases` | ورودی‌های نامعتبر/خرابکارانه (هیچ 500) |
| `test_xss` | فرار دادن خروجی در سایت و پنل |
| `test_media_and_reports` | بارگذاری فایل، خبرنامه، گزارش فعالیت، پروفایل |
| `test_special_flows` | ورود با کد پیامکی، رسید پرداخت، تیکت |
| `test_settings_and_deletes` | تنظیمات، بازگشت موجودی، حذف‌های ایمن |
| `test_referential_integrity` | یکپارچگی کلید خارجی و جلوگیری از فروش بیش از موجودی |
| `test_newsletter_and_search` | نرمال‌سازی ایمیل و فرار دادن `LIKE` |
| `test_html_sanitizer` | پاک‌سازی HTML محتوای مدیر |
| `test_settings_injection` | تنظیمات درون attribute های HTML |
| `test_category_images` | نگهبان کیفیت داده برای عکس دسته‌ها (هشدار، نه خطا) |

آزمون‌های رابط کاربری با مرورگر واقعی (Playwright، پایتون) در `scripts/qa/`
و ابزارهای بهینه‌سازی دارایی‌ها (زیرمجموعه‌سازی فونت، بستهٔ CSS، تولید تصاویر
ریسپانسیو) در `scripts/perf/` قرار دارند.

## ساختار پروژه

```
netcorepro/
├── dist/                     کد سورس اپلیکیشن (ماژول ES، بدون build)
│   ├── server.js             نقطهٔ ورود، مسیرهای صفحات، میان‌افزارها
│   ├── api/                  auth · products · orders · tickets · blog · content · misc
│   ├── views/
│   │   ├── shared/           چیدمان مشترک (هدر، مِگا‌منو، فوتر)
│   │   ├── site/             صفحات فروشگاه
│   │   └── admin/            صفحات پنل مدیریت
│   ├── db/                   اتصال، schema.sql، seed
│   ├── middleware/           احراز هویت، محدودسازی نرخ، اعتبارسنجی
│   └── utils/                escape/sanitize، کانال‌های تماس، تولید تصویر
├── public/static/            CSS، JS، فونت، آیکن، تصاویر (همه محلی)
├── uploads/                  فایل‌های بارگذاری‌شده
├── scripts/
│   ├── run_all.mjs           اجراکنندهٔ همهٔ تست‌ها
│   ├── test_*.mjs            مجموعه‌های تست
│   ├── migrate_*.mjs         مهاجرت‌های دیتابیس
│   ├── qa/                   تست رابط کاربری با Playwright
│   └── perf/                 بهینه‌سازی فونت/CSS/تصویر
├── deploy/windows/           اسکریپت‌های نصب روی IIS
├── local_packages/           بستهٔ محلی better-sqlite3 (نصب آفلاین)
├── data/                     فایل دیتابیس SQLite (حالت اختیاری)
├── docker-compose.yml        MariaDB + اپلیکیشن
├── Dockerfile
├── ecosystem.config.cjs      تنظیمات PM2
└── DEPLOY_REPORT.html        راهنمای دیپلوی و SSL
```

## ویژگی‌های پیاده‌نشده

- درگاه پرداخت آنلاین (فعلاً فقط کارت‌به‌کارت با ارسال رسید)
- سرویس واقعی پیامک؛ کد یک‌بارمصرف در حالت نمایشی ثابت است
- ارسال ایمیل (تأیید سفارش، بازیابی رمز، ارسال خبرنامه)
- محاسبهٔ خودکار هزینهٔ ارسال بر اساس وزن یا مقصد
- مقایسهٔ محصولات و فهرست علاقه‌مندی‌ها
- چندزبانه بودن (در حال حاضر فقط فارسی)
- صدور فاکتور رسمی PDF

## گام‌های بعدی پیشنهادی

1. اتصال درگاه پرداخت و سرویس پیامک، سپس حذف کد نمایشی از پاسخ API
2. راه‌اندازی ارسال ایمیل تراکنشی و خبرنامه
3. افزودن پشتیبان‌گیری زمان‌بندی‌شدهٔ دیتابیس و فایل‌های `uploads/`
4. افزودن جست‌وجوی پیشرفته با فیلتر مشخصات فنی محصول
5. اجرای مجموعهٔ تست‌ها در CI پیش از هر انتشار
6. افزودن کش لایهٔ HTTP برای صفحات پربازدید

## لایسنس

مالکانه — تمام حقوق محفوظ است.
