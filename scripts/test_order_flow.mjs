#!/usr/bin/env node
/* E2E order flow: create order, verify stock decrement, totals, edge cases, confirmation page. */
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const failures=[];
function log(ok,name,d){if(ok){pass++;console.log(`  \x1b[32m✓\x1b[0m ${name}`);}else{fail++;failures.push(name+(d?' :: '+d:''));console.log(`  \x1b[31m✗\x1b[0m ${name}${d?'  -> '+d:''}`);}}
const J = r => r.json();

async function main(){
  // pick an active product with stock
  const prods = await J(await fetch(BASE+'/api/products?limit=50'));
  const items = prods?.data?.items || [];
  const p = items.find(x => x.stock >= 2) || items[0];
  log(!!p, 'found a product with stock for order', p?`id=${p.id} stock=${p.stock}`:'none');
  const stockBefore = p.stock;
  const qty = 2;

  console.log('\n\x1b[36m── Valid order creation ──\x1b[0m');
  let r = await fetch(BASE+'/api/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({
    customer_name:'تست خریدار', customer_phone:'09120000000', customer_email:'buyer@ex.com',
    shipping_address:'تهران، خیابان آزادی، پلاک ۱', shipping_city:'تهران',
    items:[{ product_id:p.id, quantity:qty }]
  })});
  let j = await r.json();
  log(r.status===200 && j?.success, 'order created (200)', `status=${r.status} num=${j?.data?.order_number}`);
  const orderNumber = j?.data?.order_number;
  const expectShipping = 500000;
  const unit = p.discount_price || p.price;
  log(j?.data?.total === unit*qty + expectShipping, 'order total = subtotal + shipping', `total=${j?.data?.total} expected=${unit*qty+expectShipping}`);

  // verify stock decremented
  const after = await J(await fetch(BASE+'/api/products/'+p.slug));
  const stockAfter = after?.data?.product?.stock;
  log(stockAfter === stockBefore - qty, 'stock decremented by qty', `before=${stockBefore} after=${stockAfter}`);

  console.log('\n\x1b[36m── Order confirmation lookup ──\x1b[0m');
  r = await fetch(BASE+'/api/orders/by-number/'+orderNumber);
  j = await r.json();
  log(r.status===200 && j?.data?.order_number===orderNumber, 'GET /api/orders/by-number returns order', `status=${r.status}`);
  // confirmation page renders
  r = await fetch(BASE+'/order-success/'+orderNumber);
  const html = await r.text();
  log(r.status===200 && html.includes(orderNumber), 'order-success page renders order number', `status=${r.status}`);

  console.log('\n\x1b[36m── Order edge cases (rejected) ──\x1b[0m');
  async function bad(body, name, expect=400){
    const rr = await fetch(BASE+'/api/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    log(rr.status===expect, name, `status=${rr.status}`);
  }
  await bad({ customer_name:'A', customer_phone:'09120000000', shipping_address:'تهران جای خوب', items:[{product_id:p.id,quantity:1}] }, 'short customer_name rejected');
  await bad({ customer_name:'تست', customer_phone:'123', shipping_address:'تهران جای خوب', items:[{product_id:p.id,quantity:1}] }, 'short phone rejected');
  await bad({ customer_name:'تست', customer_phone:'09120000000', shipping_address:'کم', items:[{product_id:p.id,quantity:1}] }, 'short address (<5 chars) rejected');
  await bad({ customer_name:'تست', customer_phone:'09120000000', shipping_address:'تهران جای خوب', items:[] }, 'empty cart rejected');
  await bad({ customer_name:'تست', customer_phone:'09120000000', shipping_address:'تهران جای خوب', items:[{product_id:999999,quantity:1}] }, 'nonexistent product rejected');
  await bad({ customer_name:'تست', customer_phone:'09120000000', shipping_address:'تهران جای خوب', items:[{product_id:p.id,quantity:999999}] }, 'insufficient stock rejected');

  console.log(`\n\x1b[1m═══ RESULTS: ${pass} passed, ${fail} failed ═══\x1b[0m`);
  if(failures.length){console.log('\x1b[31mFailures:\x1b[0m');failures.forEach(f=>console.log('  - '+f));process.exit(1);}
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(2);});
