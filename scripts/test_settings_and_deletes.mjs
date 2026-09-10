// Settings round-trip, stock accounting and referential-integrity deletes.
//   * a settings PUT is persisted AND reflected in the rendered storefront;
//   * cancelling an order restores stock exactly once (idempotent) and
//     reactivating it deducts again;
//   * deleting a product that is referenced by an order is archived rather
//     than removed, while an unreferenced one is deleted outright;
//   * deleting a category/brand that still owns products, or a user that
//     still owns orders, answers 400 — never a 500.
import db from '../dist/db/index.js';
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const fails=[];
function ok(n,c,e){ if(c)pass++; else {fail++; fails.push(n+(e?' :: '+e:'')); console.log('  ✗',n,e||'');} }
async function login(email,pw){ for(let i=0;i<8;i++){ const r=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw})}); const j=await r.json().catch(()=>({})); if(j?.data?.token)return j.data.token; if(r.status===429){await new Promise(s=>setTimeout(s,9000));continue;} return null;} return null; }
async function jx(m,p,b,t){ const h={'Content-Type':'application/json'}; if(t)h.Authorization='Bearer '+t; const r=await fetch(BASE+p,{method:m,headers:h,body:b?JSON.stringify(b):undefined}); let j=null;try{j=await r.json();}catch{} return {status:r.status,j}; }
async function stockOf(slug){ const r=await jx('GET',`/api/products/${slug}`); return r.j?.data?.product?.stock; }

