function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

export function registerGrabbingSensorexMysqlRoutes(app, _ctx = {}, utils = {}) {
  const { pool } = utils;
  if (!pool || typeof pool.query !== 'function') return;

  // Lightweight profile list for Mapping page (no secrets)
  // Returns: id, name, host, port, database, ssl, is_default
  app.get('/api/grabbing-sensorex/mysql/profiles', async (req, res) => {
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

  // POST /api/grabbing-sensorex/mysql/products/existence
  // Body: { profile_id:number, prefix?:string, ids:number[] }
  // Returns: { ok:true, exists:number[] }
  app.post('/api/grabbing-sensorex/mysql/products/existence', async (req, res) => {
    try {
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const profileId = Number(b.profile_id||0) || 0;
      const prefix = String(b.prefix||'ps_');
      const ids = Array.isArray(b.ids) ? b.ids.map(n=>Number(n)||0).filter(n=>n>0) : [];
      if (!profileId || ids.length === 0) return res.status(400).json({ ok:false, error:'bad_request', message:'profile_id and non-empty ids required' });

      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];

      const { connectMySql, makeSqlHelpers } = await import('../services/transfer/mysql.js');
      const conn = await connectMySql({}, {
        host: String(prof.host||'localhost'),
        port: Number(prof.port||3306),
        user: String(prof.user||''),
        password: String(prof.password||''),
        database: String(prof.database||''),
        ssl: prof.ssl ? { rejectUnauthorized: false } : undefined,
      });
      const { q, qi } = makeSqlHelpers(conn);
      const T_PRODUCT = prefix + 'product';
      const exists = new Set();
      // chunk IN clauses to avoid max placeholders
      const chunk = 500;
      for (let i=0;i<ids.length;i+=chunk) {
        const part = ids.slice(i, i+chunk);
        const placeholders = part.map(()=> '?').join(',');
        const rows = await q(`SELECT ${qi('id_product')} AS id_product FROM ${qi(T_PRODUCT)} WHERE ${qi('id_product')} IN (${placeholders})`, part);
        for (const r of (rows||[])) { const v = Number(r.id_product||0)||0; if (v) exists.add(v); }
      }
      try { await conn.end(); } catch {}
      return res.json({ ok:true, exists: Array.from(exists) });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'check_failed', message: e?.message || String(e) });
    }
  });

  // GET shops for a profile (ps_shop + ps_shop_url)
  // Query: profile_id, prefix (default ps_)
  app.get('/api/grabbing-sensorex/mysql/shops', async (req, res) => {
    try {
      const profileId = Number(req.query?.profile_id || 0) || 0;
      const prefix = String(req.query?.prefix || 'ps_');
      if (!profileId) return res.status(400).json({ ok:false, error:'bad_request', message:'profile_id required' });
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];
      const { connectMySql, makeSqlHelpers } = await import('../services/transfer/mysql.js');
      const conn = await connectMySql({}, {
        host: String(prof.host||'localhost'),
        port: Number(prof.port||3306),
        user: String(prof.user||''),
        password: String(prof.password||''),
        database: String(prof.database||''),
        ssl: prof.ssl ? { rejectUnauthorized: false } : undefined,
      });
      const { q, qi } = makeSqlHelpers(conn);
      const T_SHOP = prefix + 'shop';
      const T_SHOP_URL = prefix + 'shop_url';
      const rows = await q(
        `SELECT s.id_shop, s.name AS shop_name, su.domain, su.domain_ssl, su.physical_uri, su.virtual_uri, su.main
           FROM ${qi(T_SHOP)} s
           LEFT JOIN ${qi(T_SHOP_URL)} su ON su.id_shop = s.id_shop AND su.main = 1
          ORDER BY s.id_shop ASC`
      );
      const items = (rows||[]).map(r => {
        const domain = String(r.domain_ssl || r.domain || '').trim();
        const scheme = r.domain_ssl ? 'https://' : (r.domain ? 'http://' : '');
        const base = domain ? (scheme + domain + String(r.physical_uri || '/') + String(r.virtual_uri || '')) : '';
        return { id_shop: Number(r.id_shop)||0, domain: r.domain, domain_ssl: r.domain_ssl, base_url: base, name: r.shop_name || null };
      });
      try { await conn.end(); } catch {}
      return res.json({ ok:true, items });
    } catch (e) { return res.status(500).json({ ok:false, error:'shops_failed', message: e?.message || String(e) }); }
  });

  // GET languages for a profile (ps_lang active=1)
  app.get('/api/grabbing-sensorex/mysql/langs', async (req, res) => {
    try {
      const profileId = Number(req.query?.profile_id || 0) || 0;
      const prefix = String(req.query?.prefix || 'ps_');
      if (!profileId) return res.status(400).json({ ok:false, error:'bad_request', message:'profile_id required' });
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];
      const { connectMySql, makeSqlHelpers } = await import('../services/transfer/mysql.js');
      const conn = await connectMySql({}, {
        host: String(prof.host||'localhost'),
        port: Number(prof.port||3306),
        user: String(prof.user||''),
        password: String(prof.password||''),
        database: String(prof.database||''),
        ssl: prof.ssl ? { rejectUnauthorized: false } : undefined,
      });
      const { q, qi } = makeSqlHelpers(conn);
      const T_LANG = prefix + 'lang';
      const rows = await q(`SELECT ${qi('id_lang')} AS id_lang, ${qi('iso_code')} AS iso_code, ${qi('name')} AS name, ${qi('active')} AS active FROM ${qi(T_LANG)} ORDER BY ${qi('id_lang')} ASC`);
      const items = (rows||[]).filter(r => (r.active == null || Number(r.active) === 1));
      try { await conn.end(); } catch {}
      return res.json({ ok:true, items });
    } catch (e) { return res.status(500).json({ ok:false, error:'langs_failed', message: e?.message || String(e) }); }
  });

  // GET pages (product/category) with links
  // Query: profile_id, type=product|category, id_shop, id_lang, limit=3000, prefix=ps_, active_only=1 (products only)
  app.get('/api/grabbing-sensorex/mysql/pages', async (req, res) => {
    try {
      const profileId = Number(req.query?.profile_id || 0) || 0;
      const type = String(req.query?.type || 'product').toLowerCase();
      const idShop = Number(req.query?.id_shop || 0) || 0;
      const idLang = Number(req.query?.id_lang || 0) || 0;
      const limit = Math.max(1, Math.min(3000, Number(req.query?.limit || 3000)));
      const prefix = String(req.query?.prefix || 'ps_');
      const activeOnly = (() => { const v = String(req.query?.active_only ?? req.query?.active ?? '').toLowerCase(); return v==='1' || v==='true'; })();
      if (!profileId || !idShop || !idLang) return res.status(400).json({ ok:false, error:'bad_request', message:'profile_id, id_shop and id_lang required' });
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];
      const { connectMySql, makeSqlHelpers } = await import('../services/transfer/mysql.js');
      const conn = await connectMySql({}, {
        host: String(prof.host||'localhost'),
        port: Number(prof.port||3306),
        user: String(prof.user||''),
        password: String(prof.password||''),
        database: String(prof.database||''),
        ssl: prof.ssl ? { rejectUnauthorized: false } : undefined,
      });
      const { q, qi } = makeSqlHelpers(conn);
      const T_SHOP_URL = prefix + 'shop_url';
      const [su] = await conn.query(`SELECT domain, domain_ssl, physical_uri, virtual_uri FROM ${qi(T_SHOP_URL)} WHERE id_shop=? AND main=1 LIMIT 1`, [idShop]);
      const suRow = Array.isArray(su) && su[0] ? su[0] : {};
      const domain = String(suRow.domain_ssl || suRow.domain || '').trim();
      const scheme = suRow.domain_ssl ? 'https://' : (suRow.domain ? 'http://' : '');
      const base = domain ? (scheme + domain + String(suRow.physical_uri || '/') + String(suRow.virtual_uri || '')) : '';
      const normalizeBase = (b) => {
        const s = String(b || '');
        return s.endsWith('/') ? s : (s + '/');
      };
      const baseNorm = normalizeBase(base);
      // Resolve ISO code for the requested language to build /{iso}/ paths when needed
      let iso = '';
      try {
        const T_LANG = prefix + 'lang';
        const [lr] = await conn.query(`SELECT ${qi('iso_code')} AS iso_code FROM ${qi(T_LANG)} WHERE ${qi('id_lang')}=? LIMIT 1`, [idLang]);
        if (Array.isArray(lr) && lr.length && lr[0].iso_code) iso = String(lr[0].iso_code).trim().toLowerCase();
      } catch {}
      const baseWithLang = (() => {
        if (!baseNorm || !iso) return baseNorm;
        try {
          // If base already ends with /{iso}/, avoid duplicating the segment
          const parts = baseNorm.split('/').filter(Boolean);
          const last = parts[parts.length - 1] || '';
          if (last.toLowerCase() === iso.toLowerCase()) return baseNorm;
        } catch {}
        return baseNorm + iso + '/';
      })();

      let items = [];
      if (type === 'category') {
        const T_C = prefix + 'category';
        const T_CL = prefix + 'category_lang';
        const T_CS = prefix + 'category_shop';
        const sql = `SELECT c.${qi('id_category')} AS id_category, cl.${qi('name')} AS name, cl.${qi('link_rewrite')} AS link_rewrite
                       FROM ${qi(T_C)} c
                       JOIN ${qi(T_CS)} cs ON cs.${qi('id_category')}=c.${qi('id_category')} AND cs.${qi('id_shop')}=?
                       JOIN ${qi(T_CL)} cl ON cl.${qi('id_category')}=c.${qi('id_category')} AND cl.${qi('id_shop')}=? AND cl.${qi('id_lang')}=?
                      ORDER BY c.${qi('id_category')} ASC
                      LIMIT ?`;
        const rows = await q(sql, [idShop, idShop, idLang, limit]);
        items = (rows||[]).map(r => {
          const idc = Number(r.id_category)||0;
          const lr = String(r.link_rewrite || '').trim();
          const friendly = (lr && baseWithLang) ? `${baseWithLang}${idc}-${lr}` : (base ? `${base}index.php?controller=category&id_category=${idc}&id_lang=${idLang}` : `index.php?controller=category&id_category=${idc}&id_lang=${idLang}`);
          return { id_category: idc, name: r.name || '', reference: null, link: friendly };
        });
      } else {
        const T_P = prefix + 'product';
        const T_PS = prefix + 'product_shop';
        const T_PL = prefix + 'product_lang';
        const T_CL = prefix + 'category_lang';
        // Detect if category_lang has id_shop column (varies by Presta version)
        let catJoin = '';
        let selectCat = 'NULL AS category_name';
        const params = [idShop, idShop, idLang];
        try {
          const { hasTable, hasColumn } = makeSqlHelpers(conn);
          const exists = await hasTable(T_CL, String(prof.database||''));
          if (exists) {
            const hasIdShop = await hasColumn(T_CL, 'id_shop', String(prof.database||''));
            selectCat = `cl.${qi('name')} AS category_name`;
            catJoin = ` LEFT JOIN ${qi(T_CL)} cl ON cl.${qi('id_category')}=p.${qi('id_category_default')} AND cl.${qi('id_lang')}=?` + (hasIdShop ? ` AND cl.${qi('id_shop')}=?` : '');
            params.push(idLang);
            if (hasIdShop) params.push(idShop);
          }
        } catch {}

        // Active filter (prefer product_shop.active when available; fallback to product.active)
        let psHasActive = false;
        let pHasActive = false;
        let joinActive = '';
        let whereActive = '';
        let selectActive = 'NULL AS active';
        if (activeOnly) {
          try {
            const { hasColumn } = makeSqlHelpers(conn);
            psHasActive = await hasColumn(T_PS, 'active', String(prof.database||''));
            if (psHasActive) {
              joinActive = ` AND ps.${qi('active')}=1`;
              selectActive = `ps.${qi('active')} AS active`;
            } else {
              pHasActive = await hasColumn(T_P, 'active', String(prof.database||''));
              if (pHasActive) {
                whereActive = ` WHERE p.${qi('active')}=1`;
                selectActive = `p.${qi('active')} AS active`;
              }
            }
          } catch {}
        } else {
          // Not filtering by active but still try to expose the flag if present
          try {
            const { hasColumn } = makeSqlHelpers(conn);
            psHasActive = await hasColumn(T_PS, 'active', String(prof.database||''));
            if (psHasActive) selectActive = `ps.${qi('active')} AS active`;
            else if (await hasColumn(T_P, 'active', String(prof.database||''))) selectActive = `p.${qi('active')} AS active`;
          } catch {}
        }

        const sql = `SELECT p.${qi('id_product')} AS id_product, p.${qi('reference')} AS reference, pl.${qi('name')} AS name, pl.${qi('link_rewrite')} AS link_rewrite, ${selectActive}, ${selectCat}
                       FROM ${qi(T_P)} p
                       JOIN ${qi(T_PS)} ps ON ps.${qi('id_product')}=p.${qi('id_product')} AND ps.${qi('id_shop')}=?${joinActive}
                       JOIN ${qi(T_PL)} pl ON pl.${qi('id_product')}=p.${qi('id_product')} AND pl.${qi('id_shop')}=? AND pl.${qi('id_lang')}=?${catJoin}${whereActive}
                      ORDER BY p.${qi('id_product')} ASC
                      LIMIT ?`;
        params.push(limit);
        const rows = await q(sql, params);
        items = (rows||[]).map(r => {
          const idp = Number(r.id_product)||0;
          const lr = String(r.link_rewrite || '').trim();
          const friendly = (lr && baseWithLang) ? `${baseWithLang}${idp}-${lr}.html` : (base ? `${base}index.php?controller=product&id_product=${idp}&id_lang=${idLang}` : `index.php?controller=product&id_product=${idp}&id_lang=${idLang}`);
          return { id_product: idp, name: r.name || '', reference: r.reference || null, category: r.category_name || null, link: friendly, active: (r.active == null ? null : Number(r.active) || 0) };
        });
      }
      try { await conn.end(); } catch {}
      return res.json({ ok:true, base_url: base || null, items, type });
    } catch (e) { return res.status(500).json({ ok:false, error:'pages_failed', message: e?.message || String(e) }); }
  });
}
