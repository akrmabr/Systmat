/* Offline queue bridge for the existing release bundle.
   It only sends queued operations after a real Supabase Auth session exists.
   It never contains a service-role key and never deletes local data on failure. */
(() => {
  const cfg = window.__UNIVERSAL_RETAIL_SUPABASE__;
  if (!cfg?.url || !cfg?.anonKey) return;
  const projectRef = (() => { try { return new URL(cfg.url).hostname.split('.')[0]; } catch { return ''; } })();
  const authKey = `sb-${projectRef}-auth-token`;
  const readSession = () => {
    try {
      const raw = localStorage.getItem(authKey) || Object.keys(localStorage).filter((k) => k.endsWith('-auth-token'))
        .map((k) => localStorage.getItem(k)).find(Boolean);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed?.access_token || parsed?.currentSession?.access_token || null;
    } catch { return null; }
  };
  const openDb = (name, version, upgrade) => new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = () => upgrade?.(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const readState = async () => {
    const db = await openDb('universal-retail-local', 2);
    return new Promise((resolve, reject) => {
      const req = db.transaction('app-state', 'readonly').objectStore('app-state').get('singleton');
      req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error);
    });
  };
  const readQueue = async () => {
    const db = await openDb('universal-retail-sync-queue', 1, (d) => d.createObjectStore('operations', { keyPath: 'operationId' }));
    return new Promise((resolve, reject) => {
      const req = db.transaction('operations', 'readonly').objectStore('operations').getAll();
      req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error);
    });
  };
  const removeQueueItem = async (operationId) => {
    const db = await openDb('universal-retail-sync-queue', 1, (d) => d.createObjectStore('operations', { keyPath: 'operationId' }));
    return new Promise((resolve, reject) => {
      const req = db.transaction('operations', 'readwrite').objectStore('operations').delete(operationId);
      req.onsuccess = resolve; req.onerror = () => reject(req.error);
    });
  };
  const request = async (path, method, token, body, prefer = 'return=minimal') => {
    const response = await fetch(`${cfg.url}${path}`, {
      method, headers: { apikey: cfg.anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: `resolution=merge-duplicates,${prefer}` }, body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw new Error(await response.text());
    return response.status === 204 ? null : response.json().catch(() => null);
  };
  const mapProduct = (p, businessId, userId) => ({ id: p.id, business_id: businessId, name: p.name, sku: p.sku || null, base_barcode: p.barcode || null, purchase_price: Number(p.purchasePrice) || 0, sale_price: Number(p.sellingPrice) || 0, wholesale_price: Number(p.wholesalePrice) || null, minimum_stock: Number(p.minimumStockLevel) || 0, attributes: { category: p.category || null, unit: p.unit || null }, is_active: p.isActive !== false, created_at: p.createdAt, updated_at: p.updatedAt });
  async function sync() {
    const token = readSession(); if (!token) return;
    const state = await readState(); if (!state?.business?.id) return;
    const userId = (() => { try { return JSON.parse(localStorage.getItem(authKey) || '{}')?.user?.id || null; } catch { return null; } })();
    const queue = (await readQueue()).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    for (const op of queue) {
      try {
        const p = op.payload || {};
        if (op.entityType === 'product') {
          await request('/rest/v1/products?on_conflict=id', 'POST', token, mapProduct(p, state.business.id, userId));
        } else if (op.entityType === 'customer') {
          await request('/rest/v1/customers?on_conflict=id', 'POST', token, { id: p.id, business_id: state.business.id, name: p.name, phone: p.phone || null, address: p.address || null, opening_balance: Number(p.openingBalance) || 0, is_active: p.isActive !== false });
        } else if (op.entityType === 'supplier') {
          await request('/rest/v1/suppliers?on_conflict=id', 'POST', token, { id: p.id, business_id: state.business.id, name: p.name, phone: p.phone || null, address: p.address || null, opening_balance: Number(p.openingBalance) || 0, is_active: p.isActive !== false });
        } else if (op.entityType === 'expense') {
          await request('/rest/v1/expenses?on_conflict=id', 'POST', token, { id: p.id, business_id: state.business.id, category: p.category, amount: Number(p.amount) || 0, description: p.description || null, payment_method: p.paymentMethod || 'cash', created_at: p.createdAt });
        } else if (op.entityType === 'sale' && op.operation === 'create') {
          await request('/rest/v1/rpc/complete_sale', 'POST', token, { p_business_id: state.business.id, p_branch_id: null, p_customer_id: p.customerId || null, p_invoice_number: p.invoiceNumber, p_payment_method: p.paymentMethod || 'cash', p_paid: Number(p.paidAmount) || 0, p_items: (p.items || []).map((i) => ({ product_id: i.productId, quantity: Number(i.quantity), unit_price: Number(i.unitPrice), discount: 0 })) });
        } else if (op.entityType === 'purchase' && op.operation === 'create') {
          await request('/rest/v1/rpc/receive_purchase', 'POST', token, { p_business_id: state.business.id, p_branch_id: null, p_supplier_id: p.supplierId || null, p_invoice_number: p.invoiceNumber, p_payment_method: p.paymentMethod || 'cash', p_paid: Number(p.paidAmount) || 0, p_items: (p.items || []).map((i) => ({ product_id: i.productId, quantity: Number(i.quantity), unit_cost: Number(i.unitPrice) })) });
        } else { continue; }
        await removeQueueItem(op.operationId);
      } catch (error) {
        console.warn('[sync] operation deferred', op.operationId, error);
        break;
      }
    }
  }
  window.addEventListener('online', () => sync().catch(() => {}));
  window.setInterval(() => sync().catch(() => {}), 30000);
  window.__NAJAH_SYNC__ = { sync };
})();
