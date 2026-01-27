function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

export function registerBomSupplierContactsRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool || ctx.pool;

  // List contacts
  app.get('/api/bom/suppliers/:id/contacts', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const supplierId = Number(req.params?.id || 0);
      if (!supplierId) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = pickOrgId(req);
      const args = [supplierId];
      let where = 'supplier_id=$1';
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $2)`; }
      const r = await pool.query(`SELECT id, supplier_id, name, email, phone, role, is_primary, meta, created_at, updated_at
                                    FROM mod_bom_supplier_contacts WHERE ${where}
                                   ORDER BY is_primary DESC, name ASC`, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Create contact
  app.post('/api/bom/suppliers/:id/contacts', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const supplierId = Number(req.params?.id || 0);
      if (!supplierId) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = req.body?.org_id ?? pickOrgId(req);
      const name = req.body?.name != null ? String(req.body.name) : null;
      const email = req.body?.email != null ? String(req.body.email) : null;
      const phone = req.body?.phone != null ? String(req.body.phone) : null;
      const role = req.body?.role != null ? String(req.body.role) : null;
      const isPrimary = !!req.body?.is_primary;
      const meta = (req.body?.meta && typeof req.body.meta === 'object') ? req.body.meta : {};
      const r = await pool.query(`INSERT INTO mod_bom_supplier_contacts(org_id, supplier_id, name, email, phone, role, is_primary, meta)
                                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
                                   [orgId ?? null, supplierId, name, email, phone, role, isPrimary, meta]);
      return res.json({ ok:true, id: r.rows[0]?.id || null });
    } catch (e) { return res.status(500).json({ ok:false, error:'create_failed', message: e?.message || String(e) }); }
  });

  // Update contact
  app.put('/api/bom/suppliers/:id/contacts/:cid', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const supplierId = Number(req.params?.id || 0);
      const cid = Number(req.params?.cid || 0);
      if (!supplierId || !cid) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = req.body?.org_id ?? pickOrgId(req);
      const fields = [];
      const args = [];
      if (req.body?.name !== undefined) { args.push(req.body.name == null ? null : String(req.body.name)); fields.push(`name=$${args.length}`); }
      if (req.body?.email !== undefined) { args.push(req.body.email == null ? null : String(req.body.email)); fields.push(`email=$${args.length}`); }
      if (req.body?.phone !== undefined) { args.push(req.body.phone == null ? null : String(req.body.phone)); fields.push(`phone=$${args.length}`); }
      if (req.body?.role !== undefined) { args.push(req.body.role == null ? null : String(req.body.role)); fields.push(`role=$${args.length}`); }
      if (req.body?.is_primary !== undefined) { args.push(!!req.body.is_primary); fields.push(`is_primary=$${args.length}`); }
      if (req.body?.meta && typeof req.body.meta === 'object') { args.push(req.body.meta); fields.push(`meta=$${args.length}`); }
      if (!fields.length) return res.status(400).json({ ok:false, error:'no_fields' });
      args.push(cid); args.push(supplierId);
      let where = `id=$${args.length-1} AND supplier_id=$${args.length}`;
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $${args.length})`; }
      const r = await pool.query(`UPDATE mod_bom_supplier_contacts SET ${fields.join(', ')}, updated_at=NOW() WHERE ${where}`, args);
      return res.json({ ok:true, updated: r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'update_failed', message: e?.message || String(e) }); }
  });

  // Delete contact
  app.delete('/api/bom/suppliers/:id/contacts/:cid', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const supplierId = Number(req.params?.id || 0);
      const cid = Number(req.params?.cid || 0);
      if (!supplierId || !cid) return res.status(400).json({ ok:false, error:'invalid_id' });
      const orgId = pickOrgId(req);
      const args = [cid, supplierId];
      let where = 'id=$1 AND supplier_id=$2';
      if (orgId) { args.push(orgId); where += ` AND (org_id IS NULL OR org_id = $3)`; }
      const r = await pool.query(`DELETE FROM mod_bom_supplier_contacts WHERE ${where}`, args);
      return res.json({ ok:true, deleted: r.rowCount });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });
}

