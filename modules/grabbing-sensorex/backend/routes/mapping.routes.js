export function registerGrabbingSensorexMappingRoutes(app, _ctx = {}, utils = {}) {
  const pool = utils?.pool;
  const ensureMappingToolsTable = utils?.ensureMappingToolsTable || (async ()=>{});
  const ensureTableSettingsTable = utils?.ensureTableSettingsTable || (async ()=>{});
  const normDomain = utils?.normDomain || ((s)=>String(s||'').toLowerCase().replace(/^www\./,''));
  if (!pool || typeof pool.query !== 'function') return;

  // Normalize a mapping config to a fields-only structure for view/persist
  function fieldsOnlyConfig(cfg) {
    try {
      const out = (cfg && typeof cfg === 'object') ? JSON.parse(JSON.stringify(cfg)) : {};
      // Drop top-level defaults (already promoted elsewhere)
      try { if (out && typeof out === 'object' && out.defaults) delete out.defaults; } catch {}
      out.tables = out.tables && typeof out.tables === 'object' ? out.tables : {};
      for (const [name, block0] of Object.entries(out.tables)) {
        const block = (block0 && typeof block0 === 'object') ? block0 : {};
        const top = (block.fields && typeof block.fields === 'object') ? block.fields : {};
        const nested = (block.mapping && block.mapping.fields && typeof block.mapping.fields === 'object') ? block.mapping.fields : {};
        // Top-level wins on collisions; nested fills gaps
        const merged = Object.keys(top).length ? { ...nested, ...top } : { ...nested };
        // Sanitize legacy empty-constant markers so UI does not show '=' again
        try {
          const cleaned = {};
          for (const [fk, fv] of Object.entries(merged||{})) {
            if (typeof fv === 'string') {
              const s = String(fv);
              cleaned[fk] = (s === '=' || s === '""' || s === "''") ? '' : s;
            } else { cleaned[fk] = fv; }
          }
          block.fields = cleaned;
        } catch { block.fields = merged; }
        // Special case: avoid default_on collisions for product_attribute_shop in persisted/view JSON
        try { if (String(name).toLowerCase() === 'product_attribute_shop') { delete block.fields.default_on; } } catch {}
        // Always remove mapping container after merge (fields-only policy)
        try { if (block.mapping) delete block.mapping; } catch {}
        out.tables[name] = block;
      }
      return out;
    } catch { return cfg || {}; }
  }

  // Ensure image_setting always has a full shape with stable keys
  function withImageSettingDefaults(obj = {}) {
    try {
      const o = (obj && typeof obj === 'object') ? { ...obj } : {};
      if (o.php_bin === undefined) o.php_bin = 'php';
      if (o.bin_console === undefined) o.bin_console = 'php bin/console';
      if (o.download === undefined) o.download = true;
      if (o.generate_thumbs === undefined) o.generate_thumbs = true;
      if (o.cover_strategy === undefined) o.cover_strategy = 'first';
      if (o.console_timeout_ms === undefined) o.console_timeout_ms = 60000;
      if (o.overwrite_existing === undefined) o.overwrite_existing = true;
      if (o.sync_images === undefined) o.sync_images = true;
      // Keep img_root present even when empty
      if (o.img_root === undefined) o.img_root = '';
      // Remote perms defaults (opt-in)
      if (o.remote_set_perms === undefined) o.remote_set_perms = false;
      if (o.remote_owner === undefined) o.remote_owner = '';
      if (o.remote_group === undefined) o.remote_group = '';
      if (o.remote_file_mode === undefined) o.remote_file_mode = '0644';
      if (o.remote_dir_mode === undefined) o.remote_dir_mode = '0755';
      if (o.remote_recursive === undefined) o.remote_recursive = true;
      return o;
    } catch { return { php_bin:'php', bin_console:'php bin/console', download:true, generate_thumbs:true, cover_strategy:'first', console_timeout_ms:60000, overwrite_existing:true, sync_images:true, img_root:'' }; }
  }

  async function tryFillImgRoot(pool, domain, cfg) {
    try {
      if (cfg && cfg.image_setting && typeof cfg.image_setting === 'object') {
        const cur = String(cfg.image_setting.img_root || '').trim();
        if (cur) return cfg; // already set
      }
      const r = await pool.query(`select config_transfert from public.mod_grabbing_sensorex_domains where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') limit 1`, [domain]);
      if (r.rowCount) {
        const ct = r.rows[0]?.config_transfert || {};
        const from = String(ct.img_root || ct.image_root || '').trim();
        if (from) {
          cfg.image_setting = cfg.image_setting && typeof cfg.image_setting==='object' ? cfg.image_setting : {};
          cfg.image_setting.img_root = from;
        }
      }
    } catch {}
    return cfg;
  }

  // List mapping tool versions
  app.get('/api/grabbing-sensorex/mapping/tools', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const limit = Math.min(1000, Math.max(1, Number(req.query?.limit || 50)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const where = [];
      const params = [];
      let i = 1;
      if (domain) { where.push(`regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($${i}),'^www\\.','')`); params.push(domain); i++; }
      if (pageType) { where.push(`lower(page_type) = $${i}`); params.push(pageType); i++; }
      const whereSql = where.length ? 'where '+where.join(' and ') : '';
      const total = await pool.query(`select count(*)::int as c from public.mod_grabbing_sensorex_maping_tools ${whereSql}`, params);
      const items = await pool.query(
        `select id, domain, page_type, version, name, enabled, created_at, updated_at
           from public.mod_grabbing_sensorex_maping_tools
           ${whereSql}
           order by domain asc, page_type asc, version desc, updated_at desc
           limit $${i} offset $${i+1}`,
        [...params, limit, offset]
      );
      return res.json({ ok:true, total: Number(total.rows?.[0]?.c || 0), items: items.rows });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_map_failed', message: e?.message || String(e) }); }
  });

  // Get latest mapping config
  app.get('/api/grabbing-sensorex/mapping/tools/latest', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(
        `select id, domain, page_type, version, name, enabled,
                config, created_at, updated_at
           from public.mod_grabbing_sensorex_maping_tools
          where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
          order by version desc, updated_at desc
          limit 1`,
        [domain, pageType]
      );
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = r.rows[0];
      try {
        if (row && row.config) {
          let cfg = fieldsOnlyConfig(row.config);
          // Ensure flags and image_setting presence in JSON view (config-only)
          try { cfg.flags = cfg.flags && typeof cfg.flags==='object' ? cfg.flags : {}; } catch {}
          try { cfg.image_setting = withImageSettingDefaults((typeof cfg.image_setting === 'object') ? cfg.image_setting : {}); } catch {}
          try { if (!cfg.image_setting?.img_root) cfg = await tryFillImgRoot(pool, domain, cfg); } catch {}
          row.config = cfg;
          // Expose image_setting at top level for UI hydration convenience
          try { row.image_setting = cfg.image_setting; } catch {}
        }
      } catch {}
      return res.json({ ok:true, item: row });
    } catch (e) { return res.status(500).json({ ok:false, error:'get_latest_map_failed', message: e?.message || String(e) }); }
  });

  // Versions-lite (compact listing of versions only)
  app.get('/api/grabbing-sensorex/mapping/tools/versions-lite', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || 'product').trim().toLowerCase();
      const limit = Math.min(1000, Math.max(1, Number(req.query?.limit || 200)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(
        `select version from public.mod_grabbing_sensorex_maping_tools
           where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
           order by version desc, updated_at desc
           limit $3 offset $4`,
        [domain, pageType, limit, offset]
      );
      const items = (r.rows||[]).map(x => ({ version: Number(x.version||0)||0 }));
      return res.json({ ok:true, items });
    } catch (e) { return res.status(500).json({ ok:false, error:'versions_lite_failed', message: e?.message || String(e) }); }
  });

  // Update only image_setting on mapping_tools (latest version, no bump) — config-only
  app.post('/api/grabbing-sensorex/mapping/tools/image-setting', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const domain = normDomain(body.domain);
      const pageType = String(body.page_type||'product').trim().toLowerCase();
      const imageSetting = (body.image_setting && typeof body.image_setting === 'object') ? body.image_setting : {};
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const cur = await pool.query(
        `select id, version from public.mod_grabbing_sensorex_maping_tools
           where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
           order by version desc, updated_at desc limit 1`,
        [domain, pageType]
      );
      if (cur.rowCount) {
        const id = cur.rows[0].id;
        const ver = Number(cur.rows[0].version||1)||1;
        // Update config JSON as top-level image_setting only; remove legacy per-table copy if present
        try {
          const rc = await pool.query(`select config from public.mod_grabbing_sensorex_maping_tools where id=$1`, [id]);
          if (rc.rowCount) {
            let cfg = rc.rows[0].config && typeof rc.rows[0].config==='object' ? rc.rows[0].config : {};
            cfg.image_setting = imageSetting || {};
            try { if (cfg?.tables?.image && typeof cfg.tables.image==='object' && Object.prototype.hasOwnProperty.call(cfg.tables.image,'setting_image')) delete cfg.tables.image.setting_image; } catch {}
            await pool.query(`update public.mod_grabbing_sensorex_maping_tools set config=$1::jsonb, updated_at=now() where id=$2`, [JSON.stringify(cfg||{}), id]);
          }
        } catch {}
        return res.json({ ok:true, updated:true, version: ver });
      } else {
        // Bootstrap config with top-level image_setting only
        const cfg = { image_setting: imageSetting || {} };
        const ins = await pool.query(
          `insert into public.mod_grabbing_sensorex_maping_tools (domain,page_type,version,name,config,enabled,updated_at)
           values ($1,$2,1,$3,$4::jsonb,true,now()) returning version`,
          [domain, pageType, 'init', JSON.stringify(cfg||{})]
        );
        return res.json({ ok:true, inserted:true, version: Number(ins.rows?.[0]?.version||1)||1 });
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'image_setting_save_failed', message: e?.message || String(e) }); }
  });

  // Normalize config: remove nested mapping blocks and promote mapping.fields into fields for one or more versions
  // Body: { domain, page_type, version?: number, all?: boolean }
  app.post('/api/grabbing-sensorex/mapping/tools/normalize', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const b = (req.body && typeof req.body==='object') ? req.body : {};
      const domain = normDomain(b.domain);
      const pageType = String(b.page_type||'product').trim().toLowerCase();
      const version = (b.version != null) ? Number(b.version) : null;
      const doAll = b.all === true || String(b.all||'').toLowerCase()==='1';
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const params = [domain, pageType];
      let where = `where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)`;
      if (!doAll && version && Number.isFinite(version)) { params.push(version); where += ` and version=$${params.length}`; }
      const r = await pool.query(`select id, version, config from public.mod_grabbing_sensorex_maping_tools ${where} order by version desc, updated_at desc`, params);
      let updated = 0;
      for (const row of (r.rows||[])) {
        try {
          let cfg = row.config && typeof row.config==='object' ? row.config : {};
          cfg = fieldsOnlyConfig(cfg);
          // Ensure image_setting stable shape
          try { cfg.image_setting = withImageSettingDefaults((typeof cfg.image_setting === 'object') ? cfg.image_setting : {}); } catch {}
          await pool.query(`update public.mod_grabbing_sensorex_maping_tools set config=$1::jsonb, updated_at=now() where id=$2`, [JSON.stringify(cfg||{}), row.id]);
          updated++;
        } catch {}
      }
      return res.json({ ok:true, updated, total: r.rowCount||0 });
    } catch (e) { return res.status(500).json({ ok:false, error:'normalize_failed', message: e?.message || String(e) }); }
  });

  // Get specific version (accepts version number or 'latest'/'current'/'last'/'newest'/'max')
  app.get('/api/grabbing-sensorex/mapping/tools/get', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const versionRaw = req.query?.version;
      const rawOnly = (String(req.query?.raw||'').toLowerCase() === '1') || (String(req.query?.format||'').toLowerCase() === 'raw');
      let version = Number(versionRaw || 0) || 0;
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      if (!version && typeof versionRaw === 'string') {
        const v = String(versionRaw).trim().toLowerCase();
        if (v === 'latest' || v === 'current' || v === 'last' || v === 'newest' || v === 'max') {
          try {
            const rmax = await pool.query(
              `select max(version)::int as v from public.mod_grabbing_sensorex_maping_tools
                 where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)`,
              [domain, pageType]
            );
            version = Number(rmax.rows?.[0]?.v || 0) || 0;
          } catch (e) { version = 0; }
        }
      }
      if (!version) {
        // Fallback: fetch latest row directly (config-only)
        const rLatest = await pool.query(
          `select id, domain, page_type, version, name, enabled,
                  config, created_at, updated_at
             from public.mod_grabbing_sensorex_maping_tools
            where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
            order by version desc, updated_at desc
            limit 1`,
          [domain, pageType]
        );
        if (!rLatest.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
        const row = rLatest.rows[0];
        try {
          if (row && row.config && !rawOnly) {
            let cfg = fieldsOnlyConfig(row.config);
            try { cfg.flags = cfg.flags && typeof cfg.flags==='object' ? cfg.flags : {}; } catch {}
            try { cfg.image_setting = withImageSettingDefaults((typeof cfg.image_setting === 'object') ? cfg.image_setting : {}); } catch {}
            try { if (!cfg.image_setting?.img_root) cfg = await tryFillImgRoot(pool, domain, cfg); } catch {}
            row.config = cfg;
          }
        } catch {}
        return res.json({ ok:true, item: row });
      }
      const r = await pool.query(
        `select id, domain, page_type, version, name, enabled,
                config, created_at, updated_at
           from public.mod_grabbing_sensorex_maping_tools
          where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3
          limit 1`,
        [domain, pageType, version]
      );
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = r.rows[0];
      try {
        if (row && row.config && !rawOnly) {
          let cfg = fieldsOnlyConfig(row.config);
          try { cfg.flags = cfg.flags && typeof cfg.flags==='object' ? cfg.flags : {}; } catch {}
          try { cfg.image_setting = withImageSettingDefaults((typeof cfg.image_setting === 'object') ? cfg.image_setting : {}); } catch {}
          try { if (!cfg.image_setting?.img_root) cfg = await tryFillImgRoot(pool, domain, cfg); } catch {}
          row.config = cfg;
          try { row.image_setting = cfg.image_setting; } catch {}
        }
      } catch {}
      return res.json({ ok:true, item: row });
    } catch (e) { return res.status(500).json({ ok:false, error:'get_map_failed', message: e?.message || String(e) }); }
  });

  // Explicit latest endpoint (stable alternative to /mapping/tools/latest)
  app.get('/api/grabbing-sensorex/mapping/tools/last', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const rLatest = await pool.query(
        `select id, domain, page_type, version, name, enabled,
                config, created_at, updated_at
           from public.mod_grabbing_sensorex_maping_tools
          where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
          order by version desc, updated_at desc
          limit 1`,
        [domain, pageType]
      );
      if (!rLatest.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const row = rLatest.rows[0];
      try {
        if (row && row.config) {
          let cfg = fieldsOnlyConfig(row.config);
          try { cfg.image_setting = withImageSettingDefaults((typeof cfg.image_setting === 'object') ? cfg.image_setting : {}); } catch {}
          try { if (!cfg.image_setting?.img_root) cfg = await tryFillImgRoot(pool, domain, cfg); } catch {}
          row.config = cfg; try { row.image_setting = cfg.image_setting; } catch {}
        }
      } catch {}
      return res.json({ ok:true, item: row });
    } catch (e) { return res.status(500).json({ ok:false, error:'get_latest_failed', message: e?.message || String(e) }); }
  });

  // Upsert mapping tool (create new version or update existing)
  app.post('/api/grabbing-sensorex/mapping/tools', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      await ensureTableSettingsTable();
      const domain = normDomain(req.body?.domain);
      const pageType = String(req.body?.page_type || '').trim().toLowerCase();
      let version = Number(req.body?.version || 0) || 0;
      const bumpRequested = (req.body?.bump === false || String(req.body?.bump||'').toLowerCase()==='false') ? false : true;
      const name = String(req.body?.name || '').trim() || null;
      const enabled = !!req.body?.enabled;
      const config = (req.body?.config && typeof req.body.config==='object') ? req.body.config : {};
      // Capture fallback image setting sent under tables.image.setting_image (from older UI paths)
      let incomingImageSetting = null;
      try { const si = config?.tables?.image?.setting_image; if (si && typeof si==='object') incomingImageSetting = si; } catch {}
      // Sanitize: never persist per-table image.setting_image; keep top-level image_setting only
      let configSan = config;
      try {
        if (configSan && typeof configSan==='object' && configSan.tables && typeof configSan.tables==='object' && configSan.tables.image && typeof configSan.tables.image==='object' && Object.prototype.hasOwnProperty.call(configSan.tables.image, 'setting_image')) {
          // clone shallow to avoid mutating caller object
          const tables = { ...(configSan.tables||{}) };
          const imageTbl = { ...(tables.image||{}) };
          delete imageTbl.setting_image;
          tables.image = imageTbl;
          configSan = { ...configSan, tables };
        }
      } catch {}
      // Sanitize: merge nested mapping.fields into fields and drop mapping/defaults; drop default_on for product_attribute_shop
      try { configSan = fieldsOnlyConfig(configSan); } catch {}

      // Merge with existing config to preserve globals (flags, image_setting, prefix, profile_id)
      let baseCfg = {};
      let baseRow = null;
      try {
        if (domain && pageType) {
          if (version > 0) {
            const r0 = await pool.query(
              `select id, config
                 from public.mod_grabbing_sensorex_maping_tools
                where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3
                limit 1`,
              [domain, pageType, version]
            );
            if (r0.rowCount) { baseRow = r0.rows[0]; baseCfg = (baseRow.config && typeof baseRow.config==='object') ? baseRow.config : {}; }
          } else {
            const r1 = await pool.query(
              `select id, config
                 from public.mod_grabbing_sensorex_maping_tools
                where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
                order by version desc, updated_at desc
                limit 1`,
              [domain, pageType]
            );
            if (r1.rowCount) { baseRow = r1.rows[0]; baseCfg = (baseRow.config && typeof baseRow.config==='object') ? baseRow.config : {}; }
          }
        }
      } catch {}

      function deepMergeTables(prev = {}, next = {}) {
        const out = { ...(prev||{}) };
        for (const [t, nv] of Object.entries(next||{})) {
          const pv = (out[t] && typeof out[t]==='object') ? out[t] : {};
          const merged = { ...pv, ...nv };
          // Replace semantics for fields: when the client sends fields for a table,
          // treat that set as authoritative and drop keys that are not present.
          try {
            const hasNewFields = nv && typeof nv==='object' && nv.fields && typeof nv.fields==='object';
            if (hasNewFields) {
              merged.fields = { ...nv.fields };
            } else if (pv && typeof pv==='object' && pv.fields && typeof pv.fields==='object') {
              merged.fields = { ...pv.fields };
            }
          } catch {}
          // Settings still merge shallowly (union of keys)
          try {
            const ps = (pv.settings && typeof pv.settings==='object') ? pv.settings : {};
            const ns = (nv.settings && typeof nv.settings==='object') ? nv.settings : {};
            merged.settings = { ...ps, ...ns };
          } catch {}
          out[t] = merged;
        }
        return out;
      }

      let mergedCfg = (() => {
        try {
          const prev = (baseCfg && typeof baseCfg==='object') ? baseCfg : {};
          const next = (configSan && typeof configSan==='object') ? configSan : {};
          const out = { ...prev, ...next };
          out.tables = deepMergeTables(prev.tables, next.tables);
          // Ensure globals always present
          out.flags = (out.flags && typeof out.flags==='object') ? out.flags : {};
          if (typeof out.image_setting !== 'object') out.image_setting = {};
          // If a fallback setting_image was provided in the request, promote it to top-level image_setting
          try { if (incomingImageSetting && typeof incomingImageSetting==='object') out.image_setting = { ...(out.image_setting||{}), ...incomingImageSetting }; } catch {}
          return out;
        } catch { return configSan || {}; }
      })();
      // resolve profile id: prefer explicit top-level, then config.profile_id (no domain fallback)
      let profileId = (req.body?.profile_id != null ? Number(req.body.profile_id)
        : ((mergedCfg && typeof mergedCfg==='object' && mergedCfg.profile_id != null) ? Number(mergedCfg.profile_id) : null));
      // no fallback to domains.config_transfert
      // IMPORTANT: Do not mutate flags/shops/image_setting columns from config when saving mapping tables
      // These columns are owned by dedicated endpoints (save-flags, save-shops, image-setting)
      // Only apply when explicitly provided as top-level fields in the request body
      // Ignore legacy column-backed fields in config-only save
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      let row = null;
      // If caller explicitly disables bumping and no version was provided, update latest instead of inserting
      if (!version && !bumpRequested) {
        try {
          const cur = await pool.query(
            `select version from public.mod_grabbing_sensorex_maping_tools
               where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
               order by version desc, updated_at desc limit 1`,
            [domain, pageType]
          );
          if (cur.rowCount) version = Number(cur.rows[0].version||0)||0;
        } catch {}
      }

      if (!version) {
        const r = await pool.query(
          `insert into public.mod_grabbing_sensorex_maping_tools (domain,page_type,version,name,config,enabled, updated_at)
           values ($1,$2, coalesce((select max(version)+1 from public.mod_grabbing_sensorex_maping_tools where domain=$1 and lower(page_type)=lower($2)),1), $3, $4::jsonb, $5, now())
           returning id, domain, page_type, version, name, enabled, config, created_at, updated_at`,
          [domain, pageType, name, JSON.stringify(mergedCfg||{}), enabled]
        );
        row = r.rows[0];
      } else {
        const upd = await pool.query(
          `update public.mod_grabbing_sensorex_maping_tools
              set name=$1,
                  config=$2::jsonb,
                  enabled=$3,
                  updated_at=now()
            where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($4),'^www\\.','') and lower(page_type)=lower($5) and version=$6
            returning id, domain, page_type, version, name, enabled, config, created_at, updated_at`,
          [name, JSON.stringify(mergedCfg||{}), enabled, domain, pageType, version]
        );
        if (upd.rowCount) row = upd.rows[0];
        else {
          const ins = await pool.query(
            `insert into public.mod_grabbing_sensorex_maping_tools (domain,page_type,version,name,config,enabled, updated_at)
             values ($1,$2,$3,$4,$5::jsonb,$6, now())
             returning id, domain, page_type, version, name, enabled, config, created_at, updated_at`,
          [domain, pageType, version, name, JSON.stringify(mergedCfg||{}), enabled]
          );
          row = ins.rows[0];
        }
      }

      // Associate per-table settings with this mapping (mirror config.tables -> mod_grabbing_sensorex_table_settings)
      try {
        const tables = (configSan && typeof configSan==='object' && configSan.tables && typeof configSan.tables==='object') ? configSan.tables : {};
        const mapId = row?.id || null; const mapVer = row?.version || null;
        try { utils?.chatLog?.('table_settings_mirror_start', { domain, page_type: pageType, version: mapVer, map_id: mapId, tables: Object.keys(tables||{}).length }); } catch (e) {}
        for (const [name, val] of Object.entries(tables)) {
          const tname = String(name||'').trim(); if (!tname) continue;
          const block = val && typeof val==='object' ? val : {};
          const settings = (block.settings && typeof block.settings==='object') ? block.settings : null;
          const mapping = null; // mirror uses fields-only; do not persist nested mapping here
          await pool.query(
            `INSERT INTO public.mod_grabbing_sensorex_table_settings(domain,page_type,table_name,settings,mapping,mapping_tools_id,mapping_version,created_at,updated_at)
             VALUES ($1,$2,$3, COALESCE($4::jsonb, '{}'::jsonb), $5::jsonb, $6, $7, now(), now())
             ON CONFLICT (domain,page_type,table_name)
             DO UPDATE SET settings=COALESCE(EXCLUDED.settings, public.mod_grabbing_sensorex_table_settings.settings),
                           mapping=COALESCE(EXCLUDED.mapping, public.mod_grabbing_sensorex_table_settings.mapping),
                           mapping_tools_id=EXCLUDED.mapping_tools_id,
                           mapping_version=EXCLUDED.mapping_version,
                           updated_at=now()`,
            [domain, pageType, tname, settings ? JSON.stringify(settings) : null, mapping ? JSON.stringify(mapping) : null, mapId, mapVer]
          );
          try { utils?.chatLog?.('table_settings_mirror_row', { domain, page_type: pageType, table: tname, version: mapVer }); } catch (e) {}
        }
        try { utils?.chatLog?.('table_settings_mirror_done', { domain, page_type: pageType, version: mapVer, map_id: mapId }); } catch (e) {}
      } catch (e) {}

      return res.json({ ok:true, item: row });
    } catch (e) { return res.status(500).json({ ok:false, error:'upsert_map_failed', message: e?.message || String(e) }); }
  });

  // Delete a specific version
  app.delete('/api/grabbing-sensorex/mapping/tools', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const id = Number(req.query?.id || req.body?.id || 0);
      const domain = normDomain(req.query?.domain || req.body?.domain);
      const pageType = String(req.query?.page_type || req.body?.page_type || '').trim().toLowerCase();
      const version = Number(req.query?.version || req.body?.version || 0);
      let r;
      if (id) {
        r = await pool.query(`delete from public.mod_grabbing_sensorex_maping_tools where id=$1`, [id]);
      } else if (domain && pageType && version) {
        r = await pool.query(`delete from public.mod_grabbing_sensorex_maping_tools where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3`, [domain, pageType, version]);
      } else {
        return res.status(400).json({ ok:false, error:'bad_request' });
      }
      return res.json({ ok:true, deleted: Number(r?.rowCount||0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_map_failed', message: e?.message || String(e) }); }
  });
}
