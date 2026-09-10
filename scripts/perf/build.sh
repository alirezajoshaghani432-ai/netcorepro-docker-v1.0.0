#!/usr/bin/env bash
# NetCore Pro — storefront asset pipeline (F2).
# Usage: bash scripts/perf/build.sh            (version read from layout.js)
set -euo pipefail
cd "$(dirname "$0")/../.."
V="$(grep -oP "ASSET_V = '\K[^']+" dist/views/shared/layout.js)"
echo "▸ ASSET_V = $V"
python3 scripts/perf/collect_icons.py
python3 scripts/perf/subset_fonts.py
python3 scripts/perf/build_css.py "$V"
