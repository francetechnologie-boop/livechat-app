// Lightweight PrestaShop Webservice client
// Supports: products, customers, orders, stock_availables
// Uses ws_key in query string and Basic Auth for compatibility.

export function createPrestaClient({ baseURL, apiKey, timeoutMs = 15000 } = {}) {
  const base = String(baseURL || '').trim().replace(/\/$/, '');
  const apiBase = base.endsWith('/api') ? base : `${base}/api`;
  if (!base || !apiKey) {
    throw new Error('prestashop_config_missing');
  }

  const doFetch = async (url) => {
    const f = (globalThis.fetch || (await import('node-fetch')).default);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort('timeout'), Math.max(1000, timeoutMs));
    try {
      const r = await f(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        },
        signal: ctrl.signal,
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        throw new Error(`http_${r.status}:${txt.slice(0,200)}`);
      }
      const ct = r.headers.get('content-type') || '';
      if (/json/i.test(ct)) return await r.json();
      // Some setups return XML even with output_format; return raw text
      const raw = await r.text();
      return { ok: true, raw };
    } finally {
      clearTimeout(t);
    }
  };

  const q = (params = {}) => {
    const u = new URL(apiBase);
    // Ensure /api at end
    // Params: ws_key, output_format=JSON
    const search = new URLSearchParams();
    search.set('ws_key', apiKey);
    search.set('output_format', 'JSON');
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      // Allow nested filter[...] keys by passing exact key
      if (k.includes('[')) {
        search.append(k, v);
      } else {
        search.append(k, String(v));
      }
    }
    return search.toString();
  };

  const url = (resource, id = null, params = {}) => {
    const basePath = id ? `${apiBase}/${resource}/${encodeURIComponent(id)}` : `${apiBase}/${resource}`;
    const qs = q(params);
    return `${basePath}?${qs}`;
  };

  return {
    // ----- Customers -----
    async getCustomerByEmail(email) {
      const u = url('customers', null, { 'display': 'full', 'filter[email]': `[${email}]` });
      return await doFetch(u);
    },
    async getCustomer(id) {
      const u = url('customers', id, { display: 'full' });
      return await doFetch(u);
    },

    async searchCustomers({ email, firstname, lastname, name, limit = 5 } = {}) {
      const params = { display: 'full', limit: String(limit) };
      if (email) params['filter[email]'] = `[${email}]`;
      // If a full name is provided, try to split into first/last
      if (name && !firstname && !lastname) {
        const parts = String(name).trim().split(/\s+/);
        if (parts.length >= 2) {
          firstname = parts[0];
          lastname = parts.slice(1).join(' ');
        } else {
          // fallback to wildcard on firstname and lastname separately
          firstname = name; lastname = name;
        }
      }
      if (firstname) params['filter[firstname]'] = `[%${firstname}%]`;
      if (lastname) params['filter[lastname]'] = `[%${lastname}%]`;
      const u = url('customers', null, params);
      return await doFetch(u);
    },

    // ----- Products -----
    async getProduct(id) {
      const u = url('products', id, { display: 'full' });
      return await doFetch(u);
    },
    async getProductByReference(reference) {
      const u = url('products', null, { display: 'full', 'filter[reference]': `[${reference}]` });
      return await doFetch(u);
    },
    async findProductsByName(name, limit = 5) {
      // Use wildcard filtering; Presta expects [%term%]
      const u = url('products', null, { display: 'full', 'filter[name]': `[%${name}%]`, limit: String(limit) });
      return await doFetch(u);
    },

    // ----- Orders -----
    async getOrder(id) {
      const u = url('orders', id, { display: 'full' });
      return await doFetch(u);
    },
    async getOrderByReference(reference) {
      const u = url('orders', null, { display: 'full', 'filter[reference]': `[${reference}]` });
      return await doFetch(u);
    },
    async listOrders({ customerId, reference, dateFrom, dateTo, limit = 10, sort = 'date_add_DESC' } = {}) {
      const params = { display: 'full', limit: String(limit) };
      if (customerId != null && customerId !== '') params['filter[id_customer]'] = `[${customerId}]`;
      if (reference) params['filter[reference]'] = `[${reference}]`;
      if (dateFrom && dateTo) params['filter[date_add]'] = `[${dateFrom},${dateTo}]`;
      else if (dateFrom) params['filter[date_add]'] = `[${dateFrom},]`;
      else if (dateTo) params['filter[date_add]'] = `[,${dateTo}]`;
      if (sort) params['sort'] = sort;
      const u = url('orders', null, params);
      return await doFetch(u);
    },

    // ----- Stock -----
    async getStockByProductId(productId) {
      const u = url('stock_availables', null, { display: 'full', 'filter[id_product]': `[${productId}]` });
      return await doFetch(u);
    },
  };
}

export function normalizePrestaCollection(obj, key) {
  if (!obj || typeof obj !== 'object') return [];
  let v = obj[key];
  // Fallback to singular (e.g., product vs products)
  if (v == null && key.endsWith('s')) {
    const singular = key.slice(0, -1);
    v = obj[singular];
  }
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  // Some endpoints return an object for single item
  if (typeof v === 'object') return [v];
  return [];
}

export function pick(obj, keys = []) {
  const out = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}