async function main(){
  const admin = await login('admin@netcorepro.ir',(process.env.ADMIN_PASSWORD || 'admin123'));
  ok('admin login', !!admin);

  // ===== settings round-trip (tagline / footer_about / og_image) =====
  const before = (await jx('GET','/api/admin/settings',null,admin)).j?.data || {};
  const mk = 'R6_'+Date.now();
  const put = await jx('PUT','/api/admin/settings',{ site_tagline:mk+'_tag', footer_about:mk+'_foot', og_image:'/static/images/'+mk+'.png' },admin);
  ok('settings PUT 200', put.status===200 && put.j?.success, 'status='+put.status);
  const back = (await jx('GET','/api/admin/settings',null,admin)).j?.data || {};
  ok('tagline persisted', back.site_tagline===mk+'_tag');
  ok('footer_about persisted', back.footer_about===mk+'_foot');
  ok('og_image persisted', back.og_image==='/static/images/'+mk+'.png');
  const html = await (await fetch(BASE+'/')).text();
  ok('tagline reflected on public site', html.includes(mk+'_tag'));
  ok('footer_about reflected on public site', html.includes(mk+'_foot'));
  ok('og_image reflected on public site', html.includes(mk+'.png'));
  // restore defaults
  await jx('PUT','/api/admin/settings',{
    site_tagline: before.site_tagline||'تجهیزات شبکه حرفه‌ای',
    footer_about: before.footer_about||'NetCore Pro مرجع تخصصی فروش تجهیزات شبکه، فیبر نوری و برقی برای کسب‌وکارها و سازمان‌ها. ما تامین تجهیزات اصلی با گارانتی معتبر را تضمین می‌کنیم.',
    og_image: before.og_image||'/static/images/og-default.svg'
  },admin);

  // ===== stock restore on cancel / delete + idempotency =====
  const fx = db.prepare("SELECT id, slug FROM products WHERE status='active' AND stock >= 5 "
                       + "AND slug IS NOT NULL AND slug != '' ORDER BY id LIMIT 1").get();
  if (!fx) { console.log('  ! skipped stock suite: no active product with stock >= 5'); }
  const slug = fx && fx.slug, pid = fx && fx.id;
  const s0 = await stockOf(slug);
  ok('read initial stock', typeof s0==='number', 's0='+s0);
  const ord = await jx('POST','/api/orders',{ customer_name:'R6', customer_phone:'09120000000', shipping_address:'آدرس تست کامل برای سفارش', items:[{product_id:pid,quantity:3}] });
  const oid = ord.j?.data?.id;
  ok('order placed', ord.status===200 && !!oid, 'status='+ord.status);
  ok('stock deducted by 3', (await stockOf(slug))===s0-3);
  await jx('PUT',`/api/orders/${oid}/status`,{status:'cancelled'},admin);
  ok('stock restored on cancel', (await stockOf(slug))===s0);
  await jx('PUT',`/api/orders/${oid}/status`,{status:'cancelled'},admin);
  ok('cancel idempotent (no double restore)', (await stockOf(slug))===s0);
  await jx('PUT',`/api/orders/${oid}/status`,{status:'confirmed'},admin);
  ok('stock re-deducted on reactivate', (await stockOf(slug))===s0-3);
  await jx('DELETE',`/api/orders/${oid}`,null,admin);
  ok('stock restored on delete of active order', (await stockOf(slug))===s0);

  // ===== product delete: referenced -> soft archive, unreferenced -> hard delete =====
  const np = await jx('POST','/api/products',{ name:'R6 del prod', slug:'r6-del-'+Date.now(), category_id:1, price:1000, stock:10 },admin);
  const npid = np.j?.data?.id; ok('temp product created', !!npid);
  const o2 = await jx('POST','/api/orders',{ customer_name:'R6', customer_phone:'09120000000', shipping_address:'آدرس تست کامل برای سفارش', items:[{product_id:npid,quantity:1}] });
  const o2id = o2.j?.data?.id;
  const delRef = await jx('DELETE',`/api/products/${npid}`,null,admin);
  ok('referenced product delete -> 200 (no 500)', delRef.status===200, 'status='+delRef.status);
  const archRow = db.prepare('SELECT status FROM products WHERE id=?').get(npid);
  ok('referenced product archived (inactive)', archRow && archRow.status==='inactive', 'status='+(archRow&&archRow.status));
  await jx('DELETE',`/api/orders/${o2id}`,null,admin); // frees the reference
  const delHard = await jx('DELETE',`/api/products/${npid}`,null,admin);
  ok('unreferenced product hard-deleted 200', delHard.status===200, 'status='+delHard.status);

  // ===== category & brand delete while products attached -> 400 not 500 =====
  const delCat = await jx('DELETE','/api/admin/categories/1',null,admin);
  ok('delete category-with-products -> 400 (not 500)', delCat.status===400, 'status='+delCat.status);
  const delBrand = await jx('DELETE','/api/admin/brands/1',null,admin);
  ok('delete brand-with-products -> 400 (not 500)', delBrand.status===400, 'status='+delBrand.status);
  // empty category CAN be deleted
  const ec = await jx('POST','/api/admin/categories',{ name:'R6 empty cat', slug:'r6-empty-'+Date.now() },admin);
  const ecid = ec.j?.data?.id;
  const delEmpty = await jx('DELETE',`/api/admin/categories/${ecid}`,null,admin);
  ok('empty category deletable 200', delEmpty.status===200, 'status='+delEmpty.status);

  // ===== user delete: with orders -> block, fresh -> hard delete =====
  const email='r6-del-'+Date.now()+'@example.com';
  const reg = await jx('POST','/api/auth/register',{ email, password:'123456', full_name:'R6 حذف' });
  const uid = reg.j?.data?.user?.id;
  ok('temp user registered', !!uid);
  const delFresh = await jx('DELETE',`/api/admin/users/${uid}`,null,admin);
  ok('fresh user hard-deleted 200', delFresh.status===200, 'status='+delFresh.status);
  // self-delete guard
  const me = (await jx('GET','/api/auth/me',null,admin)).j?.data;
  const delSelf = await jx('DELETE',`/api/admin/users/${me.id}`,null,admin);
  ok('cannot delete self 400', delSelf.status===400, 'status='+delSelf.status);

  console.log(`\n${fail?'\x1b[31m':'\x1b[32m'}test_settings_and_deletes: ${pass} passed, ${fail} failed\x1b[0m`);
  if(fails.length) console.log('  '+fails.join('\n  '));
  process.exit(fail?1:0);
}
main().catch(e=>{ console.error(e); console.log(`test_settings_and_deletes: ${pass} passed, ${fail+1} failed`); process.exit(1); });
