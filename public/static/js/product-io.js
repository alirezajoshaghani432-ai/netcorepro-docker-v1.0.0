/* =====================================================================
 *  Products Export / Import — admin UI (2026-11-03, owner voice note)
 *  «گزینهٔ export کل محصولات + گزینه‌ای که فایل export سایت دیگر را
 *   بریزیم داخلش تا دونه‌دونه دستی وارد نکنیم»
 * ---------------------------------------------------------------------
 *  Loaded only on /admin/products. Depends on admin.js helpers
 *  (axios, showModal, closeModal, toast, escAdmin, formatPrice, confirmAction)
 *  and on loadProducts() defined by the page.
 *  Excel support = SheetJS (vendored, lazy-loaded only when needed, offline).
 * ===================================================================== */
(function () {
  'use strict';
  var XLSX_SRC = '/static/js/vendor/xlsx.full.min.js?v=0.20.3';
  var esc = function (s) { return window.escAdmin ? window.escAdmin(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
  var fmt = function (n) { return window.formatPrice ? window.formatPrice(n) : String(n); };
  var errMsg = function (e, d) { return (e && e.response && e.response.data && e.response.data.message) || d || 'خطا'; };

  var xlsxPromise = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = XLSX_SRC; s.async = true;
      s.onload = function () { window.XLSX ? resolve(window.XLSX) : reject(new Error('xlsx')); };
      s.onerror = function () { xlsxPromise = null; reject(new Error('بارگذاری کتابخانهٔ اکسل ناموفق بود')); };
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }
  function stamp() { return new Date().toISOString().slice(0, 10); }
  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  // ------------------------------------------------------------------ EXPORT
  // Persian Excel headers — the importer understands them (and English keys).
  var FA_HEAD = [
    ['sku', 'کد محصول'], ['name', 'نام'], ['slug', 'نامک'], ['category', 'دسته‌بندی'], ['brand', 'برند'],
    ['price', 'قیمت'], ['discount_price', 'قیمت تخفیف'], ['stock', 'موجودی'], ['status', 'وضعیت'], ['featured', 'ویژه'],
    ['image', 'تصویر'], ['gallery', 'گالری'], ['short_description', 'توضیح کوتاه'], ['description', 'توضیحات'],
    ['key_features', 'ویژگی‌ها'], ['specs', 'مشخصات'], ['guarantee', 'گارانتی'], ['tax_percent', 'درصد مالیات'],
    ['seo_title', 'عنوان سئو'], ['seo_description', 'توضیحات سئو'], ['seo_keywords', 'کلمات کلیدی'], ['sort_order', 'ترتیب']
  ];
  function toSheetRow(it) {
    var o = {};
    FA_HEAD.forEach(function (h) {
      var k = h[0], v = it[k];
      if (k === 'status') v = v === 'active' ? 'فعال' : 'غیرفعال';
      else if (k === 'featured') v = Number(v) ? 'بله' : 'خیر';
      else if (k === 'gallery') v = (v || []).join(', ');
      else if (k === 'key_features') v = (v || []).map(function (x) { return typeof x === 'string' ? x : (x && x.text) || ''; }).filter(Boolean).join(' | ');
      else if (k === 'specs') v = (v || []).map(function (x) { return x && x.key ? x.key + ': ' + (x.value || '') : ''; }).filter(Boolean).join(' | ');
      o[h[1]] = (v === null || v === undefined) ? '' : v;
    });
    return o;
  }
  window.ncpExportProducts = async function (format) {
    try {
      toast('در حال آماده‌سازی خروجی...', 'info');
      if (format === 'csv') {
        var r1 = await axios.get('/api/product-io/export', { params: { format: 'csv' }, responseType: 'blob' });
        saveBlob(r1.data, 'products-' + stamp() + '.csv');
        toast('فایل CSV دانلود شد', 'success'); return;
      }
      var r = await axios.get('/api/product-io/export', { params: { format: 'json' } });
      var data = r.data.data;
      if (format === 'json') {
        saveBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), 'products-' + stamp() + '.json');
        toast('خروجی کامل (' + fmt(data.count) + ' محصول) دانلود شد', 'success'); return;
      }
      var X = await loadXlsx();
      var ws = X.utils.json_to_sheet(data.items.map(toSheetRow), { header: FA_HEAD.map(function (h) { return h[1]; }) });
      ws['!cols'] = FA_HEAD.map(function (h) { return { wch: ({ name: 40, description: 50, category: 28, image: 40, gallery: 30 })[h[0]] || 14 }; });
      var wb = X.utils.book_new();
      wb.Workbook = { Views: [{ RTL: true }] };
      X.utils.book_append_sheet(wb, ws, 'محصولات');
      X.writeFile(wb, 'products-' + stamp() + '.xlsx');
      toast('فایل اکسل (' + fmt(data.count) + ' محصول) دانلود شد', 'success');
    } catch (e) { toast(errMsg(e, 'خطا در گرفتن خروجی'), 'error'); }
  };
  window.ncpDownloadTemplate = async function () {
    try {
      var X = await loadXlsx();
      var ex = { 'کد محصول': 'SW-0001', 'نام': 'سوئیچ ۸ پورت نمونه', 'نامک': '', 'دسته‌بندی': 'سوییچ شبکه > سوییچ 8 پورت', 'برند': 'TP-Link',
        'قیمت': 2500000, 'قیمت تخفیف': 2300000, 'موجودی': 10, 'وضعیت': 'فعال', 'ویژه': 'خیر', 'تصویر': 'https://example.com/image.jpg',
        'گالری': '', 'توضیح کوتاه': 'توضیح کوتاه محصول', 'توضیحات': 'توضیحات کامل محصول', 'ویژگی‌ها': 'ویژگی ۱ | ویژگی ۲',
        'مشخصات': 'تعداد پورت: 8 | سرعت: 1Gbps', 'گارانتی': '۱۸ ماه', 'درصد مالیات': '', 'عنوان سئو': '', 'توضیحات سئو': '', 'کلمات کلیدی': '', 'ترتیب': '' };
      var ws = X.utils.json_to_sheet([ex], { header: FA_HEAD.map(function (h) { return h[1]; }) });
      ws['!cols'] = FA_HEAD.map(function () { return { wch: 18 }; });
      var wb = X.utils.book_new(); wb.Workbook = { Views: [{ RTL: true }] };
      X.utils.book_append_sheet(wb, ws, 'محصولات');
      X.writeFile(wb, 'products-template.xlsx');
    } catch (e) { toast(errMsg(e, 'خطا'), 'error'); }
  };

  // ------------------------------------------------------------------ IMPORT
  var STATE = { rows: [], headers: [], source: '', opts: null };

  function rowsFromJson(text) {
    var j = JSON.parse(text);
    if (j && j.data && Array.isArray(j.data.items)) return j.data.items;   // this site's export (API shape)
    if (j && Array.isArray(j.items)) return j.items;                      // this site's export (file)
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.products)) return j.products;
    throw new Error('ساختار فایل JSON شناخته نشد');
  }
  async function rowsFromTable(input, isText) {
    var X = await loadXlsx();
    var wb = isText ? X.read(input, { type: 'string', raw: false }) : X.read(input, { type: 'array', cellDates: false });
    var name = wb.SheetNames[0];
    if (!name) throw new Error('فایل خالی است');
    return X.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false });
  }
  function readFileAs(file, how) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(new Error('خواندن فایل ناموفق بود')); };
      how === 'text' ? fr.readAsText(file, 'UTF-8') : fr.readAsArrayBuffer(file);
    });
  }
  async function parseInput() {
    var file = document.getElementById('pio-file').files[0];
    var paste = (document.getElementById('pio-paste').value || '').trim();
    var rows;
    if (file) {
      if (file.size > 25 * 1024 * 1024) throw new Error('حجم فایل بیش از ۲۵ مگابایت است');
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      if (ext === 'json') rows = rowsFromJson(await readFileAs(file, 'text'));
      else if (ext === 'csv' || ext === 'tsv' || ext === 'txt') rows = await rowsFromTable((await readFileAs(file, 'text')).replace(/^\uFEFF/, ''), true);
      else rows = await rowsFromTable(await readFileAs(file, 'buf'), false);
      STATE.source = file.name;
    } else if (paste) {
      rows = /^[\[{]/.test(paste) ? rowsFromJson(paste) : await rowsFromTable(paste, true);
      STATE.source = 'متن کپی‌شده';
    } else throw new Error('یک فایل انتخاب کنید یا جدول را در کادر بچسبانید');
    rows = (rows || []).filter(function (r) { return r && typeof r === 'object' && Object.keys(r).some(function (k) { return String(r[k] == null ? '' : r[k]).trim() !== ''; }); });
    if (!rows.length) throw new Error('هیچ ردیفی در فایل پیدا نشد');
    if (rows.length > 5000) throw new Error('حداکثر ۵۰۰۰ محصول در هر بار ورود');
    var hs = {}; rows.slice(0, 50).forEach(function (r) { Object.keys(r).forEach(function (k) { hs[k] = 1; }); });
    STATE.rows = rows; STATE.headers = Object.keys(hs);
    return rows;
  }
  function options() {
    return {
      mode: document.getElementById('pio-mode').value,
      price_unit: document.getElementById('pio-unit').value,
      status: document.getElementById('pio-status').value || null,
      default_stock: document.getElementById('pio-stock').value === '' ? null : Number(document.getElementById('pio-stock').value),
      create_missing: document.getElementById('pio-create').checked,
      download_images: document.getElementById('pio-images').checked
    };
  }
  async function runBatches(dry, onProgress, opts) {
    opts = opts || options();
    var size = (!dry && opts.download_images) ? 10 : 50;
    var all = { summary: { create: 0, update: 0, skip: 0, error: 0 }, results: [], cats: {}, brands: {} };
    for (var i = 0; i < STATE.rows.length; i += size) {
      var r = await axios.post('/api/product-io/import', { rows: STATE.rows.slice(i, i + size), options: opts, dry_run: dry, row_offset: i }, { timeout: 0 });
      var d = r.data.data;
      ['create', 'update', 'skip', 'error'].forEach(function (k) { all.summary[k] += d.summary[k] || 0; });
      all.results = all.results.concat(d.results || []);
      (d.new_categories || []).forEach(function (c) { all.cats[c] = 1; });
      (d.new_brands || []).forEach(function (b) { all.brands[b] = 1; });
      onProgress && onProgress(Math.min(STATE.rows.length, i + size), STATE.rows.length);
    }
    return all;
  }
  var ACT = {
    create: ['محصول جدید', 'bg-emerald-100 text-emerald-700'],
    update: ['به‌روزرسانی', 'bg-indigo-100 text-indigo-700'],
    skip: ['نادیده', 'bg-slate-100 text-slate-500'],
    error: ['خطا', 'bg-rose-100 text-rose-700']
  };
  function renderReport(all, dry) {
    var s = all.summary;
    var box = function (k, label) { return '<div class="rounded-lg px-3 py-2 ' + ACT[k][1] + '"><div class="text-[11px]">' + label + '</div><div class="font-bold text-lg">' + fmt(s[k]) + '</div></div>'; };
    var cats = Object.keys(all.cats), brands = Object.keys(all.brands);
    var interesting = all.results.filter(function (r) { return r.action !== 'update' || r.message; });
    var list = (interesting.length ? interesting : all.results).slice(0, 300);
    return '<div class="space-y-3">' +
      '<div class="text-sm font-bold">' + (dry ? 'پیش‌نمایش (هنوز چیزی ذخیره نشده):' : 'نتیجهٔ نهایی:') + ' <span class="font-normal text-slate-500">' + fmt(STATE.rows.length) + ' ردیف از «' + esc(STATE.source) + '»</span></div>' +
      '<div class="grid grid-cols-4 gap-2 text-center">' + box('create', 'جدید') + box('update', 'به‌روزرسانی') + box('skip', 'نادیده') + box('error', 'خطا') + '</div>' +
      (cats.length ? '<div class="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2"><b>دسته‌های جدید' + (dry ? ' که ساخته می‌شوند' : ' ساخته‌شده') + ':</b> ' + cats.map(esc).join(' ، ') + '</div>' : '') +
      (brands.length ? '<div class="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2"><b>برندهای جدید:</b> ' + brands.map(esc).join(' ، ') + '</div>' : '') +
      (list.length ? '<div class="max-h-64 overflow-y-auto border rounded-lg"><table class="w-full text-xs"><thead class="bg-slate-50 sticky top-0"><tr><th class="p-2 text-right">ردیف</th><th class="p-2 text-right">محصول</th><th class="p-2 text-right">عملیات</th><th class="p-2 text-right">توضیح</th></tr></thead><tbody>' +
        list.map(function (r) { var a = ACT[r.action] || ACT.skip; return '<tr class="border-t"><td class="p-2">' + fmt(r.row) + '</td><td class="p-2">' + esc(r.name || '-') + '</td><td class="p-2"><span class="rounded px-1.5 py-0.5 ' + a[1] + '">' + a[0] + '</span></td><td class="p-2 text-slate-500">' + esc(r.message || '') + '</td></tr>'; }).join('') +
        '</tbody></table></div>' + (interesting.length > 300 ? '<div class="text-[11px] text-slate-400">فقط ۳۰۰ ردیف اول نمایش داده شد.</div>' : '') : '') +
      '</div>';
  }

  window.ncpOpenImport = function () {
    STATE = { rows: [], headers: [], source: '', opts: null };
    showModal('ورود گروهی محصولات (Import)', '' +
      '<div class="space-y-4 text-sm">' +
      '  <div class="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-xs leading-6 text-indigo-900">' +
      '    فایل خروجی همین سایت، خروجی <b>ووکامرس (وردپرس)</b>، فایل <b>اکسل</b> یا <b>CSV</b> را انتخاب کنید — یا جدول را از اکسل کپی و پایین بچسبانید.' +
      '    محصولات بر اساس <b>کد محصول (SKU)</b>، سپس نامک و نام تطبیق داده می‌شوند: اگر وجود داشته باشند به‌روزرسانی و اگر نه ساخته می‌شوند. خانه‌های خالی فایل، اطلاعات فعلی را پاک نمی‌کنند.' +
      '    <a href="javascript:void(0)" onclick="ncpDownloadTemplate()" class="text-indigo-700 font-bold underline mr-1">دانلود فایل نمونهٔ اکسل</a>' +
      '  </div>' +
      '  <div class="grid md:grid-cols-2 gap-3">' +
      '    <div><label class="block font-medium mb-1"><i class="fas fa-file-arrow-up ml-1 text-indigo-500"></i>انتخاب فایل</label>' +
      '      <input id="pio-file" type="file" accept=".xlsx,.xls,.csv,.tsv,.txt,.json,.ods" class="w-full border rounded-lg px-3 py-2 text-xs bg-white">' +
      '      <p class="text-[11px] text-slate-400 mt-1">Excel (xlsx/xls)، CSV، TSV یا JSON</p></div>' +
      '    <div><label class="block font-medium mb-1"><i class="fas fa-paste ml-1 text-indigo-500"></i>یا چسباندن جدول / متن</label>' +
      '      <textarea id="pio-paste" rows="3" dir="auto" placeholder="ردیف اول باید نام ستون‌ها باشد (مثلاً: نام، قیمت، موجودی، دسته‌بندی)" class="w-full border rounded-lg px-3 py-2 text-xs"></textarea></div>' +
      '  </div>' +
      '  <div class="grid md:grid-cols-3 gap-3 border-t pt-3">' +
      '    <div><label class="block text-xs mb-1 text-slate-600">نحوهٔ ورود</label><select id="pio-mode" class="w-full border rounded-lg px-2 py-2 text-xs">' +
      '      <option value="upsert">جدیدها ساخته شوند + موجودها به‌روز شوند</option><option value="create">فقط محصولات جدید (موجودها دست نخورند)</option><option value="update">فقط به‌روزرسانی موجودها (مثلاً قیمت/موجودی)</option></select></div>' +
      '    <div><label class="block text-xs mb-1 text-slate-600">واحد قیمت در فایل</label><select id="pio-unit" class="w-full border rounded-lg px-2 py-2 text-xs">' +
      '      <option value="toman">تومان</option><option value="rial">ریال (تقسیم بر ۱۰ می‌شود)</option></select></div>' +
      '    <div><label class="block text-xs mb-1 text-slate-600">وضعیت محصولات</label><select id="pio-status" class="w-full border rounded-lg px-2 py-2 text-xs">' +
      '      <option value="">مطابق فایل (پیش‌فرض: فعال)</option><option value="active">همه فعال</option><option value="inactive">همه غیرفعال (بعداً بررسی می‌کنم)</option></select></div>' +
      '    <div><label class="block text-xs mb-1 text-slate-600">موجودی پیش‌فرض محصولات جدید بدون موجودی</label><input id="pio-stock" type="number" min="0" placeholder="خالی = ۰" class="w-full border rounded-lg px-2 py-2 text-xs"></div>' +
      '    <label class="flex items-center gap-2 text-xs md:mt-5"><input id="pio-create" type="checkbox" checked> دسته‌ها و برندهای ناموجود ساخته شوند</label>' +
      '    <label class="flex items-center gap-2 text-xs md:mt-5" title="عکس‌ها روی همین سایت ذخیره می‌شوند تا به سایت مبدأ وابسته نباشید"><input id="pio-images" type="checkbox" checked> عکس‌ها دانلود و روی سایت ذخیره شوند</label>' +
      '  </div>' +
      '  <div id="pio-progress" class="hidden"><div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div id="pio-bar" class="h-2 bg-indigo-500 transition-all" style="width:0%"></div></div><div id="pio-ptext" class="text-[11px] text-slate-500 mt-1"></div></div>' +
      '  <div id="pio-report"></div>' +
      '  <div id="pio-confirm" class="hidden bg-amber-50 border border-amber-300 rounded-lg p-3 text-sm">' +
      '    <div class="font-bold text-amber-800 mb-2"><i class="fas fa-triangle-exclamation ml-1"></i><span id="pio-confirm-text"></span></div>' +
      '    <div class="flex gap-2"><button type="button" id="pio-confirm-yes" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded-lg text-sm">بله، اعمال شود</button>' +
      '    <button type="button" id="pio-confirm-no" class="px-4 py-1.5 bg-white border rounded-lg text-sm">انصراف</button></div>' +
      '  </div>' +
      '  <div class="flex gap-2 pt-3 border-t flex-wrap">' +
      '    <button type="button" id="pio-preview" class="btn-indigo text-white px-5 py-2 rounded-lg text-sm"><i class="fas fa-magnifying-glass ml-1"></i>بررسی و پیش‌نمایش</button>' +
      '    <button type="button" id="pio-apply" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg text-sm hidden"><i class="fas fa-check ml-1"></i>اعمال نهایی</button>' +
      '    <button type="button" onclick="closeModal(true)" class="px-5 py-2 bg-slate-200 rounded-lg text-sm">بستن</button>' +
      '  </div>' +
      '</div>', { size: '3xl' });

    var busy = false;
    var prog = function (done, total) {
      document.getElementById('pio-progress').classList.remove('hidden');
      document.getElementById('pio-bar').style.width = Math.round(done * 100 / total) + '%';
      document.getElementById('pio-ptext').textContent = fmt(done) + ' از ' + fmt(total) + ' ردیف';
    };
    var lock = function (on) { busy = on; ['pio-preview', 'pio-apply'].forEach(function (id) { var b = document.getElementById(id); if (b) b.disabled = on; }); };
    // any input change invalidates the previous preview
    ['pio-file', 'pio-paste', 'pio-mode', 'pio-unit', 'pio-status', 'pio-stock', 'pio-create', 'pio-images'].forEach(function (id) {
      var el = document.getElementById(id);
      el && el.addEventListener('change', function () { document.getElementById('pio-apply').classList.add('hidden'); document.getElementById('pio-confirm').classList.add('hidden'); STATE.opts = null; });
    });
    document.getElementById('pio-preview').addEventListener('click', async function () {
      if (busy) return; lock(true);
      var rep = document.getElementById('pio-report');
      try {
        rep.innerHTML = '<div class="text-center py-4"><span class="spinner"></span> در حال خواندن فایل...</div>';
        await parseInput();
        STATE.opts = options();
        var all = await runBatches(true, prog, STATE.opts);
        rep.innerHTML = renderReport(all, true) +
          '<div class="text-[11px] text-slate-400 mt-2">ستون‌های فایل: ' + STATE.headers.slice(0, 40).map(esc).join(' ، ') + '</div>';
        if (all.summary.create + all.summary.update > 0) document.getElementById('pio-apply').classList.remove('hidden');
        else toast('هیچ محصولی برای ورود پیدا نشد — نام ستون‌ها را بررسی کنید', 'warning');
      } catch (e) { rep.innerHTML = '<div class="text-rose-600 text-sm bg-rose-50 rounded-lg p-3">' + esc(e.message && !e.response ? e.message : errMsg(e, 'خطا در بررسی فایل')) + '</div>'; }
      finally { lock(false); }
    });
    document.getElementById('pio-apply').addEventListener('click', function () {
      if (busy || !STATE.rows.length || !STATE.opts) return;
      document.getElementById('pio-confirm-text').textContent = 'ورود ' + fmt(STATE.rows.length) + ' ردیف انجام شود؟ محصولات جدید ساخته و محصولات موجود به‌روزرسانی می‌شوند.';
      document.getElementById('pio-confirm').classList.remove('hidden');
      document.getElementById('pio-confirm').scrollIntoView({ block: 'nearest' });
    });
    document.getElementById('pio-confirm-no').addEventListener('click', function () { document.getElementById('pio-confirm').classList.add('hidden'); });
    document.getElementById('pio-confirm-yes').addEventListener('click', async function () {
      if (busy || !STATE.rows.length || !STATE.opts) return;
      document.getElementById('pio-confirm').classList.add('hidden');
      lock(true);
      var rep = document.getElementById('pio-report');
      try {
        var all = await runBatches(false, prog, STATE.opts);
        rep.innerHTML = renderReport(all, false);
        document.getElementById('pio-apply').classList.add('hidden');
        STATE.opts = null; // a second click can never re-run the same import by accident
        toast('ورود انجام شد: ' + fmt(all.summary.create) + ' جدید، ' + fmt(all.summary.update) + ' به‌روزرسانی', 'success');
        if (typeof window.loadProducts === 'function') window.loadProducts();
      } catch (e) { rep.insertAdjacentHTML('afterbegin', '<div class="text-rose-600 text-sm bg-rose-50 rounded-lg p-3 mb-2">' + esc(errMsg(e, 'خطا در ورود اطلاعات')) + ' — ردیف‌های قبلی ذخیره شده‌اند؛ می‌توانید دوباره اجرا کنید (تکراری ساخته نمی‌شود).</div>'); }
      finally { lock(false); }
    });
  };
})();
