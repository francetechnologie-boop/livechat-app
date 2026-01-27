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
  const out = {
    host: String(src.host || '').trim(),
    port: Number(src.port || 3306),
    database: String(src.database || '').trim(),
    user: String(src.user || '').trim(),
    password: src.password != null ? String(src.password) : '',
    ssl: !!src.ssl,
  };
  return out;
}

export function registerDbMysqlAiRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(403).end(); return false; });

  async function getProfileCfg(orgId, profileId) {
    if (!pool || typeof pool.query !== 'function') return null;
    if (profileId && Number(profileId) > 0) {
      const args = [Number(profileId)];
      const whereOrg = (orgId ? ' AND (org_id IS NULL OR org_id = $2)' : '');
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT host, port, "database", db_user AS user, db_password AS password, ssl FROM mod_db_mysql_profiles WHERE id=$1${whereOrg} LIMIT 1`, args);
      if (r && r.rowCount) return r.rows[0];
    }
    // No default profile fallback; require explicit profile selection
    return null;
  }

  app.get('/api/db-mysql/ai/summary', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const orgId = pickOrgId(req);
    const profileId = req.query?.profile_id ? Number(req.query.profile_id) : 0;
    const opts = {
      tables: req.query?.tables !== '0',
      columns: req.query?.columns !== '0',
      views: req.query?.views !== '0',
      data: req.query?.data === '1' || req.query?.data === 'true',
      sampleRows: Number(req.query?.sampleRows || 5),
      sampleTables: Number(req.query?.sampleTables || 3),
    };
    try {
      const saved = await getProfileCfg(orgId, profileId);
      if (!saved) return res.status(400).json({ ok:false, error:'no_profile_selected', message:'Provide profile_id to generate summary.' });
      const cfg = normalizeConn({}, saved);
      if (!cfg.database) return res.status(400).json({ ok:false, error:'database_not_set', message:'Profile missing database.' });

      const host = String(cfg.host || 'localhost');
      const port = Number(cfg.port || 3306);
      const dbName = String(cfg.database || '');
      const user = String(cfg.user || '');
      const password = String(cfg.password || '');
      const ssl = cfg.ssl ? { rejectUnauthorized: false } : undefined;

      const mysql = await getMysql2(ctx);
      const conn = await mysql.createConnection({ host, port, user, password, database: dbName, ssl });
      try {
        let md = `# Database Summary — ${dbName}`;
        md += `\n\nGenerated: ${new Date().toISOString()}`;
        const tables = [];
        const views = [];
        if (opts.tables || opts.columns) {
          const [rows] = await conn.query('SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [dbName]);
          for (const r of (rows||[])) tables.push({ name: r.name, type: String(r.type||'') });
        }
        if (opts.tables) {
          md += `\n\n## Tables (${tables.filter(t=>t.type.toUpperCase()!=='VIEW').length})\n`;
          for (const t of tables) { if (t.type.toUpperCase() !== 'VIEW') md += `- ${t.name}\n`; }
        }
        if (opts.columns) {
          md += `\n\n## Columns\n`;
          for (const t of tables) {
            const tname = t.name; if (t.type.toUpperCase() === 'VIEW') continue;
            const [cols] = await conn.query('SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [dbName, tname]);
            const arr = Array.isArray(cols) ? cols : [];
            md += `\n### ${tname}\n`;
            for (const c of arr) md += `- ${c.COLUMN_NAME} ${c.DATA_TYPE} ${c.IS_NULLABLE==='YES'?'NULL':'NOT NULL'} ${c.COLUMN_KEY?`(${c.COLUMN_KEY})`:''}\n`;
          }
        }
        if (opts.views) {
          const [rows] = await conn.query('SELECT TABLE_NAME AS name, VIEW_DEFINITION AS def FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?', [dbName]);
          for (const r of (rows||[])) views.push({ name: r.name, def: r.def || '' });
          if (views.length) {
            md += `\n\n## Views (${views.length})\n`;
            for (const v of views) {
              md += `\n### ${v.name}\n`;
              md += '```sql\n' + String(v.def||'').slice(0, 3000) + (String(v.def||'').length>3000?'\n-- [truncated]':'') + '\n```\n';
            }
          }
        }
        if (opts.data) {
          const sample = tables.filter(t => t.type.toUpperCase() !== 'VIEW').slice(0, Math.max(1, Math.min(5, opts.sampleTables)));
          md += `\n\n## Sample Data\n`;
          for (const t of sample) {
            const [rows] = await conn.query('SELECT * FROM `' + t.name.replace(/`/g, '``') + '` LIMIT ' + Math.max(1, Math.min(20, opts.sampleRows)));
            md += `\n### ${t.name}\n`;
            md += '```json\n' + JSON.stringify(rows || [], null, 2) + '\n```\n';
          }
        }
        return res.json({ ok:true, summary: md });
      } finally { try { await conn.end(); } catch {} }
    } catch (e) {
      if (e?.code === 'MYSQL2_MISSING' || e?.message === 'mysql2_missing') return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' });
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });
}
