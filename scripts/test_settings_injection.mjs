// Settings-injection suite: admin-controlled values inside HTML attributes.
//  Contact settings (telegram, whatsapp, ...) are interpolated into href
//  attributes on every storefront page, so each one must pass through
//  escapeAttr(). A value such as "><img src=x onerror=..> must stay inert
//  text: no attribute breakout, no live event handler anywhere in the page,
//  while a legitimate URL is still rendered as a working link.
//  Driven through the real settings API and the rendered topbar.
import db from '../dist/db/index.js';
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const fails=[];
function ok(n,c,e){ if(c)pass++; else {fail++; fails.push(n+(e?' :: '+e:'')); console.log('  ✗',n,e||'');} }
async function login(email,pw){ for(let i=0;i<8;i++){ const r=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw})}); const j=await r.json().catch(()=>({})); if(j?.data?.token)return j.data.token; if(r.status===429){await new Promise(s=>setTimeout(s,9000));continue;} return null;} return null; }
async function jx(m,p,b,t){ const h={'Content-Type':'application/json'}; if(t)h.Authorization='Bearer '+t; const r=await fetch(BASE+p,{method:m,headers:h,body:b?JSON.stringify(b):undefined}); let j=null;try{j=await r.json();}catch{} return {status:r.status,j}; }

async function main(){
  const admin = await login('admin@netcorepro.ir',(process.env.ADMIN_PASSWORD || 'admin123'));
  ok('admin login', !!admin);

  // snapshot original social settings so we can restore them exactly
  const keys = ['telegram','whatsapp','instagram','email','address','phone'];
  const orig = {};
  for (const k of keys) orig[k] = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(k)?.value ?? null;

  const breakout = '"><img src=x onerror=alert(1)>';
  // inject a breakout payload into every attribute-embedded social/contact setting
  const put = await jx('PUT', '/api/admin/settings', {
    telegram: breakout, whatsapp: breakout, instagram: breakout,
    email: breakout, address: breakout, phone: breakout,
  }, admin);
  ok('settings PUT -> 200', put.status===200 && put.j?.success, 'status='+put.status);

  // The rendered page must NOT contain a literal attribute breakout for any of them.
  // (Entity-escaped &quot;&gt;&lt;img... is inert and acceptable.)
  const pagesToCheck = ['/', '/products', '/contact', '/blog'];
  for (const path of pagesToCheck) {
    const page = await (await fetch(BASE+path)).text();
    const literalBreakout = page.includes('"><img src=x onerror');
    ok('no literal attribute breakout on '+path, !literalBreakout);
    // and specifically no LIVE onerror handler (would be present only if unescaped)
    const liveHandler = /<img[^>]*\sonerror\s*=\s*alert/i.test(page);
    ok('no live onerror handler on '+path, !liveHandler);
  }

  // sanity: a legitimate telegram URL is preserved (as an escaped-but-usable href)
  const goodUrl = 'https://t.me/netcorepro';
  await jx('PUT', '/api/admin/settings', { telegram: goodUrl }, admin);
  const home = await (await fetch(BASE+'/')).text();
  ok('legit telegram url present in topbar', home.includes('href="'+goodUrl+'"'), 'expected href='+goodUrl);

  // restore original settings exactly
  for (const k of keys) {
    if (orig[k] === null) db.prepare(`DELETE FROM settings WHERE key = ?`).run(k);
    else db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, orig[k]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fails.length) console.log('FAILURES:\n - '+fails.join('\n - '));
  process.exit(fail>0?1:0);
}
main().catch(e=>{ console.error('SUITE ERROR', e); process.exit(1); });
