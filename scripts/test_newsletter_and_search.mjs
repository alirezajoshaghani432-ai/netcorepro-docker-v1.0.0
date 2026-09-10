// Newsletter normalisation and search-escaping suite.
//  * newsletter addresses are trimmed and lower-cased before storage, so
//    case/whitespace variants of one address collapse to a single row and an
//    unsubscribe with different casing still matches the subscription;
//  * product and blog search escape the SQL LIKE metacharacters % _ \ so a
//    literal wildcard is matched as text instead of matching every row.
import db from '../dist/db/index.js';
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const fails=[];
function ok(n,c,e){ if(c)pass++; else {fail++; fails.push(n+(e?' :: '+e:'')); console.log('  ✗',n,e||'');} }
async function jx(m,p,b,t){ const h={'Content-Type':'application/json'}; if(t)h.Authorization='Bearer '+t; const r=await fetch(BASE+p,{method:m,headers:h,body:b?JSON.stringify(b):undefined}); let j=null;try{j=await r.json();}catch{} return {status:r.status,j}; }

async function main(){
  // ===== newsletter case / whitespace de-duplication =====
  const uniq = Date.now();
  const upper = `Newsletter_R9_${uniq}@Example.COM`;
  const lower = `newsletter_r9_${uniq}@example.com`;
  const padded = `  newsletter_r9_${uniq}@example.com  `;
  const normalized = lower;

  const s1 = await jx('POST', '/api/newsletter/subscribe', { email: upper });
  ok('newsletter subscribe (mixed case) -> 200', s1.status===200 && s1.j?.success, 'status='+s1.status);
  const s2 = await jx('POST', '/api/newsletter/subscribe', { email: lower });
  ok('newsletter subscribe (lower case) -> 200', s2.status===200 && s2.j?.success, 'status='+s2.status);
  const s3 = await jx('POST', '/api/newsletter/subscribe', { email: padded });
  ok('newsletter subscribe (padded) -> 200', s3.status===200 && s3.j?.success, 'status='+s3.status);

  // read AFTER the awaited fetches so we see the committed writes
  const rows = db.prepare(`SELECT id, email, status FROM newsletter_subscribers WHERE email LIKE ? ESCAPE '\\'`)
    .all(`%newsletter\\_r9\\_${uniq}%`);
  ok('case/whitespace variants collapse to ONE subscriber row', rows.length===1,
     'rows='+JSON.stringify(rows));
  ok('stored email is normalized to lowercase+trimmed', rows.length===1 && rows[0].email===normalized,
     'stored='+(rows[0]?.email));

  // unsubscribe with yet another casing must match the same row
  const u1 = await jx('POST', '/api/newsletter/unsubscribe', { email: `NEWSLETTER_r9_${uniq}@EXAMPLE.com` });
  ok('newsletter unsubscribe (diff case) -> 200', u1.status===200 && u1.j?.success, 'status='+u1.status);
  const after = db.prepare(`SELECT status FROM newsletter_subscribers WHERE email = ?`).get(normalized);
  ok('unsubscribe matched despite case diff (status=unsubscribed)', after && after.status==='unsubscribed',
     'after='+JSON.stringify(after));

  // cleanup
  db.prepare(`DELETE FROM newsletter_subscribers WHERE email LIKE ? ESCAPE '\\'`).run(`%newsletter\\_r9\\_${uniq}%`);

  // ===== search LIKE wildcard escaping (products) =====
  const totalProducts = (await jx('GET', '/api/products?limit=100')).j?.data?.total ?? 0;
  ok('baseline product count > 0', totalProducts > 0, 'total='+totalProducts);

  // literal '%' must NOT match every product (would be a wildcard if unescaped)
  const pctP = await jx('GET', '/api/products?q=%25'); // %25 == '%'
  ok('product search literal "%" does NOT return all rows',
     (pctP.j?.data?.total ?? -1) < totalProducts,
     'got='+(pctP.j?.data?.total)+' total='+totalProducts);

  // literal '_' must NOT match arbitrary single-char rows
  const usP = await jx('GET', '/api/products?q=_');
  ok('product search literal "_" does NOT return all rows',
     (usP.j?.data?.total ?? -1) < totalProducts,
     'got='+(usP.j?.data?.total)+' total='+totalProducts);

  // a normal term still works (should find at least one active product name substring)
  const anyName = db.prepare(`SELECT name FROM products WHERE status='active' LIMIT 1`).get()?.name || '';
  if (anyName) {
    const term = anyName.slice(0, Math.min(3, anyName.length));
    const okSearch = await jx('GET', '/api/products?q=' + encodeURIComponent(term));
    ok('normal product search still returns results', (okSearch.j?.data?.total ?? 0) >= 1,
       'term='+term+' got='+(okSearch.j?.data?.total));
  } else { ok('normal product search (skipped, no products)', true); }

  // no-500 sanity: SQL/Persian special chars in search
  for (const q of ["%", "_", "\\", "'; DROP TABLE products;--", "مودم%", "روتر_", "%مودم%"]) {
    const r = await jx('GET', '/api/products?q=' + encodeURIComponent(q));
    ok('product search "'+q+'" no 500', r.status===200, 'status='+r.status);
  }

  // ===== search LIKE wildcard escaping (blog) =====
  const totalPosts = (await jx('GET', '/api/blog/posts?limit=100')).j?.data?.total ?? 0;
  const pctB = await jx('GET', '/api/blog/posts?q=%25');
  ok('blog search literal "%" does NOT return all rows',
     (pctB.j?.data?.total ?? -1) < totalPosts || totalPosts===0,
     'got='+(pctB.j?.data?.total)+' total='+totalPosts);
  for (const q of ["%", "_", "\\", "مودم%", "'; DROP--"]) {
    const r = await jx('GET', '/api/blog/posts?q=' + encodeURIComponent(q));
    ok('blog search "'+q+'" no 500', r.status===200, 'status='+r.status);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fails.length) console.log('FAILURES:\n - '+fails.join('\n - '));
  process.exit(fail>0?1:0);
}
main().catch(e=>{ console.error('SUITE ERROR', e); process.exit(1); });
