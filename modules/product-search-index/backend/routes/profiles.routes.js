function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; } }

export function registerPsiProfilesRoutes(app, ctx = {}, _utils = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  // List profiles
  app.get('/api/product-search-index/profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const args = [];
      const whereOrg = orgId ? ' WHERE (org_id IS NULL OR org_id = $1)' : '';
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT id, name, db_profile_id, prefix, id_shop, id_langs, org_id, created_at, updated_at FROM mod_product_search_index_profiles${whereOrg} ORDER BY updated_at DESC`, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // Create profile
  app.post('/api/product-search-index/profiles', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const name = String(b.name || '').trim();
      const dbProfileId = Number(b.db_profile_id || b.profile_id || 0);
      const prefix = String(b.prefix || 'ps_');
      const idShop = Number(b.id_shop || 0);
      const idLangs = Array.isArray(b.id_langs) ? b.id_langs : (String(b.id_langs || '').trim() ? String(b.id_langs).split(/[\s,;]+/).map(s=>Number(s)).filter(n=>n>0) : []);
      if (!name || !dbProfileId || !idShop) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(
        `INSERT INTO mod_product_search_index_profiles(name, db_profile_id, prefix, id_shop, id_langs, org_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
         RETURNING id`,
        [name, dbProfileId, prefix, idShop, JSON.stringify(idLangs), orgId]
      );
      return res.json({ ok:true, id: r.rows[0]?.id || null });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Get profile
  app.get('/api/product-search-index/profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const id = Number(req.params.id || 0);
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT id, name, db_profile_id, prefix, id_shop, id_langs, org_id, created_at, updated_at FROM mod_product_search_index_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Update profile
  app.put('/api/product-search-index/profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const id = Number(req.params.id || 0);
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const name = String(b.name || '').trim();
      const dbProfileId = Number(b.db_profile_id || b.profile_id || 0);
      const prefix = String(b.prefix || 'ps_');
      const idShop = Number(b.id_shop || 0);
      const idLangs = Array.isArray(b.id_langs) ? b.id_langs : (String(b.id_langs || '').trim() ? String(b.id_langs).split(/[\s,;]+/).map(s=>Number(s)).filter(n=>n>0) : []);
      if (!id || !name || !dbProfileId || !idShop) return res.status(400).json({ ok:false, error:'bad_request' });
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT 1 FROM mod_product_search_index_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      await pool.query(
        `UPDATE mod_product_search_index_profiles
            SET name=$2, db_profile_id=$3, prefix=$4, id_shop=$5, id_langs=$6, updated_at=NOW()
          WHERE id=$1`,
        [id, name, dbProfileId, prefix, idShop, JSON.stringify(idLangs)]
      );
      return res.json({ ok:true, id });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Delete profile
  app.delete('/api/product-search-index/profiles/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const id = Number(req.params.id || 0);
      const args = [id];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`DELETE FROM mod_product_search_index_profiles WHERE id=$1${whereOrg}`, args);
      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}

