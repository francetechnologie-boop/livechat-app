export function registerGrabbingSensorexTableSettingsRoutes(app, _ctx, utils = {}) {
  const { pool, normDomain, ensureTableSettingsTable, hasTable, chatLog } = utils || {};
  const ensureMappingToolsTable = utils?.ensureMappingToolsTable || (async ()=>{});
  if (!pool || typeof pool.query !== 'function') return;

  // Minimal raw-body JSON reader for environments where Content-Type is missing or parser didn't run
  const readRawJson = (req, max = 1024 * 1024) => new Promise((resolve) => {
    try {
      if (req && req.body && typeof req.body === 'object') return resolve(req.body);
      if (!req || typeof req.on !== 'function') return resolve(null);
      let size = 0; const chunks = [];
      req.on('data', (c) => { try { size += c.length; if (size <= max) chunks.push(c); } catch (e) {} });
      req.on('end', () => { try { const s = Buffer.concat(chunks).toString('utf8'); const obj = JSON.parse(s); resolve(obj); } catch (e) { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch (e) { resolve(null); }
  });

  // Avoid blocking saves with a long rebuild
  const withTimeout = (promise, ms = 2500) => Promise.race([
    promise,
    new Promise((_resolve, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);

  // Helper: rebuild mapping_tools.config from current DB state (latest row for domain+pageType)
  // Aligns with mapping/export structure for flags/prefix/globals/tables and persists to config JSON
  async function rebuildAndPersistConfig(domain, pageType) {
    try {
      const d = normDomain(domain); const pt = String(pageType||'product').trim().toLowerCase();
      if (!d || !pt) return;
      await ensureMappingToolsTable();
      await ensureTableSettingsTable();
      // Load latest mapping_tools row
      const r = await pool.query(
        `select id, version, config
           from public.mod_grabbing_sensorex_maping_tools
          where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
          order by version desc, updated_at desc limit 1`,
        [d, pt]
      );
      if (!r.rowCount) return;
      const row = r.rows[0];
      let cfg = row.config && typeof row.config==='object' ? row.config : {};
      // Ensure flags container exists (config-only mode)
      cfg.flags = cfg.flags && typeof cfg.flags==='object' ? cfg.flags : {};
      // Prefix: keep existing; save-connection sets it explicitly
      // No globals/id_shops/id_langs persisted in config (handled per table and by columns)
      try { if (cfg && typeof cfg==='object') { delete cfg.globals; delete cfg.id_shops; delete cfg.id_langs; } } catch {}
      // Image settings: top-level only (config-only)
      try {
        if (cfg?.tables?.image && typeof cfg.tables.image === 'object' && Object.prototype.hasOwnProperty.call(cfg.tables.image, 'setting_image')) {
          // remove legacy per-table copy to avoid inconsistencies
          delete cfg.tables.image.setting_image;
        }
      } catch {}
      // Merge per-table rows from table_settings
      try {
        const trs = await pool.query(
          `select table_name, settings, mapping, columns from public.mod_grabbing_sensorex_table_settings
            where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
            order by table_name asc`,
          [d, pt]
        );
        cfg.tables = cfg.tables && typeof cfg.tables==='object' ? cfg.tables : {};
        // Track fallback shops/langs from table settings when mapping_tools row has none
        let tsetShops = null;
        let tsetLangs = null;
        for (const it of (trs.rows||[])) {
          const tname = String(it.table_name||''); if (!tname) continue;
          const entry = cfg.tables[tname] = cfg.tables[tname] && typeof cfg.tables[tname]==='object' ? cfg.tables[tname] : {};
          // Persist mapping fields/defaults into config.tables[table].fields (editor schema)
          if (it.mapping && typeof it.mapping==='object') {
            const mf = it.mapping.fields && typeof it.mapping.fields==='object' ? it.mapping.fields : {};
            const md = it.mapping.defaults && typeof it.mapping.defaults==='object' ? it.mapping.defaults : {};
            const promoted = Object.fromEntries(Object.entries(md||{}).map(([k,v]) => [k, (String(v)===''? '' : ('='+String(v)))]));
            entry.fields = entry.fields && typeof entry.fields==='object' ? entry.fields : {};
            // Apply explicit field mappings first
            for (const [k,v] of Object.entries(mf)) entry.fields[k] = v;
            // Then allow defaults to override existing path mappings when the default is an explicit constant
            for (const [k,v] of Object.entries(promoted)) {
              const has = Object.prototype.hasOwnProperty.call(entry.fields, k);
              const isConst = typeof v === 'string' && v.startsWith('=');
              const existing = has ? entry.fields[k] : undefined;
              const existingIsPath = typeof existing === 'string' && existing !== '' && !existing.startsWith('=');
              if (!has || (isConst && existingIsPath)) entry.fields[k] = v;
            }
            // Sanitize group tables: do not keep empty constants or legacy markers
            try {
              if (/_group$/i.test(tname) && entry.fields && typeof entry.fields==='object') {
                for (const [ck, cv] of Object.entries({ ...entry.fields })) {
                  const s = (cv == null) ? null : String(cv);
                  if (s === '' || s === '=' || s === '""' || s === "''") delete entry.fields[ck];
                }
              }
            } catch {}
          }
          // Persist table settings (id_shops/id_langs)
          if (it.settings && typeof it.settings==='object') {
            entry.settings = entry.settings && typeof entry.settings==='object' ? entry.settings : {};
            Object.assign(entry.settings, it.settings);
            try {
              if (Array.isArray(it.settings.id_shops) && (!tsetShops || !tsetShops.length)) tsetShops = it.settings.id_shops.slice();
            } catch {}
            try {
              if (Array.isArray(it.settings.id_langs) && (!tsetLangs || !tsetLangs.length)) tsetLangs = it.settings.id_langs.slice();
            } catch {}
          }
          cfg.tables[tname] = entry;
        }
        // After merging table_settings, prefer per-table settings from config (no row-level columns)
        try {
          const shopsFromCfg = (()=>{ try { const a = cfg?.tables?.product_shop?.settings?.id_shops; return Array.isArray(a)? a.map(n=>Number(n)||0).filter(n=>n>0): []; } catch { return []; } })();
          const langsFromCfg = (()=>{ try { const a = cfg?.tables?.product_lang?.settings?.id_langs; return Array.isArray(a)? a.map(n=>Number(n)||0).filter(n=>n>0): []; } catch { return []; } })();
          const ensure = (tname, key, list) => {
            try {
              if (!list || !list.length) return;
              cfg.tables = cfg.tables && typeof cfg.tables==='object' ? cfg.tables : {};
              const blk = cfg.tables[tname] = cfg.tables[tname] && typeof cfg.tables[tname]==='object' ? cfg.tables[tname] : {};
              blk.settings = blk.settings && typeof blk.settings==='object' ? blk.settings : {};
              blk.settings[key] = list.slice();
              cfg.tables[tname] = blk;
            } catch {}
          };
          // Apply shops to common shop-scoped tables
          if (shopsFromCfg.length) {
            for (const t of ['product_shop','image_shop','product_attribute_shop','stock_available','category_shop','product_lang']) ensure(t, 'id_shops', shopsFromCfg);
          }
          // Apply langs to lang tables
          if (langsFromCfg.length) {
            for (const t of ['product_lang','image_lang','attribute_lang','attachment_lang','attribute_group_lang']) ensure(t, 'id_langs', langsFromCfg);
          }
        } catch {}

        // Ensure we do not persist globals or top-level duplicates in config
        try { if (cfg && typeof cfg==='object') { delete cfg.globals; delete cfg.id_shops; delete cfg.id_langs; } } catch {}
        // Inject safe defaults for product_lang when missing or clearly unsafe
        try {
          cfg.tables = cfg.tables && typeof cfg.tables==='object' ? cfg.tables : {};
          const pl = cfg.tables.product_lang = cfg.tables.product_lang && typeof cfg.tables.product_lang==='object' ? cfg.tables.product_lang : {};
          pl.fields = pl.fields && typeof pl.fields==='object' ? pl.fields : {};
          if (!pl.fields.name) pl.fields.name = [ 'product.name', 'title' ];
          const lr = pl.fields.link_rewrite;
          if (!lr || typeof lr !== 'object') {
            pl.fields.link_rewrite = { paths: ['product.slug','product.name'], transforms: [ { op:'trim' }, { op:'slugify' }, { op:'truncate', len:128 } ] };
          }
          const desc = pl.fields.description;
          if (!desc || typeof desc !== 'object') {
            pl.fields.description = { paths: ['sections.product_information','product.description_html'], join: 'html', transforms: [ { op:'truncate', len:60000 } ] };
          }
          const dshort = pl.fields.description_short;
          if (!dshort || typeof dshort !== 'object') {
            pl.fields.description_short = { paths: ['product.description_html'], transforms: [ { op:'strip_html' }, { op:'truncate', len:800 } ] };
          }
        } catch {}
      } catch {}
      await pool.query(`update public.mod_grabbing_sensorex_maping_tools set config=$1::jsonb, updated_at=now() where id=$2`, [JSON.stringify(cfg||{}), row.id]);
    } catch (e) { /* best-effort */ }
  }

  // List settings rows for a domain+page_type
  // Authoritative source: per-table rows in mod_grabbing_sensorex_table_settings.
  // Fallback: derive from mapping_tools.config.tables when rows are absent (first-time projects).
  app.get('/api/grabbing-sensorex/table-settings', async (req, res) => {
    try {
      await ensureTableSettingsTable();
      await ensureMappingToolsTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || 'product').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      // First, try authoritative per-table rows (optionally linked to a mapping tool)
      try {
        const mapToolIdRaw = req.query?.mapping_tool_id;
        const mapToolVerRaw = req.query?.mapping_version;
        const mapToolId = mapToolIdRaw != null ? Number(mapToolIdRaw) : null;
        const mapToolVer = mapToolVerRaw != null ? Number(mapToolVerRaw) : null;
        const where = [
          `regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','')`,
          `lower(page_type) = lower($2)`
        ];
        const params = [domain, pageType];
        let i = 3;
        if (mapToolId && Number.isFinite(mapToolId)) { where.push(`mapping_tools_id = $${i}`); params.push(mapToolId); i++; }
        if (mapToolVer && Number.isFinite(mapToolVer)) { where.push(`mapping_version = $${i}`); params.push(mapToolVer); i++; }
        const sql = `SELECT table_name, settings, mapping, columns, created_at, updated_at
                       FROM public.mod_grabbing_sensorex_table_settings
                      WHERE ${where.join(' AND ')}
                      ORDER BY table_name asc`;
        const r = await pool.query(sql, params);
        if (r.rowCount) return res.json({ ok:true, src: 'table_settings', items: r.rows || [] });
      } catch (_) {}
      // Fallback: derive from mapping_tools latest config
      try {
        const rmt = await pool.query(
          `select config from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc, updated_at desc limit 1`,
          [domain, pageType]
        );
        if (rmt.rowCount && rmt.rows[0]?.config && typeof rmt.rows[0].config === 'object') {
          const tbl = rmt.rowCount ? (rmt.rows[0].config?.tables || {}) : {};
          const items = [];
          for (const [name, val] of Object.entries(tbl||{})) {
            const row = val && typeof val === 'object' ? val : {};
            items.push({ table_name: name, settings: row.settings || null, mapping: row.mapping || null, columns: null });
          }
          return res.json({ ok:true, src: 'mapping_tools', items });
        }
      } catch (e) {}
      return res.json({ ok:true, src: 'empty', items: [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Batch upsert per-table settings: merge into mapping_tools latest (no bump) and mirror to table_settings for compatibility
  app.post('/api/grabbing-sensorex/table-settings/batch', async (req, res) => {
    try {
      await ensureTableSettingsTable();
      await ensureMappingToolsTable();
      let b = (req.body && typeof req.body === 'object') ? req.body : (await readRawJson(req));
      if (!b || typeof b !== 'object') b = {};
      const domain = normDomain(b.domain);
      const pageType = String(b.page_type || 'product').trim().toLowerCase();
      const tables = (b.tables && typeof b.tables === 'object') ? b.tables : {};
      const mapToolId = b.mapping_tool_id != null ? Number(b.mapping_tool_id) : null;
      const mapToolVer = b.mapping_version != null ? Number(b.mapping_version) : null;
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const entries = Object.entries(tables).filter(([k,v]) => v && typeof v === 'object');

      // Load latest mapping config
      let base = {};
      let version = 0;
      try {
        const cur = await pool.query(`select version, config from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc, updated_at desc limit 1`, [domain, pageType]);
        if (cur.rowCount) { version = Number(cur.rows[0].version||1)||1; base = (cur.rows[0].config && typeof cur.rows[0].config==='object') ? cur.rows[0].config : {}; }
      } catch (e) {}
      if (!base || typeof base !== 'object') base = {};
      base.tables = base.tables && typeof base.tables === 'object' ? base.tables : {};
      // Merge entries
      for (const [name, val] of entries) {
        const key = String(name);
        const block = val && typeof val === 'object' ? val : {};
        const next = base.tables[key] && typeof base.tables[key] === 'object' ? base.tables[key] : {};
        if (block.settings && typeof block.settings === 'object') next.settings = block.settings;
        // Do not persist nested mapping in mapping_tools.config (fields-only policy)
        // Image Import Settings live only in mapping_tools; do not keep in table_settings
        base.tables[key] = next;
      }
      // Save into mapping_tools (update latest; insert if none)
      if (version > 0) {
        await pool.query(`update public.mod_grabbing_sensorex_maping_tools set config=$1::jsonb, updated_at=now() where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($2),'^www\\.','') and lower(page_type)=lower($3) and version=$4`, [JSON.stringify(base||{}), domain, pageType, version]);
      } else {
        await pool.query(`insert into public.mod_grabbing_sensorex_maping_tools (domain,page_type,version,name,config,enabled,updated_at) values ($1,$2,1,$3,$4::jsonb,true,now())`, [domain, pageType, 'init', JSON.stringify(base||{})]);
      }

      // Mirror into per-table rows for compatibility (settings/columns only; avoid duplicating mapping)
      try {
        for (const [name, val] of entries) {
          const key = String(name);
          const block = val && typeof val === 'object' ? val : {};
          const settings = (block.settings && typeof block.settings === 'object') ? block.settings : null;
          let columns = null;
          try {
            if (Array.isArray(block.columns)) columns = block.columns;
            else if (block.columns && typeof block.columns === 'object') columns = Object.keys(block.columns||{});
          } catch {}
          await pool.query(
            `INSERT INTO public.mod_grabbing_sensorex_table_settings
               (domain,page_type,table_name,settings,columns,mapping_tools_id,mapping_version,created_at,updated_at)
             VALUES ($1,$2,$3, COALESCE($4::jsonb, '{}'::jsonb), $5::jsonb, $6, $7, now(), now())
             ON CONFLICT (domain,page_type,table_name)
             DO UPDATE SET settings=COALESCE(EXCLUDED.settings, public.mod_grabbing_sensorex_table_settings.settings),
                           columns=COALESCE(EXCLUDED.columns, public.mod_grabbing_sensorex_table_settings.columns),
                           mapping_tools_id=COALESCE(EXCLUDED.mapping_tools_id, public.mod_grabbing_sensorex_table_settings.mapping_tools_id),
                           mapping_version=COALESCE(EXCLUDED.mapping_version, public.mod_grabbing_sensorex_table_settings.mapping_version),
                           updated_at=now()`,
            [
              domain,
              pageType,
              key,
              settings ? JSON.stringify(settings) : null,
              columns ? JSON.stringify(columns) : null,
              (mapToolId && Number.isFinite(mapToolId)) ? mapToolId : null,
              (mapToolVer && Number.isFinite(mapToolVer)) ? mapToolVer : null,
            ]
          );
        }
      } catch (e) {}

      // Optional mirror to legacy table for cross-module compatibility (grabbing-jerome). No mapping duplication.
      try {
        const chk = await pool.query(`SELECT to_regclass('public.mod_grabbing_jerome_table_settings') IS NOT NULL AS ok`);
        const hasJerome = !!(chk.rowCount && chk.rows[0] && chk.rows[0].ok);
        if (hasJerome) {
          for (const [name, val] of entries) {
            const key = String(name);
            const block = val && typeof val === 'object' ? val : {};
            const settings = (block.settings && typeof block.settings === 'object') ? block.settings : null;
            // Only image table may carry setting_image; keep others null
            const setting_image = (key.toLowerCase() === 'image' && block.setting_image && typeof block.setting_image === 'object') ? block.setting_image : null;
            await pool.query(
              `INSERT INTO public.mod_grabbing_jerome_table_settings
                 (domain,page_type,table_name,settings,mapping,setting_image,created_at,updated_at)
               VALUES ($1,$2,$3, COALESCE($4::jsonb, '{}'::jsonb), NULL, $5::jsonb, now(), now())
               ON CONFLICT (domain,page_type,table_name)
               DO UPDATE SET settings=COALESCE(EXCLUDED.settings, public.mod_grabbing_jerome_table_settings.settings),
                             setting_image=COALESCE(EXCLUDED.setting_image, public.mod_grabbing_jerome_table_settings.setting_image),
                             updated_at=now()`,
              [ domain, pageType, key,
                settings ? JSON.stringify(settings) : null,
                setting_image ? JSON.stringify(setting_image) : null ]
            );
          }
        }
      } catch (e) { /* best-effort */ }

      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'batch_failed', message: e?.message || String(e) }); }
  });

  // Sync columns from live Presta schema into table_settings (non-admin)
  // Body: { domain, page_type, profile_id?, prefix?, tables?:[], mapping_tool_id?, mapping_version? }
  app.post('/api/grabbing-sensorex/table-settings/sync-columns', async (req, res) => {
    try {
      await ensureTableSettingsTable();
      await ensureMappingToolsTable();
      const b = (req.body && typeof req.body==='object') ? req.body : {};
      const domain = normDomain(b.domain);
      const pageType = String(b.page_type||'product').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      let tables = Array.isArray(b.tables) ? b.tables.filter(Boolean).map(s=>String(s).trim().toLowerCase()) : null;
      let profileId = b.profile_id != null ? Number(b.profile_id) : null;
      let prefix = (typeof b.prefix==='string' && b.prefix) ? b.prefix : null;
      const mapToolId = b.mapping_tool_id != null ? Number(b.mapping_tool_id) : null;
      const mapToolVer = b.mapping_version != null ? Number(b.mapping_version) : null;

      // Resolve tables from table_settings if not provided
      if (!tables || !tables.length) {
        const where = [
          `regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','')`,
          `lower(page_type) = lower($2)`
        ];
        const params = [domain, pageType];
        let i = 3;
        if (mapToolId && Number.isFinite(mapToolId)) { where.push(`mapping_tools_id = $${i}`); params.push(mapToolId); i++; }
        if (mapToolVer && Number.isFinite(mapToolVer)) { where.push(`mapping_version = $${i}`); params.push(mapToolVer); i++; }
        const sql = `SELECT table_name FROM public.mod_grabbing_sensorex_table_settings WHERE ${where.join(' AND ')} ORDER BY table_name asc`;
        const r = await pool.query(sql, params);
        tables = (r.rows||[]).map(x=>String(x.table_name||'')).filter(Boolean);
      }
      if (!tables || !tables.length) return res.status(200).json({ ok:true, updated:0, tables: [] });

      // Resolve profile_id and prefix if missing
      try {
        if (!profileId) {
          const r = await pool.query(`select (config->>'profile_id')::int as pid from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc, updated_at desc limit 1`, [domain, pageType]);
          if (r.rowCount) profileId = Number(r.rows[0]?.pid||0) || null;
        }
      } catch {}
      if (!prefix) prefix = 'ps_';

      // Call existing schema endpoint to get columns
      const host = (req.get('host') || '127.0.0.1');
      const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
      const base = `${proto}://${host}`;
      const q = new URLSearchParams();
      q.set('domain', domain);
      if (profileId) q.set('profile_id', String(profileId));
      if (prefix) q.set('prefix', String(prefix));
      q.set('tables', tables.join(','));
      let schema = null;
      try {
        const r = await fetch(`${base}/api/grabbing-sensorex/transfer/prestashop/schema?${q.toString()}`, { method:'GET' });
        const ctype = r.headers?.get?.('content-type') || '';
        if (ctype.includes('application/json')) {
          const j = await r.json();
          if (r.ok && j?.ok && j?.schema) schema = j.schema;
        }
      } catch {}
      if (!schema || typeof schema !== 'object') return res.status(500).json({ ok:false, error:'schema_unavailable' });

      // Persist columns into table_settings
      let updated = 0;
      const out = [];
      for (const t of tables) {
        const cols = Array.isArray(schema?.[t]?.columns) ? schema[t].columns : [];
        const names = cols.map(c=>String(c.column_name||'')).filter(Boolean);
        try {
          await pool.query(
            `UPDATE public.mod_grabbing_sensorex_table_settings
                SET columns = $1::jsonb, updated_at=now()
              WHERE regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($2),'^www\\.','')
                AND lower(page_type)=lower($3)
                AND table_name=$4`,
            [JSON.stringify(names||[]), domain, pageType, t]
          );
          updated++;
          out.push({ table_name: t, count: names.length });
        } catch {}
      }
      return res.json({ ok:true, updated, tables: out });
    } catch (e) { return res.status(500).json({ ok:false, error:'sync_columns_failed', message: e?.message || String(e) }); }
  });

  // Remove a single table from table_settings and mapping_tools config (latest)
  // Body: { domain, page_type, table_name, mapping_tool_id?, mapping_version? }
  app.post('/api/grabbing-sensorex/table-settings/remove', async (req, res) => {
    try {
      await ensureTableSettingsTable();
      await ensureMappingToolsTable();
      const b = (req.body && typeof req.body==='object') ? req.body : {};
      const domain = normDomain(b.domain);
      const pageType = String(b.page_type||'product').trim().toLowerCase();
      const tableName = String(b.table_name||'').trim().toLowerCase();
      if (!domain || !pageType || !tableName) return res.status(400).json({ ok:false, error:'bad_request' });

      // Delete from table_settings (regardless of mapping association)
      try {
        await pool.query(
          `DELETE FROM public.mod_grabbing_sensorex_table_settings
            WHERE regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','')
              AND lower(page_type)=lower($2)
              AND lower(table_name)=lower($3)`,
          [domain, pageType, tableName]
        );
      } catch {}

      // Remove from latest mapping_tools config to keep sources in sync
      try {
        const cur = await pool.query(
          `select id, version, config from public.mod_grabbing_sensorex_maping_tools
             where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
             order by version desc, updated_at desc limit 1`,
          [domain, pageType]
        );
        if (cur.rowCount && cur.rows[0] && cur.rows[0].config && typeof cur.rows[0].config === 'object') {
          const cfg = cur.rows[0].config || {};
          const tbl = cfg.tables && typeof cfg.tables==='object' ? cfg.tables : {};
          if (tbl && Object.prototype.hasOwnProperty.call(tbl, tableName)) {
            delete tbl[tableName];
            cfg.tables = tbl;
            await pool.query(`update public.mod_grabbing_sensorex_maping_tools set config=$1::jsonb, updated_at=now() where id=$2`, [JSON.stringify(cfg||{}), cur.rows[0].id]);
          }
        }
      } catch {}

      return res.json({ ok:true, removed: tableName });
    } catch (e) {
      return res.status(500).json({ ok:false, error:'remove_failed', message: e?.message || String(e) });
    }
  });

  // Global settings: read from mapping_tools latest (profile, prefix, flags, shops, langs)
  app.get('/api/grabbing-sensorex/settings/global', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type||'product').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(
        `select version, config
           from public.mod_grabbing_sensorex_maping_tools
          where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
          order by version desc, updated_at desc
          limit 1`,
        [domain, pageType]
      );
      if (!r.rowCount) return res.json({ ok:true, item: null });
      const row = r.rows[0] || {};
      const cfg = row.config || {};
      const item = {
        version: Number(row.version||0)||0,
        profile_id: (cfg && typeof cfg==='object' && cfg.profile_id!=null) ? Number(cfg.profile_id) : null,
        prefix: (cfg && typeof cfg==='object' && cfg.prefix!=null) ? String(cfg.prefix) : null,
        unified_dynamic: (cfg.flags && typeof cfg.flags.unified_dynamic==='boolean') ? cfg.flags.unified_dynamic : null,
        strict_mapping_only: (cfg.flags && typeof cfg.flags.strict_mapping_only==='boolean') ? cfg.flags.strict_mapping_only : null,
        force_min_combination: (cfg.flags && typeof cfg.flags.force_min_combination==='boolean') ? cfg.flags.force_min_combination : null,
        keep_symbols: (cfg.flags && typeof cfg.flags.keep_symbols==='boolean') ? cfg.flags.keep_symbols : null,
        id_shops: (cfg?.tables?.product_shop?.settings?.id_shops||null),
        id_langs: (cfg?.tables?.product_lang?.settings?.id_langs||null),
        // Groups are stored inside config only; expose top-level id_groups or category_group.settings.id_groups
        id_groups: (function(){
          try {
            const fromTop = Array.isArray(cfg?.id_groups) ? cfg.id_groups : null;
            if (fromTop && fromTop.length) return fromTop;
          } catch {}
          try {
            const fromTbl = cfg?.tables?.category_group?.settings?.id_groups;
            if (Array.isArray(fromTbl) && fromTbl.length) return fromTbl;
          } catch {}
          return null;
        })()
      };
      return res.json({ ok:true, item });
    } catch (e) { return res.status(500).json({ ok:false, error:'settings_read_failed', message: e?.message || String(e) }); }
  });

  // Save global settings into mapping_tools latest (no bump)
  app.post('/api/grabbing-sensorex/settings/save-global', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      let b = (req.body && typeof req.body==='object') ? req.body : (await readRawJson(req));
      if (!b || typeof b !== 'object') b = {};
      const domain = normDomain(b.domain);
      const pageType = String(b.page_type||'product').trim().toLowerCase();
      const cfg = (b.config && typeof b.config==='object') ? b.config : {};
      const profileId = (b.db_mysql_profile_id!=null)? Number(b.db_mysql_profile_id) : null;
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      // Derive dedicated columns
      let unified_dynamic = null, strict_mapping_only = null, force_min_combination = null, id_shops = null, id_langs = null;
      try {
        if (cfg && typeof cfg==='object') {
          if (cfg.flags && typeof cfg.flags==='object') {
            if (typeof cfg.flags.unified_dynamic === 'boolean') unified_dynamic = !!cfg.flags.unified_dynamic;
            if (typeof cfg.flags.strict_mapping_only === 'boolean') strict_mapping_only = !!cfg.flags.strict_mapping_only;
            if (typeof cfg.flags.force_min_combination === 'boolean') force_min_combination = !!cfg.flags.force_min_combination;
          }
          const shops = cfg?.tables?.product_shop?.settings?.id_shops;
          if (Array.isArray(shops)) id_shops = shops.filter(n=>Number(n)>0);
          const langs = cfg?.tables?.product_lang?.settings?.id_langs;
          if (Array.isArray(langs)) id_langs = langs.filter(n=>Number(n)>0);
        }
      } catch (e) {}
      // Also honor direct body fields if provided (more robust from UI)
      try { if (Array.isArray(b.id_shops) && b.id_shops.length) id_shops = b.id_shops.map(n=>Number(n)||0).filter(n=>n>0); } catch {}
      try { if (Array.isArray(b.id_langs) && b.id_langs.length) id_langs = b.id_langs.map(n=>Number(n)||0).filter(n=>n>0); } catch {}
      try { if (typeof b.force_min_combination === 'boolean') force_min_combination = !!b.force_min_combination; } catch {}
      const cur = await pool.query(
        `select id, version, config from public.mod_grabbing_sensorex_maping_tools
           where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
           order by version desc, updated_at desc limit 1`,
        [domain, pageType]
      );
      // Merge incoming cfg with existing config to avoid wiping unrelated fields
      let mergedCfg = cfg;
      try {
        const prev = cur.rowCount ? (cur.rows[0]?.config || {}) : {};
        const prevTables = prev && typeof prev==='object' && prev.tables && typeof prev.tables==='object' ? prev.tables : {};
        const nextTables = cfg && typeof cfg==='object' && cfg.tables && typeof cfg.tables==='object' ? cfg.tables : {};
        const tables = { ...prevTables };
        for (const [k, v] of Object.entries(nextTables)) {
          if (!v || typeof v !== 'object') { tables[k] = v; continue; }
          const pv = prevTables[k] && typeof prevTables[k]==='object' ? prevTables[k] : {};
          const ps = pv.settings && typeof pv.settings==='object' ? pv.settings : {};
          const ns = v.settings && typeof v.settings==='object' ? v.settings : {};
          tables[k] = { ...pv, ...v, settings: { ...ps, ...ns } };
        }
        const prevFlags = prev && typeof prev==='object' && prev.flags && typeof prev.flags==='object' ? prev.flags : {};
        const nextFlags = cfg && typeof cfg==='object' && cfg.flags && typeof cfg.flags==='object' ? cfg.flags : {};
        const flags = { ...prevFlags, ...nextFlags };
        mergedCfg = { ...prev, ...cfg, tables, flags };
      } catch {}
      // Sanitize: never persist per-table image.setting_image; we keep top-level image_setting only
      try { if (mergedCfg?.tables?.image && typeof mergedCfg.tables.image==='object' && Object.prototype.hasOwnProperty.call(mergedCfg.tables.image,'setting_image')) delete mergedCfg.tables.image.setting_image; } catch {}
      // Only update config when caller provided one; else leave it as-is
      const configParam = (b.config && typeof b.config==='object' && Object.keys(b.config||{}).length>0)
        ? JSON.stringify(mergedCfg||{})
        : null;
      const shopsParam = (Array.isArray(id_shops) && id_shops.length) ? id_shops : null;
      const langsParam = (Array.isArray(id_langs) && id_langs.length) ? id_langs : null;

      if (cur.rowCount) {
        await pool.query(
          `update public.mod_grabbing_sensorex_maping_tools
              set config=COALESCE($1::jsonb, config),
                  updated_at=now()
            where id=$2`,
          [configParam, cur.rows[0].id]
        );
      } else {
        await pool.query(
          `insert into public.mod_grabbing_sensorex_maping_tools (domain,page_type,version,name,config,enabled,updated_at)
           values ($1,$2,1,$3,$4::jsonb,true, now())`,
          [domain, pageType, 'init', JSON.stringify(mergedCfg||{})]
        );
      }
      // Rebuild and persist normalized config (with short timeout so save doesn't hang)
      try { await withTimeout(rebuildAndPersistConfig(domain, pageType), 2500); } catch {}
      return res.json({ ok:true });
    } catch (e) { return res.status(500).json({ ok:false, error:'settings_save_failed', message: e?.message || String(e) }); }
  });

  // Save connection info (profile_id) and optionally prefix only
  // Body: { domain, page_type, db_mysql_profile_id?, prefix? }
  app.post('/api/grabbing-sensorex/settings/save-connection', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      let b = (req.body && typeof req.body==='object') ? req.body : (await readRawJson(req));
      if (!b || typeof b !== 'object') b = {};
      const domain = normDomain(b.domain);
      const pageType = String(b.page_type||'product').trim().toLowerCase();
      const profileId = (b.db_mysql_profile_id!=null)? Number(b.db_mysql_profile_id) : null;
      const prefix = (typeof b.prefix==='string' && b.prefix.trim().length) ? String(b.prefix) : null;
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });

      // Fetch a specific version when provided; otherwise latest
      const targetVersion = (b.version != null) ? Number(b.version) : null;
      let cur;
      if (targetVersion && Number.isFinite(targetVersion)) {
        cur = await pool.query(
          `select id, version, config from public.mod_grabbing_sensorex_maping_tools
             where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3
             limit 1`,
          [domain, pageType, targetVersion]
        );
      } else {
        cur = await pool.query(
          `select id, version, config from public.mod_grabbing_sensorex_maping_tools
             where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
             order by version desc, updated_at desc limit 1`,
          [domain, pageType]
        );
      }
      if (cur.rowCount) {
        // Merge prefix into existing config only when provided
        let cfg = cur.rows[0].config || {};
        if (prefix) {
          try { cfg = { ...(cfg||{}), prefix }; } catch {}
        } else {
          // keep cfg as-is
        }
        // Reflect profile id in config for convenience (config-only)
        try { if (profileId != null) cfg = { ...(cfg||{}), profile_id: Number(profileId) }; } catch {}
        await pool.query(
          `update public.mod_grabbing_sensorex_maping_tools
              set config=$1::jsonb,
                  updated_at=now()
            where id=$2`,
          [JSON.stringify(cfg||{}), cur.rows[0].id]
        );
        // Rebuild full config (short timeout)
        try { await withTimeout(rebuildAndPersistConfig(domain, pageType), 2500); } catch {}
      } else {
        // Create a bootstrap row with provided values
        const cfg = prefix ? { prefix } : {};
        await pool.query(
          `insert into public.mod_grabbing_sensorex_maping_tools (domain,page_type,version,name,config,enabled, updated_at)
           values ($1,$2,1,$3,$4::jsonb,true, now())`,
          [domain, pageType, 'init', JSON.stringify(cfg||{})]
        );
        try { await withTimeout(rebuildAndPersistConfig(domain, pageType), 2500); } catch {}
      }
      return res.json({ ok:true, saved: { db_mysql_profile_id: (profileId!=null? profileId: undefined), prefix: prefix || undefined } });
    } catch (e) { return res.status(500).json({ ok:false, error:'save_connection_failed', message: e?.message || String(e) }); }
  });

  // Save shops/langs only (no flags/prefix/config side-effects)
  // Body: { domain, page_type, id_shops?: int[], id_langs?: int[], mapping_version?: number }
  app.post('/api/grabbing-sensorex/settings/save-shops', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      let b = (req.body && typeof req.body==='object') ? req.body : (await readRawJson(req));
      if (!b || typeof b !== 'object') b = {};
      const domain = normDomain(b.domain);
      const pageType = String(b.page_type||'product').trim().toLowerCase();
      let id_shops = Array.isArray(b.id_shops) ? b.id_shops.map(n=>Number(n)||0).filter(n=>n>0) : null;
      let id_langs = Array.isArray(b.id_langs) ? b.id_langs.map(n=>Number(n)||0).filter(n=>n>0) : null;
      const mapVer = (b.mapping_version != null) ? Number(b.mapping_version) : null;
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      let cur;
      if (mapVer && Number.isFinite(mapVer)) {
        cur = await pool.query(
          `select id, version from public.mod_grabbing_sensorex_maping_tools
             where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3
             limit 1`,
          [domain, pageType, mapVer]
        );
      } else {
        cur = await pool.query(
          `select id, version from public.mod_grabbing_sensorex_maping_tools
             where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
             order by version desc, updated_at desc limit 1`,
          [domain, pageType]
        );
      }
      const shopsParam = (Array.isArray(id_shops) && id_shops.length) ? id_shops : null;
      const langsParam = (Array.isArray(id_langs) && id_langs.length) ? id_langs : null;
      if (cur.rowCount) {
        // Reflect into config JSON (tables.product_shop.settings.id_shops, tables.product_lang.settings.id_langs)
        try {
          const rCfg = await pool.query(`select id, config from public.mod_grabbing_sensorex_maping_tools where id=$1 limit 1`, [cur.rows[0].id]);
          if (rCfg.rowCount) {
            let cfg = rCfg.rows[0].config && typeof rCfg.rows[0].config==='object' ? rCfg.rows[0].config : {};
            try { cfg.tables = cfg.tables && typeof cfg.tables==='object' ? cfg.tables : {}; } catch {}
            // id_shops → product_shop
            if (shopsParam) {
              const ps = cfg.tables.product_shop = cfg.tables.product_shop && typeof cfg.tables.product_shop==='object' ? cfg.tables.product_shop : {};
              ps.settings = ps.settings && typeof ps.settings==='object' ? ps.settings : {};
              ps.settings.id_shops = shopsParam.slice();
              // propagate to other shop-scoped tables commonly used by the pipeline
              const shopTables = ['image_shop','product_attribute_shop','stock_available','category_shop','product_lang'];
              for (const t of shopTables) {
                try {
                  const blk = cfg.tables[t] = cfg.tables[t] && typeof cfg.tables[t]==='object' ? cfg.tables[t] : {};
                  blk.settings = blk.settings && typeof blk.settings==='object' ? blk.settings : {};
                  blk.settings.id_shops = shopsParam.slice();
                } catch {}
              }
            }
            // id_langs → product_lang
            if (langsParam) {
              const pl = cfg.tables.product_lang = cfg.tables.product_lang && typeof cfg.tables.product_lang==='object' ? cfg.tables.product_lang : {};
              pl.settings = pl.settings && typeof pl.settings==='object' ? pl.settings : {};
              pl.settings.id_langs = langsParam.slice();
            }
            // Do not persist global id_shops/id_langs in config; keep per-table settings only
            try { if (cfg && typeof cfg==='object') { delete cfg.globals; delete cfg.id_shops; delete cfg.id_langs; } } catch {}
            await pool.query(`update public.mod_grabbing_sensorex_maping_tools set config=$1::jsonb, updated_at=now() where id=$2`, [JSON.stringify(cfg||{}), cur.rows[0].id]);
          }
        } catch {}
      } else {
        await pool.query(
          `insert into public.mod_grabbing_sensorex_maping_tools (domain,page_type,version,name,config,enabled, updated_at)
           values ($1,$2,1,$3,$4::jsonb,true, now())`,
          [domain, pageType, 'init', JSON.stringify({})]
        );
      }
      // Also mirror into table_settings.settings for tables that have id_shop/id_lang columns
      try {
        // id_shops
        if (shopsParam && Array.isArray(shopsParam) && shopsParam.length) {
          await pool.query(
            `UPDATE public.mod_grabbing_sensorex_table_settings
                SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{id_shops}', to_jsonb($1::int[]), true),
                    updated_at = now()
              WHERE regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($2),'^www\\.','')
                AND lower(page_type)=lower($3)
                AND (columns @> '["id_shop"]'::jsonb OR lower(table_name) LIKE '%_shop')`,
            [shopsParam, domain, pageType]
          );
          // ensure rows exist for common shop-scoped tables when missing
          const ensureShopTables = ['product_shop','image_shop','product_attribute_shop','stock_available','category_shop','product_lang'];
          for (const t of ensureShopTables) {
            try {
              await pool.query(
                `INSERT INTO public.mod_grabbing_sensorex_table_settings
                   (domain,page_type,table_name,settings,mapping,columns,mapping_tools_id,mapping_version,created_at,updated_at)
                 VALUES ($1,$2,$3, jsonb_build_object('id_shops', to_jsonb($4::int[])), NULL, NULL, $5, $6, now(), now())
                 ON CONFLICT (domain,page_type,table_name)
                 DO UPDATE SET settings = jsonb_set(COALESCE(public.mod_grabbing_sensorex_table_settings.settings, '{}'::jsonb), '{id_shops}', to_jsonb($4::int[]), true),
                               mapping_tools_id = COALESCE(EXCLUDED.mapping_tools_id, public.mod_grabbing_sensorex_table_settings.mapping_tools_id),
                               mapping_version = COALESCE(EXCLUDED.mapping_version, public.mod_grabbing_sensorex_table_settings.mapping_version),
                               updated_at = now()`,
                [domain, pageType, t, shopsParam, (cur.rows?.[0]?.id || null), (cur.rows?.[0]?.version || null)]
              );
            } catch {}
          }
        }
        // id_langs
        if (langsParam && Array.isArray(langsParam) && langsParam.length) {
          await pool.query(
            `UPDATE public.mod_grabbing_sensorex_table_settings
                SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{id_langs}', to_jsonb($1::int[]), true),
                    updated_at = now()
              WHERE regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($2),'^www\\.','')
                AND lower(page_type)=lower($3)
                AND (columns @> '["id_lang"]'::jsonb OR lower(table_name) LIKE '%_lang')`,
            [langsParam, domain, pageType]
          );
        }
      } catch (e) { /* mirror best-effort */ }
      try { await withTimeout(rebuildAndPersistConfig(domain, pageType), 2500); } catch {}
      return res.json({ ok:true, saved: { id_shops: shopsParam||undefined, id_langs: langsParam||undefined } });
    } catch (e) { return res.status(500).json({ ok:false, error:'save_shops_failed', message: e?.message || String(e) }); }
  });

  // Save behavior flags only (no prefix/config/shops/langs)
  // Body: { domain, page_type, unified_dynamic?: boolean, strict_mapping_only?: boolean, force_min_combination?: boolean }
  app.post('/api/grabbing-sensorex/settings/save-flags', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      let b = (req.body && typeof req.body==='object') ? req.body : (await readRawJson(req));
      if (!b || typeof b !== 'object') b = {};
      const domain = normDomain(b.domain);
      const pageType = String(b.page_type||'product').trim().toLowerCase();
      const u = (typeof b.unified_dynamic === 'boolean') ? !!b.unified_dynamic : null;
      const s = (typeof b.strict_mapping_only === 'boolean') ? !!b.strict_mapping_only : null;
      const f = (typeof b.force_min_combination === 'boolean') ? !!b.force_min_combination : null;
      const k = (typeof b.keep_symbols === 'boolean') ? !!b.keep_symbols : null;
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const cur = await pool.query(
        `select id, config from public.mod_grabbing_sensorex_maping_tools
           where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
           order by version desc, updated_at desc limit 1`,
       [domain, pageType]
     );
      const uParam = (u===null) ? null : u;
      const sParam = (s===null) ? null : s;
      const fParam = (f===null) ? null : f;
      const kParam = (k===null) ? null : k;
      if (cur.rowCount) {
        let cfg = cur.rows[0].config && typeof cur.rows[0].config==='object' ? cur.rows[0].config : {};
        cfg.flags = cfg.flags && typeof cfg.flags==='object' ? cfg.flags : {};
        if (uParam !== null) cfg.flags.unified_dynamic = !!uParam;
        if (sParam !== null) cfg.flags.strict_mapping_only = !!sParam;
        if (fParam !== null) cfg.flags.force_min_combination = !!fParam;
        if (kParam !== null) cfg.flags.keep_symbols = !!kParam;
        await pool.query(`update public.mod_grabbing_sensorex_maping_tools set config=$1::jsonb, updated_at=now() where id=$2`, [JSON.stringify(cfg||{}), cur.rows[0].id]);
      } else {
        const cfg = { flags: {} };
        if (uParam !== null) cfg.flags.unified_dynamic = !!uParam;
        if (sParam !== null) cfg.flags.strict_mapping_only = !!sParam;
        if (fParam !== null) cfg.flags.force_min_combination = !!fParam;
        if (kParam !== null) cfg.flags.keep_symbols = !!kParam;
        await pool.query(`insert into public.mod_grabbing_sensorex_maping_tools (domain,page_type,version,name,config,enabled, updated_at) values ($1,$2,1,$3,$4::jsonb,true, now())`, [domain, pageType, 'init', JSON.stringify(cfg)]);
      }
      try { await rebuildAndPersistConfig(domain, pageType); } catch {}
      return res.json({ ok:true, saved: { unified_dynamic: uParam, strict_mapping_only: sParam, force_min_combination: fParam, keep_symbols: kParam } });
    } catch (e) { return res.status(500).json({ ok:false, error:'save_flags_failed', message: e?.message || String(e) }); }
  });

  // Export consolidated mapping JSON reflecting DB state (mapping_tools + table_settings)
  // GET /api/grabbing-sensorex/mapping/export?domain=&page_type=&mapping_version=&mapping_tool_id=
  app.get('/api/grabbing-sensorex/mapping/export', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      await ensureTableSettingsTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type||'product').trim().toLowerCase();
      const mapToolId = req.query?.mapping_tool_id != null ? Number(req.query.mapping_tool_id) : null;
      let mapVer = req.query?.mapping_version != null ? Number(req.query.mapping_version) : null;
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });

      // Load base mapping config from mapping_tools (prefer specific id/version)
      let cfg = {}; let version = 0; let row = null;
      if (mapToolId && Number.isFinite(mapToolId)) {
        const r = await pool.query(`select id, version, config from public.mod_grabbing_sensorex_maping_tools where id=$1 limit 1`, [mapToolId]);
        if (r.rowCount) { row = r.rows[0]; cfg = (row.config && typeof row.config==='object') ? row.config : {}; version = Number(row.version||0)||0; }
      }
      if (!row) {
        let r2;
        if (mapVer && Number.isFinite(mapVer)) {
          r2 = await pool.query(`select id, version, config from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3 order by updated_at desc limit 1`, [domain, pageType, mapVer]);
        } else {
          r2 = await pool.query(`select id, version, config from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc, updated_at desc limit 1`, [domain, pageType]);
        }
        if (r2.rowCount) { row = r2.rows[0]; cfg = (row.config && typeof row.config==='object') ? row.config : {}; version = Number(row.version||0)||0; }
      }
      const out = { ...(cfg||{}) };
      // Flags: keep exactly from config.flags (no column merges)
      try { out.flags = (out.flags && typeof out.flags==='object') ? out.flags : {}; } catch {}
      // Carry prefix and profile for transparency (from config only)
      try { if (!out.prefix && cfg && typeof cfg==='object' && cfg.prefix) out.prefix = String(cfg.prefix); } catch {}
      try { if (cfg && typeof cfg==='object' && cfg.profile_id != null) out.profile_id = Number(cfg.profile_id)||0; } catch {}
      // Expose globals for shops/langs from config tables (if present)
      try {
        out.globals = (out.globals && typeof out.globals==='object') ? out.globals : {};
        const shops = cfg?.tables?.product_shop?.settings?.id_shops;
        const langs = cfg?.tables?.product_lang?.settings?.id_langs;
        if (Array.isArray(shops)) out.globals.id_shops = shops.slice();
        if (Array.isArray(langs)) out.globals.id_langs = langs.slice();
      } catch {}
      // Image import settings from config only
      try { if (cfg && cfg.image_setting && typeof cfg.image_setting === 'object') out.image_setting = cfg.image_setting; } catch {}
      // Merge shops/langs into config tables if not present
      try {
        out.tables = out.tables && typeof out.tables==='object' ? out.tables : {};
        // No row-level fallback for shops/langs; keep what config already has (and table_settings may enrich below)
      } catch {}

      // Merge per-table overrides from table_settings
      const where = [
        `regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','')`,
        `lower(page_type) = lower($2)`
      ];
      const params = [domain, pageType];
      let i = 3;
      if (mapToolId && Number.isFinite(mapToolId)) { where.push(`mapping_tools_id = $${i}`); params.push(mapToolId); i++; }
      if (version && Number.isFinite(version)) { where.push(`(mapping_version IS NULL OR mapping_version = $${i})`); params.push(version); i++; }
      const rts = await pool.query(`select table_name, settings, mapping, columns from public.mod_grabbing_sensorex_table_settings where ${where.join(' AND ')} order by table_name asc`, params);
      out.tables = out.tables && typeof out.tables==='object' ? out.tables : {};
      for (const r of rts.rows || []) {
        const tname = String(r.table_name||'').trim(); if (!tname) continue;
        const t = out.tables[tname] = out.tables[tname] && typeof out.tables[tname]==='object' ? out.tables[tname] : {};
        // Do not attach nested mapping; fields-only policy
        try { if (!t.settings || typeof t.settings!=='object') t.settings = {}; } catch {}
        if (r.settings && typeof r.settings==='object') { Object.assign(t.settings, r.settings); }
        try { if (Array.isArray(r.columns)) t.columns = r.columns.slice(); } catch {}
      }
      // Enforce per-table id_shops / id_langs from latest globals (columns) for shop/lang tables
      try {
        const shops = Array.isArray(row?.id_shops) ? row.id_shops : null;
        const langs = Array.isArray(row?.id_langs) ? row.id_langs : null;
        for (const [tbl, conf] of Object.entries(out.tables||{})) {
          if (!conf || typeof conf !== 'object') continue;
          const cols = Array.isArray(conf.columns) ? conf.columns.map(c => String(c||'').toLowerCase()) : [];
          const looksShop = cols.includes('id_shop') || /_shop$/.test(tbl);
          const looksLang = cols.includes('id_lang') || /_lang$/.test(tbl);
          conf.settings = conf.settings && typeof conf.settings==='object' ? conf.settings : {};
          if (looksShop && shops && shops.length) conf.settings.id_shops = shops;
          if (looksLang && langs && langs.length) conf.settings.id_langs = langs;
        }
      } catch {}
      return res.json({ ok:true, version, mapping: out, src: 'table_settings' });
    } catch (e) { return res.status(500).json({ ok:false, error:'export_mapping_failed', message: e?.message || String(e) }); }
  });

  // Admin/dev: Rebuild and persist config JSON from current DB state
  // GET /api/grabbing-sensorex/settings/rebuild-config?domain=&page_type=
  app.get('/api/grabbing-sensorex/settings/rebuild-config', async (req, res) => {
    try {
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type||'product').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      // Attempt rebuild with a short timeout so this endpoint never hangs
      const withTimeout = (p, ms=2500) => Promise.race([
        p,
        new Promise((_resolve, reject) => setTimeout(()=>reject(new Error('timeout')), ms))
      ]);
      let rebuilt = false;
      try { await withTimeout(rebuildAndPersistConfig(domain, pageType), 2500); rebuilt = true; } catch (_) { rebuilt = false; }
      const r = await pool.query(
        `select id, version, config from public.mod_grabbing_sensorex_maping_tools
           where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
           order by version desc, updated_at desc limit 1`,
       [domain, pageType]
     );
      const item = r.rowCount ? r.rows[0] : null;
      return res.json({ ok:true, item, rebuilt });
    } catch (e) { return res.status(500).json({ ok:false, error:'rebuild_failed', message: e?.message || String(e) }); }
  });
  // POST body: { domain, page_type }
  app.post('/api/grabbing-sensorex/settings/rebuild-config', async (req, res) => {
    try {
      const body = (req.body && typeof req.body==='object') ? req.body : (await (async()=>{ try { return await readRawJson(req); } catch { return null; } })());
      const domain = normDomain(body?.domain);
      const pageType = String(body?.page_type||'product').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const withTimeout = (p, ms=2500) => Promise.race([
        p,
        new Promise((_resolve, reject) => setTimeout(()=>reject(new Error('timeout')), ms))
      ]);
      let rebuilt = false;
      try { await withTimeout(rebuildAndPersistConfig(domain, pageType), 2500); rebuilt = true; } catch (_) { rebuilt = false; }
      const r = await pool.query(
        `select id, version, config from public.mod_grabbing_sensorex_maping_tools
           where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
           order by version desc, updated_at desc limit 1`,
        [domain, pageType]
      );
      const item = r.rowCount ? r.rows[0] : null;
      return res.json({ ok:true, item, rebuilt });
    } catch (e) { return res.status(500).json({ ok:false, error:'rebuild_failed', message: e?.message || String(e) }); }
  });
}
