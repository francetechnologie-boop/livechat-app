export function registerGrabbingJeromeMappingRoutes(app, _ctx = {}, utils = {}) {
  const pool = utils?.pool;
  const ensureMappingToolsTable = utils?.ensureMappingToolsTable || (async ()=>{});
  const normDomain = utils?.normDomain || ((s)=>String(s||'').toLowerCase().replace(/^www\./,''));
  if (!pool || typeof pool.query !== 'function') return;

  // List mapping tool versions
  app.get('/api/grabbing-jerome/mapping/tools', async (req, res) => {
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
      const total = await pool.query(`select count(*)::int as c from public.mod_grabbing_jerome_maping_tools ${whereSql}`, params);
      const items = await pool.query(
        `select id, domain, page_type, version, name, enabled, created_at, updated_at
           from public.mod_grabbing_jerome_maping_tools
           ${whereSql}
           order by domain asc, page_type asc, version desc, updated_at desc
           limit $${i} offset $${i+1}`,
        [...params, limit, offset]
      );
      return res.json({ ok:true, total: Number(total.rows?.[0]?.c || 0), items: items.rows });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_map_failed', message: e?.message || String(e) }); }
  });

  // Get latest mapping config
  app.get('/api/grabbing-jerome/mapping/tools/latest', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(
        `select id, domain, page_type, version, name, enabled, config, created_at, updated_at
           from public.mod_grabbing_jerome_maping_tools
          where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
          order by version desc, updated_at desc
          limit 1`,
        [domain, pageType]
      );
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'get_latest_map_failed', message: e?.message || String(e) }); }
  });

  // Get specific version
  app.get('/api/grabbing-jerome/mapping/tools/get', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || '').trim().toLowerCase();
      const version = Number(req.query?.version || 0);
      if (!domain || !pageType || !version) return res.status(400).json({ ok:false, error:'bad_request' });
      const r = await pool.query(
        `select id, domain, page_type, version, name, enabled, config, created_at, updated_at
           from public.mod_grabbing_jerome_maping_tools
          where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3
          limit 1`,
        [domain, pageType, version]
      );
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, item: r.rows[0] });
    } catch (e) { return res.status(500).json({ ok:false, error:'get_map_failed', message: e?.message || String(e) }); }
  });

  // Upsert mapping tool (create new version or update existing)
  app.post('/api/grabbing-jerome/mapping/tools', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const domain = normDomain(req.body?.domain);
      const pageType = String(req.body?.page_type || '').trim().toLowerCase();
      const version = Number(req.body?.version || 0) || 0;
      const name = String(req.body?.name || '').trim() || null;
      const enabled = !!req.body?.enabled;
      const config = (req.body?.config && typeof req.body.config==='object') ? req.body.config : {};
      if (!domain || !pageType) return res.status(400).json({ ok:false, error:'bad_request' });
      let row = null;
      if (!version) {
        const r = await pool.query(
          `insert into public.mod_grabbing_jerome_maping_tools (domain,page_type,version,name,config,enabled,updated_at)
           values ($1,$2, coalesce((select max(version)+1 from public.mod_grabbing_jerome_maping_tools where domain=$1 and lower(page_type)=lower($2)),1), $3, $4::jsonb, $5, now())
           returning id, domain, page_type, version, name, enabled, config, created_at, updated_at`,
          [domain, pageType, name, JSON.stringify(config||{}), enabled]
        );
        row = r.rows[0];
      } else {
        const upd = await pool.query(
          `update public.mod_grabbing_jerome_maping_tools
              set name=$1, config=$2::jsonb, enabled=$3, updated_at=now()
            where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($4),'^www\\.','') and lower(page_type)=lower($5) and version=$6
            returning id, domain, page_type, version, name, enabled, config, created_at, updated_at`,
          [name, JSON.stringify(config||{}), enabled, domain, pageType, version]
        );
        if (upd.rowCount) row = upd.rows[0];
        else {
          const ins = await pool.query(
            `insert into public.mod_grabbing_jerome_maping_tools (domain,page_type,version,name,config,enabled,updated_at)
             values ($1,$2,$3,$4,$5::jsonb,$6, now())
             returning id, domain, page_type, version, name, enabled, config, created_at, updated_at`,
          [domain, pageType, version, name, JSON.stringify(config||{}), enabled]
        );
          row = ins.rows[0];
        }
      }
      return res.json({ ok:true, item: row });
    } catch (e) { return res.status(500).json({ ok:false, error:'upsert_map_failed', message: e?.message || String(e) }); }
  });

  // Delete a specific version
  app.delete('/api/grabbing-jerome/mapping/tools', async (req, res) => {
    try {
      await ensureMappingToolsTable();
      const id = Number(req.query?.id || req.body?.id || 0);
      const domain = normDomain(req.query?.domain || req.body?.domain);
      const pageType = String(req.query?.page_type || req.body?.page_type || '').trim().toLowerCase();
      const version = Number(req.query?.version || req.body?.version || 0);
      let r;
      if (id) {
        r = await pool.query(`delete from public.mod_grabbing_jerome_maping_tools where id=$1`, [id]);
      } else if (domain && pageType && version) {
        r = await pool.query(`delete from public.mod_grabbing_jerome_maping_tools where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) and version=$3`, [domain, pageType, version]);
      } else {
        return res.status(400).json({ ok:false, error:'bad_request' });
      }
      return res.json({ ok:true, deleted: Number(r?.rowCount||0) });
    } catch (e) { return res.status(500).json({ ok:false, error:'delete_map_failed', message: e?.message || String(e) }); }
  });
}
