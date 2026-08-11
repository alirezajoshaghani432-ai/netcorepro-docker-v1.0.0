# NetCore Pro — فروشگاه تخصصی تجهیزات شبکه

**نسخه:** 1.0.0  |  **نویسنده:** A.K  |  **وضعیت:** آمادهٔ استقرار روی سرور

فروشگاه اینترنتی فارسی (راست‌به‌چپ) برای تجهیزات شبکه، فیبر نوری و برق ساختمان،
شامل ویترین عمومی، سبد خرید، فرایند سفارش، پنل مشتری و پنل مدیریت کامل.

---

## ۱) پشتهٔ فنی

| لایه | فناوری |
|---|---|
| زمان اجرا | Node.js 20 (ESM) |
| فریم‌ورک وب | Hono 4 + `@hono/node-server` |
| رندر صفحه | SSR سمت سرور با template literal — بدون فریم‌ورک سمت کلاینت |
| پایگاه داده | SQLite (better-sqlite3) با حالت WAL |
| احراز هویت | JWT (`jsonwebtoken`) + bcryptjs |
| اعتبارسنجی ورودی | Zod |
| ظاهر | CSS اختصاصی + Tailwind از پیش build شده |
| فونت و آیکون | Vazirmatn و Font Awesome به‌صورت محلی (بدون CDN) |
| بسته‌بندی | Docker چندمرحله‌ای + Docker Compose |

> **هیچ درخواستی به CDN خارجی زده نمی‌شود.** تمام فونت‌ها، آیکون‌ها، CSS و
> JavaScript داخل `public/static/` قرار دارند؛ بنابراین سایت روی سرور داخل ایران
> و حتی در شبکهٔ کاملاً بسته هم بدون مشکل بالا می‌آید.

---

## ۲) راه‌اندازی سریع (سه دستور)

پیش‌نیاز: Docker Engine 24+ و افزونهٔ Docker Compose روی سرور لینوکسی.

```bash
# ۱) فایل تنظیمات را بسازید و یک کلید امن تولید کنید
cp .env.example .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 64)|" .env

# ۲) ساخت ایمیج و بالا آوردن سرویس
docker compose up -d --build

# ۳) بررسی سلامت تمام مسیرها
./scripts/healthcheck.sh http://127.0.0.1:8090
```

سایت روی `http://<آی‌پی-سرور>:8090/site1` بالا می‌آید.

> **ساخت روی سرور بدون اینترنت آزاد:** مقدار پیش‌فرض `NPM_REGISTRY` به آینهٔ
> داخلی Liara اشاره می‌کند. اگر سرور دسترسی آزاد دارد، در `.env` آن را به
> `https://registry.npmjs.org/` تغییر دهید.

---

## ۳) آدرس‌های اصلی

### ویترین عمومی
| صفحه | مسیر |
|---|---|
| صفحهٔ اصلی | `/site1` |
| فهرست محصولات | `/site1/products` |
| صفحهٔ محصول | `/site1/product/<slug>` |
| دسته‌بندی‌ها | `/site1/categories` |
| مقالات | `/site1/blog` |
| دربارهٔ ما | `/site1/about` |
| تماس با ما | `/site1/contact` |
| سبد خرید / تسویه | `/site1/cart` · `/site1/checkout` |
| ورود / ثبت‌نام مشتری | `/site1/login` · `/site1/register` |
| حساب کاربری | `/site1/account` |

### پنل مدیریت
| بخش | مسیر |
|---|---|
| ورود مدیر | `/admin/login` |
| داشبورد | `/admin` |
| محصولات | `/admin/products` |
| چیدمان محصولات | `/admin/product-order` |
| مدیریت بنرها | `/admin/banners` |
| دسته‌بندی‌ها | `/admin/categories` |
| منوساز سایت | `/admin/menu-builder` |
| برندها | `/admin/brands` |
| سفارش‌ها | `/admin/orders` |
| مشتریان | `/admin/customers` |
| تیکت‌ها | `/admin/tickets` |
| دیدگاه‌ها | `/admin/comments` |
| مقالات | `/admin/posts` |
| محتوای صفحات | `/admin/site-content` |
| قیمت‌گذاری | `/admin/pricing` |
| پیام‌ها و خبرنامه | `/admin/messages` · `/admin/newsletter` |
| گزارش‌ها | `/admin/reports` |
| لاگ فعالیت | `/admin/activity-logs` |
| تنظیمات | `/admin/settings` |

### سرویس‌های سیستمی
| مورد | مسیر |
|---|---|
| بررسی سلامت | `/api/health` |
| فهرست API | `/api` |
| نقشهٔ سایت | `/sitemap.xml` |
| robots | `/robots.txt` |

---

## ۴) ساختار پروژه

