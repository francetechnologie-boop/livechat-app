function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

export function registerBomBomsRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool || ctx.pool;
  const chatLog = utils.chatLog || (()=>{});

  // List BOMs
  app.get('/api/bom/boms', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const orgId = pickOrgId(req);
      const q = String(req.query?.q || '').trim();
      const limit = Math.max(0, Math.min(5000, Number(req.query?.limit || 200)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const args = [];
      let where = 'WHERE 1=1';
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $${args.length})`; }
      if (q) { args.push(`%${q}%`); where += ` AND (name ILIKE $${args.length} OR COALESCE(description,'') ILIKE $${args.length})`; }
      args.push(limit); args.push(offset);
      const r = await pool.query(`SELECT id, org_id, name, description, created_at, updated_at
                                    FROM mod_bom_boms ${where}
                                   ORDER BY name ASC
                                   LIMIT $${args.length-1} OFFSET $${args.length}`, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Create BOM
  app.post('/api/bom/boms', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ ok:false, error:'name_required' });
      const desc = body.description != null ? String(body.description) : null;
      const r = await pool.query(`INSERT INTO mod_bom_boms(org_id, name, description, created_at, updated_at)
                                   VALUES($1,$2,$3,NOW(),NOW()) RETURNING id`, [orgId ?? null, name, desc]);
      chatLog('bom_create', { id: r.rows[0]?.id || null, name });
      return res.json({ ok:true, id: r.rows[0]?.id || null });
    } catch (e) { return res.status(500).json({ ok:false, error:'create_failed', message: e?.message || String(e) }); }
  });

  // Update BOM
  app.put('/api/bom/boms/:id', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).json({ ok:false, error:'invalid_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const fields = [];
      const args = [];
      if (body.name != null) { args.push(String(body.name)); fields.push(`name=$${args.length}`); }
      if (body.description !== undefined) { args.push(body.description == null ? null : String(body.description)); fields.push(`description=$${args.length}`); }
      if (!fields.length) return res.status(400).json({ ok:false, error:'no_fields' });
      args.push(id);
      let where = `id=$${args.length}`;
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $${args.length})`; }
      const r = await pool.query(`UPDATE mod_bom_boms SET ${fields.join(', ')}, updated_at=NOW() WHERE ${where}`, args);
      return res.json({ ok:true, updated: r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'update_failed', message: e?.message || String(e) }); }
  });

  // Delete BOM
  app.delete('/api/bom/boms/:id', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = pickOrgId(req);
      const args = [id];
      let where = 'id=$1';
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $2)`; }
      const r = await pool.query(`DELETE FROM mod_bom_boms WHERE ${where}`, args);
      return res.json({ ok:true, deleted: r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });

  // List BOM items
  app.get('/api/bom/boms/:id/items', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const bomId = Number(req.params?.id || 0);
      if (!bomId) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = pickOrgId(req);
      const args = [bomId];
      let where = 'bi.bom_id=$1';
      if (orgId) { args.push(orgId); where += ` AND (bi.org_id IS NULL OR bi.org_id = $2)`; }
      const r = await pool.query(`SELECT bi.id, bi.bom_id, bi.item_id, bi.quantity, bi.position,
                                         i.sku, i.name, i.uom
                                    FROM mod_bom_bom_items bi
                                    JOIN mod_bom_items i ON i.id = bi.item_id
                                   WHERE ${where}
                                   ORDER BY COALESCE(bi.position, 0), i.name ASC`, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Add item to BOM
  app.post('/api/bom/boms/:id/items', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const bomId = Number(req.params?.id || 0);
      if (!bomId) return res.status(400).json({ ok:false, error:'invalid_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const itemId = Number(body.item_id || 0);
      const qty = Number(body.quantity || 1);
      const pos = body.position != null ? Number(body.position) : null;
      if (!itemId) return res.status(400).json({ ok:false, error:'item_required' });
      const r = await pool.query(`INSERT INTO mod_bom_bom_items(org_id, bom_id, item_id, quantity, position)
                                   VALUES ($1,$2,$3,$4,$5) ON CONFLICT (bom_id, item_id) DO UPDATE SET quantity=EXCLUDED.quantity, position=COALESCE(EXCLUDED.position, mod_bom_bom_items.position)
                                   RETURNING id`, [orgId ?? null, bomId, itemId, qty, pos]);
      chatLog('bom_add_item', { bom_id: bomId, item_id: itemId, quantity: qty });
      return res.json({ ok:true, id: r.rows[0]?.id || null });
    } catch (e) { return res.status(500).json({ ok:false, error:'add_failed', message: e?.message || String(e) }); }
  });

  // Update item in BOM
  app.put('/api/bom/boms/:id/items/:itemId', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const bomId = Number(req.params?.id || 0);
      const itemId = Number(req.params?.itemId || 0);
      if (!bomId || !itemId) return res.status(400).json({ ok:false, error:'invalid_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const fields = [];
      const args = [];
      if (body.quantity != null) { args.push(Number(body.quantity)); fields.push(`quantity=$${args.length}`); }
      if (body.position !== undefined) { args.push(body.position == null ? null : Number(body.position)); fields.push(`position=$${args.length}`); }
      if (!fields.length) return res.status(400).json({ ok:false, error:'no_fields' });
      args.push(bomId); args.push(itemId);
      let where = `bom_id=$${args.length-1} AND item_id=$${args.length}`;
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $${args.length})`; }
      const r = await pool.query(`UPDATE mod_bom_bom_items SET ${fields.join(', ')} WHERE ${where}`, args);
      return res.json({ ok:true, updated: r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'update_failed', message: e?.message || String(e) }); }
  });

  // Remove item from BOM
  app.delete('/api/bom/boms/:id/items/:itemId', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const bomId = Number(req.params?.id || 0);
      const itemId = Number(req.params?.itemId || 0);
      if (!bomId || !itemId) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = pickOrgId(req);
      const args = [bomId, itemId];
      let where = 'bom_id=$1 AND item_id=$2';
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $3)`; }
      const r = await pool.query(`DELETE FROM mod_bom_bom_items WHERE ${where}`, args);
      return res.json({ ok:true, deleted: r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });
}
