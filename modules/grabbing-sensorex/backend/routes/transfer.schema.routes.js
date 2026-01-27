// Schema and languages helpers
export function registerGrabbingSensorexTransferSchemaRoutes(app, ctx = {}, utils = {}) {
  // Prefer utils-provided helpers; fallback to ctx when utils are not wired by the loader
  const pool = (utils && utils.pool) ? utils.pool : (ctx && ctx.pool ? ctx.pool : null);
  const normDomain = (utils && typeof utils.normDomain === 'function')
    ? utils.normDomain
    : ((input) => {
        try {
          let raw = String(input || '').trim();
          if (!raw) return '';
          if (/^https?:\/\//i.test(raw)) { try { const u = new URL(raw); raw = (u.hostname || '').toLowerCase(); } catch (e) {} }
          return raw.toLowerCase().replace(/^www\./, '');
        } catch { return String(input||'').toLowerCase().replace(/^www\./,''); }
      });
  // Ownership: main transfer endpoints are defined in
  //  - transfer.routes.js           → /api/grabbing-sensorex/transfer/prestashop
  //  - transfer.products.routes.js  → /api/grabbing-sensorex/transfer/product
  //  - transfer.category.routes.js  → /api/grabbing-sensorex/transfer/category
  // Do not duplicate them here to avoid double registration in __routes.

  // Admin diagnostic: report service loader status with explicit file paths
  // Admin diag endpoint removed as unused
  // GET schema for selected tables
  app.get('/api/grabbing-sensorex/transfer/prestashop/schema', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const domain = normDomain(req.query?.domain);
      const explicitProfileId = req.query?.profile_id != null ? Number(req.query.profile_id) : null;
      const prefix = String(req.query?.prefix || 'ps_');
      const tablesParam = String(req.query?.tables || '').trim();
      const tableNames = tablesParam ? tablesParam.split(',').map(s=>String(s).trim()).filter(Boolean) : [];
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      // Resolve profile id
      let profileId = explicitProfileId;
      if (!profileId) {
        try { const d = await pool.query(`select config_transfert from public.mod_grabbing_sensorex_domains where domain=$1`, [domain]); const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {}; if (ct && typeof ct==='object' && ct.db_mysql_profile_id) profileId = Number(ct.db_mysql_profile_id)||null; } catch (e) {}
      }
      if (!profileId) return res.status(400).json({ ok:false, error:'missing_profile' });
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];
      let mysql = null; try { const mod = await import('../../../db-mysql/backend/utils/mysql2.js'); mysql = await mod.getMysql2(ctx); } catch (e) { return res.status(500).json({ ok:false, error:'mysql2_missing' }); }
      const cfg = { host: String(prof.host||'localhost'), port: Number(prof.port||3306), user: String(prof.user||''), password: String(prof.password||''), database: String(prof.database||''), ssl: prof.ssl ? { rejectUnauthorized: false } : undefined };
      let conn;
      try {
        conn = await mysql.createConnection(cfg);
        const qi = (s)=>'`'+String(s||'').replace(/`/g,'``')+'`';
        const schema = {};
        const order = [];
        for (const t of tableNames) {
          const full = prefix + t;
          try { const [exists] = await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1', [cfg.database, full]); if (!Array.isArray(exists) || !exists.length) { schema[t] = { exists:false, columns: [] }; continue; } } catch { schema[t] = { exists:false, columns: [] }; continue; }
          let cols = [];
          try {
            const [rows] = await conn.query('SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type, COLUMN_TYPE as column_type, IS_NULLABLE as is_nullable, COLUMN_DEFAULT as column_default FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [cfg.database, full]);
            cols = Array.isArray(rows)? rows: [];
          } catch (e) {}
          schema[t] = { exists:true, columns: cols };
          order.push(t);
        }
        return res.json({ ok:true, schema, order, prefix });
      } catch (e) { return res.status(500).json({ ok:false, error:'schema_failed', message: e?.message || String(e) }); }
      finally { try { if (conn) await conn.end(); } catch (e) {} }
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // GET active languages
  app.get('/api/grabbing-sensorex/transfer/prestashop/langs', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const domain = normDomain(req.query?.domain);
      const explicitProfileId = req.query?.profile_id != null ? Number(req.query.profile_id) : null;
      const prefix = String(req.query?.prefix || 'ps_');
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });

      let profileId = explicitProfileId; if (!profileId) { try { const d = await pool.query(`select config_transfert from public.mod_grabbing_sensorex_domains where domain=$1`, [domain]); const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {}; if (ct && typeof ct==='object' && ct.db_mysql_profile_id) profileId = Number(ct.db_mysql_profile_id)||null; } catch (e) {} }
      if (!profileId) return res.status(400).json({ ok:false, error:'missing_profile' });
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];
      let mysql = null; try { const mod = await import('../../../db-mysql/backend/utils/mysql2.js'); mysql = await mod.getMysql2(ctx); } catch (e) { return res.status(500).json({ ok:false, error:'mysql2_missing' }); }
      const cfg = { host: String(prof.host||'localhost'), port: Number(prof.port||3306), user: String(prof.user||''), password: String(prof.password||''), database: String(prof.database||''), ssl: prof.ssl ? { rejectUnauthorized: false } : undefined };
      let conn;
      try {
        conn = await mysql.createConnection(cfg);
        const qi = (s)=>'`'+String(s||'').replace(/`/g,'``')+'`';
        const T_LANG = prefix + 'lang';
        const [exists] = await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1', [cfg.database, T_LANG]);
        if (!Array.isArray(exists) || !exists.length) return res.status(404).json({ ok:false, error:'table_missing', table: T_LANG });
        let cols = ['id_lang','active'];
        try { const [c] = await conn.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [cfg.database, T_LANG]); const names = new Set(Array.isArray(c) ? c.map(r=>String(r.COLUMN_NAME||'').toLowerCase()) : []); if (names.has('iso_code')) cols.push('iso_code'); if (names.has('name')) cols.push('name'); } catch (e) {}
        const sql = `SELECT ${cols.map(c=>qi(c)).join(', ')} FROM ${qi(T_LANG)} WHERE ${qi('active')}=1 ORDER BY ${qi('id_lang')} ASC`;
        const [rows] = await conn.query(sql);
        const items = Array.isArray(rows) ? rows : [];
        const ids = items.map(r=>Number(r.id_lang)||0).filter(n=>n>0);
        return res.json({ ok:true, items, ids, profile: { id: prof.id, host: prof.host, database: prof.database }, table: T_LANG });
      } catch (e) { return res.status(500).json({ ok:false, error:'langs_failed', message: e?.message || String(e) }); }
      finally { try { if (conn) await conn.end(); } catch (e) {} }
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // GET groups (ps_group) — used by mapping UI for *_group tables
  app.get('/api/grabbing-sensorex/transfer/prestashop/groups', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const domain = normDomain(req.query?.domain);
      const explicitProfileId = req.query?.profile_id != null ? Number(req.query.profile_id) : null;
      const prefix = String(req.query?.prefix || 'ps_');
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });

      let profileId = explicitProfileId; if (!profileId) { try { const d = await pool.query(`select config_transfert from public.mod_grabbing_sensorex_domains where domain=$1`, [domain]); const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {}; if (ct && typeof ct==='object' && ct.db_mysql_profile_id) profileId = Number(ct.db_mysql_profile_id)||null; } catch (e) {} }
      if (!profileId) return res.status(400).json({ ok:false, error:'missing_profile' });
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];
      let mysql = null; try { const mod = await import('../../../db-mysql/backend/utils/mysql2.js'); mysql = await mod.getMysql2(ctx); } catch (e) { return res.status(500).json({ ok:false, error:'mysql2_missing' }); }
      const cfg = { host: String(prof.host||'localhost'), port: Number(prof.port||3306), user: String(prof.user||''), password: String(prof.password||''), database: String(prof.database||''), ssl: prof.ssl ? { rejectUnauthorized: false } : undefined };
      let conn;
      try {
        conn = await mysql.createConnection(cfg);
        const qi = (s)=>'`'+String(s||'').replace(/`/g,'``')+'`';
        const T = prefix + 'group';
        const [exists] = await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1', [cfg.database, T]);
        if (!Array.isArray(exists) || !exists.length) return res.status(404).json({ ok:false, error:'table_missing', table: T });
        // Check for active column existence
        let hasActive = false;
        try { const [c] = await conn.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [cfg.database, T]); const names = new Set(Array.isArray(c) ? c.map(r=>String(r.COLUMN_NAME||'').toLowerCase()) : []); hasActive = names.has('active'); } catch {}
        const cols = ['id_group']; if (hasActive) cols.push('active');
        const sql = `SELECT ${cols.map(c=>qi(c)).join(', ')} FROM ${qi(T)} ${hasActive? 'WHERE '+qi('active')+'=1' : ''} ORDER BY ${qi('id_group')} ASC`;
        const [rows] = await conn.query(sql);
        const items = Array.isArray(rows) ? rows : [];
        const ids = items.map(r=>Number(r.id_group)||0).filter(n=>n>0);
        return res.json({ ok:true, items, ids, profile: { id: prof.id, host: prof.host, database: prof.database }, table: T });
      } catch (e) { return res.status(500).json({ ok:false, error:'groups_failed', message: e?.message || String(e) }); }
      finally { try { if (conn) await conn.end(); } catch (e) {} }
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}