```
netcorepro/
├── Dockerfile                  ساخت چندمرحله‌ای، کاربر غیر-root، tini، healthcheck
├── docker-compose.yml          سرویس اپ + پروکسی اختیاری + سه volume دائمی
├── .env.example                الگوی متغیرهای محیطی
├── .dockerignore
│
├── docker/
│   ├── entrypoint.sh           اعتبارسنجی کلید، بازیابی داده در volume خالی
│   └── nginx.conf              پروکسی معکوس، gzip، کش، محدودسازی نرخ، جای TLS
│
├── dist/                       کد سرور (ESM، خوانا و کامنت‌گذاری‌شده)
│   ├── server.js               راه‌اندازی، میان‌افزارها، مسیرها، فایل ایستا
│   ├── db/
│   │   ├── index.js            اتصال SQLite + مهاجرت‌های خودکار idempotent
│   │   ├── schema.sql          تعریف جداول
│   │   ├── seed.js             دادهٔ اولیه
│   │   ├── mysql.js  mssql.js  درایورهای جایگزین (آزمایشی)
│   ├── api/                    auth · products · orders · tickets · blog · content · misc
│   ├── middleware/             auth.js (JWT + نقش) · rate-limit.js
│   ├── utils/                  img · imggen · contact · helpers · jwt
│   └── views/
│       ├── site/pages.js       تمام صفحات ویترین
│       ├── admin/pages.js      تمام صفحات پنل
│       ├── admin/menu-builder.js
│       └── shared/layout.js    چیدمان مشترک، هدر، فوتر، متا و SEO
│
├── public/static/
│   ├── css/  js/  fonts/  webfonts/   دارایی‌های از پیش build شده
│   ├── images/                 تصاویر ثابت قالب
│   ├── uploads/                تصاویر بارگذاری‌شده از پنل  ← volume
│   └── rimg/                   نسخه‌های WebP تولیدشده      ← volume
│
├── data/netcorepro.db          پایگاه دادهٔ کامل با دادهٔ واقعی ← volume
│
├── scripts/
│   ├── healthcheck.sh          تست دود روی تمام مسیرهای حیاتی
│   ├── backup.sh               پشتیبان‌گیری یکپارچه (دیتابیس + تصاویر)
│   ├── restore.sh              بازگردانی از آرشیو با نسخهٔ ایمنی
│   └── reset-admin-password.sh تغییر رمز مدیر
│
└── docs/HANDOFF-REPORT.html    گزارش فنی تحویل
```

---

## ۵) دادهٔ همراه بسته

پایگاه داده با محتوای واقعی سایت تحویل داده می‌شود:

| جدول | تعداد رکورد |
|---|---|
| محصولات | ۹۹ |
| دسته‌بندی‌ها (دو سطحی) | ۳۵ |
| برندها | ۱۰ |
| سفارش‌ها | ۲۲ |
| اقلام سفارش | ۲۳ |
| کاربران | ۳۹ |
| تنظیمات سایت | ۴۵ |
| بلوک‌های محتوایی (بنر، اسلاید، ویژگی) | ۲۲ |
| صفحات محتوایی | ۶ |
| مقالات | ۳ |
| تیکت‌ها | ۲۱ |
| دیدگاه‌ها | ۱۴ |
| مشترکان خبرنامه | ۳۰ |

به‌همراه حدود **۳۷۰ فایل تصویر** محصولات و بنرها و نسخه‌های WebP آن‌ها.

---

## ۶) نگهداری روزمره

```bash
docker compose ps                    # وضعیت و سلامت
docker compose logs -f app           # لاگ زنده
docker compose restart app           # ری‌استارت سرویس
docker compose down                  # توقف (داده‌ها حفظ می‌شود)
docker compose up -d --build         # اعمال تغییرات کد

./scripts/backup.sh                  # پشتیبان کامل
./scripts/restore.sh backups/<file>  # بازگردانی (پرسش تأیید)
./scripts/restore.sh backups/<file> --yes   # بازگردانی بدون پرسش (cron/اسکریپت)
./scripts/healthcheck.sh             # تست سلامت
```

پشتیبان‌گیری خودکار روزانه (ساعت ۳ بامداد، نگهداری ۱۴ روز):

```bash
0 3 * * * cd /opt/netcorepro && ./scripts/backup.sh >> /var/log/ncp-backup.log 2>&1
```

---

## ۷) کارهای الزامی پیش از انتشار عمومی

این موارد **باید** توسط تیم فنی به‌صورت دستی انجام شود. شرح کامل هرکدام در
`docs/HANDOFF-REPORT.html` بخش «کارهای دستی» آمده است.

1. تولید و ثبت `JWT_SECRET` تصادفی در `.env`
2. تغییر رمز حساب مدیر با `./scripts/reset-admin-password.sh`
3. اتصال سرویس پیامک برای کد یک‌بارمصرف (در حال حاضر کد ثابت آزمایشی است)
4. اتصال درگاه پرداخت آنلاین (در حال حاضر فقط کارت‌به‌کارت فعال است)
5. تنظیم دامنه، گواهی TLS و پروکسی معکوس
6. بازبینی اطلاعات تماس، شمارهٔ کارت و شبکه‌های اجتماعی در `/admin/settings`
7. فعال‌سازی پشتیبان‌گیری زمان‌بندی‌شده
8. محدودسازی دسترسی به مسیر `/admin` در سطح فایروال یا پروکسی (اختیاری ولی توصیه‌شده)

---

## ۸) پشتیبانی و نکات فنی مهم

- ستون رمز عبور در جدول `users` نام **`password`** دارد (نه `password_hash`).
- الگوریتم هش **bcrypt با cost = 10** است.
- SQLite در حالت **WAL** کار می‌کند؛ هنگام کپی دستی فایل، حتماً فایل‌های
  `-wal` و `-shm` را هم در نظر بگیرید یا از `scripts/backup.sh` استفاده کنید.
- تغییر `JWT_SECRET` تمام نشست‌های فعال را باطل می‌کند.
- مهاجرت‌های پایگاه داده در `dist/db/index.js` به‌صورت **idempotent** در هر
  بالا آمدن سرویس اجرا می‌شوند؛ نیازی به اجرای دستی نیست.

---

© NetCore Pro — تمام حقوق محفوظ است.
