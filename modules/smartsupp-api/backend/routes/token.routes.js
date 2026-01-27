export function registerSmartsuppApiRoutes(app, ctx = {}) {
  const requireAdmin = ctx.requireAdmin || ((_req, res) => { res.status(401).json({ error: 'unauthorized' }); return null; });
  const pool = ctx.pool;
  const log = (msg) => { try { ctx.logToFile?.(`[smartsupp-api] ${msg}`); } catch {} };

  async function ensureTables() {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS mod_smartsupp_api_settings (
          id SERIAL PRIMARY KEY,
          org_id TEXT DEFAULT 'org_default',
          api_token TEXT,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          CONSTRAINT uq_mod_smartsupp_api_settings_org UNIQUE(org_id)
        );
      `);
      // Backfill from legacy settings/env if empty
      const cur = await pool.query(`SELECT api_token FROM mod_smartsupp_api_settings WHERE org_id='org_default' LIMIT 1`);
      const has = cur.rowCount && String(cur.rows[0].api_token||'').trim();
      if (!has) {
        let legacy = null;
        try {
          const r = await pool.query(`SELECT value FROM settings WHERE key='SMARTSUPP_API_TOKEN' LIMIT 1`);
          legacy = (r.rowCount ? (r.rows[0].value || '') : '').trim();
        } catch {}
        if (!legacy) legacy = String(process.env.SMARTSUPP_API_TOKEN || process.env.SMARTSUPP_ACCESS_TOKEN || process.env.SMARTSUPP_TOKEN || '').trim();
        if (legacy) {
          await pool.query(`
            INSERT INTO mod_smartsupp_api_settings (org_id, api_token, created_at, updated_at)
            VALUES ('org_default', $1, NOW(), NOW())
            ON CONFLICT (org_id) DO UPDATE SET api_token = EXCLUDED.api_token, updated_at = NOW();
          `, [legacy]);
          log('Imported legacy SMARTSUPP_API_TOKEN on first access');
        }
      }
    } catch (e) {
      log(`ensureTables error: ${e?.message || e}`);
    }
  }

  // GET token (admin)
  app.get('/api/smartsupp-api/token', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    await ensureTables();
    const org = String(req.query?.org_id || 'org_default');
    try {
      const r = await pool.query(`SELECT api_token FROM mod_smartsupp_api_settings WHERE org_id = $1 LIMIT 1`, [org]);
      const value = r.rowCount ? (r.rows[0].api_token || null) : null;
      res.json({ ok: true, value });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // Backward-compatible admin endpoints (old UI used these paths)
  app.get('/api/admin/smartsupp/token', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    await ensureTables();
    const org = String(req.query?.org_id || 'org_default');
    try {
      const r = await pool.query(`SELECT api_token FROM mod_smartsupp_api_settings WHERE org_id = $1 LIMIT 1`, [org]);
      const value = r.rowCount ? (r.rows[0].api_token || null) : null;
      res.json({ ok: true, value });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/admin/smartsupp/token', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    await ensureTables();
    const org = String(req.body?.org_id || 'org_default');
    const token = String(req.body?.token || '').trim();
    try {
      await pool.query(`
        INSERT INTO mod_smartsupp_api_settings (org_id, api_token, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (org_id)
        DO UPDATE SET api_token = EXCLUDED.api_token, updated_at = NOW();
      `, [org, token]);
      res.json({ ok: true, value: token || null });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/admin/smartsupp/token/disable', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    await ensureTables();
    const org = String(req.body?.org_id || 'org_default');
    try {
      await pool.query(`
        INSERT INTO mod_smartsupp_api_settings (org_id, api_token, created_at, updated_at)
        VALUES ($1, '', NOW(), NOW())
        ON CONFLICT (org_id)
        DO UPDATE SET api_token = '', updated_at = NOW();
      `, [org]);
      res.json({ ok: true, value: null });
    } catch (e) { res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // POST set token (admin)
  app.post('/api/smartsupp-api/token', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    await ensureTables();
    const org = String(req.body?.org_id || 'org_default');
    const token = String(req.body?.token || '').trim();
    try {
      await pool.query(`
        INSERT INTO mod_smartsupp_api_settings (org_id, api_token, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (org_id)
        DO UPDATE SET api_token = EXCLUDED.api_token, updated_at = NOW();
      `, [org, token]);
      res.json({ ok: true, value: token || null });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // Disable/clear token (admin)
  app.post('/api/smartsupp-api/token/disable', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    await ensureTables();
    const org = String(req.body?.org_id || 'org_default');
    try {
      await pool.query(`
        INSERT INTO mod_smartsupp_api_settings (org_id, api_token, created_at, updated_at)
        VALUES ($1, '', NOW(), NOW())
        ON CONFLICT (org_id)
        DO UPDATE SET api_token = '', updated_at = NOW();
      `, [org]);
      res.json({ ok: true, value: null });
    } catch (e) {
      res.status(500).json({ ok: false, error: 'server_error', message: e?.message || String(e) });
    }
  });

  // Manual import endpoint (idempotent): copy legacy setting/env to module table
  app.post('/api/smartsupp-api/import-legacy', async (req, res) => {
    const u = requireAdmin(req, res); if (!u) return;
    await ensureTables();
    try {
      let legacy = null;
      try {
        const r = await pool.query(`SELECT value FROM settings WHERE key='SMARTSUPP_API_TOKEN' LIMIT 1`);
        legacy = (r.rowCount ? (r.rows[0].value || '') : '').trim();
      } catch {}
      if (!legacy) legacy = String(process.env.SMARTSUPP_API_TOKEN || process.env.SMARTSUPP_ACCESS_TOKEN || process.env.SMARTSUPP_TOKEN || '').trim();
      if (!legacy) return res.status(404).json({ ok:false, error:'not_found', message:'No legacy token found' });
      await pool.query(`
        INSERT INTO mod_smartsupp_api_settings (org_id, api_token, created_at, updated_at)
        VALUES ('org_default', $1, NOW(), NOW())
        ON CONFLICT (org_id) DO UPDATE SET api_token = EXCLUDED.api_token, updated_at = NOW();
      `, [legacy]);
      res.json({ ok:true, imported: true });
    } catch (e) {
      res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) });
    }
  });

  log('routes mounted at /api/smartsupp-api/*');
}
