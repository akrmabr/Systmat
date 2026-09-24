/* Activity engine: contextual UI + real dynamic product attributes stored in IndexedDB. */
(() => {
  const cfgs = window.NAJAH_ACTIVITY_CONFIG || {};
  const fieldLabels = window.NAJAH_FIELD_LABELS || {};
  let lastType = '';
  let writeTimer = 0;
  let fieldsRenderInFlight = false;
  const openDb = (name, version, upgrade) => new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade?.(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const readState = async () => {
    if (!('indexedDB' in window)) return null;
    const db = await openDb('universal-retail-local', 2);
    return new Promise((resolve) => {
      const get = db.transaction('app-state', 'readonly').objectStore('app-state').get('singleton');
      get.onsuccess = () => resolve(get.result || null); get.onerror = () => resolve(null);
    });
  };
  const writeState = async (state) => {
    const db = await openDb('universal-retail-local', 2);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['app-state', 'backup-snapshots'], 'readwrite');
      tx.objectStore('app-state').put(state, 'singleton');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  };
  const enqueue = async (payload) => {
    try {
      const db = await openDb('universal-retail-sync-queue', 1, (d) => d.createObjectStore('operations', { keyPath: 'operationId' }));
      await new Promise((resolve, reject) => {
        const tx = db.transaction('operations', 'readwrite');
        tx.objectStore('operations').put({ ...payload, operationId: crypto.randomUUID(), createdAt: new Date().toISOString() });
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
    } catch { /* local save remains successful even if queue is unavailable */ }
  };
  const getType = async () => (await readState())?.business?.businessType || 'general';
  const config = () => cfgs[document.documentElement.dataset.businessType] || cfgs.general;
  const fieldKey = (input) => input.dataset.najahField;
  const activityFields = () => config()?.fields || [];
  const renderFields = async () => {
    const form = document.querySelector('.product-form-grid');
    if (!form || form.parentElement.querySelector('.najah-extra-fields') || fieldsRenderInFlight) return;
    fieldsRenderInFlight = true;
    try {
      const state = await readState();
      const editing = state?.products?.find((p) => {
        const sku = form.querySelector('input[placeholder="رمز داخلي فريد"]')?.value?.trim();
        const name = form.querySelector('input[placeholder="اسم المنتج"]')?.value?.trim();
        return (sku && p.sku === sku) || (name && p.name === name);
      });
      // React قد يعيد إنشاء نموذج المنتج أثناء المراقبة؛ احذف أي نسخة قديمة قبل الإضافة.
      document.querySelectorAll('.najah-extra-fields').forEach((node) => node.remove());
      if (!document.body.contains(form) || form.parentElement.querySelector('.najah-extra-fields')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'najah-extra-fields';
      wrapper.innerHTML = `<div class="najah-extra-heading"><strong>خصائص ${config()?.label || 'النشاط'}</strong><span>حقول مرتبطة بالنشاط المختار فقط.</span></div>`;
      const grid = document.createElement('div'); grid.className = 'najah-extra-grid';
      for (const key of activityFields()) {
        const label = fieldLabels[key] || key;
        const field = document.createElement('label'); field.className = 'field';
        const value = editing?.attributes?.[key] ?? '';
        if (key === 'prescription_required') {
          field.innerHTML = `<span>${label}</span><select data-najah-field="${key}"><option value="">غير محدد</option><option value="true">نعم</option><option value="false">لا</option></select>`;
        } else if (key === 'expiry_date' || key === 'warranty_start' || key === 'warranty_end') {
          field.innerHTML = `<span>${label}</span><input data-najah-field="${key}" type="date" value="${String(value).replaceAll('"', '&quot;')}">`;
        } else {
          field.innerHTML = `<span>${label}</span><input data-najah-field="${key}" type="text" value="${String(value).replaceAll('"', '&quot;')}" placeholder="${label}">`;
        }
        grid.appendChild(field);
      }
      wrapper.appendChild(grid);
      form.insertAdjacentElement('afterend', wrapper);
      if (editing) wrapper.querySelectorAll('[data-najah-field]').forEach((el) => { el.value = editing.attributes?.[el.dataset.najahField] ?? ''; });
    } finally {
      fieldsRenderInFlight = false;
    }
  };
  const persistFieldsAfterSave = () => {
    clearTimeout(writeTimer);
    writeTimer = window.setTimeout(async () => {
      const wrapper = document.querySelector('.najah-extra-fields');
      if (!wrapper) return;
      const attrs = {};
      wrapper.querySelectorAll('[data-najah-field]').forEach((el) => { if (el.value !== '') attrs[el.dataset.najahField] = el.value; });
      if (!Object.keys(attrs).length) return;
      const form = document.querySelector('.product-form-grid');
      const name = form?.querySelector('input[placeholder="اسم المنتج"]')?.value?.trim();
      const sku = form?.querySelector('input[placeholder="رمز داخلي فريد"]')?.value?.trim();
      const state = await readState();
      if (!state?.products?.length) return;
      const index = state.products.findIndex((p) => (sku && p.sku === sku) || (name && p.name === name));
      if (index < 0) return;
      const updated = { ...state.products[index], attributes: { ...(state.products[index].attributes || {}), ...attrs }, updatedAt: new Date().toISOString() };
      const products = state.products.slice(); products[index] = updated;
      await writeState({ ...state, products });
      await enqueue({ entityType: 'product', entityId: updated.id, operation: 'update', payload: updated });
    }, 350);
  };
  const applyContext = async () => {
    const type = await getType();
    document.documentElement.dataset.businessType = type;
    const cfg = cfgs[type] || cfgs.general;
    if (!cfg) return;
    document.querySelectorAll('.workspace-card small').forEach((el) => { el.textContent = cfg.label; });
    document.querySelectorAll('.nav-item').forEach((item) => {
      const span = item.querySelector('span'); if (!span) return;
      const text = span.textContent.trim();
      if (text === 'المنتجات والمخزون' || text === cfg.products) span.textContent = cfg.products;
      if (text === 'المشتريات' || text === cfg.purchase) span.textContent = cfg.purchase;
      if (text === 'التقارير' || text === cfg.reports) span.textContent = cfg.reports;
      if (text === 'نقطة البيع' || text.startsWith('نقطة بيع ')) span.textContent = 'نقطة بيع ' + cfg.label;
    });
    const heading = document.querySelector('.page-heading');
    if (heading && !heading.parentElement.querySelector('[data-najah-activity-context]')) {
      const context = document.createElement('div'); context.dataset.najahActivityContext = 'true'; context.className = 'najah-activity-context';
      context.innerHTML = `<strong>وضع النشاط: ${cfg.label}</strong><span>${cfg.products}</span><span>${cfg.inventory}</span><span>${cfg.reports}</span>`;
      heading.insertAdjacentElement('afterend', context);
    }
    const context = document.querySelector('[data-najah-activity-context]');
    if (context) context.querySelectorAll('span').forEach((el, i) => { el.textContent = [cfg.products, cfg.inventory, cfg.reports][i] || ''; });
    if (type !== lastType) { lastType = type; document.querySelector('.najah-extra-fields')?.remove(); }
    await renderFields();
  };
  document.addEventListener('click', (event) => { const button = event.target.closest('button'); if (button && /حفظ المنتج|حفظ التعديل/.test(button.textContent || '')) persistFieldsAfterSave(); }, true);
  const observer = new MutationObserver(() => applyContext().catch(() => {}));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setInterval(() => applyContext().catch(() => {}), 1200);
  applyContext().catch(() => {});
  window.NAJAH_ACTIVITY = { getType, configs: cfgs, readState, renderFields };
})();
