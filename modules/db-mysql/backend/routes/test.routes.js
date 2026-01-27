import { getMysql2 } from '../utils/mysql2.js';

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
    port: Number(src.port || 3306),
    database: String(src.database || '').trim(),
    user: String(src.user || '').trim(),
    password: src.password != null ? String(src.password) : '',
    ssl: !!src.ssl,
  };
}

export function registerDbMysqlTestRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });

  app.post('/api/db-mysql/test', async (req, res) => {
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
        const r = await pool.query(`SELECT host, port, "database", db_user AS user, db_password AS password, ssl FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
        if (r && r.rowCount) saved = r.rows[0];
      }
      // No default profile fallback — require explicit profile_id or ad-hoc connection
      const cfg = normalizeConn(b, saved || {});
      if (!saved && (!cfg.host || !cfg.database || !cfg.user)) {
        return res.status(400).json({ ok:false, error:'no_config', message:'Provide profile_id or host/port/database/user/password' });
      }
      const host = cfg.host || 'localhost';
      const port = Number(cfg.port || 3306);
      const database = cfg.database || 'mysql';
      const user = cfg.user || '';
      const password = cfg.password || '';
      const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;

      const mysql = await getMysql2(ctx);
      let conn; try {
        conn = await mysql.createConnection({ host, port, user, password, database, ssl });
        const [rows] = await conn.query('SELECT 1 AS x');
        return res.json({ ok: true, result: rows && rows[0] });
      } finally { try { if (conn) await conn.end(); } catch {} }
    } catch (e) {
      if (e?.code === 'MYSQL2_MISSING' || e?.message === 'mysql2_missing') return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' });
      return res.status(400).json({ ok:false, error:'connect_failed', message: e?.message || String(e) });
    }
  });
}
