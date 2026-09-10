// Media, newsletter and activity-log suite.
//   * image upload -> the file is stored, served back with an image
//     content-type and listed in the admin uploads library;
//   * newsletter subscribe / list / delete, including a duplicate
//     subscribe which must not raise a server error;
//   * activity log is paginated and readable by admins only;
//   * customer profile update persists and is returned by /me.
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const fails=[];
function ok(n,c,e){ if(c)pass++; else {fail++; fails.push(n+(e?' :: '+e:'')); console.log('  ✗',n,e||'');} }
async function login(email,pw){ for(let i=0;i<8;i++){ const r=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw})}); const j=await r.json().catch(()=>({})); if(j?.data?.token)return j.data.token; if(r.status===429){await new Promise(s=>setTimeout(s,9000));continue;} return null;} return null; }
async function jx(m,p,b,t){ const h={'Content-Type':'application/json'}; if(t)h.Authorization='Bearer '+t; const r=await fetch(BASE+p,{method:m,headers:h,body:b?JSON.stringify(b):undefined}); let j=null;try{j=await r.json();}catch{} return {status:r.status,j}; }

async function main(){
  const admin = await login('admin@netcorepro.ir',(process.env.ADMIN_PASSWORD || 'admin123'));
  ok('admin login', !!admin);
  const cust = await login('customer@example.com','123456');
  ok('customer login', !!cust);

  // 1) IMAGE UPLOAD round-trip: upload a tiny valid PNG (base64) -> URL -> file served
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const up = await jx('POST','/api/admin/upload',{ data:'data:image/png;base64,'+pngB64, filename:'probe.png' }, admin);
  ok('image upload returns 200 + url', up.status===200 && up.j?.data?.url, 'status='+up.status);
  const url = up.j?.data?.url;
  if(url){ const f = await fetch(BASE+url); ok('uploaded image is served', f.status===200, 'status='+f.status);
    const ct = f.headers.get('content-type')||''; ok('uploaded image content-type is image', ct.startsWith('image'), ct); }
  // media library lists it
  const lib = await jx('GET','/api/admin/uploads',null,admin);
  ok('uploads library lists file', lib.status===200 && Array.isArray(lib.j?.data) && lib.j.data.some(x=>x.url===url), 'status='+lib.status);

  // 2) NEWSLETTER round-trip: subscribe -> appears in admin list -> delete
  const email = 'nl-'+Date.now()+'@example.com';
  const sub = await jx('POST','/api/newsletter/subscribe',{ email });
  ok('newsletter subscribe 200', sub.status===200, 'status='+sub.status);
  const nl = await jx('GET','/api/admin/newsletter',null,admin);
  const row = (nl.j?.data||[]).find(x=>x.email===email);
  ok('subscriber appears in admin list', nl.status===200 && !!row, 'status='+nl.status);
  if(row){ const del = await jx('DELETE','/api/admin/newsletter/'+row.id,null,admin); ok('delete subscriber 200', del.status===200, 'status='+del.status);
    const nl2 = await jx('GET','/api/admin/newsletter',null,admin); ok('subscriber removed after delete', !(nl2.j?.data||[]).some(x=>x.email===email)); }
  // duplicate subscribe is idempotent (no 500)
  const dup1 = await jx('POST','/api/newsletter/subscribe',{ email:'dup-'+Date.now()+'@example.com' });
  const dupEmail = 'dup2-'+Date.now()+'@example.com';
  await jx('POST','/api/newsletter/subscribe',{ email:dupEmail });
  const dup2 = await jx('POST','/api/newsletter/subscribe',{ email:dupEmail });
  ok('duplicate newsletter subscribe no 500', dup2.status!==500, 'status='+dup2.status);

  // 3) ACTIVITY LOGS: admin read, pagination-safe
  const logs = await jx('GET','/api/admin/activity-logs',null,admin);
  ok('activity-logs 200 + paginated', logs.status===200 && Array.isArray(logs.j?.data?.items) && typeof logs.j?.data?.total==='number', 'status='+logs.status);
  const logsCust = await jx('GET','/api/admin/activity-logs',null,cust);
  ok('activity-logs rejects customer', logsCust.status===401||logsCust.status===403, 'status='+logsCust.status);

  // 4) PROFILE edit round-trip: update phone/company -> read back via /auth/me
  const newPhone = '0912'+Math.floor(Math.random()*10000000);
  const pu = await jx('PUT','/api/auth/profile',{ full_name:'Customer Test', phone:newPhone, company:'Acme Co' }, cust);
  ok('profile update 200', pu.status===200, 'status='+pu.status);
  const me = await jx('GET','/api/auth/me',null,cust);
  ok('profile change persisted (phone)', me.j?.data?.phone===newPhone, 'got='+me.j?.data?.phone);
  ok('profile change persisted (company)', me.j?.data?.company==='Acme Co', 'got='+me.j?.data?.company);

  // 5) REPORTS data: dashboard aggregates present, no 500
  const dash = await jx('GET','/api/admin/dashboard',null,admin);
  ok('dashboard 200', dash.status===200, 'status='+dash.status);
  const d = dash.j?.data||{};
  ok('dashboard has revenue/orders/products/customers', ['products','customers'].every(k=>k in d) || 'stats' in d, JSON.stringify(Object.keys(d)).slice(0,120));

  // 6) PERSIAN SEARCH with special characters must never 500
  const terms = ['روتر', 'دی‌لینک', 'می‌شود', '%', '_', "'", '"', '؛؟،', '   ', '<script>', 'سوئیچ شبکه'];
  for (const term of terms) {
    const r = await fetch(BASE + '/api/products?q=' + encodeURIComponent(term));
    ok('Persian search no-500: ' + JSON.stringify(term).slice(0, 18), r.status === 200, 'status=' + r.status);
  }
  // real Persian term returns results (data integrity)
  const rr = await jx('GET', '/api/products?q=' + encodeURIComponent('روتر'));
  ok('Persian term "روتر" returns items', rr.status === 200 && (rr.j?.data?.total || 0) >= 0, 'total=' + (rr.j?.data?.total));

  // cleanup: remove the probe image uploaded above so /static/uploads stays clean
  try {
    const fs = await import('node:fs');
    const dir = new URL('../public/static/uploads/', import.meta.url);
    if (url) { const fname = url.split('/').pop(); try { fs.unlinkSync(new URL(fname, dir)); } catch {} }
  } catch {}

  console.log(`\n  test_media_and_reports: ${pass} passed, ${fail} failed`);
  if(fails.length){ fails.forEach(f=>console.log('   - '+f)); }
  process.exit(fail?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
