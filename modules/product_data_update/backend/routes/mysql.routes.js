import { createRequire } from 'module';
import path from 'path';

function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

function normalizeConn(raw = {}) {
  const host = String(raw.host || '').trim();
  const port = Number(raw.port || 3306);
  const database = String(raw.database || '').trim();
  const user = String(raw.user || raw.db_user || '').trim();
  const password = raw.password != null ? String(raw.password) : String(raw.db_password || '');
  const ssl = !!raw.ssl;
  return { host, port, database, user, password, ssl };
}

function validPrefix(s) { return /^[A-Za-z0-9_]+$/.test(String(s||'')); }

async function getMysql2(ctx) {
  try { const mod = await import('mysql2/promise'); return mod && (mod.default || mod); } catch {}
  try {
    // Fallback to backend node_modules via createRequire
    const backendDir = (ctx && ctx.backendDir) || path.resolve(process.cwd(), 'backend');
    const req = createRequire(path.join(backendDir, 'package.json'));
    const mod = req('mysql2/promise');
    return mod && (mod.default || mod);
  } catch {}
  const err = new Error('mysql2_missing'); err.code = 'MYSQL2_MISSING'; throw err;
}

export function registerProductDataUpdateMysqlRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });
  if (!pool || typeof pool.query !== 'function') return;

  // List shops and languages from the selected MySQL profile
  // GET /api/product_data_update/mysql/options?profile_id=&prefix=&org_id=
  app.get('/api/product_data_update/mysql/options', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    const profileId = Number(req.query && req.query.profile_id ? req.query.profile_id : 0);
    const prefix = String(req.query && req.query.prefix || '').trim();
    if (!profileId || !prefix || !validPrefix(prefix)) return res.status(400).json({ ok:false, error:'bad_request' });
    try {
      const args = [profileId];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT host, port, "database", db_user AS user, db_password AS password, ssl FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (!r || !r.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const cfg = normalizeConn(r.rows[0]);

      const mysql = await getMysql2(ctx);
      const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;
      let conn;
      try {
        conn = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ssl });
        const tblShop = `${prefix}shop`;
        const tblLang = `${prefix}lang`;
        const tblLangShop = `${prefix}lang_shop`;
        const [shops] = await conn.query(`SELECT id_shop, name FROM \`${tblShop}\` ORDER BY id_shop ASC`);
        const [langs] = await conn.query(`SELECT id_lang, name, iso_code, active FROM \`${tblLang}\` ORDER BY id_lang ASC`);
        let langShop = [];
        try { const [ls] = await conn.query(`SELECT id_lang, id_shop FROM \`${tblLangShop}\` ORDER BY id_shop ASC, id_lang ASC`); langShop = ls; } catch {}
        return res.json({ ok:true, shops, langs, lang_shop: langShop });
      } finally { try { if (conn) await conn.end(); } catch {} }
    } catch (e) {
      if (e?.code === 'MYSQL2_MISSING' || e?.message === 'mysql2_missing') return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' });
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });
}

