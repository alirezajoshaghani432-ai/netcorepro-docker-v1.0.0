/* NetCore Pro — public site client runtime
 * Provides: window.NCPCart, window.NCPAuth, window.toast, window.formatPrice, window.formatDate
 * Used by all /site1/* pages. Loaded at the end of <body>.
 */
(function () {
  'use strict';

  // -------------------- html escape (DOM-XSS guard) --------------------
  // Escapes user/content-controlled strings before they are injected via innerHTML.
  window.ncpEsc = function (s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // -------------------- toast -------------------- 
  window.toast = function (message, type) {
    type = type || 'info';
    var c = document.getElementById('toast-container');
    if (!c) { c = document.createElement('div'); c.id = 'toast-container'; c.className = 'fixed top-20 left-4 z-[100] space-y-2'; document.body.appendChild(c); }
    var colors = {
      success: 'bg-green-500/95 border-green-400',
      error:   'bg-red-500/95 border-red-400',
      warning: 'bg-amber-500/95 border-amber-400',
      info:    'bg-cyan-500/95 border-cyan-400'
    };
    var icons = { success: 'fa-check-circle', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    var el = document.createElement('div');
    el.className = 'toast ' + (colors[type] || colors.info) + ' text-white text-sm px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 min-w-[260px] max-w-sm border';
    el.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i><span class="flex-1">' + String(message || '') + '</span>';
    c.appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; el.style.transform = 'translateX(-20px)'; el.style.transition = 'all .3s'; setTimeout(function () { el.remove(); }, 300); }, 3500);
  };

  // -------------------- format helpers --------------------
  window.formatPrice = function (n) {
    if (n === null || n === undefined || n === '') return '0';
    try { return new Intl.NumberFormat('fa-IR').format(Number(n) || 0); } catch (e) { return String(n); }
  };
  window.formatDate = function (d) {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('fa-IR'); } catch (e) { return String(d); }
  };

  // -------------------- Cart (localStorage) --------------------
  var CART_KEY = 'ncp_cart_v1';
  function readCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function writeCart(arr) {
    localStorage.setItem(CART_KEY, JSON.stringify(arr));
    updateBadge();
  }
  function updateBadge() {
    var items = readCart();
    var total = items.reduce(function (s, i) { return s + (Number(i.quantity) || 0); }, 0);
    ['cart-count', 'cart-count-m'].forEach(function (id) {
      var badge = document.getElementById(id);
      if (!badge) return;
      if (total > 0) { badge.textContent = String(total); badge.classList.remove('hidden'); }
      else { badge.classList.add('hidden'); }
    });
  }

  window.NCPCart = {
    get: readCart,
    subtotal: function () {
      return readCart().reduce(function (s, i) {
        var p = i.discount_price && i.discount_price < i.price ? i.discount_price : i.price;
        return s + (Number(p) || 0) * (Number(i.quantity) || 0);
      }, 0);
    },
    add: function (product, qty) {
      qty = Number(qty) || 1;
      var items = readCart();
      var pid = product.id;
      var existing = items.find(function (it) { return it.product_id === pid; });
      if (existing) {
        existing.quantity += qty;
        if (product.stock && existing.quantity > product.stock) existing.quantity = product.stock;
      } else {
        items.push({
          product_id: pid,
          slug: product.slug,
          name: product.name,
          image: product.image,
          price: Number(product.discount_price || product.price) || 0,
          discount_price: product.discount_price || null,
          quantity: qty,
          stock: product.stock || 0
        });
      }
      writeCart(items);
      window.toast('به سبد خرید افزوده شد', 'success');
    },
    update: function (pid, qty) {
      qty = Number(qty) || 0;
      var items = readCart();
      var idx = items.findIndex(function (it) { return it.product_id === pid; });
      if (idx < 0) return;
      if (qty < 1) { items.splice(idx, 1); }
      else { items[idx].quantity = qty; }
      writeCart(items);
    },
    remove: function (pid) {
      var items = readCart().filter(function (it) { return it.product_id !== pid; });
      writeCart(items);
    },
    clear: function () { writeCart([]); }
  };

  // -------------------- Auth (token in localStorage) --------------------
  var TOKEN_KEY = 'ncp_token';
  var USER_KEY  = 'ncp_user';

  window.NCPAuth = {
    getToken: function () { return localStorage.getItem(TOKEN_KEY); },
    getUser:  function () { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } },
    isLoggedIn: function () { return !!localStorage.getItem(TOKEN_KEY); },
    setSession: function (token, user) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY,  JSON.stringify(user || null));
      // Cookie too — so SSR can read on subsequent requests
      document.cookie = 'token=' + encodeURIComponent(token) + '; path=/; max-age=' + (7 * 86400) + '; SameSite=Lax';
      renderHeaderUser();
    },
    logout: function () {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      document.cookie = 'token=; path=/; max-age=0';
      renderHeaderUser();
      window.toast('با موفقیت خارج شدید', 'success');
      setTimeout(function () { location.href = '/site1'; }, 400);
    }
  };

  // Attach token to all axios requests automatically
  if (window.axios) {
    window.axios.interceptors.request.use(function (cfg) {
      var t = window.NCPAuth.getToken();
      if (t) { cfg.headers = cfg.headers || {}; cfg.headers.Authorization = 'Bearer ' + t; }
      return cfg;
    });
    window.axios.interceptors.response.use(
      function (r) { return r; },
      function (err) {
        if (err && err.response && err.response.status === 401) {
          // Optionally redirect on auth failure for protected pages
        }
        return Promise.reject(err);
      }
    );
  }

  function renderHeaderUser() {
    var u = window.NCPAuth.getUser();
    var slot = document.getElementById('header-user-area');
    if (slot) {
      if (u) {
        slot.innerHTML =
          '<a href="/site1/account" class="nc-login-btn"><i class="far fa-user"></i><span>' + window.ncpEsc(u.full_name || u.email) + '</span></a>' +
          '<button id="ncp-logout-btn" class="nc-icon-btn" title="خروج"><i class="fas fa-sign-out-alt"></i></button>';
        var btn = document.getElementById('ncp-logout-btn');
        if (btn) btn.addEventListener('click', function () { window.NCPAuth.logout(); });
      } else {
        slot.innerHTML = '<a href="/site1/login" class="nc-login-btn"><i class="far fa-user"></i><span>ورود | ثبت‌نام</span></a>';
      }
    }
    // drawer user area (mobile)
    var dslot = document.getElementById('nc-drawer-user');
    if (dslot) {
      if (u) {
        dslot.innerHTML =
          '<a href="/site1/account" class="flex items-center gap-3"><span class="nc-icon-btn"><i class="far fa-user"></i></span>' +
          '<span><b class="block text-sm">' + window.ncpEsc(u.full_name || u.email) + '</b><span class="text-xs" style="color:var(--nc-muted)">مشاهده حساب</span></span></a>' +
          '<button id="ncp-logout-btn-m" class="nc-login-btn w-full mt-3" style="justify-content:center"><i class="fas fa-sign-out-alt"></i>خروج از حساب</button>';
        var btn2 = document.getElementById('ncp-logout-btn-m');
        if (btn2) btn2.addEventListener('click', function () { window.NCPAuth.logout(); });
      } else {
        dslot.innerHTML = '<a href="/site1/login" class="nc-login-btn w-full" style="justify-content:center"><i class="far fa-user"></i>ورود | ثبت‌نام</a>';
      }
    }
  }

  // ==================================================================
  // F7 — Quick "add to cart" from product cards
  // ------------------------------------------------------------------
  // BUG FIXED: /api/products/:slug answers { data: { product, related } }.
  // The old inline copies of this function read `r.data.data` and looked for
  // `.id` on the WRAPPER, never found one, and reported «محصول یافت نشد».
  // Defined once here (instead of three inline duplicates) so it can never
  // drift again. Inline onclick handlers fire long after this deferred file.
  // ==================================================================
  window.addToCartQuick = async function (slug, ev) {
    var btn = ev && (ev.currentTarget || ev.target);
    if (btn && btn.closest) btn = btn.closest('button');
    var orig = btn ? btn.innerHTML : null;
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
    try {
      var r = await window.axios.get('/api/products/' + encodeURIComponent(slug));
      var body = (r.data && r.data.data) || r.data || {};
      var p = body.product || body;                 // <-- the actual fix
      if (!p || !p.id) { window.toast('محصول یافت نشد', 'error'); return; }
      if (Number(p.stock) <= 0) { window.toast('این محصول در حال حاضر موجود نیست', 'warning'); return; }
      window.NCPCart.add(p, 1);
    } catch (e) {
      var st = e && e.response && e.response.status;
      window.toast(st === 404 ? 'محصول یافت نشد' : 'خطا در افزودن به سبد خرید', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = orig; }
    }
  };

  // ==================================================================
  // F6 — Persian form validation
  // ------------------------------------------------------------------
  // Chrome/Edge render `required` errors in the *browser* language, so users
  // saw the English bubble «Please fill out this field». We suppress the
  // native bubble and render our own RTL message under the field instead.
  // ==================================================================
  var VMSG = {
    valueMissing:     'لطفاً این فیلد را تکمیل کنید',
    typeMismatchEmail:'ایمیل وارد شده معتبر نیست (مثال: name@site.com)',
    typeMismatchUrl:  'آدرس اینترنتی وارد شده معتبر نیست',
    typeMismatch:     'مقدار وارد شده معتبر نیست',
    patternMismatch:  'قالب وارد شده صحیح نیست',
    tooShort:         'حداقل {min} کاراکتر وارد کنید',
    tooLong:          'حداکثر {max} کاراکتر مجاز است',
    rangeUnderflow:   'مقدار نباید کمتر از {min} باشد',
    rangeOverflow:    'مقدار نباید بیشتر از {max} باشد',
    stepMismatch:     'مقدار وارد شده مجاز نیست',
    badInput:         'مقدار وارد شده معتبر نیست',
    generic:          'مقدار وارد شده معتبر نیست'
  };

  function messageFor(el) {
    if (el.dataset && el.dataset.errorMessage) return el.dataset.errorMessage;
    var v = el.validity || {};
    if (v.valueMissing) return (el.dataset && el.dataset.errorRequired) || VMSG.valueMissing;
    if (v.typeMismatch) return (el.dataset && el.dataset.errorType) || (el.type === 'email' ? VMSG.typeMismatchEmail
      : el.type === 'url' ? VMSG.typeMismatchUrl : VMSG.typeMismatch);
    if (v.patternMismatch) return (el.dataset && el.dataset.errorPattern) || VMSG.patternMismatch;
    if (v.tooShort) return (el.dataset && el.dataset.errorMinlength) || VMSG.tooShort.replace('{min}', window.formatPrice(el.minLength));
    if (v.tooLong) return VMSG.tooLong.replace('{max}', window.formatPrice(el.maxLength));
    if (v.rangeUnderflow) return VMSG.rangeUnderflow.replace('{min}', window.formatPrice(el.min));
    if (v.rangeOverflow) return VMSG.rangeOverflow.replace('{max}', window.formatPrice(el.max));
    if (v.stepMismatch) return VMSG.stepMismatch;
    if (v.badInput) return VMSG.badInput;
    return VMSG.generic;
  }

  function showFieldError(el, msg) {
    el.classList.add('nc-invalid');
    el.setAttribute('aria-invalid', 'true');
    var host = el.parentElement;
    if (!host) return;
    var box = host.querySelector('.nc-field-error');
    if (!box || box.parentElement !== host) {
      box = document.createElement('div');
      box.className = 'nc-field-error';
      box.setAttribute('role', 'alert');
      host.appendChild(box);
    }
    box.innerHTML = '<i class="fas fa-circle-exclamation"></i><span>' + window.ncpEsc(msg) + '</span>';
  }

  function clearFieldError(el) {
    if (!el || !el.classList) return;
    el.classList.remove('nc-invalid');
    el.removeAttribute('aria-invalid');
    var host = el.parentElement;
    var box = host && host.querySelector('.nc-field-error');
    if (box && box.parentElement === host) box.remove();
  }

  var focusGuard = false;
  document.addEventListener('invalid', function (e) {
    var el = e.target;
    if (!el || !el.validity) return;
    e.preventDefault();                      // kill the English native bubble
    showFieldError(el, messageFor(el));
    if (!focusGuard) {
      focusGuard = true;
      try { el.focus({ preventScroll: false }); } catch (_) { try { el.focus(); } catch (_e) {} }
      setTimeout(function () { focusGuard = false; }, 0);
    }
  }, true);
  ['input', 'change'].forEach(function (evt) {
    document.addEventListener(evt, function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('nc-invalid')) clearFieldError(e.target);
    }, true);
  });

  // -------------------- Iranian phone normalisation (F6) --------------------
  window.ncpToEnDigits = function (s) {
    return String(s == null ? '' : s)
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); });
  };
  /** Accepts 09xx, +989xx, 00989xx, 989xx, 9xx (and Persian digits) -> 09xxxxxxxxx */
  window.ncpNormalizePhone = function (raw) {
    var d = window.ncpToEnDigits(raw).replace(/[^0-9+]/g, '');
    if (d.indexOf('+98') === 0) d = '0' + d.slice(3);
    else if (d.indexOf('0098') === 0) d = '0' + d.slice(4);
    else if (d.indexOf('98') === 0 && d.length >= 12) d = '0' + d.slice(2);
    else if (d.charAt(0) === '9' && d.length === 10) d = '0' + d;
    return d.replace(/[^0-9]/g, '');
  };
  /** Attach live normalisation to any input marked data-nc-phone. */
  function bindPhoneInputs(root) {
    (root || document).querySelectorAll('input[data-nc-phone]').forEach(function (el) {
      if (el.__ncPhoneBound) return;
      el.__ncPhoneBound = true;
      var fix = function () {
        var n = window.ncpNormalizePhone(el.value);
        if (n !== el.value) el.value = n;
      };
      el.addEventListener('blur', fix);
      el.addEventListener('paste', function () { setTimeout(fix, 0); });
      el.addEventListener('input', function () {
        // normalise as soon as an international prefix has been typed/pasted
        if (/^(\+98|0098|98)/.test(window.ncpToEnDigits(el.value))) fix();
      });
      if (el.form) el.form.addEventListener('submit', fix, true);
    });
  }
  window.ncpBindPhoneInputs = bindPhoneInputs;

  // -------------------- Newsletter form (footer) --------------------
  function bindNewsletter() {
    var f = document.getElementById('newsletter-form');
    if (!f) return;
    f.addEventListener('submit', async function (e) {
      e.preventDefault();
      var fd = new FormData(f);
      var btn = f.querySelector('button[type=submit]');
      btn.disabled = true; var orig = btn.innerHTML; btn.innerHTML = '<span class="spinner"></span>';
      try {
        var r = await window.axios.post('/api/newsletter/subscribe', { email: fd.get('email') });
        window.toast(r.data.message || 'ثبت شد', 'success'); f.reset();
      } catch (err) {
        window.toast((err && err.response && err.response.data && err.response.data.message) || 'خطا در ثبت', 'error');
      } finally {
        btn.disabled = false; btn.innerHTML = orig;
      }
    });
  }

  // ==================================================================
  // F3 — SPA-style instant navigation (pjax)
  // ------------------------------------------------------------------
  // The site stays a classic SSR app (great SEO, no build step) but internal
  // navigation no longer reloads the document: we fetch just the <main> of the
  // next page, swap it in, re-run its inline scripts and push history.
  // Everything degrades to a normal full navigation if anything goes wrong,
  // so a broken page can never trap the user.
  // ==================================================================
  var SPA = (function () {
    var MAIN_ID = 'main-content';
    var SAME_ORIGIN = location.origin;
    var cache = new Map();          // url -> { title, html, desc }
    var CACHE_MAX = 24;
    var inflight = null;
    var seq = 0;
    var timers = [];                // intervals started by page scripts
    var enabled = !!(window.history && history.pushState && window.fetch && window.DOMParser);

    // ---- track intervals so a page's animations die when we leave it ----
    var _setInterval = window.setInterval;
    window.setInterval = function () {
      var id = _setInterval.apply(window, arguments);
      timers.push(id);
      return id;
    };
    function killTimers() {
      timers.forEach(function (id) { try { clearInterval(id); } catch (e) {} });
      timers = [];
    }

    // ---- thin progress bar ----
    var bar;
    function barStart() {
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'nc-pjax-bar';
        document.body.appendChild(bar);
      }
      bar.classList.remove('done');
      bar.classList.add('active');
      bar.style.width = '18%';
      setTimeout(function () { if (bar && bar.classList.contains('active')) bar.style.width = '72%'; }, 180);
    }
    function barDone() {
      if (!bar) return;
      bar.style.width = '100%';
      bar.classList.add('done');
      setTimeout(function () {
        if (!bar) return;
        bar.classList.remove('active', 'done');
        bar.style.width = '0%';
      }, 260);
    }

    function isInternal(a) {
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return false;
      if (a.getAttribute('href') === null) return false;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#') return false;
      if (/^(mailto:|tel:|sms:|javascript:|data:|blob:)/i.test(href)) return false;
      if (a.origin !== SAME_ORIGIN) return false;
      if (a.hasAttribute('data-no-pjax')) return false;
      // storefront only — /admin is a different asset bundle & auth flow
      return /^\/site1(\/|$|\?)/.test(a.pathname + (a.search || '')) || a.pathname === '/site1';
    }

    function put(url, payload) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(url, payload);
    }

    async function fetchPage(url) {
      if (cache.has(url)) return cache.get(url);
      var res = await fetch(url, {
        headers: { 'X-NC-PJAX': '1', 'X-Requested-With': 'fetch' },
        credentials: 'same-origin',
        redirect: 'follow'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      // The server answers PJAX requests with a compact JSON fragment;
      // if some proxy strips the header we still cope with full HTML.
      var ct = res.headers.get('content-type') || '';
      var payload;
      if (ct.indexOf('application/json') !== -1) {
        payload = await res.json();
      } else {
        var doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        var m = doc.getElementById(MAIN_ID);
        if (!m) throw new Error('no main');
        var md = doc.querySelector('meta[name="description"]');
        payload = { title: doc.title, html: m.innerHTML, desc: md ? md.content : '' };
      }
      if (!payload || typeof payload.html !== 'string') throw new Error('bad payload');
      put(url, payload);
      return payload;
    }

    /** Re-execute the <script> tags that arrived with the new fragment. */
    function runScripts(root) {
      var scripts = root.querySelectorAll('script');
      for (var i = 0; i < scripts.length; i++) {
        var old = scripts[i];
        var s = document.createElement('script');
        for (var j = 0; j < old.attributes.length; j++) {
          s.setAttribute(old.attributes[j].name, old.attributes[j].value);
        }
        if (!old.src) s.textContent = old.textContent;
        old.parentNode.replaceChild(s, old);
      }
    }

    function syncActive(path) {
      document.querySelectorAll('.nc-topnav-link, .nc-bottomnav-item, .nc-drawer-link').forEach(function (a) {
        var p = a.pathname || '';
        var on = p === path || (p !== '/' && p !== '/site1' && path.indexOf(p) === 0);
        a.classList.toggle('is-active', !!on);
      });
    }

    function closeDrawer() {
      var d = document.getElementById('nc-drawer'), o = document.getElementById('nc-drawer-overlay');
      if (d) d.classList.remove('open');
      if (o) o.classList.remove('open');
      document.body.style.overflow = '';
      // V4 D2 (owner voice note 2026-08-05): "when you click a category it
      // doesn't go in — the same panel is still open; you have to move the
      // mouse aside and click again". Removing .open was not enough: the
      // panel is ALSO shown by `.nc-cats:hover`, and after a pjax swap the
      // pointer is still physically over the menu, so CSS kept it visible and
      // it covered the freshly loaded listing. We force it shut and only
      // release the lock once the pointer actually leaves the menu.
      if (window.NCPCloseCats) window.NCPCloseCats();
    }

    async function render(url, payload, opts) {
      var main = document.getElementById(MAIN_ID);
      if (!main) { location.href = url; return; }
      killTimers();
      main.innerHTML = payload.html;
      if (payload.title) document.title = payload.title;
      var md = document.querySelector('meta[name="description"]');
      if (md && typeof payload.desc === 'string') md.content = payload.desc;
      runScripts(main);
      var u = new URL(url, location.href);
      syncActive(u.pathname);
      closeDrawer();
      onReady();                                   // rebind cart badge / user / forms
      document.dispatchEvent(new CustomEvent('nc:pagechange', { detail: { url: url } }));
      if (opts && opts.scroll !== false) window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
      try { main.focus({ preventScroll: true }); } catch (e) {}
    }

    async function go(url, opts) {
      opts = opts || {};
      var my = ++seq;
      barStart();
      try {
        var payload = await fetchPage(url);
        if (my !== seq) return;                     // a newer navigation won
        if (!opts.replace) history.pushState({ ncpjax: 1, url: url }, '', url);
        await render(url, payload, opts);
        barDone();
      } catch (e) {
        barDone();
        location.href = url;                        // always degrade gracefully
      }
    }

    function prefetch(url) {
      if (cache.has(url)) return;
      fetchPage(url).catch(function () {});
    }

    function init() {
      if (!enabled) return;
      history.replaceState({ ncpjax: 1, url: location.href }, '', location.href);

      document.addEventListener('click', function (e) {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        var a = e.target && e.target.closest ? e.target.closest('a') : null;
        if (!isInternal(a)) return;
        var url = a.href;
        if (url.split('#')[0] === location.href.split('#')[0]) return;
        e.preventDefault();
        go(url);
      });

      // warm the cache on intent (hover on desktop, first touch on mobile)
      var hoverTimer;
      document.addEventListener('mouseover', function (e) {
        var a = e.target && e.target.closest ? e.target.closest('a') : null;
        if (!isInternal(a)) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(function () { prefetch(a.href); }, 65);
      });
      document.addEventListener('mouseout', function () { clearTimeout(hoverTimer); });
      document.addEventListener('touchstart', function (e) {
        var a = e.target && e.target.closest ? e.target.closest('a') : null;
        if (isInternal(a)) prefetch(a.href);
      }, { passive: true });

      window.addEventListener('popstate', function (e) {
        if (!e.state || !e.state.ncpjax) return;
        var url = location.href;
        barStart();
        fetchPage(url)
          .then(function (p) { return render(url, p, { scroll: true }); })
          .then(barDone)
          .catch(function () { barDone(); location.reload(); });
      });
    }

    return {
      init: init,
      go: go,
      /** Let page code drop a stale entry (e.g. after posting a comment). */
      invalidate: function (url) { url ? cache.delete(url) : cache.clear(); }
    };
  })();
  window.NCPNav = SPA;

  // -------------------- DOM ready --------------------
  /* ---------------------------------------------------------------------
     F8 — copy-to-clipboard for card number / amount / order number.
     Uses the async Clipboard API with a document.execCommand fallback so it
     still works on http:// origins (this shop is served over plain HTTP).
  --------------------------------------------------------------------- */
  function copyText(txt) {
    txt = String(txt == null ? '' : txt);
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(txt);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy failed'));
      } catch (e) { reject(e); }
    });
  }
  window.ncpCopyText = copyText;

  window.ncpBindCopy = function (scope) {
    var root = scope || document;
    var btns = root.querySelectorAll ? root.querySelectorAll('[data-copy]') : [];
    Array.prototype.forEach.call(btns, function (btn) {
      if (btn.dataset.ncCopyBound === '1') return;
      btn.dataset.ncCopyBound = '1';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var val = btn.getAttribute('data-copy') || '';
        copyText(val).then(function () {
          btn.classList.add('is-copied');
          var lbl = btn.querySelector('span');
          var prev = lbl ? lbl.textContent : '';
          if (lbl) lbl.textContent = 'کپی شد';
          if (window.toast) window.toast('کپی شد', 'success');
          setTimeout(function () {
            btn.classList.remove('is-copied');
            if (lbl) lbl.textContent = prev;
          }, 1800);
        }).catch(function () {
          if (window.toast) window.toast('کپی نشد — لطفاً دستی انتخاب کنید', 'warning');
        });
      });
    });
  };

  function onReady() {
    updateBadge();
    renderHeaderUser();
    bindNewsletter();
    bindPhoneInputs(document);
    window.ncpBindCopy(document);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { onReady(); SPA.init(); });
  } else {
    onReady();
    SPA.init();
  }
})();
