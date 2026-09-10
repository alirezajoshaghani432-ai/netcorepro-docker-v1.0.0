import { adminLayout } from './layout.js';

/**
 * «مدیریت منوی سایت» — ویرایشگر سادهٔ منوی هدر
 *
 * چرا جدا از /admin/categories؟
 * صفحهٔ دسته‌بندی‌ها یک فرم کامل و فنی است (اسلاگ، والد، آیکن FontAwesome،
 * عنوان و توضیح SEO) و برای ویرایش سریع منو بیش از اندازه شلوغ است. این صفحه
 * آینهٔ دقیقِ همان منویی است که بازدیدکننده در هدر سایت می‌بیند و تنها سه کار
 * پرتکرار را ساده می‌کند:
 *   ۱) تغییر نام با کلیک روی خود نام (اسلاگ و SEO دست‌نخورده می‌ماند، پس لینک‌های
 *      موجود و رتبهٔ جست‌وجو نمی‌شکنند)
 *   ۲) نمایش/عدم‌نمایش در منو با آیکن چشم — بدون حذف واقعی، چون حذف در صورت وجود
 *      محصول به‌دلیل یکپارچگی داده مسدود است و «پنهان‌سازی» گزینهٔ درست است
 *   ۳) جابجایی ترتیب با درگ‌واسقاط (Drag & Drop)
 * افزودن دسته یا زیردسته هم به‌صورت درجا با ساخت خودکار اسلاگ انجام می‌شود.
 */
