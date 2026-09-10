#!/usr/bin/env node
/* Security audit: authorization enforcement + injection resistance.
 * - Admin routes must reject: no token, customer token, tampered JWT.
 * - SQL-injection-style inputs must not break queries or leak data. */
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const failures=[];
function log(ok,name,d){if(ok){pass++;console.log(`  \x1b[32m✓\x1b[0m ${name}`);}else{fail++;failures.push(name+(d?' :: '+d:''));console.log(`  \x1b[31m✗\x1b[0m ${name}${d?'  -> '+d:''}`);}}
async function call(method, path, { token, body } = {}) {
  const h = {}; if (token) h['Authorization']='Bearer '+token;
  if (body!==undefined){ h['Content-Type']='application/json'; }
  const r = await fetch(BASE+path, { method, headers:h, body: body!==undefined?JSON.stringify(body):undefined });
  let j=null; try{j=await r.json();}catch(e){}
  return { status:r.status, json:j };
}

async function main(){
  // get tokens
  async function loginRetry(email, password, label) {
    for (let i = 0; i < 6; i++) {
      const r = await call('POST', '/api/auth/login', { body: { email, password } });
      if (r.json?.data?.token) return r.json.data.token;
      if (r.status === 429) { await new Promise(s => setTimeout(s, 8000)); continue; }
      console.log(`  ! ${label} login failed: status=${r.status} msg=${r.json?.message || ''}`);
      return null;
    }
    console.log(`  ! ${label} login still rate-limited after retries`);
    return null;
  }
  const adminToken = await loginRetry('admin@netcorepro.ir', (process.env.ADMIN_PASSWORD || 'admin123'), 'admin');
  const custToken  = await loginRetry('customer@example.com', '123456', 'customer');
  log(!!adminToken, 'admin token obtained', adminToken?'ok':'fail');
  log(!!custToken, 'customer token obtained', custToken?'ok':'fail');

  // admin-only endpoints to probe
  const ADMIN_GET = ['/api/admin/dashboard','/api/admin/users','/api/admin/settings','/api/admin/newsletter','/api/admin/activity-logs'];
  const ADMIN_WRITE = [
    ['POST','/api/products',{ name:'hack', slug:'hack-'+Date.now(), category_id:1, price:1, stock:1 }],
    ['DELETE','/api/products/1',undefined],
    ['POST','/api/admin/categories',{ name:'x', slug:'x' }],
    ['PUT','/api/admin/settings',{ site_name:'hacked' }]
  ];

  console.log('\n\x1b[36m── Admin GET routes reject no-token (401) ──\x1b[0m');
  for (const p of ADMIN_GET){ const r=await call('GET',p); log(r.status===401||r.status===403, `no-token ${p}`, `status=${r.status}`); }

  console.log('\n\x1b[36m── Admin GET routes reject customer token (401/403) ──\x1b[0m');
  for (const p of ADMIN_GET){ const r=await call('GET',p,{ token:custToken }); log(r.status===401||r.status===403, `cust-token ${p}`, `status=${r.status}`); }

  console.log('\n\x1b[36m── Admin WRITE routes reject no-token & customer token ──\x1b[0m');
  for (const [m,p,b] of ADMIN_WRITE){
    let r=await call(m,p,{ body:b });   log(r.status===401||r.status===403, `no-token ${m} ${p}`, `status=${r.status}`);
    r=await call(m,p,{ token:custToken, body:b }); log(r.status===401||r.status===403, `cust-token ${m} ${p}`, `status=${r.status}`);
  }

  console.log('\n\x1b[36m── JWT tampering rejected ──\x1b[0m');
  // tamper: flip last char of signature
  let bad = adminToken ? adminToken.slice(0,-2)+(adminToken.slice(-1)==='A'?'B':'A')+'X' : 'x.y.z';
  let r = await call('GET','/api/admin/dashboard',{ token:bad }); log(r.status===401, 'tampered signature rejected', `status=${r.status}`);
  r = await call('GET','/api/admin/dashboard',{ token:'garbage.token.value' }); log(r.status===401, 'garbage token rejected', `status=${r.status}`);
  r = await call('GET','/api/admin/dashboard',{ token:'' }); log(r.status===401, 'empty bearer rejected', `status=${r.status}`);
  // customer token must NOT escalate to admin via /auth/me role
  r = await call('GET','/api/auth/me',{ token:custToken }); log(r.json?.data?.role !== 'admin', 'customer cannot self-claim admin role', `role=${r.json?.data?.role}`);

  console.log('\n\x1b[36m── SQL-injection-style inputs are safe ──\x1b[0m');
  // search with injection payload should 200 and not error, not return everything
  const inj = encodeURIComponent("' OR '1'='1");
  r = await call('GET',`/api/products?search=${inj}`); log(r.status===200, 'product search w/ SQLi payload -> 200 (no 500)', `status=${r.status}`);
  r = await call('GET',`/api/products?category=${inj}`); log(r.status===200, 'category filter w/ SQLi payload -> 200', `status=${r.status}`);
  // login with injection should NOT authenticate
  r = await call('POST','/api/auth/login',{ body:{ email:"admin@netcorepro.ir' --", password:"x' OR '1'='1" } });
  log(r.status>=400 && !r.json?.data?.token, 'login SQLi payload does not authenticate', `status=${r.status}`);
  // product slug with injection -> 404, not 500/leak
  r = await call('GET',`/api/products/${inj}`); log(r.status===404||r.status===200, 'product slug SQLi -> 404/200 (no 500)', `status=${r.status}`);

  console.log('\n\x1b[36m── CSRF: cookie token rejected on state-changing methods ──\x1b[0m');
  // The SSR cookie is honored only on GET. State-changing requests must use the
  // Authorization header (which a cross-site attacker cannot forge).
  async function callCookie(method, path, { cookieToken, body } = {}) {
    const h = {}; if (cookieToken) h['Cookie'] = 'token=' + cookieToken;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const rr = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    let jj = null; try { jj = await rr.json(); } catch (e) {}
    return { status: rr.status, json: jj };
  }
  // authRequired POST with cookie-only must be 401
  r = await callCookie('POST', '/api/tickets/1/replies', { cookieToken: custToken, body: { message: 'csrf cookie reply' } });
  log(r.status === 401, 'cookie-only POST (authRequired) rejected 401', `status=${r.status}`);
  // adminRequired write with cookie-only must be 401/403
  r = await callCookie('PUT', '/api/admin/settings', { cookieToken: adminToken, body: { site_name: 'csrf' } });
  log(r.status === 401 || r.status === 403, 'cookie-only admin PUT rejected', `status=${r.status}`);
  // GET with cookie-only still works (SSR path) — customer can read own tickets
  r = await callCookie('GET', '/api/tickets', { cookieToken: custToken });
  log(r.status === 200, 'cookie-only GET still authenticates (SSR)', `status=${r.status}`);
  // sanity: same POST WITH bearer succeeds
  r = await call('PUT', '/api/admin/settings', { token: adminToken, body: { site_name: 'NetCore Pro' } });
  log(r.status === 200, 'bearer admin PUT still works', `status=${r.status}`);

  console.log('\n\x1b[36m── File upload validation (type/size) ──\x1b[0m');
  // SVG must be rejected (stored-XSS vector)
  const svgData = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  r = await call('POST', '/api/admin/upload', { token: adminToken, body: { data: svgData, filename: 'x.svg' } });
  log(r.status === 400, 'SVG upload rejected (400)', `status=${r.status}`);
  // Unknown mime rejected
  const txtData = 'data:text/plain;base64,' + Buffer.from('hello').toString('base64');
  r = await call('POST', '/api/admin/upload', { token: adminToken, body: { data: txtData, filename: 'x.txt' } });
  log(r.status === 400, 'text/plain upload rejected (400)', `status=${r.status}`);
  // Oversized (>5MB) rejected
  const bigPng = 'data:image/png;base64,' + Buffer.alloc(6 * 1024 * 1024, 0x41).toString('base64');
  r = await call('POST', '/api/admin/upload', { token: adminToken, body: { data: bigPng, filename: 'big.png' } });
  log(r.status === 400, 'oversized (>5MB) upload rejected (400)', `status=${r.status}`);
  // upload requires admin
  r = await call('POST', '/api/admin/upload', { token: custToken, body: { data: txtData } });
  log(r.status === 401 || r.status === 403, 'upload rejects customer token', `status=${r.status}`);

  console.log(`\n\x1b[1m═══ RESULTS: ${pass} passed, ${fail} failed ═══\x1b[0m`);
  if(failures.length){console.log('\x1b[31mFailures:\x1b[0m');failures.forEach(f=>console.log('  - '+f));process.exit(1);}
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(2);});
