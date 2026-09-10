import { getAllSettings } from '../../utils/helpers.js';

const LOCAL_HEAD = `
<link rel="stylesheet" href="/static/css/vazirmatn.css?v=20260708c">
<link rel="stylesheet" href="/static/css/fontawesome.min.css">
<link rel="stylesheet" href="/static/css/tailwind.min.css">
<link rel="stylesheet" href="/static/css/app.css?v=20260708c">
<script>
/* Early toast stub: guarantees window.toast exists before any inline page script runs
   (admin.js later replaces it with the full implementation). Prevents "toast is not defined"
   if an API call fails very early, e.g. a 401 redirect before admin.js finishes loading. */
window.toast = window.toast || function(message){ try { console.info('[toast]', message); } catch(e){} };
</script>
<!-- axios loaded SYNCHRONOUSLY (no defer) so it exists before any inline page <script> runs.
     This removes the race that caused "axios is not defined" / unauthenticated 401s. -->
<script src="/static/js/axios.min.js"></script>
<script>
/* Install the admin auth interceptor IMMEDIATELY after axios loads, before any inline
   page script fires its load functions. Also expose window.ncReady() so page scripts can
   defer their work until axios+interceptor are guaranteed ready (idempotent). */
(function () {
  function getTok(){ try { return localStorage.getItem('admin_token') || localStorage.getItem('ncp_token'); } catch(e){ return null; } }
  if (window.axios && !window.__ncAxiosReady) {
    window.__ncAxiosReady = true;
    window.axios.interceptors.request.use(function (cfg) {
      var t = getTok();
      if (t) { cfg.headers = cfg.headers || {}; cfg.headers.Authorization = 'Bearer ' + t; }
      return cfg;
    });
    window.axios.interceptors.response.use(function (r) { return r; }, function (err) {
      if (err && err.response && err.response.status === 401 && location.pathname !== '/admin/login') {
        if (typeof window.toast === 'function') { try { window.toast('نشست شما منقضی شده است', 'error'); } catch(e){} }
        var redirect = encodeURIComponent(location.pathname + location.search);
        setTimeout(function () { location.href = '/admin/login?redirect=' + redirect; }, 800);
      }
      return Promise.reject(err);
    });
  }
  /* ncReady(cb): run cb when axios is ready (it already is, synchronously). Kept for safety
     and for pages/libs that may need to wait (e.g. Chart.js). */
  window.ncReady = function (cb) {
    if (typeof cb !== 'function') return;
    if (window.axios) { try { cb(); } catch(e){ console.error(e); } return; }
    var tries = 0, iv = setInterval(function () {
      tries++;
      if (window.axios) { clearInterval(iv); try { cb(); } catch(e){ console.error(e); } }
      else if (tries > 100) { clearInterval(iv); }
    }, 30);
  };
  /* chartReady(cb): run cb once Chart.js is available (it is deferred). */
  window.chartReady = function (cb) {
    if (typeof cb !== 'function') return;
    if (window.Chart) { try { cb(); } catch(e){ console.error(e); } return; }
    var tries = 0, iv = setInterval(function () {
      tries++;
      if (window.Chart) { clearInterval(iv); try { cb(); } catch(e){ console.error(e); } }
      else if (tries > 200) { clearInterval(iv); }
    }, 30);
  };
})();
</script>
<script src="/static/js/chart.min.js" defer></script>
<!-- admin.js loaded SYNCHRONOUSLY so its helpers (escAdmin, formatPrice, statusLabel,
     showModal, attrJson, uploadImage, ncpImageField, statusLabel, toast) are defined
     BEFORE any inline page <script> calls loadX(). DOM-dependent init runs on DOMContentLoaded. -->
<script src="/static/js/admin.js?v=20260708c"></script>
`;

