#!/usr/bin/env bash
# =============================================================================
#  NetCore Pro — post-deployment smoke test
#  Author: A.K
# -----------------------------------------------------------------------------
#  Walks every critical public and administrative route and reports the HTTP
#  status of each. Run it right after the first `docker compose up -d` and
#  after every future deployment.
#
#  Usage:
#      ./scripts/healthcheck.sh                       # defaults to :8090
#      ./scripts/healthcheck.sh https://netcorepro.ir
# =============================================================================
set -uo pipefail

BASE="${1:-http://127.0.0.1:8090}"
PASS=0
FAIL=0

check() {
  local path="$1" expect="${2:-200}" label="${3:-$1}"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -m 20 "${BASE}${path}" || echo 000)"
  if [ "${code}" = "${expect}" ]; then
    printf '  \033[32m✓\033[0m %-3s  %s\n' "${code}" "${label}"
    PASS=$((PASS + 1))
  else
    printf '  \033[31m✗\033[0m %-3s  %s   (expected %s)\n' "${code}" "${label}" "${expect}"
    FAIL=$((FAIL + 1))
  fi
}

echo
echo "NetCore Pro smoke test — ${BASE}"
echo "------------------------------------------------------------"

echo "Public storefront"
check "/site1"                              200 "home page"
check "/site1/products"                     200 "product listing"
check "/site1/product/dlink-dwr-m921"       200 "product detail"
check "/site1/categories"                   200 "category index"
check "/site1/blog"                         200 "article index"
check "/site1/about"                        200 "about (counters)"
check "/site1/contact"                      200 "contact"
check "/site1/cart"                         200 "cart"
check "/site1/login"                        200 "customer sign-in"
check "/site1/register"                     200 "customer sign-up"

echo
echo "Administration"
check "/admin/login"                        200 "admin sign-in"
check "/admin/banners"                      200 "banner manager"
check "/admin/product-order"                200 "product ordering"

echo
echo "API & SEO"
check "/api/health"                         200 "health probe"
check "/api/products"                       200 "product API"
check "/sitemap.xml"                        200 "sitemap"
check "/robots.txt"                         200 "robots"

echo
echo "Static assets"
check "/static/css/nc-site.min.css"         200 "site stylesheet"
check "/static/js/site.js"                  200 "site runtime"

echo "------------------------------------------------------------"
if [ "${FAIL}" -eq 0 ]; then
  printf '\033[32mAll %d checks passed.\033[0m\n\n' "${PASS}"
  exit 0
fi
printf '\033[31m%d of %d checks failed.\033[0m Inspect with: docker compose logs --tail=100 app\n\n' \
  "${FAIL}" "$((PASS + FAIL))"
exit 1
