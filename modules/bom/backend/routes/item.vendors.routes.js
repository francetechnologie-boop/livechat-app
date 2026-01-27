function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
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

export function registerBomItemVendorsRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool || ctx.pool;

  // List vendors for an item
  app.get('/api/bom/items/:id/vendors', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const itemId = Number(req.params?.id || 0);
      if (!itemId) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = pickOrgId(req);
      const args = [itemId];
      let where = 'iv.item_id=$1';
      if (orgId) { args.push(orgId); where += ` AND (iv.org_id IS NULL OR iv.org_id = $2)`; }
      const r = await pool.query(`SELECT iv.id, iv.item_id, iv.supplier_id, s.name AS supplier_name, iv.supplier_item_code,
                                         iv.price, iv.currency, iv.moq, iv.lead_time_days, iv.preferred, iv.priority, iv.notes,
                                         iv.catalog_price,
                                         iv.created_at, iv.updated_at
                                    FROM mod_bom_item_vendors iv
                                    JOIN mod_bom_suppliers s ON s.id = iv.supplier_id
                                   WHERE ${where}
                                   ORDER BY COALESCE(iv.priority, 999), s.name ASC`, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Upsert vendor link
  app.post('/api/bom/items/:id/vendors', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const itemId = Number(req.params?.id || 0);
      if (!itemId) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = req.body?.org_id ?? pickOrgId(req);
      let supplierId = req.body?.supplier_id ? Number(req.body.supplier_id) : null;
      if (!supplierId) {
        const vendorName = req.body?.supplier_name || req.body?.vendor || req.body?.VENDORS;
        if (!vendorName) return res.status(400).json({ ok:false, error:'supplier_required' });
        supplierId = await getOrCreateSupplierIdByName(pool, vendorName, orgId);
      }
      const data = {
        supplier_item_code: req.body?.supplier_item_code != null ? String(req.body.supplier_item_code) : null,
        price: req.body?.price != null ? Number(req.body.price) : null,
        currency: req.body?.currency != null ? String(req.body.currency) : null,
        moq: req.body?.moq != null ? Number(req.body.moq) : null,
        lead_time_days: req.body?.lead_time_days != null ? Number(req.body.lead_time_days) : null,
        preferred: !!req.body?.preferred,
        priority: req.body?.priority != null ? Number(req.body.priority) : null,
        notes: req.body?.notes != null ? String(req.body.notes) : null,
      };
      const colsRes = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_item_vendors'`);
      const cols = new Set(colsRes.rows.map(x => x.column_name));
      const hasExtra = cols.has('catalog_price') || cols.has('discount') || cols.has('net_price');
      const catalog_price = req.body?.catalog_price != null ? Number(req.body.catalog_price) : null;
      const discount = req.body?.discount != null ? Number(req.body.discount) : null;
      const net_price = req.body?.net_price != null ? Number(req.body.net_price) : null;
      let r;
      if (hasExtra) {
        const args = [orgId ?? null, itemId, supplierId, data.supplier_item_code, data.price, data.currency, data.moq, data.lead_time_days, data.preferred, data.priority, data.notes, catalog_price, discount, net_price];
        r = await pool.query(`INSERT INTO mod_bom_item_vendors(org_id, item_id, supplier_id, supplier_item_code, price, currency, moq, lead_time_days, preferred, priority, notes, catalog_price, discount, net_price)
                               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                               ON CONFLICT (item_id, supplier_id) DO UPDATE SET
                                 org_id=COALESCE(EXCLUDED.org_id, mod_bom_item_vendors.org_id),
                                 supplier_item_code=EXCLUDED.supplier_item_code,
                                 price=EXCLUDED.price,
                                 currency=EXCLUDED.currency,
                                 moq=EXCLUDED.moq,
                                 lead_time_days=EXCLUDED.lead_time_days,
                                 preferred=EXCLUDED.preferred,
                                 priority=EXCLUDED.priority,
                                 notes=EXCLUDED.notes,
                                 catalog_price=EXCLUDED.catalog_price,
                                 discount=EXCLUDED.discount,
                                 net_price=EXCLUDED.net_price,
                                 updated_at=NOW()
                               RETURNING id`, args);
      } else {
        const args = [orgId ?? null, itemId, supplierId, data.supplier_item_code, data.price, data.currency, data.moq, data.lead_time_days, data.preferred, data.priority, data.notes];
        r = await pool.query(`INSERT INTO mod_bom_item_vendors(org_id, item_id, supplier_id, supplier_item_code, price, currency, moq, lead_time_days, preferred, priority, notes)
                               VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                               ON CONFLICT (item_id, supplier_id) DO UPDATE SET
                                 org_id=COALESCE(EXCLUDED.org_id, mod_bom_item_vendors.org_id),
                                 supplier_item_code=EXCLUDED.supplier_item_code,
                                 price=EXCLUDED.price,
                                 currency=EXCLUDED.currency,
                                 moq=EXCLUDED.moq,
                                 lead_time_days=EXCLUDED.lead_time_days,
                                 preferred=EXCLUDED.preferred,
                                 priority=EXCLUDED.priority,
                                 notes=EXCLUDED.notes,
                                 updated_at=NOW()
                               RETURNING id`, args);
      }
      return res.json({ ok:true, id: r.rows[0]?.id || null });
    } catch (e) { return res.status(500).json({ ok:false, error:'upsert_failed', message: e?.message || String(e) }); }
  });

  // Update vendor link
  app.put('/api/bom/items/:id/vendors/:supplierId', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const itemId = Number(req.params?.id || 0);
      const supplierId = Number(req.params?.supplierId || 0);
      if (!itemId || !supplierId) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = req.body?.org_id ?? pickOrgId(req);
      const fields = [];
      const args = [];
      const setField = (col, val) => { args.push(val); fields.push(`${col}=$${args.length}`); };
      if (req.body?.supplier_item_code !== undefined) setField('supplier_item_code', req.body.supplier_item_code == null ? null : String(req.body.supplier_item_code));
      if (req.body?.price !== undefined) setField('price', req.body.price == null ? null : Number(req.body.price));
      if (req.body?.currency !== undefined) setField('currency', req.body.currency == null ? null : String(req.body.currency));
      if (req.body?.moq !== undefined) setField('moq', req.body.moq == null ? null : Number(req.body.moq));
      if (req.body?.lead_time_days !== undefined) setField('lead_time_days', req.body.lead_time_days == null ? null : Number(req.body.lead_time_days));
      if (req.body?.preferred !== undefined) setField('preferred', !!req.body.preferred);
      if (req.body?.priority !== undefined) setField('priority', req.body.priority == null ? null : Number(req.body.priority));
      if (req.body?.notes !== undefined) setField('notes', req.body.notes == null ? null : String(req.body.notes));
      if (!fields.length) return res.status(400).json({ ok:false, error:'no_fields' });
      args.push(itemId); args.push(supplierId);
      let where = `item_id=$${args.length-1} AND supplier_id=$${args.length}`;
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $${args.length})`; }
      const r = await pool.query(`UPDATE mod_bom_item_vendors SET ${fields.join(', ')}, updated_at=NOW() WHERE ${where}`, args);
      return res.json({ ok:true, updated: r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'update_failed', message: e?.message || String(e) }); }
  });

  // Delete link
  app.delete('/api/bom/items/:id/vendors/:supplierId', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const itemId = Number(req.params?.id || 0);
      const supplierId = Number(req.params?.supplierId || 0);
      if (!itemId || !supplierId) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = pickOrgId(req);
      const args = [itemId, supplierId];
      let where = 'item_id=$1 AND supplier_id=$2';
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $3)`; }
      const r = await pool.query(`DELETE FROM mod_bom_item_vendors WHERE ${where}`, args);
      return res.json({ ok:true, deleted: r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });

  // Bulk import item-vendor links (item_code + vendor + optional fields)
  app.post('/api/bom/items/vendors/import', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const mode = String(body.mode || body.format || '').toLowerCase();
      const text = body.text != null ? String(body.text) : '';
      const createItems = body.create_items !== false; // default true
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
      let linked = 0, missing = 0, upserts = 0, createdItems = 0;
      for (const r of rows) {
        const code = String(r['item_code'] || r['code'] || '').trim();
        const vendorName = String(r['VENDORS'] || r['vendor'] || r['supplier'] || r['supplier_name'] || '').trim();
        if (!code || !vendorName) { missing++; continue; }
        let itemId = null;
        const sel = await pool.query(`SELECT id FROM mod_bom_items WHERE sku=$1 ${orgId ? 'AND (org_id IS NULL OR org_id = $2)' : ''} LIMIT 1`, orgId ? [code, orgId] : [code]);
        if (sel.rowCount) {
          itemId = sel.rows[0].id;
        } else if (createItems) {
          // Best-effort create missing item with minimal fields derived from the row
          const name = String(r['name'] || r['Description'] || r['description'] || r['reference'] || '').trim() || code;
          const reference = String(r['reference'] || r['Reference'] || '').trim() || null;
          const description = String(r['description'] || r['Description'] || '').trim() || null;
          const description_short = String(r['description_short'] || '').trim() || null;
          const unit = String(r['unit'] || r['Unit'] || '').trim() || null;
          const uom = unit || 'pcs';
          const ins = await pool.query(`INSERT INTO mod_bom_items(org_id, sku, name, uom, attributes, code, reference, description, description_short, unit, created_at, updated_at)
                                        VALUES ($1,$2,$3,$4,'{}',$5,$6,$7,$8,$9,NOW(),NOW()) RETURNING id`,
                                        [orgId ?? null, code, name, uom, code, reference, description, description_short, unit]);
          itemId = ins.rows[0]?.id || null;
          if (itemId) createdItems++;
        } else {
          missing++; continue;
        }
        const supplierId = await getOrCreateSupplierIdByName(pool, vendorName, orgId);
        const payload = {
          supplier_item_code: r['supplier_item_code'] || null,
          price: r['price'] ? Number(r['price']) : null,
          currency: r['currency'] || null,
          moq: r['moq'] ? Number(r['moq']) : null,
          lead_time_days: r['lead_time_days'] ? Number(r['lead_time_days']) : null,
          preferred: /^1|true|yes$/i.test(String(r['preferred'] || '')),
          priority: r['priority'] ? Number(r['priority']) : null,
          notes: r['notes'] || null,
        };
        const args = [orgId ?? null, itemId, supplierId, payload.supplier_item_code, payload.price, payload.currency, payload.moq, payload.lead_time_days, payload.preferred, payload.priority, payload.notes];
        await pool.query(`INSERT INTO mod_bom_item_vendors(org_id, item_id, supplier_id, supplier_item_code, price, currency, moq, lead_time_days, preferred, priority, notes)
                          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                          ON CONFLICT (item_id, supplier_id) DO UPDATE SET
                            org_id=COALESCE(EXCLUDED.org_id, mod_bom_item_vendors.org_id),
                            supplier_item_code=EXCLUDED.supplier_item_code,
                            price=EXCLUDED.price,
                            currency=EXCLUDED.currency,
                            moq=EXCLUDED.moq,
                            lead_time_days=EXCLUDED.lead_time_days,
                            preferred=EXCLUDED.preferred,
                            priority=EXCLUDED.priority,
                            notes=EXCLUDED.notes,
                            updated_at=NOW()`);
        linked++; upserts++;
      }
      return res.json({ ok:true, linked, upserts, missing, createdItems });
    } catch (e) { return res.status(400).json({ ok:false, error:'vendors_import_failed', message: e?.message || String(e) }); }
  });
}
