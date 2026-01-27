import { getPgModule } from '../utils/pg.js';

function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

export function registerDbPostgresqlViewsRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });

  async function getProfile(orgId, profileId) {
    if (!pool || typeof pool.query !== 'function') return null;
    if (profileId && Number(profileId) > 0) {
      const args = [Number(profileId)];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT host, port, database, db_user AS user, db_password AS password, ssl FROM mod_db_postgresql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (r && r.rowCount) return r.rows[0];
    }
    return null;
  }

  app.get('/api/db-postgresql/views', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    const profileId = req.query?.profile_id ? Number(req.query.profile_id) : 0;
    try {
      const cfg = await getProfile(orgId, profileId);
      if (!cfg) return res.status(400).json({ ok:false, error:'no_profile_selected', message:'Provide profile_id to list views.' });
      const { Client } = await getPgModule(ctx);
      const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;
      const client = new Client({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ssl });
      try {
        await client.connect();
        const q = `SELECT table_schema AS schema, table_name AS name, view_definition AS definition
                   FROM information_schema.views
                   WHERE table_schema NOT IN ('pg_catalog','information_schema')
                   ORDER BY table_schema, table_name`;
        const r = await client.query(q);
        const views = (r && r.rows) ? r.rows.map(v => ({ schema: v.schema, name: v.name, definition: v.definition || null })) : [];
        return res.json({ ok:true, views });
      } finally { try { await client.end(); } catch {} }
    } catch (e) {
      if (e?.code === 'PG_MISSING' || e?.message === 'pg_missing') return res.status(500).json({ ok:false, error:'pg_missing', message:'Install pg in backend: cd backend && npm i pg --omit=dev' });
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });
}

