#!/usr/bin/env node
/* Comprehensive admin API test suite for NetCore Pro
 * Tests every admin CRUD endpoint + public read endpoints.
 * Usage: node scripts/test_admin_api.mjs
 */
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8090';
const ADMIN = { email: 'admin@netcorepro.ir', password: (process.env.ADMIN_PASSWORD || 'admin123') };

let pass = 0, fail = 0;
const failures = [];
let TOKEN = '';

function log(ok, name, detail) {
  if (ok) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? '  -> ' + detail : ''}`); }
}

async function req(method, path, body, auth = true, isForm = false) {
  const headers = {};
  if (auth && TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
  let payload;
  if (body !== undefined) {
    if (isForm) { payload = body; }
    else { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  }
  const r = await fetch(BASE + path, { method, headers, body: payload });
  let data = null;
  const text = await r.text();
  try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: r.status, data };
}

function section(t) { console.log(`\n\x1b[36m── ${t} ──\x1b[0m`); }

async function main() {
  // ===== AUTH =====
  section('Authentication');
  let r = await req('POST', '/api/auth/login', ADMIN, false);
  log(r.status === 200 && r.data?.data?.token, 'admin login', `status=${r.status} msg=${r.data?.message}`);
  TOKEN = r.data?.data?.token || '';
  if (!TOKEN) { console.log('FATAL: no token, aborting'); process.exit(1); }

  r = await req('GET', '/api/auth/me');
  log(r.status === 200 && r.data?.data?.role === 'admin', 'auth/me returns admin', `status=${r.status}`);

  r = await req('POST', '/api/auth/login', { email: ADMIN.email, password: 'wrong' }, false);
  log(r.status === 401 || r.status === 400, 'login rejects wrong password', `status=${r.status}`);

  r = await req('GET', '/api/admin/dashboard', undefined, false);
  log(r.status === 401, 'dashboard rejects no-auth', `status=${r.status}`);

  // ===== DASHBOARD =====
  section('Dashboard');
  r = await req('GET', '/api/admin/dashboard');
  log(r.status === 200 && r.data?.data, 'GET dashboard', `status=${r.status}`);
  log(r.data?.data?.badges !== undefined, 'dashboard has badges', JSON.stringify(r.data?.data?.badges));

  // ===== CATEGORIES CRUD =====
  section('Categories CRUD');
  r = await req('GET', '/api/admin/categories');
  log(r.status === 200 && Array.isArray(r.data?.data), 'GET categories list', `status=${r.status}`);

  const catSlug = 'test-cat-' + Date.now();
  r = await req('POST', '/api/admin/categories', { name: 'دسته تست', slug: catSlug, icon: 'fa-test', description: 'توضیح', image: '/static/images/p1.svg' });
  log(r.status === 200 && r.data?.data?.id, 'POST create category (with image)', `status=${r.status} msg=${r.data?.message}`);
  const catId = r.data?.data?.id;

  r = await req('GET', '/api/admin/categories');
  const createdCat = (r.data?.data || []).find(c => c.id === catId);
  log(createdCat && createdCat.image === '/static/images/p1.svg', 'created category has image saved', JSON.stringify(createdCat?.image));

  r = await req('PUT', '/api/admin/categories/' + catId, { name: 'دسته ویرایش', slug: catSlug, icon: 'fa-edit', description: 'جدید', image: '/static/images/p2.svg' });
  log(r.status === 200, 'PUT update category', `status=${r.status} msg=${r.data?.message}`);

  r = await req('GET', '/api/admin/categories');
  const updatedCat = (r.data?.data || []).find(c => c.id === catId);
  log(updatedCat?.name === 'دسته ویرایش' && updatedCat?.image === '/static/images/p2.svg', 'category update persisted', JSON.stringify({n:updatedCat?.name,i:updatedCat?.image}));

  // ===== BRANDS CRUD =====
  section('Brands CRUD');
  r = await req('GET', '/api/admin/brands');
  log(r.status === 200 && Array.isArray(r.data?.data), 'GET brands list', `status=${r.status}`);

  const brandSlug = 'test-brand-' + Date.now();
  r = await req('POST', '/api/admin/brands', { name: 'برند تست', slug: brandSlug, logo: '/static/images/p3.svg' });
  log(r.status === 200 && r.data?.data?.id, 'POST create brand (with logo)', `status=${r.status} msg=${r.data?.message}`);
  const brandId = r.data?.data?.id;

  r = await req('GET', '/api/admin/brands');
  const createdBrand = (r.data?.data || []).find(b => b.id === brandId);
  log(createdBrand && createdBrand.logo === '/static/images/p3.svg', 'created brand has logo saved', JSON.stringify(createdBrand?.logo));

  r = await req('PUT', '/api/admin/brands/' + brandId, { name: 'برند ویرایش', slug: brandSlug, logo: '/static/images/p4.svg' });
  log(r.status === 200, 'PUT update brand', `status=${r.status} msg=${r.data?.message}`);

  r = await req('GET', '/api/admin/brands');
  const updatedBrand = (r.data?.data || []).find(b => b.id === brandId);
  log(updatedBrand?.name === 'برند ویرایش' && updatedBrand?.logo === '/static/images/p4.svg', 'brand update persisted', JSON.stringify({n:updatedBrand?.name,l:updatedBrand?.logo}));

  // ===== PRODUCTS CRUD =====
  section('Products CRUD');
  r = await req('GET', '/api/products', undefined, false);
  log(r.status === 200 && r.data?.data?.items, 'GET public products', `status=${r.status}`);
  const firstCat = (await req('GET', '/api/admin/categories')).data?.data?.[0]?.id || catId;

  const prodSlug = 'test-prod-' + Date.now();
  r = await req('POST', '/api/products', { name: 'محصول تست', slug: prodSlug, sku: 'SKU-T1', category_id: firstCat, price: 100000, discount_price: 90000, stock: 10, image: '/static/images/prod-router4g.jpg', short_description: 'کوتاه', description: 'بلند', status: 'active', featured: 1 });
  log(r.status === 200 && (r.data?.data?.id || r.data?.success), 'POST create product', `status=${r.status} msg=${r.data?.message}`);
  const prodId = r.data?.data?.id || r.data?.data?.product?.id;

  r = await req('GET', '/api/products/' + prodSlug, undefined, false);
  const gotProd = r.data?.data?.product || r.data?.data;
  log(r.status === 200 && gotProd?.name === 'محصول تست', 'GET product by slug', `status=${r.status} name=${gotProd?.name}`);

  if (prodId) {
    r = await req('PUT', '/api/products/' + prodId, { name: 'محصول ویرایش', slug: prodSlug, category_id: firstCat, price: 120000, stock: 5, image: '/static/images/prod-switch8.jpg', status: 'active' });
    log(r.status === 200, 'PUT update product', `status=${r.status} msg=${r.data?.message}`);

    r = await req('GET', '/api/products/' + prodSlug, undefined, false);
    const upd = r.data?.data?.product || r.data?.data;
    log(upd?.name === 'محصول ویرایش' && upd?.image === '/static/images/prod-switch8.jpg', 'product update persisted', JSON.stringify({n:upd?.name,i:upd?.image}));
  } else {
    log(false, 'PUT update product', 'no product id captured');
  }

  // ===== POSTS / BLOG CRUD =====
  section('Blog Posts CRUD');
  r = await req('GET', '/api/blog/admin/posts');
  log(r.status === 200 && Array.isArray(r.data?.data), 'GET admin posts', `status=${r.status}`);

  const postSlug = 'test-post-' + Date.now();
  r = await req('POST', '/api/blog/admin/posts', { title: 'مقاله تست', slug: postSlug, category: 'عمومی', cover_image: '/static/images/blog1.svg', excerpt: 'خلاصه', content: '<p>محتوا</p>', status: 'published' });
  log(r.status === 200 && (r.data?.data?.id || r.data?.success), 'POST create post', `status=${r.status} msg=${r.data?.message}`);
  const postId = r.data?.data?.id;

  r = await req('GET', '/api/blog/posts/' + postSlug, undefined, false);
  log(r.status === 200 && r.data?.data, 'GET public post by slug', `status=${r.status}`);

  if (postId) {
    r = await req('PUT', '/api/blog/admin/posts/' + postId, { title: 'مقاله ویرایش', slug: postSlug, category: 'عمومی', cover_image: '/static/images/blog2.svg', excerpt: 'خ', content: '<p>جدید</p>', status: 'published' });
    log(r.status === 200, 'PUT update post', `status=${r.status} msg=${r.data?.message}`);
  } else {
    log(false, 'PUT update post', 'no post id');
  }

  // ===== UPLOAD =====
  section('Image Upload');
  const onePngB64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  r = await req('POST', '/api/admin/upload', { data: onePngB64 });
  log(r.status === 200 && r.data?.data?.url, 'POST upload base64 image', `status=${r.status} url=${r.data?.data?.url}`);
  const uploadedUrl = r.data?.data?.url;
  if (uploadedUrl) {
    r = await fetch(BASE + uploadedUrl);
    log(r.status === 200, 'uploaded image is served', `status=${r.status}`);
  }
  r = await req('GET', '/api/admin/uploads');
  log(r.status === 200 && Array.isArray(r.data?.data), 'GET media library', `status=${r.status}`);

  // ===== ORDERS =====
  section('Orders');
  r = await req('GET', '/api/orders');
  log(r.status === 200, 'GET orders (admin)', `status=${r.status}`);

  // ===== TICKETS =====
  section('Tickets');
  r = await req('GET', '/api/tickets');
  log(r.status === 200, 'GET tickets (admin)', `status=${r.status}`);

  // ===== COMMENTS =====
  section('Comments');
  r = await req('GET', '/api/blog/admin/comments');
  log(r.status === 200 && Array.isArray(r.data?.data), 'GET admin comments', `status=${r.status}`);

  // ===== MESSAGES =====
  section('Messages');
  r = await req('GET', '/api/admin/messages');
  log(r.status === 200 && Array.isArray(r.data?.data), 'GET messages', `status=${r.status}`);

  // ===== NEWSLETTER =====
  section('Newsletter');
  r = await req('GET', '/api/admin/newsletter');
  log(r.status === 200 && Array.isArray(r.data?.data), 'GET newsletter', `status=${r.status}`);

  // ===== USERS =====
  section('Users');
  r = await req('GET', '/api/admin/users');
  log(r.status === 200 && Array.isArray(r.data?.data), 'GET users', `status=${r.status}`);

  // ===== ACTIVITY LOGS =====
  section('Activity Logs');
  r = await req('GET', '/api/admin/activity-logs');
  log(r.status === 200, 'GET activity logs', `status=${r.status}`);

  // ===== SETTINGS =====
  section('Settings');
  r = await req('GET', '/api/admin/settings');
  log(r.status === 200, 'GET settings', `status=${r.status}`);

  // ===== SITE CONTENT =====
  section('Site Content (blocks/pages)');
  r = await req('GET', '/api/content/blocks');
  log(r.status === 200, 'GET content blocks', `status=${r.status}`);

  // ===== CLEANUP =====
  section('Cleanup (delete test data)');
  if (prodId) { r = await req('DELETE', '/api/products/' + prodId); log(r.status === 200, 'DELETE product', `status=${r.status}`); }
  if (postId) { r = await req('DELETE', '/api/blog/admin/posts/' + postId); log(r.status === 200, 'DELETE post', `status=${r.status}`); }
  if (catId) { r = await req('DELETE', '/api/admin/categories/' + catId); log(r.status === 200, 'DELETE category', `status=${r.status}`); }
  if (brandId) { r = await req('DELETE', '/api/admin/brands/' + brandId); log(r.status === 200, 'DELETE brand', `status=${r.status}`); }

  // ===== SUMMARY =====
  console.log(`\n\x1b[1m═══ RESULTS: ${pass} passed, ${fail} failed ═══\x1b[0m`);
  if (failures.length) {
    console.log('\x1b[31mFailures:\x1b[0m');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error('TEST RUNNER ERROR:', e); process.exit(2); });
