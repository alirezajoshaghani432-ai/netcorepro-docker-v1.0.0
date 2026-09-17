# NetCore Pro — SQL Server + SEO/PDP update (v1.1.0)

## Database
- Default engine is now **Microsoft SQL Server** (`DB_TYPE=mssql`).
- MySQL and SQLite remain available as fallbacks.
- Docker Compose runs SQL Server 2022 + the Node SSR app.
- Existing rows are **never deleted**:
  - docker-entrypoint migrates SQLite → MSSQL only when `users` is empty/missing
  - `seed.js` exits if users already exist (use `--force` to reseed)
  - migrate scripts preserve IDs (IDENTITY_INSERT) and verify row counts

## SEO / SSR
- Public brand is **NetCore Pro** (title, og:site_name, WebSite + Organization JSON-LD).
- Legacy `/site1` and `/site1/*` permanently 301 to the root paths.
- `sitemap.xml` and `robots.txt` stay on the SSR server.

## Product page
- Colourful expert-button grid removed; consultation block kept.
- Replacement: `.nc-buybox-help` in the buy box.
- Hallucinated key-features list hidden on the storefront.
- Full product description moved to `#pdp-description` at the bottom.
- Router promo image (`banner-mid-2-router.jpg`) is not used as a fallback gallery image.
- Debug short text (`R7 valid edit …`) is stripped.

## Run
```bash
cp .env.example .env
# set JWT_SECRET and MSSQL_SA_PASSWORD
docker compose up -d --build
```
Site: http://localhost:8090/
