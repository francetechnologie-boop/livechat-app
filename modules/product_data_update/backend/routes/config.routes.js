export function registerProductDataUpdateConfigRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  if (!pool || typeof pool.query !== 'function') return;

  // Load current config for org
  app.get('/api/product_data_update/config', async (req, res) => {
    const orgId = req.query && req.query.org_id ? String(req.query.org_id) : null;
    try {
      const args = [];
      let where = '';
      if (orgId) { where = 'WHERE org_id = $1'; args.push(orgId); }
      const r = await pool.query(
        `SELECT id, org_id, default_profile_id, default_prefix, created_at, updated_at
           FROM mod_product_data_update_config ${where}
         ORDER BY updated_at DESC
          LIMIT 1`, args);
      const item = (r.rows && r.rows[0]) || null;
      return res.json({ ok: true, item });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Upsert config for org
  app.put('/api/product_data_update/config', async (req, res) => {
    const b = req.body || {};
    const orgId = (b.org_id != null) ? String(b.org_id) : null;
    const profileId = (b.default_profile_id != null) ? Number(b.default_profile_id) : null;
    const prefix = (b.default_prefix != null) ? String(b.default_prefix) : null;
    try {
      const cli = await pool.connect();
      try {
        await cli.query('BEGIN');
        // Try update latest row for org (or global when orgId is null)
        const argsUpd = [profileId, prefix];
        let where = 'WHERE org_id IS NULL';
        if (orgId) { where = 'WHERE org_id = $3'; argsUpd.push(orgId); }
        const rUpd = await cli.query(
          `UPDATE mod_product_data_update_config
              SET default_profile_id = $1, default_prefix = $2, updated_at = NOW()
            ${where}
           RETURNING id, org_id, default_profile_id, default_prefix, created_at, updated_at`, argsUpd);
        let row = rUpd.rows && rUpd.rows[0];
        if (!row) {
          const argsIns = [orgId, profileId, prefix];
          const rIns = await cli.query(
            `INSERT INTO mod_product_data_update_config (org_id, default_profile_id, default_prefix)
                  VALUES ($1, $2, $3)
               RETURNING id, org_id, default_profile_id, default_prefix, created_at, updated_at`, argsIns);
          row = rIns.rows && rIns.rows[0];
        }
        await cli.query('COMMIT');
        return res.json({ ok: true, item: row });
      } catch (e) { try { await cli.query('ROLLBACK'); } catch {}; throw e; }
      finally { cli.release(); }
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}

