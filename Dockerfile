# ===================================================================
#  NetCore Pro — Dockerfile (نسخه آفلاین برای ایران)
# -------------------------------------------------------------------
#  این Dockerfile به‌صورت کامل آفلاین است:
#    - فقط از Liara mirror برای npm استفاده می‌کند
#    - هیچ‌گاه به cdn.jsdelivr.net، cdn.tailwindcss.com یا
#      registry.npmjs.org درخواست نمی‌فرستد
#    - باینری native (better-sqlite3) از local_packages/ کپی می‌شود
#    - تمام static asset ها (Tailwind, Vazirmatn, FontAwesome,
#      Axios, Chart.js) از قبل در public/static/ هستند
#
#  ساخت:
#    docker build -t netcorepro:latest .
#
#  اجرا (پیشنهادی): docker compose up -d --build
#  (دیتابیس MySQL/MariaDB در docker-compose.yml تعریف شده است)
#
#  درباره «کد بیلدشده»: پوشه dist/ خروجی مینیفای/باندل نیست؛
#  جاوااسکریپت ES Module خوانا و قابل‌ویرایش است و همین، سورس واقعی
#  پروژه است. هیچ مرحله کامپایل برای کد سرور وجود ندارد.
# ===================================================================

# ===== Stage 1: Builder (با ابزارهای build) =====
FROM node:20-slim AS builder

# تنظیم آینه npm ایرانی (Liara)
RUN npm config set registry https://package-mirror.liara.ir/repository/npm/ && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000

WORKDIR /app

# ---------------------------------------------------------------
# 1) نصب better-sqlite3 از tarball محلی (بدون اسکریپت/دانلود)
# ---------------------------------------------------------------
COPY local_packages/better-sqlite3.tgz /tmp/better-sqlite3.tgz
RUN mkdir -p node_modules && \
    npm install --ignore-scripts --no-audit --no-fund /tmp/better-sqlite3.tgz

# جایگذاری فایل باینری از پیش کامپایل‌شده
RUN mkdir -p /app/node_modules/better-sqlite3/build/Release
COPY local_packages/prebuilt/better_sqlite3.node \
     /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node

# ---------------------------------------------------------------
# 2) نصب سایر وابستگی‌ها (بدون dev deps چون assetها از قبل build شده)
# ---------------------------------------------------------------
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

# ---------------------------------------------------------------
# 3) کپی کامل پروژه (static assetها و dist از قبل آماده هستند)
# ---------------------------------------------------------------
COPY dist            ./dist
COPY public          ./public
COPY scripts         ./scripts

# اطمینان از وجود پوشه‌های runtime
RUN mkdir -p /app/data /app/uploads

# ---------------------------------------------------------------
# 4) تست سریع: مطمئن شویم native module بدون مشکل load می‌شود
# ---------------------------------------------------------------
RUN node -e "import('better-sqlite3').then(m => { new m.default(':memory:').prepare('SELECT 1').get(); console.log('✅ better-sqlite3 binary OK'); })"

# ===== Stage 2: Runtime (image سبک) =====
FROM node:20-slim AS runtime

# user غیر root برای امنیت
RUN groupadd --system app && useradd --system --gid app --home /app app

WORKDIR /app

# کپی همه‌چیز از stage builder
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist         ./dist
COPY --from=builder --chown=app:app /app/public       ./public
COPY --from=builder --chown=app:app /app/scripts      ./scripts
COPY --from=builder --chown=app:app /app/package.json ./

# پوشه‌های runtime (data و uploads باید volume باشند)
RUN mkdir -p /app/data /app/uploads && chown -R app:app /app/data /app/uploads

USER app

ENV NODE_ENV=production
ENV PORT=3000

# Healthcheck برای orchestratorها (Docker, K8s, ...)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

EXPOSE 3000

# seed دیتابیس در اولین اجرا (idempotent — اگر داده وجود داشت، چیزی نمی‌نویسد)
# و سپس سرور را اجرا می‌کنیم.
# انتظار برای آماده‌شدن دیتابیس، سپس seed امن (فقط دیتابیس خالی) و اجرا
COPY --chown=app:app scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
CMD ["sh", "./scripts/docker-entrypoint.sh"]
