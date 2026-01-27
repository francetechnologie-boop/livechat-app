function jsonError(res, status, error, message) {
  try {
    return res.status(status).json({ ok: false, error, ...(message ? { message } : {}) });
  } catch {
    return res.status(status).end();
  }
}

function requireAuth(ctx, req, res) {
  try {
    if (ctx && typeof ctx.requireAuth === 'function') return ctx.requireAuth(req, res);
  } catch {}
  jsonError(res, 401, 'unauthorized');
  return null;
}

function parseIntList(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  return s
    .split(',')
    .map((v) => Number(String(v).trim()))
    .filter((n) => Number.isFinite(n));
}

function clampYears(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(5, n));
}

export function registerSupplyPlanificationNeedsRoutes(app, ctx = {}, utils = {}) {
  const base = utils.base || '/api/supply-planification';
  const pool = utils.pool || ctx.pool;
  const pickOrgId = utils.pickOrgId || (() => null);
  const chatLog = utils.chatLog || (() => {});

  app.get(base + '/needs/monthly', async (req, res) => {
    if (!requireAuth(ctx, req, res)) return;
    try {
      if (!pool) return jsonError(res, 503, 'db_unavailable');

      const orgId = pickOrgId(req);
      const years = clampYears(req.query?.years || req.query?.years_back || 3);
      const states = parseIntList(req.query?.states || req.query?.state || req.query?.order_states);
      const shops = parseIntList(req.query?.shops || req.query?.shop_ids || req.query?.shop);
      const supplierRaw = String(req.query?.supplier || req.query?.supplier_name || '').trim();
      const supplierFilter = supplierRaw ? `%${supplierRaw}%` : '';

      const now = new Date();
      const startYear = now.getFullYear() - years + 1;
      const startDateIso = `${startYear}-01-01`;

      const args = [startDateIso, states.length ? states : null, shops.length ? shops : null, supplierFilter || '', orgId || null];

      const sql = `
        WITH params AS (
          SELECT
            $1::date AS start_date,
            $2::int[] AS states,
            $3::int[] AS shops,
            $4::text AS supplier_filter
        ),
        orders AS (
          SELECT
            o.id_order,
            o.current_state,
            o.id_shop,
            timezone('Europe/Prague', o.date_add) AS local_date
          FROM ps_orders o, params p
          WHERE o.date_add >= p.start_date
            AND (p.states IS NULL OR array_length(p.states, 1) IS NULL OR o.current_state = ANY(p.states))
            AND (p.shops IS NULL OR array_length(p.shops, 1) IS NULL OR o.id_shop = ANY(p.shops))
        ),
        order_lines AS (
          SELECT
            od.id_order,
            od.product_id,
            COALESCE(od.product_attribute_id, 0) AS attr_id,
            SUM(od.product_quantity) AS qty_ordered
          FROM ps_order_detail od
          JOIN orders o ON o.id_order = od.id_order
          GROUP BY od.id_order, od.product_id, attr_id
        ),
        resolved AS (
          SELECT
            r.id_product,
            COALESCE(r.id_product_attribute, 0) AS attr_id,
            NULLIF(btrim(r.BOM_name), '') AS bom_name
          FROM ps_product_type_resolved r
        ),
        bom_sales AS (
          SELECT
            EXTRACT(YEAR FROM o.local_date)::int AS year,
            EXTRACT(MONTH FROM o.local_date)::int AS month,
            r.bom_name,
            SUM(l.qty_ordered)::numeric AS units_sold
          FROM order_lines l
          JOIN orders o ON o.id_order = l.id_order
          LEFT JOIN resolved r ON r.id_product = l.product_id AND r.attr_id = l.attr_id
          WHERE r.bom_name IS NOT NULL
          GROUP BY year, month, r.bom_name
        ),
        bom_meta AS (
          SELECT
            lower(b.name) AS bom_key,
            b.name AS bom_name,
            COALESCE(mi.sku, b.name) AS item_sku,
            COALESCE(mi.name, b.description, b.name) AS description,
            array_remove(array_agg(DISTINCT s.name), NULL) AS suppliers,
            SUM(COALESCE(bi.quantity, 0)) AS components_per_unit
          FROM mod_bom_boms b
          LEFT JOIN mod_bom_bom_items bi ON bi.bom_id = b.id
            AND (($5::int IS NULL AND bi.org_id IS NULL) OR ($5::int IS NOT NULL AND (bi.org_id IS NULL OR bi.org_id = $5)))
          LEFT JOIN mod_bom_items mi ON mi.id = bi.item_id
            AND (($5::int IS NULL AND mi.org_id IS NULL) OR ($5::int IS NOT NULL AND (mi.org_id IS NULL OR mi.org_id = $5)))
          LEFT JOIN mod_bom_suppliers s ON s.id = mi.supplier_id
          WHERE (($5::int IS NULL AND b.org_id IS NULL) OR ($5::int IS NOT NULL AND (b.org_id IS NULL OR b.org_id = $5)))
          GROUP BY lower(b.name), b.name, item_sku, description
        )
        SELECT
          s.year,
          s.month,
          s.bom_name,
          COALESCE(m.item_sku, s.bom_name) AS item,
          COALESCE(m.description, s.bom_name) AS description,
          COALESCE(m.suppliers, ARRAY[]::text[]) AS suppliers,
          s.units_sold,
          (s.units_sold * COALESCE(NULLIF(m.components_per_unit, 0), 1)) AS component_need
        FROM bom_sales s
        LEFT JOIN bom_meta m ON lower(m.bom_name) = lower(s.bom_name)
        WHERE ($4 = '' OR EXISTS (SELECT 1 FROM unnest(COALESCE(m.suppliers, ARRAY[]::text[])) AS x WHERE x ILIKE $4))
        ORDER BY s.year DESC, s.month DESC, s.bom_name;
      `;

      const r = await pool.query(sql, args);
      const rows = r.rows || [];

      return res.json({
        ok: true,
        params: {
          start_date: startDateIso,
          years,
          states,
          shops,
          supplier: supplierRaw || null,
        },
        rows: rows.map((row) => ({
          year: Number(row.year),
          month: Number(row.month),
          bom_name: row.bom_name,
          item: row.item,
          description: row.description,
          suppliers: Array.isArray(row.suppliers) ? row.suppliers : [],
          units_sold: Number(row.units_sold ?? 0),
          component_need: Number(row.component_need ?? 0),
        })),
      });
    } catch (e) {
      try { chatLog('supply_planification_needs_error', { error: String(e?.message || e) }); } catch {}
      return jsonError(res, 500, 'server_error', String(e?.message || e));
    }
  });
}
