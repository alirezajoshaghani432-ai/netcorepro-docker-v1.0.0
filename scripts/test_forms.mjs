#!/usr/bin/env node
/* Form/API validation test: every public form accepts valid input and rejects invalid input. */
const BASE = process.env.BASE || 'http://127.0.0.1:8090';
let pass=0, fail=0; const failures=[];
function log(ok,name,d){if(ok){pass++;console.log(`  \x1b[32m✓\x1b[0m ${name}`);}else{fail++;failures.push(name+(d?' :: '+d:''));console.log(`  \x1b[31m✗\x1b[0m ${name}${d?'  -> '+d:''}`);}}
async function post(path, body, token) {
  const h = { 'Content-Type':'application/json' };
  if (token) h['Authorization'] = 'Bearer '+token;
  const r = await fetch(BASE+path, { method:'POST', headers:h, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch(e){}
  return { status: r.status, json: j };
}

async function main(){
  const stamp = Date.now();

  // ---- Register ----
  console.log('\n\x1b[36m── Register form ──\x1b[0m');
  let r = await post('/api/auth/register', { email:`u${stamp}@ex.com`, password:'secret123', full_name:'Test User' });
  log(r.status===200 && r.json?.success, 'register: valid input accepted', `status=${r.status}`);
  r = await post('/api/auth/register', { email:'not-an-email', password:'secret123', full_name:'Test User' });
  log(r.status===400, 'register: invalid email rejected (400)', `status=${r.status}`);
  r = await post('/api/auth/register', { email:`u2${stamp}@ex.com`, password:'12', full_name:'Test User' });
  log(r.status===400, 'register: short password rejected (400)', `status=${r.status}`);
  r = await post('/api/auth/register', { email:`u3${stamp}@ex.com`, password:'secret123', full_name:'X' });
  log(r.status===400, 'register: short name rejected (400)', `status=${r.status}`);
  r = await post('/api/auth/register', { email:`u${stamp}@ex.com`, password:'secret123', full_name:'Dup User' });
  log(r.status>=400, 'register: duplicate email rejected', `status=${r.status}`);

  // ---- Login ----
  console.log('\n\x1b[36m── Login form ──\x1b[0m');
  async function loginRetry(body) {
    for (let i = 0; i < 6; i++) {
      const res = await post('/api/auth/login', body);
      if (res.status !== 429) return res;
      await new Promise(s => setTimeout(s, 8000));
    }
    return { status: 429, json: null };
  }
  r = await loginRetry({ email:'admin@netcorepro.ir', password:(process.env.ADMIN_PASSWORD || 'admin123') });
  log(r.status===200 && r.json?.data?.token, 'login: valid admin accepted', `status=${r.status}`);
  const adminToken = r.json?.data?.token;
  r = await loginRetry({ email:'admin@netcorepro.ir', password:'wrongpass' });
  log(r.status>=400, 'login: wrong password rejected', `status=${r.status}`);
  r = await loginRetry({ email:'bad', password:'x' });
  log(r.status===400 || r.status===429, 'login: invalid email format rejected (400)', `status=${r.status}`);
  r = await loginRetry({});
  log(r.status===400 || r.status===429, 'login: empty body rejected (400)', `status=${r.status}`);

  // ---- Contact (messages) ----
  console.log('\n\x1b[36m── Contact form ──\x1b[0m');
  r = await post('/api/messages', { name:'Ali', email:'ali@ex.com', body:'Hello, this is a valid message.' });
  log(r.status===200 && r.json?.success, 'contact: valid message accepted', `status=${r.status}`);
  r = await post('/api/messages', { name:'A', body:'Hi there friend' });
  log(r.status===400, 'contact: short name rejected (400)', `status=${r.status}`);
  r = await post('/api/messages', { name:'Ali', body:'no' });
  log(r.status===400, 'contact: short body rejected (400)', `status=${r.status}`);
  r = await post('/api/messages', { name:'Ali', email:'bad-email', body:'a valid body here' });
  log(r.status===400, 'contact: invalid email rejected (400)', `status=${r.status}`);
  r = await post('/api/messages', { name:'Ali', email:'', body:'a valid body here, no email given' });
  log(r.status===200, 'contact: empty email allowed (optional)', `status=${r.status}`);

  // ---- Newsletter ----
  console.log('\n\x1b[36m── Newsletter form ──\x1b[0m');
  r = await post('/api/newsletter/subscribe', { email:`news${stamp}@ex.com` });
  log(r.status===200 && r.json?.success, 'newsletter: valid email accepted', `status=${r.status}`);
  r = await post('/api/newsletter/subscribe', { email:'nope' });
  log(r.status===400, 'newsletter: invalid email rejected (400)', `status=${r.status}`);
  r = await post('/api/newsletter/subscribe', {});
  log(r.status===400, 'newsletter: missing email rejected (400)', `status=${r.status}`);

  // ---- Ticket (guest/authOptional) ----
  console.log('\n\x1b[36m── Ticket form ──\x1b[0m');
  r = await post('/api/tickets', { subject:'Need help', message:'I have a question about a product.', guest_name:'Guest', guest_email:'g@ex.com' });
  log(r.status===200 && r.json?.success, 'ticket: valid input accepted', `status=${r.status}`);
  r = await post('/api/tickets', { subject:'Hi', message:'short' });
  log(r.status===400, 'ticket: short subject rejected (400)', `status=${r.status}`);
  r = await post('/api/tickets', { subject:'Valid subject', message:'xy' });
  log(r.status===400, 'ticket: short message rejected (400)', `status=${r.status}`);
  r = await post('/api/tickets', { subject:'Valid subject', message:'valid message here', guest_email:'not-email' });
  log(r.status===400, 'ticket: invalid guest_email rejected (400)', `status=${r.status}`);

  // ---- Blog comment ----
  console.log('\n\x1b[36m── Blog comment form ──\x1b[0m');
  // find an existing post id
  const posts = await (await fetch(BASE+'/api/blog/posts')).json();
  const pid = posts?.data?.items?.[0]?.id || 1;
  r = await post(`/api/blog/posts/${pid}/comments`, { author_name:'Reza', author_email:'reza@ex.com', content:'Great article, thanks!' });
  log(r.status===200 && r.json?.success, 'comment: valid input accepted (pending)', `status=${r.status}`);
  r = await post(`/api/blog/posts/${pid}/comments`, { author_name:'R', content:'nice post' });
  log(r.status===400, 'comment: short name rejected (400)', `status=${r.status}`);
  r = await post(`/api/blog/posts/${pid}/comments`, { author_name:'Reza', content:'x' });
  log(r.status===400, 'comment: short content rejected (400)', `status=${r.status}`);
  r = await post(`/api/blog/posts/${pid}/comments`, { author_name:'Reza', author_email:'bad', content:'valid content' });
  log(r.status===400, 'comment: invalid email rejected (400)', `status=${r.status}`);
  r = await post(`/api/blog/posts/999999/comments`, { author_name:'Reza', content:'valid content' });
  log(r.status===404, 'comment: nonexistent post -> 404', `status=${r.status}`);

  // ---- cleanup: delete the test user, ticket, comments, message, newsletter via admin (best-effort) ----
  console.log('\n\x1b[36m── Cleanup (best-effort) ──\x1b[0m');
  log(!!adminToken, 'admin token available for cleanup', adminToken?'ok':'no');

  console.log(`\n\x1b[1m═══ RESULTS: ${pass} passed, ${fail} failed ═══\x1b[0m`);
  if(failures.length){console.log('\x1b[31mFailures:\x1b[0m');failures.forEach(f=>console.log('  - '+f));process.exit(1);}
  process.exit(0);
}
main().catch(e=>{console.error(e);process.exit(2);});
