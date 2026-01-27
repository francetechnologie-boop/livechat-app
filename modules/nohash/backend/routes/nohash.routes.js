export function registerNohashRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(401).json({ error: 'unauthorized' }); return null; });

  function pickOrgId(req) {
    try { const q = req?.query?.org_id; if (q) return String(q); } catch {}
    try { const h = req?.headers?.['x-org-id']; if (h) return String(h); } catch {}
    return 'org_default';
  }

  async function scanAndUpsert(org_id = 'org_default') {
    const fs = await import('fs');
    const path = await import('path');
    const here = path.resolve(path.dirname(new URL(import.meta.url).pathname));
    const modulesRoot = path.resolve(here, '../../../../modules');
    const pagesRoot = path.resolve(here, '../../../../pages');
    const seenRoute = new Set();
    const seenModules = new Set();
    const seenPages = new Set();

    const upsertRoute = async (kind, item_id, hash, title, source) => {
      if (!kind || !item_id || !hash) return;
      const clean = String(hash).replace(/^#/, '').trim();
      seenRoute.add(`${kind}|${clean.toLowerCase()}`);
      await pool.query(
        `insert into mod_nohash_routes(kind, item_id, hash, title, source, enabled, updated_at, org_id)
         values($1,$2,$3,$4,$5,true, now(), $6)
         on conflict (COALESCE(org_id,'org_default'), lower(trim(both from hash)))
         do update set kind=EXCLUDED.kind, item_id=EXCLUDED.item_id, title=EXCLUDED.title, source=EXCLUDED.source, enabled=true, updated_at=now()`,
        [kind, item_id, clean, title || null, source || null, org_id]
      );
    };

    const upsertModule = async (row) => {
      seenModules.add(row.module_id);
      await pool.query(
        `insert into mod_nohash_modules(module_id, name, description, category, version, default_installed, default_active, has_frontend, has_backend, hash, source, enabled, updated_at, org_id)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true, now(), $12)
         on conflict (COALESCE(org_id,'org_default'), module_id)
         do update set name=EXCLUDED.name, description=EXCLUDED.description, category=EXCLUDED.category, version=EXCLUDED.version,
                       default_installed=EXCLUDED.default_installed, default_active=EXCLUDED.default_active,
                       has_frontend=EXCLUDED.has_frontend, has_backend=EXCLUDED.has_backend, hash=EXCLUDED.hash, source=EXCLUDED.source,
                       enabled=true, updated_at=now()`,
        [row.module_id, row.name, row.description, row.category, row.version, !!row.default_installed, !!row.default_active, !!row.has_frontend, !!row.has_backend, row.hash, row.source, org_id]
      );
    };

    const upsertPage = async (row) => {
      seenPages.add(row.page_id);
      await pool.query(
        `insert into mod_nohash_pages(page_id, name, description, category, hash, source, enabled, updated_at, org_id)
         values($1,$2,$3,$4,$5,$6,true, now(), $7)
         on conflict (COALESCE(org_id,'org_default'), page_id)
         do update set name=EXCLUDED.name, description=EXCLUDED.description, category=EXCLUDED.category,
                       hash=EXCLUDED.hash, source=EXCLUDED.source, enabled=true, updated_at=now()`,
        [row.page_id, row.name, row.description, row.category, row.hash, row.source, org_id]
      );
    };

    // scan modules
    try {
      for (const ent of fs.readdirSync(modulesRoot, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue;
        const modId = ent.name;
        const modDir = path.join(modulesRoot, modId);
        const manifestFiles = ['config.json','manifest.json']
          .map(n => path.join(modDir, n));
        let manifest = null;
        for (const mf of manifestFiles) {
          if (fs.existsSync(mf)) { try { manifest = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch {} break; }
        }
        const hasFrontend = fs.existsSync(path.join(modDir, 'frontend'));
        const hasBackend = fs.existsSync(path.join(modDir, 'backend'));
        if (!hasFrontend) continue; // only modules with a page are routable
        const name = String(manifest?.name || modId);
        const description = String(manifest?.description || '');
        const category = String(manifest?.category || 'module');
        const version = String(manifest?.version || '1.0.0');
        const defaultInstalled = !!manifest?.defaultInstalled;
        const defaultActive = !!manifest?.defaultActive;
        const hash = `#/${modId}`;
        await upsertModule({ module_id: modId, name, description, category, version, default_installed: defaultInstalled, default_active: defaultActive, has_frontend: hasFrontend, has_backend: hasBackend, hash, source: 'manifest' });
        await upsertRoute('module', modId, hash, name, 'manifest');
      }
    } catch {}

    // scan pages
    try {
      if (fs.existsSync(pagesRoot)) {
        for (const ent of fs.readdirSync(pagesRoot, { withFileTypes: true })) {
          if (!ent.isDirectory()) continue;
          const pageId = ent.name;
          const pageDir = path.join(pagesRoot, pageId);
          const idxFiles = ['index.js','index.jsx','index.ts','index.tsx'].map(n => path.join(pageDir, n));
          if (!idxFiles.some(f => fs.existsSync(f))) continue;
          let pageCfg = null; const cfgPath = path.join(pageDir, 'config.json');
          try { if (fs.existsSync(cfgPath)) pageCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
          const name = String(pageCfg?.name || pageId);
          const description = String(pageCfg?.description || '');
          const category = String(pageCfg?.category || 'page');
          const hash = `#/${pageId}`;
          await upsertPage({ page_id: pageId, name, description, category, hash, source: 'pages' });
          await upsertRoute('page', pageId, hash, name, 'pages');
        }
      }
    } catch {}

    // prune non-seen
    try {
      const { rows: r1 } = await pool.query('select id, module_id from mod_nohash_modules where COALESCE(org_id,\'org_default\') = COALESCE($1,\'org_default\')', [org_id]);
      const del1 = r1.filter(r => !seenModules.has(r.module_id)).map(r => r.id);
      if (del1.length) await pool.query('delete from mod_nohash_modules where id = any($1::bigint[])', [del1]);
    } catch {}
    try {
      const { rows: r2 } = await pool.query('select id, page_id from mod_nohash_pages where COALESCE(org_id,\'org_default\') = COALESCE($1,\'org_default\')', [org_id]);
      const del2 = r2.filter(r => !seenPages.has(r.page_id)).map(r => r.id);
      if (del2.length) await pool.query('delete from mod_nohash_pages where id = any($1::bigint[])', [del2]);
    } catch {}
    try {
      const { rows: r3 } = await pool.query('select id, kind, hash from mod_nohash_routes where COALESCE(org_id,\'org_default\') = COALESCE($1,\'org_default\')', [org_id]);
      const del3 = r3.filter(r => !seenRoute.has(`${r.kind}|${String(r.hash||'').toLowerCase().trim()}`)).map(r => r.id);
      if (del3.length) await pool.query('delete from mod_nohash_routes where id = any($1::bigint[])', [del3]);
    } catch {}
  }

  // GET /api/nohash/list -> { ok, items:[{kind,item_id,hash,title,source,enabled,updated_at}] }
  app.get('/api/nohash/list', async (req, res) => {
    try {
      const org = pickOrgId(req);
      let { rows } = await pool.query(`
        select 'module'::text as kind, m.module_id as item_id, m.hash, coalesce(m.name, m.module_id) as title, m.category as category, m.version as version, m.source, m.enabled, m.updated_at
          from mod_nohash_modules m
         where COALESCE(m.org_id,'org_default') = COALESCE($1,'org_default')
          union all
        select 'page'::text as kind, p.page_id as item_id, p.hash, coalesce(p.name, p.page_id) as title, p.category as category, null::text as version, p.source, p.enabled, p.updated_at
          from mod_nohash_pages p
         where COALESCE(p.org_id,'org_default') = COALESCE($1,'org_default')
         order by kind asc, item_id asc`, [org]);
      if (!rows || rows.length === 0) {
        // Auto-initialize on first read
        try { await scanAndUpsert(org); } catch {}
        const r2 = await pool.query(`
          select 'module'::text as kind, m.module_id as item_id, m.hash, coalesce(m.name, m.module_id) as title, m.category as category, m.version as version, m.source, m.enabled, m.updated_at
            from mod_nohash_modules m
           where COALESCE(m.org_id,'org_default') = COALESCE($1,'org_default')
           union all
          select 'page'::text as kind, p.page_id as item_id, p.hash, coalesce(p.name, p.page_id) as title, p.category as category, null::text as version, p.source, p.enabled, p.updated_at
            from mod_nohash_pages p
           where COALESCE(p.org_id,'org_default') = COALESCE($1,'org_default')
           order by kind asc, item_id asc`, [org]);
        rows = r2.rows;
      }
      return res.json({ ok:true, items: rows });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // POST /api/nohash/rebuild -> scan and upsert into mod_nohash_routes
  app.post('/api/nohash/rebuild', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      const org = pickOrgId(req);
      await scanAndUpsert(org);
      const { rows } = await pool.query(`
        select 'module'::text as kind, m.module_id as item_id, m.hash, coalesce(m.name, m.module_id) as title, m.category as category, m.version as version, m.source, m.enabled, m.updated_at
          from mod_nohash_modules m
         where COALESCE(m.org_id,'org_default') = COALESCE($1,'org_default')
          union all
        select 'page'::text as kind, p.page_id as item_id, p.hash, coalesce(p.name, p.page_id) as title, p.category as category, null::text as version, p.source, p.enabled, p.updated_at
          from mod_nohash_pages p
         where COALESCE(p.org_id,'org_default') = COALESCE($1,'org_default')
         order by kind asc, item_id asc`, [org]);
      return res.json({ ok:true, items: rows, org_id: org });
    } catch (e) { return res.status(500).json({ ok:false, error:'rebuild_failed', message: e?.message || String(e) }); }
  });

  // Refresh on boot and once after a short delay (to avoid race with migrations)
  scanAndUpsert('org_default').catch(() => {});
  setTimeout(() => { scanAndUpsert('org_default').catch(() => {}); }, 1500);
}
