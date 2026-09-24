/* معاملات ومستندات إضافية: مرتجعات، طباعة A4، باركود، وشعار بعلامة مائية. */
(function () {
  'use strict';
  const DB_NAME = 'universal-retail-local';
  const STATE_STORE = 'app-state';
  const QUEUE_DB = 'universal-retail-sync-queue';
  const QUEUE_STORE = 'operations';
  const STATE_KEY = 'singleton';

  function openDb(name, version, upgrade) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onupgradeneeded = () => upgrade?.(request.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function readState() {
    const db = await openDb(DB_NAME, 2, (r) => {
      if (!r.objectStoreNames.contains(STATE_STORE)) r.createObjectStore(STATE_STORE);
    });
    return new Promise((resolve, reject) => {
      const q = db.transaction(STATE_STORE, 'readonly').objectStore(STATE_STORE).get(STATE_KEY);
      q.onsuccess = () => resolve(q.result || {});
      q.onerror = () => reject(q.error);
    });
  }
  async function writeState(state) {
    const db = await openDb(DB_NAME, 2, (r) => {
      if (!r.objectStoreNames.contains(STATE_STORE)) r.createObjectStore(STATE_STORE);
    });
    return new Promise((resolve, reject) => {
      const q = db.transaction(STATE_STORE, 'readwrite').objectStore(STATE_STORE).put(state, STATE_KEY);
      q.onsuccess = resolve;
      q.onerror = () => reject(q.error);
    });
  }
  async function queueOperation(payload) {
    const db = await openDb(QUEUE_DB, 1, (r) => {
      if (!r.objectStoreNames.contains(QUEUE_STORE)) r.createObjectStore(QUEUE_STORE, { keyPath: 'operationId' });
    });
    const operation = { ...payload, operationId: crypto.randomUUID(), createdAt: new Date().toISOString() };
    return new Promise((resolve, reject) => {
      const q = db.transaction(QUEUE_STORE, 'readwrite').objectStore(QUEUE_STORE).put(operation);
      q.onsuccess = () => resolve(operation.operationId);
      q.onerror = () => reject(q.error);
    });
  }
  async function createReturn({ sale, items, reason = '', customerId = null }) {
    if (!sale?.id || !Array.isArray(items) || !items.length) throw new Error('اختر فاتورة وأصنافاً صحيحة للمرتجع.');
    const state = await readState();
    const selected = items.map((item) => ({
      productId: item.productId, name: item.name, quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      total: (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)
    })).filter((item) => item.quantity > 0);
    if (!selected.length) throw new Error('أدخل كمية مرتجعة أكبر من صفر.');
    const record = {
      id: crypto.randomUUID(), businessId: state.business?.id || sale.businessId, saleId: sale.id,
      invoiceNumber: sale.invoiceNumber, customerId, items: selected,
      total: selected.reduce((sum, item) => sum + item.total, 0),
      reason: String(reason || '').trim(), status: 'completed', createdAt: new Date().toISOString()
    };
    const returns = Array.isArray(state.returns) ? state.returns : [];
    const products = (state.products || []).map((product) => {
      const returned = selected.filter((item) => item.productId === product.id)
        .reduce((sum, item) => sum + item.quantity, 0);
      return returned ? { ...product, stockOnHand: Number(product.stockOnHand || 0) + returned, updatedAt: record.createdAt } : product;
    });
    await writeState({ ...state, products, returns: [...returns, record] });
    await queueOperation({ entityType: 'return', entityId: record.id, operation: 'create', payload: record });
    return record;
  }
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
  }
  function printA4({ title, business, meta = [], columns = [], rows = [], totals = [] }) {
    const storeLogo = business?.logoUrl || new URL('./company-logo.png', window.location.href).href;
    const companyLogo = new URL('./company-logo.png', window.location.href).href;
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>
      @page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;color:#172238;font-family:Arial,Tahoma,sans-serif;background:#fff}
      .page{position:relative;min-height:260mm;z-index:1}.watermark{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;opacity:.07;z-index:-1}
      .watermark img{width:92mm;height:92mm;object-fit:contain}.head{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2px solid #162238;padding-bottom:12px}
      .head img{width:27mm;height:27mm;object-fit:contain}.head h1{font-size:20px;margin:0 0 5px}.muted{color:#68758b;font-size:11px}
      .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin:16px 0;padding:10px;border:1px solid #dfe5ee;border-radius:7px;font-size:11px}
      table{width:100%;border-collapse:collapse;font-size:11px}th{background:#152238;color:#fff;padding:8px;text-align:right}td{border-bottom:1px solid #e4e8ef;padding:8px}
      .totals{width:48%;margin-top:14px;border:1px solid #dfe5ee}.totals div{display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid #e4e8ef}.totals div:last-child{border:0;font-weight:bold}
      .footer{margin-top:24px;padding-top:10px;border-top:1px solid #dfe5ee;text-align:center;color:#7b8797;font-size:10px}@media print{button{display:none!important}}
      </style></head><body><div class="watermark"><img src="${esc(companyLogo)}" alt=""></div><main class="page">
      <header class="head"><div><h1>${esc(title)}</h1>${meta.map((item) => `<div class="muted">${esc(item)}</div>`).join('')}</div><img src="${esc(storeLogo)}" alt="${esc(business?.name || '')}"></header>
      <div class="meta"><div><b>المحل:</b> ${esc(business?.name || '')}</div><div><b>النشاط:</b> ${esc(business?.businessTypeLabel || business?.businessType || '')}</div><div><b>الهاتف:</b> ${esc(business?.phone || '')}</div><div><b>العنوان:</b> ${esc(business?.address || '')}</div></div>
      <table><thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      ${totals.length ? `<div class="totals">${totals.map((item) => `<div><span>${esc(item[0])}</span><span>${esc(item[1])}</span></div>`).join('')}</div>` : ''}
      <div class="footer">${esc(business?.receiptFooter || 'شكراً لتعاملكم معنا')}</div></main>
      <script>window.onload=()=>setTimeout(()=>window.print(),180);<\/script></body></html>`;
    if (window.AndroidPrinter?.printHtml) return window.AndroidPrinter.printHtml(html);
    const root = document.createElement('div');
    root.id = 'najah-print-root';
    root.innerHTML = `<style>@media screen{#najah-print-root{display:none}}@media print{body>*:not(#najah-print-root){display:none!important}#najah-print-root{display:block!important}}</style>${html}`;
    document.body.appendChild(root);
    const cleanup = () => { root.remove(); window.removeEventListener('afterprint', cleanup); };
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    return true;
  }
  async function printBarcodeLabel(product, business) {
    if (!product) throw new Error('اختر منتجاً لطباعة الباركود.');
    const barcode = product.barcode || product.sku;
    if (!barcode) throw new Error('أضف باركود أو SKU للمنتج أولاً.');
    return printA4({
      title: 'بطاقة باركود', business, meta: [product.name, `الرمز: ${barcode}`],
      columns: ['المنتج', 'الباركود', 'سعر البيع'],
      rows: [[product.name, barcode, `${product.sellingPrice || 0} ${business?.currency || ''}`]]
    });
  }
  function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
  async function exportProducts() {
    const state = await readState();
    const columns = ['name', 'sku', 'barcode', 'category', 'unit', 'purchasePrice', 'sellingPrice', 'wholesalePrice', 'stockOnHand', 'minimumStockLevel'];
    const rows = [columns, ...(state.products || []).map((product) => columns.map((column) => product[column] ?? ''))];
    downloadText(`products-${new Date().toISOString().slice(0, 10)}.csv`, '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  }
  function parseCsv(text) {
    const lines = text.replace(/^\ufeff/, '').split(/\r?\n/).filter(Boolean);
    return lines.map((line) => {
      const values = []; let value = ''; let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"' && line[i + 1] === '"') { value += '"'; i += 1; }
        else if (char === '"') quoted = !quoted;
        else if (char === ',' && !quoted) { values.push(value.trim()); value = ''; }
        else value += char;
      }
      values.push(value.trim()); return values;
    });
  }
  async function importProducts(file) {
    const rows = parseCsv(await file.text());
    if (rows.length < 2) throw new Error('ملف CSV لا يحتوي على منتجات.');
    const headers = rows[0].map((header) => ({
      الاسم: 'name', المنتج: 'name', name: 'name', sku: 'sku', الرمز: 'sku', barcode: 'barcode', الباركود: 'barcode',
      category: 'category', التصنيف: 'category', unit: 'unit', الوحدة: 'unit', purchasePrice: 'purchasePrice', 'سعر الشراء': 'purchasePrice',
      sellingPrice: 'sellingPrice', 'سعر البيع': 'sellingPrice', wholesalePrice: 'wholesalePrice', 'سعر الجملة': 'wholesalePrice',
      stockOnHand: 'stockOnHand', المخزون: 'stockOnHand', minimumStockLevel: 'minimumStockLevel', 'الحد الأدنى': 'minimumStockLevel'
    }[header] || header));
    const state = await readState(); const products = [...(state.products || [])]; let imported = 0;
    for (const values of rows.slice(1)) {
      const data = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
      if (!String(data.name || '').trim() || !String(data.sku || '').trim()) continue;
      const normalized = {
        id: products.find((product) => product.sku === data.sku)?.id || crypto.randomUUID(),
        name: String(data.name).trim(), sku: String(data.sku).trim(), barcode: String(data.barcode || '').trim(),
        category: String(data.category || '').trim(), unit: String(data.unit || 'قطعة').trim(),
        purchasePrice: Number(data.purchasePrice || 0), sellingPrice: Number(data.sellingPrice || 0),
        wholesalePrice: Number(data.wholesalePrice || 0), stockOnHand: Number(data.stockOnHand || 0),
        minimumStockLevel: Number(data.minimumStockLevel || 0), isActive: true, updatedAt: new Date().toISOString()
      };
      if (![normalized.purchasePrice, normalized.sellingPrice, normalized.stockOnHand, normalized.minimumStockLevel].every((number) => Number.isFinite(number) && number >= 0)) continue;
      const index = products.findIndex((product) => product.sku === normalized.sku);
      if (index >= 0) products[index] = { ...products[index], ...normalized };
      else products.push({ ...normalized, createdAt: normalized.updatedAt });
      await queueOperation({ entityType: 'product', entityId: normalized.id, operation: 'upsert', payload: normalized });
      imported += 1;
    }
    await writeState({ ...state, products });
    return imported;
  }
  async function downloadBackup() {
    const state = await readState();
    downloadText(`najah-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), state }, null, 2), 'application/json;charset=utf-8');
  }
  async function restoreBackup(file) {
    const parsed = JSON.parse(await file.text());
    const state = parsed?.state || parsed;
    if (!state || !Array.isArray(state.products) || !Array.isArray(state.sales)) throw new Error('ملف النسخة الاحتياطية غير صالح.');
    await writeState(state);
    window.location.reload();
  }
  async function createStockAdjustment(product, countedQuantity, reason = 'جرد دوري') {
    const state = await readState();
    const current = Number(product.stockOnHand || 0); const counted = Number(countedQuantity);
    if (!Number.isFinite(counted) || counted < 0) throw new Error('أدخل كمية فعلية صحيحة.');
    const delta = counted - current; if (delta === 0) return null;
    const adjustment = { id: crypto.randomUUID(), businessId: state.business?.id, productId: product.id, previousQuantity: current, countedQuantity: counted, quantityDelta: delta, reason, createdAt: new Date().toISOString() };
    const products = (state.products || []).map((item) => item.id === product.id ? { ...item, stockOnHand: counted, updatedAt: adjustment.createdAt } : item);
    const adjustments = Array.isArray(state.stockAdjustments) ? state.stockAdjustments : [];
    await writeState({ ...state, products, stockAdjustments: [...adjustments, adjustment] });
    await queueOperation({ entityType: 'stock_adjustment', entityId: adjustment.id, operation: 'create', payload: adjustment });
    return adjustment;
  }
  function injectUi() {
    if (!document.querySelector('.app-shell') || document.querySelector('[data-najah-feature-button]')) return;
    const style = document.createElement('style');
    style.textContent = `.najah-feature-actions{position:fixed;left:16px;bottom:16px;z-index:30;direction:rtl}.najah-feature-actions>button{border:1px solid #dbe3ee;border-radius:10px;background:#087f78;color:#fff;padding:9px 14px;box-shadow:0 8px 24px #13243a1a;font:600 12px Cairo,Arial;cursor:pointer}.najah-tools-menu{position:absolute;left:0;bottom:45px;width:205px;padding:8px;border:1px solid #dbe3ee;border-radius:13px;background:#fff;box-shadow:0 14px 34px #13243a26;display:grid;gap:5px}.najah-tools-menu[hidden]{display:none}.najah-tools-menu button{border:1px solid #e4eaf2;border-radius:8px;background:#fff;color:#1a2941;padding:8px 10px;text-align:right;font:600 11px Cairo,Arial;cursor:pointer}.najah-tools-menu button:hover{background:#eef8f7;border-color:#087f78}.najah-feature-modal{position:fixed;inset:0;background:#07111c99;z-index:40;display:grid;place-items:center;padding:16px;direction:rtl}.najah-feature-card{width:min(760px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:18px;padding:22px;box-shadow:0 22px 60px #00111e55}.najah-feature-card h2{margin:0 0 12px;color:#142238}.najah-feature-card input,.najah-feature-card textarea{width:100%;border:1px solid #dbe3ee;border-radius:9px;padding:10px;margin:5px 0 12px}.najah-feature-list{display:grid;gap:8px}.najah-feature-list label{display:grid;grid-template-columns:1fr 90px;gap:10px;align-items:center;border:1px solid #e5eaf1;border-radius:9px;padding:9px}.najah-feature-actions-row{display:flex;gap:8px;justify-content:flex-start;margin-top:14px}.najah-feature-actions-row button{padding:10px 16px;border:0;border-radius:9px;cursor:pointer}.najah-ok{background:#087f78;color:#fff}.najah-cancel{background:#eef2f7;color:#263750}@media(max-width:700px){.najah-feature-actions{left:10px;bottom:10px}.najah-tools-menu{width:190px}}`;
    document.head.appendChild(style);
    const actions = document.createElement('div');
    actions.className = 'najah-feature-actions';
    actions.dataset.najahFeatureButton = 'true';
    actions.innerHTML = '<button type="button" data-najah-tools aria-expanded="false">أدوات</button><div class="najah-tools-menu" data-najah-tools-menu hidden><button type="button" data-najah-inventory>جرد دوري</button><button type="button" data-najah-export>تصدير المنتجات</button><button type="button" data-najah-import>استيراد المنتجات</button><button type="button" data-najah-backup>نسخة احتياطية</button><button type="button" data-najah-return>مرتجع فاتورة</button><button type="button" data-najah-purchase>فاتورة مورد</button><button type="button" data-najah-barcode>طباعة باركود</button></div>';
    document.body.appendChild(actions);
    const toolsButton = actions.querySelector('[data-najah-tools]');
    const toolsMenu = actions.querySelector('[data-najah-tools-menu]');
    toolsButton.onclick = (event) => { event.stopPropagation(); toolsMenu.hidden = !toolsMenu.hidden; toolsButton.setAttribute('aria-expanded', String(!toolsMenu.hidden)); };
    document.addEventListener('click', (event) => { if (!actions.contains(event.target)) { toolsMenu.hidden = true; toolsButton.setAttribute('aria-expanded', 'false'); } }, { passive: true });
    actions.querySelector('[data-najah-inventory]').onclick = () => openInventoryDialog();
    actions.querySelector('[data-najah-export]').onclick = () => exportProducts().catch((error) => alert(error.message));
    actions.querySelector('[data-najah-import]').onclick = () => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = '.csv,text/csv';
      input.onchange = async () => { try { const count = await importProducts(input.files?.[0]); alert(`تم استيراد أو تحديث ${count} منتج.`); window.location.reload(); } catch (error) { alert(error.message || 'تعذر استيراد المنتجات.'); } };
      input.click();
    };
    actions.querySelector('[data-najah-backup]').onclick = () => {
      const root = dialog('النسخ الاحتياطية', '<p>يمكنك تنزيل نسخة كاملة أو استعادتها. لا تغلق التطبيق أثناء الاستعادة.</p><div class="najah-feature-actions-row"><button class="najah-ok" type="button" data-download-backup>تنزيل نسخة كاملة</button><label class="najah-cancel">استعادة نسخة<input type="file" accept=".json,application/json" hidden data-restore-backup></label><button class="najah-cancel" type="button" data-close>إغلاق</button></div>');
      root.querySelector('[data-download-backup]').onclick = () => downloadBackup();
      root.querySelector('[data-restore-backup]').onchange = async (event) => { try { await restoreBackup(event.target.files?.[0]); } catch (error) { alert(error.message || 'تعذر استعادة النسخة.'); } };
      root.querySelector('[data-close]').onclick = closeDialog;
    };
    actions.querySelector('[data-najah-return]').onclick = () => openReturnDialog();
    actions.querySelector('[data-najah-purchase]').onclick = () => openPurchaseDialog();
    actions.querySelector('[data-najah-barcode]').onclick = () => openBarcodeDialog();
  }
  function closeDialog() { document.querySelector('.najah-feature-modal')?.remove(); }
  function dialog(title, body) {
    closeDialog();
    const root = document.createElement('div');
    root.className = 'najah-feature-modal';
    root.innerHTML = `<div class="najah-feature-card"><h2>${title}</h2>${body}</div>`;
    root.onclick = (event) => { if (event.target === root) closeDialog(); };
    document.body.appendChild(root);
    return root;
  }
  async function openReturnDialog() {
    const state = await readState();
    const sales = Array.isArray(state.sales) ? state.sales.slice().reverse() : [];
    const root = dialog('مرتجع مبيعات', `<label>ابحث عن رقم الفاتورة<input data-return-search placeholder="رقم الفاتورة أو اسم العميل"></label><div class="najah-feature-list" data-return-sales>${sales.map((sale) => `<button type="button" class="najah-cancel" data-sale-id="${esc(sale.id)}">${esc(sale.invoiceNumber)} — ${esc(sale.customerName || 'زبون عادي')} — ${esc(sale.total || 0)}</button>`).join('') || '<p>لا توجد فواتير مبيعات بعد.</p>'}</div><div data-return-form></div><div class="najah-feature-actions-row"><button class="najah-cancel" type="button" data-close>إغلاق</button></div>`);
    root.querySelector('[data-close]').onclick = closeDialog;
    const search = root.querySelector('[data-return-search]');
    search.oninput = () => root.querySelectorAll('[data-sale-id]').forEach((button) => { button.hidden = !button.textContent.toLowerCase().includes(search.value.toLowerCase()); });
    root.querySelectorAll('[data-sale-id]').forEach((button) => {
      button.onclick = () => {
        const sale = sales.find((item) => item.id === button.dataset.saleId);
        const form = root.querySelector('[data-return-form]');
        form.innerHTML = `<h3>أصناف الفاتورة ${esc(sale.invoiceNumber)}</h3><div class="najah-feature-list">${(sale.items || []).map((item, index) => `<label><span>${esc(item.name)} — ${esc(item.unitPrice)}<br><small>الكمية الأصلية: ${esc(item.quantity)}</small></span><input type="number" min="0" max="${Number(item.quantity) || 0}" step="0.01" value="0" data-return-qty="${index}"></label>`).join('')}</div><label>سبب المرتجع<textarea data-return-reason rows="2"></textarea></label><div class="najah-feature-actions-row"><button class="najah-ok" type="button" data-submit-return>حفظ المرتجع</button><button class="najah-cancel" type="button" data-close>إلغاء</button></div>`;
        form.querySelector('[data-close]').onclick = closeDialog;
        form.querySelector('[data-submit-return]').onclick = async () => {
          try {
            const items = (sale.items || []).map((item, index) => ({ ...item, quantity: Number(form.querySelector(`[data-return-qty="${index}"]`).value) || 0 }));
            const record = await createReturn({ sale, items, reason: form.querySelector('[data-return-reason]').value, customerId: sale.customerId || null });
            form.innerHTML = `<p class="form-success">تم حفظ المرتجع ${esc(record.id.slice(0, 8))} محلياً وسيتم مزامنته عند الاتصال.</p><div class="najah-feature-actions-row"><button class="najah-ok" type="button" data-print-return>طباعة مرتجع</button><button class="najah-cancel" type="button" data-close>إغلاق</button></div>`;
            form.querySelector('[data-close]').onclick = closeDialog;
            form.querySelector('[data-print-return]').onclick = () => printA4({ title: 'فاتورة مرتجع مبيعات', business: state.business, meta: [`رقم المرجع: ${sale.invoiceNumber}`, `التاريخ: ${new Date(record.createdAt).toLocaleString('ar')}`], columns: ['الصنف', 'الكمية', 'السعر', 'الإجمالي'], rows: record.items.map((item) => [item.name, item.quantity, item.unitPrice, item.total]), totals: [['إجمالي المرتجع', record.total]] });
          } catch (error) { alert(error.message || 'تعذر حفظ المرتجع.'); }
        };
      };
    });
  }
  async function openBarcodeDialog() {
    const state = await readState();
    const products = Array.isArray(state.products) ? state.products : [];
    const root = dialog('طباعة باركود المنتجات', `<input data-barcode-search placeholder="ابحث باسم المنتج أو الباركود"><div class="najah-feature-list" data-barcode-list>${products.map((product) => `<button type="button" class="najah-cancel" data-product-id="${esc(product.id)}">${esc(product.name)} — ${esc(product.barcode || product.sku || 'بدون باركود')}</button>`).join('') || '<p>لا توجد منتجات بعد.</p>'}</div><div class="najah-feature-actions-row"><button class="najah-cancel" type="button" data-close>إغلاق</button></div>`);
    root.querySelector('[data-close]').onclick = closeDialog;
    root.querySelector('[data-barcode-search]').oninput = (event) => root.querySelectorAll('[data-product-id]').forEach((button) => { button.hidden = !button.textContent.toLowerCase().includes(event.target.value.toLowerCase()); });
    root.querySelectorAll('[data-product-id]').forEach((button) => { button.onclick = () => printBarcodeLabel(products.find((item) => item.id === button.dataset.productId), state.business).catch((error) => alert(error.message)); });
  }
  async function openInventoryDialog() {
    const state = await readState(); const products = Array.isArray(state.products) ? state.products : [];
    const root = dialog('الجرد الدوري', `<input data-inventory-search placeholder="ابحث باسم المنتج أو SKU"><div class="najah-feature-list">${products.map((product) => `<label><span>${esc(product.name)}<br><small>المخزون المسجل: ${esc(product.stockOnHand || 0)}</small></span><input type="number" min="0" step="0.01" value="${Number(product.stockOnHand || 0)}" data-counted-id="${esc(product.id)}"></label>`).join('') || '<p>لا توجد منتجات بعد.</p>'}</div><label>ملاحظة الجرد<textarea data-inventory-reason rows="2" placeholder="مثال: جرد نهاية الشهر"></textarea></label><div class="najah-feature-actions-row"><button class="najah-ok" type="button" data-save-inventory>حفظ الجرد</button><button class="najah-cancel" type="button" data-close>إغلاق</button></div>`);
    root.querySelector('[data-close]').onclick = closeDialog;
    root.querySelector('[data-inventory-search]').oninput = (event) => root.querySelectorAll('[data-counted-id]').forEach((input) => { input.closest('label').hidden = !input.closest('label').textContent.toLowerCase().includes(event.target.value.toLowerCase()); });
    root.querySelector('[data-save-inventory]').onclick = async () => {
      try {
        const reason = root.querySelector('[data-inventory-reason]').value || 'جرد دوري';
        for (const input of root.querySelectorAll('[data-counted-id]')) {
          const product = products.find((item) => item.id === input.dataset.countedId);
          await createStockAdjustment(product, input.value, reason);
        }
        alert('تم حفظ الجرد وتسجيل فروقات المخزون.'); closeDialog(); window.location.reload();
      } catch (error) { alert(error.message || 'تعذر حفظ الجرد.'); }
    };
  }
  async function openPurchaseDialog() {
    const state = await readState();
    const purchases = Array.isArray(state.purchases) ? state.purchases.slice().reverse() : [];
    const root = dialog('فواتير الموردين', `<input data-purchase-search placeholder="ابحث برقم الفاتورة أو اسم المورد"><div class="najah-feature-list">${purchases.map((purchase) => `<button type="button" class="najah-cancel" data-purchase-id="${esc(purchase.id)}">${esc(purchase.invoiceNumber)} — ${esc(purchase.supplierName || 'مورد')} — ${esc(purchase.total || 0)}</button>`).join('') || '<p>لا توجد فواتير شراء بعد.</p>'}</div><div class="najah-feature-actions-row"><button class="najah-cancel" type="button" data-close>إغلاق</button></div>`);
    root.querySelector('[data-close]').onclick = closeDialog;
    root.querySelector('[data-purchase-search]').oninput = (event) => root.querySelectorAll('[data-purchase-id]').forEach((button) => { button.hidden = !button.textContent.toLowerCase().includes(event.target.value.toLowerCase()); });
    root.querySelectorAll('[data-purchase-id]').forEach((button) => {
      button.onclick = () => {
        const purchase = purchases.find((item) => item.id === button.dataset.purchaseId);
        printA4({
          title: 'فاتورة شراء من مورد', business: state.business,
          meta: [`رقم الفاتورة: ${purchase.invoiceNumber}`, `التاريخ: ${new Date(purchase.createdAt || Date.now()).toLocaleString('ar')}`, `المورد: ${purchase.supplierName || 'غير محدد'}`],
          columns: ['الصنف', 'الكمية', 'سعر الشراء', 'الإجمالي'],
          rows: (purchase.items || []).map((item) => [item.name, item.quantity, item.unitPrice, item.total || Number(item.quantity || 0) * Number(item.unitPrice || 0)]),
          totals: [['الإجمالي', purchase.total || 0], ['المدفوع', purchase.paidAmount || 0], ['المتبقي', purchase.remaining || 0]]
        });
      };
    });
  }
  const observer = new MutationObserver(injectUi);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', injectUi);
  window.NAJAH_FEATURES = { readState, writeState, createReturn, createStockAdjustment, printA4, printBarcodeLabel, exportProducts, importProducts, downloadBackup, restoreBackup, openReturnDialog, openBarcodeDialog, openPurchaseDialog, openInventoryDialog };
})();