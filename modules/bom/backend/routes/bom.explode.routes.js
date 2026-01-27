export function registerBomExplodeRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool || ctx.pool;

  // Helper to explode by BOM id
  app.get('/api/bom/boms/:id/explode', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const bomId = Number(req.params?.id || 0);
      if (!bomId) return res.status(400).json({ ok:false, error:'invalid_bom_id' });
      const depth = Math.max(1, Math.min(8, Number(req.query?.depth || 2)));
      const agg = String(req.query?.aggregate || '1') !== '0';

      const baseCur = String(process.env.BOM_DEFAULT_CURRENCY || process.env.DEFAULT_CURRENCY || 'EUR');
      // Detect if FX table exists to keep the endpoint portable across environments
      let hasFx = false;
      try {
        const chk = await pool.query("SELECT to_regclass('public.mod_bom_fx_rates') AS t");
        hasFx = !!(chk.rows && chk.rows[0] && chk.rows[0].t);
      } catch {}

      const sqlWithFx = `
        WITH RECURSIVE
        root AS (
          SELECT b.id AS bom_id, b.name AS bom_name
            FROM mod_bom_boms b
           WHERE b.id = $1
        ),
        tree AS (
          -- level 1 components of root BOM
          SELECT 1 AS lvl, bi.bom_id, bi.item_id, i.sku, i.name, i.description_short,
                 bi.quantity::numeric AS qty, bi.quantity::numeric AS ext_qty,
                 lp.price AS unit_price,
                 COALESCE(lp.currency, sv.currency) AS currency
            FROM mod_bom_bom_items bi
            JOIN mod_bom_items i ON i.id = bi.item_id
            LEFT JOIN LATERAL (
              SELECT p.price AS price,
                     p.currency
                FROM mod_bom_item_vendor_prices p
               WHERE p.item_id = i.id
               ORDER BY p.effective_at DESC, p.id DESC
               LIMIT 1
            ) lp ON TRUE
            LEFT JOIN LATERAL (
              SELECT s.currency
                FROM mod_bom_item_vendors iv
                LEFT JOIN mod_bom_suppliers s ON s.id = iv.supplier_id
               WHERE iv.item_id = i.id
               ORDER BY iv.preferred DESC, COALESCE(iv.priority, 999) ASC
               LIMIT 1
            ) sv ON TRUE
            JOIN root r ON r.bom_id = bi.bom_id
          UNION ALL
          -- recurse into sub-assemblies when a BOM exists with name = component SKU
          SELECT t.lvl + 1 AS lvl,
                 bi2.bom_id,
                 bi2.item_id,
                 i2.sku,
                 i2.name,
                 i2.description_short,
                 bi2.quantity::numeric AS qty,
                 (t.ext_qty * bi2.quantity::numeric) AS ext_qty,
                 lp2.price AS unit_price,
                 COALESCE(lp2.currency, sv2.currency) AS currency
            FROM tree t
            JOIN mod_bom_boms b2 ON lower(b2.name) = lower(t.sku)
            JOIN mod_bom_bom_items bi2 ON bi2.bom_id = b2.id
            JOIN mod_bom_items i2 ON i2.id = bi2.item_id
            LEFT JOIN LATERAL (
              SELECT p.price AS price,
                     p.currency
                FROM mod_bom_item_vendor_prices p
               WHERE p.item_id = i2.id
               ORDER BY p.effective_at DESC, p.id DESC
               LIMIT 1
            ) lp2 ON TRUE
            LEFT JOIN LATERAL (
              SELECT s.currency
                FROM mod_bom_item_vendors iv2
                LEFT JOIN mod_bom_suppliers s ON s.id = iv2.supplier_id
               WHERE iv2.item_id = i2.id
               ORDER BY iv2.preferred DESC, COALESCE(iv2.priority, 999) ASC
               LIMIT 1
            ) sv2 ON TRUE
           WHERE t.lvl < $2
        )
        SELECT t.lvl,
               t.bom_id,
               t.item_id,
               t.sku,
               t.name,
               t.description_short,
               t.qty,
               t.ext_qty,
               CASE WHEN hb.has_bom = 1 AND t.lvl < $2 THEN NULL ELSE t.unit_price END AS unit_price,
               t.currency,
               (COALESCE(CASE WHEN hb.has_bom = 1 AND t.lvl < $2 THEN NULL ELSE t.unit_price END,0) * COALESCE(t.ext_qty,0))::numeric AS line_total,
               -- FX conversion to base currency
               CASE
                 WHEN hb.has_bom = 1 AND t.lvl < $2 THEN NULL
                 WHEN t.currency IS NULL OR upper(t.currency) = upper($3) THEN t.unit_price
                 WHEN fx.rate IS NOT NULL THEN (t.unit_price / fx.rate)
                 ELSE NULL
               END AS unit_price_base,
               (COALESCE(CASE
                 WHEN hb.has_bom = 1 AND t.lvl < $2 THEN NULL
                 WHEN t.currency IS NULL OR upper(t.currency) = upper($3) THEN t.unit_price
                 WHEN fx.rate IS NOT NULL THEN (t.unit_price / fx.rate)
                 ELSE NULL
               END, 0) * COALESCE(t.ext_qty,0))::numeric AS line_total_base
          FROM tree t
          LEFT JOIN LATERAL (
            SELECT 1 AS has_bom
              FROM mod_bom_boms bx
             WHERE lower(bx.name) = lower(t.sku)
             LIMIT 1
          ) hb ON TRUE
          LEFT JOIN LATERAL (
            SELECT r.rate
              FROM mod_bom_fx_rates r
             WHERE upper(r.base_currency) = upper($3)
               AND upper(r.quote_currency) = upper(COALESCE(t.currency, $3))
             ORDER BY r.effective_at DESC, r.id DESC
             LIMIT 1
          ) fx ON TRUE
         ORDER BY t.lvl ASC, t.sku ASC;
      `;

      const sqlNoFx = `
        WITH RECURSIVE
        root AS (
          SELECT b.id AS bom_id, b.name AS bom_name
            FROM mod_bom_boms b
           WHERE b.id = $1
        ),
        tree AS (
          SELECT 1 AS lvl, bi.bom_id, bi.item_id, i.sku, i.name, i.description_short,
                 bi.quantity::numeric AS qty, bi.quantity::numeric AS ext_qty,
                 lp.price AS unit_price,
                 COALESCE(lp.currency, sv.currency) AS currency
            FROM mod_bom_bom_items bi
            JOIN mod_bom_items i ON i.id = bi.item_id
            LEFT JOIN LATERAL (
              SELECT COALESCE(p.net_price, CASE WHEN p.discount IS NOT NULL THEN p.price * (1 - p.discount) ELSE p.price END) AS price,
                     p.currency
                FROM mod_bom_item_vendor_prices p
               WHERE p.item_id = i.id
               ORDER BY p.effective_at DESC, p.id DESC
               LIMIT 1
            ) lp ON TRUE
            LEFT JOIN LATERAL (
              SELECT s.currency
                FROM mod_bom_item_vendors iv
                LEFT JOIN mod_bom_suppliers s ON s.id = iv.supplier_id
               WHERE iv.item_id = i.id
               ORDER BY iv.preferred DESC, COALESCE(iv.priority, 999) ASC
               LIMIT 1
            ) sv ON TRUE
            JOIN root r ON r.bom_id = bi.bom_id
          UNION ALL
          SELECT t.lvl + 1 AS lvl,
                 bi2.bom_id,
                 bi2.item_id,
                 i2.sku,
                 i2.name,
                 i2.description_short,
                 bi2.quantity::numeric AS qty,
                 (t.ext_qty * bi2.quantity::numeric) AS ext_qty,
                 lp2.price AS unit_price,
                 COALESCE(lp2.currency, sv2.currency) AS currency
            FROM tree t
            JOIN mod_bom_boms b2 ON lower(b2.name) = lower(t.sku)
            JOIN mod_bom_bom_items bi2 ON bi2.bom_id = b2.id
            JOIN mod_bom_items i2 ON i2.id = bi2.item_id
            LEFT JOIN LATERAL (
              SELECT COALESCE(p.net_price, CASE WHEN p.discount IS NOT NULL THEN p.price * (1 - p.discount) ELSE p.price END) AS price,
                     p.currency
                FROM mod_bom_item_vendor_prices p
               WHERE p.item_id = i2.id
               ORDER BY p.effective_at DESC, p.id DESC
               LIMIT 1
            ) lp2 ON TRUE
            LEFT JOIN LATERAL (
              SELECT s.currency
                FROM mod_bom_item_vendors iv2
                LEFT JOIN mod_bom_suppliers s ON s.id = iv2.supplier_id
               WHERE iv2.item_id = i2.id
               ORDER BY iv2.preferred DESC, COALESCE(iv2.priority, 999) ASC
               LIMIT 1
            ) sv2 ON TRUE
           WHERE t.lvl < $2
        )
        SELECT t.lvl,
               t.bom_id,
               t.item_id,
               t.sku,
               t.name,
               t.description_short,
               t.qty,
               t.ext_qty,
               CASE WHEN hb.has_bom = 1 AND t.lvl < $2 THEN NULL ELSE t.unit_price END AS unit_price,
               t.currency,
               (COALESCE(CASE WHEN hb.has_bom = 1 AND t.lvl < $2 THEN NULL ELSE t.unit_price END,0) * COALESCE(t.ext_qty,0))::numeric AS line_total
          FROM tree t
          LEFT JOIN LATERAL (
            SELECT 1 AS has_bom
              FROM mod_bom_boms bx
             WHERE lower(bx.name) = lower(t.sku)
             LIMIT 1
          ) hb ON TRUE
         ORDER BY t.lvl ASC, t.sku ASC;
      `;

      const sql = hasFx ? sqlWithFx : sqlNoFx;
      const params = hasFx ? [bomId, depth, baseCur] : [bomId, depth];
      const r = await pool.query(sql, params);
      const lines = r.rows || [];
      let aggregate = [];
      let totals_by_currency = [];
      let total_price = null;
      let singleCurrency = null;
      if (agg) {
        const m = new Map();
        for (const row of lines) {
          const key = String(row.sku || '') || String(row.item_id);
          const prev = m.get(key) || { sku: row.sku, name: row.name, quantity: 0 };
          prev.quantity = Number(prev.quantity) + Number(row.ext_qty || 0);
          m.set(key, prev);
        }
        aggregate = Array.from(m.values()).sort((a,b) => String(a.sku).localeCompare(String(b.sku)));
        // Totals by currency
        const tm = new Map();
        const defaultCur = String(process.env.BOM_DEFAULT_CURRENCY || process.env.DEFAULT_CURRENCY || 'EUR');
        for (const row of lines) {
          if (row.unit_price != null) {
            const k = String(row.currency || defaultCur);
            const prev = tm.get(k) || 0;
            tm.set(k, prev + Number(row.line_total || 0));
          }
        }
        totals_by_currency = Array.from(tm.entries()).map(([currency, total]) => ({ currency, total }));
        // Base total using FX conversion (if available), otherwise sum only rows already in base or with missing currency
        if (hasFx) {
          const baseSum = lines.reduce((s, row) => s + Number(row.line_total_base || 0), 0);
          total_price = baseSum;
          singleCurrency = baseCur;
        } else {
          const baseSum = lines.reduce((s, row) => {
            const cur = (row.currency || baseCur).toString().toUpperCase();
            return s + (cur === baseCur.toUpperCase() ? Number(row.line_total || 0) : 0);
          }, 0);
          total_price = baseSum;
          singleCurrency = baseCur;
        }
      }
      return res.json({ ok:true, depth, base_currency: baseCur, lines, aggregate, totals_by_currency, total_price, total_currency: singleCurrency });
    } catch (e) { return res.status(500).json({ ok:false, error:'explode_failed', message: e?.message || String(e) }); }
  });

  // Helper to explode by BOM name: /api/bom/boms/explode?name=SO-1647&depth=2
  app.get('/api/bom/boms/explode', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
      const name = String(req.query?.name || '').trim();
      if (!name) return res.status(400).json({ ok:false, error:'missing_name' });
      const b = await pool.query('SELECT id FROM mod_bom_boms WHERE lower(name)=lower($1) LIMIT 1', [name]);
      if (!b.rowCount) return res.status(404).json({ ok:false, error:'bom_not_found' });
      req.params.id = String(b.rows[0].id);
      return app._router.handle(req, res);
    } catch (e) { return res.status(500).json({ ok:false, error:'explode_failed', message: e?.message || String(e) }); }
  });
}
