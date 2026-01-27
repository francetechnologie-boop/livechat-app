import crypto from 'node:crypto';

function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

function toNumberMaybe(v, { decimalComma = false } = {}) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  if (decimalComma) s = s.replace(/\./g, '').replace(/,/g, '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}
function toDateMaybe(v) {
  if (!v) return null;
  const s = String(v).trim(); if (!s) return null;
  // Try D/M/YYYY or DD/MM/YYYY first
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
    const parts = s.split(/[\sT]/);
    const dmy = parts[0].split('/');
    const d = dmy[0].padStart(2, '0');
    const m = dmy[1].padStart(2, '0');
    const y = dmy[2];
    const t = parts[1] || '';
    const iso = `${y}-${m}-${d}${t ? ` ${t}` : ''}`;
    const dt = new Date(iso);
    return isFinite(dt.getTime()) ? dt : null;
  }
  const dt = new Date(s);
  return isFinite(dt.getTime()) ? dt : null;
}

function parseDelimited(text, delim) {
  const raw = String(text || '');
  const d = delim === '\\t' ? '\t' : delim; // accept "\\t" marker

  function splitLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === d && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function isBalanced(line) {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { i++; continue; }
        inQuotes = !inQuotes;
      }
    }
    return !inQuotes;
  }

  const linesRaw = raw.split(/\r?\n/);
  const logicalLines = [];
  let buf = '';
  for (let i = 0; i < linesRaw.length; i++) {
    const part = linesRaw[i];
    if (!buf) buf = part; else buf += "\n" + part;
    if (isBalanced(buf)) { logicalLines.push(buf); buf = ''; }
  }
  if (buf) logicalLines.push(buf); // best effort

  const nonEmpty = logicalLines.filter(l => l.trim().length > 0);
  if (!nonEmpty.length) return { header: [], rows: [] };

  const header = splitLine(nonEmpty[0]).map(h => h.trim());
  const rows = nonEmpty.slice(1).map((line, idx) => {
    const cols = splitLine(line);
    const obj = {}; header.forEach((h,i)=> obj[h] = (cols[i] ?? '').trim());
    return { row_number: idx+1, raw_line: line, obj };
  });
  return { header, rows };
}

function guessDelimiter(text) {
  if (text.includes('\t')) return '\t';
  const comma = (text.match(/,/g) || []).length; const semi = (text.match(/;/g) || []).length;
  return semi > comma ? ';' : ',';
}

