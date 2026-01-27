function pickOrgId(req) { try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; } }

export function registerBomFxRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool || ctx.pool;

  // List latest rates per quote for a base currency
  app.get('/api/bom/fx/latest', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const orgId = pickOrgId(req);
      const base = String(req.query?.base || req.query?.base_currency || process.env.BOM_DEFAULT_CURRENCY || process.env.DEFAULT_CURRENCY || 'EUR').toUpperCase();
      const sql = `
        SELECT DISTINCT ON (quote_currency, COALESCE(org_id, -1))
               id, org_id, base_currency, quote_currency, rate, effective_at, updated_at
          FROM mod_bom_fx_rates
         WHERE base_currency = $1
           AND ($2::text IS NULL OR org_id IS NULL OR org_id = $2::int)
         ORDER BY quote_currency, COALESCE(org_id, -1), effective_at DESC, id DESC`;
      const args = [base, orgId];
      const r = await pool.query(sql, args);
      return res.json({ ok:true, base_currency: base, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'list_failed', message: e?.message || String(e) }); }
  });

  // Upsert (insert a new effective rate)
  app.post('/api/bom/fx', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = body.org_id ?? pickOrgId(req);
      const base = String(body.base_currency || process.env.BOM_DEFAULT_CURRENCY || process.env.DEFAULT_CURRENCY || 'EUR').toUpperCase();
      const quote = String(body.quote_currency || '').toUpperCase();
      const rate = Number(body.rate);
      const eff = body.effective_at ? new Date(body.effective_at) : new Date();
      if (!quote || !isFinite(rate)) return res.status(400).json({ ok:false, error:'invalid_input' });
      const r = await pool.query(`
        INSERT INTO mod_bom_fx_rates(org_id, base_currency, quote_currency, rate, effective_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,NOW())
        RETURNING id`, [orgId ?? null, base, quote, rate, eff.toISOString()]);
      return res.json({ ok:true, id: r.rows[0]?.id || null });
    } catch (e) { return res.status(500).json({ ok:false, error:'create_failed', message: e?.message || String(e) }); }
  });
}

