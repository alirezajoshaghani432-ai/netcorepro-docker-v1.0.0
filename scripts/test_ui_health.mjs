#!/usr/bin/env node
/* UI / CSS health test:
 *  - every nc-* class used in served HTML is defined in app.css
 *  - no unrendered ${...} template-literal leaks outside <script> blocks
 *  - every onclick/onchange handler maps to a defined function
 *  - key button classes exist with expected rules
 *  - pagination markup uses is-active (not stale "active") and renders page index
 */
import fs from 'fs';
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass = 0, fail = 0; const failures = [];
function log(ok, name, d) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; failures.push(name + (d ? ' :: ' + d : '')); console.log(`  \x1b[31m✗\x1b[0m ${name}${d ? '  -> ' + d : ''}`); }
}
function section(t){ console.log(`\n\x1b[36m── ${t} ──\x1b[0m`); }

const PAGES = [
  '/', '/products', '/categories', '/blog',
  '/cart', '/checkout', '/login', '/register',
  '/account', '/about', '/contact', '/privacy', '/terms',
  '/admin/login', '/admin', '/admin/products', '/admin/orders', '/admin/site-content'
];

const css = fs.readFileSync('public/static/css/app.css', 'utf8');
const definedNc = new Set();
for (const m of css.matchAll(/\.(nc-[a-z0-9-]+)/g)) definedNc.add(m[1]);
// functional hooks that are intentionally style-less (JS selectors only)
const HOOK_ONLY = new Set(['nc-imgfield']);

async function getHtml(p){ return await (await fetch(BASE + p)).text(); }

