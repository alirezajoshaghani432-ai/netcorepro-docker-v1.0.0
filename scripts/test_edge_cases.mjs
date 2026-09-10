// Edge-case audit: malformed/hostile inputs must never produce a 500.
// Also checks validation returns proper 4xx and stable response shape.
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) { if (cond) pass++; else { fail++; fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗', name, extra || ''); } }

async function login() {
  for (let i = 0; i < 8; i++) {
    const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@netcorepro.ir', password: (process.env.ADMIN_PASSWORD || 'admin123') }) });
    const j = await r.json().catch(() => ({}));
    if (j?.data?.token) return j.data.token;
    if (r.status === 429) { await new Promise(s => setTimeout(s, 9000)); continue; }
    return null;
  }
  return null;
}
async function req(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  let payload;
  if (raw !== undefined) { headers['Content-Type'] = 'application/json'; payload = raw; }
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(BASE + path, { method, headers, body: payload });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}

const cases = [
  // [name, method, path, opts, allowedStatuses]
  ['products page=-1 limit=huge', 'GET', '/api/products?page=-1&limit=99999', {}, null],
  ['products page=abc limit=xyz', 'GET', '/api/products?page=abc&limit=xyz', {}, null],
  ['products limit=-5', 'GET', '/api/products?limit=-5', {}, null],
  ['products sort injection', 'GET', '/api/products?sort=%3BDROP%20TABLE', {}, null],
  ['products category bad', 'GET', '/api/products?category=' + encodeURIComponent("' OR 1=1--"), {}, null],
  ['products search xss', 'GET', '/api/products?search=' + encodeURIComponent('<script>x</script>'), {}, null],
  ['products huge page number', 'GET', '/api/products?page=999999999999', {}, null],
  ['order huge id (auth)', 'GET', '/api/orders/99999999', { needAuth: true }, [404, 403]],
  ['order id=abc (auth)', 'GET', '/api/orders/abc', { needAuth: true }, [404, 400, 403]],
  ['order id negative (auth)', 'GET', '/api/orders/-1', { needAuth: true }, [404, 400, 403]],
  ['product bad slug', 'GET', '/api/products/notaslug-xyz-' + Date.now(), {}, [404, 200]],
  ['blog bad slug', 'GET', '/api/blog/posts/notreal-' + Date.now(), {}, [404, 200]],
  ['orders malformed json', 'POST', '/api/orders', { raw: '{bad json' }, [400]],
  ['tickets malformed json (auth)', 'POST', '/api/tickets', { needAuth: true, raw: '{nope' }, [400]],
  ['product negative price (auth)', 'POST', '/api/products', { needAuth: true, body: { name: 'x', price: -100, slug: 'x' } }, [400]],
  ['product missing fields (auth)', 'POST', '/api/products', { needAuth: true, body: {} }, [400]],
  ['newsletter bad email', 'POST', '/api/newsletter/subscribe', { body: { email: 'notanemail' } }, [400]],
  ['newsletter empty body', 'POST', '/api/newsletter/subscribe', { raw: '{}' }, [400]],
  ['register bad email', 'POST', '/api/auth/register', { body: { email: 'bad', password: '123456', full_name: 'X' } }, [400]],
  ['register short password', 'POST', '/api/auth/register', { body: { email: 't' + Date.now() + '@ex.com', password: '1', full_name: 'X' } }, [400]],
  ['order empty items (auth)', 'POST', '/api/orders', { needAuth: true, body: { customer_name: 'Ab', customer_phone: '0912000000', shipping_address: 'addr long enough', items: [] } }, [400]],
  ['order non-existent product (auth)', 'POST', '/api/orders', { needAuth: true, body: { customer_name: 'Ab', customer_phone: '09120000000', shipping_address: 'addr long enough', items: [{ product_id: 9999999, quantity: 1 }] } }, [400]],
  ['contact message empty', 'POST', '/api/messages', { raw: '{}' }, [400]],
  ['huge negative limit orders (auth)', 'GET', '/api/orders?limit=-999', { needAuth: true }, null],
  ['blocks bad page param', 'GET', '/api/content/blocks?page=' + encodeURIComponent("'; DROP"), {}, null],
  ['admin settings non-object (auth)', 'PUT', '/api/admin/settings', { needAuth: true, raw: '"juststring"' }, [400, 200]],
];

async function main() {
  const token = await login();
  ok('admin login', !!token);
  for (const [name, method, path, opts, allowed] of cases) {
    const o = { ...opts };
    if (o.needAuth) o.token = token;
    const r = await req(method, path, o);
    // PRIMARY assertion: never 500
    ok('no-500: ' + name, r.status !== 500, 'status=' + r.status);
    // SECONDARY: if allowed list given, status must be in it
    if (allowed) ok('status-ok: ' + name, allowed.includes(r.status), 'status=' + r.status + ' allowed=' + allowed.join('/'));
    // response should be JSON with success flag for API routes
    if (r.j) ok('json-shape: ' + name, typeof r.j.success === 'boolean' || typeof r.j.code === 'number', JSON.stringify(r.j).slice(0, 80));
  }
  console.log('\n  test_edge_cases: ' + pass + ' passed, ' + fail + ' failed');
  if (fails.length) { console.log('  FAILURES:'); fails.forEach(f => console.log('   - ' + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
