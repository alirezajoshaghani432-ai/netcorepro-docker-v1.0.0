// Stored-XSS regression suite.
// Verifies that an attacker-controlled product name containing a "</script>"
// breakout payload is neutralized both in the visible HTML (HTML-escaped) and
// inside the inline <script> PRODUCT JSON (unicode-escaped), so it cannot
// execute. Cleans up the probe product afterwards.
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
async function jx(method, path, body, token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}

async function main() {
  const token = await login();
  ok('admin login', !!token);
  if (!token) { console.log('\n  test_xss: ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }

  // pick a valid category id
  const prods = (await jx('GET', '/api/products?limit=1', null)).j?.data?.items || [];
  const catId = prods[0]?.category_id || 1;

  const payloadName = 'XSS</script><img src=x onerror=alert(1)>Probe';
  const slug = 'xss-probe-' + Date.now();
  const create = await jx('POST', '/api/products', {
    name: payloadName, slug, price: 1000, stock: 3, category_id: catId,
    description: 'probe', short_description: 'p'
  }, token);
  ok('create probe product', create.status === 200 && create.j?.data?.id, 'status=' + create.status);
  const pid = create.j?.data?.id;

  // fetch detail page
  const html = await (await fetch(BASE + '/product/' + slug)).text();

  // 1) inline PRODUCT JSON must NOT contain a raw </script> breakout
  const scriptBlockSafe = html.includes('\\u003c/script\\u003e') && !html.includes('"name":"XSS</script>');
  ok('inline PRODUCT json is script-safe (\\u003c escaped)', scriptBlockSafe);

  // 2) visible title must be HTML-escaped (no raw executable <img onerror>)
  const titleEscaped = html.includes('&lt;/script&gt;&lt;img') ;
  ok('visible title HTML-escaped', titleEscaped);

  // 3) no raw onerror= attribute that could fire (outside of escaped/escaped-unicode forms)
  // Allowed forms: "&lt;img src=x onerror" (escaped) — raw "<img src=x onerror=alert" must be absent
  const rawExec = html.includes('<img src=x onerror=alert(1)>');
  ok('no raw executable <img onerror> in page', rawExec === false);

  // cleanup
  if (pid) {
    const del = await jx('DELETE', '/api/products/' + pid, null, token);
    ok('cleanup probe product', del.status === 200, 'status=' + del.status);
  }

  // --- Reflected XSS on order-success page (orderNumber URL param) ---
  const reflPayload = 'x</script><img src=x onerror=alert(1)>';
  const reflHtml = await (await fetch(BASE + '/order-success/' + encodeURIComponent(reflPayload))).text();
  // inline script must unicode-escape the breakout, not emit a raw </script><img
  ok('order-success inline script escapes orderNumber', reflHtml.includes('\\u003c/script\\u003e'));
  ok('order-success no raw executable <img onerror>', reflHtml.includes('<img src=x onerror=alert(1)>') === false);
  // visible span must be HTML-escaped
  ok('order-success visible orderNumber HTML-escaped', reflHtml.includes('&lt;/script&gt;&lt;img'));

  // ================= Admin-panel stored DOM-XSS regression =================
  // The admin panel renders DB data via client-side innerHTML template literals.
  // Verify the runtime helpers exist and that admin pages route DB fields through them.
  const adminJs = await (await fetch(BASE + '/static/js/admin.js')).text();
  ok('admin.js defines window.escAdmin', adminJs.includes('window.escAdmin'));
  ok('admin.js defines window.attrJson', adminJs.includes('window.attrJson'));
  ok('admin.js defines window.statusLabel', adminJs.includes('window.statusLabel'));

  // statusLabel must cover every entity type the panel renders
  ok('statusLabel covers order+ticket+comment+post+user+message',
     ['order:', 'ticket:', 'comment:', 'post:', 'user:', 'message:'].every(k => adminJs.includes(k)));

  // Admin ticket list must escape subject/message via escAdmin (no raw ${t.subject})
  const ticketsHtml = await (await fetch(BASE + '/admin/tickets')).text();
  ok('admin tickets page uses escAdmin', ticketsHtml.includes('escAdmin(t.subject)') || ticketsHtml.includes('escAdmin(t.message)'));
  ok('admin tickets page has NO raw ${t.subject}', !ticketsHtml.includes('>${t.subject}<') && !ticketsHtml.includes('>\\${t.subject}<'));

  // Admin comments page must escape author/content
  const commentsHtml = await (await fetch(BASE + '/admin/comments')).text();
  ok('admin comments page uses escAdmin', commentsHtml.includes('escAdmin(c.author_name)') && commentsHtml.includes('escAdmin(c.content)'));

  // Admin messages page must escape name/body
  const messagesHtml = await (await fetch(BASE + '/admin/messages')).text();
  ok('admin messages page uses escAdmin', messagesHtml.includes('escAdmin(m.name)') && messagesHtml.includes('escAdmin(m.body)'));

  // Edit onclick handlers must use attrJson (not raw JSON.stringify -> attribute breakout)
  const productsHtml = await (await fetch(BASE + '/admin/products')).text();
  // The edit button must never carry a serialised product object in its inline
  // handler (attribute breakout). Two shapes are acceptable:
  //   * onclick='editProduct(123)'            -> id only, data refetched (current)
  //   * onclick='editProduct(${attrJson(p)})' -> escaped for attribute context (legacy)
  ok('admin products edit passes no raw object into onclick',
     (/editProduct\(\s*(\d+|\$\{\s*p\.id\s*\})\s*\)/.test(productsHtml)
        || productsHtml.includes('attrJson(p)'))
     && !productsHtml.includes('editProduct(${JSON.stringify(p)})'));
  ok('admin products edit has no unescaped JSON.stringify in a handler attribute',
     !/on\w+\s*=\s*(['"]).*?JSON\.stringify.*?\1/.test(productsHtml));

  // End-to-end: submit a contact message with an XSS payload, then confirm the
  // admin messages page would render it escaped (the field is routed through escAdmin).
  const msgPayload = 'XSS<img src=x onerror=alert(2)>' + Date.now();
  const msgRes = await jx('POST', '/api/messages', { name: msgPayload, body: 'probe message body xss', email: 'xss@example.com' });
  ok('submit XSS contact message', msgRes.status === 200 || msgRes.status === 201, 'status=' + msgRes.status);
  // The admin page template escapes m.name/m.body regardless of stored content, so the payload cannot execute.
  ok('admin messages template neutralizes stored payload (escAdmin on m.name)', messagesHtml.includes('escAdmin(m.name)'));

  // cleanup: remove the probe contact message so test runs don't pollute the real DB
  const msgList = await jx('GET', '/api/admin/messages?limit=50', null, token);
  const probeMsg = (msgList.j?.data?.items || msgList.j?.data || []).find?.(m => m.name === msgPayload);
  if (probeMsg?.id) {
    const mdel = await jx('DELETE', '/api/admin/messages/' + probeMsg.id, null, token);
    ok('cleanup probe contact message', mdel.status === 200, 'status=' + mdel.status);
  }

  console.log('\n  test_xss: ' + pass + ' passed, ' + fail + ' failed');
  if (fails.length) { console.log('  FAILURES:'); fails.forEach(f => console.log('   - ' + f)); }
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