export function adminMenuBuilderPage() {
    const content = `
    <div class="mb-6">
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 class="text-2xl font-bold text-gray-800">مدیریت منوی سایت</h1>
          <p class="text-gray-500 text-sm mt-1">همان منویی که بازدیدکننده در بالای سایت می‌بیند — اینجا می‌توانید خودتان آن را تغییر دهید.</p>
        </div>
        <div class="flex gap-2">
          <a href="/" target="_blank" class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm">
            <i class="fas fa-external-link-alt ml-1"></i> دیدن سایت
          </a>
          <a href="/admin/categories" class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm">
            <i class="fas fa-sliders-h ml-1"></i> تنظیمات پیشرفته
          </a>
        </div>
      </div>
    </div>

    <div class="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 text-sm text-blue-900 leading-7">
      <div class="font-bold mb-2"><i class="fas fa-circle-info ml-1"></i> راهنمای سریع (سه کار ساده)</div>
      <ul class="list-disc pr-5 space-y-1">
        <li><b>تغییر نام:</b> روی هر نام کلیک کنید، تایپ کنید و <b>Enter</b> بزنید. (برای لغو <b>Esc</b>)</li>
        <li><b>پنهان کردن:</b> روی آیکن <i class="fas fa-eye"></i> بزنید تا از منو حذف شود — اطلاعات و محصولاتش پاک <b>نمی‌شود</b>.</li>
        <li><b>جابجایی:</b> با ماوس بگیرید و بکشید تا ترتیب عوض شود، بعد «ذخیره ترتیب» را بزنید.</li>
      </ul>
    </div>

    <div id="mb-toolbar" class="flex items-center justify-between flex-wrap gap-3 mb-4 sticky top-0 z-20 bg-white/95 backdrop-blur py-2 -mx-1 px-1 rounded-lg">
      <div class="text-sm text-gray-500" id="mb-stats"></div>
      <div class="flex gap-2">
        <button id="mb-add-col" class="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-sm">
          <i class="fas fa-plus ml-1"></i> افزودن دسته‌بندی اصلی
        </button>
        <button id="mb-save-order" class="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm hidden">
          <i class="fas fa-save ml-1"></i> ذخیره ترتیب
        </button>
      </div>
    </div>

    <div id="mb-board" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <div class="col-span-full text-center py-16 text-gray-400"><i class="fas fa-spinner fa-spin text-2xl"></i></div>
    </div>

    <style>
      .mb-card{background:#fff;border:1px solid #e6e9f0;border-radius:14px;padding:14px;transition:box-shadow .18s,opacity .18s}
      .mb-card:hover{box-shadow:0 6px 18px rgba(20,32,66,.08)}
      .mb-card.dragging{opacity:.4}
      .mb-card.mb-hidden{background:#fafbfc;border-style:dashed}
      .mb-card.mb-hidden .mb-title{color:#9aa3b5;text-decoration:line-through}
      .mb-head{display:flex;align-items:center;gap:8px;padding-bottom:10px;border-bottom:1px solid #f0f2f7;margin-bottom:10px}
      .mb-grip{cursor:grab;color:#c3c9d6;flex:none}
      .mb-grip:active{cursor:grabbing}
      .mb-title{font-weight:700;font-size:14.5px;color:#1f2637;flex:1;min-width:0;cursor:text;border-radius:6px;padding:3px 5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mb-title:hover{background:#f4f7ff;box-shadow:inset 0 0 0 1px #d7e3ff}
      .mb-editing{background:#fff!important;box-shadow:inset 0 0 0 2px var(--nc-primary,#2563eb)!important;white-space:normal!important;outline:none}
      .mb-iconbtn{flex:none;width:28px;height:28px;border-radius:8px;color:#8b93a7;display:inline-flex;align-items:center;justify-content:center;font-size:13px}
      .mb-iconbtn:hover{background:#f1f4f9;color:#2b3346}
      .mb-sub{list-style:none;margin:0;padding:0;min-height:8px}
      .mb-sub li{display:flex;align-items:center;gap:7px;padding:5px 2px;border-radius:8px}
      .mb-sub li:hover{background:#fafbfd}
      .mb-sub li.dragging{opacity:.4}
      .mb-sublabel{flex:1;min-width:0;font-size:12.8px;color:#5a6178;cursor:text;border-radius:6px;padding:2px 5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .mb-sublabel:hover{background:#f4f7ff;box-shadow:inset 0 0 0 1px #d7e3ff}
      .mb-sub li.mb-hidden .mb-sublabel{color:#a8afbe;text-decoration:line-through}
      .mb-count{flex:none;unicode-bidi:isolate;direction:rtl;font-size:11px;font-weight:600;color:#8b93a7;background:#f1f4f9;border-radius:20px;padding:1px 7px}
      .mb-addrow{margin-top:8px;padding-top:8px;border-top:1px dashed #e6e9f0}
      .mb-addrow input{width:100%;border:1px solid #dfe3ec;border-radius:9px;padding:6px 10px;font-size:12.5px;font-family:inherit}
      .mb-addrow input:focus{outline:none;border-color:var(--nc-primary,#2563eb)}
      .mb-drop{outline:2px dashed #b9cdfb;outline-offset:3px;border-radius:12px}
    </style>

    <script>
      (function () {
        var board = document.getElementById('mb-board');
        var stats = document.getElementById('mb-stats');
        var saveBtn = document.getElementById('mb-save-order');
        var DATA = [];
        var dirty = false;

        var FA = ['\\u06F0','\\u06F1','\\u06F2','\\u06F3','\\u06F4','\\u06F5','\\u06F6','\\u06F7','\\u06F8','\\u06F9'];
        function faNum(n) { return String(n).replace(/[0-9]/g, function (d) { return FA[+d]; }); }
        function esc(s) {
          return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        function markDirty() {
          dirty = true;
          saveBtn.classList.remove('hidden');
          if (window.ncMarkDirty) window.ncMarkDirty();
        }
        function clearDirty() {
          dirty = false;
          saveBtn.classList.add('hidden');
          if (window.ncClearDirty) window.ncClearDirty();
        }
        window.addEventListener('beforeunload', function (e) {
          if (dirty) { e.preventDefault(); e.returnValue = ''; }
        });

        /* اسلاگ خودکار: فارسی را نگه می‌دارد (فقط فاصله -> خط تیره) تا آدرس خوانا بماند. */
        function makeSlug(name) {
          var s = String(name || '').trim().toLowerCase()
            .replace(/[\\s\\u200c]+/g, '-')
            .replace(/[^\\u0600-\\u06FF\\w-]/g, '')
            .replace(/-+/g, '-').replace(/^-|-$/g, '');
          return s || ('cat-' + Date.now());
        }
        function uniqueSlug(name) {
          var base = makeSlug(name), s = base, i = 2;
          var taken = {};
          DATA.forEach(function (c) {
            taken[c.slug] = 1;
            (c.children || []).forEach(function (sc) { taken[sc.slug] = 1; });
          });
          while (taken[s]) { s = base + '-' + (i++); }
          return s;
        }

        async function load() {
          try {
            var r = await axios.get('/api/admin/categories');
            var rows = r.data.categories || r.data.data || r.data || [];
            var byId = {}, roots = [];
            rows.forEach(function (c) { c.children = []; byId[c.id] = c; });
            rows.forEach(function (c) {
              if (c.parent_id && byId[c.parent_id]) byId[c.parent_id].children.push(c);
              else roots.push(c);
            });
            var so = function (a, b) { return (a.sort_order || 0) - (b.sort_order || 0); };
            roots.sort(so); roots.forEach(function (c) { c.children.sort(so); });
            DATA = roots;
            clearDirty();
            render();
          } catch (err) {
            board.innerHTML = '<div class="col-span-full text-center py-16 text-red-500">خطا در بارگذاری منو</div>';
          }
        }

        function isVisible(c) { return c.show_in_menu === undefined || c.show_in_menu === null || c.show_in_menu == 1; }

        function render() {
          var vis = 0, hid = 0;
          DATA.forEach(function (c) {
            isVisible(c) ? vis++ : hid++;
            (c.children || []).forEach(function (s) { isVisible(s) ? vis++ : hid++; });
          });
          stats.innerHTML = '\\u0645\\u062C\\u0645\\u0648\\u0639\\u0627\\u064B ' + faNum(vis + hid) +
            ' \\u0645\\u0648\\u0631\\u062F \\u0640 <b class="text-emerald-600">' + faNum(vis) + '</b> \\u062F\\u0631 \\u0645\\u0646\\u0648' +
            (hid ? ' \\u060C <b class="text-gray-400">' + faNum(hid) + '</b> \\u067E\\u0646\\u0647\\u0627\\u0646' : '');

          if (!DATA.length) {
            board.innerHTML = '<div class="col-span-full text-center py-16 text-gray-400">هنوز دسته‌بندی‌ای ندارید. دکمه «افزودن دسته‌بندی اصلی» را بزنید.</div>';
            return;
          }

          board.innerHTML = DATA.map(function (c) {
            var hiddenCls = isVisible(c) ? '' : ' mb-hidden';
            var eye = isVisible(c) ? 'fa-eye' : 'fa-eye-slash';
            var eyeTitle = isVisible(c) ? 'پنهان کردن از منو' : 'نمایش در منو';
            var subs = (c.children || []).map(function (sc) {
              var sh = isVisible(sc) ? '' : ' mb-hidden';
              var se = isVisible(sc) ? 'fa-eye' : 'fa-eye-slash';
              return '<li class="mb-subitem' + sh + '" draggable="true" data-id="' + sc.id + '">' +
                       '<i class="fas fa-grip-vertical mb-grip"></i>' +
                       '<span class="mb-sublabel" data-id="' + sc.id + '" title="برای تغییر نام کلیک کنید">' + esc(sc.name) + '</span>' +
                       (sc.product_count ? '<span class="mb-count">' + faNum(sc.product_count) + '</span>' : '') +
                       '<button class="mb-iconbtn mb-toggle" data-id="' + sc.id + '" title="' + (isVisible(sc) ? 'پنهان کردن از منو' : 'نمایش در منو') + '"><i class="fas ' + se + '"></i></button>' +
                     '</li>';
            }).join('');

            return '<div class="mb-card' + hiddenCls + '" draggable="true" data-id="' + c.id + '">' +
                     '<div class="mb-head">' +
                       '<i class="fas fa-grip-vertical mb-grip"></i>' +
                       '<span class="mb-title" data-id="' + c.id + '" title="برای تغییر نام کلیک کنید">' + esc(c.name) + '</span>' +
                       '<button class="mb-iconbtn mb-toggle" data-id="' + c.id + '" title="' + eyeTitle + '"><i class="fas ' + eye + '"></i></button>' +
                     '</div>' +
                     '<ul class="mb-sub" data-parent="' + c.id + '">' + subs + '</ul>' +
                     '<div class="mb-addrow"><input type="text" class="mb-addsub" data-parent="' + c.id + '" placeholder="+ افزودن زیرشاخه و زدن Enter"></div>' +
                   '</div>';
          }).join('');
        }

        /* ---------- تغییر نام درجا (اسلاگ و SEO دست‌نخورده) ---------- */
        function startRename(el) {
          if (el.dataset.editing === '1') return;
          var id = el.dataset.id;
          var original = el.textContent;
          el.dataset.editing = '1';
          el.classList.add('mb-editing');
          el.contentEditable = 'true';
          el.focus();
          try {
            var r = document.createRange(); r.selectNodeContents(el);
            var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
          } catch (e) {}

          function finish(save) {
            el.contentEditable = 'false';
            el.classList.remove('mb-editing');
            el.dataset.editing = '0';
            el.removeEventListener('keydown', onKey);
            el.removeEventListener('blur', onBlur);
            var val = el.textContent.replace(/\\s+/g, ' ').trim();
            if (!save || !val || val === original) { el.textContent = original; return; }
            if (val.length < 2 || val.length > 80) { el.textContent = original; toast('نام باید بین ۲ تا ۸۰ کاراکتر باشد', 'error'); return; }
            el.textContent = val;
            axios.patch('/api/admin/categories/' + id + '/name', { name: val })
              .then(function () { toast('نام تغییر کرد ✓', 'success'); updateLocal(id, function (c) { c.name = val; }); })
              .catch(function (err) { el.textContent = original; toast((err.response && err.response.data && err.response.data.message) || 'خطا در ذخیره', 'error'); });
          }
          function onKey(e) {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
          }
          function onBlur() { finish(true); }
          el.addEventListener('keydown', onKey);
          el.addEventListener('blur', onBlur);
        }

        function updateLocal(id, fn) {
          DATA.forEach(function (c) {
            if (String(c.id) === String(id)) fn(c);
            (c.children || []).forEach(function (sc) { if (String(sc.id) === String(id)) fn(sc); });
          });
        }

        /* ---------- نمایش/پنهان ---------- */
        async function toggleVisibility(id) {
          var cur = null;
          updateLocal(id, function (c) { cur = isVisible(c) ? 1 : 0; });
          var next = cur ? 0 : 1;
          try {
            await axios.patch('/api/admin/categories/' + id + '/menu-visibility', { show_in_menu: next });
            updateLocal(id, function (c) { c.show_in_menu = next; });
            render();
            toast(next ? 'در منو نمایش داده می‌شود ✓' : 'از منو پنهان شد ✓', 'success');
          } catch (err) {
            toast((err.response && err.response.data && err.response.data.message) || 'خطا', 'error');
          }
        }

        /* ---------- افزودن ---------- */
        async function addCategory(name, parentId) {
          var payload = {
            name: name,
            slug: uniqueSlug(name),
            parent_id: parentId ? parseInt(parentId) : null,
            sort_order: 999,
            show_in_menu: 1
          };
          try {
            await axios.post('/api/admin/categories', payload);
            toast('اضافه شد ✓', 'success');
            await load();
          } catch (err) {
            toast((err.response && err.response.data && err.response.data.message) || 'خطا در افزودن', 'error');
          }
        }

        /* ---------- ذخیره ترتیب ---------- */
        saveBtn.addEventListener('click', async function () {
          var items = [];
          Array.prototype.forEach.call(board.querySelectorAll('.mb-card'), function (card, ci) {
            items.push({ id: parseInt(card.dataset.id), sort_order: (ci + 1) * 10 });
            Array.prototype.forEach.call(card.querySelectorAll('.mb-subitem'), function (li, si) {
              items.push({ id: parseInt(li.dataset.id), sort_order: (si + 1) * 10 });
            });
          });
          try {
            await axios.post('/api/admin/categories/reorder', { items: items });
            clearDirty();
            toast('ترتیب ذخیره شد ✓', 'success');
            await load();
          } catch (err) {
            toast((err.response && err.response.data && err.response.data.message) || 'خطا در ذخیره ترتیب', 'error');
          }
        });

        document.getElementById('mb-add-col').addEventListener('click', function () {
          var name = window.prompt('نام دسته‌بندی اصلی جدید:');
          if (name && name.trim().length >= 2) addCategory(name.trim(), null);
        });

        /* ---------- رویدادها (delegation: بعد از هر render زنده می‌ماند) ---------- */
        board.addEventListener('click', function (e) {
          var t = e.target;
          var tog = t.closest && t.closest('.mb-toggle');
          if (tog) { e.preventDefault(); toggleVisibility(tog.dataset.id); return; }
          var nameEl = t.closest && (t.closest('.mb-title') || t.closest('.mb-sublabel'));
          if (nameEl) { startRename(nameEl); }
        });

        board.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter') return;
          var inp = e.target.closest && e.target.closest('.mb-addsub');
          if (!inp) return;
          e.preventDefault();
          var v = inp.value.trim();
          if (v.length < 2) { toast('نام حداقل ۲ کاراکتر', 'error'); return; }
          inp.value = '';
          addCategory(v, inp.dataset.parent);
        });

        /* ---------- درگ و اسقاط ---------- */
        var dragEl = null, dragKind = null;
        board.addEventListener('dragstart', function (e) {
          var li = e.target.closest && e.target.closest('.mb-subitem');
          var card = e.target.closest && e.target.closest('.mb-card');
          dragEl = li || card;
          dragKind = li ? 'sub' : 'col';
          if (!dragEl) return;
          dragEl.classList.add('dragging');
          try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragEl.dataset.id); } catch (err) {}
        });
        board.addEventListener('dragend', function () {
          if (dragEl) dragEl.classList.remove('dragging');
          Array.prototype.forEach.call(board.querySelectorAll('.mb-drop'), function (n) { n.classList.remove('mb-drop'); });
          dragEl = null; dragKind = null;
        });
        board.addEventListener('dragover', function (e) {
          if (!dragEl) return;
          e.preventDefault();
          if (dragKind === 'sub') {
            var list = e.target.closest && e.target.closest('.mb-sub');
            if (!list) return;
            var over = e.target.closest('.mb-subitem');
            if (over && over !== dragEl) {
              var rect = over.getBoundingClientRect();
              var after = (e.clientY - rect.top) > rect.height / 2;
              list.insertBefore(dragEl, after ? over.nextSibling : over);
              markDirty();
            } else if (!over) {
              list.appendChild(dragEl);
              markDirty();
            }
          } else {
            var overCard = e.target.closest && e.target.closest('.mb-card');
            if (overCard && overCard !== dragEl) {
              var r2 = overCard.getBoundingClientRect();
              var after2 = (e.clientX - r2.left) < r2.width / 2; /* RTL: چپ = بعدی */
              board.insertBefore(dragEl, after2 ? overCard.nextSibling : overCard);
              markDirty();
            }
          }
        });

        if (window.ncReady) window.ncReady(load); else load();
      })();
    </script>
  `;

    return adminLayout({ title: 'مدیریت منوی سایت', currentPath: '/admin/menu-builder' }, content);
}
