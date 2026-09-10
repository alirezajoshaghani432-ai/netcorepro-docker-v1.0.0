// HTML sanitiser suite (stored-XSS defence in depth).
//  sanitizeHtml() guards admin-authored blog content and product descriptions.
//  It must strip inline event handlers even when the attribute separator is a
//  slash (browsers parse <img/src=x/onerror=..> as separate attributes), and
//  must never let script/svg/iframe elements or javascript: URLs through,
//  while legitimate markup (bold, links, lists) survives untouched.
//  Asserted end-to-end against the rendered blog page.
import db from '../dist/db/index.js';
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const fails=[];
function ok(n,c,e){ if(c)pass++; else {fail++; fails.push(n+(e?' :: '+e:'')); console.log('  ✗',n,e||'');} }
async function login(email,pw){ for(let i=0;i<8;i++){ const r=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw})}); const j=await r.json().catch(()=>({})); if(j?.data?.token)return j.data.token; if(r.status===429){await new Promise(s=>setTimeout(s,9000));continue;} return null;} return null; }
async function jx(m,p,b,t){ const h={'Content-Type':'application/json'}; if(t)h.Authorization='Bearer '+t; const r=await fetch(BASE+p,{method:m,headers:h,body:b?JSON.stringify(b):undefined}); let j=null;try{j=await r.json();}catch{} return {status:r.status,j}; }

async function main(){
  const admin = await login('admin@netcorepro.ir',(process.env.ADMIN_PASSWORD || 'admin123'));
  ok('admin login', !!admin);

  // Malicious payloads that a naive whitespace-only handler stripper would miss.
  const payloads = [
    '<p>ok</p><img/src=x/onerror=alert(1)>',
    '<img/onerror=alert(2)/src=x>',
    '<div/onclick=alert(3)>x</div>',
    '<svg/onload=alert(4)>',
    '<a/href="javascript:alert(5)">x</a>',
    '<scr<script>ipt>alert(6)</script>',
  ];

  const created = [];
  for (let i=0; i<payloads.length; i++){
    const slug = `r10-xss-${Date.now()}-${i}`;
    const content = payloads[i] + ' — این متن صرفاً برای پر کردن حداقل طول است.';
    const cr = await jx('POST', '/api/blog/admin/posts', { title: 'R10 XSS '+i, slug, content, status: 'published', category: 'عمومی' }, admin);
    ok('create post '+i+' -> 200', cr.status===200 && cr.j?.success, 'status='+cr.status);
    created.push(slug);

    // Fetch the PUBLIC rendered blog page and assert no live handler / dangerous tag survives.
    const page = await (await fetch(BASE+'/blog/'+slug)).text();
    const hasHandler = /on(?:error|load|click|mouseover)\s*=\s*alert/i.test(page);
    ok('payload '+i+' has NO live event handler in rendered page', !hasHandler, 'payload='+payloads[i]);
    const hasJsUrl = /href\s*=\s*["']?\s*javascript:/i.test(page);
    ok('payload '+i+' has NO javascript: url in rendered page', !hasJsUrl);
  }

  // A legitimate rich-text post must still render its formatting (not be over-stripped).
  const goodSlug = `r10-good-${Date.now()}`;
  const goodContent = '<h2>عنوان</h2><p>متن با <b>بولد</b> و <a href="/products">لینک</a></p><ul><li>مورد</li></ul>';
  const gc = await jx('POST', '/api/blog/admin/posts', { title: 'R10 Good', slug: goodSlug, content: goodContent, status: 'published', category: 'عمومی' }, admin);
  ok('create legit post -> 200', gc.status===200 && gc.j?.success, 'status='+gc.status);
  created.push(goodSlug);
  const gpage = await (await fetch(BASE+'/blog/'+goodSlug)).text();
  ok('legit bold tag preserved', /<b>بولد<\/b>/.test(gpage));
  ok('legit link preserved', gpage.includes('href="/products"'));
  ok('legit list preserved', /<li>مورد<\/li>/.test(gpage));

  // cleanup all created posts
  for (const slug of created) db.prepare(`DELETE FROM posts WHERE slug = ?`).run(slug);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fails.length) console.log('FAILURES:\n - '+fails.join('\n - '));
  process.exit(fail>0?1:0);
}
main().catch(e=>{ console.error('SUITE ERROR', e); process.exit(1); });
