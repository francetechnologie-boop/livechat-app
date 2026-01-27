import { getMysql2 } from '../utils/mysql2.js';

function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

function parsePrefixList(raw) {
  try {
    if (raw == null) return [];
    const s = String(raw);
    return s
      .split(/[\n,]+/g)
      .map((x) => String(x || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function registerDbMysqlTablesRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  async function getProfile(orgId, profileId) {
    const pid = Number(profileId || 0);
    if (!pid) return null;
    const args = [pid];
    const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
    if (orgId) args.push(orgId);
    const r = await pool.query(
      `SELECT host, port, "database", db_user AS "user", db_password AS "password", ssl, table_prefixes
         FROM mod_db_mysql_profiles
        WHERE id=$1${whereOrg}
        LIMIT 1`,
      args,
    );
    return r && r.rowCount ? r.rows[0] : null;
  }

  // List tables/views filtered by profile.table_prefixes.
  // Prefix list format:
  // - "ps_" matches any table starting with ps_
  // - "mydb.ps_" (optional) uses the db part as schema override; otherwise profile.database is used
  app.get('/api/db-mysql/profiles/:id/tables', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    const profileId = Number(req.params.id || 0);
    if (!profileId) return res.status(400).json({ ok: false, error: 'bad_request' });
    try {
      const cfg = await getProfile(orgId, profileId);
      if (!cfg) return res.status(404).json({ ok: false, error: 'not_found' });

      const includeViews = String(req.query?.include_views || '') === '1' || String(req.query?.include_views || '').toLowerCase() === 'true';
      const limit = Math.max(1, Math.min(20000, Number(req.query?.limit || 2000)));

      const prefixes = (() => {
        const fromQuery = parsePrefixList(req.query?.prefixes || req.query?.prefix || null);
        if (fromQuery.length) return fromQuery;
        return parsePrefixList(cfg.table_prefixes || null);
      })();

      const mysql2 = await getMysql2(ctx);
      const connOpts = {
        host: String(cfg.host || ''),
        port: Number(cfg.port || 3306),
        user: String(cfg.user || ''),
        password: String(cfg.password || ''),
        database: String(cfg.database || ''),
      };
      if (cfg.ssl) connOpts.ssl = { rejectUnauthorized: false };

      const db = await mysql2.createConnection(connOpts);
      try {
        // Determine schema (database) to query
        const schema = String(req.query?.schema || '').trim() || String(cfg.database || '').trim();
        if (!schema) return res.status(400).json({ ok: false, error: 'no_schema', message: 'No database selected' });

        const where = ['table_schema = ?'];
        const args = [schema];
        if (!includeViews) {
          where.push(`table_type = 'BASE TABLE'`);
        } else {
          where.push(`table_type IN ('BASE TABLE','VIEW')`);
        }

        // Apply prefixes (OR)
        const likeConds = [];
        for (const p0 of prefixes) {
          const p = String(p0 || '').trim();
          if (!p) continue;
          const dot = p.indexOf('.');
          if (dot > 0) {
            const dbPart = p.slice(0, dot).trim();
            const pref = p.slice(dot + 1).trim();
            if (dbPart && dbPart !== schema) continue; // keep strict: profile database only
            if (!pref) continue;
            likeConds.push('table_name LIKE ?');
            args.push(`${pref}%`);
          } else {
            likeConds.push('table_name LIKE ?');
            args.push(`${p}%`);
          }
        }
        if (likeConds.length) where.push(`(${likeConds.join(' OR ')})`);

        const sql = `
          SELECT table_name, table_type
            FROM information_schema.tables
           WHERE ${where.join(' AND ')}
           ORDER BY table_name
           LIMIT ?
        `;
        args.push(limit);
        const [rows] = await db.execute(sql, args);
        const items = Array.isArray(rows)
          ? rows.map((row) => ({
            name: row.table_name,
            type: row.table_type,
            full_name: `${schema}.${row.table_name}`,
            schema,
          }))
          : [];
        return res.json({ ok: true, profile_id: profileId, schema, prefixes, includeViews, items });
      } finally {
        try { await db.end(); } catch {}
      }
    } catch (e) {
      if (e?.code === 'MYSQL2_MISSING' || e?.message === 'mysql2_missing') return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend' });
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });
}

