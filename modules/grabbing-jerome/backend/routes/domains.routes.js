import { createHash } from 'crypto';

export function registerGrabbingJeromeDomainsRoutes(app, _ctx, utils = {}) {
  // Fallback to ctx when utils are not provided by the loader
  const pool = utils?.pool || _ctx?.pool;
  const chatLog = utils?.chatLog || ((event, payload = {}) => { try { _ctx?.logToFile?.(`[grabbing-jerome] ${event} ${JSON.stringify(payload)}`); } catch {} });
  const normDomain = utils?.normDomain || ((input) => {
    try {
      let raw = String(input || '').trim();
      if (!raw) return '';
      if (/^https?:\/\//i.test(raw)) { try { const u = new URL(raw); raw = (u.hostname || '').toLowerCase(); } catch {} }
      return raw.toLowerCase().replace(/^www\./, '');
    } catch { return String(input||'').toLowerCase().replace(/^www\./,''); }
  });
  if (!pool || typeof pool.query !== 'function') return;

  const ensureDomainsTable = utils?.ensureDomainsTable || (async () => {});
  const ensureDomainTypeConfigTable = utils?.ensureDomainTypeConfigTable || (async () => {});
  const ensureDomainTypeConfigHistoryTable = utils?.ensureDomainTypeConfigHistoryTable || (async () => {});
  const ensureMappingToolsTable = utils?.ensureMappingToolsTable || (async () => {});

  // Domains list (read-only; avoid DDL ensure to prevent lock contention)
  app.get('/api/grabbing-jerome/domains', async (req, res) => {
    try {
      try { chatLog?.('route_hit', { method: req.method, url: req.originalUrl || req.url }); } catch {}
      // Do not call ensureDomainsTable() here; on large instances concurrent DDL can block.
      const q = String(req.query?.q || '').trim().toLowerCase();
      const limit = Math.min(1000, Math.max(1, Number(req.query?.limit || 200)));
      const filters = [];
      const params = [];
      let idx = 1;
      if (q) {
        filters.push(`(lower(domain) like $${idx} or lower(coalesce(sitemap_url,'')) like $${idx})`);
        params.push(`%${q}%`);
        idx++;
      }
      const t0 = Date.now();
      const sql = `select domain, sitemap_url, sitemaps, selected_sitemaps, sitemap_total_urls, config, config_transfert, created_at, updated_at
                     from mod_grabbing_jerome_domains
                    ${filters.length ? `where ${filters.join(' and ')}` : ''}
                    order by updated_at desc nulls last, domain asc
                    limit $${idx}`;
      params.push(limit);
      const st = Math.max(100, Number(process.env.GJ_DOMAINS_TIMEOUT_MS || 5000));
      const client = typeof pool.connect === 'function' ? await pool.connect() : null;
      if (client) {
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch {}
          const { rows } = await client.query(sql, params);
          await client.query('COMMIT');
          const dt = Date.now() - t0;
          try { chatLog?.('domains_list', { count: (rows||[]).length, ms: dt }); } catch {}
          try { res.setHeader('X-Query-Time', String(dt)); } catch {}
          return res.json({ ok:true, items: rows });
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch {}
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) {
            try { chatLog?.('domains_list_timeout', { ms: Date.now() - t0, limit, q }); } catch {}
            return res.status(503).json({ ok:false, error:'db_timeout' });
          }
          throw e;
        } finally {
          try { client.release(); } catch {}
        }
      } else {
        // Fallback: no connect() available; perform best-effort with global timeout
        try { await pool.query('SET statement_timeout = ' + st); } catch {}
        try {
          const { rows } = await pool.query(sql, params);
          const dt = Date.now() - t0;
          try { chatLog?.('domains_list', { count: (rows||[]).length, ms: dt }); } catch {}
          try { res.setHeader('X-Query-Time', String(dt)); } catch {}
          return res.json({ ok:true, items: rows });
        } catch (e) {
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) {
            try { chatLog?.('domains_list_timeout', { ms: Date.now() - t0, limit, q }); } catch {}
            return res.status(503).json({ ok:false, error:'db_timeout' });
          }
          throw e;
        } finally {
          try { await pool.query('SET statement_timeout = DEFAULT'); } catch {}
        }
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Legacy alias for domains list
  app.get('/api/grabbings/jerome/domains', async (req, res) => {
    try {
      // Avoid ensure here as well
      const q = String(req.query?.q || '').trim().toLowerCase();
      const limit = Math.min(1000, Math.max(1, Number(req.query?.limit || 200)));
      const filters = [];
      const params = [];
      let idx = 1;
      if (q) {
        filters.push(`(lower(domain) like $${idx} or lower(coalesce(sitemap_url,'')) like $${idx})`);
        params.push(`%${q}%`);
        idx++;
      }
      const sql = `select domain, sitemap_url, sitemaps, selected_sitemaps, sitemap_total_urls, config, config_transfert, created_at, updated_at
                     from mod_grabbing_jerome_domains
                    ${filters.length ? `where ${filters.join(' and ')}` : ''}
                    order by updated_at desc nulls last, domain asc
                    limit $${idx}`;
      params.push(limit);
      const st = Math.max(100, Number(process.env.GJ_DOMAINS_TIMEOUT_MS || 5000));
      const client = typeof pool.connect === 'function' ? await pool.connect() : null;
      if (client) {
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch {}
          const { rows } = await client.query(sql, params);
          await client.query('COMMIT');
          return res.json({ ok:true, items: rows });
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch {}
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) return res.status(503).json({ ok:false, error:'db_timeout' });
          throw e;
        } finally {
          try { client.release(); } catch {}
        }
      } else {
        try { await pool.query('SET statement_timeout = ' + st); } catch {}
        try {
          const { rows } = await pool.query(sql, params);
          return res.json({ ok:true, items: rows });
        } catch (e) {
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) return res.status(503).json({ ok:false, error:'db_timeout' });
          throw e;
        } finally {
          try { await pool.query('SET statement_timeout = DEFAULT'); } catch {}
        }
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Get domain transfer config (optionally pick mapping by page_type)
  app.get('/api/grabbing-jerome/domains/:domain/transfert', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureDomainsTable();
      await ensureDomainTypeConfigTable();
      await ensureMappingToolsTable();
      const domain = normDomain(req.params?.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      // Helper to normalize mapping: promote defaults into fields and drop top-level defaults
      const normalizeMapping = (m) => {
        try {
          if (!m || typeof m !== 'object') return m;
          const out = JSON.parse(JSON.stringify(m||{}));
          const tables = (out.tables && typeof out.tables==='object') ? out.tables : {};
          const defsAll = (out.defaults && typeof out.defaults==='object') ? out.defaults : {};
          let changed = false;
          for (const [tName, defs] of Object.entries(defsAll)) {
            try {
              const entry = (tables[tName] && typeof tables[tName]==='object') ? tables[tName] : {};
              const fields = (entry.fields && typeof entry.fields==='object') ? entry.fields : {};
              for (const [col, defVal] of Object.entries(defs||{})) {
                const s = String(defVal);
                fields[col] = (s === '') ? '' : ('='+s);
                changed = true;
              }
              entry.fields = fields;
              tables[tName] = entry;
            } catch {}
          }
          if (changed) { out.tables = tables; out.defaults = {}; }
          return out;
        } catch { return m; }
      };
      // Prefer new mapping tools table (latest version) for mapping payload
      if (pageType) {
        try {
          const rmt = await pool.query(
            `select version, config, created_at, updated_at from public.mod_grabbing_jerome_maping_tools where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc, updated_at desc limit 1`,
            [domain, pageType]
          );
          if (rmt.rowCount) {
            const row = rmt.rows[0] || {};
            let mv_hash = null;
            try { mv_hash = createHash('sha256').update(JSON.stringify(row?.config || {})).digest('hex').slice(0,8); } catch {}
            const d = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
            const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
            const norm = normalizeMapping(row.config || {});
            return res.json({ ok:true,
              config_transfert: ct,
              mapping: norm || null,
              unified: { config: norm || null, tables: null, version: row.version || 1, updated_at: row.updated_at || null },
              mapping_version: Number(row.version || 1),
              mapping_version_hash: mv_hash,
              mapping_updated_at: row.updated_at || null
            });
          }
        } catch {}
        // Fallback to legacy unified table when mapping tools has no rows
        try {
          const rt = await pool.query(`select config, tables, version, updated_at from public.mod_grabbing_jerome_domain_type_config where domain=$1 and lower(page_type)=lower($2)`, [domain, pageType]);
          if (rt.rowCount) {
            const row = rt.rows[0] || {};
            let mv_hash = null;
            try { mv_hash = createHash('sha256').update(JSON.stringify(row?.config || {})).digest('hex').slice(0,8); } catch {}
            const d = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
            const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
            const norm = normalizeMapping(row.config || {});
            return res.json({ ok:true,
              config_transfert: ct,
              mapping: norm || null,
              unified: { config: norm || null, tables: row.tables || null, version: row.version || 1, updated_at: row.updated_at || null },
              mapping_version: Number(row.version || 1),
              mapping_version_hash: mv_hash,
              mapping_updated_at: row.updated_at || null
            });
          }
        } catch {}
      }
      const r = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const ct = r.rows[0]?.config_transfert || {};
      let mapping = null;
      if (pageType && ct && typeof ct === 'object' && ct.mappings && typeof ct.mappings === 'object') mapping = ct.mappings[pageType] || null;
      if (!mapping && ct && typeof ct === 'object' && ct.mapping) mapping = ct.mapping;
      return res.json({ ok:true, config_transfert: ct, mapping });
    } catch (e) { return res.status(500).json({ ok:false, error:'get_failed', message: e?.message || String(e) }); }
  });

  // Update domain transfer config (store PrestaShop DB-MySQL profile, notes, etc.)
  app.post('/api/grabbing-jerome/domains/:domain/transfert', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureDomainsTable();
      await ensureMappingToolsTable();
      const domain = normDomain(req.params?.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const patch = {};
      if (body.db_mysql_profile_id !== undefined) patch.db_mysql_profile_id = body.db_mysql_profile_id == null ? null : Number(body.db_mysql_profile_id) || null;
      if (body.db_mysql_prefix !== undefined) {
        const px = String(body.db_mysql_prefix || '').trim();
        patch.db_mysql_prefix = px || null;
      }
      if (body.notes !== undefined) patch.notes = String(body.notes || '');
      // Manage mapping fully in mapping tools table
      try {
        if (body.mapping && typeof body.mapping === 'object') {
          const pageType = String(body.page_type || '').trim().toLowerCase();
          if (pageType) {
            // Auto-propagate per-table settings on Save Mapping
            try {
              const d = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
              const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
              const prId = (ct && ct.db_mysql_profile_id) ? Number(ct.db_mysql_profile_id)||null : null;
              const prefix = String((body.mapping.prefix || ct.db_mysql_prefix || ct.db_prefix || 'ps_'));
              // Top shops from product_shop.settings
              const topShops = (body.mapping?.tables?.product_shop?.settings?.id_shops||[]).filter(n=>Number(n)>0);
              // Active ps_lang
              let activeLangIds = [];
              if (prId) {
                try {
                  const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [prId]);
                  if (pr.rowCount) {
                    const prof = pr.rows[0];
                    const mod = await import('../../../db-mysql/backend/utils/mysql2.js');
                    const mysql = await mod.getMysql2(_ctx || {});
                    const cfg = { host: String(prof.host||'localhost'), port: Number(prof.port||3306), user: String(prof.user||''), password: String(prof.password||''), database: String(prof.database||''), ssl: prof.ssl ? { rejectUnauthorized:false } : undefined };
                    const qi = (ident) => '`' + String(ident||'').replace(/`/g,'``') + '`';
                    let conn;
                    try {
                      conn = await mysql.createConnection(cfg);
                      const T_LANG = prefix + 'lang';
                      const [exists] = await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1', [cfg.database, T_LANG]);
                      if (Array.isArray(exists) && exists.length) {
                        const [rows] = await conn.query(`SELECT ${qi('id_lang')} as id_lang FROM ${qi(T_LANG)} WHERE ${qi('active')}=1 ORDER BY ${qi('id_lang')} ASC`);
                        activeLangIds = Array.isArray(rows) ? rows.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : [];
                      }
                    } finally { try { if (conn) await conn.end(); } catch {} }
                  }
                } catch {}
              }
              if (!activeLangIds.length) activeLangIds = [ Number(body.mapping.id_lang||1) || 1 ];
              // For each declared table, detect id_shop/id_lang columns (via information_schema when possible) and set settings when missing
              const tables = (body.mapping.tables && typeof body.mapping.tables==='object') ? Object.keys(body.mapping.tables) : [];
              if (!body.mapping.tables) body.mapping.tables = {};
              for (const name of tables) {
                try {
                  const key = String(name);
                  const entry = body.mapping.tables[key] = (body.mapping.tables[key] && typeof body.mapping.tables[key]==='object') ? body.mapping.tables[key] : {};
                  entry.settings = entry.settings && typeof entry.settings==='object' ? entry.settings : {};
                  let hasShop = false, hasLang = false;
                  if (prId) {
                    try {
                      const pr = await pool.query(`SELECT host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [prId]);
                      if (pr.rowCount) {
                        const prof = pr.rows[0];
                        const mod = await import('../../../db-mysql/backend/utils/mysql2.js');
                        const mysql = await mod.getMysql2(_ctx || {});
                        const cfg = { host: String(prof.host||'localhost'), port: Number(prof.port||3306), user: String(prof.user||''), password: String(prof.password||''), database: String(prof.database||''), ssl: prof.ssl ? { rejectUnauthorized:false } : undefined };
                        const T = prefix + key;
                        let conn;
                        try {
                          conn = await mysql.createConnection(cfg);
                          const [cols] = await conn.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [cfg.database, T]);
                          const names = new Set(Array.isArray(cols) ? cols.map(r=>String(r.COLUMN_NAME||'').toLowerCase()) : []);
                          hasShop = names.has('id_shop');
                          hasLang = names.has('id_lang');
                        } finally { try { if (conn) await conn.end(); } catch {} }
                      }
                    } catch {}
                  } else {
                    if (/_shop$/i.test(key)) hasShop = true;
                    if (/_lang$/i.test(key)) hasLang = true;
                  }
                  if (hasShop && (!Array.isArray(entry.settings.id_shops) || entry.settings.id_shops.length===0) && topShops.length) entry.settings.id_shops = topShops.slice();
                  if (hasLang && (!Array.isArray(entry.settings.id_langs) || entry.settings.id_langs.length===0) && activeLangIds.length) entry.settings.id_langs = activeLangIds.slice();
                } catch {}
              }
            } catch {}
            const versionBump = !!body.version_bump;
            const name = String(body.name || '').trim() || null;
            // Read latest version
            const latest = await pool.query(
              `select version from public.mod_grabbing_jerome_maping_tools where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc limit 1`,
              [domain, pageType]
            );
            let nextVer = (latest.rowCount ? Number(latest.rows[0].version||0) : 0) + 1;
            if (latest.rowCount && !versionBump) {
              // Update latest version in place
              const curVer = Number(latest.rows[0].version||1) || 1;
              await pool.query(
                `update public.mod_grabbing_jerome_maping_tools set name=$1, config=$2::jsonb, enabled=$3, updated_at=now() where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($4),'^www\\.','') and lower(page_type)=lower($5) and version=$6`,
                [name, JSON.stringify(body.mapping||{}), true, domain, pageType, curVer]
              );
            } else {
              // Insert new version
              await pool.query(
                `insert into public.mod_grabbing_jerome_maping_tools (domain,page_type,version,name,config,enabled,updated_at)
                 values ($1,$2,$3,$4,$5::jsonb,$6, now())`,
                [domain, pageType, latest.rowCount ? nextVer : 1, name, JSON.stringify(body.mapping||{}), true]
              );
            }

            // Also merge mapping tables/defaults into unified Smart Settings row (domain_type_config)
            try {
              await ensureDomainTypeConfigTable();
              const cur = await pool.query(`select tables from public.mod_grabbing_jerome_domain_type_config where domain=$1 and lower(page_type)=lower($2)`, [domain, pageType]);
              let base = (cur.rowCount && cur.rows[0]?.tables) ? (cur.rows[0].tables||{}) : {};
              if (!base || typeof base !== 'object') base = {};
              const mt = (body.mapping && body.mapping.tables && typeof body.mapping.tables==='object') ? body.mapping.tables : {};
              const md = (body.mapping && body.mapping.defaults && typeof body.mapping.defaults==='object') ? body.mapping.defaults : {};
              for (const [tbl, conf] of Object.entries(mt)) {
                const entry = (base[tbl] && typeof base[tbl]==='object') ? base[tbl] : {};
                const mapping = (entry.mapping && typeof entry.mapping==='object') ? entry.mapping : {};
                if (conf && typeof conf==='object') {
                  if (conf.fields && typeof conf.fields==='object') mapping.fields = conf.fields;
                  // table-scoped defaults from mapping.defaults[tbl] or conf.defaults
                  const dflt = (md && md[tbl] && typeof md[tbl]==='object') ? md[tbl] : (conf.defaults && typeof conf.defaults==='object' ? conf.defaults : {});
                  if (dflt && Object.keys(dflt).length) mapping.defaults = dflt;
                  // settings and setting_image if present in mapping JSON
                  if (conf.settings && typeof conf.settings==='object') entry.settings = { ...(entry.settings||{}), ...conf.settings };
                  if (conf.setting_image && typeof conf.setting_image==='object') entry.setting_image = { ...(entry.setting_image||{}), ...conf.setting_image };
                }
                entry.mapping = mapping;
                base[tbl] = entry;
              }
              await pool.query(
                `INSERT INTO public.mod_grabbing_jerome_domain_type_config(domain,page_type,config,tables,version,created_at,updated_at)
                 VALUES ($1,$2,$3::jsonb,$4::jsonb, 1, now(), now())
                 ON CONFLICT (domain,page_type)
                 DO UPDATE SET tables=EXCLUDED.tables,
                               config = EXCLUDED.config,
                               updated_at=now()`,
                [domain, pageType, JSON.stringify(body.mapping||{}), JSON.stringify(base)]
              );
            } catch {}
          }
        }
      } catch {}
      chatLog('transfert_save_request', { domain, has_mapping: !!body.mapping, page_type: String(body.page_type||'') || null, has_profile: body.db_mysql_profile_id != null });
      const r = await pool.query(
        `UPDATE public.mod_grabbing_jerome_domains
            SET config_transfert = coalesce(config_transfert, '{}'::jsonb) || $2::jsonb,
                updated_at = now()
          WHERE domain = $1
          RETURNING domain, sitemap_url, sitemaps, selected_sitemaps, sitemap_total_urls, config, config_transfert, created_at, updated_at`,
        [domain, JSON.stringify(patch)]
      );
      chatLog('transfert_save_ok', { domain });
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'update_failed', message: e?.message || String(e) }); }
  });

  // List mapping versions for a domain+page_type
  app.get('/api/grabbing-jerome/transfert/versions', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureDomainTypeConfigHistoryTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const limit = Math.min(1000, Math.max(1, Number(req.query?.limit || 50)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      // Prefer new mapping tools table when populated
      try {
        await ensureMappingToolsTable();
        const r2 = await pool.query(
          `select version, page_type, domain, name, created_at
             from public.mod_grabbing_jerome_maping_tools
            where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','')
              and lower(page_type)=lower($2)
            order by version desc, updated_at desc
            limit $3 offset $4`,
          [domain, pageType, limit, offset]
        );
        if (r2.rowCount) return res.json({ ok:true, items: r2.rows || [] });
      } catch {}
      const r = await pool.query(
        `select version, page_type, domain, created_at
           from public.mod_grabbing_jerome_domain_type_config_hist
          where domain=$1 and lower(page_type)=lower($2)
          order by version desc
          limit $3 offset $4`,
        [domain, pageType, limit, offset]
      );
      return res.json({ ok:true, items: r.rows||[] });
    } catch (e) { return res.status(500).json({ ok:false, error:'versions_list_failed', message: e?.message || String(e) }); }
  });

  // Get mapping version payload
  app.get('/api/grabbing-jerome/transfert/version/get', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureDomainTypeConfigHistoryTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const version = Number(req.query?.version || 0);
      if (!domain || !pageType || !version) return res.status(400).json({ ok:false, error:'bad_request' });
      // Prefer mapping tools table
      try {
        await ensureMappingToolsTable();
        const r2 = await pool.query(
          `select version, config, created_at from public.mod_grabbing_jerome_maping_tools where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3 limit 1`,
          [domain, pageType, version]
        );
        if (r2.rowCount) return res.json({ ok:true, item: { version: r2.rows[0].version, config: r2.rows[0].config, created_at: r2.rows[0].created_at } });
      } catch {}
      const r = await pool.query(
        `select version, config, tables, created_at from public.mod_grabbing_jerome_domain_type_config_hist where domain=$1 and lower(page_type)=lower($2) and version=$3 limit 1`,
        [domain, pageType, version]
      );
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'version_get_failed', message: e?.message || String(e) }); }
  });

  // Restore a mapping version (copy into current, bump version and snapshot)
  app.post('/api/grabbing-jerome/transfert/version/restore', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureDomainTypeConfigTable();
      await ensureDomainTypeConfigHistoryTable();
      const domain = normDomain(req.body?.domain);
      const pageType = String(req.body?.page_type || '').trim().toLowerCase();
      const version = Number(req.body?.version || 0);
      if (!domain || !pageType || !version) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(`select config, tables from public.mod_grabbing_jerome_domain_type_config_hist where domain=$1 and lower(page_type)=lower($2) and version=$3`, [domain, pageType, version]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = r.rows[0] || {};
      await pool.query(
        `INSERT INTO public.mod_grabbing_jerome_domain_type_config(domain,page_type,config,tables,version,created_at,updated_at)
         VALUES($1,$2,$3::jsonb,$4::jsonb,1, now(), now())
         ON CONFLICT (domain,page_type)
         DO UPDATE SET config=EXCLUDED.config, tables=EXCLUDED.tables, version=COALESCE(public.mod_grabbing_jerome_domain_type_config.version,1)+1, updated_at=now()`,
        [domain, pageType, JSON.stringify(row.config||{}), JSON.stringify(row.tables||{})]
      );
      const cur = await pool.query(`select version, config, tables from public.mod_grabbing_jerome_domain_type_config where domain=$1 and lower(page_type)=lower($2)`, [domain, pageType]);
      if (cur.rowCount) {
        const nowv = Number(cur.rows[0]?.version||1);
        try { await pool.query(`insert into public.mod_grabbing_jerome_domain_type_config_hist(domain,page_type,version,config,tables,created_at) values ($1,$2,$3,$4::jsonb,$5::jsonb, now())`, [domain, pageType, nowv, JSON.stringify(cur.rows[0]?.config||{}), JSON.stringify(cur.rows[0]?.tables||{})]); } catch {}
        // Mirror into mapping tools
        try {
          await ensureMappingToolsTable();
          await pool.query(
            `insert into public.mod_grabbing_jerome_maping_tools (domain,page_type,version,name,config,enabled,updated_at)
             values ($1,$2,$3,$4,$5::jsonb,$6, now())
             on conflict (domain,page_type,version,org_id) do update set name=EXCLUDED.name, config=EXCLUDED.config, enabled=EXCLUDED.enabled, updated_at=now()`,
            [domain, pageType, nowv, null, JSON.stringify(cur.rows[0]?.config||{}), true]
          );
        } catch {}
        return res.json({ ok:true, restored_to: nowv });
      }
      return res.json({ ok:true, restored_to: null });
    } catch (e) { return res.status(500).json({ ok:false, error:'restore_failed', message: e?.message || String(e) }); }
  });

  // Snapshot current mapping/settings to a new version (no content change; bump version + history insert)
  app.post('/api/grabbing-jerome/transfert/version/snapshot', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureDomainTypeConfigTable();
      await ensureDomainTypeConfigHistoryTable();
      await ensureMappingToolsTable();
      const domain = normDomain(req.body?.domain);
      const pageType = String(req.body?.page_type || '').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      // Prefer snapshotting mapping tools; if legacy current exists, also bump/snapshot it to keep parity
      const latest = await pool.query(
        `select version, config from public.mod_grabbing_jerome_maping_tools where domain=$1 and lower(page_type)=lower($2) order by version desc limit 1`,
        [domain, pageType]
      );
      if (latest.rowCount) {
        const curVer = Number(latest.rows[0].version||0) || 0;
        const nextVer = curVer + 1;
        const cfg = latest.rows[0].config || {};
        await pool.query(
          `insert into public.mod_grabbing_jerome_maping_tools (domain,page_type,version,name,config,enabled,updated_at)
           values ($1,$2,$3,$4,$5::jsonb,$6, now())`,
          [domain, pageType, nextVer, 'snapshot', JSON.stringify(cfg||{}), true]
        );
        // Best-effort reflect in legacy hist if current exists
        try {
          const cur0 = await pool.query(`select version, config, tables from public.mod_grabbing_jerome_domain_type_config where domain=$1 and lower(page_type)=lower($2)`, [domain, pageType]);
          if (cur0.rowCount) {
            const up = await pool.query(
              `update public.mod_grabbing_jerome_domain_type_config
                  set version = coalesce(version,1)+1, updated_at=now()
                where domain=$1 and lower(page_type)=lower($2)
                returning version, config, tables`,
              [domain, pageType]
            );
            const row = up.rows?.[0] || {};
            try { await pool.query(`insert into public.mod_grabbing_jerome_domain_type_config_hist(domain,page_type,version,config,tables,created_at) values ($1,$2,$3,$4::jsonb,$5::jsonb, now())`, [domain, pageType, Number(row.version||1), JSON.stringify(row.config||{}), JSON.stringify(row.tables||{})]); } catch {}
          }
        } catch {}
        return res.json({ ok:true, version: nextVer });
      }
      // Fallback to legacy current if mapping tools have no rows
      const cur0 = await pool.query(`select version, config, tables from public.mod_grabbing_jerome_domain_type_config where domain=$1 and lower(page_type)=lower($2)`, [domain, pageType]);
      if (!cur0.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const up = await pool.query(
        `update public.mod_grabbing_jerome_domain_type_config
            set version = coalesce(version,1)+1, updated_at=now()
          where domain=$1 and lower(page_type)=lower($2)
          returning version, config, tables`,
        [domain, pageType]
      );
      const row = up.rows?.[0] || {};
      const ver = Number(row.version||0) || 0;
      try { await pool.query(`insert into public.mod_grabbing_jerome_domain_type_config_hist(domain,page_type,version,config,tables,created_at) values ($1,$2,$3,$4::jsonb,$5::jsonb, now())`, [domain, pageType, ver, JSON.stringify(row.config||{}), JSON.stringify(row.tables||{})]); } catch {}
      try { await pool.query(`insert into public.mod_grabbing_jerome_maping_tools (domain,page_type,version,name,config,enabled,updated_at) values ($1,$2,$3,$4,$5::jsonb,$6, now()) on conflict (domain,page_type,version,org_id) do update set name=EXCLUDED.name, config=EXCLUDED.config, enabled=EXCLUDED.enabled, updated_at=now()`, [domain, pageType, ver, 'snapshot', JSON.stringify(row.config||{}), true]); } catch {}
      return res.json({ ok:true, version: ver });
    } catch (e) { return res.status(500).json({ ok:false, error:'snapshot_failed', message: e?.message || String(e) }); }
  });

  // Upsert domain (avoid per-request DDL; qualify table names; apply short timeout)
  app.post('/api/grabbing-jerome/domains', async (req, res) => {
    try {
      const domain = normDomain(req.body?.domain);
      const sitemap_url = String(req.body?.sitemap_url || '').trim() || null;
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      const st = Math.max(100, Number(process.env.GJ_DOMAINS_TIMEOUT_MS || 5000));
      const client = (typeof pool.connect === 'function') ? await pool.connect() : null;
      if (client) {
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch {}
          const { rows } = await client.query(
            `insert into public.mod_grabbing_jerome_domains(domain, sitemap_url, updated_at)
             values($1, $2, now())
             on conflict (domain)
             do update set sitemap_url = coalesce(EXCLUDED.sitemap_url, public.mod_grabbing_jerome_domains.sitemap_url), updated_at = now()
             returning domain, sitemap_url, sitemaps, selected_sitemaps, sitemap_total_urls, config, config_transfert, created_at, updated_at`,
            [domain, sitemap_url]
          );
          await client.query('COMMIT');
          try { chatLog?.('domain_upsert', { domain }); } catch {}
          return res.json({ ok:true, item: rows[0] });
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch {}
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) return res.status(503).json({ ok:false, error:'db_timeout' });
          return res.status(500).json({ ok:false, error:'upsert_failed', message: e?.message || String(e) });
        } finally { try { client.release(); } catch {} }
      } else {
        // Fallback without client-level timeout
        try { await pool.query('SET statement_timeout = ' + st); } catch {}
        try {
          const { rows } = await pool.query(
            `insert into public.mod_grabbing_jerome_domains(domain, sitemap_url, updated_at)
             values($1, $2, now())
             on conflict (domain)
             do update set sitemap_url = coalesce(EXCLUDED.sitemap_url, public.mod_grabbing_jerome_domains.sitemap_url), updated_at = now()
             returning domain, sitemap_url, sitemaps, selected_sitemaps, sitemap_total_urls, config, config_transfert, created_at, updated_at`,
            [domain, sitemap_url]
          );
          try { chatLog?.('domain_upsert', { domain }); } catch {}
          return res.json({ ok:true, item: rows[0] });
        } catch (e) {
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) return res.status(503).json({ ok:false, error:'db_timeout' });
          return res.status(500).json({ ok:false, error:'upsert_failed', message: e?.message || String(e) });
        } finally { try { await pool.query('SET statement_timeout = DEFAULT'); } catch {} }
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'upsert_failed', message: e?.message || String(e) }); }
  });

  // Delete domain (avoid ensure; qualify table name; short timeout)
  app.delete('/api/grabbing-jerome/domains/:domain', async (req, res) => {
    try {
      const domain = normDomain(req.params?.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request' });
      const st = Math.max(100, Number(process.env.GJ_DOMAINS_TIMEOUT_MS || 5000));
      const client = (typeof pool.connect === 'function') ? await pool.connect() : null;
      if (client) {
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch {}
          const r = await client.query('delete from public.mod_grabbing_jerome_domains where domain=$1', [domain]);
          await client.query('COMMIT');
          try { chatLog?.('domain_delete', { domain, deleted: Number(r.rowCount||0) }); } catch {}
          return res.json({ ok:true, deleted: Number(r.rowCount||0) });
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch {}
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) return res.status(503).json({ ok:false, error:'db_timeout' });
          return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) });
        } finally { try { client.release(); } catch {} }
      } else {
        try { await pool.query('SET statement_timeout = ' + st); } catch {}
        try {
          const r = await pool.query('delete from public.mod_grabbing_jerome_domains where domain=$1', [domain]);
          try { chatLog?.('domain_delete', { domain, deleted: Number(r.rowCount||0) }); } catch {}
          return res.json({ ok:true, deleted: Number(r.rowCount||0) });
        } catch (e) {
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) return res.status(503).json({ ok:false, error:'db_timeout' });
          return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) });
        } finally { try { await pool.query('SET statement_timeout = DEFAULT'); } catch {} }
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });

  // Fast count endpoint to verify connectivity without heavy sorting
  app.get('/api/grabbing-jerome/domains/__count', async (_req, res) => {
    try {
      const st = Math.max(100, Number(process.env.GJ_DOMAINS_TIMEOUT_MS || 5000));
      const client = (typeof pool.connect === 'function') ? await pool.connect() : null;
      if (client) {
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch {}
          const r = await client.query('select count(1) as c from public.mod_grabbing_jerome_domains');
          await client.query('COMMIT');
          return res.json({ ok:true, count: Number(r.rows?.[0]?.c || 0) });
        } catch (e) { try { await client.query('ROLLBACK'); } catch {}; return res.status(503).json({ ok:false, error:'db_timeout' }); }
        finally { try { client.release(); } catch {} }
      } else {
        const r = await pool.query('select count(1) as c from public.mod_grabbing_jerome_domains');
        return res.json({ ok:true, count: Number(r.rows?.[0]?.c || 0) });
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'count_failed', message: e?.message || String(e) }); }
  });
}