export function adminLayout(opts, content) {
    const settings = getAllSettings();
    const siteName = settings.site_name || 'NetCore Pro';
    const path = opts.currentPath || '/admin';
    const isActive = (p) => path === p || (p !== '/admin' && path.startsWith(p));
    const link = (href, icon, label, badgeKey) => `<a href="${href}" data-path="${href}" class="sidebar-link ${isActive(href) ? 'active' : ''} flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition">
       <i class="fas ${icon} w-5 text-center" aria-hidden="true"></i>
       <span class="flex-1">${label}</span>
       ${badgeKey ? `<span data-badge="${badgeKey}" class="hidden bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5 font-bold">0</span>` : ''}
     </a>`;
    return `<!DOCTYPE html>
<html lang="fa" dir="rtl" translate="no" class="notranslate">
<head>
<meta charset="UTF-8">
<meta name="google" content="notranslate">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#4f46e5">
<title>${escapeHtml(opts.title)} | پنل ${escapeHtml(siteName)}</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" type="image/svg+xml" href="/static/images/favicon.svg">
<link rel="alternate icon" href="/favicon.ico">
${LOCAL_HEAD}
<style>
  html, body { font-family: 'Vazirmatn', system-ui, sans-serif; }
  body { background: #f8fafc; color: #1e293b; }
</style>
${opts.extraHead || ''}
</head>
<body>
<a href="#main-content" class="skip-link">پرش به محتوای اصلی</a>
<div id="app" class="min-h-screen flex">

<aside id="sidebar" class="sidebar w-64 fixed inset-y-0 right-0 z-40 overflow-y-auto py-6 px-3 hidden md:block" role="navigation" aria-label="منوی پنل مدیریت">
  <div class="px-4 mb-6">
    <a href="/admin" class="flex items-center gap-2 text-white">
      <div class="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center"><i class="fas fa-shield-halved"></i></div>
      <div>
        <div class="font-bold">${escapeHtml(siteName)}</div>
        <div class="text-xs text-white/70">پنل مدیریت</div>
      </div>
    </a>
  </div>
  <nav class="space-y-1">
    ${link('/admin', 'fa-gauge-high', 'داشبورد')}
    <div class="px-4 mt-4 mb-1 text-[11px] text-white/50 font-bold">فروشگاه</div>
    ${link('/admin/products', 'fa-box', 'محصولات')}
    ${link('/admin/product-order', 'fa-arrow-down-up-across-line', 'چیدمان محصولات')}
    ${link('/admin/pricing', 'fa-money-bill-trend-up', 'سیستم قیمتی')}
    ${link('/admin/menu-builder', 'fa-bars-staggered', 'مدیریت منوی سایت')}
    ${link('/admin/categories', 'fa-folder-tree', 'دسته‌بندی‌ها')}
    ${link('/admin/brands', 'fa-tag', 'برندها')}
    ${link('/admin/orders', 'fa-cart-shopping', 'سفارش‌ها', 'orders_pending')}
    <div class="px-4 mt-4 mb-1 text-[11px] text-white/50 font-bold">محتوای سایت</div>
    ${link('/admin/site-content', 'fa-pen-to-square', 'محتوای صفحات')}
    ${link('/admin/banners', 'fa-images', 'مدیریت بنرها')}
    ${link('/admin/posts', 'fa-newspaper', 'مقالات')}
    ${link('/admin/comments', 'fa-comments', 'دیدگاه‌ها', 'comments_pending')}
    <div class="px-4 mt-4 mb-1 text-[11px] text-white/50 font-bold">کاربران</div>
    ${link('/admin/customers', 'fa-users', 'مشتریان')}
    ${link('/admin/users', 'fa-user-shield', 'کاربران سیستم')}
    <div class="px-4 mt-4 mb-1 text-[11px] text-white/50 font-bold">پشتیبانی</div>
    ${link('/admin/tickets', 'fa-headset', 'تیکت‌ها', 'tickets_open')}
    ${link('/admin/messages', 'fa-envelope', 'پیام‌ها', 'messages_unread')}
    ${link('/admin/newsletter', 'fa-paper-plane', 'خبرنامه')}
    <div class="px-4 mt-4 mb-1 text-[11px] text-white/50 font-bold">سیستم</div>
    ${link('/admin/activity-logs', 'fa-clipboard-list', 'گزارش فعالیت‌ها')}
    ${link('/admin/reports', 'fa-chart-line', 'گزارش‌ها')}
    ${link('/admin/settings', 'fa-gear', 'تنظیمات')}
    ${link('/admin/profile', 'fa-user', 'پروفایل من')}
  </nav>
</aside>

<div class="flex-1 md:mr-64 flex flex-col min-h-screen">
  <header class="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between sticky top-0 z-30">
    <div class="flex items-center gap-3">
      <button id="sidebar-toggle" class="md:hidden text-slate-600" aria-label="باز/بسته کردن منو" aria-controls="sidebar" aria-expanded="false"><i class="fas fa-bars" aria-hidden="true"></i></button>
      <h1 class="text-base md:text-lg font-bold text-slate-800">${escapeHtml(opts.title)}</h1>
    </div>
    <div class="flex items-center gap-3">
      <a href="/" target="_blank" rel="noopener noreferrer" class="hidden sm:inline-flex items-center text-sm text-slate-500 hover:text-indigo-600" aria-label="مشاهده سایت در پنجره جدید"><i class="fas fa-external-link-alt ml-1" aria-hidden="true"></i>مشاهده سایت</a>
      <div id="admin-user-info" class="flex items-center gap-2"></div>
    </div>
  </header>
  <main id="main-content" class="p-4 md:p-6 flex-1" role="main" tabindex="-1">${content}</main>
</div>

</div>

<div id="toast-container" class="fixed top-20 left-4 z-[100] space-y-2" role="region" aria-live="polite" aria-label="اعلان‌ها"></div>
<div id="modal-root"></div>
</body>
</html>`;
}

function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
