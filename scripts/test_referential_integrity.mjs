// Referential integrity and stock-safety suite.
//  * deleting a user who authored a blog post or a ticket reply must succeed:
//    posts.author_id / ticket_replies.user_id are nulled, the content is kept
//    and no foreign-key error reaches the client;
//  * a user who still owns orders is blocked instead of deleted;
//  * a cart containing the same product twice must not oversell — the lines
//    are merged and stock can never go negative;
//  * an update that would duplicate a UNIQUE slug/sku answers 400.
import db from '../dist/db/index.js';
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const fails=[];
function ok(n,c,e){ if(c)pass++; else {fail++; fails.push(n+(e?' :: '+e:'')); console.log('  ✗',n,e||'');} }
async function login(email,pw){ for(let i=0;i<8;i++){ const r=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw})}); const j=await r.json().catch(()=>({})); if(j?.data?.token)return j.data.token; if(r.status===429){await new Promise(s=>setTimeout(s,9000));continue;} return null;} return null; }
async function jx(m,p,b,t){ const h={'Content-Type':'application/json'}; if(t)h.Authorization='Bearer '+t; const r=await fetch(BASE+p,{method:m,headers:h,body:b?JSON.stringify(b):undefined}); let j=null;try{j=await r.json();}catch{} return {status:r.status,j}; }

