export function registerGrabbingJeromeTableSettingsRoutes(app, _ctx, utils = {}) {
  const { pool, normDomain, ensureTableSettingsTable, ensureDomainTypeConfigTable, hasTable, chatLog } = utils;
  const ensureMappingToolsTable = utils?.ensureMappingToolsTable || (async ()=>{});
  if (!pool || typeof pool.query !== 'function') return;

  // List settings rows for a domain+page_type
  app.get('/api/grabbing-jerome/table-settings', async (req, res) => {
    try {
      await ensureTableSettingsTable();
      await ensureDomainTypeConfigTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || 'product').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      // Prefer unified row
      try {
        const rt = await pool.query(`select tables from public.mod_grabbing_jerome_domain_type_config where domain=$1 and lower(page_type)=lower($2)`, [domain, pageType]);
        if (rt.rowCount && rt.rows[0]?.tables) {
          const tbl = rt.rows[0].tables || {};
          const items = [];
          try {
            for (const [name, val] of Object.entries(tbl)) {
              const row = val && typeof val === 'object' ? val : {};
              items.push({ table_name: name, settings: row.settings || null, mapping: row.mapping || null, setting_image: row.setting_image || null });
            }
          } catch {}
          return res.json({ ok:true, items });
        }
      } catch {}
      // Snapshot Smart Settings into history (new version already set by upsert)
      try {
        await ensureDomainTypeConfigTable();
        if (typeof utils.ensureDomainTypeConfigHistoryTable === 'function') await utils.ensureDomainTypeConfigHistoryTable();
        const cur = await pool.query(`select version, config, tables from public.mod_grabbing_jerome_domain_type_config where domain=$1 and lower(page_type)=lower($2)`, [domain, pageType]);
        if (cur.rowCount) {
          const row = cur.rows[0] || {};
          await pool.query(`insert into public.mod_grabbing_jerome_domain_type_config_hist(domain,page_type,version,config,tables,created_at) values ($1,$2,$3,$4::jsonb,$5::jsonb, now())`, [domain, pageType, Number(row.version||1), JSON.stringify(row.config||{}), JSON.stringify(row.tables||{})]);
        }
      } catch {}
      // Fallback to per-table rows
      try {
        const r = await pool.query(`
          SELECT table_name, settings, mapping, setting_image, created_at, updated_at
            FROM public.mod_grabbing_jerome_table_settings
           WHERE domain = $1 AND lower(page_type) = lower($2)
           ORDER BY table_name asc
        `, [domain, pageType]);
        return res.json({ ok:true, items: r.rows || [] });
      } catch (e) {
        // Table removed: return empty list (unified config is the source of truth)
        return res.json({ ok:true, items: [] });
      }
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Batch upsert per-table settings
  app.post('/api/grabbing-jerome/table-settings/batch', async (req, res) => {
    try {
      await ensureTableSettingsTable();
      await ensureDomainTypeConfigTable();
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const domain = normDomain(b.domain);
      const pageType = String(b.page_type || 'product').trim().toLowerCase();
      const tables = (b.tables && typeof b.tables === 'object') ? b.tables : {};
      const versionBump = !!b.version_bump;
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const entries = Object.entries(tables).filter(([k,v]) => v && typeof v === 'object');
      // Update unified row first
      try {
        const cur = await pool.query(`select tables from public.mod_grabbing_jerome_domain_type_config where domain=$1 and lower(page_type)=lower($2)`, [domain, pageType]);
        let base = (cur.rowCount && cur.rows[0]?.tables) ? (cur.rows[0].tables || {}) : {};
        if (typeof base !== 'object' || base === null) base = {};
        for (const [name, val] of entries) {
          const key = String(name);
          const block = val && typeof val === 'object' ? val : {};
          const next = base[key] && typeof base[key] === 'object' ? base[key] : {};
          if (block.settings && typeof block.settings === 'object') next.settings = block.settings;
          if (block.mapping && typeof block.mapping === 'object') next.mapping = block.mapping;
          if (block.setting_image && typeof block.setting_image === 'object') next.setting_image = block.setting_image;
          base[key] = next;
        }
        await pool.query(`
          INSERT INTO public.mod_grabbing_jerome_domain_type_config(domain,page_type,tables,version,created_at,updated_at)
          VALUES ($1,$2,$3::jsonb, 1, now(), now())
          ON CONFLICT (domain,page_type)
          DO UPDATE SET tables=EXCLUDED.tables,
                        version = CASE WHEN $4 THEN COALESCE(public.mod_grabbing_jerome_domain_type_config.version,1)+1 ELSE public.mod_grabbing_jerome_domain_type_config.version END,
                        updated_at=now()
        `, [domain, pageType, JSON.stringify(base), versionBump]);
      } catch {}
      // Mirror into mapping tools latest version (so editor reloads see changes)
      try {
        await ensureMappingToolsTable();
        const rCur = await pool.query(
          `select version, config from public.mod_grabbing_jerome_maping_tools where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc limit 1`,
          [domain, pageType]
        );
        let cfg = (rCur.rowCount && rCur.rows[0]?.config) ? (rCur.rows[0].config || {}) : {};
        if (!cfg || typeof cfg !== 'object') cfg = {};
        if (!cfg.tables || typeof cfg.tables !== 'object') cfg.tables = {};
        for (const [name, val] of entries) {
          const key = String(name);
          const mt = cfg.tables[key] && typeof cfg.tables[key]==='object' ? cfg.tables[key] : {};
          if (val && typeof val==='object') {
            if (val.mapping && typeof val.mapping==='object') {
              if (val.mapping.fields && typeof val.mapping.fields==='object') mt.fields = val.mapping.fields;
              // Promote defaults into table fields as constants and avoid persisting top-level defaults
              if (val.mapping.defaults && typeof val.mapping.defaults==='object') {
                const defs = val.mapping.defaults || {};
                const fields = (mt.fields && typeof mt.fields==='object') ? mt.fields : {};
                for (const [col, defVal] of Object.entries(defs)) {
                  const s = String(defVal);
                  fields[col] = (s === '') ? '' : ('='+s);
                }
                mt.fields = fields;
              }
            }
          }
          cfg.tables[key] = mt;
        }
        // Drop any lingering top-level defaults block completely
        try { if (cfg && Object.prototype.hasOwnProperty.call(cfg, 'defaults')) delete cfg.defaults; } catch {}
        if (rCur.rowCount) {
          const ver = Number(rCur.rows[0].version||1) || 1;
          await pool.query(
            `update public.mod_grabbing_jerome_maping_tools set config=$1::jsonb, updated_at=now() where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($2),'^www\\.','') and lower(page_type)=lower($3) and version=$4`,
            [JSON.stringify(cfg||{}), domain, pageType, ver]
          );
        } else {
          await pool.query(
            `insert into public.mod_grabbing_jerome_maping_tools (domain,page_type,version,name,config,enabled,updated_at) values ($1,$2,1,null,$3::jsonb,true, now())`,
            [domain, pageType, JSON.stringify(cfg||{})]
          );
        }
      } catch {}

      // Maintain legacy per-table rows only if the table still exists
      const hasLegacy = await hasTable('mod_grabbing_jerome_table_settings');
      if (hasLegacy) {
        for (const [name, val] of entries) {
          let settings = null;
          let mapping = null;
          let setting_image = null;
          if (val && typeof val === 'object' && (val.settings || val.mapping)) {
            settings = val.settings || null;
            mapping = val.mapping || null;
            if (val.setting_image && typeof val.setting_image === 'object') setting_image = val.setting_image;
          } else {
            settings = val;
          }
          const jsonSet = settings ? JSON.stringify(settings) : null;
          const jsonMap = mapping ? JSON.stringify(mapping) : null;
          const jsonImg = setting_image ? JSON.stringify(setting_image) : null;
          await pool.query(`
            INSERT INTO public.mod_grabbing_jerome_table_settings(domain, page_type, table_name, settings, mapping, setting_image, created_at, updated_at)
            VALUES ($1,$2,$3, COALESCE($4::jsonb, '{}'::jsonb), $5::jsonb, $6::jsonb, now(), now())
            ON CONFLICT (domain, page_type, table_name)
            DO UPDATE SET
              settings = COALESCE(EXCLUDED.settings, public.mod_grabbing_jerome_table_settings.settings),
              mapping  = COALESCE(EXCLUDED.mapping,  public.mod_grabbing_jerome_table_settings.mapping),
              setting_image = COALESCE(EXCLUDED.setting_image, public.mod_grabbing_jerome_table_settings.setting_image),
              updated_at = now()
          `, [domain, pageType, String(name), jsonSet, jsonMap, jsonImg]);
          try { chatLog?.('table_settings_upsert', { domain, page_type: pageType, table: String(name), has_settings: !!settings, has_mapping: !!mapping }); } catch {}
        }
      }
      return res.json({ ok:true, updated: entries.map(([k])=>k), version_bumped: versionBump });
    } catch (e) { return res.status(500).json({ ok:false, error:'save_failed', message: e?.message || String(e) }); }
  });
}
