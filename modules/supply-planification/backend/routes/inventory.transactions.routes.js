import crypto from 'node:crypto';

function jsonError(res, status, error, message) {
  try {
    return res.status(status).json({ ok: false, error, ...(message ? { message } : {}) });
  } catch {
    return res.status(status).end();
  }
}

function requireAuth(ctx, req, res) {
  // Allow ADMIN_TOKEN header/query (and allow localhost when ADMIN_TOKEN is not configured),
  // otherwise fall back to cookie auth via ctx.requireAuth.
  try {
    const expected = String(process.env.ADMIN_TOKEN || '').trim();
    const got = (req.headers && (req.headers['x-admin-token'] || req.headers['X-Admin-Token'])) || (req.query && req.query.admin_token) || '';
    if (expected) {
      if (String(got) === expected) return { role: 'admin_token' };
    } else {
      const ip = String(req.ip || req.connection?.remoteAddress || '').trim();
      const isLocal = ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1') || ip.includes('::ffff:127.0.0.1');
      if (isLocal) return { role: 'localhost' };
    }
  } catch {}
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

function normalizeDate(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const m1 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m1) return `${m1[1]}-${String(m1[2]).padStart(2, '0')}-${String(m1[3]).padStart(2, '0')}`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) return `${m2[3]}-${String(m2[2]).padStart(2, '0')}-${String(m2[1]).padStart(2, '0')}`;
  return null;
}

async function loadLocations(pool, orgId) {
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
    return locations.length ? locations.slice(0, 12) : ['default'];
  } catch {
    return ['default'];
  }
}

async function getLatestQtyByItemLoc(pool, orgId, keys) {
  if (!keys.length) return new Map();
  const itemRefs = Array.from(new Set(keys.map((k) => k.item_ref)));
  const locs = Array.from(new Set(keys.map((k) => k.location_code)));
  const params = [orgId || null, itemRefs, locs];
  const r = await pool.query(
    `
    WITH latest AS (
      SELECT DISTINCT ON (l.item_ref, l.location_code)
             l.item_ref,
             l.location_code,
             l.qty
        FROM mod_supply_planification_inventory_batch_lines l
        JOIN mod_supply_planification_inventory_batches b ON b.id = l.batch_id
       WHERE (($1::int IS NULL AND l.org_id IS NULL) OR ($1::int IS NOT NULL AND (l.org_id IS NULL OR l.org_id = $1)))
         AND l.item_ref = ANY($2::text[])
         AND l.location_code = ANY($3::text[])
       ORDER BY l.item_ref, l.location_code, b.snapshot_date DESC, b.created_at DESC
    )
    SELECT * FROM latest
    `,
    params
  );
  const map = new Map();
  for (const row of r.rows || []) {
    map.set(`${row.item_ref}::${row.location_code}`, Number(row.qty || 0));
  }
  return map;
}