async function main(){
  const admin = await login('admin@netcorepro.ir',(process.env.ADMIN_PASSWORD || 'admin123'));
  ok('admin login', !!admin);

  // ===== delete user with authored post + ticket reply (FK guard) =====
  const email = `r7_${Date.now()}@test.ir`;
  const uid = db.prepare(`INSERT INTO users (email, password, full_name, role, status) VALUES (?, 'x', 'R7 User', 'customer', 'active')`).run(email).lastInsertRowid;
  const pslug = 'r7-'+Date.now();
  db.prepare(`INSERT INTO posts (title, slug, content, author_id, status) VALUES ('R7 Post', ?, 'long enough content body', ?, 'published')`).run(pslug, uid);
  // a ticket owned by admin (id=1); reply BY the throwaway user (simulates staff who replied)
  const tnum = 'TK-R7-'+Date.now();
  const tid = db.prepare(`INSERT INTO tickets (ticket_number, user_id, subject, message, status) VALUES (?, 1, 'r7', 'm', 'open')`).run(tnum).lastInsertRowid;
  db.prepare(`INSERT INTO ticket_replies (ticket_id, user_id, is_admin, author_name, message) VALUES (?, ?, 0, 'R7', 'reply')`).run(tid, uid);

  const del = await jx('DELETE', `/api/admin/users/${uid}`, null, admin);
  ok('user delete returns 200 (no FK 500)', del.status===200 && del.j?.success, 'status='+del.status+' body='+JSON.stringify(del.j));

  // verify state via fresh reads (avoid same-tick snapshot: query after the awaited fetch)
  const gone = db.prepare(`SELECT id FROM users WHERE id=?`).get(uid);
  ok('user removed from DB', !gone);
  const post = db.prepare(`SELECT author_id FROM posts WHERE slug=?`).get(pslug);
  ok('post kept, author_id nulled', post && post.author_id===null, 'post='+JSON.stringify(post));
  const rep = db.prepare(`SELECT user_id FROM ticket_replies WHERE ticket_id=?`).get(tid);
  ok('ticket_reply kept, user_id nulled', rep && rep.user_id===null, 'rep='+JSON.stringify(rep));

  // cleanup
  db.prepare(`DELETE FROM ticket_replies WHERE ticket_id=?`).run(tid);
  db.prepare(`DELETE FROM tickets WHERE id=?`).run(tid);
  db.prepare(`DELETE FROM posts WHERE slug=?`).run(pslug);

  // ===== user with orders is still soft-blocked (not hard-deleted) =====
  const email2 = `r7b_${Date.now()}@test.ir`;
  const uid2 = db.prepare(`INSERT INTO users (email, password, full_name, role, status) VALUES (?, 'x', 'R7b', 'customer', 'active')`).run(email2).lastInsertRowid;
  const onum = 'ORD-R7-'+Date.now();
  const oid = db.prepare(`INSERT INTO orders (order_number, user_id, customer_name, customer_phone, shipping_address, subtotal, total, status) VALUES (?, ?, 'R7b', '0912', 'addr', 100, 100, 'pending')`).run(onum, uid2).lastInsertRowid;
  const del2 = await jx('DELETE', `/api/admin/users/${uid2}`, null, admin);
  ok('user-with-order soft-blocked not deleted', del2.status===200 && del2.j?.success, 'status='+del2.status);
  const still = db.prepare(`SELECT status FROM users WHERE id=?`).get(uid2);
  ok('blocked user still exists', still && still.status==='blocked', 'status='+JSON.stringify(still));
  db.prepare(`DELETE FROM orders WHERE id=?`).run(oid);
  db.prepare(`DELETE FROM users WHERE id=?`).run(uid2);

  // ===== duplicate product line in cart must not oversell (stock never negative) =====
  const p = db.prepare(`SELECT id, stock FROM products WHERE status='active' AND stock BETWEEN 2 AND 100 LIMIT 1`).get();
  ok('found a product with limited stock', !!p, 'p='+JSON.stringify(p));
  if (p) {
    // two lines each qty=stock -> cumulative 2*stock > stock -> must be rejected 400
    const over = await jx('POST','/api/orders',{ customer_name:'R7Dup', customer_phone:'09120000000', shipping_address:'آدرس کامل تست سفارش', items:[{product_id:p.id,quantity:p.stock},{product_id:p.id,quantity:p.stock}] });
    ok('oversell (duplicate line) rejected 400', over.status===400, 'status='+over.status);
    const s1 = db.prepare(`SELECT stock FROM products WHERE id=?`).get(p.id).stock;
    ok('stock unchanged after rejected oversell', s1===p.stock, 's1='+s1+' orig='+p.stock);
    ok('stock never negative', s1>=0, 's1='+s1);
    // valid duplicate lines qty 1 + 1 -> merge to 1 line qty 2, deduct exactly 2
    const okOrder = await jx('POST','/api/orders',{ customer_name:'R7Dup2', customer_phone:'09120000000', shipping_address:'آدرس کامل تست سفارش', items:[{product_id:p.id,quantity:1},{product_id:p.id,quantity:1}] });
    ok('valid duplicate-line order 200', okOrder.status===200 && okOrder.j?.success, 'status='+okOrder.status);
    const s2 = db.prepare(`SELECT stock FROM products WHERE id=?`).get(p.id).stock;
    ok('deducted exactly 2 (merged)', s2===p.stock-2, 's2='+s2+' orig='+p.stock);
    const oid3 = okOrder.j?.data?.id;
    if (oid3) {
      const lines = db.prepare(`SELECT quantity FROM order_items WHERE order_id=?`).all(oid3);
      ok('duplicate lines merged into single order_item', lines.length===1 && lines[0].quantity===2, 'lines='+JSON.stringify(lines));
      db.prepare(`DELETE FROM order_items WHERE order_id=?`).run(oid3);
      db.prepare(`DELETE FROM orders WHERE id=?`).run(oid3);
    }
    db.prepare(`UPDATE products SET stock=? WHERE id=?`).run(p.stock, p.id);
  }

  // ===== update with duplicate UNIQUE slug/sku must answer 400, not crash =====
  const posts = db.prepare(`SELECT id, slug FROM posts LIMIT 2`).all();
  if (posts.length >= 2) {
    const r = await jx('PUT', `/api/blog/admin/posts/${posts[0].id}`, { slug: posts[1].slug }, admin);
    ok('blog PUT duplicate slug -> 400 (not 500)', r.status===400, 'status='+r.status);
    const unchanged = db.prepare(`SELECT slug FROM posts WHERE id=?`).get(posts[0].id).slug;
    ok('blog post slug unchanged after rejected dup', unchanged===posts[0].slug);
  }
  const prods = db.prepare(`SELECT id, slug, sku FROM products WHERE status='active' LIMIT 2`).all();
  if (prods.length >= 2) {
    const rs = await jx('PUT', `/api/products/${prods[0].id}`, { slug: prods[1].slug }, admin);
    ok('product PUT duplicate slug -> 400 (not 500)', rs.status===400, 'status='+rs.status);
    if (prods[1].sku) {
      const rk = await jx('PUT', `/api/products/${prods[0].id}`, { sku: prods[1].sku }, admin);
      ok('product PUT duplicate sku -> 400 (not 500)', rk.status===400, 'status='+rk.status);
    } else { ok('product PUT duplicate sku (skipped, no sku)', true); }
    // a valid product edit still succeeds
    const rv = await jx('PUT', `/api/products/${prods[0].id}`, { short_description: 'R7 valid edit '+Date.now() }, admin);
    ok('product PUT valid edit -> 200', rv.status===200 && rv.j?.success, 'status='+rv.status);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fails.length) console.log('FAILURES:\n - '+fails.join('\n - '));
  process.exit(fail>0?1:0);
}
main().catch(e=>{ console.error('SUITE ERROR', e); process.exit(1); });
