# NetCore Pro — فروشگاه B2B تجهیزات شبکه

**استک:** Hono + Node.js 20 (SSR) + MySQL/MariaDB — بدون نیاز به اینترنت بین‌المللی (فونت‌ها، آیکون‌ها و اسکریپت‌ها لوکال هستند).

کد سرور در پوشهٔ `dist/` است (جاوااسکریپت خوانا، بدون مرحلهٔ build). فایل‌های استاتیک در `public/static/`.

## راه‌اندازی با Docker (پیشنهادی)

```bash
cp .env.example .env
# مقادیر JWT_SECRET (openssl rand -hex 64)، MYSQL_PASSWORD و MYSQL_ROOT_PASSWORD را در .env عوض کنید
docker compose up -d --build
docker compose logs -f app
```

- سایت: `http://SERVER-IP:8090`
- در اولین اجرا، دیتابیس به‌صورت خودکار از `database/netcorepro.sql` (محصولات، دسته‌ها، برندها، مقالات، تنظیمات و حساب مدیر) ساخته می‌شود.
- تصاویر محصولات داخل `public/static/uploads/` و `public/static/rimg/` هستند.

## راه‌اندازی بدون Docker

```bash
cp .env.example .env            # مقادیر را ویرایش کنید
mysql -u root -p -e "CREATE DATABASE netcorepro CHARACTER SET utf8mb4;"
mysql -u root -p netcorepro < database/netcorepro.sql
npm install --omit=dev
npm start                       # پورت پیش‌فرض ۸۹۰۰ در .env قابل تغییر است
```

برای اجرای دائمی می‌توانید از `pm2 start dist/server.js --name netcorepro` استفاده کنید.

## پنل مدیریت

آدرس: `/admin/login`  
نام کاربری اولیه: `admin@netcorepro.ir` — رمز اولیه: `admin123`  
**حتماً پس از اولین ورود، رمز را از بخش پروفایل تغییر دهید.**

## نکات

- **لوگو:** از بخش «تنظیمات» پنل مدیریت قابل تعویض است؛ در غیر این صورت لوگوی پیش‌فرض `public/static/images/logo.png` نمایش داده می‌شود.
- **نماد اعتماد (اینماد):** کد آن در فوتر سایت در فایل `dist/views/shared/layout.js` قرار دارد.
- **استایل‌ها:** پس از تغییر `public/static/css/app.css` برای ساخت بستهٔ CSS سایت اجرا کنید:
  `python3 scripts/perf/build_css.py <نسخه>` (و همان نسخه را در `ASSET_V` فایل `layout.js` بگذارید).
- پشت Nginx/دامنه: مقدار `site_url` را از تنظیمات پنل مدیریت اصلاح کنید.
