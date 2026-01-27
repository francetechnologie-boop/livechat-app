import { getPgModule } from '../utils/pg.js';

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

function buildPrefixWhere(prefixes, paramsStartIndex = 1) {
  const conds = [];
  const params = [];
  let idx = paramsStartIndex;
  for (const p0 of prefixes) {
    const p = String(p0 || '').trim();
    if (!p) continue;
    const dot = p.indexOf('.');
    if (dot > 0) {
      const schema = p.slice(0, dot).trim();
      const rest = p.slice(dot + 1).trim();
      if (!schema) continue;
      if (!rest) {
        conds.push(`(table_schema = $${idx})`);
        params.push(schema);
        idx += 1;
      } else {
        conds.push(`(table_schema = $${idx} AND table_name ILIKE $${idx + 1})`);
        params.push(schema);
        params.push(`${rest}%`);
        idx += 2;
      }
    } else {
      conds.push(`(table_name ILIKE $${idx})`);
      params.push(`${p}%`);
      idx += 1;
    }
  }
  if (!conds.length) return { where: '', params, nextIndex: idx };
  return { where: ` AND (${conds.join(' OR ')})`, params, nextIndex: idx };
}

export function registerDbPostgresqlResourcesRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });

  async function getProfile(orgId, profileId) {
    if (!pool || typeof pool.query !== 'function') return null;
    const pid = Number(profileId || 0);
    if (!pid) return null;
    const args = [pid];
    const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
    if (orgId) args.push(orgId);
    const r = await pool.query(
      `SELECT host, port, database, db_user AS "user", db_password AS "password", ssl, table_prefixes
         FROM mod_db_postgresql_profiles
        WHERE id=$1${whereOrg}
        LIMIT 1`,
      args,
    );
    return r && r.rowCount ? r.rows[0] : null;
  }

  // List tables/views that are "available" for a profile, filtered by the profile's table_prefixes.
  // - table_prefixes is a comma/newline-separated list of prefixes.
  // - A prefix may be "schema.tableprefix" (matches schema + table name prefix) or just "tableprefix".
  // - A prefix may also be "schema." (matches all tables in the schema).
  app.get('/api/db-postgresql/profiles/:id/tables', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    const profileId = Number(req.params.id || 0);
    if (!profileId) return res.status(400).json({ ok: false, error: 'bad_request' });
    try {
      const cfg = await getProfile(orgId, profileId);
      if (!cfg) return res.status(404).json({ ok: false, error: 'not_found' });

      const includeViews = String(req.query?.include_views || '') === '1' || String(req.query?.include_views || '').toLowerCase() === 'true';
      const limit = Math.max(1, Math.min(10000, Number(req.query?.limit || 2000)));
      const prefixes = (() => {
        const fromQuery = parsePrefixList(req.query?.prefixes || req.query?.prefix || null);
        if (fromQuery.length) return fromQuery;
        return parsePrefixList(cfg.table_prefixes || null);
      })();

      const { Client } = await getPgModule(ctx);
      const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;
      const client = new Client({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ssl });
      try {
        await client.connect();
        let base = `
          SELECT table_schema, table_name, table_type
            FROM information_schema.tables
           WHERE table_schema NOT IN ('pg_catalog','information_schema')
        `;
        base += includeViews ? ` AND (table_type IN ('BASE TABLE','VIEW'))` : ` AND (table_type = 'BASE TABLE')`;

        const p = buildPrefixWhere(prefixes, 1);
        const sql = `${base}${p.where} ORDER BY table_schema, table_name LIMIT $${p.nextIndex}`;
        const args = [...p.params, limit];
        const r = await client.query(sql, args);
        const items = (r && Array.isArray(r.rows)) ? r.rows.map((row) => ({
          schema: row.table_schema,
          name: row.table_name,
          type: row.table_type,
          full_name: `${row.table_schema}.${row.table_name}`,
        })) : [];
        return res.json({ ok: true, profile_id: profileId, prefixes, includeViews, items });
      } finally {
        try { await client.end(); } catch {}
      }
    } catch (e) {
      if (e?.code === 'PG_MISSING' || e?.message === 'pg_missing') return res.status(500).json({ ok:false, error:'pg_missing', message:'Install pg in backend: cd backend && npm i pg --omit=dev' });
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // MCP2 compatibility: list resources for this profile (tables/views). Used by mcp2 transport fallback.
  app.get('/api/db-postgresql/profiles/:id/resources', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      // Delegate to tables endpoint logic by reusing the same handler semantics.
      // Keep response shape stable: { ok:true, items:[{uri,name,description,mimeType}] }
      const orgId = pickOrgId(req);
      const profileId = Number(req.params.id || 0);
      if (!profileId) return res.status(400).json({ ok: false, error: 'bad_request' });
      const cfg = await getProfile(orgId, profileId);
      if (!cfg) return res.status(404).json({ ok: false, error: 'not_found' });

      const includeViews = String(req.query?.include_views || '') === '1' || String(req.query?.include_views || '').toLowerCase() === 'true';
      const limit = Math.max(1, Math.min(10000, Number(req.query?.limit || 2000)));
      const prefixes = (() => {
        const fromQuery = parsePrefixList(req.query?.prefixes || req.query?.prefix || null);
        if (fromQuery.length) return fromQuery;
        return parsePrefixList(cfg.table_prefixes || null);
      })();

      const { Client } = await getPgModule(ctx);
      const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;
      const client = new Client({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ssl });
      try {
        await client.connect();
        let base = `
          SELECT table_schema, table_name, table_type
            FROM information_schema.tables
           WHERE table_schema NOT IN ('pg_catalog','information_schema')
        `;
        base += includeViews ? ` AND (table_type IN ('BASE TABLE','VIEW'))` : ` AND (table_type = 'BASE TABLE')`;
        const p = buildPrefixWhere(prefixes, 1);
        const sql = `${base}${p.where} ORDER BY table_schema, table_name LIMIT $${p.nextIndex}`;
        const args = [...p.params, limit];
        const r = await client.query(sql, args);
        const items = (r && Array.isArray(r.rows))
          ? r.rows.map((row) => {
            const full = `${row.table_schema}.${row.table_name}`;
            return {
              uri: `pg:${profileId}:table:${full}`,
              name: full,
              description: row.table_type === 'VIEW' ? 'view' : 'table',
              mimeType: 'application/sql',
              schema: row.table_schema,
              table: row.table_name,
              type: row.table_type,
            };
          })
          : [];
        return res.json({ ok: true, profile_id: profileId, prefixes, includeViews, items });
      } finally {
        try { await client.end(); } catch {}
      }
    } catch (e) {
      if (e?.code === 'PG_MISSING' || e?.message === 'pg_missing') return res.status(500).json({ ok:false, error:'pg_missing', message:'Install pg in backend: cd backend && npm i pg --omit=dev' });
      return res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // MCP2 compatibility: resource templates (not implemented yet)
  app.get('/api/db-postgresql/profiles/:id/resource-templates', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    return res.json({ ok: true, items: [] });
  });
}

