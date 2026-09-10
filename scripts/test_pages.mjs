#!/usr/bin/env node
/* Page-level smoke test: every site + admin route returns 200 and valid HTML. */
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const failures=[];
function log(ok,name,d){if(ok){pass++;console.log(`  \x1b[32m✓\x1b[0m ${name}`);}else{fail++;failures.push(name+(d?' :: '+d:''));console.log(`  \x1b[31m✗\x1b[0m ${name}${d?'  -> '+d:''}`);}}

const SITE = [
  '/', '/', '/products', '/products?category=switches',
  '/categories', '/blog', '/cart', '/checkout',
  '/login', '/register', '/account', '/about',
  '/contact', '/privacy', '/terms'
];
const ADMIN = [
  '/admin', '/admin/login', '/admin/products', '/admin/orders', '/admin/tickets',
  '/admin/comments', '/admin/posts', '/admin/categories', '/admin/brands',
  '/admin/customers', '/admin/messages', '/admin/newsletter', '/admin/settings',
  '/admin/profile', '/admin/site-content'
];
const MISC = ['/sitemap.xml', '/robots.txt'];

async function check(path, expectHtml=true) {
  try {
    const r = await fetch(BASE+path, { redirect: 'manual' });
    const isRedirect = r.status>=300 && r.status<400;
    const ok = r.status===200 || r.status===0 || isRedirect;
    const body = await r.text();
    // redirects legitimately have empty bodies; only enforce length on 200 html
    const valid = isRedirect || !expectHtml || body.length>50;
    log(ok && valid, path, `status=${r.status} len=${body.length}`);
  } catch(e){ log(false, path, e.message); }
}

async function main(){
  console.log('\n\x1b[36m── Site pages ──\x1b[0m');
  for(const p of SITE) await check(p);
  console.log('\n\x1b[36m── Admin pages ──\x1b[0m');
  for(const p of ADMIN) await check(p);
  console.log('\n\x1b[36m── Misc ──\x1b[0m');
  for(const p of MISC) await check(p, false);
  // 404 behavior
  console.log('\n\x1b[36m── Error handling ──\x1b[0m');
  const r = await fetch(BASE+'/nonexistent-xyz');
  log(r.status===404, '404 page returns 404', `status=${r.status}`);
  const r2 = await fetch(BASE+'/api/products/nonexistent-slug-xyz');
  log(r2.status===404, 'product not found returns 404', `status=${r2.status}`);

  // API pagination input must be sanitized (no 500 on NaN / negative; limit capped)
  console.log('\n\x1b[36m── API input sanitization (no 500 on bad pagination) ──\x1b[0m');
  for (const qs of ['?limit=abc', '?page=abc', '?page=-5', '?page=0', '?limit=99999', '?limit=-1']) {
    const rr = await fetch(BASE+'/api/products'+qs);
    log(rr.status===200, `GET /api/products${qs} -> 200`, `status=${rr.status}`);
  }
  for (const qs of ['?limit=abc', '?page=-3']) {
    const rr = await fetch(BASE+'/api/blog/posts'+qs);
    log(rr.status===200, `GET /api/blog/posts${qs} -> 200`, `status=${rr.status}`);
  }
  const cap = await (await fetch(BASE+'/api/products?limit=99999')).json();
  log(cap?.data?.limit <= 100, 'products limit is capped at <=100', `limit=${cap?.data?.limit}`);

  // Stored-XSS protection: product description (esc) + blog content (sanitizeHtml whitelist)
  console.log('\n\x1b[36m── Stored-XSS protection (description + blog content) ──\x1b[0m');
  try {
    const login = await (await fetch(BASE+'/api/auth/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email:'admin@netcorepro.ir', password:(process.env.ADMIN_PASSWORD || 'admin123') })
    })).json();
    const token = login?.data?.token;
    log(!!token, 'admin login for XSS test', token?'ok':'no token');
    if (token) {
      const H = { 'Content-Type':'application/json', 'Authorization':'Bearer '+token };
      const stamp = Date.now();
      // --- Product description (plain text -> fully escaped) ---
      const pSlug = 'xss-reg-'+stamp;
      const pRes = await (await fetch(BASE+'/api/products', { method:'POST', headers:H, body: JSON.stringify({
        name:'XSS Reg '+stamp, slug:pSlug, category_id:1, price:1000, stock:1,
        description:'<script>alert(1)</script><img src=x onerror=alert(2)>safe'
      }) })).json();
      const pid = pRes?.data?.id;
      const pHtml = await (await fetch(BASE+'/product/'+pSlug)).text();
      const pProse = (pHtml.match(/<div class="prose-rtl">([\s\S]*?)<\/div>/) || [])[1] || '';
      log(!/<script/i.test(pProse), 'product desc: <script> escaped/removed', pProse.slice(0,80));
      log(!/onerror\s*=/i.test(pProse), 'product desc: onerror handler stripped', pProse.slice(0,80));
      if (pid) await fetch(BASE+'/api/products/'+pid, { method:'DELETE', headers:H });
      // --- Blog content (whitelist: keep <p>/<strong>/<a>, strip script/handlers) ---
      const bSlug = 'xss-blog-reg-'+stamp;
      const bRes = await (await fetch(BASE+'/api/blog/admin/posts', { method:'POST', headers:H, body: JSON.stringify({
        title:'XSS Blog Reg '+stamp, slug:bSlug, status:'published',
        content:'<p>legit <strong>bold</strong></p><script>alert(9)</script><img src=x onerror="alert(1)"><p onclick="x()">c</p><iframe src="javascript:1"></iframe><a href="javascript:alert(3)">l</a>'
      }) })).json();
      const bid = bRes?.data?.id;
      const bHtml = await (await fetch(BASE+'/blog/'+bSlug)).text();
      const bProse = (bHtml.match(/<div class="prose-rtl">([\s\S]*?)<\/div>/) || [])[1] || '';
      log(/<p>legit <strong>bold<\/strong><\/p>/.test(bProse), 'blog: legit <p>/<strong> kept', bProse.slice(0,90));
      log(!/<script/i.test(bProse), 'blog: <script> removed', bProse.slice(0,90));
      log(!/onerror\s*=/i.test(bProse) && !/onclick\s*=/i.test(bProse), 'blog: on* handlers stripped', bProse.slice(0,90));
      log(!/<iframe/i.test(bProse), 'blog: <iframe> removed', bProse.slice(0,90));
      log(!/javascript:/i.test(bProse), 'blog: javascript: URI neutralized', bProse.slice(0,90));
      if (bid) await fetch(BASE+'/api/blog/admin/posts/'+bid, { method:'DELETE', headers:H });
    }
  } catch(e){ log(false, 'XSS protection test', e.message); }

  console.log(`\n\x1b[1m═══ RESULTS: ${pass} passed, ${fail} failed ═══\x1b[0m`);
  if(failures.length){console.log('\x1b[31mFailures:\x1b[0m');failures.forEach(f=>console.log('  - '+f));process.exit(1);}
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(2);});
