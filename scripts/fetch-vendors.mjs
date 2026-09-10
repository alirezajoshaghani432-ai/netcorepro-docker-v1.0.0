#!/usr/bin/env node
/**
 * fetch-vendors.mjs
 * Downloads all third-party assets (fonts, CSS, JS) used by the site/admin
 * to public/static/{css,js,fonts,webfonts} so the application has ZERO
 * runtime dependency on external CDNs.
 *
 * Usage:  node scripts/fetch-vendors.mjs
 *
 * Re-run anytime; existing files are overwritten.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUB = join(ROOT, 'public', 'static');

const CSS_DIR    = join(PUB, 'css');
const JS_DIR     = join(PUB, 'js');
const FONTS_DIR  = join(PUB, 'fonts', 'vazirmatn');
const FA_FONTS   = join(PUB, 'webfonts');

[CSS_DIR, JS_DIR, FONTS_DIR, FA_FONTS].forEach(d => mkdirSync(d, { recursive: true }));

async function fetchText(url) {
  console.log('  fetch', url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return await r.text();
}
async function fetchBinary(url) {
  console.log('  fetch', url);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// ============================================================
// 1) Vazirmatn font (Persian)
// ============================================================
const VAZIR_VERSION = 'v33.003';
const VAZIR_BASE    = `https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@${VAZIR_VERSION}`;
const VAZIR_WEIGHTS = ['100','200','300','400','500','600','700','800','900'];

console.log('• Vazirmatn font...');
for (const w of VAZIR_WEIGHTS) {
  const file = `Vazirmatn-${w === '400' ? 'Regular' : (w === '700' ? 'Bold' : ('weight-' + w))}.woff2`;
  // The repo actually uses fixed weight names. Use the official subset.
  const url = `${VAZIR_BASE}/fonts/webfonts/Vazirmatn-${getWeightName(w)}.woff2`;
  try {
    const buf = await fetchBinary(url);
    writeFileSync(join(FONTS_DIR, `Vazirmatn-${getWeightName(w)}.woff2`), buf);
  } catch (e) {
    console.warn('  skip ' + w + ': ' + e.message);
  }
}
function getWeightName(w) {
  const map = { '100':'Thin','200':'ExtraLight','300':'Light','400':'Regular','500':'Medium','600':'SemiBold','700':'Bold','800':'ExtraBold','900':'Black' };
  return map[w] || 'Regular';
}

// Write a local @font-face CSS file
const vazirCss = VAZIR_WEIGHTS.map(w => {
  const name = getWeightName(w);
  return `@font-face {
  font-family: 'Vazirmatn';
  font-style: normal;
  font-weight: ${w};
  font-display: swap;
  src: url('/static/fonts/vazirmatn/Vazirmatn-${name}.woff2') format('woff2');
}`;
}).join('\n');
writeFileSync(join(CSS_DIR, 'vazirmatn.css'), vazirCss);
console.log('  -> /static/css/vazirmatn.css');

// ============================================================
// 2) Tailwind CSS — use the official CDN build but saved locally.
//    This bundles the full Tailwind runtime so JIT works in-browser.
// ============================================================
console.log('• Tailwind CSS (Play CDN runtime)...');
try {
  const tw = await fetchText('https://cdn.tailwindcss.com/3.4.16');
  writeFileSync(join(JS_DIR, 'tailwind.js'), tw);
  console.log('  -> /static/js/tailwind.js  (' + (tw.length/1024|0) + ' KB)');
} catch (e) {
  console.warn('  Tailwind fetch failed: ' + e.message + ' — falling back to /3');
  const tw = await fetchText('https://cdn.tailwindcss.com');
  writeFileSync(join(JS_DIR, 'tailwind.js'), tw);
}

// ============================================================
// 3) FontAwesome 6.4.0 Free
// ============================================================
console.log('• FontAwesome 6.4.0...');
const FA_BASE = 'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0';
const faCss = await fetchText(`${FA_BASE}/css/all.min.css`);
// Rewrite ../webfonts/ paths to /static/webfonts/
const faCssLocal = faCss.replace(/url\(\.\.\/webfonts\//g, "url('/static/webfonts/").replace(/\.woff2\)/g, ".woff2')").replace(/\.ttf\)/g, ".ttf')");
writeFileSync(join(CSS_DIR, 'fontawesome.min.css'), faCssLocal);
console.log('  -> /static/css/fontawesome.min.css');

const faFiles = [
  'fa-solid-900.woff2','fa-solid-900.ttf',
  'fa-regular-400.woff2','fa-regular-400.ttf',
  'fa-brands-400.woff2','fa-brands-400.ttf',
  'fa-v4compatibility.woff2','fa-v4compatibility.ttf'
];
for (const f of faFiles) {
  try {
    const buf = await fetchBinary(`${FA_BASE}/webfonts/${f}`);
    writeFileSync(join(FA_FONTS, f), buf);
  } catch (e) {
    console.warn('  skip ' + f + ': ' + e.message);
  }
}

// ============================================================
// 4) Axios 1.6.0
// ============================================================
console.log('• Axios 1.6.0...');
const axiosJs = await fetchText('https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js');
writeFileSync(join(JS_DIR, 'axios.min.js'), axiosJs);
console.log('  -> /static/js/axios.min.js');

// ============================================================
// 5) Chart.js (used by admin reports page)
// ============================================================
console.log('• Chart.js...');
try {
  const chartJs = await fetchText('https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js');
  writeFileSync(join(JS_DIR, 'chart.min.js'), chartJs);
  console.log('  -> /static/js/chart.min.js');
} catch (e) {
  console.warn('  Chart.js failed: ' + e.message);
}

console.log('\n✅ Vendor assets fetched. The app is now fully self-hosted (no CDN at runtime).');
