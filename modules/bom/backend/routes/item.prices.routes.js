function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; } }

export function registerBomItemPricesRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool || ctx.pool;

  // List price history for an item (optionally filter by supplier_id)
  app.get('/api/bom/items/:id/prices', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const itemId = Number(req.params?.id || 0);
      if (!itemId) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = pickOrgId(req);
      const supplierId = req.query?.supplier_id ? Number(req.query.supplier_id) : null;
      const args = [itemId];
      let where = 'p.item_id=$1';
      if (supplierId) { args.push(supplierId); where += ` AND p.supplier_id=$${args.length}`; }
      if (orgId) { args.push(orgId); where += ` AND (p.org_id IS NULL OR p.org_id = $${args.length})`; }
      const r = await pool.query(`SELECT p.id, p.item_id, p.supplier_id, s.name AS supplier_name, p.price, p.currency, p.effective_at, p.source, p.created_at
                                    FROM mod_bom_item_vendor_prices p
                                    LEFT JOIN mod_bom_suppliers s ON s.id = p.supplier_id
                                   WHERE ${where}
                                   ORDER BY p.effective_at DESC, p.id DESC`, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Add a price point for an item
  app.post('/api/bom/items/:id/prices', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const itemId = Number(req.params?.id || 0);
      if (!itemId) return res.status(400).json({ ok:false, error:'invalid_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const supplierId = body.supplier_id != null ? Number(body.supplier_id) : null;
      const price = Number(body.price);
      if (!isFinite(price)) return res.status(400).json({ ok:false, error:'invalid_price' });
      const currency = body.currency != null ? String(body.currency) : null;
      const effectiveAt = body.effective_at ? new Date(body.effective_at) : new Date();
      if (!isFinite(effectiveAt.getTime())) return res.status(400).json({ ok:false, error:'invalid_effective_at' });
      const source = body.source != null ? String(body.source) : null;
      const notes = body.notes != null ? String(body.notes) : null;
      const cols = await (async ()=>{ try { const r = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_item_vendor_prices'`); return new Set(r.rows.map(x=>x.column_name)); } catch { return new Set(); } })();
      const catalog_price = req.body?.catalog_price != null ? Number(req.body.catalog_price) : null;
      const discount = req.body?.discount != null ? Number(req.body.discount) : null;
      const net_price = req.body?.net_price != null ? Number(req.body.net_price) : null;
      let r;
      if (cols.has('catalog_price') || cols.has('discount') || cols.has('net_price')) {
        r = await pool.query(`INSERT INTO mod_bom_item_vendor_prices(org_id, item_id, supplier_id, price, currency, effective_at, source, notes, catalog_price, discount, net_price)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                               ON CONFLICT (item_id, COALESCE(supplier_id, -1), effective_at, price) DO NOTHING
                               RETURNING id`, [orgId ?? null, itemId, supplierId, price, currency, effectiveAt.toISOString(), source, notes, catalog_price, discount, net_price]);
      } else {
        r = await pool.query(`INSERT INTO mod_bom_item_vendor_prices(org_id, item_id, supplier_id, price, currency, effective_at, source, notes)
                               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                               ON CONFLICT (item_id, COALESCE(supplier_id, -1), effective_at, price) DO NOTHING
                               RETURNING id`, [orgId ?? null, itemId, supplierId, price, currency, effectiveAt.toISOString(), source, notes]);
      }
      return res.json({ ok:true, id: r.rows[0]?.id || null });
    } catch (e) { return res.status(500).json({ ok:false, error:'create_failed', message: e?.message || String(e) }); }
  });

  // Bulk import: item_code, price, date_new_price[, vendor, currency]
  app.post('/api/bom/items/prices/import', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const mode = String(body.mode || body.format || '').toLowerCase();
      const text = body.text != null ? String(body.text) : '';
      let rows = [];
      if (Array.isArray(body.rows)) rows = body.rows;
      else if (text) {
        const delim = mode === 'csv' ? ',' : (mode === 'tsv' ? '\t' : (text.includes('\t') ? '\t' : ','));
        const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length) {
          const header = lines[0].split(delim).map(h => h.trim());
          rows = lines.slice(1).map(line => { const cols = line.split(delim); const obj = {}; header.forEach((h,i)=> obj[h] = (cols[i] || '').trim()); return obj; });
        }
      }
      let inserted = 0, skipped = 0;
      for (const r of rows) {
        const code = String(r['item_code'] || r['code'] || '').trim();
        const priceStr = String(r['price'] || '').trim();
        const dateStr = String(r['date_new_price'] || r['date'] || '').trim();
        if (!code || !priceStr || !dateStr) { skipped++; continue; }
        const pr = Number((priceStr || '').replace(',', '.'));
        if (!isFinite(pr)) { skipped++; continue; }
        let eff = null;
        // Try DD/MM/YYYY first then ISO
        if (/^\d{2}\/\d{2}\/\d{4}/.test(dateStr)) {
          const [d, m, rest] = dateStr.split('/');
          const [y, t] = rest.split(' ');
          eff = new Date(`${y}-${m}-${d} ${t || '00:00:00'}Z`);
        } else {
          eff = new Date(dateStr);
        }
        if (!isFinite(eff?.getTime?.() || NaN)) { skipped++; continue; }
        const itemSel = await pool.query('SELECT id, org_id FROM mod_bom_items WHERE lower(btrim(sku))=lower(btrim($1)) LIMIT 1', [code]);
        if (!itemSel.rowCount) { skipped++; continue; }
        const itemId = itemSel.rows[0].id;
        // Prefer the first vendor link as default supplier for this price
        const vendSel = await pool.query('SELECT supplier_id, org_id FROM mod_bom_item_vendors WHERE item_id=$1 ORDER BY preferred DESC, COALESCE(priority,999) ASC LIMIT 1', [itemId]);
        const supplierId = vendSel.rowCount ? vendSel.rows[0].supplier_id : null;
        await pool.query(`INSERT INTO mod_bom_item_vendor_prices(org_id, item_id, supplier_id, price, currency, effective_at, source, created_at, updated_at)
                          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
                          ON CONFLICT (item_id, COALESCE(supplier_id, -1), effective_at, price) DO NOTHING`,
                          [orgId ?? itemSel.rows[0].org_id ?? (vendSel.rows[0]?.org_id || null), itemId, supplierId, pr, null, eff.toISOString(), 'import']);
        inserted++;
      }
      return res.json({ ok:true, inserted, skipped });
    } catch (e) { return res.status(400).json({ ok:false, error:'import_failed', message: e?.message || String(e) }); }
  });
}
