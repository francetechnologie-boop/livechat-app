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

function requireAdmin(ctx, req, res) {
  try {
    if (ctx && typeof ctx.requireAdmin === 'function') return ctx.requireAdmin(req, res);
  } catch {}
  jsonError(res, 401, 'unauthorized');
  return null;
}

async function getCoverageLocations(pool, orgId) {
  try {
    const args = ['settings'];
    let where = 'key=$1';
    if (orgId) {
      args.push(orgId);
      where += ' AND (org_id IS NULL OR org_id = $2)';
    }
    const r = await pool.query(`SELECT value FROM mod_supply_planification_settings WHERE ${where} ORDER BY updated_at DESC LIMIT 1`, args);
    const v = r.rowCount ? (r.rows[0] && r.rows[0].value ? r.rows[0].value : {}) : {};
    const locations = Array.isArray(v.locations) ? v.locations.map((x) => String(x || '').trim()).filter(Boolean) : [];
    return locations.length ? locations.slice(0, 8) : ['default'];
  } catch {
    return ['default'];
  }
}

function normalizeDate(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m1) return `${m1[1]}-${String(m1[2]).padStart(2, '0')}-${String(m1[3]).padStart(2, '0')}`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${String(m2[2]).padStart(2, '0')}-${String(m2[1]).padStart(2, '0')}`;
  return null;
}

export function registerSupplyPlanificationInventoryItemsRoutes(app, ctx = {}, utils = {}) {
  const base = utils.base || '/api/supply-planification';
  const pool = utils.pool || ctx.pool;
  const pickOrgId = utils.pickOrgId || (() => null);
  const chatLog = utils.chatLog || (() => {});

  // List all items with latest inventory per location (editable table source)
  app.get(base + '/inventory/items', async (req, res) => {
    if (!requireAuth(ctx, req, res)) return;
    try {
      if (!pool) return jsonError(res, 503, 'db_unavailable');
      const orgId = pickOrgId(req);
      const q = String(req.query?.q || '').trim();
      const limit = Math.max(1, Math.min(5000, Number(req.query?.limit || 2000)));
      const locations = await getCoverageLocations(pool, orgId);

      const args = [orgId || null];
      let p = 2;
      const where = [];
      // org-scoped items (allow global items with org_id NULL)
      where.push(`(($1::int IS NULL AND i.org_id IS NULL) OR ($1::int IS NOT NULL AND (i.org_id IS NULL OR i.org_id = $1)))`);
      if (q) {
        args.push(`%${q}%`);
        args.push(`%${q}%`);
        where.push(`(i.sku ILIKE $${p++} OR i.name ILIKE $${p++})`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      args.push(limit);

      const sql = `
        WITH items AS (
          SELECT i.id,
                 i.sku AS item_ref,
                 COALESCE(i.description_short, i.name) AS description_short,
                 i.procurement_type
            FROM mod_bom_items i
           ${whereSql}
           ORDER BY i.sku
           LIMIT $${p}
        ),
        inv_latest AS (
          SELECT DISTINCT ON (l.item_ref, l.location_code)
                 l.item_ref,
                 l.location_code,
                 b.snapshot_date,
                 l.qty
            FROM mod_supply_planification_inventory_batch_lines l
            JOIN mod_supply_planification_inventory_batches b ON b.id = l.batch_id
           WHERE ($1::int IS NULL AND l.org_id IS NULL) OR ($1::int IS NOT NULL AND (l.org_id IS NULL OR l.org_id = $1))
           ORDER BY l.item_ref, l.location_code, b.snapshot_date DESC, b.created_at DESC
        ),
        vendors AS (
          SELECT DISTINCT ON (iv.item_id)
                 iv.item_id,
                 s.name AS supplier
            FROM mod_bom_item_vendors iv
            LEFT JOIN mod_bom_suppliers s ON s.id = iv.supplier_id
           ORDER BY iv.item_id, iv.preferred DESC, COALESCE(iv.priority, 999) ASC, iv.id DESC
        )
        SELECT
          it.item_ref,
          it.description_short,
          it.procurement_type,
          v.supplier,
          COALESCE(
            (SELECT MAX(snapshot_date) FROM inv_latest il WHERE il.item_ref = it.item_ref),
            NULL
          ) AS date_of_last_inventory,
          jsonb_object_agg(il.location_code, il.qty) FILTER (WHERE il.location_code IS NOT NULL) AS qty_by_location,
          COALESCE((SELECT SUM(il.qty)::numeric FROM inv_latest il WHERE il.item_ref = it.item_ref), 0)::numeric AS qty_total
        FROM items it
        LEFT JOIN vendors v ON v.item_id = it.id
        LEFT JOIN inv_latest il ON il.item_ref = it.item_ref
        GROUP BY it.item_ref, it.description_short, it.procurement_type, v.supplier
        ORDER BY it.item_ref;
      `;

      const r = await pool.query(sql, args);
      const rows = r.rows || [];

      const items = rows.map((row) => {
        const byLoc = row.qty_by_location && typeof row.qty_by_location === 'object' ? row.qty_by_location : {};
        const values = {};
        for (const loc of locations) {
          const rawQty = byLoc[loc];
          values[loc] = rawQty == null ? '' : Number(rawQty);
        }
        return {
          supplier: row.supplier || null,
          item_ref: row.item_ref,
          description_short: row.description_short || null,
          procurement_type: row.procurement_type || '',
          date_of_last_inventory: row.date_of_last_inventory || null,
          qty_total: row.qty_total != null ? Number(row.qty_total) : 0,
          locations,
          qty_by_location: values,
        };
      });

      return res.json({ ok: true, locations, items });
    } catch (e) {
      return jsonError(res, 500, 'server_error', String(e?.message || e));
    }
  });

  // Save inventory edits by writing a new batch with snapshot_date (default today)
  app.put(base + '/inventory/items', async (req, res) => {
    if (!requireAdmin(ctx, req, res)) return;
    try {
      if (!pool) return jsonError(res, 503, 'db_unavailable');
      const orgId = pickOrgId(req);
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const snapshotDate = normalizeDate(body.snapshot_date) || new Date().toISOString().slice(0, 10);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return jsonError(res, 400, 'missing_items');

      const locations = await getCoverageLocations(pool, orgId);

      // Create a new batch
      const batchId = (await import('node:crypto')).randomUUID();
      await pool.query(
        `INSERT INTO mod_supply_planification_inventory_batches(id, org_id, snapshot_date, source, created_at)
         VALUES ($1,$2,$3::date,$4,NOW())`,
        [batchId, orgId || null, snapshotDate, 'ui-edit']
      );

      const rows = [];
      for (const it of items) {
        const ref = String(it.item_ref || '').trim();
        if (!ref) continue;
        const byLoc = (it.qty_by_location && typeof it.qty_by_location === 'object') ? it.qty_by_location : {};
        for (const loc of locations) {
          if (byLoc[loc] === undefined) continue;
          const n = Number(String(byLoc[loc]).replace(/\s+/g, '').replace(',', '.'));
          if (!Number.isFinite(n)) continue;
          rows.push({ item_ref: ref, location_code: loc, qty: n });
        }
      }
      if (!rows.length) return jsonError(res, 400, 'no_valid_rows');

      const chunkSize = 400;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const values = [];
        const args = [];
        let p = 1;
        for (const r of chunk) {
          args.push(orgId || null, batchId, r.location_code, r.item_ref, r.qty);
          values.push(`($${p++},$${p++},$${p++},$${p++},$${p++})`);
        }
        await pool.query(
          `
          INSERT INTO mod_supply_planification_inventory_batch_lines(org_id, batch_id, location_code, item_ref, qty)
          VALUES ${values.join(',')}
          ON CONFLICT (batch_id, item_ref, location_code)
          DO UPDATE SET qty=EXCLUDED.qty, org_id=EXCLUDED.org_id, created_at=NOW()
          `,
          args
        );
      }

      chatLog('supply_planification_inventory_edit', {
        org_id: orgId,
        batch_id: batchId,
        snapshot_date: snapshotDate,
        items: items.length,
        rows: rows.length,
      });

      return res.json({ ok: true, batch_id: batchId, snapshot_date: snapshotDate, rows: rows.length });
    } catch (e) {
      return jsonError(res, 500, 'server_error', String(e?.message || e));
    }
  });
}
