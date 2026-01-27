import { Buffer } from 'node:buffer';

export function registerPrestashopApiRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(401).json({ error: 'unauthorized' }); return null; });

  const pickOrgId = (req) => {
    try { return String(req.headers['x-org-id'] || req.org_id || 'org_default'); } catch { return 'org_default'; }
  };

  const ensure = async () => {
    if (!pool || typeof pool.query !== 'function') return;
    // Create table (no single-row-per-org constraint to allow multi connections per org)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.mod_prestashop_api_settings (
        id SERIAL PRIMARY KEY,
        org_id TEXT NULL,
        name TEXT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    // Drop legacy unique constraint (one row per org) if present
    await pool.query(`ALTER TABLE public.mod_prestashop_api_settings DROP CONSTRAINT IF EXISTS uq_mod_prestashop_api_settings;`).catch(()=>{});
    // Add name column if missing (for older installs)
    await pool.query(`DO $$ BEGIN BEGIN ALTER TABLE public.mod_prestashop_api_settings ADD COLUMN IF NOT EXISTS name TEXT NULL; EXCEPTION WHEN others THEN END; END $$;`).catch(()=>{});
    // Indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_prestashop_api_settings_org_id ON public.mod_prestashop_api_settings(org_id);`);
    // Prevent duplicate base_url per org (treat NULL org as empty string to enforce uniqueness)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_prestashop_api_settings_org_base ON public.mod_prestashop_api_settings (COALESCE(org_id,''), base_url);`);
    // Prevent duplicate name per org
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_prestashop_api_settings_org_name ON public.mod_prestashop_api_settings (COALESCE(org_id,''), name) WHERE name IS NOT NULL;`);
  };

  app.get('/api/prestashop-api/ping', (_req, res) => res.json({ ok: true, module: 'prestashop-api' }));

  // Load settings for current org (do not return api_key value for safety)
  app.get('/api/prestashop-api/settings', async (req, res) => {
    try {
      await ensure();
      const org = pickOrgId(req);
      const r = await pool.query(
        `SELECT org_id, base_url, (api_key IS NOT NULL AND api_key <> '') AS has_api_key, updated_at
           FROM public.mod_prestashop_api_settings
          WHERE org_id IS NOT DISTINCT FROM $1
          LIMIT 1`, [org || null]
      );
      const item = r.rowCount ? r.rows[0] : { org_id: org || null, base_url: null, has_api_key: false, updated_at: null };
      res.json({ ok: true, item });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Upsert settings for current org
  app.post('/api/prestashop-api/settings', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensure();
      const org = pickOrgId(req);
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const baseUrl = String(body.base_url || body.baseUrl || '').trim();
      const apiKey = body.api_key != null ? String(body.api_key) : (body.apiKey != null ? String(body.apiKey) : null);
      if (!baseUrl) return res.status(400).json({ ok:false, error:'base_url_required' });

      // Upsert, optionally updating api_key when provided
      if (apiKey !== null) {
        const r = await pool.query(
          `INSERT INTO public.mod_prestashop_api_settings(org_id, base_url, api_key, created_at, updated_at)
           VALUES ($1,$2,$3,NOW(),NOW())
           ON CONFLICT (org_id) DO UPDATE SET base_url=EXCLUDED.base_url, api_key=EXCLUDED.api_key, updated_at=NOW()
           RETURNING org_id, base_url, (api_key IS NOT NULL AND api_key <> '') AS has_api_key, updated_at`,
          [org || null, baseUrl, apiKey]
        );
        return res.status(201).json({ ok:true, item: r.rows[0] });
      } else {
        const r = await pool.query(
          `INSERT INTO public.mod_prestashop_api_settings(org_id, base_url, api_key, created_at, updated_at)
           VALUES ($1,$2,'',NOW(),NOW())
           ON CONFLICT (org_id) DO UPDATE SET base_url=EXCLUDED.base_url, updated_at=NOW()
           RETURNING org_id, base_url, (api_key IS NOT NULL AND api_key <> '') AS has_api_key, updated_at`,
          [org || null, baseUrl]
        );
        return res.status(201).json({ ok:true, item: r.rows[0] });
      }
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Test connection to PrestaShop API using provided or saved credentials
  app.post('/api/prestashop-api/test', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensure();
      const org = pickOrgId(req);
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      let baseUrl = String(body.base_url || body.baseUrl || '').trim();
      let apiKey = body.api_key != null ? String(body.api_key) : (body.apiKey != null ? String(body.apiKey) : '');
      const nameParam = String(body.name || body.NAME || 'test');

      if (!baseUrl || !apiKey) {
        // Fallback to saved settings if input missing
        const r = await pool.query(`SELECT base_url, api_key FROM public.mod_prestashop_api_settings WHERE org_id IS NOT DISTINCT FROM $1 LIMIT 1`, [org || null]);
        if (!baseUrl && r.rowCount) baseUrl = String(r.rows[0].base_url || '').trim();
        if (!apiKey && r.rowCount) apiKey = String(r.rows[0].api_key || '');
      }
      if (!baseUrl) return res.status(400).json({ ok:false, error:'base_url_required' });
      if (!apiKey) return res.status(400).json({ ok:false, error:'api_key_required' });

      const ensureScheme = (url) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);
      // Heuristic: custom module endpoint if contains "/module/" or tokens {KEY}/{NAME} or explicit action=
      const looksModule = /\/module\//i.test(baseUrl) || /\{\s*(key|KEY|name|NAME)\s*\}/.test(baseUrl) || /[?&]action=/.test(baseUrl);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const clip = (s) => (typeof s === 'string' ? s.slice(0, 1000) : '');
        if (looksModule) {
          // Module-style endpoint: substitute placeholders and ensure required params
          let urlStr = ensureScheme(baseUrl)
            .replace(/\{\s*(key|KEY)\s*\}/g, encodeURIComponent(apiKey))
            .replace(/\{\s*(name|NAME)\s*\}/g, encodeURIComponent(nameParam));
          let url;
          try { url = new URL(urlStr); } catch {
            // If still not a full URL, attempt to coerce
            url = new URL(ensureScheme(urlStr));
          }
          const sp = url.searchParams;
          if (!sp.has('action')) sp.set('action', 'custom');
          if (!sp.has('name')) sp.set('name', nameParam);
          if (!sp.has('key')) sp.set('key', apiKey);
          const finalUrl = url.toString();
          const r = await fetch(finalUrl, { headers: { 'Accept': 'application/json, */*' }, signal: controller.signal });
          const text = await r.text();
          if (r.status === 200) {
            let parsed = null; try { parsed = JSON.parse(text); } catch {}
            return res.json({ ok:true, mode:'module', status:r.status, url: finalUrl, desc:'module endpoint', sample: clip(text), isJson: !!parsed });
          }
          return res.status(502).json({ ok:false, mode:'module', error:'upstream_error', detail: { status: r.status, url: finalUrl, body: clip(text) } });
        } else {
          // PrestaShop Webservice API mode
          let apiBase = ensureScheme(baseUrl).replace(/\/$/, '');
          if (!/\/(api)(\/)?$/i.test(apiBase)) apiBase = apiBase + '/api';
          const authHeader = 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64');
          const candidates = [
            { path: '', desc: 'API index' },
            { path: '/products?limit=1&output_format=JSON', desc: 'products (limit=1)' },
            { path: '/orders?limit=1&output_format=JSON', desc: 'orders (limit=1)' },
          ];
          let lastErr = null;
          for (const c of candidates) {
            const url = apiBase + c.path;
            try {
              const r = await fetch(url, { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, signal: controller.signal });
              const text = await r.text();
              if (r.status === 200) {
                let parsed = null; try { parsed = JSON.parse(text); } catch {}
                return res.json({ ok:true, mode:'webservice', status:r.status, url, desc: c.desc, sample: clip(text), isJson: !!parsed });
              }
              lastErr = { status: r.status, url, body: clip(text) };
            } catch (e) { lastErr = { error: String(e?.message || e), url }; }
          }
          if (lastErr) return res.status(502).json({ ok:false, mode:'webservice', error:'upstream_error', detail:lastErr });
          return res.status(500).json({ ok:false, mode:'webservice', error:'unknown' });
        }
      } finally { clearTimeout(timeout); }
    } catch (e) {
      return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  // We will expose multi-row management backed by mod_prestashop_api_settings
  // (some deployments already use this table for multiple entries per org)
  const ensureSettings = ensure;

  // List connections for current org (backed by settings table)
  app.get('/api/prestashop-api/connections', async (req, res) => {
    try {
      await ensureSettings();
      const org = pickOrgId(req);
      const r = await pool.query(
        `SELECT id, org_id, name, base_url,
                (api_key IS NOT NULL AND api_key <> '') AS has_api_key,
                created_at, updated_at
           FROM public.mod_prestashop_api_settings
          WHERE org_id IS NOT DISTINCT FROM $1
          ORDER BY updated_at DESC NULLS LAST, id DESC`, [org || null]
      );
      res.json({ ok:true, items: r.rows || [] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Create a new connection (insert row into settings)
  app.post('/api/prestashop-api/connections', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureSettings();
      const org = pickOrgId(req);
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const name = (b.name != null) ? String(b.name).trim() : null;
      const baseUrl = String(b.base_url || b.baseUrl || '').trim();
      const apiKey = String(b.api_key || b.apiKey || '').trim();
      if (!name || !name.trim()) return res.status(400).json({ ok:false, error:'name_required' });
      if (!baseUrl) return res.status(400).json({ ok:false, error:'base_url_required' });
      if (!apiKey) return res.status(400).json({ ok:false, error:'api_key_required' });
      const r = await pool.query(
        `INSERT INTO public.mod_prestashop_api_settings(org_id, name, base_url, api_key, created_at, updated_at)
         VALUES ($1,$2,$3,$4,NOW(),NOW())
         RETURNING id, org_id, name, base_url, (api_key IS NOT NULL AND api_key <> '') AS has_api_key, created_at, updated_at`,
        [org||null, name, baseUrl, apiKey]
      );
      return res.status(201).json({ ok:true, item: r.rows[0] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Get a single connection (from settings)
  app.get('/api/prestashop-api/connections/:id', async (req, res) => {
    try {
      await ensureSettings();
      const org = pickOrgId(req);
      const id = Number(req.params.id || 0);
      const r = await pool.query(
        `SELECT id, org_id, name, base_url,
                (api_key IS NOT NULL AND api_key <> '') AS has_api_key,
                created_at, updated_at
           FROM public.mod_prestashop_api_settings
          WHERE id=$1 AND org_id IS NOT DISTINCT FROM $2`, [id, org||null]
      );
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      res.json({ ok:true, item: r.rows[0] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Update a connection (in settings)
  app.patch('/api/prestashop-api/connections/:id', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureSettings();
      const org = pickOrgId(req);
      const id = Number(req.params.id || 0);
      const b = (req.body && typeof req.body === 'object') ? req.body : {};
      const sets = []; const args = []; let i = 1;
      const push = (sql, v) => { sets.push(sql.replace('?', '$'+(i++))); args.push(v); };
      if (b.name !== undefined) push('name=?', (b.name != null) ? String(b.name).trim() : null);
      if (b.base_url !== undefined || b.baseUrl !== undefined) push('base_url=?', String(b.base_url||b.baseUrl||'').trim());
      if (b.api_key !== undefined || b.apiKey !== undefined) push('api_key=?', String(b.api_key||b.apiKey||''));
      if (!sets.length) return res.status(400).json({ ok:false, error:'no_changes' });
      push('updated_at=?', new Date());
      args.push(id); args.push(org||null);
      const r = await pool.query(
        `UPDATE public.mod_prestashop_api_settings SET ${sets.join(', ')} WHERE id=$${i++} AND org_id IS NOT DISTINCT FROM $${i++}
           RETURNING id, org_id, name, base_url, (api_key IS NOT NULL AND api_key <> '') AS has_api_key, created_at, updated_at`, args);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      res.json({ ok:true, item: r.rows[0] });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Delete a connection
  app.delete('/api/prestashop-api/connections/:id', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureSettings();
      const org = pickOrgId(req);
      const id = Number(req.params.id || 0);
      const r = await pool.query(`DELETE FROM public.mod_prestashop_api_settings WHERE id=$1 AND org_id IS NOT DISTINCT FROM $2 RETURNING id`, [id, org||null]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      res.json({ ok:true });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Default flag unsupported when using settings table
  app.post('/api/prestashop-api/connections/:id/default', async (_req, res) => {
    return res.status(400).json({ ok:false, error:'unsupported', message:'default flag not supported for settings-backed connections' });
  });

  // Test a specific connection id
  app.post('/api/prestashop-api/connections/:id/test', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    try {
      await ensureSettings();
      const org = pickOrgId(req);
      const id = Number(req.params.id || 0);
      const r = await pool.query(`SELECT name, base_url, api_key FROM public.mod_prestashop_api_settings WHERE id=$1 AND org_id IS NOT DISTINCT FROM $2`, [id, org||null]);
      if (!r.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const base_url = String(r.rows[0].base_url||'');
      const api_key = String(r.rows[0].api_key||'');
      const name = r.rows[0].name != null ? String(r.rows[0].name) : 'test';
      req.body = { base_url, api_key, name }; // reuse the generic tester
      return app._router.handle({ ...req, url: '/api/prestashop-api/test', method: 'POST' }, res, () => {});
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });
}

export default registerPrestashopApiRoutes;
