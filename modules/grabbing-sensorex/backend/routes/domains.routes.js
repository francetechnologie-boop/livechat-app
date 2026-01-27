import { createHash } from 'crypto';

export function registerGrabbingSensorexDomainsRoutes(app, _ctx, utils = {}) {
  // Fallback to ctx when utils are not provided by the loader
  const pool = utils?.pool || _ctx?.pool;
  const chatLog = utils?.chatLog || ((event, payload = {}) => { try { _ctx?.logToFile?.(`[grabbing-sensorex] ${event} ${JSON.stringify(payload)}`); } catch (e) {} });
  const normDomain = utils?.normDomain || ((input) => {
    try {
      let raw = String(input || '').trim();
      if (!raw) return '';
      if (/^https?:\/\//i.test(raw)) { try { const u = new URL(raw); raw = (u.hostname || '').toLowerCase(); } catch (e) {} }
      return raw.toLowerCase().replace(/^www\./, '');
    } catch (e) { return String(input||'').toLowerCase().replace(/^www\./,''); }
  });
  if (!pool || typeof pool.query !== 'function') return;

  const ensureDomainsTable = utils?.ensureDomainsTable || (async () => {});
  // unified tables removed
  const ensureDomainTypeConfigTable = async () => {};
  const ensureDomainTypeConfigHistoryTable = async () => {};
  const ensureTableSettingsTable = utils?.ensureTableSettingsTable || (async ()=>{});
  const ensureMappingToolsTable = utils?.ensureMappingToolsTable || (async () => {});
  const ensureUrlTables = utils?.ensureUrlTables || (async () => {});
  const hasUnaccentExt = utils?.hasUnaccentExt || (async () => false);

  // Domains list (read-only; avoid DDL ensure to prevent lock contention)
  app.get('/api/grabbing-sensorex/domains', async (req, res) => {
    try {
      try { chatLog?.('route_hit', { method: req.method, url: req.originalUrl || req.url }); } catch (e) {}
      // Do not call ensureDomainsTable() here; on large instances concurrent DDL can block.
      const q = String(req.query?.q || '').trim().toLowerCase();
      const limit = Math.min(1000, Math.max(1, Number(req.query?.limit || 200)));
      const wantFull = String(req.query?.full || '').trim() === '1' || String(req.query?.fields||'') === 'full';
      // Default to lightweight columns to avoid pulling large JSON per row
      const liteMode = !wantFull;
      const filters = [];
      const params = [];
      let idx = 1;
      if (q) {
        filters.push(`(lower(domain) like $${idx} or lower(coalesce(sitemap_url,'')) like $${idx})`);
        params.push(`%${q}%`);
        idx++;
      }
      const t0 = Date.now();
      const baseColsLite = `domain, sitemap_url, updated_at`;
      const baseColsFull = `domain, sitemap_url, sitemaps, selected_sitemaps, sitemap_total_urls, created_at, updated_at`;
      const cols = liteMode ? baseColsLite : baseColsFull;
      const sql = `select ${cols}
                     from mod_grabbing_sensorex_domains
                    ${filters.length ? `where ${filters.join(' and ')}` : ''}
                    order by updated_at desc nulls last, domain asc
                    limit $${idx}`;
      params.push(limit);
      const st = Math.max(200, Number(process.env.GJ_DOMAINS_TIMEOUT_MS || 8000));
      const client = typeof pool.connect === 'function' ? await pool.connect() : null;
      if (client) {
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch (e) {}
          const { rows } = await client.query(sql, params);
          await client.query('COMMIT');
          const dt = Date.now() - t0;
          try { chatLog?.('domains_list', { count: (rows||[]).length, ms: dt }); } catch (e) {}
          try { res.setHeader('X-Query-Time', String(dt)); } catch (e) {}
          return res.json({ ok:true, items: rows });
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch (e) {}
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) {
            try { chatLog?.('domains_list_timeout', { ms: Date.now() - t0, limit, q, liteMode }); } catch (e) {}
            // Fallback: attempt a very-light query (domain only) with a shorter timeout to keep UI usable
            try {
              const t1 = Date.now();
              const st2 = Math.max(200, Math.floor(st / 2));
              await client.query('BEGIN');
              try { await client.query('SET LOCAL statement_timeout = ' + st2); } catch (e) {}
              const { rows: rows2 } = await client.query(
                `select domain from mod_grabbing_sensorex_domains ${filters.length ? `where ${filters.join(' and ')}` : ''} order by updated_at desc nulls last, domain asc limit $1`,
                [limit]
              );
              await client.query('COMMIT');
              const dt2 = Date.now() - t1;
              try { chatLog?.('domains_list_fallback', { count: (rows2||[]).length, ms: dt2 }); } catch (e) {}
              return res.json({ ok: true, items: rows2 });
            } catch (e2) {
              try { await client.query('ROLLBACK'); } catch (e) {}
              return res.status(503).json({ ok:false, error:'db_timeout' });
            }
          }
          throw e;
        } finally {
          try { client.release(); } catch (e) {}
        }
      } else {
        // Fallback: no connect() available; perform best-effort with global timeout
        try { await pool.query('SET statement_timeout = ' + st); } catch (e) {}
        try {
          const { rows } = await pool.query(sql, params);
          const dt = Date.now() - t0;
          try { chatLog?.('domains_list', { count: (rows||[]).length, ms: dt }); } catch (e) {}
          try { res.setHeader('X-Query-Time', String(dt)); } catch (e) {}
          return res.json({ ok:true, items: rows });
        } catch (e) {
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) {
            try { chatLog?.('domains_list_timeout', { ms: Date.now() - t0, limit, q, liteMode }); } catch (e) {}
            // Best-effort fallback without a transaction
            try {
              const t1 = Date.now();
              const st2 = Math.max(200, Math.floor(st / 2));
              try { await pool.query('SET statement_timeout = ' + st2); } catch (e) {}
              const { rows: rows2 } = await pool.query(
                `select domain from mod_grabbing_sensorex_domains ${filters.length ? `where ${filters.join(' and ')}` : ''} order by updated_at desc nulls last, domain asc limit $1`,
                [limit]
              );
              const dt2 = Date.now() - t1;
              try { chatLog?.('domains_list_fallback', { count: (rows2||[]).length, ms: dt2 }); } catch (e) {}
              return res.json({ ok: true, items: rows2 });
            } catch (e2) {
              return res.status(503).json({ ok:false, error:'db_timeout' });
            } finally {
              try { await pool.query('SET statement_timeout = DEFAULT'); } catch (e) {}
            }
          }
          throw e;
        } finally {
          try { await pool.query('SET statement_timeout = DEFAULT'); } catch (e) {}
        }
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Ultra-light domains list for selectors (moved from urls.routes.js)
  app.get('/api/grabbing-sensorex/domains/list-lite_TEST', async (_req, res) => {
    try {
      const st = Math.max(200, Number(process.env.GJ_DOMAINS_TIMEOUT_MS || 5000));
      const sql = "select domain from public.mod_grabbing_sensorex_domains order by updated_at desc nulls last, domain asc limit 500";
      let rows = [];
      if (typeof pool.connect === 'function') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch (e) {}
          const r = await client.query(sql);
          await client.query('COMMIT');
          rows = r.rows || [];
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch (e2) {}
          return res.status(500).json({ ok:false, error:'list_failed' });
        } finally { try { client.release(); } catch (e) {} }
      } else {
        try { await pool.query('SET statement_timeout = ' + st); } catch (e) {}
        try {
          const r = await pool.query(sql);
          rows = r.rows || [];
        } catch (e) { return res.status(500).json({ ok:false, error:'list_failed' }); }
        finally { try { await pool.query('SET statement_timeout = DEFAULT'); } catch (e) {} }
      }
      return res.json({ ok:true, items: rows });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error' }); }
  });
  app.get('/api/grabbing-sensorex/domains/list-lite', async (_req, res) => {
    try {
      const st = Math.max(200, Number(process.env.GJ_DOMAINS_TIMEOUT_MS || 5000));
      const sql = "select domain from public.mod_grabbing_sensorex_domains order by updated_at desc nulls last, domain asc limit 500";
      let rows = [];
      if (typeof pool.connect === 'function') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch (e) {}
          const r = await client.query(sql);
          await client.query('COMMIT');
          rows = r.rows || [];
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch (e2) {}
          return res.status(500).json({ ok:false, error:'list_failed' });
        } finally { try { client.release(); } catch (e) {} }
      } else {
        try { await pool.query('SET statement_timeout = ' + st); } catch (e) {}
        try {
          const r = await pool.query(sql);
          rows = r.rows || [];
        } catch (e) { return res.status(500).json({ ok:false, error:'list_failed' }); }
        finally { try { await pool.query('SET statement_timeout = DEFAULT'); } catch (e) {} }
      }
      return res.json({ ok:true, items: rows });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error' }); }
  });

  // Legacy alias for domains list
  app.get('/api/grabbings/sensorex/domains', async (req, res) => {
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
      const sql = `select domain, sitemap_url, sitemaps, selected_sitemaps, sitemap_total_urls, created_at, updated_at
                     from mod_grabbing_sensorex_domains
                    ${filters.length ? `where ${filters.join(' and ')}` : ''}
                    order by updated_at desc nulls last, domain asc
                    limit $${idx}`;
      params.push(limit);
      const st = Math.max(100, Number(process.env.GJ_DOMAINS_TIMEOUT_MS || 5000));
      const client = typeof pool.connect === 'function' ? await pool.connect() : null;
      if (client) {
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch (e) {}
          const { rows } = await client.query(sql, params);
          await client.query('COMMIT');
          return res.json({ ok:true, items: rows });
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch (e) {}
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) return res.status(503).json({ ok:false, error:'db_timeout' });
          throw e;
        } finally {
          try { client.release(); } catch (e) {}
        }
      } else {
        try { await pool.query('SET statement_timeout = ' + st); } catch (e) {}
        try {
          const { rows } = await pool.query(sql, params);
          return res.json({ ok:true, items: rows });
        } catch (e) {
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) return res.status(503).json({ ok:false, error:'db_timeout' });
          throw e;
        } finally {
          try { await pool.query('SET statement_timeout = DEFAULT'); } catch (e) {}
        }
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Get domain transfer config (optionally pick mapping by page_type)
  app.get('/api/grabbing-sensorex/domains/:domain/transfert', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureDomainsTable();
      // unified tables removed
      await ensureMappingToolsTable();
      const domain = normDomain(req.params?.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      // Normalizer: promote defaults into fields and drop top-level defaults
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
            } catch (e) {}
          }
          if (changed) { out.tables = tables; try { delete out.defaults; } catch (e) {} }
          return out;
        } catch (e) { return m; }
      };
      // Enricher: replicate top-level product_shop.settings.id_shops to all *_shop tables when missing
      const enrichWithTopShops = (m) => {
        try {
          if (!m || typeof m !== 'object') return m;
          const top = (m?.tables?.product_shop?.settings?.id_shops || []).filter(n=>Number(n)>0);
          if (!Array.isArray(top) || !top.length) return m;
          const out = JSON.parse(JSON.stringify(m));
          const tables = out.tables && typeof out.tables==='object' ? out.tables : {};
          for (const [name, entryRaw] of Object.entries(tables)) {
            try {
              const isShop = /_shop$/i.test(String(name||''));
              if (!isShop) continue;
              const entry = entryRaw && typeof entryRaw==='object' ? entryRaw : {};
              entry.settings = entry.settings && typeof entry.settings==='object' ? entry.settings : {};
              if (!Array.isArray(entry.settings.id_shops) || entry.settings.id_shops.length === 0) {
                entry.settings.id_shops = top.slice();
              }
              tables[name] = entry;
            } catch (e) {}
          }
          out.tables = tables;
          return out;
        } catch (e) { return m; }
      };
      // Prefer new mapping tools table (latest version) for mapping payload
      if (pageType) {
        try {
          const rmt = await pool.query(
            `select version, config, created_at, updated_at from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc, updated_at desc limit 1`,
            [domain, pageType]
          );
          if (rmt.rowCount) {
            const row = rmt.rows[0] || {};
            let mv_hash = null;
            try { mv_hash = createHash('sha256').update(JSON.stringify(row?.config || {})).digest('hex').slice(0,8); } catch (e) {}
            const norm = normalizeMapping(row.config || {});
            // Merge per-table settings from legacy table_settings (id_shops/id_langs) into mapping when missing
            try {
              const rSet = await pool.query(
                `SELECT table_name, settings FROM public.mod_grabbing_sensorex_table_settings WHERE domain=$1 AND lower(page_type)=lower($2)`,
                [domain, pageType]
              );
              if (rSet.rowCount) {
                const tables = (norm.tables && typeof norm.tables==='object') ? norm.tables : (norm.tables = {});
                for (const it of rSet.rows) {
                  try {
                    const name = String(it.table_name||'').trim();
                    if (!name) continue;
                    const s = it.settings && typeof it.settings==='object' ? it.settings : {};
                    if (!s || (!Array.isArray(s.id_shops) && !Array.isArray(s.id_langs))) continue;
                    const entry = tables[name] && typeof tables[name]==='object' ? tables[name] : (tables[name] = {});
                    entry.settings = entry.settings && typeof entry.settings==='object' ? entry.settings : (entry.settings = {});
                    // Override mapping.tools settings with authoritative table-settings values
                    if (Array.isArray(s.id_shops)) entry.settings.id_shops = s.id_shops.slice();
                    if (Array.isArray(s.id_langs)) entry.settings.id_langs = s.id_langs.slice();
                  } catch (e) {}
                }
              }
            } catch (e) {}
            const enriched = enrichWithTopShops(norm);
            return res.json({ ok:true,
              config_transfert: null,
              mapping: enriched || null,
              unified: { config: enriched || null, tables: null, version: row.version || 1, updated_at: row.updated_at || null },
              mapping_version: Number(row.version || 1),
              mapping_version_hash: mv_hash,
              mapping_updated_at: row.updated_at || null
            });
          }
        } catch (e) {}
        // No legacy fallback — return an empty JSON structure instead of 404
        return res.json({ ok:true,
          config_transfert: null,
          mapping: null,
          unified: { config: null, tables: null, version: 0, updated_at: null },
          mapping_version: 0,
          mapping_version_hash: null,
          mapping_updated_at: null
        });
      }
      // If page_type is missing, treat as bad request to avoid ambiguity
      return res.status(400).json({ ok:false, error:'bad_request', message:'page_type required' });
    } catch (e) { return res.status(500).json({ ok:false, error:'get_failed', message: e?.message || String(e) }); }
  });

  // Discovered URLs — moved from urls.routes.js
  app.get('/api/grabbing-sensorex/domains/urls', async (req, res) => {
    try {
      const domain = normDomain(req.query?.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      // Allow larger page sizes for the Step 4 Discovered URLs tool
      const limit = Math.min(2000, Math.max(1, Number(req.query?.limit || 50)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const q = String(req.query?.q || '').trim().toLowerCase();
      const qUrlOnly = (String(req.query?.url_only || '').toLowerCase() === '1' || String(req.query?.url_only || '').toLowerCase() === 'true');
      // Optional include/exclude filters applied to URL only (comma-separated)
      const qInRaw = String(req.query?.q_in || '').trim();
      const qNotRaw = String(req.query?.q_not || '').trim();
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const include = String(req.query?.include || '').toLowerCase();
      const includeSubdomains = (String(req.query?.include_subdomains || '').toLowerCase() === '1' || String(req.query?.include_subdomains || '').toLowerCase() === 'true');
      const includeRuns = (String(req.query?.include_runs || '').toLowerCase() === '1' || String(req.query?.include_runs || '').toLowerCase() === 'true');
      const notInRuns = (String(req.query?.not_in_runs || '').toLowerCase() === '1' || String(req.query?.not_in_runs || '').toLowerCase() === 'true');
      const sortByRaw = String(req.query?.sort_by || '').trim().toLowerCase();
      const sortDirRaw = String(req.query?.sort_dir || '').trim().toLowerCase();
      const sortDir = (sortDirRaw === 'asc') ? 'asc' : 'desc';
      await ensureUrlTables();
      const useUnaccent = await hasUnaccentExt();
      const altDomain = domain ? ('www.' + domain.replace(/^www\./,'')) : '';
      const where = ['(lower(trim(both from d.domain)) = lower(trim(both from $1)) OR lower(trim(both from d.domain)) = lower(trim(both from $2)))'];
      const params = [domain, altDomain];
      if (includeSubdomains) { where.push(`lower(trim(both from d.domain)) LIKE lower(trim(both from $3))`); params.push('%.' + domain.replace(/^www\./,'')); }
      let i = includeSubdomains ? 4 : 3;
      if (q) {
        if (useUnaccent) { if (qUrlOnly) { where.push(`unaccent(trim(both from d.url)) ILIKE unaccent($${i})`); params.push(`%${q}%`); i++; } else { where.push(`(unaccent(trim(both from d.url)) ILIKE unaccent($${i}) OR unaccent(trim(both from coalesce(d.title,''))) ILIKE unaccent($${i}))`); params.push(`%${q}%`); i++; } }
        else { if (qUrlOnly) { where.push(`trim(both from d.url) ILIKE $${i}`); params.push(`%${q}%`); i++; } else { where.push(`(trim(both from d.url) ILIKE $${i} OR trim(both from coalesce(d.title,'')) ILIKE $${i})`); params.push(`%${q}%`); i++; } }
      }
      if (pageType) { where.push(`lower(coalesce(d.page_type,'')) = $${i}`); params.push(pageType); i++; }
      // Apply include filters to URL only
      if (qInRaw) {
        const parts = qInRaw.split(',').map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
          if (useUnaccent) { where.push(`unaccent(trim(both from d.url)) ILIKE unaccent($${i})`); params.push(`%${part.toLowerCase()}%`); i++; }
          else { where.push(`trim(both from d.url) ILIKE $${i}`); params.push(`%${part.toLowerCase()}%`); i++; }
        }
      }
      // Apply exclude filters to URL only
      if (qNotRaw) {
        const parts = qNotRaw.split(',').map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
          if (useUnaccent) { where.push(`NOT (unaccent(trim(both from d.url)) ILIKE unaccent($${i}))`); params.push(`%${part.toLowerCase()}%`); i++; }
          else { where.push(`NOT (trim(both from d.url) ILIKE $${i})`); params.push(`%${part.toLowerCase()}%`); i++; }
        }
      }
      if (notInRuns) {
        where.push(`not exists (
          select 1 from public.mod_grabbing_sensorex_extraction_runs r
          where regexp_replace(lower(coalesce(r.domain,'')),'^www\\.','') = regexp_replace(lower(coalesce(d.domain,'')),'^www\\.','')
            and lower(trim(both from r.url)) = lower(trim(both from d.url))
        )`);
      }
      const whereSql = 'where ' + where.join(' and ');
      const totalSql = `select count(*)::int as c from public.mod_grabbing_sensorex_domains_url d ${whereSql}`;
      const sortMap = { 'explored': 'd.explored', 'discovered_at': 'd.discovered_at', 'page_type': "lower(coalesce(d.page_type,''))", 'type': "lower(coalesce(d.type,''))", 'title': "lower(coalesce(d.title,''))", 'url': 'lower(trim(both from d.url))' };
      const sortExpr = sortMap[sortByRaw] || null;
      const orderSql = sortExpr ? `order by ${sortExpr} ${sortDir} nulls last, d.id desc` : `order by d.explored desc nulls last, d.discovered_at desc nulls last, d.id desc`;
      const selRuns = includeRuns
        ? `,
            (select r.id from public.mod_grabbing_sensorex_extraction_runs r
               where regexp_replace(lower(coalesce(r.domain,'')),'^www\\.','') = regexp_replace(lower(coalesce(d.domain,'')),'^www\\.','')
                 and lower(trim(both from r.url)) = lower(trim(both from d.url))
               order by r.created_at desc nulls last
               limit 1) as last_run_id`
        : '';
      const sql = `select d.id, d.domain, d.url, d.title, d.page_type, d.type, d.explored, d.discovered_at${selRuns}
                     from public.mod_grabbing_sensorex_domains_url d
                     ${whereSql}
                     ${orderSql}
                     limit $${i} offset $${i+1}`;
      const total = await pool.query(totalSql, params);
      const rows = await pool.query(sql, [...params, limit, offset]);
      return res.json({ ok:true, items: rows.rows||[], total: Number(total.rows?.[0]?.c||0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });
  app.post('/api/grabbing-sensorex/domains/urls', async (req, res) => {
    try {
      const domain = normDomain(req.body?.domain);
      const url = String(req.body?.url||'').trim();
      const manualPageType = String(req.body?.page_type||'').trim().toLowerCase();
      if (!domain || !url) return res.status(400).json({ ok:false, error:'bad_request' });
      await ensureUrlTables();
      let can = '';
      try { can = new URL(url).toString(); } catch { try { can = new URL(url, `https://${domain}`).toString(); } catch { can = String(url); } }
      const type = 'page';
      const pageType = manualPageType || null;
      const rIns = await pool.query(
        `insert into public.mod_grabbing_sensorex_domains_url(domain,url,type,title,page_type,meta,product,discovered_at)
         select $1,$2,$3,null,$4,$5::jsonb,$6::jsonb, now()
         where not exists (
           select 1 from public.mod_grabbing_sensorex_domains_url where domain=$1 and lower(trim(both from url))=lower(trim(both from $2))
         )`,
        [domain, can, type, pageType, JSON.stringify({ added: true }), JSON.stringify({})]
      );
      const inserted = Number(rIns.rowCount||0) > 0;
      return res.json({ ok:true, inserted, existed: !inserted, domain, url: can });
    } catch (e) { return res.status(500).json({ ok:false, error:'add_failed', message: e?.message || String(e) }); }
  });
  app.delete('/api/grabbing-sensorex/domains/urls', async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const domain = normDomain(body.domain);
      const ids = Array.isArray(body.ids) ? body.ids.map(n=>Number(n)||0).filter(n=>n>0) : [];
      const includeSubs = !!body.include_subdomains || String(body.include_subdomains||'') === '1' || String(body.include_subdomains||'').toLowerCase() === 'true';
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      if (!ids.length) return res.status(400).json({ ok:false, error:'bad_request', message:'ids required' });
      await ensureUrlTables();
      const altDomain = 'www.' + domain.replace(/^www\./,'');
      let sql, params;
      if (includeSubs) {
        sql = `delete from public.mod_grabbing_sensorex_domains_url
                 where (
                   lower(trim(both from domain)) = lower(trim(both from $1))
                   OR lower(trim(both from domain)) = lower(trim(both from $2))
                   OR lower(trim(both from domain)) like ('%.' || lower(trim(both from $1)))
                 )
                   and id = ANY($3::bigint[])`;
        params = [domain, altDomain, ids];
      } else {
        sql = `delete from public.mod_grabbing_sensorex_domains_url
                 where (lower(trim(both from domain)) = lower(trim(both from $1))
                        OR lower(trim(both from domain)) = lower(trim(both from $2)))
                   and id = ANY($3::bigint[])`;
        params = [domain, altDomain, ids];
      }
      const r = await pool.query(sql, params);
      return res.json({ ok:true, deleted: Number(r.rowCount||0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });
  app.post('/api/grabbing-sensorex/domains/urls/reclassify', async (req, res) => {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const domain = normDomain(body.domain);
      const ids = Array.isArray(body.ids) ? body.ids.map(n=>Number(n)||0).filter(n=>n>0) : [];
      const maxConc = Math.min(8, Math.max(1, Number(body.concurrency || 4)));
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      if (!ids.length) return res.status(400).json({ ok:false, error:'bad_request', message:'ids required' });
      await ensureUrlTables();
      const altDomain = 'www.' + domain.replace(/^www\./,'');
      const rows = await pool.query(
        `select id, domain, url from public.mod_grabbing_sensorex_domains_url
          where (lower(trim(both from domain)) = lower(trim(both from $1))
                 or lower(trim(both from domain)) = lower(trim(both from $2)))
            and id = any($3::bigint[])`,
        [domain, altDomain, ids]
      );
      const items = Array.isArray(rows?.rows) ? rows.rows : [];
      let updated = 0; let failed = 0;
      const tasks = items.map((it) => async () => {
        const url = String(it.url||'').trim();
        if (!url) { failed++; return; }
        try {
          const r = await fetch(url, { method:'GET', redirect:'follow', headers:{ 'user-agent':'Mozilla/5.0 (compatible; LivechatBot/1.0)' } });
          const ct = String(r.headers.get('content-type')||'');
          if (!r.ok || !/text\/html/i.test(ct)) { failed++; return; }
          const html = await r.text();
          const title = (function(txt){ const m = String(txt||'').match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m && m[1] ? m[1].trim() : ''; })(html);
          const page_type = (function(h, uStr=''){ const og = (function(name){ const re = new RegExp(`<meta[^>]+property=[\"']${name.replace(/[-\/\\^$*+?.()|[\]{}]/g,'\\$&')}[\"'][^>]*content=[\"']([^\"']+)[\"'][^>]*>`, 'i'); const m = String(h||'').match(re); return m && m[1] ? m[1].trim() : ''; }) (h,'og:type'); let path = ''; let search = ''; try { const u = new URL(String(uStr||'')); path = (u.pathname||'').toLowerCase(); search = (u.search||'').toLowerCase(); } catch (e) { path = String(uStr||'').toLowerCase(); search = ''; } const hasWooGrid=/<ul[^>]+class=[\"'][^\"']*\bproducts\b[^\"']*[\"'][^>]*>[\s\S]*?<li[^>]+class=[\"'][^\"']*\bproduct\b/i.test(String(h||'')); const isProductOg=/product/.test(String(og||'')); const isProductJsonLd=(function(html){ try { const arr = String(html||'').match(/<script[^>]+type=[\"']application\/ld\+json[\"'][^>]*>[\s\S]*?<\/script>/gi) || []; for (const s of arr) { const j = s.replace(/^[\s\S]*?>/,'').replace(/<\/script>[\s\S]*$/,''); const obj = JSON.parse(j); const objs = Array.isArray(obj)? obj: [obj]; for (const o of objs) { const t = (o && (o['@type'] || o.type)); if (t && String(t).toLowerCase().includes('product')) return true; } } } catch (e) {} return false; })(h); const isProductPath=/\/(product|item)\/(?:[^/]|$)/.test(path); if (isProductOg||isProductJsonLd||isProductPath) return 'product'; const isCategoryPath=/(\/product-category\/|\/category\/|\/categories\/|\/collections?\/|\/catalog\/)/.test(path); const isCategoryQuery=/[?&](category|cat|collection|collections|catalog)=/.test(search); if (isCategoryPath||isCategoryQuery||hasWooGrid) return 'category'; if (/article|blog/.test(String(og||'')) || /<article[^>]*>/.test(String(h||'')) || /(\/blog\/|\/news\/|\/post\/)/.test(path)) return 'article'; return 'page'; })(html, url);
          try { chatLog?.('url_reclass', { id: it.id, page_type, title: (title||'').slice(0,120) }); } catch (e) {}
          await pool.query(
            `update public.mod_grabbing_sensorex_domains_url
               set title=$1, type=$2, page_type=$2, explored=now()
             where id=$3`,
            [title || null, page_type || 'page', it.id]
          );
          updated++;
        } catch { failed++; }
      });
      const queue = tasks.slice();
      const workers = Array.from({ length: Math.min(maxConc, tasks.length || 1) }, async () => { while (queue.length) { const fn = queue.shift(); if (typeof fn === 'function') { await fn(); } } });
      await Promise.all(workers);
      return res.json({ ok:true, requested: ids.length, found: items.length, updated, failed });
    } catch (e) { return res.status(500).json({ ok:false, error:'reclass_failed', message: e?.message || String(e) }); }
  });

  // Update transfer settings (persist to mapping_tools; legacy domains columns removed)
  app.post('/api/grabbing-sensorex/domains/:domain/transfert', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureDomainsTable();
      await ensureMappingToolsTable();
      const domain = normDomain(req.params?.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      // No domains.config* patch anymore; everything is stored in mapping_tools
      // Manage mapping fully in mapping tools table
      try {
        if (body.mapping && typeof body.mapping === 'object') {
          const pageType = String(body.page_type || '').trim().toLowerCase();
          if (pageType) {
            // Auto-propagate per-table settings on Save Mapping
            try {
              const d = { rowCount: 0, rows: [] };
              // Prefer explicit profile from request; fallback to domain config
              let prId = null;
              if (body.db_mysql_profile_id != null) {
              try { prId = Number(body.db_mysql_profile_id) || null; } catch (e) { prId = null; }
              }
              const prefix = String((body.mapping.prefix || 'ps_'));
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
                    } finally { try { if (conn) await conn.end(); } catch (e) {} }
                  }
                } catch (e) {}
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
                        } finally { try { if (conn) await conn.end(); } catch (e) {} }
                      }
                    } catch (e) {}
                  } else {
                    if (/_shop$/i.test(key)) hasShop = true;
                    if (/_lang$/i.test(key)) hasLang = true;
                  }
                  if (hasShop && (!Array.isArray(entry.settings.id_shops) || entry.settings.id_shops.length===0) && topShops.length) entry.settings.id_shops = topShops.slice();
                  if (hasLang && (!Array.isArray(entry.settings.id_langs) || entry.settings.id_langs.length===0) && activeLangIds.length) entry.settings.id_langs = activeLangIds.slice();
                } catch (e) {}
              }
            } catch (e) {}
            const versionBump = !!body.version_bump;
            const name = String(body.name || '').trim() || null;
            // Read latest version
            const latest = await pool.query(
              `select version from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc limit 1`,
              [domain, pageType]
            );
            let nextVer = (latest.rowCount ? Number(latest.rows[0].version||0) : 0) + 1;
            // Normalize mapping before persisting: promote defaults to fields
            const promoteDefaults = (m) => {
              try {
                if (!m || typeof m !== 'object') return m;
                const out = JSON.parse(JSON.stringify(m||{}));
                const tables = (out.tables && typeof out.tables==='object') ? out.tables : {};
                const defsAll = (out.defaults && typeof out.defaults==='object') ? out.defaults : {};
                for (const [tName, defs] of Object.entries(defsAll||{})) {
                  const entry = (tables[tName] && typeof tables[tName]==='object') ? tables[tName] : {};
                  const fields = (entry.fields && typeof entry.fields==='object') ? entry.fields : {};
                  for (const [col, defVal] of Object.entries(defs||{})) {
                    const s = String(defVal);
                    fields[col] = (s === '') ? '' : ('='+s);
                  }
                  entry.fields = fields;
                  tables[tName] = entry;
                }
                out.tables = tables;
                delete out.defaults;
                return out;
              } catch (e) { return m; }
            };
            const cleanMapping = promoteDefaults(body.mapping||{});
            if (latest.rowCount && !versionBump) {
              // Update latest version in place
              const curVer = Number(latest.rows[0].version||1) || 1;
              // Config-only update: persist JSON config and metadata only
              await pool.query(
                `update public.mod_grabbing_sensorex_maping_tools
                   set name=$1, config=$2::jsonb, enabled=$3, updated_at=now()
                 where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($4),'^www\\.','') and lower(page_type)=lower($5) and version=$6`,
                [name, JSON.stringify(cleanMapping||{}), true, domain, pageType, curVer]
              );
              try { chatLog('mapping_tools_update', { domain, page_type: pageType, version: curVer, mode: 'config_only' }); } catch (e) {}
            } else {
              // Insert new version
              // Config-only insert: persist JSON config and metadata only
              await pool.query(
                `insert into public.mod_grabbing_sensorex_maping_tools (domain,page_type,version,name,config,enabled, updated_at)
                 values ($1,$2,$3,$4,$5::jsonb,$6, now())`,
                [domain, pageType, latest.rowCount ? nextVer : 1, name, JSON.stringify(cleanMapping||{}), true]
              );
              try { chatLog('mapping_tools_insert', { domain, page_type: pageType, version: latest.rowCount ? nextVer : 1, mode: 'config_only' }); } catch (e) {}
            }

            // Mirror per-table settings for compatibility and linkage
            try {
                const hasLegacy = typeof utils?.hasTable === 'function' ? await utils.hasTable('mod_grabbing_sensorex_table_settings') : true;
                if (hasLegacy && body.mapping && body.mapping.tables && typeof body.mapping.tables === 'object') {
                  try { await ensureTableSettingsTable(); } catch (e) {}
                  let mapId = null; try { const q = await pool.query(`select id from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3 limit 1`, [domain, pageType, (latest.rowCount ? nextVer : curVer)]); if (q.rowCount) mapId = q.rows[0].id; } catch (e) {}
                  try { utils?.chatLog?.('table_settings_mirror_start', { domain, page_type: pageType, version: (latest.rowCount ? nextVer : curVer), map_id: mapId, tables: Object.keys(body.mapping.tables||{}).length }); } catch (e) {}
                  for (const [tbl, conf] of Object.entries(body.mapping.tables)) {
                    try {
                      let settings = null; let mapping = null;
                      if (conf && typeof conf === 'object') {
                        if (conf.settings && typeof conf.settings === 'object') settings = conf.settings;
                        if (conf.mapping && typeof conf.mapping === 'object') mapping = conf.mapping;
                      }
                      await pool.query(
                        `INSERT INTO public.mod_grabbing_sensorex_table_settings(domain,page_type,table_name,settings,mapping,mapping_tools_id,mapping_version,created_at,updated_at)
                         VALUES ($1,$2,$3, COALESCE($4::jsonb, '{}'::jsonb), $5::jsonb, $6, $7, now(), now())
                         ON CONFLICT (domain,page_type,table_name)
                         DO UPDATE SET settings=COALESCE(EXCLUDED.settings, public.mod_grabbing_sensorex_table_settings.settings),
                                       mapping=COALESCE(EXCLUDED.mapping, public.mod_grabbing_sensorex_table_settings.mapping),
                                       mapping_tools_id=EXCLUDED.mapping_tools_id,
                                       mapping_version=EXCLUDED.mapping_version,
                                       updated_at=now()`,
                        [domain, pageType, String(tbl), settings ? JSON.stringify(settings) : null, mapping ? JSON.stringify(mapping) : null, mapId, (latest.rowCount ? nextVer : curVer)]
                      );
                      try { utils?.chatLog?.('table_settings_mirror_row', { domain, page_type: pageType, table: String(tbl), version: (latest.rowCount ? nextVer : curVer) }); } catch (e) {}
                    } catch (e) {}
                  }
                  try { utils?.chatLog?.('table_settings_mirror_done', { domain, page_type: pageType, version: (latest.rowCount ? nextVer : curVer), map_id: mapId }); } catch (e) {}
                }
              } catch (e) {}
            }
        }
      } catch (e) {}
      chatLog('transfert_save_request', { domain, has_mapping: !!body.mapping, page_type: String(body.page_type||'') || null, has_profile: body.db_mysql_profile_id != null });
      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'update_failed', message: e?.message || String(e) }); }
  });

  // List mapping versions for a domain+page_type (mapping_tools only)
  app.get('/api/grabbing-sensorex/transfert/versions', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const limit = Math.min(1000, Math.max(1, Number(req.query?.limit || 50)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      // mapping tools table (authoritative)
      try {
        await ensureMappingToolsTable();
        const r2 = await pool.query(
          `select version, page_type, domain, name, created_at
             from public.mod_grabbing_sensorex_maping_tools
            where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','')
              and lower(page_type)=lower($2)
            order by version desc, updated_at desc
            limit $3 offset $4`,
          [domain, pageType, limit, offset]
        );
        if (r2.rowCount) return res.json({ ok:true, items: r2.rows || [] });
      } catch (e) {}
      // No legacy fallback
      return res.json({ ok:true, items: [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'versions_list_failed', message: e?.message || String(e) }); }
  });

  // Get mapping version payload (mapping_tools only)
  app.get('/api/grabbing-sensorex/transfert/version/get', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const version = Number(req.query?.version || 0);
      if (!domain || !pageType || !version) return res.status(400).json({ ok:false, error:'bad_request' });
      // mapping tools table (authoritative)
      try {
        await ensureMappingToolsTable();
        const r2 = await pool.query(
          `select version, config, created_at from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3 limit 1`,
          [domain, pageType, version]
        );
        if (r2.rowCount) return res.json({ ok:true, item: { version: r2.rows[0].version, config: r2.rows[0].config, created_at: r2.rows[0].created_at } });
      } catch (e) {}
      return res.status(404).json({ ok:false, error:'not_found' });
    } catch (e) { return res.status(500).json({ ok:false, error:'version_get_failed', message: e?.message || String(e) }); }
  });

  // Restore a mapping version (copy mapping_tools version into a new latest mapping_tools version)
  app.post('/api/grabbing-sensorex/transfert/version/restore', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const domain = normDomain(req.body?.domain);
      const pageType = String(req.body?.page_type || '').trim().toLowerCase();
      const version = Number(req.body?.version || 0);
      if (!domain || !pageType || !version) return res.status(400).json({ ok:false, error:'bad_request' });
      await ensureMappingToolsTable();
      const src = await pool.query(`select config from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3 limit 1`, [domain, pageType, version]);
      if (!src.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const cfg = src.rows[0]?.config || {};
      // Insert a new version with same config
      const next = await pool.query(
        `insert into public.mod_grabbing_sensorex_maping_tools (domain,page_type,version,name,config,enabled,updated_at)
         values ($1,$2, coalesce((select max(version)+1 from public.mod_grabbing_sensorex_maping_tools where domain=$1 and lower(page_type)=lower($2)),1), $3, $4::jsonb, true, now())
         returning version`,
        [domain, pageType, 'restore', JSON.stringify(cfg||{})]
      );
      const newVer = Number(next.rows?.[0]?.version||0) || null;
      return res.json({ ok:true, restored_to: newVer });
    } catch (e) { return res.status(500).json({ ok:false, error:'restore_failed', message: e?.message || String(e) }); }
  });

  // Snapshot current mapping/settings to a new version (mapping_tools only)
  app.post('/api/grabbing-sensorex/transfert/version/snapshot', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureMappingToolsTable();
      const domain = normDomain(req.body?.domain);
      const pageType = String(req.body?.page_type || '').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      // Snapshot mapping_tools only
      const latest = await pool.query(
        `select version, config from public.mod_grabbing_sensorex_maping_tools where domain=$1 and lower(page_type)=lower($2) order by version desc limit 1`,
        [domain, pageType]
      );
      if (latest.rowCount) {
        const curVer = Number(latest.rows[0].version||0) || 0;
        const nextVer = curVer + 1;
        const cfg = latest.rows[0].config || {};
        await pool.query(
          `insert into public.mod_grabbing_sensorex_maping_tools (domain,page_type,version,name,config,enabled,updated_at)
           values ($1,$2,$3,$4,$5::jsonb,$6, now())`,
          [domain, pageType, nextVer, 'snapshot', JSON.stringify(cfg||{}), true]
        );
        return res.json({ ok:true, version: nextVer });
      }
      return res.status(404).json({ ok:false, error:'not_found' });
    } catch (e) { return res.status(500).json({ ok:false, error:'snapshot_failed', message: e?.message || String(e) }); }
  });

  // Upsert domain (avoid per-request DDL; qualify table names; apply short timeout)
  app.post('/api/grabbing-sensorex/domains', async (req, res) => {
    try {
      const domain = normDomain(req.body?.domain);
      const sitemap_url = String(req.body?.sitemap_url || '').trim() || null;
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request', message:'domain required' });
      const st = Math.max(100, Number(process.env.GJ_DOMAINS_TIMEOUT_MS || 5000));
      const client = (typeof pool.connect === 'function') ? await pool.connect() : null;
      if (client) {
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch (e) {}
          const { rows } = await client.query(
            `insert into public.mod_grabbing_sensorex_domains(domain, sitemap_url, updated_at)
             values($1, $2, now())
             on conflict (domain)
             do update set sitemap_url = coalesce(EXCLUDED.sitemap_url, public.mod_grabbing_sensorex_domains.sitemap_url), updated_at = now()
             returning domain, sitemap_url, sitemaps, selected_sitemaps, sitemap_total_urls, created_at, updated_at`,
            [domain, sitemap_url]
          );
          await client.query('COMMIT');
          try { chatLog?.('domain_upsert', { domain }); } catch (e) {}
          return res.json({ ok:true, item: rows[0] });
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch (e) {}
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) return res.status(503).json({ ok:false, error:'db_timeout' });
          return res.status(500).json({ ok:false, error:'upsert_failed', message: e?.message || String(e) });
        } finally { try { client.release(); } catch (e) {} }
      } else {
        // Fallback without client-level timeout
        try { await pool.query('SET statement_timeout = ' + st); } catch (e) {}
        try {
          const { rows } = await pool.query(
            `insert into public.mod_grabbing_sensorex_domains(domain, sitemap_url, updated_at)
             values($1, $2, now())
             on conflict (domain)
             do update set sitemap_url = coalesce(EXCLUDED.sitemap_url, public.mod_grabbing_sensorex_domains.sitemap_url), updated_at = now()
             returning domain, sitemap_url, sitemaps, selected_sitemaps, sitemap_total_urls, created_at, updated_at`,
            [domain, sitemap_url]
          );
          try { chatLog?.('domain_upsert', { domain }); } catch (e) {}
          return res.json({ ok:true, item: rows[0] });
        } catch (e) {
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) return res.status(503).json({ ok:false, error:'db_timeout' });
          return res.status(500).json({ ok:false, error:'upsert_failed', message: e?.message || String(e) });
        } finally { try { await pool.query('SET statement_timeout = DEFAULT'); } catch (e) {} }
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'upsert_failed', message: e?.message || String(e) }); }
  });

  // Delete domain (avoid ensure; qualify table name; short timeout)
  app.delete('/api/grabbing-sensorex/domains/:domain', async (req, res) => {
    try {
      const domain = normDomain(req.params?.domain);
      if (!domain) return res.status(400).json({ ok:false, error:'bad_request' });
      const st = Math.max(100, Number(process.env.GJ_DOMAINS_TIMEOUT_MS || 5000));
      const client = (typeof pool.connect === 'function') ? await pool.connect() : null;
      if (client) {
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch (e) {}
          const r = await client.query('delete from public.mod_grabbing_sensorex_domains where domain=$1', [domain]);
          await client.query('COMMIT');
          try { chatLog?.('domain_delete', { domain, deleted: Number(r.rowCount||0) }); } catch (e) {}
          return res.json({ ok:true, deleted: Number(r.rowCount||0) });
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch (e) {}
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) return res.status(503).json({ ok:false, error:'db_timeout' });
          return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) });
        } finally { try { client.release(); } catch (e) {} }
      } else {
        try { await pool.query('SET statement_timeout = ' + st); } catch (e) {}
        try {
          const r = await pool.query('delete from public.mod_grabbing_sensorex_domains where domain=$1', [domain]);
          try { chatLog?.('domain_delete', { domain, deleted: Number(r.rowCount||0) }); } catch (e) {}
          return res.json({ ok:true, deleted: Number(r.rowCount||0) });
        } catch (e) {
          const msg = String(e?.message || e).toLowerCase();
          if (e?.code === '57014' || msg.includes('statement timeout')) return res.status(503).json({ ok:false, error:'db_timeout' });
          return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) });
        } finally { try { await pool.query('SET statement_timeout = DEFAULT'); } catch (e) {} }
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_failed', message: e?.message || String(e) }); }
  });

  // Fast count endpoint to verify connectivity without heavy sorting
  app.get('/api/grabbing-sensorex/domains/__count', async (_req, res) => {
    try {
      const st = Math.max(100, Number(process.env.GJ_DOMAINS_TIMEOUT_MS || 5000));
      const client = (typeof pool.connect === 'function') ? await pool.connect() : null;
      if (client) {
        try {
          await client.query('BEGIN');
          try { await client.query('SET LOCAL statement_timeout = ' + st); } catch (e) {}
          const r = await client.query('select count(1) as c from public.mod_grabbing_sensorex_domains');
          await client.query('COMMIT');
          return res.json({ ok:true, count: Number(r.rows?.[0]?.c || 0) });
        } catch (e) { try { await client.query('ROLLBACK'); } catch (e) {}; return res.status(503).json({ ok:false, error:'db_timeout' }); }
        finally { try { client.release(); } catch (e) {} }
      } else {
        const r = await pool.query('select count(1) as c from public.mod_grabbing_sensorex_domains');
        return res.json({ ok:true, count: Number(r.rows?.[0]?.c || 0) });
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'count_failed', message: e?.message || String(e) }); }
  });
}
