const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const fails=[];
function ok(n,c,e){ if(c)pass++; else {fail++; fails.push(n+(e?' :: '+e:'')); console.log('  ✗',n,e||'');} }
async function login(email,pw){ for(let i=0;i<8;i++){ const r=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw})}); const j=await r.json().catch(()=>({})); if(j?.data?.token)return j.data.token; if(r.status===429){await new Promise(s=>setTimeout(s,9000));continue;} return null;} return null; }
async function jx(m,p,b,t){ const h={'Content-Type':'application/json'}; if(t)h.Authorization='Bearer '+t; const r=await fetch(BASE+p,{method:m,headers:h,body:b?JSON.stringify(b):undefined}); let j=null;try{j=await r.json();}catch{} return {status:r.status,j}; }

async function main(){
  const admin = await login('admin@netcorepro.ir',(process.env.ADMIN_PASSWORD || 'admin123'));
  ok('admin login', !!admin);

  // ===== A) COMMENT MODERATION LIFECYCLE =====
  const postsR = await jx('GET','/api/blog/posts?limit=1');
  const post = postsR.j?.data?.items?.[0] || postsR.j?.data?.[0];
  ok('found a published post', !!(post && post.id));
  if(post){
    const marker = 'SF_MOD_'+Date.now();
    const sub = await jx('POST',`/api/blog/posts/${post.id}/comments`, { author_name:'تستر', author_email:'sf@test.ir', content: marker+' دیدگاه آزمایشی' });
    ok('comment submit 200', sub.status===200 && sub.j?.success, 'status='+sub.status);
    // pending -> not visible publicly
    const pub1 = await jx('GET',`/api/blog/posts/${post.slug}`);
    ok('pending comment NOT public', !((pub1.j?.data?.comments||[]).some(x=>x.content.includes(marker))));
    // admin sees it in queue
    const q = await jx('GET','/api/blog/admin/comments?status=pending',null,admin);
    const mine = (q.j?.data||[]).find(x=>x.content.includes(marker));
    ok('admin sees pending comment', !!mine, 'status='+q.status);
    if(mine){
      const appr = await jx('PUT',`/api/blog/admin/comments/${mine.id}/status`,{ status:'approved' },admin);
      ok('approve 200', appr.status===200 && appr.j?.success, 'status='+appr.status);
      const pub2 = await jx('GET',`/api/blog/posts/${post.slug}`);
      ok('approved comment visible public', (pub2.j?.data?.comments||[]).some(x=>x.content.includes(marker)));
      const rej = await jx('PUT',`/api/blog/admin/comments/${mine.id}/status`,{ status:'rejected' },admin);
      ok('reject 200', rej.status===200, 'status='+rej.status);
      const pub3 = await jx('GET',`/api/blog/posts/${post.slug}`);
      ok('rejected comment hidden public', !((pub3.j?.data?.comments||[]).some(x=>x.content.includes(marker))));
      const bad = await jx('PUT',`/api/blog/admin/comments/${mine.id}/status`,{ status:'bogus' },admin);
      ok('invalid status rejected 400', bad.status===400, 'status='+bad.status);
      // moderation requires admin (customer/anon cannot moderate)
      const anon = await jx('PUT',`/api/blog/admin/comments/${mine.id}/status`,{ status:'approved' });
      ok('non-admin cannot moderate (401/403)', anon.status===401 || anon.status===403, 'status='+anon.status);
      // comment submit validation (too short) -> 400
      const short = await jx('POST',`/api/blog/posts/${post.id}/comments`, { author_name:'x', content:'y' });
      ok('short comment rejected 400', short.status===400, 'status='+short.status);
      // cleanup
      const del = await jx('DELETE',`/api/blog/admin/comments/${mine.id}`,null,admin);
      ok('comment cleanup 200', del.status===200, 'status='+del.status);
    }
  }

  // ===== B) NEWSLETTER SUBSCRIBE / UNSUBSCRIBE =====
  const email = 'sf-nl-'+Date.now()+'@example.com';
  const s1 = await jx('POST','/api/newsletter/subscribe',{ email });
  ok('newsletter subscribe 200', s1.status===200 && s1.j?.success, 'status='+s1.status);
  const s2 = await jx('POST','/api/newsletter/subscribe',{ email });
  ok('duplicate subscribe idempotent', s2.status===200, 'status='+s2.status);
  const u1 = await jx('POST','/api/newsletter/unsubscribe',{ email });
  ok('unsubscribe 200', u1.status===200 && u1.j?.success, 'status='+u1.status);
  const nl = await jx('GET','/api/admin/newsletter',null,admin);
  const row = (nl.j?.data||[]).find(x=>x.email===email);
  ok('admin sees status=unsubscribed', row && row.status==='unsubscribed', 'status='+(row&&row.status));
  const s3 = await jx('POST','/api/newsletter/subscribe',{ email });
  ok('re-subscribe 200', s3.status===200, 'status='+s3.status);
  const nl2 = await jx('GET','/api/admin/newsletter',null,admin);
  const row2 = (nl2.j?.data||[]).find(x=>x.email===email);
  ok('re-subscribe restores status=active', row2 && row2.status==='active', 'status='+(row2&&row2.status));
  const u2 = await jx('POST','/api/newsletter/unsubscribe',{ email:'sf-unknown-'+Date.now()+'@x.ir' });
  ok('unsubscribe unknown email still 200', u2.status===200, 'status='+u2.status);
  const u3 = await jx('POST','/api/newsletter/unsubscribe',{ email:'not-an-email' });
  ok('unsubscribe invalid email 400', u3.status===400, 'status='+u3.status);
  const uNoAuth = await jx('POST','/api/newsletter/unsubscribe',{});
  ok('unsubscribe missing email 400', uNoAuth.status===400, 'status='+uNoAuth.status);
  // cleanup
  if(row2){ await jx('DELETE','/api/admin/newsletter/'+row2.id,null,admin); }

  // ===== C) PERSIAN SPECIAL-CHAR SEARCH (no 500) =====
  const terms = ['روتر','دی‌لینک','سوئیچ شبکه','می‌شود','%','_',"'",'"','؛؟،','<script>','   '];
  for(const t of terms){
    const r = await jx('GET','/api/products?q='+encodeURIComponent(t)+'&limit=5');
    ok('search "'+t+'" no 500', r.status!==500, 'status='+r.status);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail){ console.log('FAILURES:\n - '+fails.join('\n - ')); process.exit(1); }
}
main().catch(e=>{ console.error(e); process.exit(1); });
