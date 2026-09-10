#!/usr/bin/env node
/* Internal-link integrity: crawl key pages, collect all internal hrefs, verify none 404. */
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const failures=[];
function log(ok,name,d){if(ok){pass++;console.log(`  \x1b[32m✓\x1b[0m ${name}`);}else{fail++;failures.push(name+(d?' :: '+d:''));console.log(`  \x1b[31m✗\x1b[0m ${name}${d?'  -> '+d:''}`);}}

// Pages to crawl for links
const PAGES = [
  '/', '/products', '/categories', '/blog',
  '/about', '/contact', '/privacy', '/terms',
  '/login', '/register', '/cart'
];

function extractHrefs(html) {
  const hrefs = new Set();
  const re = /href\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let h = m[1].trim();
    // skip non-navigational
    if (!h || h.startsWith('#') || h.startsWith('mailto:') || h.startsWith('tel:')
        || h.startsWith('javascript:') || h.startsWith('http://') || h.startsWith('https://')
        || h.startsWith('//') || h.includes('${')) continue;
    // strip query/hash for dedupe but keep query for category pages
    hrefs.add(h);
  }
  return hrefs;
}

async function main(){
  const all = new Set();
  console.log('\n\x1b[36m── Collecting internal links from pages ──\x1b[0m');
  for (const p of PAGES) {
    try {
      const r = await fetch(BASE+p, { redirect:'manual' });
      const html = await r.text();
      const hrefs = extractHrefs(html);
      hrefs.forEach(h => all.add(h));
      log(r.status===200 || (r.status>=300&&r.status<400), `crawled ${p}`, `status=${r.status} links=${hrefs.size}`);
    } catch(e){ log(false, `crawl ${p}`, e.message); }
  }
  console.log(`\n\x1b[36m── Verifying ${all.size} unique internal links (no 404/500) ──\x1b[0m`);
  const sorted = [...all].sort();
  for (const h of sorted) {
    try {
      const r = await fetch(BASE+h, { redirect:'manual' });
      const ok = r.status < 400 || r.status===401 || r.status===403; // auth-gated pages may redirect/forbid, not "broken"
      log(ok, `link ${h}`, `status=${r.status}`);
    } catch(e){ log(false, `link ${h}`, e.message); }
  }
  console.log(`\n\x1b[1m═══ RESULTS: ${pass} passed, ${fail} failed ═══\x1b[0m`);
  if(failures.length){console.log('\x1b[31mFailures:\x1b[0m');failures.forEach(f=>console.log('  - '+f));process.exit(1);}
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(2);});
