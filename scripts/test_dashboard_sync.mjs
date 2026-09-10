// Dashboard <-> Site round-trip test.
// For every site-visible section that should be manageable from the dashboard,
// make a change via the ADMIN API and verify it is reflected on the SITE (HTML or public API).
// Run with the server up on :3000 and a clean-ish DB.

const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; /* console.log('  ✓', name); */ }
  else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗', name, extra || ''); }
}
async function jget(path, token) {
  const r = await fetch(BASE + path, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
async function hget(path) {
  const r = await fetch(BASE + path);
  const t = await r.text();
  return { status: r.status, t };
}
async function jsend(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body == null ? undefined : JSON.stringify(body),
  });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}

const uniq = Date.now().toString(36);

async function loginAdmin() {
  // Resilient to the auth rate-limiter (10/min/IP): if a previous suite exhausted
  // the bucket we get 429 -> wait for the window to reset and retry, so test
  // ORDER never produces a false failure. The rate limiter itself is a feature.
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await jsend('POST', '/api/auth/login', { email: 'admin@netcorepro.ir', password: (process.env.ADMIN_PASSWORD || 'admin123') });
    if (r.j?.data?.token) return r.j.data.token;
    if (r.status === 429) {
      const wait = Math.min(12, parseInt(r.j?.message?.match(/(\d+)/)?.[1] || '8', 10) + 1);
      await new Promise(res => setTimeout(res, wait * 1000));
      continue;
    }
    return null; // genuine auth failure
  }
  return null;
}

