# =============================================================================
#  NetCore Pro — Production Dockerfile
#  Author: A.K
# -----------------------------------------------------------------------------
#  Fully offline / air-gapped friendly build:
#    * npm traffic goes to an Iranian mirror (override with --build-arg NPM_REGISTRY)
#    * better-sqlite3 is installed from a vendored tarball, no node-gyp compile
#    * the prebuilt native binary is copied from local_packages/prebuilt
#    * every front-end asset (fonts, icons, CSS, JS) is already inside public/
#      — the container never calls a CDN at runtime
#
#  Build:
#    docker build -t netcorepro:1.0.0 .
#
#  Run (prefer docker compose — see docker-compose.yml):
#    docker run -d --name netcorepro -p 8090:3000 \
#      -v netcorepro_data:/app/data \
#      -v netcorepro_uploads:/app/public/static/uploads \
#      -v netcorepro_rimg:/app/public/static/rimg \
#      -e JWT_SECRET="$(openssl rand -hex 64)" \
#      --restart unless-stopped netcorepro:1.0.0
# =============================================================================

# ------------------------------- Stage 1: deps -------------------------------
FROM node:20-slim AS deps

ARG NPM_REGISTRY=https://package-mirror.liara.ir/repository/npm/

RUN npm config set registry "${NPM_REGISTRY}" \
 && npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-timeout 600000

WORKDIR /app

# 1) better-sqlite3 from the vendored tarball — never compiled, never downloaded.
COPY local_packages/better-sqlite3.tgz /tmp/better-sqlite3.tgz
RUN mkdir -p node_modules \
 && npm install --ignore-scripts --no-audit --no-fund /tmp/better-sqlite3.tgz

# 2) Remaining runtime dependencies (no devDependencies — assets are pre-built).
#    NOTE: this must run BEFORE the native addon is dropped in. npm rewrites the
#    better-sqlite3 package directory while reconciling the lockfile, which would
#    silently delete a binary copied in earlier and leave the image broken.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund

# 3) Drop in the pre-compiled native addon (linux/amd64, glibc) — last write wins.
RUN mkdir -p /app/node_modules/better-sqlite3/build/Release
COPY local_packages/prebuilt/better_sqlite3.node \
     /app/node_modules/better-sqlite3/build/Release/better_sqlite3.node

# 4) Fail the build early if the native module cannot be loaded.
RUN node -e "import('better-sqlite3').then(m=>{new m.default(':memory:').prepare('SELECT 1').get();console.log('better-sqlite3 OK')})"

# ------------------------------ Stage 2: runtime -----------------------------
FROM node:20-slim AS runtime

# tini gives us correct PID-1 signal handling so SIGTERM reaches Node and the
# SQLite WAL is checkpointed cleanly on `docker stop`.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 app \
 && useradd  --system --uid 1001 --gid app --home-dir /app --shell /usr/sbin/nologin app

WORKDIR /app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app dist          ./dist
COPY --chown=app:app public        ./public
COPY --chown=app:app package.json  ./
COPY --chown=app:app docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# Baked-in seed copies. The entrypoint restores these into empty named volumes
# on first boot, so a fresh `docker compose up` still ships the full catalogue
# imagery instead of an empty gallery.
COPY --chown=app:app data/netcorepro.db        /app/seed/netcorepro.db
COPY --chown=app:app public/static/uploads     /app/seed/uploads
COPY --chown=app:app public/static/rimg        /app/seed/rimg

RUN chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/data /app/public/static/uploads /app/public/static/rimg \
 && chown -R app:app /app/data /app/public/static/uploads /app/public/static/rimg

USER app

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/netcorepro.db \
    TZ=Asia/Tehran

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/api/health >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/server.js"]
