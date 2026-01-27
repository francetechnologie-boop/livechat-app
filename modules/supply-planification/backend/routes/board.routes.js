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

async function loadCoverageDays(pool, orgId) {
  try {
    const args = ['settings'];
    let where = 'key=$1';
    if (orgId) {
      args.push(orgId);
      where += ' AND (org_id IS NULL OR org_id = $2)';
    }
    const r = await pool.query(`SELECT value FROM mod_supply_planification_settings WHERE ${where} ORDER BY updated_at DESC LIMIT 1`, args);
    const v = r.rowCount ? (r.rows[0]?.value || {}) : {};
    const cd = Number(v.coverage_days || 220);
    return Number.isFinite(cd) && cd > 0 ? cd : 220;
  } catch {
    return 220;
  }
}

export function registerSupplyPlanificationBoardRoutes(app, ctx = {}, utils = {}) {
  const base = utils.base || '/api/supply-planification';
  const pool = utils.pool || ctx.pool;
  const pickOrgId = utils.pickOrgId || (() => null);

  app.get(base + '/board', async (req, res) => {
    if (!requireAuth(ctx, req, res)) return;
    try {
      if (!pool) return jsonError(res, 503, 'db_unavailable');
      const orgId = pickOrgId(req);
      const q = String(req.query?.q || '').trim();
      const limit = Math.max(1, Math.min(2000, Number(req.query?.limit || 500)));
      const coverageDays = await loadCoverageDays(pool, orgId);

      const args = [];
      let p = 1;
      const where = [];
      if (orgId) {
        args.push(orgId);
        where.push(`(l.org_id IS NULL OR l.org_id = $${p++})`);
      }
      if (q) {
        args.push(`%${q}%`);
        where.push(`(l.item_ref ILIKE $${p++})`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      args.push(limit);

      const sql = `
        WITH latest AS (
          SELECT DISTINCT ON (l.item_ref)
                 l.item_ref,
                 b.snapshot_date,
                 b.created_at AS batch_created_at,
                 b.id AS batch_id
            FROM mod_supply_planification_inventory_batch_lines l
            JOIN mod_supply_planification_inventory_batches b ON b.id = l.batch_id
            ${whereSql}
            ORDER BY l.item_ref, b.snapshot_date DESC, b.created_at DESC
        )
        SELECT
          latest.item_ref AS supplier_reference,
          latest.snapshot_date AS date_of_last_inventory,
          SUM(l.qty)::numeric AS qty_last_inventory,
          jsonb_agg(
            jsonb_build_object('location_code', l.location_code, 'qty', l.qty)
            ORDER BY l.location_code
          ) AS locations,
          COALESCE(v.supplier_item_code, vp.supplier_item_code, latest.item_ref) AS supplier_item_code,
          s.name AS supplier_name,
          i.sku AS item_sku,
          COALESCE(i.description_short, i.name) AS description_short
        FROM latest
        JOIN mod_supply_planification_inventory_batch_lines l
          ON l.batch_id = latest.batch_id AND l.item_ref = latest.item_ref
        LEFT JOIN LATERAL (
          SELECT iv.item_id, iv.supplier_id, iv.supplier_item_code
            FROM mod_bom_item_vendors iv
           WHERE lower(btrim(iv.supplier_item_code)) = lower(btrim(latest.item_ref))
           ORDER BY iv.preferred DESC, COALESCE(iv.priority, 999) ASC, iv.id DESC
           LIMIT 1
        ) v ON TRUE
        LEFT JOIN LATERAL (
          SELECT i.id AS item_id
            FROM mod_bom_items i
           WHERE lower(btrim(i.sku)) = lower(btrim(latest.item_ref))
              OR (i.reference IS NOT NULL AND lower(btrim(i.reference)) = lower(btrim(latest.item_ref)))
           ORDER BY
             CASE WHEN lower(btrim(i.sku)) = lower(btrim(latest.item_ref)) THEN 0 ELSE 1 END,
             i.id DESC
           LIMIT 1
        ) im ON TRUE
        LEFT JOIN mod_bom_items i ON i.id = COALESCE(v.item_id, im.item_id)
        LEFT JOIN LATERAL (
          SELECT iv.supplier_id, iv.supplier_item_code
            FROM mod_bom_item_vendors iv
           WHERE i.id IS NOT NULL AND iv.item_id = i.id
           ORDER BY iv.preferred DESC, COALESCE(iv.priority, 999) ASC, iv.id DESC
           LIMIT 1
        ) vp ON TRUE
        LEFT JOIN mod_bom_suppliers s ON s.id = COALESCE(v.supplier_id, vp.supplier_id)
        GROUP BY
          latest.item_ref,
          latest.snapshot_date,
          v.supplier_item_code,
          vp.supplier_item_code,
          s.name,
          i.sku,
          i.description_short,
          i.name
        ORDER BY latest.snapshot_date DESC NULLS LAST, supplier_name NULLS LAST, supplier_reference
        LIMIT $${p}
      `;

      const r = await pool.query(sql, args);
      const items = (r.rows || []).map((row) => {
        const qtyLast = row.qty_last_inventory != null ? Number(row.qty_last_inventory) : 0;
        return {
          supplier: row.supplier_name || null,
          supplier_reference: row.supplier_reference || null,
          description_short: row.description_short || null,
          date_of_last_inventory: row.date_of_last_inventory || null,
          qty_last_inventory: qtyLast,
          qty_needed_since_last_inventory: 0,
          estimated_inventory: qtyLast,
          qty_item_needed_next_period: 0,
          qty_on_order: 0,
          qty_to_get: 0,
          locations: row.locations || [],
          _match: {
            item_sku: row.item_sku || null,
            supplier_item_code: row.supplier_item_code || null,
          },
        };
      });

      return res.json({ ok: true, coverage_days: coverageDays, items });
    } catch (e) {
      return jsonError(res, 500, 'server_error', String(e?.message || e));
    }
  });
}
