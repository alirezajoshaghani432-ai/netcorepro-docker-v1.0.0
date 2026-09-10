#!/usr/bin/env node
/* Access-control / IDOR audit: a customer cannot read another customer's orders or tickets.
 * Also: malformed-JSON robustness (400 not 500) and content API public reads. */
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const failures=[];
function log(ok,name,d){if(ok){pass++;console.log(`  \x1b[32m✓\x1b[0m ${name}`);}else{fail++;failures.push(name+(d?' :: '+d:''));console.log(`  \x1b[31m✗\x1b[0m ${name}${d?'  -> '+d:''}`);}}
async function call(method, path, { token, body, raw } = {}) {
  const h = {}; if (token) h['Authorization']='Bearer '+token;
  if (body!==undefined || raw!==undefined) h['Content-Type']='application/json';
  const r = await fetch(BASE+path, { method, headers:h, body: raw!==undefined ? raw : (body!==undefined?JSON.stringify(body):undefined) });
  let j=null; try{j=await r.json();}catch(e){}
  return { status:r.status, json:j };
}
const reg = async (email) => (await call('POST','/api/auth/register',{ body:{ email, password:'secret123', full_name:'IDOR Test '+email.slice(0,4) } })).json?.data?.token;
const login = async (email,password) => (await call('POST','/api/auth/login',{ body:{ email, password } })).json?.data?.token;

async function main(){
  const stamp = Date.now();
  // two distinct customers
  const tokenA = await reg(`idorA_${stamp}@ex.com`) || await login(`idorA_${stamp}@ex.com`,'secret123');
  const tokenB = await reg(`idorB_${stamp}@ex.com`) || await login(`idorB_${stamp}@ex.com`,'secret123');
  log(!!tokenA && !!tokenB && tokenA!==tokenB, 'two distinct customer tokens created', `A=${!!tokenA} B=${!!tokenB}`);

  // customer A places an order.
  // Pick the first IN-STOCK product: product #1 in the seed is intentionally
  // out-of-stock (to exercise the out-of-stock UI), and the order API correctly
  // rejects ordering it — so blindly taking prods[0] would falsely fail.
  const prods = (await call('GET','/api/products?limit=20')).json?.data?.items || [];
  const inStock = prods.find(p => (p.stock ?? 0) > 0) || prods[0];
  const pid = inStock?.id;
  const ord = await call('POST','/api/orders',{ token:tokenA, body:{
    customer_name:'User A', customer_phone:'09120000001', shipping_address:'تهران آدرس کامل تستی',
    items:[{ product_id:pid, quantity:1 }]
  }});
  const orderId = ord.json?.data?.id;
  log(ord.status===200 && orderId, 'customer A created an order', `status=${ord.status} id=${orderId}`);

  // customer A opens a ticket
  const tk = await call('POST','/api/tickets',{ token:tokenA, body:{ subject:'A private ticket', message:'This is A private message.' } });
  const aTickets = (await call('GET','/api/tickets',{ token:tokenA })).json?.data || [];
  const ticketId = aTickets[0]?.id;
  log(tk.status===200 && ticketId, 'customer A created a ticket', `status=${tk.status} id=${ticketId}`);

  console.log('\n\x1b[36m── IDOR: customer B cannot access A\'s resources ──\x1b[0m');
  let r = await call('GET','/api/orders/'+orderId,{ token:tokenB });
  log(r.status===403 || r.status===404, "B cannot GET A's order (403/404)", `status=${r.status}`);
  r = await call('GET','/api/orders/'+orderId,{ token:tokenA });
  log(r.status===200, "A CAN GET A's own order (200)", `status=${r.status}`);
  r = await call('GET','/api/tickets/'+ticketId,{ token:tokenB });
  log(r.status===403 || r.status===404, "B cannot GET A's ticket (403/404)", `status=${r.status}`);
  r = await call('GET','/api/tickets/'+ticketId,{ token:tokenA });
  log(r.status===200, "A CAN GET A's own ticket (200)", `status=${r.status}`);
  r = await call('POST','/api/tickets/'+ticketId+'/replies',{ token:tokenB, body:{ message:'B trying to reply' } });
  log(r.status===403 || r.status===404, "B cannot reply to A's ticket (403/404)", `status=${r.status}`);
  const bOrders = (await call('GET','/api/orders',{ token:tokenB })).json?.data?.items || [];
  log(!bOrders.some(o => o.id===orderId), "A's order absent from B's order list", `Bcount=${bOrders.length}`);

  console.log('\n\x1b[36m── Malformed-JSON robustness (4xx, not 500) ──\x1b[0m');
  for (const [p, raw] of [['/api/auth/login','{bad'],['/api/orders','garbage'],['/api/messages','{,}'],['/api/newsletter/subscribe','[oops']]) {
    const rr = await call('POST', p, { raw });
    log(rr.status>=400 && rr.status<500, `malformed JSON ${p} -> 4xx`, `status=${rr.status}`);
  }

  console.log('\n\x1b[36m── Content API public reads ──\x1b[0m');
  r = await call('GET','/api/content/blocks'); log(r.status===200, 'GET /api/content/blocks -> 200', `status=${r.status}`);
  r = await call('GET','/api/content/pages');  log(r.status===200, 'GET /api/content/pages -> 200', `status=${r.status}`);
  r = await call('GET','/api/content/admin/blocks'); log(r.status===401, 'admin content blocks reject no-token', `status=${r.status}`);

  console.log(`\n\x1b[1m═══ RESULTS: ${pass} passed, ${fail} failed ═══\x1b[0m`);
  if(failures.length){console.log('\x1b[31mFailures:\x1b[0m');failures.forEach(f=>console.log('  - '+f));process.exit(1);}
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(2);});
