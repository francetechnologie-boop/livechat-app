function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; } }

export function registerProductDataUpdateFillProfilesRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  // List saved profiles for org (or global when org is null)
  app.get('/api/product_data_update/fill-profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const args = [];
      const whereOrg = (orgId ? ' WHERE (org_id IS NULL OR org_id = $1)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT id, name, profile_id, prefix, overwrite, created_at, updated_at FROM mod_product_data_update_fill_profiles${whereOrg} ORDER BY updated_at DESC, name ASC`, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Get one
  app.get('/api/product_data_update/fill-profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const orgId = pickOrgId(req);
    try {
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT id, name, org_id, profile_id, prefix, fields, prompt_config_id, limits, overwrite, created_at, updated_at FROM mod_product_data_update_fill_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Create new
  app.post('/api/product_data_update/fill-profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) return res.status(400).json({ ok:false, error:'bad_request', message:'name required' });
    const orgId = (b.org_id != null) ? (String(b.org_id).trim() || null) : pickOrgId(req);
    const row = {
      org_id: orgId,
      name,
      profile_id: b.profile_id != null ? Number(b.profile_id) : null,
      prefix: b.prefix != null ? String(b.prefix) : null,
      fields: b.fields && typeof b.fields === 'object' ? b.fields : null,
      prompt_config_id: b.prompt_config_id ? String(b.prompt_config_id) : null,
      limits: b.limits && typeof b.limits === 'object' ? b.limits : null,
      overwrite: !!b.overwrite,
    };
    try {
      const r = await pool.query(
        `INSERT INTO mod_product_data_update_fill_profiles (org_id, name, profile_id, prefix, fields, prompt_config_id, limits, overwrite)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8)
         RETURNING id`,
        [row.org_id, row.name, row.profile_id, row.prefix, JSON.stringify(row.fields||{}), row.prompt_config_id, JSON.stringify(row.limits||{}), row.overwrite]
      );
      return res.json({ ok:true, id: r.rows[0].id });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Update
  app.put('/api/product_data_update/fill-profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    const b = req.body || {};
    const orgId = (b.org_id != null) ? (String(b.org_id).trim() || null) : pickOrgId(req);
    const row = {
      org_id: orgId,
      name: b.name != null ? String(b.name) : null,
      profile_id: b.profile_id != null ? Number(b.profile_id) : null,
      prefix: b.prefix != null ? String(b.prefix) : null,
      fields: b.fields && typeof b.fields === 'object' ? b.fields : null,
      prompt_config_id: b.prompt_config_id ? String(b.prompt_config_id) : null,
      limits: b.limits && typeof b.limits === 'object' ? b.limits : null,
      overwrite: b.overwrite != null ? !!b.overwrite : null,
    };
    const sets = []; const args = []; let i = 1;
    const push = (col, val, cast) => { if (val !== null) { sets.push(`${col} = $${i}${cast||''}`); args.push(val); i++; } };
    push('org_id', row.org_id);
    push('name', row.name);
    push('profile_id', row.profile_id);
    push('prefix', row.prefix);
    if (row.fields !== null) push('fields', JSON.stringify(row.fields||{}), '::jsonb');
    push('prompt_config_id', row.prompt_config_id);
    if (row.limits !== null) push('limits', JSON.stringify(row.limits||{}), '::jsonb');
    if (row.overwrite !== null) push('overwrite', row.overwrite);
    sets.push(`updated_at = NOW()`);
    args.push(id);
    const sql = `UPDATE mod_product_data_update_fill_profiles SET ${sets.join(', ')} WHERE id = $${i}`;
    try { await pool.query(sql, args); return res.json({ ok:true, id }); }
    catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Delete
  app.delete('/api/product_data_update/fill-profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_request' });
    try { await pool.query(`DELETE FROM mod_product_data_update_fill_profiles WHERE id=$1`, [id]); return res.json({ ok:true }); }
    catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
