function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

export function registerGrabbingJeromeMysqlRoutes(app, _ctx = {}, utils = {}) {
  const { pool } = utils;
  if (!pool || typeof pool.query !== 'function') return;

  // Lightweight profile list for Mapping page (no secrets)
  // Returns: id, name, host, port, database, ssl, is_default
  app.get('/api/grabbing-jerome/mysql/profiles', async (req, res) => {
    try {
      const orgId = pickOrgId(req);
      const args = [];
      const whereOrg = (orgId ? ' WHERE (org_id IS NULL OR org_id = $1)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(
        `SELECT id, name, host, port, "database", ssl, is_default
           FROM mod_db_mysql_profiles${whereOrg}
          ORDER BY updated_at DESC`
      , args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}