async function main() {
  section('Every nc-* class used in HTML is defined in app.css');
  const usedMap = {};
  for (const p of PAGES) {
    const html = await getHtml(p);
    for (const m of html.matchAll(/class="([^"]+)"/g))
      for (let cls of m[1].split(/\s+/)) {
        cls = cls.trim();
        if (cls.startsWith('nc-')) (usedMap[cls] = usedMap[cls] || new Set()).add(p);
      }
  }
  const missing = Object.keys(usedMap).sort().filter(c => !definedNc.has(c) && !HOOK_ONLY.has(c));
  log(missing.length === 0, 'no undefined nc-* classes in rendered HTML',
      missing.length ? missing.join(', ') : `${Object.keys(usedMap).length} classes all defined`);

  section('No unrendered template-literal leaks in markup');
  for (const p of PAGES) {
    const html = await getHtml(p);
    const noScript = html.replace(/<script[\s\S]*?<\/script>/g, '');
    const leak = noScript.match(/\$\{[^}]*\}/g);
    log(!leak, `clean markup: ${p}`, leak ? leak.slice(0, 2).join(' | ') : '');
  }

  section('Inline event handlers map to defined functions');
  // Pre-load globals defined in external JS bundles referenced by the pages.
  async function externalGlobals(html) {
    const g = new Set();
    for (const m of html.matchAll(/<script[^>]+src="(\/static\/js\/[^"?]+\.js)(?:\?[^"]*)?"/g)) {
      const path = m[1].replace(/^\//, '');
      try {
        const src = fs.readFileSync('public/' + path.replace(/^static\//, 'static/'), 'utf8');
        for (const mm of src.matchAll(/window\.([a-zA-Z_$][\w$]*)\s*=/g)) g.add(mm[1]);
        for (const mm of src.matchAll(/function\s+([a-zA-Z_$][\w$]*)\s*\(/g)) g.add(mm[1]);
      } catch { /* bundle not on disk (cdn vendor) — ignore */ }
    }
    return g;
  }
  for (const p of PAGES) {
    const html = await getHtml(p);
    const handlers = new Set();
    for (const m of html.matchAll(/on(?:click|change|submit|input|keypress)="([a-zA-Z_$][\w$]*)\s*\(/g)) handlers.add(m[1]);
    const defined = new Set(['NCPCart','axios','dayjs','_']);
    for (const m of html.matchAll(/function\s+([a-zA-Z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
    for (const m of html.matchAll(/window\.([a-zA-Z_$][\w$]*)\s*=/g)) defined.add(m[1]);
    for (const m of html.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/g)) defined.add(m[1]);
    for (const g of await externalGlobals(html)) defined.add(g);
    const miss = [...handlers].filter(h => !defined.has(h));
    log(miss.length === 0, `handlers resolved: ${p}`, miss.length ? miss.join(', ') : `${handlers.size} ok`);
  }

  section('Admin page inline handlers map to defined functions (source-level)');
  // Admin routes redirect to login when unauthed, so HTTP-fetched HTML never shows
  // the real admin handlers. Check them statically from the SSR source + admin.js bundle.
  {
    const adminSrc = fs.readFileSync('dist/views/admin/pages.js', 'utf8');
    const adminJs = fs.readFileSync('public/static/js/admin.js', 'utf8');
    const all = adminSrc + '\n' + adminJs;
    const handlers = new Set();
    for (const m of adminSrc.matchAll(/on(?:click|change|submit|input|keypress)=\\?["'`]?\s*([a-zA-Z_$][\w$]*)\s*\(/g)) handlers.add(m[1]);
    const defined = new Set(['axios','dayjs','_','confirm','alert','location']);
    for (const m of all.matchAll(/function\s+([a-zA-Z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
    for (const m of all.matchAll(/window\.([a-zA-Z_$][\w$]*)\s*=/g)) defined.add(m[1]);
    for (const m of all.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/g)) defined.add(m[1]);
    for (const m of all.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?function/g)) defined.add(m[1]);
    const miss = [...handlers].filter(h => !defined.has(h));
    log(miss.length === 0, `admin handlers all defined (${handlers.size} found)`, miss.length ? 'MISSING: '+miss.join(', ') : 'ok');
  }

  section('Key button classes have CSS rules');
  for (const cls of ['nc-btn-primary','nc-btn-outline','nc-page-btn','nc-icon-btn','nc-search-btn','nc-bottomnav-cart','nc-muted']) {
    log(definedNc.has(cls), `.${cls} defined`);
  }

  section('Pagination uses is-active (not stale "active") + renders index');
  const pjs = fs.readFileSync('dist/views/site/pages.js', 'utf8');
  const pagLine = (pjs.split('\n').find(l => l.includes('nc-page-btn')) || '');
  log(pagLine.includes("'is-active'"), 'pagination uses is-active class', pagLine.trim().slice(0, 80));
  log(!/nc-page-btn[\s\S]{0,120}formatPrice\(i\)/.test(pjs), 'pagination shows page number, not formatPrice(i)');

  section('Inline scripts do not call NCPCart/NCPAuth before runtime is ready');
  // Direct top-level calls to window.NCPCart at parse time crash (defer race).
  // They must be wrapped in ncpReady(...) or an event listener.
  const pjs2 = fs.readFileSync('dist/views/site/pages.js', 'utf8');
  // ncpReady must exist in the shared layout head
  const layout = fs.readFileSync('dist/views/shared/layout.js', 'utf8');
  log(layout.includes('window.ncpReady'), 'ncpReady guard defined in shared layout head');
  // the three init calls must be guarded
  for (const fn of ['renderCart', 'renderCheckout', 'loadAccount']) {
    const guarded = pjs2.includes(`ncpReady(${fn})`);
    const bareCall = new RegExp(`^\\s+${fn}\\(\\);`, 'm').test(pjs2);
    log(guarded && !bareCall, `${fn}() init is guarded by ncpReady (no bare call)`);
  }

  section('DOM-XSS guard: ncpEsc defined and used on user-data client renders');
  const siteJs = fs.readFileSync('public/static/js/site.js', 'utf8');
  log(/window\.ncpEsc\s*=/.test(siteJs), 'window.ncpEsc helper defined in site.js');
  for (const expr of ['ncpEsc(p.name', 'ncpEsc(it.name', 'ncpEsc(o.customer_name', 'ncpEsc(o.shipping_address', 'ncpEsc(t.subject', 'ncpEsc(rp.message']) {
    log(pjs2.includes(expr), `client render escapes ${expr.replace('ncpEsc(','')}`);
  }
  log(!/>\$\{p\.name\}</.test(pjs2), 'no bare ${p.name} in client markup');
  log(!/>\$\{o\.customer_name\}</.test(pjs2), 'no bare ${o.customer_name} in client markup');

  console.log(`\n\x1b[1m═══ RESULTS: ${pass} passed, ${fail} failed ═══\x1b[0m`);
  if (failures.length) { console.log('\nFailures:'); failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
}
main();