function normalizeRow(obj, map = {}, opts = {}) {
  const g = (keys) => {
    for (const k of keys) {
      if (obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
    }
    return null;
  };
  const m = (name, fallbacks) => {
    const direct = map[name];
    if (direct != null) {
      const ds = String(direct);
      // Allow constant value with =CONST syntax
      if (ds.startsWith('=')) return ds.slice(1);
      if (obj[ds] != null && String(obj[ds]).trim() !== '') return String(obj[ds]).trim();
      // If header not found, treat mapping as a literal constant
      if (obj[ds] == null) return ds;
    }
    return g([name, ...(Array.isArray(fallbacks) ? fallbacks : [])]);
  };

  const item_code = m('item_code', ['Item Number', 'Item No', 'code', 'SKU', 'sku', 'Item', 'ITEM', 'item']);
  const supplier_name = m('supplier_name', ['VENDOR', 'vendor', 'supplier', 'SUPPLIER', 'COMPANY NAME']);
  const supplier_item_code = m('supplier_item_code', ['Vendor Sku', 'vendor_sku', 'Ref_fournisseur']);
  const catalogRaw = m('catalog_price', ['Catalog', 'Catalog price', 'Price list', 'List Price', '2025 Price (USD)', 'PU', 'Prix', 'Price']);
  const priceRaw = m('price', ['2025 Price (USD)', 'PU', 'Prix', 'Price']);
  const discountRaw = m('discount', ['Discount', 'Remise']);
  const netRaw = m('net', ['Net', 'Net Cost']);
  const currency = m('currency', ['Curr.', 'currency']);
  const name = m('name', ['Name', 'Designation', 'Item Name', 'Description']);
  const reference = m('reference', ['Reference', 'Ref', 'REF']);
  const description = m('description', ['Description', 'Desc']);
  const description_short = m('description_short', ['description_short', 'Short description', 'Desc. short']);
  const unit = m('unit', ['Unit', 'UOM', 'uom']);
  const moqRaw = m('moq', ['MOQ', 'min_qty']);
  const leadRaw = m('lead_time_days', ['Lead days', 'lead']);
  const dateRaw = m('effective_at', ['date_new_price', 'date']);

  const raw = toNumberMaybe(catalogRaw != null ? catalogRaw : priceRaw, opts);
  const net = toNumberMaybe(netRaw, opts);
  const disc = (() => {
    const d = toNumberMaybe(discountRaw, opts);
    if (d == null) return null;
    if (d > 1 && d <= 100) return d / 100; // percent → ratio
    return d; // ratio already
  })();
  const pm = String((opts.priceMode ?? 'raw')).toLowerCase();
  let price = null;
  if (pm === 'net' && net != null) {
    price = net;
  } else if (pm === 'discounted' && raw != null && disc != null) {
    price = Number((raw * (1 - disc)).toFixed(6));
  } else if (pm === 'raw' && raw != null) {
    price = raw;
  } else {
    // Fallback priority: raw -> net -> discounted
    if (raw != null) price = raw;
    else if (net != null) price = net;
    else if (raw != null && disc != null) price = Number((raw * (1 - disc)).toFixed(6));
  }
  const moq = toNumberMaybe(moqRaw, opts);
  const lead_time_days = toNumberMaybe(leadRaw, opts);
  const effective_at = toDateMaybe(dateRaw);
  // Fallback currency from opts
  const cur = currency || (opts.defaultCurrency ? String(opts.defaultCurrency) : null);
  return { item_code, supplier_name, supplier_item_code, price, currency: cur, moq, lead_time_days, effective_at, name, reference, description, description_short, unit, discount: disc, net, catalog_price: raw };
}

async function getOrCreateSupplierIdByName(pool, name, orgId) {
  try {
    const vendorName = String(name || '').trim();
    if (!vendorName || !pool) return null;
    const args = [vendorName];
    let where = 'name=$1';
    if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $2)`; }
    const r = await pool.query(`SELECT id FROM mod_bom_suppliers WHERE ${where} LIMIT 1`, args);
    if (r.rowCount) return r.rows[0].id;
    const ins = await pool.query(`INSERT INTO mod_bom_suppliers(org_id, name, created_at, updated_at) VALUES($1,$2,NOW(),NOW()) RETURNING id`, [orgId ?? null, vendorName]);
    return ins.rows[0]?.id || null;
  } catch { return null; }
}

export function registerBomImportVendorsRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool || ctx.pool;
  const chatLog = utils.chatLog || (()=>{});
  let __importColsCache = null;
  async function getImportCols() {
    if (__importColsCache) return __importColsCache;
    try {
      const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'mod_bom_import_data_vendors'`);
      __importColsCache = new Set(r.rows.map(x => x.column_name));
    } catch { __importColsCache = new Set(); }
    return __importColsCache;
  }
  const tableColsCache = new Map();
  async function getTableCols(table) {
    if (tableColsCache.has(table)) return tableColsCache.get(table);
    try {
      const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1`, [table]);
      const set = new Set(r.rows.map(x => x.column_name));
      tableColsCache.set(table, set);
      return set;
    } catch { const set = new Set(); tableColsCache.set(table, set); return set; }
  }

  // Preview: parse + map without DB writes
  app.post('/api/bom/import/vendors/preview', async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const text = body.text != null ? String(body.text) : '';
      const mode = String(body.mode || body.format || '').toLowerCase();
      const delim = body.delimiter || (mode === 'tsv' ? '\t' : (mode === 'csv' ? ',' : guessDelimiter(text)));
      const decimalComma = !!body.decimalComma;
      const defaultCurrency = body.defaultCurrency != null ? String(body.defaultCurrency) : null;
      const map = (body.map && typeof body.map === 'object') ? body.map : {};
      let vendor = body.vendor != null ? String(body.vendor) : null;
      const supplierIdParam = body.supplier_id != null ? Number(body.supplier_id) : null;
      if (!vendor && supplierIdParam && pool) {
        try {
          const r = await pool.query('SELECT name FROM mod_bom_suppliers WHERE id=$1 LIMIT 1', [supplierIdParam]);
          if (r.rowCount) vendor = r.rows[0].name;
        } catch {}
      }
      const { header, rows } = parseDelimited(text, delim);
      const normalized = rows.map(r => ({ row_number: r.row_number, raw: r.obj, mapped: normalizeRow(r.obj, map, { decimalComma, defaultCurrency, priceMode: body.priceMode }) }));
      chatLog('import_vendors_preview', { vendor, rows: normalized.length });
      return res.json({ ok:true, header, sample: normalized.slice(0, 50), count: normalized.length, vendor, supplier_id: supplierIdParam || null });
    } catch (e) { return res.status(400).json({ ok:false, error:'preview_failed', message: e?.message || String(e) }); }
  });

  // Stage: store rows in staging table with dedup hash
  app.post('/api/bom/import/vendors/stage', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const text = body.text != null ? String(body.text) : '';
      const mode = String(body.mode || body.format || '').toLowerCase();
      const delim = body.delimiter || (mode === 'tsv' ? '\t' : (mode === 'csv' ? ',' : guessDelimiter(text)));
      const decimalComma = !!body.decimalComma;
      const defaultCurrency = body.defaultCurrency != null ? String(body.defaultCurrency) : null;
      const map = (body.map && typeof body.map === 'object') ? body.map : {};
      let vendor = body.vendor != null ? String(body.vendor) : null;
      const source = body.source != null ? String(body.source) : null;
      const supplierIdParam = body.supplier_id != null ? Number(body.supplier_id) : null;
      if (!vendor && supplierIdParam && pool) {
        try {
          const r = await pool.query('SELECT name FROM mod_bom_suppliers WHERE id=$1 LIMIT 1', [supplierIdParam]);
          if (r.rowCount) vendor = r.rows[0].name;
        } catch {}
      }
      const { header, rows } = parseDelimited(text, delim);
  let staged = 0, skipped = 0;
  const client = pool; // Using same pool; single inserts to keep it simple/idempotent
  const cols = await getImportCols();
  const hasDescCols = cols.has('description');
  const hasExtraPriceCols = cols.has('catalog_price') || cols.has('discount') || cols.has('net_price');
  for (const r of rows) {
        const mapped = normalizeRow(r.obj, map, { decimalComma, defaultCurrency, priceMode: body.priceMode });
        const dedup = crypto.createHash('sha256').update(JSON.stringify({ vendor, supplier_id: supplierIdParam || null, r: r.obj })).digest('hex');
        // If supplier_id is provided or vendor provided, override supplier_name
        const supplierNameStore = vendor || mapped.supplier_name || null;
        let q = '';
        let args = [];
        if (hasDescCols && hasExtraPriceCols) {
          args = [orgId ?? null, vendor, source, JSON.stringify(header), r.row_number, r.raw_line, r.obj, mapped,
                  mapped.item_code, mapped.supplier_item_code, supplierNameStore, mapped.price, mapped.currency,
                  mapped.moq, mapped.lead_time_days, mapped.effective_at ? mapped.effective_at.toISOString() : null,
                  dedup, supplierIdParam || null, mapped.name, mapped.reference, mapped.description, mapped.description_short, mapped.unit,
                  mapped.catalog_price ?? null, mapped.discount ?? null, mapped.net ?? null];
          q = `INSERT INTO mod_bom_import_data_vendors(org_id, vendor_name, source, header, row_number, raw_line, parsed, mapped,
                 item_code, supplier_item_code, supplier_name, price, currency, moq, lead_time_days, effective_at, dedup_sha256, supplier_id,
                 name, reference, description, description_short, unit, catalog_price, discount, net_price)
               VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
               ON CONFLICT (COALESCE(org_id, -1), COALESCE(vendor_name, ''), COALESCE(dedup_sha256, '')) DO NOTHING`;
        } else if (hasDescCols) {
          args = [orgId ?? null, vendor, source, JSON.stringify(header), r.row_number, r.raw_line, r.obj, mapped,
                  mapped.item_code, mapped.supplier_item_code, supplierNameStore, mapped.price, mapped.currency,
                  mapped.moq, mapped.lead_time_days, mapped.effective_at ? mapped.effective_at.toISOString() : null,
                  dedup, supplierIdParam || null, mapped.name, mapped.reference, mapped.description, mapped.description_short, mapped.unit];
          q = `INSERT INTO mod_bom_import_data_vendors(org_id, vendor_name, source, header, row_number, raw_line, parsed, mapped,
                 item_code, supplier_item_code, supplier_name, price, currency, moq, lead_time_days, effective_at, dedup_sha256, supplier_id,
                 name, reference, description, description_short, unit)
               VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
               ON CONFLICT (COALESCE(org_id, -1), COALESCE(vendor_name, ''), COALESCE(dedup_sha256, '')) DO NOTHING`;
        } else {
          args = [orgId ?? null, vendor, source, JSON.stringify(header), r.row_number, r.raw_line, r.obj, mapped,
                  mapped.item_code, mapped.supplier_item_code, supplierNameStore, mapped.price, mapped.currency,
                  mapped.moq, mapped.lead_time_days, mapped.effective_at ? mapped.effective_at.toISOString() : null,
                  dedup, supplierIdParam || null];
          q = `INSERT INTO mod_bom_import_data_vendors(org_id, vendor_name, source, header, row_number, raw_line, parsed, mapped,
                 item_code, supplier_item_code, supplier_name, price, currency, moq, lead_time_days, effective_at, dedup_sha256, supplier_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
               ON CONFLICT (COALESCE(org_id, -1), COALESCE(vendor_name, ''), COALESCE(dedup_sha256, '')) DO NOTHING`;
        }
    const rIns = await client.query(q, args);
    if (rIns.rowCount) staged++; else skipped++;
  }
      chatLog('import_vendors_stage', { vendor, staged, skipped });
      return res.json({ ok:true, staged, skipped });
    } catch (e) { return res.status(400).json({ ok:false, error:'stage_failed', message: e?.message || String(e) }); }
  });

  // List staged rows
  app.get('/api/bom/import/vendors', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const orgId = pickOrgId(req);
      const status = String(req.query?.status || 'pending');
      const vendor = req.query?.vendor ? String(req.query.vendor) : null;
      const supplierIdParam = req.query?.supplier_id ? Number(req.query.supplier_id) : null;
      let vendorNameById = null;
      if (!vendor && supplierIdParam && pool) {
        try { const r = await pool.query('SELECT name FROM mod_bom_suppliers WHERE id=$1 LIMIT 1', [supplierIdParam]); if (r.rowCount) vendorNameById = r.rows[0].name; } catch {}
      }
      const limit = Math.max(0, Math.min(500, Number(req.query?.limit || 50)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const args = [status];
      let where = 'status=$1';
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $${args.length})`; }
      if (vendor) { args.push(vendor); where += ` AND vendor_name = $${args.length}`; }
      if (supplierIdParam) { args.push(supplierIdParam); where += ` AND supplier_id = $${args.length}`; }
      if (!supplierIdParam && vendorNameById) { args.push(vendorNameById); where += ` AND vendor_name = $${args.length}`; }
      args.push(limit); args.push(offset);
      const r = await pool.query(`SELECT * FROM mod_bom_import_data_vendors WHERE ${where} ORDER BY id ASC LIMIT $${args.length-1} OFFSET $${args.length}`, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Process staged rows into items/vendors/prices
  app.post('/api/bom/import/vendors/process', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      let vendor = body.vendor != null ? String(body.vendor) : null;
      const supplierIdParam = body.supplier_id != null ? Number(body.supplier_id) : null;
      if (!vendor && supplierIdParam && pool) {
        try { const r = await pool.query('SELECT name FROM mod_bom_suppliers WHERE id=$1 LIMIT 1', [supplierIdParam]); if (r.rowCount) vendor = r.rows[0].name; } catch {}
      }
      const limit = Math.max(1, Math.min(2000, Number(body.limit || 500)));
      const dryRun = !!body.dry_run;
      const createItems = body.create_items !== false; // default true
      const nowIso = new Date().toISOString();

      const args = ['pending'];
      let where = 'status=$1';
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $${args.length})`; }
      if (vendor) { args.push(vendor); where += ` AND vendor_name = $${args.length}`; }
      if (supplierIdParam) { args.push(supplierIdParam); where += ` AND (supplier_id = $${args.length})`; }
      args.push(limit);
      const sel = await pool.query(`SELECT * FROM mod_bom_import_data_vendors WHERE ${where} ORDER BY id ASC LIMIT $${args.length}`, args);

      let processed = 0, errors = 0, createdItems = 0, linkedVendors = 0, addedPrices = 0;
      for (const row of sel.rows || []) {
        try {
          const mapped = row.mapped || {};
          const code = mapped.item_code || row.item_code;
          const supplierName = vendor || mapped.supplier_name || row.supplier_name || row.vendor_name || null;
          const supplierId = row.supplier_id || supplierIdParam || (await getOrCreateSupplierIdByName(pool, supplierName, orgId));
          if (!code) throw new Error('missing_item_code');
          if (!supplierId) throw new Error('missing_supplier');
          // Find or create item by SKU
          let itemSel = await pool.query(`SELECT id FROM mod_bom_items WHERE lower(btrim(sku)) = lower(btrim($1)) ${orgId ? 'AND (org_id IS NULL OR org_id = $2)' : ''} LIMIT 1`, orgId ? [code, orgId] : [code]);
          let itemId = itemSel.rowCount ? itemSel.rows[0].id : null;
          if (!itemId) {
            const refCand = mapped.reference || row.reference || null;
            if (refCand) {
              const byRef = await pool.query(`SELECT id FROM mod_bom_items WHERE lower(btrim(reference)) = lower(btrim($1)) ${orgId ? 'AND (org_id IS NULL OR org_id = $2)' : ''} LIMIT 1`, orgId ? [refCand, orgId] : [refCand]);
              if (byRef.rowCount) itemId = byRef.rows[0].id;
            }
          }
          if (!itemId && createItems) {
            if (!dryRun) {
              const nm = mapped.name || row.name || code;
              const ref = mapped.reference || row.reference || null;
              const desc = mapped.description || row.description || null;
              const dshort = mapped.description_short || row.description_short || null;
              const unit = mapped.unit || row.unit || null;
              const uom = unit || 'pcs';
              const ins = await pool.query(`INSERT INTO mod_bom_items(org_id, sku, name, uom, attributes, code, reference, description, description_short, unit, created_at, updated_at)
                                            VALUES ($1,$2,$3,$4,'{}',$5,$6,$7,$8,$9,NOW(),NOW()) RETURNING id`, [orgId ?? null, code, nm, uom, code, ref, desc, dshort, unit]);
              itemId = ins.rows[0].id; createdItems++;
            } else {
              createdItems++; itemId = -1; // mark virtual id for dry-run
            }
          }
          if (!itemId) throw new Error('item_not_found');
          // Update item metadata if provided
          if (!dryRun && itemId && (mapped.name || mapped.reference || mapped.description || mapped.description_short || mapped.unit)) {
            const sets = []; const argsU = [];
            const set = (col, val) => { argsU.push(val); sets.push(`${col}=$${argsU.length}`); };
            if (mapped.name) set('name', mapped.name);
            if (mapped.reference) set('reference', mapped.reference);
            if (mapped.description) set('description', mapped.description);
            if (mapped.description_short) set('description_short', mapped.description_short);
            if (mapped.unit) { set('unit', mapped.unit); set('uom', mapped.unit); }
            if (sets.length) { argsU.push(itemId); await pool.query(`UPDATE mod_bom_items SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${argsU.length}`, argsU); }
          }
          // Upsert vendor link
          const ivCols = await getTableCols('mod_bom_item_vendors');
          if (!dryRun) {
            if (ivCols.has('catalog_price') || ivCols.has('discount') || ivCols.has('net_price')) {
              await pool.query(`INSERT INTO mod_bom_item_vendors(org_id, item_id, supplier_id, supplier_item_code, catalog_price, discount, net_price)
                                VALUES ($1,$2,$3,$4,$5,$6,$7)
                                ON CONFLICT (item_id, supplier_id) DO UPDATE SET supplier_item_code=EXCLUDED.supplier_item_code, catalog_price=EXCLUDED.catalog_price, discount=EXCLUDED.discount, net_price=EXCLUDED.net_price, updated_at=NOW()`,
                                [orgId ?? null, itemId, supplierId, mapped.supplier_item_code || row.supplier_item_code || null, mapped.catalog_price ?? row.catalog_price ?? null, mapped.discount ?? row.discount ?? null, mapped.net ?? row.net_price ?? null]);
            } else {
              await pool.query(`INSERT INTO mod_bom_item_vendors(org_id, item_id, supplier_id, supplier_item_code)
                                VALUES ($1,$2,$3,$4)
                                ON CONFLICT (item_id, supplier_id) DO UPDATE SET supplier_item_code=EXCLUDED.supplier_item_code, updated_at=NOW()`,
                                [orgId ?? null, itemId, supplierId, mapped.supplier_item_code || row.supplier_item_code || null]);
            }
            linkedVendors++;
          } else { linkedVendors++; }
          // Add price point
          const price = mapped.price ?? row.price;
          const currency = mapped.currency ?? row.currency ?? null;
          const eff = mapped.effective_at ? new Date(mapped.effective_at) : (row.effective_at ? new Date(row.effective_at) : new Date());
          if (price != null && isFinite(Number(price))) {
            const ipvCols = await getTableCols('mod_bom_item_vendor_prices');
            if (!dryRun) {
              if (ipvCols.has('catalog_price') || ipvCols.has('discount') || ipvCols.has('net_price')) {
                await pool.query(`INSERT INTO mod_bom_item_vendor_prices(org_id, item_id, supplier_id, price, currency, effective_at, source, catalog_price, discount, net_price, created_at, updated_at)
                                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
                                  ON CONFLICT (item_id, COALESCE(supplier_id, -1), effective_at, price) DO NOTHING`,
                                  [orgId ?? null, itemId, supplierId, Number(price), currency, eff.toISOString(), 'import:stage', mapped.catalog_price ?? row.catalog_price ?? null, mapped.discount ?? row.discount ?? null, mapped.net ?? row.net_price ?? null]);
              } else {
                await pool.query(`INSERT INTO mod_bom_item_vendor_prices(org_id, item_id, supplier_id, price, currency, effective_at, source, created_at, updated_at)
                                  VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
                                  ON CONFLICT (item_id, COALESCE(supplier_id, -1), effective_at, price) DO NOTHING`,
                                  [orgId ?? null, itemId, supplierId, Number(price), currency, eff.toISOString(), 'import:stage']);
              }
              addedPrices++;
            } else { addedPrices++; }
          }
          // Mark row as processed
          if (!dryRun) {
            await pool.query(`UPDATE mod_bom_import_data_vendors SET status='processed', error=NULL, supplier_id=$1, item_id=$2, processed_at=NOW(), updated_at=NOW() WHERE id=$3`, [supplierId, itemId, row.id]);
          }
          processed++;
        } catch (err) {
          errors++;
          if (!dryRun) {
            await pool.query(`UPDATE mod_bom_import_data_vendors SET status='error', error=$1, updated_at=NOW() WHERE id=$2`, [String(err?.message || err), row.id]);
          }
        }
      }
      chatLog('import_vendors_process', { vendor, processed, errors, createdItems, linkedVendors, addedPrices });
      return res.json({ ok:true, processed, errors, createdItems, linkedVendors, addedPrices });
    } catch (e) { return res.status(400).json({ ok:false, error:'process_failed', message: e?.message || String(e) }); }
  });
}
