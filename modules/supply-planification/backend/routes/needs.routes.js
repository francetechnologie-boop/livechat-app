import { connectMySql, makeSqlHelpers } from '../../../grabbing-jerome/backend/services/transfer/mysql.js';

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

function sanitizePrefix(raw) {
  try {
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/[^0-9A-Za-z_]/g, '');
    if (!s) return '';
    if (!s.endsWith('_')) s += '_';
    return s;
  } catch {
    return '';
  }
}

function parsePrefixList(raw) {
  try {
    if (Array.isArray(raw)) return raw.map(sanitizePrefix).filter(Boolean);
    if (raw == null) return [];
    return String(raw)
      .split(/[\n,]+/g)
      .map(sanitizePrefix)
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function loadSettings(pool, orgId) {
  const args = ['settings'];
  let where = 'key=$1';
  if (orgId) {
    args.push(orgId);
    where += ' AND (org_id IS NULL OR org_id = $2)';
  }
  const r = await pool.query(`SELECT value FROM mod_supply_planification_settings WHERE ${where} ORDER BY updated_at DESC LIMIT 1`, args);
  const value = r.rowCount ? (r.rows[0]?.value || {}) : {};
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function loadMysqlProfile(pool, orgId, profileId) {
  const pid = Number(profileId || 0);
  if (!pid) return null;
  const args = [pid];
  let whereOrg = '';
  if (orgId != null) {
    args.push(String(orgId));
    whereOrg = ' AND (org_id IS NULL OR org_id = $2)';
  }
  const r = await pool.query(
    `SELECT id, host, port, "database", db_user AS "user", db_password AS "password", ssl, table_prefixes
       FROM mod_db_mysql_profiles
      WHERE id=$1${whereOrg}
      LIMIT 1`,
    args
  );
  return r.rowCount ? r.rows[0] : null;
}

async function hasPgPrestaTables(pool) {
  try {
    const r = await pool.query(
      "SELECT to_regclass('public.ps_orders') AS o, to_regclass('public.ps_order_detail') AS d, to_regclass('public.ps_product_type_resolved') AS r"
    );
    const row = r.rows && r.rows[0];
    return !!(row?.o && row?.d && row?.r);
  } catch {
    return false;
  }
}

async function fetchBomMeta(pool, orgId) {
  const args = [orgId || null];
  const sql = `
    SELECT
      lower(b.name) AS bom_key,
      b.name AS bom_name,
      COALESCE(mi.sku, b.name) AS item_sku,
      COALESCE(mi.name, b.description, b.name) AS description,
      array_remove(array_agg(DISTINCT s.name), NULL) AS suppliers,
      SUM(COALESCE(bi.quantity, 0)) AS components_per_unit
    FROM mod_bom_boms b
    LEFT JOIN mod_bom_bom_items bi ON bi.bom_id = b.id
      AND (($1::int IS NULL AND bi.org_id IS NULL) OR ($1::int IS NOT NULL AND (bi.org_id IS NULL OR bi.org_id = $1)))
    LEFT JOIN mod_bom_items mi ON mi.id = bi.item_id
      AND (($1::int IS NULL AND mi.org_id IS NULL) OR ($1::int IS NOT NULL AND (mi.org_id IS NULL OR mi.org_id = $1)))
    LEFT JOIN mod_bom_suppliers s ON s.id = mi.supplier_id
    WHERE (($1::int IS NULL AND b.org_id IS NULL) OR ($1::int IS NOT NULL AND (b.org_id IS NULL OR b.org_id = $1)))
    GROUP BY lower(b.name), b.name, item_sku, description
  `;
  const r = await pool.query(sql, args);
  return r.rows || [];
}

async function fetchPgSales(pool, startDateIso, states, shops) {
  const args = [startDateIso, states.length ? states : null, shops.length ? shops : null];
  const sql = `
    WITH params AS (
      SELECT
        $1::date AS start_date,
        $2::int[] AS states,
        $3::int[] AS shops
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
    )
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
    ORDER BY year DESC, month DESC, r.bom_name
  `;
  const r = await pool.query(sql, args);
  return r.rows || [];
}

async function pickMysqlPrefix(q, hasTable, schema, prefixes = []) {
  const candidates = [...new Set([...prefixes, 'ps_'])];
  for (const cand of candidates) {
    const prefix = sanitizePrefix(cand);
    if (!prefix) continue;
    try {
      const ok = await hasTable(`${prefix}orders`, schema);
      if (ok) return prefix;
    } catch {}
  }
  try {
    const rows = await q(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name LIKE ? ORDER BY table_name LIMIT 10`,
      [schema, '%orders']
    );
    const hit = Array.isArray(rows) ? rows.find((r) => String(r.table_name || '').toLowerCase().endsWith('orders')) : null;
    if (hit) {
      const tn = String(hit.table_name || '');
      return tn.slice(0, Math.max(0, tn.length - 'orders'.length));
    }
  } catch {}
  return null;
}

async function fetchMysqlSales(ctx, profile, startDateIso, states, shops) {
  const conn = await connectMySql(ctx, {
    host: profile.host,
    port: Number(profile.port || 3306),
    user: profile.user,
    password: profile.password,
    database: profile.database,
    ...(profile.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  const { q, qi, hasTable } = makeSqlHelpers(conn);
  try {
    const schema = String(profile.database || '').trim();
    if (!schema) {
      const err = new Error('mysql_database_missing');
      err.code = 'MYSQL_DATABASE_MISSING';
      throw err;
    }
    const prefix = await pickMysqlPrefix(q, hasTable, schema, parsePrefixList(profile.table_prefixes));
    if (!prefix) {
      const err = new Error('mysql_orders_table_missing');
      err.code = 'MYSQL_ORDERS_TABLE_MISSING';
      throw err;
    }
    const orders = qi(`${prefix}orders`);
    const orderDetail = qi(`${prefix}order_detail`);
    const resolved = qi(`${prefix}product_type_resolved`);
    const conds = ['o.date_add >= ?'];
    const args = [startDateIso];
    if (states && states.length) {
      conds.push(`o.current_state IN (${states.map(() => '?').join(',')})`);
      args.push(...states);
    }
    if (shops && shops.length) {
      conds.push(`o.id_shop IN (${shops.map(() => '?').join(',')})`);
      args.push(...shops);
    }
    const sql = `
      SELECT
        YEAR(COALESCE(CONVERT_TZ(o.date_add, @@session.time_zone, 'Europe/Prague'), o.date_add)) AS year,
        MONTH(COALESCE(CONVERT_TZ(o.date_add, @@session.time_zone, 'Europe/Prague'), o.date_add)) AS month,
        NULLIF(TRIM(r.BOM_name), '') AS bom_name,
        SUM(od.product_quantity) AS units_sold
      FROM ${orders} o
      JOIN ${orderDetail} od ON od.id_order = o.id_order
      LEFT JOIN ${resolved} r ON r.id_product = od.product_id AND COALESCE(r.id_product_attribute, 0) = COALESCE(od.product_attribute_id, 0)
      WHERE ${conds.join(' AND ')}
        AND NULLIF(TRIM(r.BOM_name), '') IS NOT NULL
      GROUP BY year, month, bom_name
      ORDER BY year DESC, month DESC, bom_name
    `;
    const rows = await q(sql, args);
    return Array.isArray(rows) ? rows : [];
  } finally {
    try { await conn.end(); } catch {}
  }
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

      const now = new Date();
      const startYear = now.getFullYear() - years + 1;
      const startDateIso = `${startYear}-01-01`;

      const settings = await loadSettings(pool, orgId);
      const mysqlProfileId = settings.mysql_profile_id && Number.isFinite(Number(settings.mysql_profile_id))
        ? Number(settings.mysql_profile_id)
        : null;

      const bomMeta = await fetchBomMeta(pool, orgId);
      const metaMap = new Map();
      for (const m of bomMeta) {
        const key = String(m.bom_key || '').trim();
        if (!metaMap.has(key)) metaMap.set(key, m);
      }

      let sales = null;
      let source = null;
      let mysqlError = null;

      if (mysqlProfileId) {
        try {
          const profile = await loadMysqlProfile(pool, orgId, mysqlProfileId);
          if (!profile) return jsonError(res, 404, 'mysql_profile_not_found', 'MySQL profile not found or not accessible for this org.');
          sales = await fetchMysqlSales(ctx, profile, startDateIso, states, shops);
          source = `mysql:${profile.id}`;
        } catch (err) {
          mysqlError = err;
          try { chatLog('supply_planification_mysql_error', { error: String(err?.message || err), profile_id: mysqlProfileId }); } catch {}
        }
      }

      if (!sales) {
        const canUsePg = await hasPgPrestaTables(pool);
        if (!canUsePg) {
          const message = mysqlProfileId
            ? `MySQL query failed (${mysqlError?.message || 'see logs'}) and ps_orders/order_detail/product_type_resolved are not present in Postgres`
            : 'Select a MySQL profile in Supply Planification settings or expose ps_orders/order_detail/product_type_resolved in Postgres.';
          return jsonError(res, 503, 'orders_source_unavailable', message);
        }
        sales = await fetchPgSales(pool, startDateIso, states, shops);
        source = 'postgres';
      }

      const supplierNeedle = supplierRaw.toLowerCase();
      const rows = [];
      for (const row of sales) {
        const bomName = row.bom_name || '';
        const key = bomName.toLowerCase();
        if (!key) continue;
        const meta = metaMap.get(key) || null;
        const suppliers = Array.isArray(meta?.suppliers) ? meta.suppliers : [];
        if (supplierNeedle) {
          const matchesSupplier = suppliers.some((s) => String(s || '').toLowerCase().includes(supplierNeedle));
          if (!matchesSupplier) continue;
        }
        const unitsSold = Number(row.units_sold ?? 0);
        const perUnit = Number(meta?.components_per_unit ?? 0);
        rows.push({
          year: Number(row.year),
          month: Number(row.month),
          bom_name: bomName,
          item: meta?.item_sku || bomName,
          description: meta?.description || bomName,
          suppliers,
          units_sold: Number.isFinite(unitsSold) ? unitsSold : 0,
          component_need: Number.isFinite(unitsSold) ? unitsSold * (Number.isFinite(perUnit) && perUnit !== 0 ? perUnit : 1) : 0,
        });
      }

      rows.sort((a, b) => {
        if (Number(b.year || 0) !== Number(a.year || 0)) return Number(b.year || 0) - Number(a.year || 0);
        if (Number(b.month || 0) !== Number(a.month || 0)) return Number(b.month || 0) - Number(a.month || 0);
        return String(a.bom_name || '').localeCompare(String(b.bom_name || ''));
      });

      return res.json({
        ok: true,
        source,
        params: {
          start_date: startDateIso,
          years,
          states,
          shops,
          supplier: supplierRaw || null,
        },
        rows,
      });
    } catch (e) {
      try { chatLog('supply_planification_needs_error', { error: String(e?.message || e) }); } catch {}
      return jsonError(res, 500, 'server_error', String(e?.message || e));
    }
  });
}
