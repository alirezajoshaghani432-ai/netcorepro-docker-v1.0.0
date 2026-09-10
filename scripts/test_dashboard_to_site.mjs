#!/usr/bin/env node
/* Dashboard-to-site connection test.
 * Creates content via ADMIN APIs, then verifies it appears via PUBLIC APIs
 * (which are exactly what the site pages consume via axios).
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const ADMIN = { email: 'admin@netcorepro.ir', password: (process.env.ADMIN_PASSWORD || 'admin123') };
let TOKEN = '', pass = 0, fail = 0; const failures = [];

function log(ok, name, d) { if (ok){pass++;console.log(`  \x1b[32m✓\x1b[0m ${name}`);} else {fail++;failures.push(name+(d?' :: '+d:''));console.log(`  \x1b[31m✗\x1b[0m ${name}${d?'  -> '+d:''}`);} }

async function req(method, path, body, auth=true) {
  const headers={}; if(auth&&TOKEN) headers['Authorization']='Bearer '+TOKEN;
  let payload; if(body!==undefined){headers['Content-Type']='application/json';payload=JSON.stringify(body);}
  const r=await fetch(BASE+path,{method,headers,body:payload});
  let data=null; const t=await r.text(); try{data=JSON.parse(t);}catch(e){data=t;}
  return {status:r.status,data};
}
function section(t){console.log(`\n\x1b[36m── ${t} ──\x1b[0m`);}

async function main() {
  let r = await req('POST','/api/auth/login',ADMIN,false);
  TOKEN = r.data?.data?.token || '';
  if(!TOKEN){console.log('FATAL no token');process.exit(1);}

  // ===== PRODUCT: admin create -> public list/detail =====
  section('Product: dashboard → site');
  const ts = Date.now();
  const cat = (await req('GET','/api/admin/categories')).data?.data?.[0]?.id;
  const pslug = 'conn-prod-'+ts;
  r = await req('POST','/api/products',{name:'محصول اتصال '+ts,slug:pslug,category_id:cat,price:555000,stock:7,image:'/static/images/prod-router4g.jpg',short_description:'تست اتصال',status:'active',featured:1});
  const pid = r.data?.data?.id;
  log(r.status===200&&pid,'admin created product',`status=${r.status}`);

  // public products list (what /products consumes)
  r = await req('GET','/api/products?limit=200',undefined,false);
  let found = (r.data?.data?.items||[]).some(p=>p.slug===pslug);
  log(found,'product appears in PUBLIC product list (site shop page)');

  // public product detail (what /product/:slug consumes)
  r = await req('GET','/api/products/'+pslug,undefined,false);
  const detail = r.data?.data?.product || r.data?.data;
  log(r.status===200 && detail?.name==='محصول اتصال '+ts,'product detail visible on site',`name=${detail?.name}`);

  // public featured (homepage)
  r = await req('GET','/api/products/featured',undefined,false);
  const feat = Array.isArray(r.data?.data)?r.data.data:(r.data?.data?.items||[]);
  log(feat.some(p=>p.slug===pslug),'featured product appears on homepage feed');

  // EDIT and re-check
  r = await req('PUT','/api/products/'+pid,{name:'محصول اتصال ویرایش '+ts,slug:pslug,category_id:cat,price:600000,stock:3,image:'/static/images/prod-switch8.jpg',status:'active'});
  log(r.status===200,'admin edited product');
  r = await req('GET','/api/products/'+pslug,undefined,false);
  const d2 = r.data?.data?.product||r.data?.data;
  log(d2?.name==='محصول اتصال ویرایش '+ts && d2?.image==='/static/images/prod-switch8.jpg','edit reflected on site',`n=${d2?.name} i=${d2?.image}`);

  // ===== CATEGORY: admin create -> public categories =====
  section('Category: dashboard → site');
  const cslug='conn-cat-'+ts;
  r = await req('POST','/api/admin/categories',{name:'دسته اتصال '+ts,slug:cslug,icon:'fa-network-wired',image:'/static/images/p1.svg'});
  const cid=r.data?.data?.id;
  log(r.status===200&&cid,'admin created category');
  // public categories endpoint (site uses /api/products/categories)
  r = await req('GET','/api/products/categories',undefined,false);
  const cats = Array.isArray(r.data?.data)?r.data.data:(r.data?.data?.items||[]);
  log(cats.some(c=>c.slug===cslug),'category appears in PUBLIC categories (site)');

  // ===== BRAND: admin create -> public brands =====
  section('Brand: dashboard → site');
  const bslug='conn-brand-'+ts;
  r = await req('POST','/api/admin/brands',{name:'برند اتصال '+ts,slug:bslug,logo:'/static/images/p2.svg'});
  const bid=r.data?.data?.id;
  log(r.status===200&&bid,'admin created brand');
  r = await req('GET','/api/products/brands',undefined,false);
  const brands = Array.isArray(r.data?.data)?r.data.data:(r.data?.data?.items||[]);
  log(brands.some(b=>b.slug===bslug),'brand appears in PUBLIC brands (site)');

  // ===== POST: admin create -> public blog =====
  section('Blog post: dashboard → site');
  const blslug='conn-post-'+ts;
  r = await req('POST','/api/blog/admin/posts',{title:'مقاله اتصال '+ts,slug:blslug,category:'عمومی',cover_image:'/static/images/blog1.svg',excerpt:'خلاصه',content:'<p>محتوای تست اتصال</p>',status:'published'});
  const blid=r.data?.data?.id;
  log(r.status===200&&blid,'admin created post');
  // public blog list (site /blog)
  r = await req('GET','/api/blog/posts',undefined,false);
  const posts = Array.isArray(r.data?.data)?r.data.data:(r.data?.data?.items||[]);
  log(posts.some(p=>p.slug===blslug),'post appears in PUBLIC blog list (site)');
  // public post detail
  r = await req('GET','/api/blog/posts/'+blslug,undefined,false);
  const pd = r.data?.data?.post||r.data?.data;
  log(r.status===200 && (pd?.title==='مقاله اتصال '+ts),'post detail visible on site',`title=${pd?.title}`);

  // ===== Draft post should NOT appear publicly =====
  section('Visibility rules');
  const dslug='conn-draft-'+ts;
  r = await req('POST','/api/blog/admin/posts',{title:'پیش‌نویس '+ts,slug:dslug,category:'عمومی',content:'<p>draft</p>',status:'draft'});
  const did=r.data?.data?.id;
  r = await req('GET','/api/blog/posts',undefined,false);
  const posts2 = Array.isArray(r.data?.data)?r.data.data:(r.data?.data?.items||[]);
  log(!posts2.some(p=>p.slug===dslug),'DRAFT post hidden from public site (correct)');

  // inactive product hidden
  const iaslug='conn-inactive-'+ts;
  r = await req('POST','/api/products',{name:'غیرفعال '+ts,slug:iaslug,category_id:cat,price:1000,stock:1,status:'inactive'});
  const iaid=r.data?.data?.id;
  r = await req('GET','/api/products?limit=200',undefined,false);
  log(!(r.data?.data?.items||[]).some(p=>p.slug===iaslug),'INACTIVE product hidden from public list (correct)');

  // ===== HERO SLIDER / BANNERS: admin create -> appears in / HTML (SSR) =====
  section('Hero slider & banners: dashboard → site (SSR HTML)');
  async function html(path){ const rr = await fetch(BASE+path); return await rr.text(); }

  // -- HERO slide with image --
  const heroTitle = 'اسلاید تست '+ts;
  const heroImg = '/static/images/hero-test-'+ts+'.jpg';
  r = await req('POST','/api/content/admin/blocks',{page:'home',section:'hero',icon:'مشاهده تست',image:heroImg,title:heroTitle,description:'زیرعنوان تست '+ts,href:'/products',sort_order:99,is_active:1});
  const heroId = r.data?.data?.id;
  log(r.status===200&&heroId,'admin created HERO slide block',`status=${r.status}`);
  let pageHtml = await html('/');
  log(pageHtml.includes(heroTitle),'HERO slide title appears in / HTML');
  log(pageHtml.includes(heroImg),'HERO slide image appears in / HTML');
  // edit the hero image and re-check
  const heroImg2 = '/static/images/hero-test2-'+ts+'.jpg';
  r = await req('PUT','/api/content/admin/blocks/'+heroId,{page:'home',section:'hero',icon:'مشاهده تست',image:heroImg2,title:heroTitle,description:'زیرعنوان تست '+ts,href:'/products',sort_order:99,is_active:1});
  log(r.status===200,'admin edited HERO slide image');
  pageHtml = await html('/');
  log(pageHtml.includes(heroImg2),'edited HERO image reflected in / HTML');

  // -- SIDE banner --
  const sideTitle = 'بنرکناری '+ts;
  r = await req('POST','/api/content/admin/blocks',{page:'home',section:'side_banner',icon:'fa-star',image:'',title:sideTitle,description:'توضیح کناری',href:'/products',sort_order:99,is_active:1});
  const sideId = r.data?.data?.id;
  log(r.status===200&&sideId,'admin created SIDE banner block');
  pageHtml = await html('/');
  log(pageHtml.includes(sideTitle),'SIDE banner title appears in / HTML');
  log(pageHtml.includes('fa-star'),'SIDE banner icon class appears in / HTML');

  // -- MID banner --
  const midTitle = 'بنرمیانی '+ts;
  r = await req('POST','/api/content/admin/blocks',{page:'home',section:'mid_banner',icon:'خرید الان',image:'',title:midTitle,description:'توضیح میانی',href:'/products',sort_order:99,is_active:1});
  const midId = r.data?.data?.id;
  log(r.status===200&&midId,'admin created MID banner block');
  pageHtml = await html('/');
  log(pageHtml.includes(midTitle),'MID banner title appears in / HTML');
  log(pageHtml.includes('خرید الان'),'MID banner CTA appears in / HTML');

  // ===== CLEANUP =====
  section('Cleanup');
  if(heroId){r=await req('DELETE','/api/content/admin/blocks/'+heroId);log(r.status===200,'deleted HERO test block');}
  if(sideId){r=await req('DELETE','/api/content/admin/blocks/'+sideId);log(r.status===200,'deleted SIDE test block');}
  if(midId){r=await req('DELETE','/api/content/admin/blocks/'+midId);log(r.status===200,'deleted MID test block');}
  // verify cleanup removed them from the site
  pageHtml = await html('/');
  log(!pageHtml.includes(heroTitle)&&!pageHtml.includes(sideTitle)&&!pageHtml.includes(midTitle),'test blocks removed from / after cleanup');
  if(pid){r=await req('DELETE','/api/products/'+pid);log(r.status===200,'deleted product');}
  if(iaid){r=await req('DELETE','/api/products/'+iaid);log(r.status===200,'deleted inactive product');}
  if(cid){r=await req('DELETE','/api/admin/categories/'+cid);log(r.status===200,'deleted category');}
  if(bid){r=await req('DELETE','/api/admin/brands/'+bid);log(r.status===200,'deleted brand');}
  if(blid){r=await req('DELETE','/api/blog/admin/posts/'+blid);log(r.status===200,'deleted post');}
  if(did){r=await req('DELETE','/api/blog/admin/posts/'+did);log(r.status===200,'deleted draft');}

  console.log(`\n\x1b[1m═══ RESULTS: ${pass} passed, ${fail} failed ═══\x1b[0m`);
  if(failures.length){console.log('\x1b[31mFailures:\x1b[0m');failures.forEach(f=>console.log('  - '+f));process.exit(1);}
  process.exit(0);
}
main().catch(e=>{console.error('RUNNER ERROR',e);process.exit(2);});
