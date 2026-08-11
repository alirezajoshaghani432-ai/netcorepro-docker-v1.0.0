/* NetCore Pro — admin panel client runtime
 * Loaded on /admin/* pages. Provides: window.toast, window.formatPrice, window.formatDate,
 * auto attaches admin_token to axios, manages sidebar / user info / badges, simple modal helper.
 */
(function () {
  'use strict';

  // -------------------- toast --------------------
  window.toast = function (message, type) {
    type = type || 'info';
    var c = document.getElementById('toast-container');
    if (!c) { c = document.createElement('div'); c.id = 'toast-container'; c.className = 'fixed top-20 left-4 z-[100] space-y-2'; document.body.appendChild(c); }
    var colors = { success: 'bg-green-600', error: 'bg-red-600', warning: 'bg-amber-600', info: 'bg-indigo-600' };
    var icons  = { success: 'fa-check-circle', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    var el = document.createElement('div');
    el.className = 'toast ' + (colors[type] || colors.info) + ' text-white text-sm px-4 py-3 rounded-lg shadow flex items-center gap-2 min-w-[260px] max-w-md';
    el.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i><span class="flex-1">' + String(message || '') + '</span>';
    c.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transition = 'all .3s'; setTimeout(function () { el.remove(); }, 300); }, 3500);
  };

  window.formatPrice = function (n) {
    if (n === null || n === undefined || n === '') return '0';
    try { return new Intl.NumberFormat('fa-IR').format(Number(n) || 0); } catch (e) { return String(n); }
  };
  window.formatDate = function (d) {
    if (!d) return '';
    try { return new Date(d).toLocaleString('fa-IR', { hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch (e) { return String(d); }
  };

  // -------------------- HTML escaping (XSS-safe) --------------------
  // Use for ANY DB / user-supplied value injected into innerHTML template literals.
  window.escAdmin = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  // Serialize an object to JSON that is safe to embed inside a single-quoted
  // HTML attribute (e.g. onclick='handler(${attrJson(obj)})'). HTML-encodes
  // the quote/angle/amp chars so DB strings cannot break out of the attribute.
  window.attrJson = function (obj) {
    try {
      return JSON.stringify(obj)
        .replace(/&/g, '&amp;').replace(/'/g, '&#39;')
        .replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    } catch (e) { return '{}'; }
  };

  // -------------------- status label (Persian) --------------------
  // statusLabel(status, type) -> localized label. type: undefined|'order'|'ticket'|'comment'|'post'|'user'|'message'
  var STATUS_LABELS = {
    order:   { pending: 'در انتظار', confirmed: 'تایید شده', shipping: 'در حال ارسال', delivered: 'تحویل شده', cancelled: 'لغو شده' },
    ticket:  { open: 'باز', answered: 'پاسخ داده‌شده', closed: 'بسته شده' },
    comment: { pending: 'در انتظار', approved: 'تایید شده', rejected: 'رد شده' },
    post:    { published: 'منتشرشده', draft: 'پیش‌نویس' },
    user:    { active: 'فعال', inactive: 'غیرفعال', blocked: 'مسدود' },
    message: { unread: 'خوانده‌نشده', read: 'خوانده‌شده', replied: 'پاسخ داده‌شده', closed: 'بسته شده' }
  };
  window.statusLabel = function (status, type) {
    var key = type || 'order';
    var map = STATUS_LABELS[key] || {};
    return map[status] || String(status == null ? '' : status);
  };

  // -------------------- Modal helper --------------------
  // Map size keyword -> max-width class
  var MODAL_SIZES = {
    'sm': 'max-w-sm', 'md': 'max-w-md', 'lg': 'max-w-lg', 'xl': 'max-w-xl',
    '2xl': 'max-w-2xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl', '5xl': 'max-w-5xl'
  };

  // -------------------- Unsaved-changes (dirty) tracking --------------------
  // Any form input inside the modal marks it dirty; closing a dirty modal asks
  // for confirmation so admins never lose typed data by an accidental
  // backdrop-click / X / انصراف.
  window.__ncModalDirty = false;
  window.ncMarkDirty = function () { window.__ncModalDirty = true; };
  window.ncClearDirty = function () { window.__ncModalDirty = false; };
  // Warn on page refresh / navigation while a modal form has unsaved changes,
  // so an accidental F5 never destroys typed product data.
  window.addEventListener('beforeunload', function (e) {
    if (window.__ncModalDirty) { e.preventDefault(); e.returnValue = ''; return ''; }
  });
  function bindDirtyTracking(root) {
    try {
      root.querySelectorAll('form').forEach(function (f) {
        if (f._dirtyBound) return;
        f._dirtyBound = true;
        f.addEventListener('input', window.ncMarkDirty);
        f.addEventListener('change', window.ncMarkDirty);
      });
    } catch (e) {}
  }

  // openModal(html)  -> simple body-only modal (legacy)
  window.openModal = function (html) {
    var root = document.getElementById('modal-root');
    if (!root) { root = document.createElement('div'); root.id = 'modal-root'; document.body.appendChild(root); }
    window.ncClearDirty();
    root.innerHTML =
      '<div class="fixed inset-0 z-[90] flex items-center justify-center p-4 modal-backdrop" onclick="if(event.target===this)window.closeModal()">' +
      '  <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">' + html + '</div>' +
      '</div>';
    // bind any image fields that the inserted html may contain
    if (window.bindImageFields) { try { window.bindImageFields(root); } catch (e) {} }
    bindDirtyTracking(root);
  };

  // showModal(title, html, opts)  -> titled modal with header + close button.
  // opts.size = 'sm'|'md'|'lg'|'xl'|'2xl'|'3xl'|'4xl'|'5xl'
  window.showModal = function (title, html, opts) {
    opts = opts || {};
    var sizeClass = MODAL_SIZES[opts.size] || 'max-w-2xl';
    var root = document.getElementById('modal-root');
    if (!root) { root = document.createElement('div'); root.id = 'modal-root'; document.body.appendChild(root); }
    root.innerHTML =
      '<div class="fixed inset-0 z-[90] flex items-center justify-center p-4 modal-backdrop" onclick="if(event.target===this)window.closeModal()">' +
      '  <div class="bg-white rounded-xl shadow-2xl ' + sizeClass + ' w-full max-h-[90vh] overflow-y-auto" onclick="event.stopPropagation()">' +
      '    <div class="flex items-center justify-between px-5 py-3 border-b sticky top-0 bg-white z-10">' +
      '      <h3 class="font-bold text-slate-800">' + String(title || '') + '</h3>' +
      '      <button type="button" onclick="window.closeModal()" class="text-slate-400 hover:text-red-600 w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center"><i class="fas fa-times"></i></button>' +
      '    </div>' +
      '    <div class="p-5">' + html + '</div>' +
      '  </div>' +
      '</div>';
    // bind any image fields that the inserted html may contain
    if (window.bindImageFields) { try { window.bindImageFields(root); } catch (e) {} }
    bindDirtyTracking(root);
  };

  // closeModal(force) — if the modal holds unsaved form changes, ask first.
  // Pass force=true (used after a successful save) to skip the confirmation.
  window.closeModal = function (force) {
    var root = document.getElementById('modal-root');
    if (!root || !root.innerHTML) return;
    if (!force && window.__ncModalDirty) {
      showLeaveConfirm(function () {
        window.ncClearDirty();
        root.innerHTML = '';
      });
      return;
    }
    window.ncClearDirty();
    root.innerHTML = '';
  };
  // cancelModal() — explicit انصراف button: closes right away without form
  // validation; if there are unsaved changes it shows the guard dialog once
  // and "خروج بدون ذخیره" really leaves (never forces a save first).
  window.cancelModal = function () { window.closeModal(); };
  // Escape key closes the modal too (same unsaved-changes guard)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var lv = document.getElementById('nc-leave-confirm');
    if (lv) { lv.remove(); return; }
    var root = document.getElementById('modal-root');
    if (root && root.innerHTML) window.closeModal();
  });

  // Small nested confirm overlay (does NOT reuse #modal-root, so the form stays intact)
  function showLeaveConfirm(onLeave) {
    var old = document.getElementById('nc-leave-confirm');
    if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'nc-leave-confirm';
    d.className = 'fixed inset-0 z-[120] flex items-center justify-center p-4';
    d.innerHTML =
      '<div class="absolute inset-0 bg-black/50"></div>' +
      '<div class="relative bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">' +
      '  <div class="flex items-start gap-3 mb-4"><div class="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center flex-shrink-0"><i class="fas fa-triangle-exclamation"></i></div><div><h3 class="font-bold text-slate-800 mb-1">تغییرات ذخیره نشده!</h3><p class="text-sm text-slate-600">اطلاعاتی که وارد کرده‌اید هنوز ذخیره نشده است. آیا مطمئن هستید که می‌خواهید بدون ذخیره خارج شوید؟</p></div></div>' +
      '  <div class="flex justify-end gap-2 flex-wrap">' +
      '    <button id="nc-leave-stay" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm">ادامه ویرایش</button>' +
      '    <button id="nc-leave-save" class="px-4 py-2 rounded-lg text-sm text-white bg-emerald-600 hover:bg-emerald-700"><i class="fas fa-floppy-disk ml-1"></i>خروج با ذخیره</button>' +
      '    <button id="nc-leave-go" class="px-4 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50">خروج بدون ذخیره</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(d);
    document.getElementById('nc-leave-stay').onclick = function () { d.remove(); };
    document.getElementById('nc-leave-go').onclick = function () { d.remove(); if (onLeave) onLeave(); };
    // F3 (voice 3): "save & exit" — submit the modal's form; on success the form's own
    // handler closes the modal (closeModal(true)). If HTML5 validation fails the browser
    // highlights the invalid field and the modal stays open so nothing is lost.
    document.getElementById('nc-leave-save').onclick = function () {
      d.remove();
      var root = document.getElementById('modal-root');
      var form = root ? root.querySelector('form') : null;
      if (!form) { if (onLeave) onLeave(); return; }
      if (typeof form.reportValidity === 'function' && !form.reportValidity()) {
        if (typeof window.toast === 'function') window.toast('برای ذخیره، فیلدهای الزامی را کامل کنید', 'error');
        return;
      }
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    };
  }

  // confirmDialog(message, onConfirm) -> shows confirm modal, runs async onConfirm() if accepted.
  window.confirmDialog = function (message, onConfirm) {
    window.confirmAction(message).then(function (ok) {
      if (ok && typeof onConfirm === 'function') { onConfirm(); }
    });
  };
  window.confirmAction = function (message) {
    return new Promise(function (resolve) {
      window.openModal(
        '<div class="p-6">' +
        '  <div class="flex items-start gap-3 mb-4"><div class="w-10 h-10 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center"><i class="fas fa-triangle-exclamation"></i></div><div class="flex-1"><h3 class="font-bold text-slate-800 mb-1">تایید عملیات</h3><p class="text-sm text-slate-600">' + (message || 'آیا مطمئن هستید؟') + '</p></div></div>' +
        '  <div class="flex justify-end gap-2 mt-5">' +
        '    <button id="cnf-no" class="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">لغو</button>' +
        '    <button id="cnf-yes" class="btn-indigo text-white px-4 py-2 rounded-lg text-sm">تایید</button>' +
        '  </div>' +
        '</div>'
      );
      document.getElementById('cnf-no').onclick = function () { window.closeModal(); resolve(false); };
      document.getElementById('cnf-yes').onclick = function () { window.closeModal(); resolve(true); };
    });
  };

  // -------------------- Token / auth --------------------
  function getToken() {
    return localStorage.getItem('admin_token') || localStorage.getItem('ncp_token');
  }
  function getUser() {
    try { return JSON.parse(sessionStorage.getItem('admin_info') || localStorage.getItem('ncp_user') || 'null'); } catch (e) { return null; }
  }

  // The auth interceptor is normally installed by the early inline bootstrap in the
  // <head> (so it is ready before any inline page script runs). Install here ONLY as a
  // fallback when that bootstrap didn't run, and guard against double-install.
  if (window.axios && !window.__ncAxiosReady) {
    window.__ncAxiosReady = true;
    window.axios.interceptors.request.use(function (cfg) {
      var t = getToken();
      if (t) { cfg.headers = cfg.headers || {}; cfg.headers.Authorization = 'Bearer ' + t; }
      return cfg;
    });
    window.axios.interceptors.response.use(function (r) { return r; }, function (err) {
      if (err && err.response && err.response.status === 401 && location.pathname !== '/admin/login') {
        if (typeof window.toast === 'function') { window.toast('نشست شما منقضی شده است', 'error'); }
        var redirect = encodeURIComponent(location.pathname + location.search);
        setTimeout(function () { location.href = '/admin/login?redirect=' + redirect; }, 800);
      }
      return Promise.reject(err);
    });
  }

  // -------------------- Sidebar toggle (mobile) --------------------
  function bindSidebar() {
    var btn = document.getElementById('sidebar-toggle');
    var sb  = document.getElementById('sidebar');
    if (!btn || !sb) return;
    btn.addEventListener('click', function () {
      var hidden = sb.classList.toggle('hidden');
      btn.setAttribute('aria-expanded', String(!hidden));
    });
  }

  // -------------------- Header: user info + logout --------------------
  function renderAdminUser() {
    var slot = document.getElementById('admin-user-info');
    if (!slot) return;
    var u = getUser();
    if (!u && location.pathname !== '/admin/login') {
      slot.innerHTML = '<a href="/admin/login" class="text-sm text-indigo-600 hover:text-indigo-700"><i class="fas fa-sign-in-alt ml-1"></i>ورود</a>';
      return;
    }
    if (!u) return;
    slot.innerHTML =
      '<div class="flex items-center gap-2">' +
      '  <div class="w-9 h-9 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-sm">' + window.escAdmin((u.full_name || u.email || '?').charAt(0)) + '</div>' +
      '  <div class="hidden sm:block text-xs"><div class="font-bold text-slate-800">' + window.escAdmin(u.full_name || '') + '</div><div class="text-slate-500">' + (u.role === 'admin' ? 'مدیر سیستم' : 'کاربر') + '</div></div>' +
      '  <button id="adm-logout" class="text-slate-400 hover:text-red-600 text-sm px-2" title="خروج"><i class="fas fa-sign-out-alt"></i></button>' +
      '</div>';
    var btn = document.getElementById('adm-logout');
    if (btn) btn.addEventListener('click', async function () {
      var ok = await window.confirmAction('آیا می‌خواهید از پنل خارج شوید؟');
      if (!ok) return;
      try { await window.axios.post('/api/auth/logout'); } catch (e) {}
      localStorage.removeItem('admin_token');
      sessionStorage.removeItem('admin_info');
      location.href = '/admin/login';
    });
  }

  // -------------------- Sidebar badges (orders pending, tickets, msgs, comments) --------------------
  async function loadBadges() {
    if (location.pathname === '/admin/login') return;
    if (!getToken()) return;
    try {
      var r = await window.axios.get('/api/admin/dashboard');
      var b = (r.data && r.data.data && r.data.data.badges) || {};
      Object.keys(b).forEach(function (k) {
        var el = document.querySelector('[data-badge="' + k + '"]');
        if (!el) return;
        var n = Number(b[k] || 0);
        if (n > 0) { el.textContent = String(n); el.classList.remove('hidden'); }
        else { el.classList.add('hidden'); }
      });
    } catch (e) { /* silent */ }
  }

  // -------------------- Guard non-login admin pages --------------------
  function guardAdmin() {
    if (location.pathname === '/admin/login') return;
    if (!getToken()) {
      location.href = '/admin/login?redirect=' + encodeURIComponent(location.pathname + location.search);
    }
  }

  // -------------------- Image upload helpers --------------------
  // Upload a File object (or data URL string) to the server, returns the public URL.
  window.uploadImage = async function (fileOrDataUrl) {
    if (!window.axios) throw new Error('axios missing');
    if (typeof fileOrDataUrl === 'string') {
      var r = await window.axios.post('/api/admin/upload', { data: fileOrDataUrl });
      return r.data.data.url;
    }
    var form = new FormData();
    form.append('file', fileOrDataUrl);
    var r2 = await window.axios.post('/api/admin/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    return r2.data.data.url;
  };

  // Render an image-field widget (URL input + file picker + live preview).
  // name = form field name, value = current URL, label = field label.
  window.ncpImageField = function (name, value, label) {
    value = value || '';
    label = label || 'تصویر';
    var id = 'imgf-' + name + '-' + Math.random().toString(36).slice(2, 7);
    return '' +
      '<div class="nc-imgfield" data-imgfield="' + id + '">' +
        '<label class="block text-sm mb-1">' + label + '</label>' +
        '<div class="flex items-center gap-3">' +
          '<img id="' + id + '-preview" src="' + (value || '/static/images/p1.svg') + '" alt="preview" class="w-16 h-16 rounded-lg object-cover border bg-white flex-shrink-0" onerror="this.src=\'/static/images/p1.svg\'">' +
          '<div class="flex-1">' +
            '<input id="' + id + '-url" name="' + name + '" value="' + value.replace(/"/g, '&quot;') + '" placeholder="/static/images/... یا آپلود کنید" class="w-full border rounded-lg px-3 py-2 text-sm mb-2">' +
            '<div class="flex items-center gap-2">' +
              '<button type="button" class="btn-indigo text-white px-3 py-1.5 rounded-lg text-xs" onclick="document.getElementById(\'' + id + '-file\').click()"><i class="fas fa-upload ml-1"></i>آپلود تصویر</button>' +
              '<input type="file" id="' + id + '-file" accept="image/*" class="hidden">' +
              '<span id="' + id + '-status" class="text-xs text-slate-500"></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  };

  // Bind all image fields inside a container (e.g. a modal). Call after inserting HTML.
  window.bindImageFields = function (root) {
    root = root || document;
    var fields = root.querySelectorAll('[data-imgfield]');
    fields.forEach(function (f) {
      var id = f.getAttribute('data-imgfield');
      var fileInput = document.getElementById(id + '-file');
      var urlInput = document.getElementById(id + '-url');
      var preview = document.getElementById(id + '-preview');
      var status = document.getElementById(id + '-status');
      if (!fileInput || fileInput._bound) return;
      fileInput._bound = true;
      // live preview when typing URL
      if (urlInput) urlInput.addEventListener('input', function () { if (preview) preview.src = urlInput.value || '/static/images/p1.svg'; });
      fileInput.addEventListener('change', async function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { window.toast('حجم تصویر بیش از ۵ مگابایت است', 'error'); return; }
        if (status) status.textContent = 'در حال آپلود...';
        try {
          var url = await window.uploadImage(file);
          if (urlInput) urlInput.value = url;
          if (preview) preview.src = url;
          if (status) status.textContent = '✓ آپلود شد';
          window.toast('تصویر آپلود شد', 'success');
        } catch (e) {
          if (status) status.textContent = '';
          window.toast((e.response && e.response.data && e.response.data.message) || 'خطا در آپلود', 'error');
        }
      });
    });
  };

  function onReady() {
    bindSidebar();
    guardAdmin();
    renderAdminUser();
    loadBadges();
    setInterval(loadBadges, 60000);
    // Activate any server-rendered image fields (e.g. site-content block form)
    if (window.bindImageFields) { try { window.bindImageFields(document); } catch (e) {} }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();
