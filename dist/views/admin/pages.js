import { adminLayout } from './layout.js';
import { CHANNEL_DEFS } from '../../utils/contact.js';

// Serialise a value into a <script> body safely (no </script> / HTML breakout).
function adminJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

// ===== Admin Login (no auth required, no sidebar) =====
export function adminLoginPage() {
    return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ورود به پنل مدیریت | رادیس</title>
<link rel="stylesheet" href="/static/css/vazirmatn.css">
<link rel="stylesheet" href="/static/css/fontawesome.min.css">
<link rel="stylesheet" href="/static/css/app.css">
<link rel="stylesheet" href="/static/css/tailwind.min.css">
<script src="/static/js/axios.min.js"></script>
<style>* { font-family: Vazirmatn, system-ui, sans-serif; }
.btn-indigo { background: linear-gradient(90deg, #4f46e5, #7c3aed); }
.btn-indigo:hover { box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4); }
.btn-indigo:disabled { opacity: 0.6; cursor: not-allowed; }
.spinner { border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; width: 1rem; height: 1rem; animation: spin 0.8s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
.toast { animation: slideIn 0.3s ease-out; } @keyframes slideIn { from { transform: translateX(-100%); } to { transform: translateX(0); } }
</style>
</head>
<body class="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-600">
<div class="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4">
  <div class="text-center mb-6">
    <div class="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center mb-3"><i class="fas fa-shield-halved text-white text-2xl"></i></div>
    <h1 class="text-2xl font-bold text-slate-800">پنل مدیریت رادیس</h1>
    <p class="text-sm text-slate-500 mt-1">برای ورود اطلاعات خود را وارد کنید</p>
  </div>
  <form id="admin-login-form" class="space-y-4">
    <div><label for="admin-login-email" class="block text-sm text-slate-700 mb-1">ایمیل</label><input id="admin-login-email" name="email" type="email" required autocomplete="username" class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"></div>
    <div><label for="admin-login-password" class="block text-sm text-slate-700 mb-1">رمز عبور</label><input id="admin-login-password" name="password" type="password" required autocomplete="current-password" class="w-full border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"></div>
    <button type="submit" class="btn-indigo text-white w-full py-2.5 rounded-lg font-medium">ورود به پنل</button>
  </form>
  <div class="mt-4 text-center"><a href="/" class="text-sm text-slate-500 hover:text-indigo-600"><i class="fas fa-arrow-right ml-1"></i>بازگشت به سایت</a></div>
</div>
<div id="toast-container" class="fixed top-6 left-6 z-50 space-y-2"></div>
<script>
function toast(msg, type='info') {
  const colors={success:'bg-green-500',error:'bg-red-500',info:'bg-indigo-500'};
  const c=document.getElementById('toast-container'); const el=document.createElement('div');
  el.className='toast ' + (colors[type] || colors.info) + ' text-white px-4 py-3 rounded-lg shadow-lg text-sm';
  el.textContent=msg; c.appendChild(el);
  setTimeout(()=>el.remove(),4000);
}
document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = Object.fromEntries(fd.entries());
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span> در حال ورود...';
  try {
    const r = await axios.post('/api/auth/login', data);
    if (r.data.success) {
      const { token, user } = r.data.data;
      if (user.role !== 'admin') { toast('این حساب دسترسی پنل ندارد', 'error'); btn.disabled = false; btn.innerHTML = orig; return; }
      localStorage.setItem('admin_token', token);
      sessionStorage.setItem('admin_info', JSON.stringify(user));
      toast('ورود موفقیت‌آمیز', 'success');
      setTimeout(() => location.href = '/admin', 500);
    }
  } catch (err) {
    toast(err.response?.data?.message || 'خطا', 'error');
    btn.disabled = false; btn.innerHTML = orig;
  }
});
</script>
</body></html>`;
}
// ===== Dashboard =====
export function dashboardPage() {
    const content = `
    <!-- گزارش هفتگی (نمودار دایره‌ای) -->
    <div class="grid lg:grid-cols-3 gap-6 mb-6">
      <div class="bg-white rounded-xl shadow-sm p-5">
        <h3 class="font-bold text-slate-800 mb-1"><i class="fas fa-chart-pie ml-1 text-blue-600"></i>گزارش هفتگی سفارش‌ها</h3>
        <p class="text-xs text-slate-400 mb-3">۷ روز گذشته به تفکیک وضعیت</p>
        <div class="relative" style="height:210px"><canvas id="week-donut"></canvas></div>
      </div>
      <div class="lg:col-span-2 grid sm:grid-cols-2 gap-4 content-start" id="week-cards"></div>
    </div>
    <div id="dash-stats" class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6"></div>
    <div id="sales-stats" class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6"></div>
    <div class="grid lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 bg-white rounded-xl shadow-sm p-5">
        <h3 class="font-bold text-slate-800 mb-4">آخرین سفارش‌ها</h3>
        <div id="recent-orders" class="overflow-x-auto"></div>
      </div>
      <div class="bg-white rounded-xl shadow-sm p-5">
        <h3 class="font-bold text-slate-800 mb-4">آخرین فعالیت‌ها</h3>
        <div id="recent-activity" class="space-y-3 text-sm"></div>
      </div>
    </div>
    <script>
      async function loadDash() {
        // Skip when unauthenticated: the admin guard will redirect to /admin/login,
        // so firing the dashboard request (and its error toast) only adds a confusing
        // red toast during the redirect.
        if (!(localStorage.getItem('admin_token') || localStorage.getItem('ncp_token'))) return;
        try {
          const r = await axios.get('/api/admin/dashboard');
          const d = r.data.data;
          document.getElementById('dash-stats').innerHTML = [
            { i:'fa-box', l:'محصولات فعال', v:d.products, c:'from-blue-500 to-indigo-600' },
            { i:'fa-users', l:'مشتریان', v:d.customers, c:'from-green-500 to-emerald-600' },
            { i:'fa-cart-shopping', l:'سفارش‌ها', v:d.orders_total, c:'from-sky-500 to-blue-600', sub: d.badges.orders_pending + ' در انتظار' },
            { i:'fa-coins', l:'درآمد کل (تومان)', v:formatPrice(d.orders_revenue), c:'from-amber-500 to-orange-600' }
          ].map(s => \`<div class="stat-card">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-xs text-slate-500">\${s.l}</div>
                <div class="text-2xl font-bold text-slate-800 mt-1">\${s.v}</div>
                \${s.sub ? '<div class="text-xs text-amber-600 mt-1">' + s.sub + '</div>' : ''}
              </div>
              <div class="w-12 h-12 rounded-xl bg-gradient-to-br \${s.c} flex items-center justify-center"><i class="fas \${s.i} text-white"></i></div>
            </div>
          </div>\`).join('');

          // آمار فروش / سود و زیان
          const sl = d.sales || {};
          document.getElementById('sales-stats').innerHTML = [
            { i:'fa-circle-check', l:'کالای فروخته‌شده', v:(sl.sold_qty||0) + ' عدد', sub:(sl.sold_products||0) + ' محصول مختلف', c:'from-emerald-500 to-green-600' },
            { i:'fa-box-open', l:'محصول بدون فروش', v:sl.unsold_products||0, sub:'نیاز به بازاریابی', c:'from-slate-400 to-slate-500' },
            { i:'fa-sack-dollar', l:'درآمد قطعی (تحویل‌شده)', v:formatPrice(sl.revenue_delivered||0), sub:formatPrice(sl.revenue_in_progress||0) + ' در جریان', c:'from-blue-500 to-cyan-600' },
            { i:'fa-arrow-trend-down', l:'زیان (سفارش‌های لغوشده)', v:formatPrice(sl.lost_cancelled||0), sub:'تومان', c:'from-rose-500 to-red-600' }
          ].map(s => \`<div class="stat-card">
            <div class="flex items-center justify-between">
              <div>
                <div class="text-xs text-slate-500">\${s.l}</div>
                <div class="text-xl font-bold text-slate-800 mt-1">\${s.v}</div>
                \${s.sub ? '<div class="text-xs text-slate-400 mt-1">' + s.sub + '</div>' : ''}
              </div>
              <div class="w-12 h-12 rounded-xl bg-gradient-to-br \${s.c} flex items-center justify-center"><i class="fas \${s.i} text-white"></i></div>
            </div>
          </div>\`).join('');

          // کارت‌های هفتگی + نمودار دایره‌ای
          const wk = d.week || {};
          document.getElementById('week-cards').innerHTML = [
            { i:'fa-cart-plus', l:'سفارش این هفته', v:wk.orders||0, c:'text-blue-600 bg-blue-50' },
            { i:'fa-arrow-trend-up', l:'درآمد هفته (تومان)', v:formatPrice(wk.income||0), c:'text-emerald-600 bg-emerald-50' },
            { i:'fa-arrow-trend-down', l:'زیان هفته (لغوشده)', v:formatPrice(wk.loss||0), c:'text-rose-600 bg-rose-50' },
            { i:'fa-scale-balanced', l:'تراز هفته (تومان)', v:formatPrice((wk.income||0) - (wk.loss||0)), c:'text-indigo-600 bg-indigo-50' }
          ].map(s => \`<div class="bg-white rounded-xl shadow-sm p-5 flex items-center gap-4">
            <div class="w-12 h-12 rounded-xl \${s.c} flex items-center justify-center text-lg"><i class="fas \${s.i}"></i></div>
            <div><div class="text-xs text-slate-500">\${s.l}</div><div class="text-xl font-bold text-slate-800 mt-0.5">\${s.v}</div></div>
          </div>\`).join('');

          const stLabels = { pending:'در انتظار', confirmed:'تایید شده', shipping:'در حال ارسال', delivered:'تحویل شده', cancelled:'لغو شده' };
          const stColors = { pending:'#f59e0b', confirmed:'#3b82f6', shipping:'#8b5cf6', delivered:'#10b981', cancelled:'#ef4444' };
          const rows = (wk.by_status || []);
          (window.chartReady || function(cb){cb();})(function () {
            const ctx = document.getElementById('week-donut');
            if (!ctx || typeof Chart === 'undefined') return;
            if (!rows.length) {
              ctx.parentElement.innerHTML = '<div class="flex items-center justify-center h-full text-slate-400 text-sm"><i class="fas fa-chart-pie ml-2"></i>سفارشی در ۷ روز گذشته ثبت نشده</div>';
              return;
            }
            new Chart(ctx, {
              type: 'doughnut',
              data: {
                labels: rows.map(r => stLabels[r.status] || r.status),
                datasets: [{ data: rows.map(r => r.cnt), backgroundColor: rows.map(r => stColors[r.status] || '#94a3b8'), borderWidth: 2 }]
              },
              options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }
            });
          });

          document.getElementById('recent-orders').innerHTML = d.recent_orders.length ? \`<table class="w-full text-sm">
            <thead><tr class="text-slate-500 text-xs"><th class="text-right pb-2">شماره</th><th class="text-right pb-2">مشتری</th><th class="text-right pb-2">مبلغ</th><th class="text-right pb-2">وضعیت</th></tr></thead>
            <tbody>\${d.recent_orders.map(o => \`<tr class="border-t"><td class="py-2 font-mono text-indigo-600 text-xs">\${escAdmin(o.order_number)}</td><td class="py-2">\${escAdmin(o.customer_name)}</td><td class="py-2">\${formatPrice(o.total)}</td><td class="py-2"><span class="badge badge-\${o.status}">\${statusLabel(o.status)}</span></td></tr>\`).join('')}</tbody>
          </table>\` : '<p class="text-center text-slate-400 py-6">سفارشی نیست</p>';

          document.getElementById('recent-activity').innerHTML = d.recent_activity.length ? d.recent_activity.map(a => \`
            <div class="flex items-start gap-2 pb-2 border-b last:border-0">
              <div class="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs"><i class="fas fa-clock-rotate-left"></i></div>
              <div class="flex-1">
                <div class="text-slate-700"><b>\${escAdmin(a.user_name || 'سیستم')}</b> - \${escAdmin(a.action)} \${a.entity_type ? '(' + a.entity_type + ')' : ''}</div>
                <div class="text-xs text-slate-400">\${formatDate(a.created_at)}</div>
              </div>
            </div>\`).join('') : '<p class="text-center text-slate-400 py-6">فعالیتی ثبت نشده</p>';
        } catch (e) { toast('خطا در بارگذاری داشبورد', 'error'); }
      }
      loadDash();
    </script>
  `;
    return adminLayout({ title: 'داشبورد', currentPath: '/admin' }, content);
}
// ===== Products list =====
export function adminProductsPage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5">
      <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 class="font-bold text-slate-800">لیست محصولات</h2>
        <div class="flex items-center gap-2 flex-1 justify-end flex-wrap">
          <select id="prod-status" onchange="filterProducts()" class="border border-slate-300 rounded-lg px-3 py-2 text-sm" title="فیلتر وضعیت">
            <option value="">همه محصولات</option>
            <option value="active">فقط فعال‌ها</option>
            <option value="inactive">فقط غیرفعال‌ها</option>
            <option value="price_issue">قیمت نامعتبر (۰ یا کمتر از ۱۰۰۰ تومان)</option>
            <option value="low_stock">موجودی کم (کمتر از ۵)</option>
          </select>
          <select id="prod-cat" onchange="filterProducts()" class="border border-slate-300 rounded-lg px-3 py-2 text-sm max-w-[14rem]" title="فیلتر دسته‌بندی (شامل زیرشاخه‌ها)">
            <option value="">همه دسته‌ها</option>
          </select>
          <div class="relative w-full max-w-xs">
            <i class="fas fa-search absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
            <input id="prod-search" type="text" placeholder="جستجو: نام، کد محصول (SKU)، نامک..." class="w-full border border-slate-300 rounded-lg pr-8 pl-3 py-2 text-sm" oninput="filterProducts()">
          </div>
          <div class="relative" id="pio-export-wrap">
            <button type="button" onclick="document.getElementById('pio-export-menu').classList.toggle('hidden')" class="border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-lg text-sm whitespace-nowrap" title="گرفتن خروجی از همهٔ محصولات"><i class="fas fa-file-export ml-1 text-emerald-600"></i>خروجی (Export) <i class="fas fa-chevron-down text-[10px] mr-1"></i></button>
            <div id="pio-export-menu" class="hidden absolute left-0 mt-1 w-60 bg-white border rounded-xl shadow-lg z-30 py-1 text-sm">
              <button type="button" onclick="ncpExportProducts('xlsx');this.parentNode.classList.add('hidden')" class="w-full text-right px-4 py-2 hover:bg-slate-50"><i class="fas fa-file-excel ml-2 text-emerald-600"></i>فایل اکسل (xlsx)</button>
              <button type="button" onclick="ncpExportProducts('csv');this.parentNode.classList.add('hidden')" class="w-full text-right px-4 py-2 hover:bg-slate-50"><i class="fas fa-file-csv ml-2 text-sky-600"></i>فایل CSV</button>
              <button type="button" onclick="ncpExportProducts('json');this.parentNode.classList.add('hidden')" class="w-full text-right px-4 py-2 hover:bg-slate-50"><i class="fas fa-file-code ml-2 text-violet-600"></i>پشتیبان کامل (JSON)<span class="block text-[10px] text-slate-400 mr-6">برای انتقال به سایت دیگر</span></button>
            </div>
          </div>
          <button type="button" onclick="ncpOpenImport()" class="border border-slate-300 hover:bg-slate-50 text-slate-700 px-3 py-2 rounded-lg text-sm whitespace-nowrap" title="ورود گروهی محصولات از فایل اکسل / CSV / خروجی سایت دیگر"><i class="fas fa-file-import ml-1 text-indigo-600"></i>ورود (Import)</button>
          <button onclick="newProduct()" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap"><i class="fas fa-plus ml-1"></i>محصول جدید</button>
        </div>
      </div>
      <div id="pbulk-bar" class="hidden mb-3 flex items-center justify-between gap-2 flex-wrap rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2 text-sm">
        <span><i class="fas fa-check-square text-indigo-600 ml-1"></i><b id="pbulk-count">0</b> محصول انتخاب شده</span>
        <div class="flex gap-2 flex-wrap">
          <button type="button" onclick="bulkProductStatus('active')" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs"><i class="fas fa-toggle-on ml-1"></i>فعال کردن انتخاب‌شده‌ها</button>
          <button type="button" onclick="bulkProductStatus('inactive')" class="bg-slate-600 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg text-xs" title="محصولات حذف نمی‌شوند؛ فقط از سایت پنهان می‌شوند"><i class="fas fa-toggle-off ml-1"></i>غیرفعال کردن انتخاب‌شده‌ها</button>
          <button type="button" onclick="clearProdSel()" class="border border-slate-300 bg-white px-3 py-1.5 rounded-lg text-xs">لغو انتخاب</button>
        </div>
      </div>
      <div id="products-table" class="overflow-x-auto"><div class="text-center py-12"><span class="spinner"></span></div></div>
    </div>
    <script>
      let CATEGORIES = [], BRANDS = [];
      async function loadProducts() {
        const tbl = document.getElementById('products-table');
        try {
          const [pr, cr, br] = await Promise.all([
            // admin endpoint: ALL products (active + inactive), no 100-row cap
            axios.get('/api/products/admin/list'),
            axios.get('/api/admin/categories'),
            axios.get('/api/admin/brands')
          ]);
          CATEGORIES = cr.data.data; BRANDS = br.data.data;
          ALL_PRODUCTS = pr.data.data.items;
          const cn = pr.data.data.counts || {};
          const st = document.getElementById('prod-status');
          if (st) {
            st.options[0].textContent = 'همه محصولات (' + formatPrice((cn.active || 0) + (cn.inactive || 0)) + ')';
            st.options[1].textContent = 'فقط فعال‌ها (' + formatPrice(cn.active || 0) + ')';
            st.options[2].textContent = 'فقط غیرفعال‌ها (' + formatPrice(cn.inactive || 0) + ')';
            const pi = ALL_PRODUCTS.filter(priceIssue).length;
            st.options[3].textContent = 'قیمت نامعتبر: ۰ یا کمتر از ۱۰۰۰ تومان (' + formatPrice(pi) + ')';
            st.options[3].hidden = pi === 0;
            const ls = ALL_PRODUCTS.filter(lowStock).length;
            st.options[4].textContent = 'موجودی کم: کمتر از ۵ عدد (' + formatPrice(ls) + ')';
            st.options[4].hidden = ls === 0;
          }
          fillProdCatFilter();
          filterProducts();
        } catch (e) { tbl.innerHTML = '<p class="text-red-500 p-4">خطا در بارگذاری</p>'; }
      }
      let ALL_PRODUCTS = [];
      // R3-C: category filter (a parent category also shows its sub-categories' products)
      function catDescIds(id) {
        const out = new Set([id]); let grew = true;
        while (grew) { grew = false; CATEGORIES.forEach(c => { if (c.parent_id && out.has(c.parent_id) && !out.has(c.id)) { out.add(c.id); grew = true; } }); }
        return out;
      }
      function fillProdCatFilter() {
        const el = document.getElementById('prod-cat');
        if (!el) return;
        const cur = el.value;
        const direct = {}; ALL_PRODUCTS.forEach(p => { direct[p.category_id || 0] = (direct[p.category_id || 0] || 0) + 1; });
        const total = id => { let n = 0; catDescIds(id).forEach(x => { n += direct[x] || 0; }); return n; };
        const byParent = {}; CATEGORIES.forEach(c => { const k = c.parent_id || 0; (byParent[k] = byParent[k] || []).push(c); });
        const out = ['<option value="">همه دسته‌ها</option>'];
        (function walk(pid, depth) {
          (byParent[pid] || []).forEach(c => {
            const pad = depth ? '\\u00a0'.repeat(depth * 3) + '└ ' : '';
            out.push('<option value="' + c.id + '">' + pad + escAdmin(c.name) + ' (' + formatPrice(total(c.id)) + ')' + (c.is_active == 0 ? ' — غیرفعال' : '') + '</option>');
            walk(c.id, depth + 1);
          });
        })(0, 0);
        const orphan = ALL_PRODUCTS.filter(p => !p.category_id || !CATEGORIES.some(c => c.id === p.category_id)).length;
        if (orphan) out.push('<option value="none">بدون دسته (' + formatPrice(orphan) + ')</option>');
        el.innerHTML = out.join('');
        if (cur && [...el.options].some(o => o.value === cur)) el.value = cur;
      }
      // R2-B: bulk select -> activate / deactivate (never deletes)
      const PSEL = new Set();
      let SHOWN_PRODUCTS = [];
      function updateProdBar() {
        const bar = document.getElementById('pbulk-bar');
        if (!bar) return;
        bar.classList.toggle('hidden', PSEL.size === 0);
        document.getElementById('pbulk-count').textContent = formatPrice(PSEL.size);
        const all = document.getElementById('psel-all');
        if (all) { const n = SHOWN_PRODUCTS.filter(p => PSEL.has(p.id)).length; all.checked = n > 0 && n === SHOWN_PRODUCTS.length; all.indeterminate = n > 0 && n < SHOWN_PRODUCTS.length; }
      }
      window.toggleProdSel = (id, on) => { on ? PSEL.add(id) : PSEL.delete(id); updateProdBar(); };
      window.toggleProdSelAll = (on) => {
        SHOWN_PRODUCTS.forEach(p => on ? PSEL.add(p.id) : PSEL.delete(p.id));
        document.querySelectorAll('#products-table .psel').forEach(cb => { cb.checked = on; });
        updateProdBar();
      };
      window.clearProdSel = () => { PSEL.clear(); document.querySelectorAll('#products-table .psel').forEach(cb => { cb.checked = false; }); updateProdBar(); };
      window.bulkProductStatus = async (st) => {
        const ids = [...PSEL];
        if (!ids.length) return;
        if (ids.length > 2000) { toast('حداکثر ۲۰۰۰ محصول در هر بار قابل تغییر است', 'error'); return; }
        const btns = document.querySelectorAll('#pbulk-bar button');
        btns.forEach(b => { b.disabled = true; });
        try {
          const r = await axios.post('/api/products/admin/bulk-status', { ids, status: st });
          toast(r.data.message || 'انجام شد', 'success');
          PSEL.clear();
          await loadProducts();
        } catch (e) { toast(e.response?.data?.message || 'خطا در تغییر وضعیت گروهی', 'error'); }
        finally { btns.forEach(b => { b.disabled = false; }); updateProdBar(); }
      };
      // F5: normalize Persian/Arabic chars + digits so SKU/name search matches loosely
      function normFa(x) {
        return String(x || '').toLowerCase()
          .replace(/[يیئى]/g, 'ی').replace(/[كک]/g, 'ک').replace(/[آأإ]/g, 'ا').replace(/\\u200c/g, '')
          .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
          .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
          .replace(/[\\s\\-_]+/g, '');
      }
      // I3 (2026-11-03): price 0 = «استعلام قیمت» on the site; 1..999 toman is almost
      // always a typo (e.g. «5» instead of «5,000,000») -> flag both for the owner.
      function effPrice(p) { return Number(p.discount_price || p.price) || 0; }
      function priceIssue(p) { return effPrice(p) < 1000; }
      function lowStock(p) { return (Number(p.stock) || 0) < 5; }
      function priceCell(p) {
        const v = effPrice(p);
        if (v <= 0) return '<span class="badge badge-inactive" title="در سایت «استعلام قیمت» نمایش داده می‌شود و قابل سفارش نیست">بدون قیمت</span>';
        if (v < 1000) return formatPrice(v) + ' <i class="fas fa-triangle-exclamation text-amber-500 mr-1" title="قیمت کمتر از ۱۰۰۰ تومان است — احتمالاً اشتباه تایپی؛ لطفاً بررسی کنید"></i>';
        return formatPrice(v);
      }
      function filterProducts() {
        const q = normFa(document.getElementById('prod-search').value);
        const stEl = document.getElementById('prod-status');
        const st = stEl ? stEl.value : '';
        let list = st === 'price_issue' ? ALL_PRODUCTS.filter(priceIssue) : st === 'low_stock' ? ALL_PRODUCTS.filter(lowStock) : (st ? ALL_PRODUCTS.filter(p => p.status === st) : ALL_PRODUCTS);
        const catEl = document.getElementById('prod-cat');
        const cv = catEl ? catEl.value : '';
        if (cv === 'none') list = list.filter(p => !p.category_id || !CATEGORIES.some(c => c.id === p.category_id));
        else if (cv) { const ids = catDescIds(parseInt(cv)); list = list.filter(p => ids.has(p.category_id)); }
        if (q) list = list.filter(p =>
          normFa(p.sku).includes(q) || normFa(p.name).includes(q) || normFa(p.slug).includes(q));
        renderProducts(list, q);
      }
      // One-click activate / deactivate — nothing is deleted, the product only
      // disappears from (or comes back to) the public site.
      window.toggleProductStatus = async (id, next) => {
        try {
          const r = await axios.patch('/api/products/' + id + '/status', { status: next });
          const p = ALL_PRODUCTS.find(x => x.id === id);
          if (p) p.status = next;
          toast(r.data.message, 'success');
          loadProducts();
        } catch (e) { toast(e.response?.data?.message || 'خطا در تغییر وضعیت', 'error'); }
      };
      function renderProducts(items, q) {
        const tbl = document.getElementById('products-table');
        SHOWN_PRODUCTS = items;
        // drop selections that no longer exist (e.g. deleted product)
        const __ids = new Set(ALL_PRODUCTS.map(p => p.id));
        [...PSEL].forEach(id => { if (!__ids.has(id)) PSEL.delete(id); });
        updateProdBar();
        if (!items.length) { tbl.innerHTML = '<p class="text-center text-slate-400 py-10 text-sm"><i class="fas fa-magnifying-glass ml-1"></i>محصولی با این مشخصات پیدا نشد' + (q ? ' — کد/نام واردشده را بررسی کنید' : '') + '</p>'; return; }
        try {
          tbl.innerHTML = \`<table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-600 text-xs">
              <tr><th class="px-3 py-3 text-right w-8"><input type="checkbox" id="psel-all" onchange="toggleProdSelAll(this.checked)" class="w-4 h-4 cursor-pointer" title="انتخاب همهٔ محصولات نمایش‌داده‌شده"></th><th class="px-3 py-3 text-right">تصویر</th><th class="px-3 py-3 text-right">نام</th><th class="px-3 py-3 text-right">دسته</th><th class="px-3 py-3 text-right">قیمت</th><th class="px-3 py-3 text-right">موجودی</th><th class="px-3 py-3 text-right">وضعیت</th><th class="px-3 py-3 text-right">عملیات</th></tr>
            </thead>
            <tbody>\${items.map(p => \`<tr class="table-row border-t\${p.status === 'active' ? '' : ' bg-slate-50 opacity-70'}">
              <td class="px-3 py-2"><input type="checkbox" class="psel w-4 h-4 cursor-pointer" onchange="toggleProdSel(\${p.id}, this.checked)"\${PSEL.has(p.id) ? ' checked' : ''}></td>
              <td class="px-3 py-2"><img loading="lazy" decoding="async" src="\${escAdmin(p.image || '/static/images/p1.svg')}" onerror="this.onerror=null;this.src='/static/images/p1.svg'" alt="\${escAdmin(p.name || 'تصویر محصول')}" class="w-12 h-12 rounded object-cover\${p.status === 'active' ? '' : ' grayscale'}"></td>
              <td class="px-3 py-2"><div class="font-medium">\${escAdmin(p.name)}</div><div class="text-xs text-slate-400">\${escAdmin(p.sku || '-')}</div></td>
              <td class="px-3 py-2">\${escAdmin(p.category_name || '-')}\${p.category_active == 0 ? '<div class="text-[10px] text-amber-600 mt-0.5" title="این دسته غیرفعال است؛ محصولاتش در سایت نمایش داده نمی‌شوند"><i class="fas fa-eye-slash ml-1"></i>دسته غیرفعال است</div>' : ''}</td>
              <td class="px-3 py-2 whitespace-nowrap">\${priceCell(p)}</td>
              <td class="px-3 py-2"><span class="\${p.stock < 5 ? 'text-red-600' : 'text-slate-700'}">\${p.stock}</span></td>
              <td class="px-3 py-2 whitespace-nowrap">\${p.status === 'active'
                ? '<button type="button" onclick="toggleProductStatus(' + p.id + ', &#39;inactive&#39;)" class="badge badge-active cursor-pointer hover:ring-2 hover:ring-emerald-300" title="کلیک کنید تا غیرفعال شود (حذف نمی‌شود)"><i class="fas fa-toggle-on ml-1"></i>فعال</button>'
                : '<button type="button" onclick="toggleProductStatus(' + p.id + ', &#39;active&#39;)" class="badge badge-blocked cursor-pointer hover:ring-2 hover:ring-rose-300" title="کلیک کنید تا دوباره فعال شود"><i class="fas fa-toggle-off ml-1"></i>غیرفعال</button>'}</td>
              <td class="px-3 py-2 whitespace-nowrap">\${p.status === 'active' ? '<a href="/product/' + escAdmin(p.slug) + '" target="_blank" title="مشاهده در سایت" class="text-slate-400 hover:text-emerald-600 ml-2"><i class="fas fa-eye"></i></a>' : '<span class="text-slate-300 ml-2" title="محصول غیرفعال در سایت نمایش داده نمی‌شود"><i class="fas fa-eye-slash"></i></span>'}<button onclick='editProduct(\${p.id})' class="text-indigo-600 hover:text-indigo-700 ml-2" title="ویرایش"><i class="fas fa-pen"></i></button><button type="button" onclick="duplicateProduct(\${p.id})" class="text-slate-500 hover:text-indigo-600 ml-2" title="کپی محصول (نسخهٔ غیرفعال برای ساخت سریع محصول مشابه)"><i class="fas fa-copy"></i></button><button onclick="deleteProduct(\${p.id})" class="text-red-600 hover:text-red-700" title="حذف"><i class="fas fa-trash"></i></button></td>
            </tr>\`).join('')}</tbody></table>\`;
          updateProdBar();
        } catch (e) { tbl.innerHTML = '<p class="text-red-500 p-4">خطا در نمایش لیست</p>'; }
      }
      function catOptions(cats, selectedId) {
        // hierarchical select options with ─ indentation
        const byParent = {};
        cats.forEach(c => { const k = c.parent_id || 0; (byParent[k] = byParent[k] || []).push(c); });
        const out = [];
        (function walk(pid, depth) {
          (byParent[pid] || []).forEach(c => {
            const pad = depth ? '&nbsp;'.repeat(depth * 3) + '└ ' : '';
            out.push('<option value="' + c.id + '" ' + (selectedId === c.id ? 'selected' : '') + '>' + pad + escAdmin(c.name) + (c.is_active == 0 ? ' (غیرفعال)' : '') + '</option>');
            walk(c.id, depth + 1);
          });
        })(0, 0);
        return out.join('');
      }
      function parseJsonSafe(s, fb) { try { const v = JSON.parse(s); return v ?? fb; } catch { return fb; } }
      function productForm(p = {}) {
        return \`<form id="product-form" class="space-y-3">
          <div class="grid md:grid-cols-2 gap-3">
            <div><label class="block text-sm mb-1 font-medium">نام محصول *</label><input name="name" id="pf-name" required value="\${escAdmin(p.name || '')}" placeholder="مثال: سوئیچ 24 پورت TP-Link" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1 font-medium">نامک (Slug) * <span class="text-[11px] text-slate-400 font-normal">— خودکار از روی نام ساخته می‌شود</span></label><input name="slug" id="pf-slug" required value="\${escAdmin(p.slug || '')}" dir="ltr" class="w-full border rounded-lg px-3 py-2 text-sm text-left"></div>
          </div>
          <div class="grid md:grid-cols-3 gap-3">
            <div><label class="block text-sm mb-1">SKU</label><input name="sku" value="\${escAdmin(p.sku || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1">دسته *</label><select name="category_id" required class="w-full border rounded-lg px-3 py-2 text-sm">\${catOptions(CATEGORIES, p.category_id)}</select></div>
            <div><label class="block text-sm mb-1">برند</label><select name="brand_id" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="">-</option>\${BRANDS.map(b => '<option value="' + b.id + '" ' + (p.brand_id === b.id ? 'selected' : '') + '>' + escAdmin(b.name) + '</option>').join('')}</select></div>
          </div>
          <div class="grid md:grid-cols-3 gap-3">
            <div><label class="block text-sm mb-1">قیمت (تومان) *</label><input name="price" id="pf-price" type="number" required value="\${p.price || 0}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1">قیمت تخفیف</label><input name="discount_price" id="pf-dprice" type="number" value="\${p.discount_price || ''}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1">موجودی *</label><input name="stock" type="number" required value="\${p.stock || 0}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          </div>
          <div class="border border-amber-200 rounded-xl p-3 bg-amber-50/60">
            <label class="block text-sm font-bold mb-2 text-amber-800"><i class="fas fa-percent ml-1"></i>محاسبه خودکار تخفیف <span class="text-[11px] font-normal text-amber-600">— مقدار را وارد کنید تا «قیمت تخفیف» خودش پر شود</span></label>
            <div class="flex items-center gap-2 flex-wrap">
              <select id="pf-disc-mode" class="border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="percent">درصدی (٪)</option>
                <option value="amount">مبلغی (تومان)</option>
              </select>
              <input id="pf-disc-val" type="number" min="0" placeholder="مثلاً 5" class="border rounded-lg px-3 py-2 text-sm w-32">
              <button type="button" onclick="applyDiscountCalc()" class="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-bold"><i class="fas fa-calculator ml-1"></i>اعمال</button>
              <span id="pf-disc-hint" class="text-xs text-amber-700"></span>
            </div>
          </div>
          <div class="grid md:grid-cols-2 gap-3">
            <div><label class="block text-sm mb-1"><i class="fas fa-shield-halved ml-1 text-emerald-600"></i>نوع گارانتی <span class="text-[11px] text-slate-400">— در صفحه محصول نمایش داده می‌شود</span></label><input name="guarantee" value="\${escAdmin(p.guarantee || '')}" placeholder="مثال: گارانتی ۱۸ ماهه آماد سیستم" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1"><i class="fas fa-percent ml-1 text-amber-600"></i>درصد مالیات این محصول <span class="text-[11px] text-slate-400">— خالی بگذارید تا درصد سراسری تنظیمات اعمال شود</span></label><input name="tax_percent" type="number" step="0.1" min="0" max="25" value="\${p.tax_percent ?? ''}" placeholder="مثلاً 9 — خالی = درصد سراسری" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          </div>
          \${window.ncpImageField('image', p.image || '', 'تصویر اصلی محصول')}
          <div class="border border-sky-200 rounded-xl p-3 bg-sky-50/70 text-[12px] leading-6 text-sky-900">
            <b><i class="fas fa-circle-question ml-1"></i>عکس محصول را از کجا بیاورم؟</b>
            <ul class="list-disc pr-5 mt-1 space-y-0.5">
              <li>نام دقیق و مدل محصول را در گوگل جستجو کنید و از بخش «تصاویر» عکس باکیفیت (ترجیحاً با پس‌زمینه سفید) دانلود کنید.</li>
              <li>یا از سایت رسمی برند (tp-link.com، dlink.com و...) صفحه محصول را باز کرده و عکس را ذخیره کنید.</li>
              <li>سپس با دکمه «آپلود تصویر» بالا، فایل را از کامپیوتر خود بارگذاری کنید.</li>
            </ul>
            <button type="button" class="mt-2 px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs" onclick="var n=document.querySelector('#product-form [name=name]');var q=(n&&n.value)||'';if(!q){toast('اول نام محصول را وارد کنید','error');return;}window.open('https://www.google.com/search?tbm=isch&q='+encodeURIComponent(q),'_blank')"><i class="fab fa-google ml-1"></i>جستجوی عکس این محصول در گوگل</button>
          </div>
          <div class="border rounded-xl p-3 bg-slate-50/60">
            <label class="block text-sm font-bold mb-1"><i class="fas fa-images ml-1 text-slate-400"></i>گالری تصاویر</label>
            <p class="text-[11px] text-slate-400 mb-2">برای هر تصویر یک ردیف — مانند تصویر اصلی، آپلود کنید یا آدرس بدهید</p>
            <div id="gallery-rows" class="space-y-2"></div>
            <button type="button" onclick="addGalleryRow()" class="mt-2 text-xs px-3 py-2 bg-white border rounded-lg hover:bg-slate-100"><i class="fas fa-plus ml-1"></i>افزودن تصویر گالری</button>
          </div>
          <div class="border rounded-xl p-3 bg-emerald-50/50">
            <label class="block text-sm font-bold mb-1 text-emerald-800"><i class="fas fa-star ml-1"></i>ویژگی‌های کلیدی</label>
            <p class="text-[11px] text-slate-400 mb-2">نکات مهم محصول — به‌صورت لیست تیک‌دار زیر عنوان در صفحه محصول نمایش داده می‌شود</p>
            <div id="feat-rows" class="space-y-2"></div>
            <button type="button" onclick="addFeatRow()" class="mt-2 text-xs px-3 py-2 bg-white border rounded-lg hover:bg-slate-100"><i class="fas fa-plus ml-1"></i>افزودن ویژگی</button>
          </div>
          <div class="border rounded-xl p-3 bg-slate-50/60">
            <label class="block text-sm font-bold mb-1"><i class="fas fa-list-ul ml-1 text-slate-400"></i>مشخصات فنی</label>
            <p class="text-[11px] text-slate-400 mb-2">گروه (مثل «ارتباطات») اختیاری است — مشخصات هم‌گروه در جدول محصول زیر یک سرتیتر نمایش داده می‌شوند</p>
            <div id="specs-rows" class="space-y-2"></div>
            <button type="button" onclick="addSpecRow()" class="mt-2 text-xs px-3 py-2 bg-white border rounded-lg hover:bg-slate-100"><i class="fas fa-plus ml-1"></i>افزودن مشخصه</button>
          </div>
          <div><label class="block text-sm mb-1 font-medium">توضیح کوتاه</label><input name="short_description" value="\${escAdmin(p.short_description || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-sm mb-1 font-medium">توضیحات</label><textarea name="description" rows="4" class="w-full border rounded-lg px-3 py-2 text-sm">\${escAdmin(p.description || '')}</textarea></div>
          <div class="border rounded-xl p-3 bg-blue-50/50">
            <label class="block text-sm font-bold mb-2 text-blue-800"><i class="fas fa-magnifying-glass ml-1"></i>تنظیمات سئو (SEO)</label>
            <div class="space-y-2">
              <div><label class="block text-xs mb-1 text-slate-500">عنوان سئو (Meta Title)</label><input name="seo_title" value="\${escAdmin(p.seo_title || '')}" placeholder="اگر خالی باشد از نام محصول استفاده می‌شود" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
              <div><label class="block text-xs mb-1 text-slate-500">توضیحات سئو (Meta Description)</label><textarea name="seo_description" rows="2" placeholder="حداکثر ۱۶۰ کاراکتر" class="w-full border rounded-lg px-3 py-2 text-sm">\${escAdmin(p.seo_description || '')}</textarea></div>
              <div><label class="block text-xs mb-1 text-slate-500">کلمات کلیدی (با کاما جدا کنید)</label><input name="seo_keywords" value="\${escAdmin(p.seo_keywords || '')}" placeholder="مثال: رک ایستاده, رک 21 یونیت, تجهیزات شبکه" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            </div>
          </div>
          <div class="flex gap-3">
            <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="featured" value="1" \${p.featured ? 'checked' : ''}> نمایش ویژه</label>
            <select name="status" class="border rounded-lg px-3 py-1 text-sm"><option value="active" \${p.status === 'active' ? 'selected' : ''}>فعال</option><option value="inactive" \${p.status === 'inactive' ? 'selected' : ''}>غیرفعال</option></select>
          </div>
          <div class="flex justify-start gap-2 pt-3 border-t">
            <button type="submit" class="btn-indigo text-white px-5 py-2 rounded-lg text-sm">ذخیره</button>
            <button type="button" onclick="closeModal(true)" class="px-5 py-2 bg-slate-200 rounded-lg text-sm">انصراف</button>
          </div>
        </form>\`;
      }
      // --- gallery editor: one upload-row per image (same UX as the main image field) ---
      window.addGalleryRow = (url = '') => {
        const box = document.getElementById('gallery-rows');
        if (!box) return;
        const row = document.createElement('div');
        row.className = 'gallery-row flex items-center gap-3 bg-white border rounded-lg p-2';
        row.innerHTML = \`
          <img src="\${escAdmin(url || '/static/images/p1.svg')}" alt="" class="g-prev w-14 h-14 rounded-lg object-cover border bg-slate-50 flex-shrink-0" onerror="this.src='/static/images/p1.svg'">
          <input class="g-url flex-1 border rounded-lg px-3 py-2 text-xs" dir="ltr" placeholder="/static/uploads/... یا آپلود کنید" value="\${escAdmin(url)}">
          <button type="button" class="g-upl btn-indigo text-white px-3 py-1.5 rounded-lg text-xs whitespace-nowrap"><i class="fas fa-upload ml-1"></i>آپلود</button>
          <input type="file" class="g-file hidden" accept="image/jpeg,image/png,image/webp,image/gif">
          <button type="button" class="g-del text-red-500 hover:text-red-600 px-2" title="حذف"><i class="fas fa-trash"></i></button>\`;
        const prev = row.querySelector('.g-prev'), urlInp = row.querySelector('.g-url'), file = row.querySelector('.g-file');
        urlInp.addEventListener('input', () => { prev.src = urlInp.value || '/static/images/p1.svg'; });
        row.querySelector('.g-upl').addEventListener('click', () => file.click());
        file.addEventListener('change', async () => {
          const f = file.files && file.files[0];
          if (!f) return;
          if (f.size > 15 * 1024 * 1024) { toast('حجم تصویر بیش از ۱۵MB است', 'error'); file.value = ''; return; }
          try {
            const uploadedUrl = await window.uploadImage(f);
            urlInp.value = uploadedUrl; prev.src = uploadedUrl;
            toast('تصویر گالری آپلود شد — دکمه ذخیره را بزنید', 'success'); window.ncMarkDirty && window.ncMarkDirty();
          } catch (e) { toast(window.ncpFormatUploadError ? window.ncpFormatUploadError(e) : (e.response?.data?.message || 'خطا در آپلود'), 'error'); }
          file.value = '';
        });
        row.querySelector('.g-del').addEventListener('click', () => { row.remove(); window.ncMarkDirty && window.ncMarkDirty(); });
        box.appendChild(row);
      };
      function collectGallery() {
        return Array.from(document.querySelectorAll('#gallery-rows .g-url')).map(i => i.value.trim()).filter(Boolean);
      }
      // --- key features editor ---
      window.addFeatRow = (text = '') => {
        const box = document.getElementById('feat-rows');
        if (!box) return;
        const row = document.createElement('div');
        row.className = 'feat-row flex gap-2 items-center';
        row.innerHTML = \`<span class="text-emerald-500 flex-shrink-0"><i class="fas fa-check-circle"></i></span>
          <input placeholder="مثال: پشتیبانی از PoE تا 30 وات" class="feat-text flex-1 border rounded-lg px-3 py-2 text-sm" value="\${escAdmin(text)}">
          <button type="button" onclick="this.closest('.feat-row').remove(); window.ncMarkDirty && window.ncMarkDirty();" class="text-red-500 hover:text-red-600 px-2"><i class="fas fa-trash"></i></button>\`;
        box.appendChild(row);
      };
      function collectFeatures() {
        return Array.from(document.querySelectorAll('#feat-rows .feat-text')).map(i => i.value.trim()).filter(Boolean);
      }
      // --- specs editor (group / key / value) ---
      window.addSpecRow = (group = '', key = '', value = '') => {
        const box = document.getElementById('specs-rows');
        if (!box) return;
        const row = document.createElement('div');
        row.className = 'flex gap-2 items-center spec-row';
        row.innerHTML = \`<input placeholder="گروه (مثلاً ارتباطات)" list="spec-groups" class="spec-group w-32 border rounded-lg px-2 py-2 text-sm bg-amber-50/60" value="\${escAdmin(group)}">
          <input placeholder="نام (مثلاً ابعاد)" class="spec-key flex-1 border rounded-lg px-3 py-2 text-sm" value="\${escAdmin(key)}">
          <input placeholder="مقدار (مثلاً 60×60×120 سانتی‌متر)" class="spec-value flex-1 border rounded-lg px-3 py-2 text-sm" value="\${escAdmin(value)}">
          <button type="button" onclick="this.closest('.spec-row').remove(); window.ncMarkDirty && window.ncMarkDirty();" class="text-red-500 hover:text-red-600 px-2"><i class="fas fa-trash"></i></button>\`;
        box.appendChild(row);
        if (!document.getElementById('spec-groups')) {
          const dl = document.createElement('datalist');
          dl.id = 'spec-groups';
          dl.innerHTML = ['مشخصات کلی','ارتباطات','سخت‌افزار','ابعاد و وزن','برق و مصرف','سایر'].map(g => '<option value="' + g + '">').join('');
          document.body.appendChild(dl);
        }
      };
      function collectSpecs() {
        return Array.from(document.querySelectorAll('#specs-rows .spec-row')).map(r => ({
          group: r.querySelector('.spec-group').value.trim(),
          key: r.querySelector('.spec-key').value.trim(),
          value: r.querySelector('.spec-value').value.trim()
        })).filter(s => s.key && s.value).map(s => s.group ? s : { key: s.key, value: s.value });
      }
      // --- auto slug from product name (persian-aware, stops once slug edited manually) ---
      function slugifyFa(s) {
        return String(s || '').trim().toLowerCase()
          .replace(/[\\u064A]/g, '\\u06CC').replace(/[\\u0643]/g, '\\u06A9')
          .replace(/[^0-9a-z\\u0600-\\u06FF\\s-]/g, '')
          .replace(/[\\s_]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
      }
      function bindAutoSlug(isEdit) {
        const nameEl = document.getElementById('pf-name');
        const slugEl = document.getElementById('pf-slug');
        if (!nameEl || !slugEl) return;
        // On edit forms never auto-touch an existing slug (SEO safety) unless it's empty.
        let userEdited = isEdit && !!slugEl.value;
        slugEl.addEventListener('input', () => { userEdited = true; });
        nameEl.addEventListener('input', () => {
          if (userEdited) return;
          slugEl.value = slugifyFa(nameEl.value);
        });
      }
      function initProductFormExtras(p = {}) {
        const gal = Array.isArray(p.gallery) ? p.gallery.slice() : parseJsonSafe(p.gallery || '[]', []);
        gal.forEach(u => addGalleryRow(u));
        const feats = Array.isArray(p.key_features) ? p.key_features : parseJsonSafe(p.key_features || '[]', []);
        feats.forEach(f => addFeatRow(typeof f === 'string' ? f : (f && f.text) || ''));
        const specs = Array.isArray(p.specs) ? p.specs : parseJsonSafe(p.specs || '[]', []);
        specs.forEach(s => addSpecRow(s.group || '', s.key || '', s.value || ''));
        bindAutoSlug(!!p.id);
      }
      window.newProduct = () => {
        showModal('محصول جدید', productForm({}), { size: '2xl' });
        initProductFormExtras({});
        bindProductForm();
      };
      window.editProduct = async (id) => {
        // Always fetch the freshest copy from the DB so the modal never shows a
        // stale snapshot (fixes: edited title appearing unchanged on re-open).
        let p;
        try {
          const r = await axios.get('/api/products/id/' + id, { params: { _t: Date.now() } });
          p = r.data.data;
        } catch (e) { toast('خطا در دریافت اطلاعات محصول', 'error'); return; }
        showModal('ویرایش محصول', productForm(p), { size: '2xl' });
        initProductFormExtras(p);
        bindProductForm(p.id);
      };
      window.applyDiscountCalc = function () {
        const priceEl = document.getElementById('pf-price');
        const dEl = document.getElementById('pf-dprice');
        const mode = document.getElementById('pf-disc-mode').value;
        const val = parseFloat(document.getElementById('pf-disc-val').value);
        const hint = document.getElementById('pf-disc-hint');
        const price = parseFloat(priceEl && priceEl.value);
        if (!price || price <= 0) { toast('اول قیمت اصلی را وارد کنید', 'error'); return; }
        if (!val || val <= 0) { toast('مقدار تخفیف را وارد کنید', 'error'); return; }
        let final;
        if (mode === 'percent') {
          if (val >= 100) { toast('درصد باید کمتر از ۱۰۰ باشد', 'error'); return; }
          final = Math.round(price * (1 - val / 100) / 1000) * 1000;
        } else {
          if (val >= price) { toast('مبلغ تخفیف باید کمتر از قیمت باشد', 'error'); return; }
          final = price - val;
        }
        dEl.value = final;
        if (hint) hint.textContent = 'قیمت تخفیف: ' + final.toLocaleString('fa-IR') + ' تومان (' + Math.round((1 - final / price) * 100) + '٪ کمتر)';
        window.ncMarkDirty && window.ncMarkDirty();
      };
      function bindProductForm(id) {
        (function () {
          var dv = document.getElementById('pf-disc-val'), dp = document.getElementById('pf-dprice'), hint = document.getElementById('pf-disc-hint');
          if (dv && dp) dv.addEventListener('input', function () {
            if (dv.value === '' || !(parseFloat(dv.value) > 0)) { dp.value = ''; if (hint) hint.textContent = ''; window.ncMarkDirty && window.ncMarkDirty(); }
          });
        })();
        document.getElementById('product-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const data = Object.fromEntries(fd.entries());
          ['category_id','brand_id','price','discount_price','stock','featured'].forEach(k => { if (data[k] !== '' && data[k] !== undefined) data[k] = parseInt(data[k]); else if (data[k] === '') { if (k === 'discount_price') data[k] = null; else delete data[k]; } });
          // a discount that is not lower than the price is meaningless -> treat as "no discount"
          if (data.discount_price !== null && data.discount_price !== undefined && (!(data.discount_price > 0) || data.discount_price >= data.price)) data.discount_price = null;
          // R5-A: catch the «5 instead of 5,000,000» typo at the source (non-blocking:
          // the owner can still confirm). Native confirm on purpose — confirmAction
          // would replace this open modal and lose the typed data.
          {
            const pv = Number(data.price) || 0;
            if (pv > 0 && pv < 1000 && !window.confirm('قیمت واردشده ' + formatPrice(pv) + ' تومان است — کمتر از ۱۰۰۰ تومان!\\nاحتمالاً صفرها جا افتاده‌اند (مثلاً ' + formatPrice(pv * 1000000) + ').\\n\\nبا همین قیمت ذخیره شود؟')) { document.getElementById('pf-price') && document.getElementById('pf-price').focus(); return; }
          }
          data.gallery = JSON.stringify(collectGallery());
          data.specs = JSON.stringify(collectSpecs());
          data.key_features = JSON.stringify(collectFeatures());
          const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
          try {
            if (id) await axios.put('/api/products/' + id, data);
            else await axios.post('/api/products', data);
            toast('با موفقیت ذخیره شد', 'success');
            window.ncClearDirty && window.ncClearDirty();
            closeModal(true); loadProducts();
          } catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); btn.disabled = false; }
        });
      }
      // R4-A: duplicate as an inactive draft, then open it for editing
      window.duplicateProduct = (id) => confirmDialog('از این محصول یک کپی «غیرفعال» ساخته شود؟ (کد محصول/SKU خالی می‌ماند؛ بعد از ویرایش فعالش کنید)', async () => {
        try {
          const r = await axios.post('/api/products/' + id + '/duplicate');
          toast(r.data.message || 'کپی ساخته شد', 'success');
          await loadProducts();
          if (r.data.data && r.data.data.id) editProduct(r.data.data.id);
        } catch (e) { toast(e.response?.data?.message || 'خطا در کپی محصول', 'error'); }
      });
      window.deleteProduct = (id) => confirmDialog('این محصول «برای همیشه» حذف شود؟\\nاگر فقط می‌خواهید در سایت نمایش داده نشود، به‌جای حذف روی دکمهٔ «فعال» در ستون وضعیت بزنید تا غیرفعال شود (قابل برگشت).', async () => {
        try { const r = await axios.delete('/api/products/' + id); toast(r.data.message || 'حذف شد', 'success'); loadProducts(); }
        catch (e) { toast(e.response?.data?.message || 'خطا', 'error'); }
      });
      loadProducts();
      // close the export dropdown when clicking elsewhere
      document.addEventListener('click', (e) => { const w = document.getElementById('pio-export-wrap'); if (w && !w.contains(e.target)) document.getElementById('pio-export-menu').classList.add('hidden'); });
    </script>
    <script src="/static/js/product-io.js?v=20261103b" defer></script>
  `;
    return adminLayout({ title: 'محصولات', currentPath: '/admin/products' }, content);
}
// ===== Orders =====
export function adminOrdersPage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5">
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 class="font-bold">سفارش‌ها</h2>
        <div class="flex items-center gap-2 flex-wrap">
          <div class="relative">
            <i class="fas fa-search absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
            <input id="ord-search" type="search" placeholder="جستجو: شماره سفارش، نام، موبایل، ایمیل" class="border rounded-lg pr-8 pl-3 py-1.5 text-sm w-64 max-w-full" autocomplete="off">
          </div>
          <select id="filter-status" class="border rounded-lg px-3 py-1.5 text-sm"><option value="">همه</option><option value="pending">در انتظار</option><option value="confirmed">تایید شده</option><option value="shipping">در حال ارسال</option><option value="delivered">تحویل شده</option><option value="cancelled">لغو شده</option></select>
          <button id="bulk-del-filter" type="button" class="border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap"><i class="fas fa-trash-can ml-1"></i><span>حذف همهٔ سفارش‌های این فیلتر</span></button>
        </div>
      </div>
      <!-- 2026-11-03: bulk actions bar (owner voice note — clean up test orders) -->
      <div id="bulk-bar" class="hidden mb-3 flex items-center justify-between gap-2 flex-wrap rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm">
        <span class="text-red-800"><i class="fas fa-check-square ml-1"></i><b id="bulk-count">0</b> سفارش انتخاب شده</span>
        <div class="flex gap-2">
          <button id="bulk-clear" type="button" class="px-3 py-1.5 rounded-lg text-slate-600 hover:bg-white">لغو انتخاب</button>
          <button id="bulk-del-selected" type="button" class="bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 rounded-lg"><i class="fas fa-trash ml-1"></i>حذف انتخاب‌شده‌ها</button>
        </div>
      </div>
      <div id="orders-table" class="overflow-x-auto"><div class="text-center py-12"><span class="spinner"></span></div></div>
      <div id="orders-pager" class="flex justify-center gap-1 mt-4 flex-wrap"></div>
    </div>
    <script>
      const PAY_METHOD = { card: 'کارت به کارت', gateway: 'درگاه آنلاین', cod: 'هماهنگی تلفنی' };
      const PAY_STATUS = {
        pending:         ['در انتظار پرداخت', 'bg-slate-100 text-slate-600'],
        awaiting_review: ['رسید ثبت شد',      'bg-amber-100 text-amber-700'],
        paid:            ['پرداخت شده',       'bg-emerald-100 text-emerald-700'],
        failed:          ['ناموفق',           'bg-rose-100 text-rose-700'],
        refunded:        ['بازگشت وجه',       'bg-slate-100 text-slate-500']
      };
      function payBadge(o) {
        const ps = PAY_STATUS[o.payment_status || 'pending'] || PAY_STATUS.pending;
        const pm = PAY_METHOD[o.payment_method] || '—';
        const ring = (o.payment_status === 'awaiting_review') ? ' ring-2 ring-amber-300 animate-pulse' : '';
        return '<span class="inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ' + ps[1] + ring + '">' + ps[0] + '</span>'
             + '<span class="block text-[10px] text-slate-400 mt-0.5">' + pm + '</span>';
      }
      const SELECTED = new Set();   // survives the 30s polling re-render
      let ORD_PAGE = 1, ORD_ITEMS = [], ORD_TOTAL = 0;
      const ST_LABEL = { '': 'همه', pending: 'در انتظار', confirmed: 'تایید شده', shipping: 'در حال ارسال', delivered: 'تحویل شده', cancelled: 'لغو شده' };
      function refreshBulkBar() {
        document.getElementById('bulk-bar').classList.toggle('hidden', SELECTED.size === 0);
        document.getElementById('bulk-count').textContent = formatPrice(SELECTED.size);
        const all = document.getElementById('sel-all');
        if (all) { const ids = ORD_ITEMS.map(o => o.id); all.checked = ids.length > 0 && ids.every(id => SELECTED.has(id)); }
      }
      window.toggleSel = (id, on) => { on ? SELECTED.add(id) : SELECTED.delete(id); refreshBulkBar(); };
      window.toggleSelAll = (on) => { ORD_ITEMS.forEach(o => on ? SELECTED.add(o.id) : SELECTED.delete(o.id)); document.querySelectorAll('.ord-sel').forEach(cb => { cb.checked = on; }); refreshBulkBar(); };
      function renderPager(pages) {
        const el = document.getElementById('orders-pager');
        if (!pages || pages <= 1) { el.innerHTML = ''; return; }
        let h = '';
        for (let i = 1; i <= pages; i++) h += '<button type="button" onclick="gotoOrdPage(' + i + ')" class="px-3 py-1 rounded-lg text-sm ' + (i === ORD_PAGE ? 'btn-indigo text-white' : 'bg-slate-100 hover:bg-slate-200') + '">' + formatPrice(i) + '</button>';
        el.innerHTML = h;
      }
      window.gotoOrdPage = (p) => { ORD_PAGE = p; loadOrders(); };
      function refreshFilterBtn(counts) {
        const st = document.getElementById('filter-status').value;
        const n = st ? ((counts && counts[st]) || 0) : Object.values(counts || {}).reduce((a, b) => a + b, 0);
        const btn = document.getElementById('bulk-del-filter');
        btn.querySelector('span').textContent = 'حذف همهٔ سفارش‌های «' + ST_LABEL[st] + '» (' + formatPrice(n) + ')';
        const searching = !!(document.getElementById('ord-search').value || '').trim();
        btn.disabled = n === 0 || searching; btn.classList.toggle('opacity-40', n === 0 || searching);
        btn.title = searching ? 'هنگام جستجو غیرفعال است (این دکمه بر اساس وضعیت حذف می‌کند، نه نتیجهٔ جستجو). برای حذف نتایج جستجو، آن‌ها را تیک بزنید.' : '';
        btn.dataset.count = searching ? 0 : n;
        // status dropdown shows how many orders each status has
        const sel = document.getElementById('filter-status');
        Array.from(sel.options).forEach(o => {
          const c = o.value ? ((counts && counts[o.value]) || 0) : Object.values(counts || {}).reduce((a, b) => a + b, 0);
          o.textContent = ST_LABEL[o.value] + ' (' + formatPrice(c) + ')';
        });
      }
      async function loadOrders() {
        const status = document.getElementById('filter-status').value;
        const tbl = document.getElementById('orders-table');
        try {
          const q = (document.getElementById('ord-search').value || '').trim();
          const r = await axios.get('/api/orders', { params: { status, limit: 50, page: ORD_PAGE, q: q || undefined } });
          const data = r.data.data;
          if (!data.items.length && ORD_PAGE > 1) { ORD_PAGE = 1; return loadOrders(); }
          const items = ORD_ITEMS = data.items; ORD_TOTAL = data.total;
          refreshFilterBtn(data.counts);
          renderPager(data.pages);
          if (!items.length) { tbl.innerHTML = '<p class="text-center py-12 text-slate-400">سفارشی یافت نشد' + (q ? ' — عبارت جستجو را بررسی کنید' : '') + '</p>'; refreshBulkBar(); return; }
          tbl.innerHTML = \`<table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-600 text-xs">
              <tr><th class="px-3 py-3 text-right w-8"><input type="checkbox" id="sel-all" onchange="toggleSelAll(this.checked)" class="w-4 h-4 cursor-pointer" title="انتخاب همهٔ این صفحه"></th><th class="px-3 py-3 text-right">شماره</th><th class="px-3 py-3 text-right">مشتری</th><th class="px-3 py-3 text-right">تماس</th><th class="px-3 py-3 text-right">مبلغ</th><th class="px-3 py-3 text-right">تاریخ</th><th class="px-3 py-3 text-right">وضعیت</th><th class="px-3 py-3 text-right">پرداخت</th><th class="px-3 py-3 text-right">عملیات</th></tr>
            </thead>
            <tbody>\${items.map(o => \`<tr class="table-row border-t">
              <td class="px-3 py-2"><input type="checkbox" class="ord-sel w-4 h-4 cursor-pointer" \${SELECTED.has(o.id) ? 'checked' : ''} onchange="toggleSel(\${o.id}, this.checked)"></td>
              <td class="px-3 py-2 font-mono text-indigo-600 text-xs">\${escAdmin(o.order_number)}</td>
              <td class="px-3 py-2">\${escAdmin(o.customer_name)}</td>
              <td class="px-3 py-2 text-xs">\${escAdmin(o.customer_phone)}</td>
              <td class="px-3 py-2">\${formatPrice(o.total)}</td>
              <td class="px-3 py-2 text-xs">\${formatDate(o.created_at)}</td>
              <td class="px-3 py-2"><span class="badge badge-\${o.status}">\${statusLabel(o.status)}</span></td>
              <td class="px-3 py-2 whitespace-nowrap">\${payBadge(o)}</td>
              <td class="px-3 py-2 whitespace-nowrap"><button onclick="viewOrder(\${o.id})" class="text-indigo-600 ml-3" title="جزئیات"><i class="fas fa-eye"></i></button><button onclick="deleteOrder(\${o.id}, '\${escAdmin(o.order_number)}')" class="text-red-500 hover:text-red-700" title="حذف سفارش"><i class="fas fa-trash"></i></button></td>
            </tr>\`).join('')}</tbody></table>\`;
          refreshBulkBar();
        } catch (e) { tbl.innerHTML = '<p class="text-red-500 p-4">خطا</p>'; }
      }
      const STOCK_NOTE = '<br><span class="text-xs text-slate-500">موجودیِ کالاهای سفارش‌های «در انتظار / تایید شده / در حال ارسال» به انبار برمی‌گردد. این کار قابل بازگشت نیست.</span>';
      window.deleteOrder = (id, num) => confirmDialog('سفارش <b dir="ltr">' + num + '</b> برای همیشه حذف شود؟' + STOCK_NOTE, async () => {
        try { const r = await axios.delete('/api/orders/' + id); SELECTED.delete(id); toast(r.data.message || 'حذف شد', 'success'); closeModal && closeModal(); loadOrders(); }
        catch (e) { toast(e.response?.data?.message || 'خطا در حذف', 'error'); }
      });
      document.getElementById('bulk-clear').addEventListener('click', () => { SELECTED.clear(); document.querySelectorAll('.ord-sel').forEach(cb => { cb.checked = false; }); refreshBulkBar(); });
      document.getElementById('bulk-del-selected').addEventListener('click', () => {
        const ids = Array.from(SELECTED);
        if (!ids.length) return;
        confirmDialog(formatPrice(ids.length) + ' سفارش انتخاب‌شده برای همیشه حذف شوند؟' + STOCK_NOTE, async () => {
          try { const r = await axios.post('/api/orders/bulk-delete', { ids }); SELECTED.clear(); toast(r.data.message, 'success'); loadOrders(); }
          catch (e) { toast(e.response?.data?.message || 'خطا در حذف گروهی', 'error'); }
        });
      });
      document.getElementById('bulk-del-filter').addEventListener('click', (ev) => {
        const st = document.getElementById('filter-status').value;
        const n = parseInt(ev.currentTarget.dataset.count || '0');
        if (!n) return;
        const label = ST_LABEL[st];
        const warn = st === '' ? '<br><b class="text-red-600">توجه: همهٔ سفارش‌ها (حتی تحویل‌شده‌ها) حذف می‌شوند!</b>' : '';
        confirmDialog('همهٔ <b>' + formatPrice(n) + '</b> سفارش با وضعیت «' + label + '» برای همیشه حذف شوند؟' + warn + STOCK_NOTE, async () => {
          try { const r = await axios.post('/api/orders/bulk-delete', { status: st || 'all', confirm: 'DELETE' }); SELECTED.clear(); ORD_PAGE = 1; toast(r.data.message, 'success'); loadOrders(); }
          catch (e) { toast(e.response?.data?.message || 'خطا در حذف گروهی', 'error'); }
        });
      });
      window.viewOrder = async (id) => {
        try {
          const r = await axios.get('/api/orders/' + id);
          const o = r.data.data;
          showModal('جزئیات سفارش ' + escAdmin(o.order_number), \`
            <div class="space-y-4">
              <div class="grid md:grid-cols-2 gap-4 text-sm">
                <div><b>مشتری:</b> \${escAdmin(o.customer_name)}</div>
                <div><b>تماس:</b> \${escAdmin(o.customer_phone)}</div>
                <div><b>ایمیل:</b> \${escAdmin(o.customer_email || '-')}</div>
                <div><b>شهر:</b> \${escAdmin(o.shipping_city || '-')}</div>
                <div class="md:col-span-2"><b>آدرس:</b> \${escAdmin(o.shipping_address)}</div>
                <div class="md:col-span-2"><b>یادداشت:</b> \${escAdmin(o.notes || '-')}</div>
              </div>
              <div class="border-t pt-3">
                <h4 class="font-bold mb-2">اقلام:</h4>
                <table class="w-full text-sm"><thead class="bg-slate-50 text-xs"><tr><th class="text-right py-2 px-2">محصول</th><th class="text-right py-2 px-2">تعداد</th><th class="text-right py-2 px-2">قیمت واحد</th><th class="text-right py-2 px-2">جمع</th></tr></thead>
                  <tbody>\${o.items.map(it => \`<tr class="border-t"><td class="py-2 px-2">\${escAdmin(it.product_name)}</td><td class="py-2 px-2">\${it.quantity}</td><td class="py-2 px-2">\${formatPrice(it.unit_price)}</td><td class="py-2 px-2">\${formatPrice(it.total)}</td></tr>\`).join('')}</tbody>
                </table>
              </div>
              <div class="text-left text-sm space-y-1 pt-3 border-t">
                <div>جمع کل: <b>\${formatPrice(o.subtotal)}</b></div>
                <div>ارسال: <b>\${formatPrice(o.shipping_cost)}</b></div>
                <div class="text-lg">قابل پرداخت: <b class="text-indigo-600">\${formatPrice(o.total)} تومان</b></div>
              </div>
              <div class="border-t pt-3">
                <h4 class="font-bold mb-2 text-sm"><i class="fas fa-money-check-dollar ml-1 text-indigo-600"></i>پرداخت</h4>
                <div class="grid md:grid-cols-2 gap-2 text-sm bg-slate-50 rounded-lg p-3 mb-3">
                  <div><b>روش:</b> \${PAY_METHOD[o.payment_method] || '—'}</div>
                  <div><b>وضعیت:</b> \${payBadge(o)}</div>
                  <div class="md:col-span-2"><b>شماره پیگیری واریز:</b>
                    \${o.payment_ref
                      ? '<span class="font-mono text-indigo-600" dir="ltr">' + escAdmin(o.payment_ref) + '</span>'
                      : '<span class="text-slate-400">هنوز ثبت نشده</span>'}</div>
                  \${o.payment_note ? '<div class="md:col-span-2"><b>توضیح مشتری:</b> ' + escAdmin(o.payment_note) + '</div>' : ''}
                  \${o.paid_at ? '<div class="md:col-span-2"><b>تاریخ تایید پرداخت:</b> ' + formatDate(o.paid_at) + '</div>' : ''}
                </div>
                <div class="flex gap-2">
                  <select id="payment-select" class="border rounded-lg px-3 py-2 text-sm flex-1">
                    \${Object.keys(PAY_STATUS).map(k => \`<option value="\${k}" \${(o.payment_status || 'pending') === k ? 'selected' : ''}>\${PAY_STATUS[k][0]}</option>\`).join('')}
                  </select>
                  <button onclick="updatePayment(\${o.id})" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm whitespace-nowrap">ثبت وضعیت پرداخت</button>
                </div>
              </div>
              <div class="border-t pt-3">
                <label class="block text-sm mb-1 font-bold">تغییر وضعیت سفارش</label>
                <div class="flex gap-2">
                  <select id="status-select" class="border rounded-lg px-3 py-2 text-sm flex-1">
                    \${['pending','confirmed','shipping','delivered','cancelled'].map(s => \`<option value="\${s}" \${o.status === s ? 'selected' : ''}>\${statusLabel(s)}</option>\`).join('')}
                  </select>
                  <button onclick="updateStatus(\${o.id})" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm">به‌روزرسانی</button>
                </div>
              </div>
              <div class="border-t pt-3 text-left">
                <button onclick="deleteOrder(\${o.id}, '\${escAdmin(o.order_number)}')" class="text-red-600 hover:bg-red-50 border border-red-200 px-4 py-2 rounded-lg text-sm"><i class="fas fa-trash ml-1"></i>حذف این سفارش</button>
              </div>
            </div>\`, { size: '3xl' });
        } catch (e) { toast('خطا', 'error'); }
      };
      window.updateStatus = async (id) => {
        const status = document.getElementById('status-select').value;
        try { await axios.put('/api/orders/' + id + '/status', { status }); toast('وضعیت تغییر کرد', 'success'); closeModal(); loadOrders(); }
        catch (e) { toast('خطا', 'error'); }
      };
      window.updatePayment = async (id) => {
        const payment_status = document.getElementById('payment-select').value;
        try { await axios.put('/api/orders/' + id + '/payment', { payment_status }); toast('وضعیت پرداخت ثبت شد', 'success'); closeModal(); loadOrders(); }
        catch (e) { toast(e.response?.data?.message || 'خطا در ثبت وضعیت پرداخت', 'error'); }
      };
      document.getElementById('filter-status').addEventListener('change', () => { ORD_PAGE = 1; SELECTED.clear(); loadOrders(); });
      // R6-A: search (debounced)
      let __ordQT = null;
      document.getElementById('ord-search').addEventListener('input', () => { clearTimeout(__ordQT); __ordQT = setTimeout(() => { ORD_PAGE = 1; loadOrders(); }, 300); });
      loadOrders();
      setInterval(loadOrders, 30000); // Polling every 30s
    </script>
  `;
    return adminLayout({ title: 'سفارش‌ها', currentPath: '/admin/orders' }, content);
}
// ===== Tickets =====
export function adminTicketsPage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h2 class="font-bold mb-4">تیکت‌های پشتیبانی</h2>
      <div id="tickets-list" class="overflow-x-auto"><div class="text-center py-12"><span class="spinner"></span></div></div>
    </div>
    <script>
      async function loadTickets() {
        try {
          const r = await axios.get('/api/tickets');
          const items = r.data.data;
          if (!items.length) { document.getElementById('tickets-list').innerHTML = '<p class="text-center py-12 text-slate-400">تیکتی یافت نشد</p>'; return; }
          document.getElementById('tickets-list').innerHTML = \`<table class="w-full text-sm">
            <thead class="bg-slate-50 text-xs"><tr><th class="px-3 py-3 text-right">شماره</th><th class="px-3 py-3 text-right">موضوع</th><th class="px-3 py-3 text-right">پاسخ‌ها</th><th class="px-3 py-3 text-right">تاریخ</th><th class="px-3 py-3 text-right">وضعیت</th><th class="px-3 py-3 text-right">عملیات</th></tr></thead>
            <tbody>\${items.map(t => \`<tr class="table-row border-t">
              <td class="px-3 py-2 font-mono text-xs text-indigo-600">\${escAdmin(t.ticket_number)}</td>
              <td class="px-3 py-2">\${escAdmin(t.subject)}</td>
              <td class="px-3 py-2">\${t.replies_count || 0}</td>
              <td class="px-3 py-2 text-xs">\${formatDate(t.created_at)}</td>
              <td class="px-3 py-2"><span class="badge badge-\${t.status}">\${statusLabel(t.status, 'ticket')}</span></td>
              <td class="px-3 py-2"><button onclick="viewTicket(\${t.id})" class="text-indigo-600"><i class="fas fa-eye"></i></button></td>
            </tr>\`).join('')}</tbody></table>\`;
        } catch (e) { document.getElementById('tickets-list').innerHTML = '<p class="text-red-500 p-4">خطا</p>'; }
      }
      window.viewTicket = async (id) => {
        try {
          const r = await axios.get('/api/tickets/' + id);
          const t = r.data.data;
          let html = \`<div class="space-y-3">
            <div class="bg-slate-50 rounded-lg p-3">
              <div class="flex justify-between mb-1"><span class="font-bold">\${escAdmin(t.subject)}</span><span class="badge badge-\${t.status}">\${statusLabel(t.status, 'ticket')}</span></div>
              <div class="text-xs text-slate-500 mb-2">\${escAdmin(t.ticket_number)} • \${formatDate(t.created_at)}</div>
              <p class="text-sm text-slate-700">\${escAdmin(t.message)}</p>
            </div>
            <div class="space-y-2 max-h-60 overflow-y-auto">
            \${(t.replies || []).map(rp => \`<div class="\${rp.is_admin ? 'bg-indigo-50' : 'bg-amber-50'} rounded-lg p-3">
              <div class="flex justify-between text-xs mb-1"><b>\${escAdmin(rp.author_name)} \${rp.is_admin ? '(پشتیبانی)' : '(مشتری)'}</b><span class="text-slate-500">\${formatDate(rp.created_at)}</span></div>
              <p class="text-sm">\${escAdmin(rp.message)}</p>
            </div>\`).join('')}
            </div>
            <form id="reply-form" class="space-y-2 border-t pt-3">
              <textarea name="message" required rows="3" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="پاسخ شما..."></textarea>
              <div class="flex gap-2">
                <button type="submit" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm">ارسال پاسخ</button>
                <select id="ticket-status" class="border rounded-lg px-3 py-2 text-sm">\${['open','answered','closed'].map(s => '<option value="' + s + '"' + (t.status === s ? ' selected' : '') + '>' + statusLabel(s, 'ticket') + '</option>').join('')}</select>
                <button type="button" onclick="changeTicketStatus(\${id})" class="bg-slate-200 px-4 py-2 rounded-lg text-sm">تغییر وضعیت</button>
              </div>
            </form>
          </div>\`;
          showModal('تیکت ' + t.ticket_number, html, { size: '2xl' });
          document.getElementById('reply-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            try { await axios.post('/api/tickets/' + id + '/replies', { message: fd.get('message') }); toast('پاسخ ارسال شد', 'success'); viewTicket(id); }
            catch (err) { toast('خطا', 'error'); }
          });
        } catch (e) { toast('خطا', 'error'); }
      };
      window.changeTicketStatus = async (id) => {
        const status = document.getElementById('ticket-status').value;
        try { await axios.put('/api/tickets/' + id + '/status', { status }); toast('وضعیت تغییر کرد', 'success'); closeModal(); loadTickets(); }
        catch (e) { toast('خطا', 'error'); }
      };
      loadTickets();
    </script>
  `;
    return adminLayout({ title: 'تیکت‌ها', currentPath: '/admin/tickets' }, content);
}
// ===== Comments =====
export function adminCommentsPage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold">دیدگاه‌ها</h2>
        <select id="filter-cstatus" class="border rounded-lg px-3 py-1.5 text-sm"><option value="">همه</option><option value="pending">در انتظار</option><option value="approved">تایید شده</option><option value="rejected">رد شده</option></select>
      </div>
      <div id="comments-list"><div class="text-center py-12"><span class="spinner"></span></div></div>
    </div>
    <script>
      async function loadComments() {
        const status = document.getElementById('filter-cstatus').value;
        try {
          const r = await axios.get('/api/blog/admin/comments', { params: { status } });
          const items = r.data.data;
          if (!items.length) { document.getElementById('comments-list').innerHTML = '<p class="text-center py-12 text-slate-400">دیدگاهی یافت نشد</p>'; return; }
          document.getElementById('comments-list').innerHTML = items.map(c => \`<div class="border rounded-lg p-4 mb-3">
            <div class="flex items-center justify-between mb-2">
              <div><b>\${escAdmin(c.author_name)}</b> <span class="text-xs text-slate-500">\${escAdmin(c.author_email || '')}</span></div>
              <span class="badge badge-\${c.status}">\${statusLabel(c.status, 'comment')}</span>
            </div>
            <div class="text-xs text-slate-400 mb-2">روی مقاله: <a href="/blog/\${escAdmin(c.post_slug)}" target="_blank" class="text-indigo-600">\${escAdmin(c.post_title)}</a> • \${formatDate(c.created_at)}</div>
            <p class="text-sm text-slate-700 mb-3">\${escAdmin(c.content)}</p>
            <div class="flex gap-2">
              \${c.status !== 'approved' ? \`<button onclick="approveCom(\${c.id})" class="bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs"><i class="fas fa-check ml-1"></i>تایید</button>\` : ''}
              \${c.status !== 'rejected' ? \`<button onclick="rejectCom(\${c.id})" class="bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs"><i class="fas fa-times ml-1"></i>رد</button>\` : ''}
              <button onclick="delCom(\${c.id})" class="bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs"><i class="fas fa-trash ml-1"></i>حذف</button>
            </div>
          </div>\`).join('');
        } catch (e) { toast('خطا', 'error'); }
      }
      // Round 8: every action reports server errors instead of failing silently
      async function comAction(fn, okMsg) {
        try { await fn(); toast(okMsg, 'success'); }
        catch (e) { toast(e.response?.data?.message || 'خطا در انجام عملیات', 'error'); }
        loadComments();
      }
      window.approveCom = (id) => comAction(() => axios.put('/api/blog/admin/comments/' + id + '/status', { status: 'approved' }), 'دیدگاه تایید شد و در سایت نمایش داده می‌شود');
      window.rejectCom = (id) => comAction(() => axios.put('/api/blog/admin/comments/' + id + '/status', { status: 'rejected' }), 'دیدگاه رد شد');
      window.delCom = (id) => confirmDialog('این دیدگاه برای همیشه حذف شود؟', () => comAction(() => axios.delete('/api/blog/admin/comments/' + id), 'دیدگاه حذف شد'));
      document.getElementById('filter-cstatus').addEventListener('change', loadComments);
      loadComments();
    </script>
  `;
    return adminLayout({ title: 'دیدگاه‌ها', currentPath: '/admin/comments' }, content);
}
// ===== Posts =====
export function adminPostsPage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold">مقالات</h2>
        <button onclick="newPost()" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm"><i class="fas fa-plus ml-1"></i>مقاله جدید</button>
      </div>
      <div id="posts-table" class="overflow-x-auto"><div class="text-center py-12"><span class="spinner"></span></div></div>
    </div>
    <script>
      async function loadPosts() {
        try {
          const r = await axios.get('/api/blog/admin/posts');
          const items = r.data.data;
          document.getElementById('posts-table').innerHTML = items.length ? \`<table class="w-full text-sm">
            <thead class="bg-slate-50 text-xs"><tr><th class="px-3 py-3 text-right">عنوان</th><th class="px-3 py-3 text-right">دسته</th><th class="px-3 py-3 text-right">بازدید</th><th class="px-3 py-3 text-right">وضعیت</th><th class="px-3 py-3 text-right">عملیات</th></tr></thead>
            <tbody>\${items.map(p => \`<tr class="table-row border-t">
              <td class="px-3 py-2"><div class="font-medium">\${escAdmin(p.title)}</div><div class="text-xs text-slate-400">\${escAdmin(p.slug)}</div></td>
              <td class="px-3 py-2">\${escAdmin(p.category || '-')}</td>
              <td class="px-3 py-2">\${p.views || 0}</td>
              <td class="px-3 py-2"><span class="badge badge-\${p.status}">\${statusLabel(p.status, 'post')}</span></td>
              <td class="px-3 py-2"><a href="/blog/\${escAdmin(p.slug)}" target="_blank" class="text-slate-500 ml-2"><i class="fas fa-external-link-alt"></i></a><button onclick='editPost(\${attrJson(p)})' class="text-indigo-600 ml-2"><i class="fas fa-pen"></i></button><button onclick="delPost(\${p.id})" class="text-red-600"><i class="fas fa-trash"></i></button></td>
            </tr>\`).join('')}</tbody></table>\` : '<p class="text-center py-12 text-slate-400">مقاله‌ای نیست</p>';
        } catch (e) { document.getElementById('posts-table').innerHTML = '<p class="text-red-500 p-4">خطا</p>'; }
      }
      function postForm(p = {}) {
        return \`<form id="post-form" class="space-y-3">
          <div class="grid md:grid-cols-2 gap-3">
            <div><label class="block text-sm mb-1">عنوان *</label><input name="title" required value="\${escAdmin(p.title || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1">Slug *</label><input name="slug" required value="\${escAdmin(p.slug || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          </div>
          <div><label class="block text-sm mb-1">دسته</label><input name="category" value="\${escAdmin(p.category || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          \${window.ncpImageField('cover_image', p.cover_image || '', 'تصویر شاخص مقاله')}
          <div><label class="block text-sm mb-1">خلاصه</label><textarea name="excerpt" rows="2" class="w-full border rounded-lg px-3 py-2 text-sm">\${escAdmin(p.excerpt || '')}</textarea></div>
          <div><label class="block text-sm mb-1">محتوا (HTML پشتیبانی می‌شود) *</label><textarea name="content" required rows="8" class="w-full border rounded-lg px-3 py-2 text-sm font-mono">\${escAdmin(p.content || '')}</textarea></div>
          <div><select name="status" class="border rounded-lg px-3 py-2 text-sm"><option value="published" \${p.status === 'published' ? 'selected' : ''}>منتشر شده</option><option value="draft" \${p.status === 'draft' ? 'selected' : ''}>پیش‌نویس</option></select></div>
          <div class="flex gap-2 pt-3 border-t">
            <button type="submit" class="btn-indigo text-white px-5 py-2 rounded-lg text-sm">ذخیره</button>
            <button type="button" onclick="closeModal(true)" class="px-5 py-2 bg-slate-200 rounded-lg text-sm">انصراف</button>
          </div>
        </form>\`;
      }
      window.newPost = () => { showModal('مقاله جدید', postForm({}), { size: '3xl' }); bindPostForm(); };
      window.editPost = (p) => { showModal('ویرایش مقاله', postForm(p), { size: '3xl' }); bindPostForm(p.id); };
      function bindPostForm(id) {
        document.getElementById('post-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const data = Object.fromEntries(fd.entries());
          const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
          try {
            if (id) await axios.put('/api/blog/admin/posts/' + id, data);
            else await axios.post('/api/blog/admin/posts', data);
            toast('ذخیره شد', 'success'); closeModal(); loadPosts();
          } catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); btn.disabled = false; }
        });
      }
      window.delPost = (id) => confirmDialog('حذف این مقاله؟', async () => { await axios.delete('/api/blog/admin/posts/' + id); toast('حذف شد', 'success'); loadPosts(); });
      loadPosts();
    </script>
  `;
    return adminLayout({ title: 'مقالات', currentPath: '/admin/posts' }, content);
}
// ===== Categories =====
export function adminCategoriesPage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5 mb-5">
      <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 class="font-bold">دسته‌بندی‌ها (چندسطحی)</h2>
        <div class="flex gap-2">
          <button onclick="openBulkPrice()" class="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm"><i class="fas fa-percent ml-1"></i>تغییر گروهی قیمت</button>
          <button onclick="newCat()" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm"><i class="fas fa-plus ml-1"></i>دسته جدید</button>
        </div>
      </div>
      <div id="cats-list"><div class="text-center py-12"><span class="spinner"></span></div></div>
    </div>
    <script>
      let CATS = [];
      function catTreeRows(items) {
        const byParent = {};
        items.forEach(c => { const k = c.parent_id || 0; (byParent[k] = byParent[k] || []).push(c); });
        const rows = [];
        (function walk(pid, depth) {
          (byParent[pid] || []).forEach(c => {
            rows.push({ ...c, __depth: depth });
            walk(c.id, depth + 1);
          });
        })(0, 0);
        return rows;
      }
      async function loadCats() {
        const r = await axios.get('/api/admin/categories');
        CATS = r.data.data;
        const rows = catTreeRows(CATS);
        // inactive category hides its whole sub-tree on the site
        const __byId = {}; CATS.forEach(x => { __byId[x.id] = x; });
        const __off = (c) => { let cur = c, guard = 0; while (cur && guard++ < 50) { if (cur.is_active == 0) return true; cur = __byId[cur.parent_id]; } return false; };
        // --- نگهبان عکس تکراری: اگر دو دسته یک عکس داشته باشند، نشان هشدار بگذار ---
        const __imgCount = {};
        const __key = x => (x.image_hash || x.image || null);  // اول محتوای فایل، بعد مسیر
        CATS.forEach(x => { const k = __key(x); if (k) __imgCount[k] = (__imgCount[k] || 0) + 1; });
        const __dupNames = {};
        CATS.forEach(x => { const k = __key(x); if (k && __imgCount[k] > 1) { (__dupNames[k] = __dupNames[k] || []).push(x.name); } });
        const __isDup = c => { const k = __key(c); return !!(k && __imgCount[k] > 1); };
        const __dupTitle = c => { const k = __key(c); return __isDup(c) ? ('هشدار: این عکس بین ' + __imgCount[k] + ' دسته مشترک است: ' + (__dupNames[k] || []).join(' ، ') + ' — لطفاً عکس اختصاصی بارگذاری کنید.') : ''; };
        window.__ncpDupImageGroups = __dupNames;
        // بنر هشدار ساده و غیرفنی بالای فهرست دسته‌ها
        const __dupBanner = Object.keys(__dupNames).length
          ? '<div class="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" dir="rtl">'
            + '<div class="font-bold mb-1"><i class="fas fa-triangle-exclamation ml-1"></i> چند دسته عکس یکسان دارند</div>'
            + '<div class="leading-7">برای هر دستهٔ زیر باید یک عکس اختصاصی بارگذاری شود. روی دکمهٔ ویرایش (مداد) همان ردیف بزنید و عکس درست را انتخاب کنید:</div>'
            + '<ul class="list-disc pr-6 mt-1 leading-7">'
            + Object.keys(__dupNames).map(k => '<li>' + escAdmin(__dupNames[k].join(' ، ')) + '</li>').join('')
            + '</ul></div>'
          : '';
        document.getElementById('cats-list').innerHTML = __dupBanner + \`<table class="w-full text-sm"><thead class="bg-slate-50 text-xs"><tr><th class="px-3 py-3 text-right">تصویر/آیکون</th><th class="px-3 py-3 text-right">نام</th><th class="px-3 py-3 text-right">Slug</th><th class="px-3 py-3 text-right">محصولات</th><th class="px-3 py-3 text-right">وضعیت</th><th class="px-3 py-3 text-right">عملیات</th></tr></thead><tbody>\${rows.map(c => \`<tr class="border-t\${c.__depth ? ' bg-slate-50/50' : ''}\${__off(c) ? ' opacity-60' : ''}"><td class="px-3 py-2">\${c.image ? '<span class="relative inline-block align-middle" title="' + escAdmin(__dupTitle(c)) + '">' + '<img loading="lazy" src="' + escAdmin(c.image) + '" onerror="this.onerror=null;this.src=\'/static/images/p1.svg\'" class="w-10 h-10 rounded object-cover" style="' + (__isDup(c) ? 'outline:2px solid #dc2626;outline-offset:2px' : '') + '">' + (__isDup(c) ? '<i class="fas fa-triangle-exclamation absolute -top-1 -left-1 text-red-600 text-[10px] bg-white rounded-full leading-none p-[1px]"></i>' : '') + '</span>' : '<i class="fas ' + escAdmin(c.icon || 'fa-folder') + ' text-indigo-600"></i>'}</td><td class="px-3 py-2"><span style="padding-right:\${c.__depth * 22}px">\${c.__depth ? '<i class="fas fa-turn-up fa-rotate-90 text-slate-300 ml-1 text-xs"></i>' : ''}\${escAdmin(c.name)}</span>\${c.__depth ? '<span class="text-[10px] text-slate-400 mr-1">(زیرشاخه ' + escAdmin(c.parent_name || '') + ')</span>' : ''}</td><td class="px-3 py-2 text-xs text-slate-500">\${escAdmin(c.slug)}</td><td class="px-3 py-2">\${c.product_count || 0}</td><td class="px-3 py-2 whitespace-nowrap">\${c.is_active == 0
              ? '<button type="button" onclick="toggleCatActive(' + c.id + ', 1)" class="badge badge-blocked cursor-pointer hover:ring-2 hover:ring-rose-300" title="کلیک کنید تا دوباره فعال شود"><i class="fas fa-toggle-off ml-1"></i>غیرفعال</button>'
              : (__off(c)
                ? '<span class="badge badge-blocked" title="دستهٔ مادر غیرفعال است؛ این زیرشاخه هم در سایت نمایش داده نمی‌شود"><i class="fas fa-eye-slash ml-1"></i>مادر غیرفعال</span>'
                : '<button type="button" onclick="toggleCatActive(' + c.id + ', 0)" class="badge badge-active cursor-pointer hover:ring-2 hover:ring-emerald-300" title="کلیک کنید تا غیرفعال شود (حذف نمی‌شود)"><i class="fas fa-toggle-on ml-1"></i>فعال</button>')}</td><td class="px-3 py-2"><button onclick='addSubCat(\${c.id})' class="text-green-600 ml-2" title="افزودن زیردسته"><i class="fas fa-plus-circle"></i></button><button onclick='editCat(\${attrJson(c)})' class="text-indigo-600 ml-2" title="ویرایش"><i class="fas fa-pen"></i></button><button onclick="delCat(\${c.id})" class="text-red-600" title="حذف"><i class="fas fa-trash"></i></button></td></tr>\`).join('')}</tbody></table>\`;
      }
      function parentOptions(selectedId, excludeId) {
        const byParent = {};
        CATS.forEach(c => { const k = c.parent_id || 0; (byParent[k] = byParent[k] || []).push(c); });
        const out = ['<option value="">— بدون مادر (دسته اصلی) —</option>'];
        (function walk(pid, depth) {
          (byParent[pid] || []).forEach(c => {
            if (c.id === excludeId) return; // can't be its own parent (children skipped too)
            const pad = depth ? '&nbsp;'.repeat(depth * 3) + '└ ' : '';
            out.push('<option value="' + c.id + '" ' + (selectedId === c.id ? 'selected' : '') + '>' + pad + escAdmin(c.name) + '</option>');
            walk(c.id, depth + 1);
          });
        })(0, 0);
        return out.join('');
      }
      function catForm(c = {}) {
        return \`<form id="cat-form" class="space-y-3">
          <div class="grid md:grid-cols-2 gap-3">
            <div><label class="block text-sm mb-1">نام *</label><input name="name" required value="\${escAdmin(c.name || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1">Slug *</label><input name="slug" required value="\${escAdmin(c.slug || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          </div>
          <div class="grid md:grid-cols-2 gap-3">
            <div><label class="block text-sm mb-1">دسته مادر (برای زیرشاخه)</label><select name="parent_id" class="w-full border rounded-lg px-3 py-2 text-sm">\${parentOptions(c.parent_id, c.id)}</select></div>
            <div><label class="block text-sm mb-1">ترتیب نمایش</label><input name="sort_order" type="number" value="\${c.sort_order || 0}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          </div>
          <div><label class="block text-sm mb-1">آیکون (FontAwesome)</label><input name="icon" value="\${escAdmin(c.icon || '')}" placeholder="fa-network-wired" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          \${window.ncpImageField('image', c.image || '', 'تصویر دسته‌بندی')}
          <div><label class="block text-sm mb-1">توضیح</label><input name="description" value="\${escAdmin(c.description || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          <label class="flex items-center gap-2 border rounded-xl p-3 bg-indigo-50/60 cursor-pointer text-sm">
            <input name="is_active" type="checkbox" \${c.is_active == 0 ? '' : 'checked'} class="w-4 h-4">
            <span><b>دسته فعال باشد</b><span class="block text-xs text-slate-500 mt-0.5">اگر تیک را بردارید، این دسته و زیرشاخه‌ها و محصولاتش در سایت نمایش داده نمی‌شوند — هیچ‌چیز حذف نمی‌شود و هر زمان بخواهید دوباره فعال می‌شود.</span></span>
          </label>
          <label class="flex items-center gap-2 border rounded-xl p-3 bg-emerald-50/60 cursor-pointer text-sm">
            <input name="show_in_menu" type="checkbox" \${(c.show_in_menu === undefined || c.show_in_menu === null || c.show_in_menu == 1) ? 'checked' : ''} class="w-4 h-4">
            <span><b>نمایش در منوی سایت</b><span class="block text-xs text-slate-500 mt-0.5">اگر تیک را بردارید، از منوی بالای سایت حذف می‌شود ولی اطلاعات و محصولاتش باقی می‌ماند.</span></span>
          </label>
          <div class="border rounded-xl p-3 bg-blue-50/50">
            <label class="block text-sm font-bold mb-2 text-blue-800"><i class="fas fa-magnifying-glass ml-1"></i>تنظیمات سئو (SEO)</label>
            <div class="space-y-2">
              <div><label class="block text-xs mb-1 text-slate-500">عنوان سئو</label><input name="seo_title" value="\${escAdmin(c.seo_title || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
              <div><label class="block text-xs mb-1 text-slate-500">توضیحات سئو</label><textarea name="seo_description" rows="2" class="w-full border rounded-lg px-3 py-2 text-sm">\${escAdmin(c.seo_description || '')}</textarea></div>
              <div><label class="block text-xs mb-1 text-slate-500">کلمات کلیدی</label><input name="seo_keywords" value="\${escAdmin(c.seo_keywords || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            </div>
          </div>
          <div class="flex gap-2 pt-3 border-t"><button type="submit" class="btn-indigo text-white px-5 py-2 rounded-lg text-sm">ذخیره</button><button type="button" onclick="closeModal(true)" class="px-5 py-2 bg-slate-200 rounded-lg text-sm">انصراف</button></div>
        </form>\`;
      }
      function bindCatForm(id) {
        document.getElementById('cat-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target).entries());
          data.parent_id = data.parent_id ? parseInt(data.parent_id) : null;
          data.sort_order = parseInt(data.sort_order || '0') || 0;
          data.show_in_menu = (data.show_in_menu === 'on' || data.show_in_menu === true) ? 1 : 0;
          data.is_active = (data.is_active === 'on' || data.is_active === true) ? 1 : 0;
          try {
            if (id) await axios.put('/api/admin/categories/' + id, data);
            else await axios.post('/api/admin/categories', data);
            toast('ذخیره شد', 'success'); window.ncClearDirty && window.ncClearDirty(); closeModal(true); loadCats();
          } catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); }
        });
      }
      window.newCat = () => { showModal('دسته جدید', catForm({}), { size: '2xl' }); bindCatForm(); };
      window.addSubCat = (parentId) => { showModal('زیردسته جدید', catForm({ parent_id: parentId }), { size: '2xl' }); bindCatForm(); };
      window.editCat = (c) => { showModal('ویرایش دسته', catForm(c), { size: '2xl' }); bindCatForm(c.id); };
      window.toggleCatActive = async (id, flag) => {
        try {
          const r = await axios.patch('/api/admin/categories/' + id + '/active', { is_active: flag });
          toast(r.data.message, 'success'); loadCats();
        } catch (e) { toast(e.response?.data?.message || 'خطا در تغییر وضعیت', 'error'); }
      };
      window.delCat = (id) => confirmDialog('این دسته «برای همیشه» حذف شود؟\\nاگر فقط می‌خواهید در سایت نمایش داده نشود، به‌جای حذف روی دکمهٔ «فعال» در ستون وضعیت بزنید (قابل برگشت).', async () => { try { const r = await axios.delete('/api/admin/categories/' + id); toast(r.data.message || 'حذف شد', 'success'); loadCats(); } catch (e) { toast(e.response?.data?.message || 'خطا', 'error'); } });
      // ---- Bulk price adjustment ----
      window.openBulkPrice = () => {
        showModal('تغییر گروهی قیمت بر اساس دسته', \`<form id="bulk-price-form" class="space-y-3">
          <div><label class="block text-sm mb-1">دسته‌بندی *</label><select name="category_id" required class="w-full border rounded-lg px-3 py-2 text-sm">\${parentOptions(null, -1).replace('— بدون مادر (دسته اصلی) —', 'انتخاب کنید...')}</select></div>
          <div><label class="block text-sm mb-1">درصد تغییر * <span class="text-xs text-slate-400">(مثبت = افزایش، منفی = کاهش. مثلاً 10 یا -5)</span></label><input name="percent" type="number" step="0.1" min="-90" max="500" required class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="10"></div>
          <div><label class="block text-sm mb-1">اعمال روی</label><select name="apply_to" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="both">قیمت اصلی و قیمت تخفیف</option><option value="price">فقط قیمت اصلی</option><option value="discount_price">فقط قیمت تخفیف</option></select></div>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="include_children" checked> شامل زیرشاخه‌ها هم بشود</label>
          <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700"><i class="fas fa-triangle-exclamation ml-1"></i>این عملیات قیمت همه محصولات دسته انتخابی را تغییر می‌دهد. در صورت اشتباه، از صفحهٔ «سیستم قیمتی» قابل بازگردانی است.</div>
          <div class="flex gap-2 pt-3 border-t"><button type="submit" class="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2 rounded-lg text-sm"><i class="fas fa-percent ml-1"></i>اعمال تغییر</button><button type="button" onclick="closeModal(true)" class="px-5 py-2 bg-slate-200 rounded-lg text-sm">انصراف</button></div>
        </form>\`);
        document.getElementById('bulk-price-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const payload = {
            category_id: parseInt(fd.get('category_id')),
            percent: parseFloat(fd.get('percent')),
            apply_to: fd.get('apply_to'),
            include_children: fd.get('include_children') === 'on'
          };
          if (!payload.category_id) { toast('دسته را انتخاب کنید', 'error'); return; }
          if (!window.confirm('قیمت محصولات این دسته ' + Math.abs(payload.percent) + '٪ ' + (payload.percent >= 0 ? 'افزایش' : 'کاهش') + ' یابد؟')) return;
          try {
            const r = await axios.post('/api/products/bulk-price', payload);
            toast(r.data.message + ' — برای بازگردانی به «سیستم قیمتی» بروید', 'success'); window.ncClearDirty && window.ncClearDirty(); closeModal(true); loadCats();
          } catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); }
        });
      };
      loadCats();
    </script>
  `;
    return adminLayout({ title: 'دسته‌بندی‌ها', currentPath: '/admin/categories' }, content);
}
// ===== Brands =====
export function adminBrandsPage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold">برندها</h2>
        <button onclick="newBrand()" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm"><i class="fas fa-plus ml-1"></i>برند جدید</button>
      </div>
      <div id="brands-list"></div>
    </div>
    <script>
      async function loadBrands() {
        const r = await axios.get('/api/admin/brands');
        const items = r.data.data;
        document.getElementById('brands-list').innerHTML = \`<table class="w-full text-sm"><thead class="bg-slate-50 text-xs"><tr><th class="px-3 py-3 text-right">لوگو</th><th class="px-3 py-3 text-right">نام</th><th class="px-3 py-3 text-right">Slug</th><th class="px-3 py-3 text-right">محصولات</th><th class="px-3 py-3 text-right">عملیات</th></tr></thead><tbody>\${items.map(b => \`<tr class="border-t"><td class="px-3 py-2">\${b.logo ? '<img loading="lazy" src="' + escAdmin(b.logo) + '" class="w-10 h-10 rounded object-contain bg-white border">' : '<span class="text-slate-300"><i class="fas fa-tag"></i></span>'}</td><td class="px-3 py-2 font-bold">\${escAdmin(b.name)}</td><td class="px-3 py-2 text-xs text-slate-500">\${escAdmin(b.slug)}</td><td class="px-3 py-2">\${b.product_count || 0}</td><td class="px-3 py-2"><button onclick='editBrand(\${attrJson(b)})' class="text-indigo-600 ml-2"><i class="fas fa-pen"></i></button><button onclick="delBrand(\${b.id})" class="text-red-600"><i class="fas fa-trash"></i></button></td></tr>\`).join('')}</tbody></table>\`;
      }
      function brandForm(b = {}) {
        return \`<form id="brand-form" class="space-y-3">
          <div><label class="block text-sm mb-1">نام *</label><input name="name" required value="\${escAdmin(b.name || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-sm mb-1">Slug *</label><input name="slug" required value="\${escAdmin(b.slug || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          \${window.ncpImageField('logo', b.logo || '', 'لوگوی برند')}
          <div class="flex gap-2 pt-3 border-t"><button type="submit" class="btn-indigo text-white px-5 py-2 rounded-lg text-sm">ذخیره</button><button type="button" onclick="closeModal(true)" class="px-5 py-2 bg-slate-200 rounded-lg text-sm">انصراف</button></div>
        </form>\`;
      }
      function bindBrandForm(id) {
        document.getElementById('brand-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target).entries());
          try {
            if (id) await axios.put('/api/admin/brands/' + id, data);
            else await axios.post('/api/admin/brands', data);
            toast('ذخیره شد', 'success'); closeModal(); loadBrands();
          } catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); }
        });
      }
      window.newBrand = () => { showModal('برند جدید', brandForm({})); bindBrandForm(); };
      window.editBrand = (b) => { showModal('ویرایش برند', brandForm(b)); bindBrandForm(b.id); };
      window.delBrand = (id) => confirmDialog('حذف؟', async () => { await axios.delete('/api/admin/brands/' + id); toast('حذف شد', 'success'); loadBrands(); });
      loadBrands();
    </script>
  `;
    return adminLayout({ title: 'برندها', currentPath: '/admin/brands' }, content);
}
// ===== Customers/Users =====
export function adminCustomersPage(role = 'customer') {
    const title = role === 'admin' ? 'کاربران سیستم' : 'مشتریان';
    const path = role === 'admin' ? '/admin/users' : '/admin/customers';
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5">
      <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 class="font-bold">${title} <span id="users-count" class="text-xs font-normal text-slate-400"></span></h2>
        <div class="relative w-full max-w-xs">
          <i class="fas fa-search absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
          <input id="users-search" type="search" autocomplete="off" placeholder="جستجو: نام، ایمیل، موبایل، شرکت" class="w-full border border-slate-300 rounded-lg pr-8 pl-3 py-2 text-sm">
        </div>
      </div>
      <div id="users-list"><div class="text-center py-12"><span class="spinner"></span></div></div>
    </div>
    <script>
      // Round 7 (2026-11-03): search + safe block/unblock + honest delete message
      let ALL_USERS = [];
      function normU(x) {
        return String(x || '').toLowerCase()
          .replace(/[يیئى]/g, 'ی').replace(/[كک]/g, 'ک').replace(/[آأإ]/g, 'ا').replace(/\\u200c/g, '')
          .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
          .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
          .replace(/\\s+/g, ' ').trim();
      }
      function renderUsers() {
        const q = normU(document.getElementById('users-search').value);
        const items = q ? ALL_USERS.filter(u => [u.full_name, u.email, u.phone, u.company].some(v => normU(v).includes(q))) : ALL_USERS;
        document.getElementById('users-count').textContent = '(' + (q ? formatPrice(items.length) + ' از ' : '') + formatPrice(ALL_USERS.length) + ')';
        document.getElementById('users-list').innerHTML = items.length ? \`<table class="w-full text-sm">
            <thead class="bg-slate-50 text-xs"><tr><th class="px-3 py-3 text-right">نام</th><th class="px-3 py-3 text-right">ایمیل</th><th class="px-3 py-3 text-right">موبایل</th><th class="px-3 py-3 text-right">شرکت</th><th class="px-3 py-3 text-right">تاریخ ثبت</th><th class="px-3 py-3 text-right">وضعیت</th><th class="px-3 py-3 text-right">عملیات</th></tr></thead>
            <tbody>\${items.map(u => \`<tr class="border-t\${u.status === 'blocked' ? ' bg-slate-50 opacity-70' : ''}">
              <td class="px-3 py-2 font-medium">\${escAdmin(u.full_name)}</td>
              <td class="px-3 py-2 text-xs">\${escAdmin(u.email)}</td>
              <td class="px-3 py-2 text-xs">\${escAdmin(u.phone || '-')}</td>
              <td class="px-3 py-2 text-xs">\${escAdmin(u.company || '-')}</td>
              <td class="px-3 py-2 text-xs">\${formatDate(u.created_at)}</td>
              <td class="px-3 py-2"><span class="badge badge-\${escAdmin(u.status)}">\${statusLabel(u.status, 'user')}</span></td>
              <td class="px-3 py-2 whitespace-nowrap">
                \${u.status === 'blocked'
                  ? '<button type="button" onclick="toggleUser(' + u.id + ', &#39;blocked&#39;)" class="text-emerald-600 hover:text-emerald-700 ml-2" title="رفع مسدودی (کاربر دوباره می‌تواند وارد شود)"><i class="fas fa-unlock"></i></button>'
                  : '<button type="button" onclick="toggleUser(' + u.id + ', &#39;active&#39;)" class="text-amber-600 hover:text-amber-700 ml-2" title="مسدود کردن (کاربر دیگر نمی‌تواند وارد شود)"><i class="fas fa-ban"></i></button>'}
                <button type="button" onclick="delUser(\${u.id})" class="text-red-600 hover:text-red-700" title="حذف (اگر سفارش یا تیکت داشته باشد، به‌جای حذف مسدود می‌شود)"><i class="fas fa-trash"></i></button>
              </td>
            </tr>\`).join('')}</tbody></table>\` : '<p class="text-center py-12 text-slate-400">' + (q ? 'کاربری با این مشخصات پیدا نشد' : 'کاربری نیست') + '</p>';
      }
      async function loadUsers() {
        try {
          const r = await axios.get('/api/admin/users', { params: { role: '${role}' } });
          ALL_USERS = r.data.data || [];
          renderUsers();
        } catch (e) { document.getElementById('users-list').innerHTML = '<p class="text-red-500 p-4">خطا در بارگذاری کاربران</p>'; }
      }
      document.getElementById('users-search').addEventListener('input', renderUsers);
      async function setUserStatus(id, ns) {
        try {
          const r = await axios.put('/api/admin/users/' + id + '/status', { status: ns });
          toast(r.data.message || 'وضعیت تغییر کرد', 'success');
        } catch (e) { toast(e.response?.data?.message || 'خطا در تغییر وضعیت', 'error'); }
        loadUsers();
      }
      window.toggleUser = (id, cur) => {
        const ns = cur === 'active' ? 'blocked' : 'active';
        if (ns === 'blocked') confirmDialog('این کاربر مسدود شود؟ (دیگر نمی‌تواند وارد حساب شود؛ هر زمان بخواهید می‌توانید رفع مسدودی کنید)', () => setUserStatus(id, ns));
        else setUserStatus(id, ns);
      };
      window.delUser = (id) => confirmDialog('این کاربر حذف شود؟ (اگر سفارش یا تیکت داشته باشد، برای حفظ سوابق به‌جای حذف مسدود می‌شود)', async () => {
        try { const r = await axios.delete('/api/admin/users/' + id); toast(r.data.message || 'حذف شد', 'success'); loadUsers(); }
        catch (e) { toast(e.response?.data?.message || 'خطا', 'error'); }
      });
      loadUsers();
    </script>
  `;
    return adminLayout({ title, currentPath: path }, content);
}
// ===== Messages =====
export function adminMessagesPage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h2 class="font-bold mb-4">پیام‌های تماس</h2>
      <div id="msg-list"></div>
    </div>
    <script>
      async function loadMsgs() {
        const r = await axios.get('/api/admin/messages');
        const items = r.data.data;
        document.getElementById('msg-list').innerHTML = items.length ? items.map(m => \`<div class="border rounded-lg p-4 mb-3 \${m.status === 'unread' ? 'border-r-4 border-r-indigo-500 bg-indigo-50/40' : ''}">
          <div class="flex justify-between mb-2">
            <div><b>\${escAdmin(m.name)}</b> <span class="text-xs text-slate-500">\${escAdmin(m.email || '')} \${m.phone ? '• ' + escAdmin(m.phone) : ''}</span></div>
            <span class="badge badge-\${m.status}">\${statusLabel(m.status, 'message')}</span>
          </div>
          <div class="text-xs text-slate-400 mb-2">\${formatDate(m.created_at)} \${m.subject ? '• ' + escAdmin(m.subject) : ''}</div>
          <p class="text-sm text-slate-700 mb-3">\${escAdmin(m.body)}</p>
          <div class="flex gap-2">
            \${m.status === 'unread' ? \`<button onclick="markRead(\${m.id})" class="bg-indigo-500 text-white px-3 py-1.5 rounded-lg text-xs"><i class="fas fa-check ml-1"></i>خوانده شد</button>\` : ''}
            <button onclick="delMsg(\${m.id})" class="bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs"><i class="fas fa-trash ml-1"></i>حذف</button>
          </div>
        </div>\`).join('') : '<p class="text-center py-12 text-slate-400">پیامی نیست</p>';
      }
      window.markRead = async (id) => {
        try { await axios.put('/api/admin/messages/' + id + '/read'); }
        catch (e) { toast(e.response?.data?.message || 'خطا در علامت‌گذاری', 'error'); }
        loadMsgs();
      };
      window.delMsg = (id) => confirmDialog('این پیام برای همیشه حذف شود؟', async () => {
        try { await axios.delete('/api/admin/messages/' + id); toast('پیام حذف شد', 'success'); }
        catch (e) { toast(e.response?.data?.message || 'خطا در حذف پیام', 'error'); }
        loadMsgs();
      });
      loadMsgs();
    </script>
  `;
    return adminLayout({ title: 'پیام‌ها', currentPath: '/admin/messages' }, content);
}
// ===== Newsletter =====
export function adminNewsletterPage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h2 class="font-bold mb-4">مشترکان خبرنامه</h2>
      <div id="ns-list"></div>
    </div>
    <script>
      async function loadNS() {
        const r = await axios.get('/api/admin/newsletter');
        const items = r.data.data;
        document.getElementById('ns-list').innerHTML = items.length ? \`<table class="w-full text-sm"><thead class="bg-slate-50 text-xs"><tr><th class="px-3 py-3 text-right">ایمیل</th><th class="px-3 py-3 text-right">تاریخ</th><th class="px-3 py-3 text-right">عملیات</th></tr></thead><tbody>\${items.map(s => \`<tr class="border-t"><td class="px-3 py-2">\${escAdmin(s.email)}</td><td class="px-3 py-2 text-xs">\${formatDate(s.created_at)}</td><td class="px-3 py-2"><button onclick="delNS(\${s.id})" class="text-red-600"><i class="fas fa-trash"></i></button></td></tr>\`).join('')}</tbody></table>\` : '<p class="text-center py-12 text-slate-400">مشترکی نیست</p>';
      }
      window.delNS = (id) => confirmDialog('این مشترک از خبرنامه حذف شود؟', async () => {
        try { await axios.delete('/api/admin/newsletter/' + id); toast('مشترک حذف شد', 'success'); }
        catch (e) { toast(e.response?.data?.message || 'خطا در حذف', 'error'); }
        loadNS();
      });
      loadNS();
    </script>
  `;
    return adminLayout({ title: 'خبرنامه', currentPath: '/admin/newsletter' }, content);
}
// ===== Activity Logs =====
export function adminActivityLogsPage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h2 class="font-bold mb-4">گزارش فعالیت‌ها</h2>
      <div id="logs-list"><div class="text-center py-12"><span class="spinner"></span></div></div>
    </div>
    <script>
      // R3-B: human-readable Persian labels (unknown codes fall back to the raw code)
      const ACT_FA = { create: 'ایجاد', update: 'ویرایش', delete: 'حذف', login: 'ورود', logout: 'خروج', register: 'ثبت‌نام',
        update_status: 'تغییر وضعیت', update_payment: 'تغییر وضعیت پرداخت', payment_receipt: 'رسید پرداخت', reply: 'پاسخ',
        reorder: 'تغییر ترتیب', upload: 'آپلود', upsert: 'ذخیره', block: 'مسدودسازی', archive: 'بایگانی',
        set_password: 'تعیین رمز', change_password: 'تغییر رمز', import: 'ورود گروهی (Import)', export: 'خروجی (Export)',
        activate: 'فعال‌سازی', deactivate: 'غیرفعال‌سازی', bulk_activate: 'فعال‌سازی گروهی', bulk_deactivate: 'غیرفعال‌سازی گروهی',
        bulk_price: 'تغییر قیمت گروهی', bulk_price_undo: 'بازگردانی قیمت گروهی', bulk_delete: 'حذف گروهی', duplicate: 'کپی' };
      const ENT_FA = { product: 'محصول', category: 'دسته‌بندی', brand: 'برند', order: 'سفارش', user: 'کاربر', post: 'مقاله',
        comment: 'دیدگاه', ticket: 'تیکت', message: 'پیام', newsletter: 'خبرنامه', settings: 'تنظیمات', image: 'تصویر',
        profile: 'پروفایل', otp: 'کد تایید', home_page: 'صفحهٔ اصلی', site_page: 'صفحهٔ سایت', site_block: 'بلوک سایت' };
      const ACT_CLS = { delete: 'badge-blocked', bulk_delete: 'badge-blocked', deactivate: 'badge-inactive', bulk_deactivate: 'badge-inactive' };
      function logDetails(l) {
        let d = null; try { d = l.details ? JSON.parse(l.details) : null; } catch (e) { return ''; }
        if (!d || typeof d !== 'object') return '';
        const parts = [];
        if (d.name) parts.push(String(d.name));
        if (d.summary) parts.push(String(d.summary));
        if (d.count != null) parts.push(formatPrice(d.count) + ' مورد');
        else if (d.changed != null) parts.push(formatPrice(d.changed) + ' محصول');
        if (d.restored != null) parts.push(formatPrice(d.restored) + ' برگشت');
        return parts.join(' — ').slice(0, 120);
      }
      // R4-B: pagination (API already supports ?page=&limit=)
      let LOG_PAGE = 1; const LOG_LIMIT = 50;
      window.logsGo = (p) => { LOG_PAGE = Math.max(1, p); loadLogs(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
      async function loadLogs() {
        let r;
        try { r = await axios.get('/api/admin/activity-logs', { params: { page: LOG_PAGE, limit: LOG_LIMIT } }); }
        catch (e) { document.getElementById('logs-list').innerHTML = '<p class="text-red-500 p-4">خطا در بارگذاری گزارش</p>'; return; }
        const items = r.data.data.items;
        const pages = Math.max(1, Math.ceil((Number(r.data.data.total) || 0) / LOG_LIMIT));
        if (LOG_PAGE > pages && pages >= 1 && items.length === 0 && LOG_PAGE !== 1) { LOG_PAGE = pages; return loadLogs(); }
        const nav = pages > 1 ? '<div class="flex items-center justify-center gap-2 mt-4 text-sm">' +
          '<button type="button" onclick="logsGo(' + (LOG_PAGE - 1) + ')" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50"' + (LOG_PAGE <= 1 ? ' disabled' : '') + '><i class="fas fa-chevron-right ml-1"></i>جدیدتر</button>' +
          '<span class="text-slate-500">صفحهٔ ' + formatPrice(LOG_PAGE) + ' از ' + formatPrice(pages) + ' <span class="text-xs">(' + formatPrice(r.data.data.total) + ' رویداد)</span></span>' +
          '<button type="button" onclick="logsGo(' + (LOG_PAGE + 1) + ')" class="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50"' + (LOG_PAGE >= pages ? ' disabled' : '') + '>قدیمی‌تر<i class="fas fa-chevron-left mr-1"></i></button>' +
          '</div>' : '';
        document.getElementById('logs-list').innerHTML = items.length ? \`<table class="w-full text-sm">
          <thead class="bg-slate-50 text-xs"><tr><th class="px-3 py-3 text-right">کاربر</th><th class="px-3 py-3 text-right">عمل</th><th class="px-3 py-3 text-right">موجودیت</th><th class="px-3 py-3 text-right">شناسه</th><th class="px-3 py-3 text-right">IP</th><th class="px-3 py-3 text-right">تاریخ</th></tr></thead>
          <tbody>\${items.map(l => \`<tr class="border-t">
            <td class="px-3 py-2">\${escAdmin(l.user_name || 'سیستم')}</td>
            <td class="px-3 py-2"><span class="badge \${ACT_CLS[l.action] || 'badge-active'}" title="\${escAdmin(l.action)}">\${escAdmin(ACT_FA[l.action] || l.action)}</span></td>
            <td class="px-3 py-2 text-xs">\${escAdmin(ENT_FA[l.entity_type] || l.entity_type || '-')}\${logDetails(l) ? '<div class="text-[11px] text-slate-400 mt-0.5">' + escAdmin(logDetails(l)) + '</div>' : ''}</td>
            <td class="px-3 py-2 text-xs">\${l.entity_id || '-'}</td>
            <td class="px-3 py-2 text-xs">\${escAdmin(l.ip_address || '-')}</td>
            <td class="px-3 py-2 text-xs">\${formatDate(l.created_at)}</td>
          </tr>\`).join('')}</tbody></table>\` + nav : '<p class="text-center py-12 text-slate-400">لاگی نیست</p>' + nav;
      }
      loadLogs();
    </script>
  `;
    return adminLayout({ title: 'گزارش فعالیت‌ها', currentPath: '/admin/activity-logs' }, content);
}
// ===== Reports =====
export function adminReportsPage() {
    const content = `
    <div id="reports-stats" class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6"></div>
    <div class="grid lg:grid-cols-2 gap-6">
      <div class="bg-white rounded-xl shadow-sm p-5"><h3 class="font-bold mb-4">سفارش‌ها بر اساس وضعیت</h3><canvas id="ordersChart"></canvas></div>
      <div class="bg-white rounded-xl shadow-sm p-5"><h3 class="font-bold mb-4">محصولات کم‌موجود</h3><div id="low-stock"></div></div>
    </div>
    <script>
      async function loadReports() {
        // Skip when unauthenticated (admin guard redirects to login).
        if (!(localStorage.getItem('admin_token') || localStorage.getItem('ncp_token'))) return;
        const r = await axios.get('/api/admin/dashboard');
        const d = r.data.data;
        document.getElementById('reports-stats').innerHTML = [
          { l:'تعداد سفارش‌ها', v:d.orders_total },
          { l:'درآمد کل', v:formatPrice(d.orders_revenue) + ' تومان' },
          { l:'محصولات', v:d.products },
          { l:'مشتریان', v:d.customers }
        ].map(s => \`<div class="stat-card"><div class="text-xs text-slate-500">\${s.l}</div><div class="text-xl font-bold mt-1">\${s.v}</div></div>\`).join('');

        const orders = await axios.get('/api/orders', { params: { limit: 200 } });
        const list = orders.data.data.items;
        const counts = { pending:0, confirmed:0, shipping:0, delivered:0, cancelled:0 };
        list.forEach(o => counts[o.status] = (counts[o.status] || 0) + 1);
        // Chart.js is loaded deferred; wait for it before drawing (chartReady from layout bootstrap).
        (window.chartReady || function(cb){cb();})(function () {
          try {
            new Chart(document.getElementById('ordersChart'), {
              type: 'doughnut',
              data: { labels: ['در انتظار','تایید شده','در حال ارسال','تحویل شده','لغو شده'], datasets: [{ data: Object.values(counts), backgroundColor: ['#f59e0b','#3b82f6','#a855f7','#10b981','#ef4444'] }] },
              options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
            });
          } catch (e) { console.error('chart error', e); }
        });

        const prods = await axios.get('/api/products/admin/list', { params: { status: 'active' } });
        const low = prods.data.data.items.filter(p => p.stock < 5).slice(0, 8);
        document.getElementById('low-stock').innerHTML = low.length ? low.map(p => \`<div class="flex justify-between border-b py-2 text-sm"><span>\${escAdmin(p.name)}</span><span class="\${p.stock === 0 ? 'text-red-600' : 'text-amber-600'}">موجودی: \${p.stock}</span></div>\`).join('') : '<p class="text-slate-400 text-center py-6">همه محصولات موجود</p>';
      }
      loadReports();
    </script>
  `;
    return adminLayout({ title: 'گزارش‌ها', currentPath: '/admin/reports' }, content);
}
// ===== Settings =====
export function adminSettingsPage() {
    // Channel editor is generated from CHANNEL_DEFS so the storefront and the admin
    // panel can never drift apart: add a channel there, it shows up here for free.
    const channelMeta = CHANNEL_DEFS.map(d => ({
        key: d.key,
        setting: d.setting,
        fallback: d.fallback || '',
        label: d.label,
        adminLabel: d.adminLabel,
        icon: d.icon,
        hint: d.type === 'tel' ? 'مثال: 02112345678 یا 09121234567'
            : d.type === 'wa' ? 'شماره یا لینک کامل — مثال: 09121234567'
            : d.type === 'tg' ? 'آیدی بدون @ یا لینک کامل — مثال: radis'
            : d.type === 'eitaa' ? 'آیدی بدون @ یا لینک کامل — مثال: radis'
            : d.type === 'mail' ? 'مثال: sales@example.com'
            : d.type === 'ig' ? 'آیدی بدون @ یا لینک کامل' : ''
    }));
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5">
      <h2 class="font-bold mb-4">تنظیمات سایت</h2>
      <form id="settings-form" class="space-y-4">
        <div id="settings-fields" class="grid md:grid-cols-2 gap-4"><div class="col-span-2 text-center py-12"><span class="spinner"></span></div></div>
        <button type="submit" class="btn-indigo text-white px-6 py-2.5 rounded-lg"><i class="fas fa-save ml-2"></i>ذخیره تنظیمات</button>
      </form>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5 mt-5 border border-emerald-100" id="torob-tools">
      <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 class="font-bold text-slate-800"><i class="fas fa-tags ml-1 text-emerald-600"></i>بررسی سلامت اتصال به ترب (Torob Diagnostics)</h2>
        <button type="button" id="torob-check-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm"><i class="fas fa-stethoscope ml-1"></i>اجرای تست سلامت ترب</button>
      </div>
      <p class="text-xs text-slate-500 mb-3 leading-6">وضعیت متاتگ‌های <code>product_id</code>، قیمت‌ها، موجودی، سلامت فایل تصاویر محصولات و آدرس وب‌سرویس <code>Product API v3</code> را در لحظه بررسی می‌کند.</p>
      <div id="torob-diag-out" class="text-xs leading-6 text-slate-600"></div>
    </div>
    <div class=\"bg-white rounded-xl shadow-sm p-5 mt-5\" id=\"sms-tools\">
      <h2 class=\"font-bold mb-1\"><i class=\"fas fa-sms ml-1 text-indigo-600\"></i>ابزارهای سرویس پیامک</h2>
      <p class=\"text-xs text-slate-500 mb-4 leading-6\">ابتدا تنظیمات بالا را ذخیره کنید، سپس اتصال را آزمایش کنید.</p>
      <div class=\"flex flex-wrap gap-2 items-center mb-3\">
        <input id=\"sms-test-phone\" dir=\"ltr\" placeholder=\"09123456789\" class=\"border rounded-lg px-3 py-2 text-sm w-48\">
        <button type=\"button\" id=\"sms-test-btn\" class=\"btn-indigo text-white px-4 py-2 rounded-lg text-sm\"><i class=\"fas fa-paper-plane ml-1\"></i>ارسال پیامک آزمایشی</button>
        <button type=\"button\" id=\"sms-credit-btn\" class=\"border px-4 py-2 rounded-lg text-sm\"><i class=\"fas fa-wallet ml-1\"></i>مشاهده اعتبار</button>
        <button type=\"button\" id=\"sms-logs-btn\" class=\"border px-4 py-2 rounded-lg text-sm\"><i class=\"fas fa-list ml-1\"></i>گزارش آخرین ارسال‌ها</button>
      </div>
      <div id=\"sms-out\" class=\"text-sm leading-7\"></div>
    </div>
    <script>
      const CHANNELS = ${adminJson(channelMeta)};
      const FIELDS = [
        { k:'site_logo', l:'لوگوی سایت (در هدر نمایش داده می‌شود)', image: true },
        { k:'logo_height', l:'ارتفاع لوگو در دسکتاپ (پیکسل، پیش‌فرض ۶۴)', ph:'64' },
        { k:'logo_height_mobile', l:'ارتفاع لوگو در موبایل (پیکسل، پیش‌فرض ۴۴)', ph:'44' },
        { k:'logo_offset_y', l:'جابه‌جایی عمودی لوگو (پیکسل؛ منفی = بالاتر، پیش‌فرض ۰)', ph:'0' },
        { k:'site_name', l:'نام سایت' },
        { k:'site_url', l:'آدرس عمومی دامنه سایت (الزامی برای ترب و سئو — بدون / انتهایی)', ph:'https://radys.ir' },
        { k:'site_tagline', l:'شعار سایت (زیر لوگو)' },
        { k:'site_description', l:'توضیح سایت', textarea: true },
        { k:'phone', l:'تلفن ثابت' },
        { k:'mobile', l:'تلفن همراه' },
        { k:'email', l:'ایمیل' },
        { k:'address', l:'آدرس', textarea: true },
        { k:'footer_about', l:'متن معرفی فوتر', textarea: true },
        { k:'shipping_cost', l:'هزینه ارسال (تومان)' },
        { k:'og_image', l:'تصویر OG (لینک تصویر اشتراک‌گذاری)' },
        { sec:'راه‌های ارتباطی و دکمه‌های تماس', icon:'fa-comments', help:'این‌ها همان دکمه‌هایی هستند که در نوار بالای سایت، منوی موبایل، فوتر و صفحه محصول دیده می‌شوند. هر کدام را خالی بگذارید، آن دکمه اصلاً نمایش داده نمی‌شود.' },
        ...CHANNELS.map(ch => ({ chan: ch })),
        { k:'chan_primary', l:'دکمه اصلی «گفتگو با کارشناسان» از کدام راه باشد؟', select: CHANNELS.map(c => c.key), selectLabels: CHANNELS.map(c => c.label) },
        { k:'chan_expert_label', l:'عنوان دکمه اصلی', ph:'گفتگو با کارشناسان' },
        { k:'chan_expert_note', l:'یادداشت زیر دکمه‌های تماس (اختیاری)', textarea:true, ph:'مثلاً: پاسخگویی شنبه تا چهارشنبه ۹ تا ۱۷' },
        { sec:'نماد اعتماد الکترونیکی (اینماد)', icon:'fa-shield-halved', help:'لینک صفحهٔ نماد خود را از پنل اینماد کپی و اینجا بگذارید. نشان اینماد در فوتر سایت نمایش داده می‌شود و با کلیک روی آن، بازدیدکننده به همین لینک (صفحهٔ تأیید اینماد) می‌رود. اگر فیلد را خالی کنید، نشان از فوتر حذف می‌شود.' },
        { k:'enamad_url', l:'لینک اینماد', ph:'https://trustseal.enamad.ir/?id=...&Code=...' },
        { sec:'اتصال به ترب (Torob) و موتورهای مقایسه قیمت', icon:'fa-tags', help:'متاتگ‌های رسمی ترب (product_id، product_name، product_price، product_old_price، availability، guarantee و og:image مطلق) به‌صورت خودکار در تمام صفحات محصول درج می‌شوند. همچنین وب‌سرویس رسمی Product API v3 ترب در آدرس /torob_api/v3/products آماده است.' },
        { k:'torob_require_jwt', l:'بررسی امنیتی توکن رسمی ترب (X-Torob-Token) روی API نسخه ۳', select:['فعال','غیرفعال'] },
        { sec:'سرویس پیامک (کاوه‌نگار)', icon:'fa-sms', help:'پس از خرید سرویس از کاوه‌نگار، کلید API را از پنل کاوه‌نگار (بخش «تنظیمات حساب ← API») کپی و اینجا وارد کنید. تا وقتی «غیرفعال» باشد، ورود با موبایل در حالت آزمایشی (کد ثابت) کار می‌کند و پیامکی ارسال نمی‌شود. اگر نام قالب (Template) را وارد کنید پیام با متد «تایید/Lookup» و در غیر این صورت به‌صورت متن ساده از شماره خط ارسال می‌شود.' },
        { k:'sms_enabled', l:'سرویس پیامک فعال باشد؟', select:['فعال','غیرفعال'] },
        { k:'sms_api_key', l:'کلید API کاوه‌نگار', ph:'API Key' },
        { k:'sms_sender', l:'شماره خط ارسال‌کننده (برای پیام‌های متنی)', ph:'مثلاً 10008663' },
        { k:'sms_otp_template', l:'نام قالب کد ورود (اختیاری — token = کد تایید)', ph:'مثلاً verify' },
        { k:'sms_order_new_enabled', l:'ارسال پیامک ثبت سفارش به مشتری؟', select:['فعال','غیرفعال'] },
        { k:'sms_order_new_template', l:'نام قالب ثبت سفارش (اختیاری — token = شماره سفارش، token2 = مبلغ)', ph:'مثلاً order-new' },
        { k:'sms_order_new_text', l:'متن پیامک ثبت سفارش (در صورت نبود قالب)  — متغیرها: {name} {order_number} {total} {shop}', textarea:true, ph:'{name} عزیز، سفارش {order_number} با مبلغ {total} تومان در {shop} ثبت شد.' },
        { k:'sms_order_admin_enabled', l:'اطلاع‌رسانی سفارش جدید به مدیر فروشگاه؟', select:['فعال','غیرفعال'] },
        { k:'sms_admin_phone', l:'شماره موبایل مدیر (برای اطلاع سفارش جدید)', ph:'09123456789' },
        { k:'sms_order_admin_text', l:'متن پیامک مدیر', textarea:true, ph:'سفارش جدید {order_number} از {name} به مبلغ {total} تومان ثبت شد.' },
        { k:'sms_status_enabled', l:'ارسال پیامک تغییر وضعیت سفارش / پرداخت به مشتری؟', select:['فعال','غیرفعال'] },
        { k:'sms_status_template', l:'نام قالب تغییر وضعیت (اختیاری — token = شماره سفارش، token2 = وضعیت)', ph:'مثلاً order-status' },
        { k:'sms_status_text', l:'متن پیامک تغییر وضعیت (در صورت نبود قالب) — متغیرها: {name} {order_number} {status} {shop}', textarea:true, ph:'{name} عزیز، وضعیت سفارش {order_number}: {status} ({shop})' },
        { sec:'مالیات بر ارزش افزوده', icon:'fa-percent', help:'مالیات فقط در مرحله پرداخت (پیش‌فاکتور نهایی و درگاه) به مبلغ سفارش اضافه می‌شود و در حین خرید نمایش داده نمی‌شود. زیر توضیحات هر محصول هم یک جمله کوچک درباره مالیات درج می‌شود. اگر برای محصولی «درصد مالیات» جداگانه ثبت کنید، همان جایگزین درصد سراسری می‌شود.' },
        { k:'tax_enabled', l:'مالیات فعال باشد؟', select:['فعال','غیرفعال'] },
        { k:'tax_percent', l:'درصد مالیات سراسری (مثلاً 9)', ph:'9' },
        { sec:'تنظیمات پرداخت — کارت به کارت', icon:'fa-credit-card' },
        { k:'pay_card_enabled', l:'کارت به کارت فعال باشد؟', select:['فعال','غیرفعال'] },
        { k:'pay_card_number', l:'شماره کارت (۱۶ رقمی)' },
        { k:'pay_card_holder', l:'نام صاحب کارت' },
        { k:'pay_card_bank', l:'نام بانک' },
        { sec:'تنظیمات پرداخت — درگاه آنلاین' },
        { k:'pay_gateway_enabled', l:'درگاه پرداخت آنلاین فعال باشد؟', select:['فعال','غیرفعال'] },
        { k:'pay_gateway_name', l:'نام درگاه (مثلاً زرین‌پال)' },
        { k:'pay_gateway_merchant', l:'کد مرچنت / پذیرنده درگاه' },
        { k:'pay_gateway_desc', l:'توضیح پرداخت (به مشتری در سبد خرید نمایش داده می‌شود)', textarea: true }
      ];
      async function loadSettings() {
        const r = await axios.get('/api/admin/settings');
        const v = r.data.data;
        document.getElementById('settings-fields').innerHTML = FIELDS.map(f => {
          if (f.sec) return \`<div class="md:col-span-2 pt-4 mt-1 border-t">
            <h3 class="font-bold text-sm text-indigo-700"><i class="fas \${f.icon || 'fa-credit-card'} ml-1"></i>\${f.sec}</h3>
            \${f.help ? \`<p class="text-xs text-slate-500 mt-1 leading-6">\${f.help}</p>\` : ''}
          </div>\`;
          if (f.chan) return channelCard(f.chan, v);
          if (f.select) {
            const labels = f.selectLabels || f.select;
            const cur = v[f.k] || f.select[f.select.length > 2 ? 0 : 1];
            return \`<div><label class="block text-sm mb-1">\${f.l}</label><select name="\${f.k}" class="w-full border rounded-lg px-3 py-2 text-sm bg-white">\${f.select.map((o, i) => \`<option value="\${escAdmin(o)}" \${cur === o ? 'selected' : ''}>\${escAdmin(labels[i])}</option>\`).join('')}</select></div>\`;
          }
          if (f.image) return \`<div class="md:col-span-2">\${window.ncpImageField(f.k, v[f.k] || '', f.l)}</div>\`;
          const ph = f.ph ? ' placeholder="' + escAdmin(f.ph) + '"' : '';
          return \`<div class="\${f.textarea ? 'md:col-span-2' : ''}">
          <label class="block text-sm mb-1">\${f.l}</label>
          \${f.textarea ? \`<textarea name="\${f.k}" rows="2"\${ph} class="w-full border rounded-lg px-3 py-2 text-sm">\${escAdmin(v[f.k] || '')}</textarea>\` : \`<input name="\${f.k}" value="\${escAdmin(v[f.k] || '')}"\${ph} class="w-full border rounded-lg px-3 py-2 text-sm">\`}
        </div>\`;
        }).join('');
        if (window.bindImageFields) window.bindImageFields();
        bindChannelPreview();
      }
      // A compact editor card per contact channel: value + custom label + show/hide.
      function channelCard(ch, v) {
        const val = v[ch.setting] || (ch.fallback ? (v[ch.fallback] || '') : '');
        const hidden = String(v['chan_' + ch.key + '_off'] || '') === '1';
        return \`
        <div class="md:col-span-2 border rounded-xl p-3 bg-slate-50/70 \${hidden ? 'opacity-60' : ''}" data-chan="\${ch.key}">
          <div class="flex items-center gap-2 mb-2 flex-wrap">
            <i class="\${ch.icon} text-indigo-600 w-5 text-center"></i>
            <b class="text-sm">\${escAdmin(ch.label)}</b>
            <span class="text-[11px] text-slate-400 chan-state">\${hidden ? 'مخفی' : (val ? 'نمایش داده می‌شود' : 'خالی — نمایش داده نمی‌شود')}</span>
            <label class="mr-auto text-xs flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
              <input type="checkbox" class="chan-off accent-indigo-600" data-key="\${ch.key}" \${hidden ? 'checked' : ''}>
              <span>این دکمه مخفی باشد</span>
            </label>
          </div>
          <div class="grid md:grid-cols-2 gap-3">
            <div>
              <label class="block text-xs mb-1 text-slate-500">\${escAdmin(ch.adminLabel)}</label>
              <input name="\${ch.setting}" value="\${escAdmin(val)}" dir="ltr" placeholder="\${escAdmin(ch.hint)}" class="chan-val w-full border rounded-lg px-3 py-2 text-sm">
            </div>
            <div>
              <label class="block text-xs mb-1 text-slate-500">عنوان دلخواه دکمه (اختیاری)</label>
              <input name="chan_\${ch.key}_label" value="\${escAdmin(v['chan_' + ch.key + '_label'] || '')}" placeholder="\${escAdmin(ch.label)}" class="w-full border rounded-lg px-3 py-2 text-sm">
            </div>
          </div>
        </div>\`;
      }

      function bindChannelPreview() {
        document.querySelectorAll('[data-chan]').forEach(card => {
          const cb = card.querySelector('.chan-off');
          const val = card.querySelector('.chan-val');
          const st = card.querySelector('.chan-state');
          const sync = () => {
            const hidden = cb.checked;
            card.classList.toggle('opacity-60', hidden);
            st.textContent = hidden ? 'مخفی' : (val.value.trim() ? 'نمایش داده می‌شود' : 'خالی — نمایش داده نمی‌شود');
          };
          cb.addEventListener('change', sync);
          val.addEventListener('input', sync);
        });
      }

      document.getElementById('settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target).entries());
        // Unchecked checkboxes are absent from FormData, so send every chan_*_off
        // explicitly — otherwise un-hiding a channel would silently do nothing.
        CHANNELS.forEach(ch => {
          const cb = document.querySelector('.chan-off[data-key="' + ch.key + '"]');
          data['chan_' + ch.key + '_off'] = (cb && cb.checked) ? '1' : '';
        });
        const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
        const orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>';
        try { await axios.put('/api/admin/settings', data); toast('تنظیمات ذخیره شد', 'success'); }
        catch (err) { toast(err.response?.data?.message || 'خطا در ذخیره تنظیمات', 'error'); }
        finally { btn.disabled = false; btn.innerHTML = orig; }
      });
      loadSettings();
      (function () {
        const box = document.getElementById('torob-diag-out');
        const btn = document.getElementById('torob-check-btn');
        if (!box || !btn) return;
        async function runDiag() {
          box.innerHTML = '<span class="text-slate-400">در حال بررسی محصولات و متاتگ‌های ترب...</span>';
          try {
            const r = await axios.get('/api/torob/v3/admin/diagnostics');
            const d = r.data.data;
            let html = '<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">'
              + '<div class="p-3 rounded-lg bg-slate-50 border"><div class="text-slate-400">کل محصولات فعال</div><b class="text-base text-slate-800">' + formatPrice(d.totalActive) + '</b></div>'
              + '<div class="p-3 rounded-lg bg-emerald-50 border border-emerald-200"><div class="text-emerald-700">آماده و موجود در ترب</div><b class="text-base text-emerald-700">' + formatPrice(d.readyInStock) + '</b></div>'
              + '<div class="p-3 rounded-lg bg-amber-50 border border-amber-200"><div class="text-amber-700">ناموجود / استعلامی</div><b class="text-base text-amber-700">' + formatPrice(d.outOfStock) + '</b></div>'
              + '<div class="p-3 rounded-lg bg-indigo-50 border border-indigo-200"><div class="text-indigo-700">تصویر جایگزین خودکار</div><b class="text-base text-indigo-700">' + formatPrice(d.missingImageFallbackUsed) + '</b></div>'
              + '</div>';
            html += '<div class="p-3 rounded-lg bg-slate-50 border mb-3 space-y-1"><div><b>دامنه کانونیکال فعلی:</b> <code dir="ltr" class="text-indigo-700">' + escAdmin(d.baseUrl) + '</code></div>'
              + '<div><b>آدرس API نسخه ۳ ترب (اختصاصی):</b> <code dir="ltr" class="text-emerald-700 select-all">' + escAdmin(d.torobApiEndpoint) + '</code></div>'
              + '<div><b>آدرس سازگار افزونه ووکامرس ترب:</b> <code dir="ltr" class="text-sky-700 select-all">' + escAdmin(d.baseUrl + '/wp-json/wcpe/v1/products') + '</code></div>'
              + '<div><b>نقشه سایت (Sitemap):</b> <code dir="ltr" class="text-slate-700 select-all">' + escAdmin(d.baseUrl + '/sitemap.xml') + '</code></div></div>';
            if (d.sampleProduct) {
              const sp = d.sampleProduct;
              html += '<div class="p-3 rounded-lg bg-slate-900 text-emerald-300 font-mono text-[11px] overflow-x-auto mb-3" dir="ltr">'
                + escAdmin('<meta name="product_id" content="' + sp.productId + '">') + '<br>'
                + escAdmin('<meta name="product_name" content="' + sp.name + '">') + '<br>'
                + escAdmin('<meta name="product_price" content="' + sp.currentPriceToman + '">') + '<br>'
                + escAdmin('<meta name="product_old_price" content="' + sp.oldPriceToman + '">') + '<br>'
                + escAdmin('<meta name="availability" content="' + sp.availabilityMeta + '">') + '<br>'
                + escAdmin('<meta property="og:image" content="' + sp.mainImageAbs + '">')
                + '</div>';
            }
            if (d.recentLogs && d.recentLogs.length) {
              html += '<details class="border rounded-lg p-2.5 bg-emerald-50/40 mb-2"><summary class="cursor-pointer font-bold text-emerald-800">آخرین مراجعات ربات و وب‌سرویس ترب (' + formatPrice(d.recentLogs.length) + ' درخواست ثبت‌شده)</summary><ul class="mt-2 space-y-1 max-h-44 overflow-y-auto pr-3 list-disc text-[11px]">'
                + d.recentLogs.map(lg => '<li><code dir="ltr">' + escAdmin((lg.time || '').replace('T', ' ').slice(0, 19)) + '</code> — <b>' + escAdmin(lg.mode) + '</b> (HTTP ' + escAdmin(lg.status) + ')' + (lg.slug ? ' — <code>' + escAdmin(lg.slug) + '</code>' : '') + (lg.count !== undefined ? ' — تعداد: ' + lg.count : '') + (lg.error ? ' — <span class="text-rose-600">' + escAdmin(lg.error) + '</span>' : '') + '</li>').join('')
                + '</ul></details>';
            }
            if (d.issues && d.issues.length) {
              html += '<details class="border rounded-lg p-2.5 bg-amber-50/50"><summary class="cursor-pointer font-bold text-amber-800">مشاهده هشدارهای داده محصولات (' + formatPrice(d.issues.length) + ' مورد — نیاز به آپلود مجدد عکس یا اصلاح قیمت)</summary><ul class="mt-2 space-y-1 max-h-56 overflow-y-auto pr-3 list-disc">'
                + d.issues.map(it => '<li><b>#' + it.id + ' ' + escAdmin(it.name) + ':</b> ' + escAdmin(it.msg) + ' <a href="/product/' + encodeURIComponent(it.slug) + '" target="_blank" class="text-indigo-600 underline">[مشاهده صفحه]</a></li>').join('')
                + '</ul></details>';
            }
            box.innerHTML = html;
          } catch (e) {
            box.innerHTML = '<span class="text-rose-600">خطا در دریافت وضعیت سلامت ترب</span>';
          }
        }
        btn.addEventListener('click', runDiag);
        runDiag();
      })();
      (function () {
        const out = document.getElementById('sms-out');
        function show(msg, ok) { out.className = 'text-sm leading-7 ' + (ok ? 'text-emerald-700' : 'text-rose-600'); out.textContent = msg; }
        document.getElementById('sms-test-btn').addEventListener('click', async function () {
          const phone = document.getElementById('sms-test-phone').value;
          show('در حال ارسال...', true);
          try { const r = await axios.post('/api/admin/sms/test', { phone: phone }); show(r.data.message, true); }
          catch (err) { show((err.response && err.response.data && err.response.data.message) || 'خطا در ارسال', false); }
        });
        document.getElementById('sms-credit-btn').addEventListener('click', async function () {
          show('در حال دریافت...', true);
          try { const r = await axios.get('/api/admin/sms/credit'); show('اعتبار باقی‌مانده: ' + r.data.data.remaincredit, true); }
          catch (err) { show((err.response && err.response.data && err.response.data.message) || 'خطا', false); }
        });
        document.getElementById('sms-logs-btn').addEventListener('click', async function () {
          try {
            const r = await axios.get('/api/admin/sms/logs');
            const rows = r.data.data || [];
            if (!rows.length) { show('هنوز پیامکی ثبت نشده است', true); return; }
            out.className = 'text-sm';
            out.innerHTML = '<div class="overflow-x-auto"><table class="w-full text-xs border"><thead class="bg-slate-50"><tr><th class="p-2">زمان</th><th class="p-2">شماره</th><th class="p-2">رویداد</th><th class="p-2">وضعیت</th><th class="p-2">پاسخ</th></tr></thead><tbody>' +
              rows.map(function (x) { return '<tr class="border-t"><td class="p-2" dir="ltr">' + escAdmin(x.created_at) + '</td><td class="p-2" dir="ltr">' + escAdmin(x.phone) + '</td><td class="p-2">' + escAdmin(x.event) + '</td><td class="p-2">' + escAdmin(x.status) + '</td><td class="p-2">' + escAdmin(x.response) + '</td></tr>'; }).join('') +
              '</tbody></table></div>';
          } catch (err) { show('خطا در دریافت گزارش', false); }
        });
      })();
    </script>
  `;
    return adminLayout({ title: 'تنظیمات', currentPath: '/admin/settings' }, content);
}
// ===== Profile =====
export function adminProfilePage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5 max-w-2xl">
      <h2 class="font-bold mb-4">پروفایل من</h2>
      <form id="prof-form" class="space-y-3">
        <div id="prof-fields"><div class="text-center py-8"><span class="spinner"></span></div></div>
      </form>
      <hr class="my-6">
      <h3 class="font-bold mb-3">تغییر رمز</h3>
      <form id="pw-form" class="space-y-3 max-w-md">
        <div><label class="block text-sm mb-1">رمز فعلی</label><input name="old_password" type="password" required autocomplete="current-password" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
        <div><label class="block text-sm mb-1">رمز جدید</label><input name="new_password" type="password" required minlength="6" autocomplete="new-password" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
        <button type="submit" class="btn-indigo text-white px-5 py-2 rounded-lg text-sm">تغییر رمز</button>
      </form>
    </div>
    <script>
      async function loadProfile() {
        const r = await axios.get('/api/auth/me');
        const u = r.data.data;
        document.getElementById('prof-fields').innerHTML = \`
          <div class="grid md:grid-cols-2 gap-3">
            <div><label class="block text-sm mb-1">نام</label><input name="full_name" value="\${escAdmin(u.full_name || '')}" required class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1">ایمیل</label><input value="\${escAdmin(u.email)}" disabled class="w-full border bg-slate-100 rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1">موبایل</label><input name="phone" value="\${escAdmin(u.phone || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1">شرکت</label><input name="company" value="\${escAdmin(u.company || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          </div>
          <button type="submit" class="btn-indigo text-white px-5 py-2 rounded-lg text-sm mt-3">ذخیره</button>\`;
      }
      document.getElementById('prof-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target).entries());
        try { await axios.put('/api/auth/profile', data); toast('ذخیره شد', 'success'); }
        catch (err) { toast('خطا', 'error'); }
      });
      document.getElementById('pw-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target).entries());
        try { await axios.post('/api/auth/change-password', data); toast('رمز تغییر کرد', 'success'); e.target.reset(); }
        catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); }
      });
      loadProfile();
    </script>
  `;
    return adminLayout({ title: 'پروفایل من', currentPath: '/admin/profile' }, content);
}
// ===== Site Content (blocks + pages CRUD) =====
export function adminSiteContentPage() {
    const content = `
    <div class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-slate-800">مدیریت محتوای سایت</h1>
        <p class="text-sm text-slate-500 mt-1">محتوای ثابت سایت (هیرو، ویژگی‌ها، چرا ما، فوتر، حریم خصوصی، شرایط) را اینجا مدیریت کنید.</p>
      </div>
    </div>

    <div class="flex gap-2 border-b border-slate-200 mb-4">
      <button id="tab-blocks-btn" class="px-4 py-2 border-b-2 border-indigo-600 text-indigo-600 font-medium text-sm">بلوک‌ها (Blocks)</button>
      <button id="tab-pages-btn" class="px-4 py-2 border-b-2 border-transparent text-slate-500 hover:text-indigo-600 text-sm">صفحات (Pages)</button>
    </div>

    <!-- BLOCKS TAB -->
    <div id="tab-blocks">
      <div class="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label class="block text-xs text-slate-500 mb-1">فیلتر page</label>
          <input id="blocks-filter-page" placeholder="home / about / footer ..." class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
        </div>
        <div>
          <label class="block text-xs text-slate-500 mb-1">فیلتر section</label>
          <input id="blocks-filter-section" placeholder="features / why_us / quick_links ..." class="border border-slate-300 rounded-lg px-3 py-2 text-sm">
        </div>
        <button id="blocks-filter-btn" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm">اعمال فیلتر</button>
        <button id="blocks-add-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm">
          <i class="fas fa-plus ml-1"></i>افزودن بلوک جدید
        </button>
      </div>

      <!-- Quick-create shortcuts for home page editable sections -->
      <div class="bg-white rounded-xl shadow-sm p-4 mb-4">
        <div class="text-xs text-slate-500 mb-2"><i class="fas fa-bolt ml-1 text-amber-500"></i>ساخت سریع بلوک‌های صفحه اصلی (page/section از پیش پر می‌شود):</div>
        <div class="flex flex-wrap gap-2">
          <button type="button" id="quick-hero-btn" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-3 py-2 rounded-lg text-sm">
            <i class="fas fa-images ml-1"></i>اسلاید جدید برای اسلایدر (home / hero)
          </button>
          <button type="button" id="quick-side-btn" class="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-lg text-sm">
            <i class="fas fa-rectangle-ad ml-1"></i>بنر کناری جدید (home / side_banner)
          </button>
          <button type="button" id="quick-mid-btn" class="bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 px-3 py-2 rounded-lg text-sm">
            <i class="fas fa-panorama ml-1"></i>بنر میانی جدید (home / mid_banner)
          </button>
        </div>
      </div>

      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 border-b border-slate-200">
              <tr class="text-right text-slate-600">
                <th class="px-3 py-2">ID</th>
                <th class="px-3 py-2">page</th>
                <th class="px-3 py-2">section</th>
                <th class="px-3 py-2">تصویر</th>
                <th class="px-3 py-2">آیکون</th>
                <th class="px-3 py-2">عنوان</th>
                <th class="px-3 py-2">توضیح</th>
                <th class="px-3 py-2">href</th>
                <th class="px-3 py-2">ترتیب</th>
                <th class="px-3 py-2">فعال</th>
                <th class="px-3 py-2">عملیات</th>
              </tr>
            </thead>
            <tbody id="blocks-tbody">
              <tr><td colspan="11" class="text-center text-slate-400 py-6">در حال بارگذاری…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- PAGES TAB -->
    <div id="tab-pages" class="hidden">
      <div class="bg-white rounded-xl shadow-sm p-4 mb-4 flex items-end gap-3">
        <button id="pages-add-btn" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm">
          <i class="fas fa-plus ml-1"></i>افزودن/به‌روزرسانی صفحه
        </button>
        <span class="text-xs text-slate-500">صفحات با کلید (page, section) یکتا هستند؛ ارسال دوباره همان کلید آن را به‌روزرسانی می‌کند.</span>
      </div>
      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 border-b border-slate-200">
              <tr class="text-right text-slate-600">
                <th class="px-3 py-2">ID</th>
                <th class="px-3 py-2">page</th>
                <th class="px-3 py-2">section</th>
                <th class="px-3 py-2">عنوان</th>
                <th class="px-3 py-2">زیرعنوان</th>
                <th class="px-3 py-2">متن کوتاه</th>
                <th class="px-3 py-2">فعال</th>
                <th class="px-3 py-2">عملیات</th>
              </tr>
            </thead>
            <tbody id="pages-tbody">
              <tr><td colspan="8" class="text-center text-slate-400 py-6">در حال بارگذاری…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Block modal -->
    <div id="block-modal" class="fixed inset-0 bg-black/50 z-50 hidden items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-xl">
        <div class="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 id="block-modal-title" class="font-bold text-slate-800">افزودن بلوک</h3>
          <button onclick="document.getElementById('block-modal').classList.add('hidden');document.getElementById('block-modal').classList.remove('flex');" class="text-slate-400 hover:text-slate-600"><i class="fas fa-times"></i></button>
        </div>
        <form id="block-form" class="p-5 grid grid-cols-2 gap-3">
          <input type="hidden" name="id">
          <div class="col-span-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2 text-xs leading-5">
            <i class="fas fa-circle-info ml-1"></i>
            <b>اسلایدر صفحه اصلی</b> (<code>home</code>/<code>hero</code>): تصویر را آپلود کنید، <b>icon</b> = متن دکمه (مثل «مشاهده محصولات»)، <b>توضیح</b> = زیرعنوان، <b>href</b> = لینک.<br>
            <b>بنر کناری</b> (<code>home</code>/<code>side_banner</code>): <b>icon</b> = کلاس FontAwesome (مثل <code>fa-ethernet</code>)، <b>عنوان</b> و <b>توضیح</b> = متن، تصویر اختیاری.<br>
            <b>بنر میانی</b> (<code>home</code>/<code>mid_banner</code>): <b>icon</b> = متن دکمه (مثل «خرید»)، <b>عنوان</b> و <b>توضیح</b> = متن، تصویر اختیاری.
          </div>
          <div><label class="block text-xs text-slate-500 mb-1">page *</label><input name="page" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs text-slate-500 mb-1">section *</label><input name="section" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></div>
          <div class="col-span-2 nc-imgfield" data-imgfield="imgf-block-image">
            <label class="block text-sm mb-1">تصویر (برای اسلایدر/بنر تصویری)</label>
            <div class="flex items-center gap-3">
              <img id="imgf-block-image-preview" src="/static/images/p1.svg" alt="preview" class="w-16 h-16 rounded-lg object-cover border bg-white flex-shrink-0" onerror="this.src='/static/images/p1.svg'">
              <div class="flex-1">
                <input id="imgf-block-image-url" name="image" value="" placeholder="/static/images/... یا آپلود کنید" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2">
                <div class="flex items-center gap-2">
                  <button type="button" class="btn-indigo text-white px-3 py-1.5 rounded-lg text-xs" onclick="document.getElementById('imgf-block-image-file').click()"><i class="fas fa-upload ml-1"></i>آپلود تصویر</button>
                  <input type="file" id="imgf-block-image-file" accept="image/*" class="hidden">
                  <span id="imgf-block-image-status" class="text-xs text-slate-500"></span>
                </div>
              </div>
            </div>
          </div>
          <div><label class="block text-xs text-slate-500 mb-1">icon (FA مثل fa-shipping-fast یا متن دکمه اسلایدر)</label><input name="icon" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs text-slate-500 mb-1">عنوان (برای بنر تمام‌تصویری خالی بگذارید)</label><input name="title" placeholder="اختیاری در صورت انتخاب تصویر" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></div>
          <div class="col-span-2"><label class="block text-xs text-slate-500 mb-1">توضیح</label><textarea name="description" rows="2" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea></div>
          <div><label class="block text-xs text-slate-500 mb-1">href (پیوند)</label><input name="href" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs text-slate-500 mb-1">ترتیب</label><input name="sort_order" type="number" value="0" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-xs text-slate-500 mb-1">فعال</label>
            <select name="is_active" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="1">فعال</option><option value="0">غیرفعال</option>
            </select>
          </div>
          <div class="col-span-2 flex justify-end gap-2 mt-2">
            <button type="button" onclick="document.getElementById('block-modal').classList.add('hidden');document.getElementById('block-modal').classList.remove('flex');" class="px-4 py-2 border border-slate-300 rounded-lg text-sm">انصراف</button>
            <button type="submit" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm">ذخیره</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Page modal -->
    <div id="page-modal" class="fixed inset-0 bg-black/50 z-50 hidden items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl">
        <div class="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 id="page-modal-title" class="font-bold text-slate-800">افزودن/به‌روزرسانی صفحه</h3>
          <button onclick="document.getElementById('page-modal').classList.add('hidden');document.getElementById('page-modal').classList.remove('flex');" class="text-slate-400 hover:text-slate-600"><i class="fas fa-times"></i></button>
        </div>
        <form id="page-form" class="p-5 grid grid-cols-2 gap-3">
          <input type="hidden" name="id">
          <div><label class="block text-xs text-slate-500 mb-1">page *</label><input name="page" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="home / about / privacy / terms"></div>
          <div><label class="block text-xs text-slate-500 mb-1">section *</label><input name="section" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="hero / intro / body"></div>
          <div class="col-span-2"><label class="block text-xs text-slate-500 mb-1">عنوان</label><input name="title" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></div>
          <div class="col-span-2"><label class="block text-xs text-slate-500 mb-1">زیرعنوان (badge)</label><input name="subtitle" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></div>
          <div class="col-span-2">
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs text-slate-500">متن کامل</label>
              <button type="button" onclick="stripPageBodyTags()" class="text-[11px] text-indigo-600 hover:underline"><i class="fas fa-broom ml-1"></i>حذف تگ‌های HTML از متن</button>
            </div>
            <textarea name="body" rows="8" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"></textarea>
            <p class="text-[10px] text-slate-400 mt-1">می‌توانید متن ساده بنویسید — هر خط یک پاراگراف می‌شود. اگر تگ HTML (مثل &lt;p&gt;) می‌بینید، دکمه «حذف تگ‌ها» را بزنید.</p>
          </div>
          <div class="col-span-2 border border-blue-200 rounded-xl p-3 bg-blue-50/50">
            <label class="block text-sm font-bold mb-2 text-blue-800"><i class="fas fa-magnifying-glass ml-1"></i>تنظیمات سئو (SEO)</label>
            <div class="space-y-2">
              <div><label class="block text-xs mb-1 text-slate-500">عنوان سئو (Meta Title)</label><input name="seo_title" placeholder="اگر خالی باشد از عنوان صفحه استفاده می‌شود" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></div>
              <div><label class="block text-xs mb-1 text-slate-500">توضیحات سئو (Meta Description)</label><textarea name="seo_description" rows="2" placeholder="حداکثر ۱۶۰ کاراکتر" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea></div>
              <div><label class="block text-xs mb-1 text-slate-500">کلمات کلیدی (با کاما جدا کنید)</label><input name="seo_keywords" placeholder="مثال: تجهیزات شبکه, درباره ما" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></div>
            </div>
          </div>
          <div><label class="block text-xs text-slate-500 mb-1">فعال</label>
            <select name="is_active" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="1">فعال</option><option value="0">غیرفعال</option>
            </select>
          </div>
          <div class="col-span-2 flex justify-end gap-2 mt-2">
            <button type="button" onclick="document.getElementById('page-modal').classList.add('hidden');document.getElementById('page-modal').classList.remove('flex');" class="px-4 py-2 border border-slate-300 rounded-lg text-sm">انصراف</button>
            <button type="submit" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm">ذخیره</button>
          </div>
        </form>
      </div>
    </div>

    <script>
      // === Tabs ===
      const tabBlocksBtn = document.getElementById('tab-blocks-btn');
      const tabPagesBtn  = document.getElementById('tab-pages-btn');
      const tabBlocks    = document.getElementById('tab-blocks');
      const tabPages     = document.getElementById('tab-pages');
      function activate(which) {
        if (which === 'blocks') {
          tabBlocks.classList.remove('hidden'); tabPages.classList.add('hidden');
          tabBlocksBtn.classList.add('border-indigo-600','text-indigo-600'); tabBlocksBtn.classList.remove('border-transparent','text-slate-500');
          tabPagesBtn.classList.remove('border-indigo-600','text-indigo-600'); tabPagesBtn.classList.add('border-transparent','text-slate-500');
        } else {
          tabBlocks.classList.add('hidden'); tabPages.classList.remove('hidden');
          tabPagesBtn.classList.add('border-indigo-600','text-indigo-600'); tabPagesBtn.classList.remove('border-transparent','text-slate-500');
          tabBlocksBtn.classList.remove('border-indigo-600','text-indigo-600'); tabBlocksBtn.classList.add('border-transparent','text-slate-500');
          if (!window.__pagesLoaded) { loadPages(); window.__pagesLoaded = true; }
        }
      }
      tabBlocksBtn.addEventListener('click', () => activate('blocks'));
      tabPagesBtn.addEventListener('click',  () => activate('pages'));

      function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

      // === Blocks ===
      async function loadBlocks() {
        const p = document.getElementById('blocks-filter-page').value.trim();
        const s = document.getElementById('blocks-filter-section').value.trim();
        const qs = new URLSearchParams(); if (p) qs.set('page', p); if (s) qs.set('section', s);
        try {
          const r = await axios.get('/api/content/admin/blocks?' + qs.toString());
          const items = r.data.data || [];
          const tb = document.getElementById('blocks-tbody');
          if (!items.length) { tb.innerHTML = '<tr><td colspan="11" class="text-center text-slate-400 py-6">بلوکی وجود ندارد</td></tr>'; return; }
          tb.innerHTML = items.map(b => \`
            <tr class="border-b border-slate-100 hover:bg-slate-50">
              <td class="px-3 py-2">\${b.id}</td>
              <td class="px-3 py-2 font-mono text-xs">\${esc(b.page)}</td>
              <td class="px-3 py-2 font-mono text-xs">\${esc(b.section)}</td>
              <td class="px-3 py-2">\${b.image ? '<img src="'+esc(b.image)+'" class="w-10 h-10 rounded object-cover border" onerror="this.style.display=\\'none\\'">' : '<span class="text-slate-300 text-xs">—</span>'}</td>
              <td class="px-3 py-2"><i class="fas \${esc(b.icon||'')} text-indigo-500"></i> <span class="text-xs text-slate-400">\${esc(b.icon||'')}</span></td>
              <td class="px-3 py-2">\${esc(b.title)}</td>
              <td class="px-3 py-2 text-slate-500 text-xs max-w-xs truncate">\${esc(b.description||'')}</td>
              <td class="px-3 py-2 font-mono text-xs">\${esc(b.href||'')}</td>
              <td class="px-3 py-2">\${b.sort_order}</td>
              <td class="px-3 py-2">\${b.is_active ? '<span class="text-green-600">فعال</span>' : '<span class="text-slate-400">غیرفعال</span>'}</td>
              <td class="px-3 py-2 whitespace-nowrap">
                <button onclick='editBlock(\${attrJson(b)})'\ class="text-indigo-600 hover:underline text-xs ml-2">ویرایش</button>
                <button onclick="deleteBlock(\${b.id})" class="text-red-600 hover:underline text-xs">حذف</button>
              </td>
            </tr>\`).join('');
        } catch (e) { toast('خطا در بارگذاری بلوک‌ها', 'error'); }
      }

      function setBlockImage(url) {
        const f = document.getElementById('block-form');
        if (f.image) {
          f.image.value = url || '';
          // sync the widget preview (img sibling within the same nc-imgfield wrapper)
          const wrap = f.image.closest('[data-imgfield]');
          if (wrap) { const pv = wrap.querySelector('img'); if (pv) pv.src = url || '/static/images/p1.svg'; }
        }
      }
      window.editBlock = function(b) {
        const f = document.getElementById('block-form');
        f.id.value = b.id; f.page.value = b.page; f.section.value = b.section;
        f.icon.value = b.icon || ''; f.title.value = b.title; f.description.value = b.description || '';
        f.href.value = b.href || ''; f.sort_order.value = b.sort_order || 0;
        f.is_active.value = b.is_active ? '1' : '0';
        setBlockImage(b.image || '');
        document.getElementById('block-modal-title').textContent = 'ویرایش بلوک #' + b.id;
        document.getElementById('block-modal').classList.remove('hidden');
        document.getElementById('block-modal').classList.add('flex');
      };
      window.deleteBlock = async function(id) {
        if (!confirm('این بلوک حذف شود؟')) return;
        try { await axios.delete('/api/content/admin/blocks/' + id); toast('حذف شد', 'success'); loadBlocks(); }
        catch (e) { toast('خطا در حذف', 'error'); }
      };

      document.getElementById('blocks-add-btn').addEventListener('click', () => {
        const f = document.getElementById('block-form'); f.reset(); f.id.value = '';
        setBlockImage('');
        document.getElementById('block-modal-title').textContent = 'افزودن بلوک جدید';
        document.getElementById('block-modal').classList.remove('hidden');
        document.getElementById('block-modal').classList.add('flex');
      });
      document.getElementById('blocks-filter-btn').addEventListener('click', loadBlocks);

      // Quick-create presets: open the block modal with page/section + helpful defaults pre-filled.
      function openBlockPreset(preset) {
        const f = document.getElementById('block-form'); f.reset(); f.id.value = '';
        setBlockImage('');
        f.page.value = preset.page;
        f.section.value = preset.section;
        if (preset.icon !== undefined) f.icon.value = preset.icon;
        if (preset.title !== undefined) f.title.value = preset.title;
        if (preset.description !== undefined) f.description.value = preset.description;
        if (preset.href !== undefined) f.href.value = preset.href;
        document.getElementById('block-modal-title').textContent = preset.modalTitle || 'افزودن بلوک جدید';
        document.getElementById('block-modal').classList.remove('hidden');
        document.getElementById('block-modal').classList.add('flex');
      }
      document.getElementById('quick-hero-btn').addEventListener('click', () => openBlockPreset({
        page: 'home', section: 'hero', icon: 'مشاهده محصولات', title: '', description: '', href: '/products',
        modalTitle: 'اسلاید جدید اسلایدر (تصویر را آپلود کنید، icon = متن دکمه)'
      }));
      document.getElementById('quick-side-btn').addEventListener('click', () => openBlockPreset({
        page: 'home', section: 'side_banner', icon: 'fa-bolt', title: '', description: '', href: '/products',
        modalTitle: 'بنر کناری جدید (icon = کلاس FontAwesome مثل fa-ethernet)'
      }));
      document.getElementById('quick-mid-btn').addEventListener('click', () => openBlockPreset({
        page: 'home', section: 'mid_banner', icon: 'خرید', title: '', description: '', href: '/products',
        modalTitle: 'بنر میانی جدید (icon = متن دکمه، تصویر اختیاری)'
      }));

      document.getElementById('block-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        const id = data.id; delete data.id;
        data.sort_order = parseInt(data.sort_order || '0');
        data.is_active = parseInt(data.is_active || '1');
        try {
          if (id) await axios.put('/api/content/admin/blocks/' + id, data);
          else    await axios.post('/api/content/admin/blocks', data);
          toast('ذخیره شد', 'success');
          document.getElementById('block-modal').classList.add('hidden');
          document.getElementById('block-modal').classList.remove('flex');
          loadBlocks();
        } catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); }
      });

      // === Pages ===
      async function loadPages() {
        try {
          const r = await axios.get('/api/content/admin/pages');
          const items = r.data.data || [];
          const tb = document.getElementById('pages-tbody');
          if (!items.length) { tb.innerHTML = '<tr><td colspan="8" class="text-center text-slate-400 py-6">صفحه‌ای وجود ندارد</td></tr>'; return; }
          tb.innerHTML = items.map(p => \`
            <tr class="border-b border-slate-100 hover:bg-slate-50">
              <td class="px-3 py-2">\${p.id}</td>
              <td class="px-3 py-2 font-mono text-xs">\${esc(p.page)}</td>
              <td class="px-3 py-2 font-mono text-xs">\${esc(p.section)}</td>
              <td class="px-3 py-2">\${esc(p.title||'')}</td>
              <td class="px-3 py-2 text-slate-500 text-xs">\${esc(p.subtitle||'')}</td>
              <td class="px-3 py-2 text-slate-500 text-xs max-w-md truncate">\${esc((p.body||'').slice(0,80))}</td>
              <td class="px-3 py-2">\${p.is_active ? '<span class="text-green-600">فعال</span>' : '<span class="text-slate-400">غیرفعال</span>'}</td>
              <td class="px-3 py-2 whitespace-nowrap">
                <button onclick='editPage(\${attrJson(p)})'\ class="text-indigo-600 hover:underline text-xs ml-2">ویرایش</button>
                <button onclick="deletePage(\${p.id})" class="text-red-600 hover:underline text-xs">حذف</button>
              </td>
            </tr>\`).join('');
        } catch (e) { toast('خطا در بارگذاری صفحات', 'error'); }
      }
      window.stripPageBodyTags = function() {
        const ta = document.querySelector('#page-form textarea[name=body]');
        if (!ta) return;
        const NL = String.fromCharCode(10);
        let v = ta.value;
        v = v.split('<br />').join(NL).split('<br/>').join(NL).split('<br>').join(NL);
        v = v.split('</p>').join(NL + NL).split('</div>').join(NL).split('</li>').join(NL);
        const tmp = document.createElement('div');
        tmp.innerHTML = v;
        let txt = tmp.textContent || tmp.innerText || '';
        while (txt.indexOf(NL + NL + NL) !== -1) txt = txt.split(NL + NL + NL).join(NL + NL);
        ta.value = txt.trim();
        window.ncMarkDirty && window.ncMarkDirty();
      };
      window.editPage = function(p) {
        const f = document.getElementById('page-form');
        f.id.value = p.id; f.page.value = p.page; f.section.value = p.section;
        f.title.value = p.title || ''; f.subtitle.value = p.subtitle || ''; f.body.value = p.body || '';
        f.seo_title.value = p.seo_title || ''; f.seo_description.value = p.seo_description || ''; f.seo_keywords.value = p.seo_keywords || '';
        f.is_active.value = p.is_active ? '1' : '0';
        document.getElementById('page-modal-title').textContent = 'ویرایش صفحه #' + p.id;
        document.getElementById('page-modal').classList.remove('hidden');
        document.getElementById('page-modal').classList.add('flex');
      };
      window.deletePage = async function(id) {
        if (!confirm('این صفحه حذف شود؟')) return;
        try { await axios.delete('/api/content/admin/pages/' + id); toast('حذف شد', 'success'); loadPages(); }
        catch (e) { toast('خطا در حذف', 'error'); }
      };
      document.getElementById('pages-add-btn').addEventListener('click', () => {
        const f = document.getElementById('page-form'); f.reset(); f.id.value = '';
        document.getElementById('page-modal-title').textContent = 'افزودن/به‌روزرسانی صفحه';
        document.getElementById('page-modal').classList.remove('hidden');
        document.getElementById('page-modal').classList.add('flex');
      });
      document.getElementById('page-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = Object.fromEntries(fd.entries());
        const id = data.id; delete data.id;
        data.is_active = parseInt(data.is_active || '1');
        try {
          if (id) await axios.put('/api/content/admin/pages/' + id, data);
          else    await axios.post('/api/content/admin/pages', data);  // upsert
          toast('ذخیره شد', 'success');
          document.getElementById('page-modal').classList.add('hidden');
          document.getElementById('page-modal').classList.remove('flex');
          loadPages();
        } catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); }
      });

      // initial load
      loadBlocks();
    </script>
  `;
    return adminLayout({ title: 'محتوای سایت', currentPath: '/admin/site-content' }, content);
}

// ===== Pricing system (bulk price adjustments) =====
export function adminPricingPage() {
    const content = `
    <div class="max-w-3xl mx-auto space-y-4">
      <div class="bg-white rounded-xl shadow-sm p-5">
        <h2 class="font-bold mb-1"><i class="fas fa-money-bill-trend-up ml-2 text-indigo-500"></i>سیستم قیمتی — تغییر قیمت گروهی</h2>
        <p class="text-xs text-slate-400 mb-4">قیمت همه محصولات یک دسته‌بندی یا برند را به‌صورت درصدی یا مبلغی، افزایش یا کاهش دهید.</p>
        <form id="pricing-form" class="space-y-4">
          <div class="grid md:grid-cols-2 gap-3">
            <div>
              <label class="block text-sm mb-1 font-medium">دسته‌بندی هدف</label>
              <select name="category_id" id="pr-cat" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="">— همه دسته‌ها —</option></select>
              <label class="flex items-center gap-2 text-xs mt-2 text-slate-500"><input type="checkbox" name="include_children" checked> شامل زیرشاخه‌ها هم بشود</label>
            </div>
            <div>
              <label class="block text-sm mb-1 font-medium">برند هدف</label>
              <select name="brand_id" id="pr-brand" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="">— همه برندها —</option></select>
              <p class="text-[11px] text-slate-400 mt-2">حداقل یکی از دسته یا برند باید انتخاب شود. اگر هر دو انتخاب شوند، فقط محصولات مشترک تغییر می‌کنند.</p>
            </div>
          </div>
          <div class="grid md:grid-cols-3 gap-3">
            <div>
              <label class="block text-sm mb-1 font-medium">نوع تغییر</label>
              <select name="mode" id="pr-mode" class="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="percent">درصدی (٪)</option>
                <option value="amount">مبلغی (تومان)</option>
              </select>
            </div>
            <div>
              <label class="block text-sm mb-1 font-medium">جهت</label>
              <select id="pr-dir" class="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="1">افزایش قیمت</option>
                <option value="-1">کاهش قیمت</option>
              </select>
            </div>
            <div>
              <label class="block text-sm mb-1 font-medium">مقدار *</label>
              <input id="pr-value" type="number" step="0.1" min="0" required class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="مثلاً 10">
            </div>
          </div>
          <div>
            <label class="block text-sm mb-1 font-medium">اعمال روی</label>
            <select name="apply_to" class="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="both">قیمت اصلی و قیمت تخفیف</option>
              <option value="price">فقط قیمت اصلی</option>
              <option value="discount_price">فقط قیمت تخفیف</option>
            </select>
          </div>
          <div class="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700"><i class="fas fa-triangle-exclamation ml-1"></i>این عملیات قیمت همه محصولات هدف را تغییر می‌دهد. پیش از اعمال، از صحت مقدار مطمئن شوید. در صورت اشتباه، «آخرین تغییر گروهی» از کادر پایین قابل بازگردانی است.</div>
          <div class="flex gap-2 pt-3 border-t">
            <button type="submit" class="btn-indigo text-white px-6 py-2.5 rounded-lg text-sm"><i class="fas fa-money-bill-trend-up ml-1"></i>اعمال تغییر قیمت</button>
          </div>
        </form>
      </div>
      <div class="bg-white rounded-xl shadow-sm p-5">
        <h3 class="font-bold text-sm mb-2"><i class="fas fa-clock-rotate-left ml-1 text-slate-400"></i>آخرین تغییرات قیمت گروهی</h3>
        <div id="pricing-undo" class="hidden mb-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm flex items-center justify-between gap-3 flex-wrap"></div>
        <div id="pricing-log" class="text-xs text-slate-500">در حال بارگذاری...</div>
      </div>
    </div>
    <script>
      function catOptionsHier(cats) {
        const byParent = {};
        cats.forEach(c => { const k = c.parent_id || 0; (byParent[k] = byParent[k] || []).push(c); });
        const out = [];
        (function walk(pid, depth) {
          (byParent[pid] || []).forEach(c => {
            const pad = depth ? '&nbsp;'.repeat(depth * 3) + '└ ' : '';
            out.push('<option value="' + c.id + '">' + pad + escAdmin(c.name) + '</option>');
            walk(c.id, depth + 1);
          });
        })(0, 0);
        return out.join('');
      }
      async function loadPricingRefs() {
        try {
          const [cr, br] = await Promise.all([axios.get('/api/admin/categories'), axios.get('/api/admin/brands')]);
          document.getElementById('pr-cat').innerHTML = '<option value="">— همه دسته‌ها —</option>' + catOptionsHier(cr.data.data);
          document.getElementById('pr-brand').innerHTML = '<option value="">— همه برندها —</option>' + br.data.data.map(b => '<option value="' + b.id + '">' + escAdmin(b.name) + '</option>').join('');
        } catch (e) { toast('خطا در بارگذاری دسته/برند', 'error'); }
      }
      async function loadPricingLog() {
        const box = document.getElementById('pricing-log');
        try {
          const r = await axios.get('/api/admin/activity-logs', { params: { limit: 50 } });
          const items = ((r.data.data && r.data.data.items) || r.data.data || []).filter(l => l.action === 'bulk_price' || l.action === 'bulk_price_undo').slice(0, 8);
          if (!items.length) { box.innerHTML = 'هنوز تغییری ثبت نشده است.'; return; }
          box.innerHTML = '<ul class="space-y-1.5">' + items.map(l => {
            let d = {}; try { d = JSON.parse(l.details || '{}'); } catch (e) {}
            if (l.action === 'bulk_price_undo') return '<li class="flex items-center gap-2"><i class="fas fa-rotate-left text-[10px] text-indigo-400"></i><span>' + escAdmin(l.user_name || '') + ' — بازگردانی «' + escAdmin(d.summary || '') + '» (' + (d.restored || 0) + ' محصول) — ' + formatDate(l.created_at) + '</span></li>';
            const what = d.mode === 'amount' ? (formatPrice(Math.abs(d.amount || 0)) + ' تومان') : (Math.abs(d.percent || 0) + '٪');
            const dir = ((d.mode === 'amount' ? d.amount : d.percent) || 0) >= 0 ? 'افزایش' : 'کاهش';
            return '<li class="flex items-center gap-2"><i class="fas fa-circle text-[5px] text-indigo-400"></i><span>' + escAdmin(l.user_name || '') + ' — ' + dir + ' ' + what + ' (' + (d.changed || 0) + ' محصول) — ' + formatDate(l.created_at) + '</span></li>';
          }).join('') + '</ul>';
        } catch (e) { box.innerHTML = 'خطا در بارگذاری گزارش'; }
      }
      document.getElementById('pricing-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const dir = parseInt(document.getElementById('pr-dir').value);
        const val = parseFloat(document.getElementById('pr-value').value);
        if (!val || val <= 0) { toast('مقدار تغییر را وارد کنید', 'error'); return; }
        const mode = fd.get('mode');
        const payload = { mode, apply_to: fd.get('apply_to'), include_children: fd.get('include_children') === 'on' };
        if (fd.get('category_id')) payload.category_id = parseInt(fd.get('category_id'));
        if (fd.get('brand_id')) payload.brand_id = parseInt(fd.get('brand_id'));
        if (!payload.category_id && !payload.brand_id) { toast('دسته‌بندی یا برند هدف را انتخاب کنید', 'error'); return; }
        if (mode === 'percent') payload.percent = dir * val;
        else payload.amount = dir * Math.round(val);
        const what = mode === 'percent' ? val + '٪' : formatPrice(Math.round(val)) + ' تومان';
        // R5-B: tell the owner HOW MANY products will change before applying
        // (same target rules as the server: category + descendants, AND brand).
        let affected = null;
        try {
          const [pr, cr] = await Promise.all([axios.get('/api/products/admin/list'), axios.get('/api/admin/categories')]);
          const cats = cr.data.data || [];
          let ids = null;
          if (payload.category_id) {
            ids = new Set([payload.category_id]);
            if (payload.include_children !== false) { let grew = true; while (grew) { grew = false; cats.forEach(c => { if (c.parent_id && ids.has(c.parent_id) && !ids.has(c.id)) { ids.add(c.id); grew = true; } }); } }
          }
          affected = (pr.data.data.items || []).filter(p => (!ids || ids.has(p.category_id)) && (!payload.brand_id || p.brand_id === payload.brand_id)).length;
        } catch (e) { affected = null; }
        if (affected === 0) { toast('هیچ محصولی در این دسته/برند وجود ندارد؛ تغییری لازم نیست', 'error'); return; }
        const cnt = affected == null ? '' : ' «' + formatPrice(affected) + ' محصول»';
        const ok = await confirmAction('قیمت' + cnt + ' ' + what + ' ' + (dir > 0 ? 'افزایش' : 'کاهش') + ' یابد؟ (در صورت اشتباه، از کادر «آخرین تغییرات» قابل بازگردانی است)');
        if (!ok) return;
        try {
          const r = await axios.post('/api/products/bulk-price', payload);
          toast(r.data.message, 'success');
          loadPricingLog(); loadPricingUndo();
        } catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); }
      });
      // Round 2 (2026-11-03): undo the latest bulk price change
      async function loadPricingUndo() {
        const box = document.getElementById('pricing-undo');
        try {
          const r = await axios.get('/api/products/bulk-price/last');
          const d = r.data.data;
          if (!d) { box.classList.add('hidden'); box.innerHTML = ''; return; }
          box.innerHTML = '<div><i class="fas fa-rotate-left ml-1 text-indigo-600"></i><b>آخرین تغییر گروهی:</b> ' + escAdmin(d.summary || '') +
            ' <span class="text-xs text-slate-500">— ' + escAdmin(d.user_name || '') + '، ' + formatDate(d.created_at) + '</span></div>' +
            '<button type="button" id="pricing-undo-btn" class="bg-white border border-indigo-300 text-indigo-700 hover:bg-indigo-100 px-4 py-1.5 rounded-lg text-sm whitespace-nowrap"><i class="fas fa-rotate-left ml-1"></i>بازگردانی این تغییر</button>';
          box.classList.remove('hidden');
          document.getElementById('pricing-undo-btn').onclick = async () => {
            const ok = await confirmAction('قیمت محصولاتِ این تغییر به حالت قبل برگردد؟ (محصولاتی که بعد از آن دستی ویرایش شده‌اند دست نمی‌خورند)');
            if (!ok) return;
            try {
              const u = await axios.post('/api/products/bulk-price/undo', { id: d.id });
              toast(u.data.message, 'success');
            } catch (e) { toast(e.response?.data?.message || 'خطا در بازگردانی', 'error'); }
            loadPricingUndo(); loadPricingLog();
          };
        } catch (e) { box.classList.add('hidden'); }
      }
      loadPricingRefs(); loadPricingLog(); loadPricingUndo();
    </script>
  `;
    return adminLayout({ title: 'سیستم قیمتی', currentPath: '/admin/pricing' }, content);
}
// ===== 404 admin =====
export function adminNotFoundPage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-12 text-center max-w-2xl mx-auto" role="alert" aria-live="assertive">
      <div class="w-24 h-24 mx-auto mb-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
        <i class="fas fa-compass text-4xl text-white" aria-hidden="true"></i>
      </div>
      <div class="text-6xl font-extrabold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent mb-3 select-none" aria-hidden="true">404</div>
      <h1 class="text-xl font-bold text-slate-800 mb-2">صفحه مورد نظر در پنل یافت نشد</h1>
      <p class="text-slate-500 mb-6 leading-7">آدرس وارد شده اشتباه است یا این بخش هنوز پیاده‌سازی نشده است.</p>
      <div class="flex flex-wrap justify-center gap-3">
        <a href="/admin" class="btn-indigo text-white px-5 py-2.5 rounded-lg inline-block text-sm font-medium">
          <i class="fas fa-gauge-high ml-2" aria-hidden="true"></i>بازگشت به داشبورد
        </a>
        <a href="/admin/profile" class="border border-slate-300 text-slate-700 px-5 py-2.5 rounded-lg inline-block text-sm hover:border-indigo-500 hover:text-indigo-600 transition">
          <i class="fas fa-user ml-2" aria-hidden="true"></i>پروفایل من
        </a>
      </div>
    </div>
  `;
    return adminLayout({ title: '404', currentPath: '/' }, content);
}
// ===== Banners management (site_blocks: hero / side_banner / mid_banner) =====
export function adminBannersPage() {
    const content = `
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-slate-800">مدیریت بنرها</h1>
      <p class="text-sm text-slate-500 mt-1">بنرهای اسلایدر، کناری و میانی صفحه اصلی را از اینجا مدیریت کنید. تغییرات حداکثر تا ۳۰ ثانیه بعد روی سایت اعمال می‌شود.</p>
    </div>
    <div class="grid gap-6" id="banner-groups"></div>
    <script>
      const GROUPS = [
        { section: 'hero', label: 'اسلایدر اصلی (Hero)', icon: 'fa-images', hint: 'بنرهای بزرگ بالای صفحه اصلی' },
        { section: 'side_banner', label: 'بنرهای کناری', icon: 'fa-table-columns', hint: 'دو بنر کنار اسلایدر' },
        { section: 'mid_banner', label: 'بنرهای میانی', icon: 'fa-rectangle-ad', hint: 'بنرهای تبلیغاتی بین بخش‌های صفحه' }
      ];
      async function loadBanners() {
        const wrap = document.getElementById('banner-groups');
        wrap.innerHTML = '<div class="text-center py-12"><span class="spinner"></span></div>';
        try {
          const r = await axios.get('/api/content/admin/blocks', { params: { page: 'home' } });
          const all = r.data.data || [];
          wrap.innerHTML = GROUPS.map(g => {
            const items = all.filter(b => b.section === g.section);
            return \`<div class="bg-white rounded-xl shadow-sm p-5">
              <div class="flex items-center justify-between mb-4">
                <div>
                  <h2 class="font-bold"><i class="fas \${g.icon} ml-2 text-indigo-500"></i>\${g.label}</h2>
                  <p class="text-xs text-slate-400 mt-1">\${g.hint}</p>
                </div>
                <button onclick="newBanner('\${g.section}')" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm"><i class="fas fa-plus ml-1"></i>بنر جدید</button>
              </div>
              \${items.length ? \`<table class="w-full text-sm"><thead class="bg-slate-50 text-xs"><tr><th class="px-3 py-2 text-right">تصویر</th><th class="px-3 py-2 text-right">عنوان</th><th class="px-3 py-2 text-right">لینک</th><th class="px-3 py-2 text-right">ترتیب</th><th class="px-3 py-2 text-right">وضعیت</th><th class="px-3 py-2 text-right">عملیات</th></tr></thead><tbody>
                \${items.map(b => \`<tr class="border-t">
                  <td class="px-3 py-2">\${b.image ? '<img loading="lazy" src="' + escAdmin(b.image) + '" class="w-20 h-12 rounded object-cover border">' : '<span class="text-slate-300"><i class="fas fa-image"></i></span>'}</td>
                  <td class="px-3 py-2 font-bold">\${escAdmin(b.title)}</td>
                  <td class="px-3 py-2 text-xs text-slate-500 max-w-[160px] truncate">\${escAdmin(b.href || '-')}</td>
                  <td class="px-3 py-2">\${b.sort_order}</td>
                  <td class="px-3 py-2">\${b.is_active ? '<span class="badge badge-active">فعال</span>' : '<span class="badge badge-inactive">غیرفعال</span>'}</td>
                  <td class="px-3 py-2"><button onclick='editBanner(\${attrJson(b)})' class="text-indigo-600 ml-2"><i class="fas fa-pen"></i></button><button onclick="delBanner(\${b.id})" class="text-red-600"><i class="fas fa-trash"></i></button></td>
                </tr>\`).join('')}</tbody></table>\` : '<p class="text-center py-6 text-slate-400 text-sm">بنری ثبت نشده است</p>'}
            </div>\`;
          }).join('');
        } catch (e) { wrap.innerHTML = '<p class="text-red-500 p-4">خطا در دریافت بنرها</p>'; }
      }
      function bannerForm(b = {}) {
        return \`<form id="banner-form" class="space-y-3">
          <input type="hidden" name="page" value="home">
          <input type="hidden" name="section" value="\${escAdmin(b.section || '')}">
          <div><label class="block text-sm mb-1">عنوان *</label><input name="title" required value="\${escAdmin(b.title || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          <div><label class="block text-sm mb-1">توضیح کوتاه</label><input name="description" value="\${escAdmin(b.description || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          \${window.ncpImageField('image', b.image || '', 'تصویر بنر')}
          <div><label class="block text-sm mb-1">لینک (href)</label><input name="href" value="\${escAdmin(b.href || '')}" placeholder="/products?category=..." class="w-full border rounded-lg px-3 py-2 text-sm" dir="ltr"></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="block text-sm mb-1">ترتیب</label><input name="sort_order" type="number" value="\${b.sort_order ?? 0}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1">وضعیت</label><select name="is_active" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="1" \${b.is_active !== 0 ? 'selected' : ''}>فعال</option><option value="0" \${b.is_active === 0 ? 'selected' : ''}>غیرفعال</option></select></div>
          </div>
          <div class="flex gap-2 pt-3 border-t"><button type="submit" class="btn-indigo text-white px-5 py-2 rounded-lg text-sm">ذخیره</button><button type="button" onclick="closeModal(true)" class="px-5 py-2 bg-slate-200 rounded-lg text-sm">انصراف</button></div>
        </form>\`;
      }
      function bindBannerForm(id) {
        document.getElementById('banner-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.target).entries());
          try {
            if (id) await axios.put('/api/content/admin/blocks/' + id, data);
            else await axios.post('/api/content/admin/blocks', data);
            toast('ذخیره شد', 'success'); closeModal(true); loadBanners();
          } catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); }
        });
        if (window.bindDirtyTracking) window.bindDirtyTracking(document.getElementById('banner-form'));
      }
      window.newBanner = (section) => { showModal('بنر جدید', bannerForm({ section })); bindBannerForm(); };
      window.editBanner = (b) => { showModal('ویرایش بنر', bannerForm(b)); bindBannerForm(b.id); };
      window.delBanner = (id) => confirmDialog('این بنر حذف شود؟', async () => { await axios.delete('/api/content/admin/blocks/' + id); toast('حذف شد', 'success'); loadBanners(); });
      loadBanners();
    </script>
  `;
    return adminLayout({ title: 'مدیریت بنرها', currentPath: '/admin/banners' }, content);
}
// ===== Manual product ordering (drag & drop) =====
export function adminProductOrderPage() {
    const content = `
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-slate-800">چیدمان محصولات</h1>
      <p class="text-sm text-slate-500 mt-1">دسته‌بندی را انتخاب کنید، سپس محصولات را با کشیدن و رها کردن (Drag & Drop) مرتب کنید. این ترتیب در صفحه محصولات سایت اعمال می‌شود.</p>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5 mb-4 flex flex-wrap items-end gap-3">
      <div class="min-w-[220px]">
        <label class="block text-xs text-slate-500 mb-1">دسته‌بندی</label>
        <select id="ord-cat" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></select>
      </div>
      <button id="ord-save" class="btn-indigo text-white px-5 py-2 rounded-lg text-sm" disabled><i class="fas fa-floppy-disk ml-1"></i>ذخیره ترتیب</button>
      <span id="ord-hint" class="text-xs text-slate-400"></span>
    </div>
    <div class="bg-white rounded-xl shadow-sm p-5">
      <ul id="ord-list" class="space-y-2"></ul>
    </div>
    <script>
      let dirtyOrder = false;
      async function loadCats() {
        const r = await axios.get('/api/admin/categories');
        const cats = r.data.data || [];
        const sel = document.getElementById('ord-cat');
        sel.innerHTML = '<option value="">— انتخاب دسته‌بندی —</option>' + cats.map(c => \`<option value="\${escAdmin(c.slug)}">\${escAdmin(c.name)} (\${c.product_count || 0})</option>\`).join('');
        sel.addEventListener('change', () => loadItems(sel.value));
      }
      async function loadItems(slug) {
        const list = document.getElementById('ord-list');
        document.getElementById('ord-save').disabled = true;
        dirtyOrder = false;
        if (!slug) { list.innerHTML = '<li class="text-center py-10 text-slate-400 text-sm">ابتدا یک دسته‌بندی انتخاب کنید</li>'; return; }
        list.innerHTML = '<li class="text-center py-10"><span class="spinner"></span></li>';
        try {
          const r = await axios.get('/api/products/admin/list', { params: { category: slug, sort: 'manual' } });
          const items = r.data.data.items || [];
          if (!items.length) { list.innerHTML = '<li class="text-center py-10 text-slate-400 text-sm">محصولی در این دسته نیست</li>'; return; }
          list.innerHTML = items.map(p => \`
            <li class="ord-item flex items-center gap-3 border border-slate-200 rounded-lg px-3 py-2 bg-white cursor-grab select-none" draggable="true" data-id="\${p.id}">
              <i class="fas fa-grip-vertical text-slate-300"></i>
              \${p.image ? '<img loading="lazy" src="' + escAdmin(p.image) + '" class="w-10 h-10 rounded object-contain bg-slate-50 border">' : '<span class="w-10 h-10 rounded bg-slate-100 flex items-center justify-center text-slate-300"><i class="fas fa-box"></i></span>'}
              <span class="font-medium text-sm flex-1">\${escAdmin(p.name)}</span>
              <span class="text-xs text-slate-400">\${escAdmin(p.sku || '')}</span>
            </li>\`).join('');
          bindDnD();
        } catch (e) { list.innerHTML = '<li class="text-red-500 p-4 text-sm">خطا در دریافت محصولات</li>'; }
      }
      function bindDnD() {
        const list = document.getElementById('ord-list');
        let dragEl = null;
        list.querySelectorAll('.ord-item').forEach(it => {
          it.addEventListener('dragstart', (e) => { dragEl = it; it.classList.add('opacity-40'); e.dataTransfer.effectAllowed = 'move'; });
          it.addEventListener('dragend', () => { if (dragEl) dragEl.classList.remove('opacity-40'); dragEl = null; });
          it.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!dragEl || dragEl === it) return;
            const rect = it.getBoundingClientRect();
            const before = (e.clientY - rect.top) < rect.height / 2;
            list.insertBefore(dragEl, before ? it : it.nextSibling);
            markDirty();
          });
        });
      }
      function markDirty() {
        if (dirtyOrder) return;
        dirtyOrder = true;
        document.getElementById('ord-save').disabled = false;
        document.getElementById('ord-hint').textContent = 'ترتیب تغییر کرده — فراموش نکنید ذخیره کنید';
      }
      document.getElementById('ord-save').addEventListener('click', async () => {
        const ids = [...document.querySelectorAll('#ord-list .ord-item')].map(li => parseInt(li.dataset.id));
        if (!ids.length) return;
        try {
          await axios.post('/api/products/reorder', { ids });
          toast('ترتیب ذخیره شد', 'success');
          dirtyOrder = false;
          document.getElementById('ord-save').disabled = true;
          document.getElementById('ord-hint').textContent = '';
        } catch (e) { toast(e.response?.data?.message || 'خطا در ذخیره', 'error'); }
      });
      window.addEventListener('beforeunload', (e) => { if (dirtyOrder) { e.preventDefault(); e.returnValue = ''; } });
      loadCats();
      loadItems('');
    </script>
  `;
    return adminLayout({ title: 'چیدمان محصولات', currentPath: '/admin/product-order' }, content);
}

// ===== Multiple home pages management (voice n9) =====
export function adminHomePagesPage() {
    const content = `
    <div class="bg-white rounded-xl shadow-sm p-5">
      <div class="flex items-center justify-between mb-4">
        <h2 class="font-bold"><i class="fas fa-layer-group ml-1 text-indigo-600"></i>صفحات هوم چندگانه</h2>
        <button onclick="newHP()" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm"><i class="fas fa-plus ml-1"></i>صفحه هوم جدید</button>
      </div>
      <div class="bg-sky-50 border border-sky-200 rounded-lg p-3 text-xs text-sky-800 mb-4 leading-6">
        <i class="fas fa-circle-info ml-1"></i>
        برای هر خانواده محصول (مثلاً «محصولات دیجیتال») یک صفحه هوم مستقل بسازید. هر صفحه هیرو، دسته‌بندی‌ها و ریل‌های محصول مخصوص خودش را دارد و در آدرس <b dir="ltr">/h/اسلاگ</b> نمایش داده می‌شود. اگر «نمایش در منو» فعال باشد، لینک آن به نوار بالای سایت اضافه می‌شود.
      </div>
      <div id="hp-list"><div class="text-center py-10"><span class="spinner"></span></div></div>
    </div>
    <script>
      let HP_CATS = [], HP_BRANDS = [];
      async function loadHP() {
        const [r, rc, rb] = await Promise.all([
          axios.get('/api/content/admin/home-pages'),
          axios.get('/api/admin/categories'),
          axios.get('/api/admin/brands'),
        ]);
        HP_CATS = rc.data.data || []; HP_BRANDS = rb.data.data || [];
        const items = r.data.data || [];
        document.getElementById('hp-list').innerHTML = items.length ? \`<table class="w-full text-sm"><thead class="bg-slate-50 text-xs"><tr><th class="px-3 py-3 text-right">عنوان</th><th class="px-3 py-3 text-right">آدرس</th><th class="px-3 py-3 text-right">دسته‌ها</th><th class="px-3 py-3 text-right">در منو</th><th class="px-3 py-3 text-right">وضعیت</th><th class="px-3 py-3 text-right">عملیات</th></tr></thead><tbody>\${items.map(h => \`<tr class="border-t"><td class="px-3 py-2 font-bold">\${escAdmin(h.title)}</td><td class="px-3 py-2"><a href="/h/\${escAdmin(h.slug)}" target="_blank" class="text-indigo-600 text-xs" dir="ltr">/h/\${escAdmin(h.slug)} <i class="fas fa-up-right-from-square text-[10px]"></i></a></td><td class="px-3 py-2 text-xs text-slate-500">\${hpCatNames(h.category_ids)}</td><td class="px-3 py-2">\${h.show_in_nav ? '<span class="text-emerald-600"><i class="fas fa-check"></i></span>' : '<span class="text-slate-300"><i class="fas fa-minus"></i></span>'}</td><td class="px-3 py-2">\${h.is_active ? '<span class="badge badge-active">فعال</span>' : '<span class="badge badge-inactive">غیرفعال</span>'}</td><td class="px-3 py-2"><button onclick='editHP(\${attrJson(h)})' class="text-indigo-600 ml-2"><i class="fas fa-pen"></i></button><button onclick="delHP(\${h.id})" class="text-red-600"><i class="fas fa-trash"></i></button></td></tr>\`).join('')}</tbody></table>\` : '<p class="text-center text-slate-400 py-10">هنوز صفحه هومی ساخته نشده است. اولین صفحه را بسازید!</p>';
      }
      function hpCatNames(csv) {
        const ids = String(csv || '').split(',').map(x => parseInt(x)).filter(Boolean);
        return ids.map(id => (HP_CATS.find(c => c.id === id) || {}).name).filter(Boolean).join('، ') || '—';
      }
      function hpChecks(name, csv, list) {
        const sel = String(csv || '').split(',').map(x => parseInt(x)).filter(Boolean);
        return '<div class="flex flex-wrap gap-2 border rounded-lg p-2 max-h-36 overflow-y-auto">' + list.map(it =>
          '<label class="flex items-center gap-1 text-xs bg-slate-50 rounded px-2 py-1 cursor-pointer"><input type="checkbox" name="' + name + '" value="' + it.id + '"' + (sel.includes(it.id) ? ' checked' : '') + '> ' + escAdmin(it.name) + '</label>'
        ).join('') + '</div>';
      }
      function hpForm(h = {}) {
        return \`<form id="hp-form" class="space-y-3">
          <div class="grid md:grid-cols-2 gap-3">
            <div><label class="block text-sm mb-1">عنوان صفحه *</label><input name="title" required value="\${escAdmin(h.title || '')}" placeholder="مثلاً: محصولات دیجیتال" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1">اسلاگ (انگلیسی) *</label><input name="slug" required pattern="[a-z0-9\\\\-]+" value="\${escAdmin(h.slug || '')}" placeholder="digital" dir="ltr" class="w-full border rounded-lg px-3 py-2 text-sm"><small class="text-[11px] text-slate-400">آدرس صفحه: /h/اسلاگ</small></div>
          </div>
          <div><label class="block text-sm mb-1">شعار کوتاه</label><input name="tagline" value="\${escAdmin(h.tagline || '')}" placeholder="بهترین تجهیزات دیجیتال با گارانتی معتبر" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          <div class="border rounded-lg p-3 bg-slate-50 space-y-3">
            <div class="text-xs font-bold text-slate-600"><i class="fas fa-image ml-1"></i>هیرو (بنر بالای صفحه)</div>
            \${window.ncpImageField('hero_image', h.hero_image || '', 'تصویر هیرو')}
            <div class="grid md:grid-cols-2 gap-3">
              <div><label class="block text-sm mb-1">عنوان هیرو</label><input name="hero_title" value="\${escAdmin(h.hero_title || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
              <div><label class="block text-sm mb-1">زیرعنوان هیرو</label><input name="hero_sub" value="\${escAdmin(h.hero_sub || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            </div>
            <div><label class="block text-sm mb-1">لینک دکمه هیرو</label><input name="hero_link" value="\${escAdmin(h.hero_link || '')}" placeholder="/products?category=..." dir="ltr" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          </div>
          <div><label class="block text-sm mb-1"><i class="fas fa-folder-tree ml-1 text-indigo-500"></i>دسته‌بندی‌های این صفحه</label>\${hpChecks('cat_ids', h.category_ids, HP_CATS)}</div>
          <div><label class="block text-sm mb-1"><i class="fas fa-tag ml-1 text-indigo-500"></i>برندهای این صفحه (اختیاری)</label>\${hpChecks('brand_ids', h.brand_ids, HP_BRANDS)}</div>
          <div class="grid md:grid-cols-3 gap-3">
            <div><label class="block text-sm mb-1">نمایش در منوی سایت</label><select name="show_in_nav" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="1"\${h.show_in_nav !== 0 ? ' selected' : ''}>بله</option><option value="0"\${h.show_in_nav === 0 ? ' selected' : ''}>خیر</option></select></div>
            <div><label class="block text-sm mb-1">ترتیب</label><input name="sort_order" type="number" value="\${h.sort_order ?? 0}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1">وضعیت</label><select name="is_active" class="w-full border rounded-lg px-3 py-2 text-sm"><option value="1"\${h.is_active !== 0 ? ' selected' : ''}>فعال</option><option value="0"\${h.is_active === 0 ? ' selected' : ''}>غیرفعال</option></select></div>
          </div>
          <div class="grid md:grid-cols-2 gap-3">
            <div><label class="block text-sm mb-1">عنوان سئو</label><input name="seo_title" value="\${escAdmin(h.seo_title || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
            <div><label class="block text-sm mb-1">توضیح سئو</label><input name="seo_description" value="\${escAdmin(h.seo_description || '')}" class="w-full border rounded-lg px-3 py-2 text-sm"></div>
          </div>
          <div class="flex gap-2 pt-3 border-t"><button type="submit" class="btn-indigo text-white px-5 py-2 rounded-lg text-sm">ذخیره</button><button type="button" onclick="closeModal(true)" class="px-5 py-2 bg-slate-200 rounded-lg text-sm">انصراف</button></div>
        </form>\`;
      }
      function bindHPForm(id) {
        if (window.bindImageFields) window.bindImageFields(document.getElementById('hp-form'));
        document.getElementById('hp-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const f = e.target;
          const data = Object.fromEntries(new FormData(f).entries());
          data.category_ids = Array.from(f.querySelectorAll('input[name=cat_ids]:checked')).map(i => i.value).join(',');
          data.brand_ids = Array.from(f.querySelectorAll('input[name=brand_ids]:checked')).map(i => i.value).join(',');
          delete data.cat_ids; delete data.brand_ids2;
          try {
            if (id) await axios.put('/api/content/admin/home-pages/' + id, data);
            else await axios.post('/api/content/admin/home-pages', data);
            toast('ذخیره شد', 'success'); closeModal(); loadHP();
          } catch (err) { toast(err.response?.data?.message || 'خطا', 'error'); }
        });
      }
      window.newHP = () => { showModal('صفحه هوم جدید', hpForm({})); bindHPForm(); };
      window.editHP = (h) => { showModal('ویرایش صفحه هوم', hpForm(h)); bindHPForm(h.id); };
      window.delHP = (id) => confirmDialog('این صفحه هوم حذف شود؟', async () => { await axios.delete('/api/content/admin/home-pages/' + id); toast('حذف شد', 'success'); loadHP(); });
      loadHP();
    </script>
  `;
    return adminLayout({ title: 'صفحات هوم چندگانه', currentPath: '/admin/home-pages' }, content);
}