async function main() {
  // ---- admin login ----
  const token = await loginAdmin();
  ok('admin login returns token', !!token, token ? '' : 'no token (rate-limited or bad creds)');
  if (!token) { done(); return; }

  // ============ 1) HERO BLOCK (home/hero) -> appears on homepage ============
  const heroTitle = 'تست‌هیرو ' + uniq;
  const createHero = await jsend('POST', '/api/content/admin/blocks', {
    page: 'home', section: 'hero', title: heroTitle, description: 'زیرعنوان تست',
    icon: 'مشاهده تست', href: '/products', image: '/static/images/hero-3-rack.jpg',
    sort_order: 99, is_active: 1,
  }, token);
  ok('create hero block via admin API', createHero.status >= 200 && createHero.status < 300, 'status=' + createHero.status);
  const heroId = createHero.j?.data?.id;
  ok('hero block returns id', !!heroId);
  {
    const home = await hget('/');
    ok('hero block title appears on homepage', home.t.includes(heroTitle));
  }

  // ============ 2) SIDE BANNER (home/side_banner) -> homepage ============
  const sideTitle = 'بنرکناری ' + uniq;
  const createSide = await jsend('POST', '/api/content/admin/blocks', {
    page: 'home', section: 'side_banner', title: sideTitle, description: 'کناری تست',
    icon: 'fa-bolt', href: '/products', sort_order: 99, is_active: 1,
  }, token);
  ok('create side_banner via admin API', createSide.status >= 200 && createSide.status < 300, 'status=' + createSide.status);
  const sideId = createSide.j?.data?.id;
  {
    const home = await hget('/');
    ok('side_banner title appears on homepage', home.t.includes(sideTitle));
  }

  // ============ 3) MID BANNER (home/mid_banner) -> homepage ============
  const midTitle = 'بنرمیانی ' + uniq;
  const createMid = await jsend('POST', '/api/content/admin/blocks', {
    page: 'home', section: 'mid_banner', title: midTitle, description: 'میانی تست',
    icon: 'خرید', href: '/products', sort_order: 99, is_active: 1,
  }, token);
  ok('create mid_banner via admin API', createMid.status >= 200 && createMid.status < 300, 'status=' + createMid.status);
  const midId = createMid.j?.data?.id;
  {
    const home = await hget('/');
    ok('mid_banner title appears on homepage', home.t.includes(midTitle));
  }

  // ============ 4) EDIT a block -> reflected ============
  if (heroId) {
    const newTitle = 'هیروویرایش ' + uniq;
    const upd = await jsend('PUT', '/api/content/admin/blocks/' + heroId, {
      page: 'home', section: 'hero', title: newTitle, description: 'زیرعنوان تست',
      icon: 'مشاهده تست', href: '/products', image: '/static/images/hero-3-rack.jpg',
      sort_order: 99, is_active: 1,
    }, token);
    ok('edit hero block via admin API', upd.status >= 200 && upd.status < 300, 'status=' + upd.status);
    const home = await hget('/');
    ok('edited hero title reflected on homepage', home.t.includes(newTitle));
    ok('old hero title gone from homepage', !home.t.includes(heroTitle));
  }

  // ============ 5) DEACTIVATE a block -> hidden on site ============
  if (sideId) {
    const upd = await jsend('PUT', '/api/content/admin/blocks/' + sideId, {
      page: 'home', section: 'side_banner', title: sideTitle, description: 'کناری تست',
      icon: 'fa-bolt', href: '/products', sort_order: 99, is_active: 0,
    }, token);
    ok('deactivate side_banner via admin API', upd.status >= 200 && upd.status < 300, 'status=' + upd.status);
    const home = await hget('/');
    ok('deactivated side_banner hidden on homepage', !home.t.includes(sideTitle));
  }

  // ============ 6) STATIC PAGE (pages) -> about page ============
  const aboutTitle = 'صفحه‌تست ' + uniq;
  const createPage = await jsend('POST', '/api/content/admin/pages', {
    page: 'about', section: 'main', title: aboutTitle, subtitle: 'زیرعنوان', body: 'متن تست صفحه', is_active: 1,
  }, token);
  ok('create/update static page via admin API', createPage.status >= 200 && createPage.status < 300, 'status=' + createPage.status);
  {
    const pub = await jget('/api/content/pages?page=about');
    const found = Array.isArray(pub.j?.data) && pub.j.data.some(p => p.title === aboutTitle);
    ok('static page readable from public content API', found);
  }

  // ============ 7) CATEGORY -> appears in site categories ============
  const catName = 'دسته‌تست ' + uniq;
  const catSlug = 'cat-test-' + uniq;
  const createCat = await jsend('POST', '/api/misc/admin/categories', {
    name: catName, slug: catSlug, icon: 'fa-network-wired', is_active: 1,
  }, token);
  // misc categories may be mounted at /api/admin/categories (not /api/misc/...). try both.
  let catRes = createCat;
  if (catRes.status === 404) {
    catRes = await jsend('POST', '/api/admin/categories', { name: catName, slug: catSlug, icon: 'fa-network-wired', is_active: 1 }, token);
  }
  ok('create category via admin API', catRes.status >= 200 && catRes.status < 300, 'status=' + catRes.status);
  const catId = catRes.j?.data?.id;
  {
    const cats = await hget('/categories');
    ok('new category appears on /categories', cats.t.includes(catName));
  }

  // ============ 8) BRAND -> created ============
  const brandName = 'برندتست ' + uniq;
  const brandSlug = 'brand-test-' + uniq;
  let brandRes = await jsend('POST', '/api/products/admin/brands', { name: brandName, slug: brandSlug, is_active: 1 }, token);
  if (brandRes.status === 404) brandRes = await jsend('POST', '/api/admin/brands', { name: brandName, slug: brandSlug, is_active: 1 }, token);
  ok('create brand via admin API', brandRes.status >= 200 && brandRes.status < 300, 'status=' + brandRes.status);
  const brandId = brandRes.j?.data?.id;

  // ============ 9) PRODUCT -> appears on products page ============
  const prodName = 'محصول‌تست ' + uniq;
  const prodSlug = 'prod-test-' + uniq;
  const createProd = await jsend('POST', '/api/products', {
    name: prodName, slug: prodSlug, price: 1234000, stock: 7,
    category_id: catId || 1, brand_id: brandId || null,
    description: 'توضیح محصول تست', is_active: 1,
  }, token);
  ok('create product via admin API', createProd.status >= 200 && createProd.status < 300, 'status=' + createProd.status);
  const prodId = createProd.j?.data?.id || createProd.j?.data?.product?.id;
  {
    const list = await jget('/api/products?search=' + encodeURIComponent(prodName));
    const items = list.j?.data?.items || list.j?.data || [];
    ok('new product returned by public products API', Array.isArray(items) && items.some(p => p.name === prodName));
    const pdp = await hget('/product/' + prodSlug);
    ok('new product detail page renders (200)', pdp.status === 200);
    ok('new product name on its detail page', pdp.t.includes(prodName));
  }

  // ============ 10) BLOG POST -> appears on blog ============
  const postTitle = 'مقاله‌تست ' + uniq;
  const postSlug = 'post-test-' + uniq;
  const createPost = await jsend('POST', '/api/blog/admin/posts', {
    title: postTitle, slug: postSlug, content: 'محتوای مقاله تست برای بررسی اتصال داشبورد به سایت.',
    excerpt: 'خلاصه تست', category: 'تست', is_published: 1,
  }, token);
  ok('create blog post via admin API', createPost.status >= 200 && createPost.status < 300, 'status=' + createPost.status);
  const postId = createPost.j?.data?.id;
  {
    const blog = await hget('/blog');
    ok('new post appears on /blog', blog.t.includes(postTitle));
    const single = await hget('/blog/' + postSlug);
    ok('new post single page renders (200)', single.status === 200);
    ok('new post title on its page', single.t.includes(postTitle));
  }

  // ============ 11) SETTINGS -> reflected on site ============
  // settings live in misc.js mounted at /api -> /api/admin/settings; contact page reads settings.phone
  let originalPhone = null;
  {
    const settingsGet = await jget('/api/admin/settings', token);
    ok('admin settings readable', settingsGet.status >= 200 && settingsGet.status < 300, 'status=' + settingsGet.status);
    originalPhone = settingsGet.j?.data?.phone ?? null;
    const newPhone = '021-' + uniq.slice(-6);
    const updSettings = await jsend('PUT', '/api/admin/settings', { phone: newPhone }, token);
    ok('update settings via admin API', updSettings.status >= 200 && updSettings.status < 300, 'status=' + updSettings.status);
    const contact = await hget('/contact');
    ok('updated phone setting reflected on contact page', contact.t.includes(newPhone), 'phone=' + newPhone);
    // restore original phone so we don't leave test data behind
    if (originalPhone != null) await jsend('PUT', '/api/admin/settings', { phone: originalPhone }, token);
  }

  // ============ CLEANUP ============
  if (heroId) await jsend('DELETE', '/api/content/admin/blocks/' + heroId, null, token);
  if (sideId) await jsend('DELETE', '/api/content/admin/blocks/' + sideId, null, token);
  if (midId) await jsend('DELETE', '/api/content/admin/blocks/' + midId, null, token);
  if (postId) await jsend('DELETE', '/api/blog/admin/posts/' + postId, null, token);
  // products/categories/brands: try delete (best-effort)
  if (prodId) await jsend('DELETE', '/api/products/' + prodId, null, token);
  if (catId) { let d = await jsend('DELETE', '/api/misc/admin/categories/' + catId, null, token); if (d.status === 404) await jsend('DELETE', '/api/admin/categories/' + catId, null, token); }
  if (brandId) { let d = await jsend('DELETE', '/api/products/admin/brands/' + brandId, null, token); if (d.status === 404) await jsend('DELETE', '/api/admin/brands/' + brandId, null, token); }

  done();
}

function done() {
  console.log('\n  test_dashboard_sync: ' + pass + ' passed, ' + fail + ' failed');
  if (fails.length) { console.log('  FAILURES:'); fails.forEach(f => console.log('   - ' + f)); }
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