export function registerSupplyPlanificationInventoryTransactionsRoutes(app, ctx = {}, utils = {}) {
  const base = utils.base || '/api/supply-planification';
  const pool = utils.pool || ctx.pool;
  const pickOrgId = utils.pickOrgId || (() => null);
  const chatLog = utils.chatLog || (() => {});

  app.get(base + '/inventory/transactions', async (req, res) => {
    if (!requireAuth(ctx, req, res)) return;
    try {
      if (!pool) return jsonError(res, 503, 'db_unavailable');
      const orgId = pickOrgId(req);
      const kind = String(req.query?.kind || '').trim().toLowerCase();
      const limit = Math.max(1, Math.min(2000, Number(req.query?.limit || 200)));
      const args = [orgId || null];
      let where = `(($1::int IS NULL AND org_id IS NULL) OR ($1::int IS NOT NULL AND (org_id IS NULL OR org_id = $1)))`;
      if (kind) {
        args.push(kind);
        where += ` AND kind = $2`;
      }
      args.push(limit);
      const sql = `
        SELECT id, kind, item_ref, location_code, qty_delta, reason, source, source_po_id, source_po_line_id, snapshot_batch_id, created_at
          FROM mod_supply_planification_inventory_transactions
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${args.length}
      `;
      const r = await pool.query(sql, args);
      return res.json({ ok: true, items: r.rows || [] });
    } catch (e) {
      return jsonError(res, 500, 'server_error', String(e?.message || e));
    }
  });

  // Quick search for items (for adjustments picker)
  app.get(base + '/inventory/item-refs', async (req, res) => {
    if (!requireAuth(ctx, req, res)) return;
    try {
      if (!pool) return jsonError(res, 503, 'db_unavailable');
      const orgId = pickOrgId(req);
      const q = String(req.query?.q || '').trim();
      const limit = Math.max(1, Math.min(2000, Number(req.query?.limit || 50)));
      const args = [orgId || null];
      let p = 2;
      const where = [];
      where.push(`(($1::int IS NULL AND i.org_id IS NULL) OR ($1::int IS NOT NULL AND (i.org_id IS NULL OR i.org_id = $1)))`);
      if (q) {
        args.push(`%${q}%`);
        args.push(`%${q}%`);
        where.push(`(i.sku ILIKE $${p++} OR i.name ILIKE $${p++})`);
      }
      args.push(limit);
      const sql = `
        SELECT i.sku AS item_ref, COALESCE(i.description_short, i.name) AS description_short, i.procurement_type
          FROM mod_bom_items i
         WHERE ${where.join(' AND ')}
         ORDER BY i.sku
         LIMIT $${args.length}
      `;
      const r = await pool.query(sql, args);
      return res.json({ ok: true, items: r.rows || [] });
    } catch (e) {
      return jsonError(res, 500, 'server_error', String(e?.message || e));
    }
  });

  // List candidate PO lines (for Entrées section)
  app.get(base + '/inventory/po-lines', async (req, res) => {
    if (!requireAuth(ctx, req, res)) return;
    try {
      if (!pool) return jsonError(res, 503, 'db_unavailable');
      const orgId = pickOrgId(req);
      const q = String(req.query?.q || '').trim();
      const poLineId = Number(req.query?.po_line_id || req.query?.line_id || 0) || 0;
      const limit = Math.max(1, Math.min(2000, Number(req.query?.limit || 200)));

      const args = [orgId || null];
      let p = 2;
      const where = [];
      where.push(`(l.rest IS NULL OR l.rest > 0)`);
      // Entrées should only show lines with status "On going"
      where.push(`(btrim(COALESCE(l.status,'')) = 'On going')`);
      where.push(`(($1::int IS NULL AND l.org_id IS NULL) OR ($1::int IS NOT NULL AND (l.org_id IS NULL OR l.org_id = $1)))`);
      if (poLineId) {
        args.push(poLineId);
        where.push(`l.id = $${p++}`);
      }
      if (q) {
        args.push(`%${q}%`);
        args.push(`%${q}%`);
        args.push(`%${q}%`);
        where.push(`(o.po_number ILIKE $${p++} OR COALESCE(l.item_sku,'') ILIKE $${p++} OR COALESCE(l.item_name,'') ILIKE $${p++})`);
      }
      args.push(limit);

      const sql = `
        SELECT
          l.id AS po_line_id,
          l.purchase_order_id AS po_id,
          o.po_number,
          CASE WHEN o.po_date IS NULL THEN NULL ELSE to_char(o.po_date, 'YYYY-MM-DD') END AS po_date,
          o.supplier_name,
          l.item_sku,
          l.item_name,
          l.quantity,
          l.qty_delivered,
          l.rest,
          l.status,
          l.delivery_date AS delivery_date
        FROM mod_tools_purchase_order_lines l
        JOIN mod_tools_purchase_orders o ON o.id = l.purchase_order_id
        WHERE ${where.join(' AND ')}
        ORDER BY COALESCE(l.delivery_date, o.po_date) DESC, o.po_number DESC, l.line_no ASC
        LIMIT $${args.length}
      `;
      const r = await pool.query(sql, args);
      return res.json({ ok: true, items: r.rows || [] });
    } catch (e) {
      return jsonError(res, 500, 'server_error', String(e?.message || e));
    }
  });

  // Apply entries (from PO lines) to inventory: creates a new snapshot batch
  app.post(base + '/inventory/transactions/entries', async (req, res) => {
    if (!requireAdmin(ctx, req, res)) return;
    try {
      if (!pool) return jsonError(res, 503, 'db_unavailable');
      const orgId = pickOrgId(req);
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const lines = Array.isArray(body.lines) ? body.lines : [];
      if (!lines.length) return jsonError(res, 400, 'missing_lines');

      const locations = await loadLocations(pool, orgId);
      const snapshotDate = normalizeDate(body.snapshot_date) || new Date().toISOString().slice(0, 10);

      // Load PO lines and build deltas
      const lineIds = Array.from(new Set(lines.map((l) => Number(l.po_line_id || l.id || 0)).filter((n) => Number.isFinite(n) && n > 0)));
      if (!lineIds.length) return jsonError(res, 400, 'bad_line_ids');

      const poLines = await pool.query(
        `SELECT l.id, l.purchase_order_id, o.po_number, o.supplier_name, l.item_sku, l.item_name
           FROM mod_tools_purchase_order_lines l
           JOIN mod_tools_purchase_orders o ON o.id = l.purchase_order_id
          WHERE l.id = ANY($1::int[])`,
        [lineIds]
      );
      const byId = new Map((poLines.rows || []).map((r) => [Number(r.id), r]));
      const deltas = [];
      const txRows = [];

      for (const l of lines) {
        const lineId = Number(l.po_line_id || l.id || 0);
        const row = byId.get(lineId);
        if (!row) continue;
        const itemRef = String(row.item_sku || '').trim();
        if (!itemRef) continue;
        const loc = String(l.location_code || 'default').trim() || 'default';
        if (locations.length && !locations.includes(loc)) continue;
        const qty = Number(String(l.qty || l.qty_delta || l.quantity || '').replace(/\s+/g, '').replace(',', '.'));
        if (!Number.isFinite(qty) || qty === 0) continue;
        deltas.push({ item_ref: itemRef, location_code: loc, qty_delta: qty });
        txRows.push({
          id: crypto.randomUUID(),
          kind: 'entry',
          item_ref: itemRef,
          location_code: loc,
          qty_delta: qty,
          reason: String(l.reason || '').trim() || null,
          source: 'po-line',
          source_po_id: Number(row.purchase_order_id || 0) || null,
          source_po_line_id: lineId,
        });
      }
      if (!deltas.length) return jsonError(res, 400, 'no_valid_rows');

      // Compute new absolute qty for the affected item/location pairs
      const agg = new Map();
      for (const d of deltas) {
        const key = `${d.item_ref}::${d.location_code}`;
        agg.set(key, (agg.get(key) || 0) + Number(d.qty_delta || 0));
      }
      const keys = Array.from(agg.keys()).map((k) => {
        const [item_ref, location_code] = k.split('::');
        return { item_ref, location_code };
      });
      const latestMap = await getLatestQtyByItemLoc(pool, orgId, keys);

      const batchId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO mod_supply_planification_inventory_batches(id, org_id, snapshot_date, source, created_at)
         VALUES ($1,$2,$3::date,$4,NOW())`,
        [batchId, orgId || null, snapshotDate, 'tx-entry']
      );

      const lineInserts = [];
      for (const k of keys) {
        const delta = agg.get(`${k.item_ref}::${k.location_code}`) || 0;
        const baseQty = latestMap.get(`${k.item_ref}::${k.location_code}`) || 0;
        const nextQty = baseQty + delta;
        lineInserts.push({ item_ref: k.item_ref, location_code: k.location_code, qty: nextQty });
      }

      const chunkSize = 400;
      for (let i = 0; i < lineInserts.length; i += chunkSize) {
        const chunk = lineInserts.slice(i, i + chunkSize);
        const values = [];
        const args = [];
        let p = 1;
        for (const r of chunk) {
          args.push(orgId || null, batchId, r.location_code, r.item_ref, r.qty);
          values.push(`($${p++},$${p++},$${p++},$${p++},$${p++})`);
        }
        await pool.query(
          `INSERT INTO mod_supply_planification_inventory_batch_lines(org_id, batch_id, location_code, item_ref, qty)
           VALUES ${values.join(',')}
           ON CONFLICT (batch_id, item_ref, location_code)
           DO UPDATE SET qty=EXCLUDED.qty, org_id=EXCLUDED.org_id, created_at=NOW()`,
          args
        );
      }

      // Record transactions
      for (const tx of txRows) tx.snapshot_batch_id = batchId;
      const txChunk = 300;
      for (let i = 0; i < txRows.length; i += txChunk) {
        const chunk = txRows.slice(i, i + txChunk);
        const values = [];
        const args = [];
        let p = 1;
        for (const t of chunk) {
          args.push(
            t.id,
            orgId || null,
            t.kind,
            t.item_ref,
            t.location_code,
            t.qty_delta,
            t.reason,
            t.source,
            t.source_po_id,
            t.source_po_line_id,
            t.snapshot_batch_id
          );
          values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
        }
        await pool.query(
          `
          INSERT INTO mod_supply_planification_inventory_transactions
            (id, org_id, kind, item_ref, location_code, qty_delta, reason, source, source_po_id, source_po_line_id, snapshot_batch_id)
          VALUES ${values.join(',')}
          `,
          args
        );
      }

      chatLog('supply_planification_inventory_entries', { org_id: orgId, batch_id: batchId, lines: txRows.length });
      return res.json({ ok: true, batch_id: batchId, snapshot_date: snapshotDate, lines: txRows.length });
    } catch (e) {
      return jsonError(res, 500, 'server_error', String(e?.message || e));
    }
  });

  // Apply adjustments (+/-) to inventory: creates a new snapshot batch
  app.post(base + '/inventory/transactions/adjustments', async (req, res) => {
    if (!requireAdmin(ctx, req, res)) return;
    try {
      if (!pool) return jsonError(res, 503, 'db_unavailable');
      const orgId = pickOrgId(req);
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return jsonError(res, 400, 'missing_items');

      const locations = await loadLocations(pool, orgId);
      const snapshotDate = normalizeDate(body.snapshot_date) || new Date().toISOString().slice(0, 10);

      const deltas = [];
      const txRows = [];
      for (const it of items) {
        const itemRef = String(it.item_ref || '').trim();
        if (!itemRef) continue;
        const loc = String(it.location_code || 'default').trim() || 'default';
        if (locations.length && !locations.includes(loc)) continue;
        const qty = Number(String(it.qty_delta || it.qty || '').replace(/\s+/g, '').replace(',', '.'));
        if (!Number.isFinite(qty) || qty === 0) continue;
        deltas.push({ item_ref: itemRef, location_code: loc, qty_delta: qty });
        txRows.push({
          id: crypto.randomUUID(),
          kind: 'adjustment',
          item_ref: itemRef,
          location_code: loc,
          qty_delta: qty,
          reason: String(it.reason || '').trim() || null,
          source: 'ui',
          source_po_id: null,
          source_po_line_id: null,
        });
      }
      if (!deltas.length) return jsonError(res, 400, 'no_valid_rows');

      const agg = new Map();
      for (const d of deltas) {
        const key = `${d.item_ref}::${d.location_code}`;
        agg.set(key, (agg.get(key) || 0) + Number(d.qty_delta || 0));
      }
      const keys = Array.from(agg.keys()).map((k) => {
        const [item_ref, location_code] = k.split('::');
        return { item_ref, location_code };
      });
      const latestMap = await getLatestQtyByItemLoc(pool, orgId, keys);

      const batchId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO mod_supply_planification_inventory_batches(id, org_id, snapshot_date, source, created_at)
         VALUES ($1,$2,$3::date,$4,NOW())`,
        [batchId, orgId || null, snapshotDate, 'tx-adjustment']
      );

      const lineInserts = [];
      for (const k of keys) {
        const delta = agg.get(`${k.item_ref}::${k.location_code}`) || 0;
        const baseQty = latestMap.get(`${k.item_ref}::${k.location_code}`) || 0;
        const nextQty = baseQty + delta;
        lineInserts.push({ item_ref: k.item_ref, location_code: k.location_code, qty: nextQty });
      }

      const chunkSize = 400;
      for (let i = 0; i < lineInserts.length; i += chunkSize) {
        const chunk = lineInserts.slice(i, i + chunkSize);
        const values = [];
        const args = [];
        let p = 1;
        for (const r of chunk) {
          args.push(orgId || null, batchId, r.location_code, r.item_ref, r.qty);
          values.push(`($${p++},$${p++},$${p++},$${p++},$${p++})`);
        }
        await pool.query(
          `INSERT INTO mod_supply_planification_inventory_batch_lines(org_id, batch_id, location_code, item_ref, qty)
           VALUES ${values.join(',')}
           ON CONFLICT (batch_id, item_ref, location_code)
           DO UPDATE SET qty=EXCLUDED.qty, org_id=EXCLUDED.org_id, created_at=NOW()`,
          args
        );
      }

      for (const tx of txRows) tx.snapshot_batch_id = batchId;
      const txChunk = 300;
      for (let i = 0; i < txRows.length; i += txChunk) {
        const chunk = txRows.slice(i, i + txChunk);
        const values = [];
        const args = [];
        let p = 1;
        for (const t of chunk) {
          args.push(
            t.id,
            orgId || null,
            t.kind,
            t.item_ref,
            t.location_code,
            t.qty_delta,
            t.reason,
            t.source,
            t.source_po_id,
            t.source_po_line_id,
            t.snapshot_batch_id
          );
          values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
        }
        await pool.query(
          `
          INSERT INTO mod_supply_planification_inventory_transactions
            (id, org_id, kind, item_ref, location_code, qty_delta, reason, source, source_po_id, source_po_line_id, snapshot_batch_id)
          VALUES ${values.join(',')}
          `,
          args
        );
      }

      chatLog('supply_planification_inventory_adjustments', { org_id: orgId, batch_id: batchId, lines: txRows.length });
      return res.json({ ok: true, batch_id: batchId, snapshot_date: snapshotDate, lines: txRows.length });
    } catch (e) {
      return jsonError(res, 500, 'server_error', String(e?.message || e));
    }
  });
}
