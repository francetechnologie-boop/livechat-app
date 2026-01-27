import { getPgModule } from '../utils/pg.js';

function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

function normalizeConn(raw = {}, fallback = {}) {
  const src = { ...fallback, ...raw };
  const map = (obj, from, to) => { if (obj[from] !== undefined && obj[to] === undefined) obj[to] = obj[from]; };
  map(src, 'database_host', 'host'); map(src, 'db_host', 'host');
  map(src, 'database_port', 'port'); map(src, 'db_port', 'port');
  map(src, 'database_name', 'database'); map(src, 'db_name', 'database');
  map(src, 'database_user', 'user'); map(src, 'db_user', 'user');
  map(src, 'database_password', 'password'); map(src, 'db_password', 'password');
  return {
    host: String(src.host || '').trim(),
    port: Number(src.port || 5432),
    database: String(src.database || '').trim(),
    user: String(src.user || '').trim(),
    password: src.password != null ? String(src.password) : '',
    ssl: !!src.ssl,
  };
}

export function registerDbPostgresqlTestRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });

  app.post('/api/db-postgresql/test', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const pid = b.profile_id ? Number(b.profile_id) : 0;
      let saved = null;
      if (pid > 0 && pool && typeof pool.query === 'function') {
        const args = [pid];
        const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
        if (orgId) args.push(orgId);
        const r = await pool.query(`SELECT host, port, database, db_user AS user, db_password AS password, ssl FROM mod_db_postgresql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
        if (r && r.rowCount) saved = r.rows[0];
      }
      const cfg = normalizeConn(b, saved || {});
      if (!saved && (!cfg.host || !cfg.database || !cfg.user)) {
        return res.status(400).json({ ok:false, error:'no_config', message:'Provide profile_id or host/port/database/user/password' });
      }
      const { Client } = await getPgModule(ctx);
      const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;
      const client = new Client({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ssl });
      try {
        await client.connect();
        const r = await client.query('SELECT 1 AS x');
        return res.json({ ok:true, result: (r && r.rows && r.rows[0]) || null });
      } finally { try { await client.end(); } catch {} }
    } catch (e) {
      if (e?.code === 'PG_MISSING' || e?.message === 'pg_missing') return res.status(500).json({ ok:false, error:'pg_missing', message:'Install pg in backend: cd backend && npm i pg --omit=dev' });
      return res.status(400).json({ ok:false, error:'connect_failed', message: e?.message || String(e) });
    }
  });
}

