import nodePath from 'node:path';
import { createRequire } from 'node:module';

function pickOrgId(req) {
  try { return (req.headers['x-org-id'] || req.query?.org_id || null) ? String(req.headers['x-org-id'] || req.query.org_id) : null; } catch { return null; }
}

function resolveBackendDir(ctx) {
  if (ctx && ctx.backendDir) return ctx.backendDir;
  try {
    const here = nodePath.dirname(new URL(import.meta.url).pathname);
    return nodePath.resolve(here, '..', '..', '..', 'backend');
  } catch { return process.cwd(); }
}

async function getMysql2(ctx) {
  // Reuse loader from db-mysql module when available; fall back to direct import
  try {
    const mod = await import('../../../db-mysql/backend/utils/mysql2.js');
    if (mod && typeof mod.getMysql2 === 'function') return await mod.getMysql2(ctx);
  } catch {}
  try {
    const mod = await import('mysql2/promise');
    return mod && (mod.default || mod);
  } catch {}
  const err = new Error('mysql2_missing');
  err.code = 'MYSQL2_MISSING';
  throw err;
}

function normalizeConn(raw = {}) {
  const src = { ...raw };
  const map = (obj, from, to) => { if (obj[from] !== undefined && obj[to] === undefined) obj[to] = obj[from]; };
  map(src, 'database_host', 'host'); map(src, 'db_host', 'host');
  map(src, 'database_port', 'port'); map(src, 'db_port', 'port');
  map(src, 'database_name', 'database'); map(src, 'db_name', 'database');
  map(src, 'database_user', 'user'); map(src, 'db_user', 'user');
  map(src, 'database_password', 'password'); map(src, 'db_password', 'password');
  return {
    host: String(src.host || '').trim(),
    port: Number(src.port || 3306),
    database: String(src.database || '').trim(),
    user: String(src.user || '').trim(),
    password: src.password != null ? String(src.password) : '',
    ssl: !!src.ssl,
  };
}

export function registerBomPrestaRoutes(app, ctx = {}, utils = {}) {
  const pool = utils.pool || ctx.pool;
  const chatLog = utils.chatLog || (()=>{});

  // Small key-value store for this module (org-scoped)
  async function getSavedProfile(orgId) {
    if (!pool) return null;
    try {
      const args = ['presta_profile_id'];
      let where = 'key=$1';
      if (orgId) { args.push(Number(orgId)); where += ' AND (org_id IS NULL OR org_id = $2)'; }
      const r = await pool.query(`SELECT value FROM mod_bom_settings WHERE ${where} ORDER BY updated_at DESC LIMIT 1`, args);
      if (!r.rowCount) return null;
      const val = r.rows[0]?.value || {};
      const id = Number(val?.profile_id || 0) || 0;
      return id || null;
    } catch { return null; }
  }
  async function setSavedProfile(orgId, profileId) {
    if (!pool) throw new Error('db_unavailable');
    const key = 'presta_profile_id';
    const value = { profile_id: Number(profileId || 0) || 0 };
    const args = [orgId ? Number(orgId) : null, key, value];
    await pool.query(`
      INSERT INTO mod_bom_settings(org_id, key, value, created_at, updated_at)
      VALUES ($1,$2,$3,NOW(),NOW())
      ON CONFLICT(org_id, key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()
    `, args);
    return true;
  }

  async function getProfileCfg(orgId, profileId) {
    if (!pool) return null;
    const id = Number(profileId || 0) || 0;
    if (!id) return null;
    try {
      const args = [id];
      let where = 'id=$1';
      if (orgId) { args.push(orgId); where += ' AND (org_id IS NULL OR org_id = $2)'; }
      const r = await pool.query(`SELECT host, port, "database", db_user AS user, db_password AS password, ssl FROM mod_db_mysql_profiles WHERE ${where} LIMIT 1`, args);
      if (!r.rowCount) return null;
      return r.rows[0];
    } catch { return null; }
  }

  async function computeBomCostTotalById(bomId, opts = {}) {
    if (!pool) return { total: null, currency: null };
    const id = Number(bomId || 0);
    if (!id) return { total: null, currency: null };
    try {
      const baseCur = String(process.env.BOM_DEFAULT_CURRENCY || process.env.DEFAULT_CURRENCY || 'EUR');
      // 1) Prefer calling the module explode endpoint to mirror BOM Viewer exactly
      try {
        const port = Number(process.env.PORT || 3010);
        const depth = Number(process.env.BOM_EXPLODE_DEPTH || 8);
        const url = `http://127.0.0.1:${port}/api/bom/boms/${encodeURIComponent(id)}/explode?depth=${encodeURIComponent(depth)}&aggregate=1`;
        const resp = await fetch(url);
        const j = await resp.json();
        if (resp.ok && j && j.ok) {
          const total = j.total_price != null ? Number(j.total_price) : null;
          if (Number.isFinite(total)) return { total, currency: j.total_currency || baseCur, _via: 'explode' };
        }
      } catch {}

      // 2) Fallback to direct SQL (portable and safe when explode cannot be called)
      let hasFx = false;
      try { const chk = await pool.query("SELECT to_regclass('public.mod_bom_fx_rates') AS t"); hasFx = !!(chk.rows && chk.rows[0] && chk.rows[0].t); } catch {}

      const sqlWithFx = `
        WITH RECURSIVE
        tree AS (
          SELECT 1 AS lvl, bi.bom_id, bi.item_id, i.sku, bi.quantity::numeric AS ext_qty,
                 lp.price AS unit_price, COALESCE(lp.currency, sv.currency) AS currency
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
           WHERE bi.bom_id = $1
          UNION ALL
          SELECT t.lvl + 1, bi2.bom_id, bi2.item_id, i2.sku,
                 (t.ext_qty * bi2.quantity::numeric) AS ext_qty,
                 lp2.price, COALESCE(lp2.currency, sv2.currency)
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
        )
        SELECT SUM(
          CASE
            WHEN hb.has_bom = 1 AND t.lvl < 8 THEN 0
            WHEN t.currency IS NULL OR upper(t.currency) = upper($2) THEN (COALESCE(t.unit_price,0) * COALESCE(t.ext_qty,0))
            WHEN fx.rate IS NOT NULL THEN ((COALESCE(t.unit_price,0) / fx.rate) * COALESCE(t.ext_qty,0))
            ELSE 0
          END
        )::numeric AS total
          FROM tree t
          LEFT JOIN LATERAL (
            SELECT 1 AS has_bom FROM mod_bom_boms bx WHERE lower(bx.name) = lower(t.sku) LIMIT 1
          ) hb ON TRUE
          LEFT JOIN LATERAL (
            SELECT r.rate FROM mod_bom_fx_rates r WHERE upper(r.currency)=upper(t.currency) ORDER BY r.effective_at DESC, r.id DESC LIMIT 1
          ) fx ON TRUE;
      `;

      const sqlNoFx = `
        WITH RECURSIVE
        tree AS (
          SELECT 1 AS lvl, bi.bom_id, bi.item_id, i.sku, bi.quantity::numeric AS ext_qty,
                 lp.price AS unit_price, COALESCE(lp.currency, sv.currency) AS currency
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
           WHERE bi.bom_id = $1
          UNION ALL
          SELECT t.lvl + 1, bi2.bom_id, bi2.item_id, i2.sku,
                 (t.ext_qty * bi2.quantity::numeric) AS ext_qty,
                 lp2.price, COALESCE(lp2.currency, sv2.currency)
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
        )
        SELECT SUM(CASE WHEN hb.has_bom = 1 AND t.lvl < 8 THEN 0 ELSE (COALESCE(t.unit_price,0) * COALESCE(t.ext_qty,0)) END)::numeric AS total
          FROM tree t
          LEFT JOIN LATERAL (
            SELECT 1 AS has_bom FROM mod_bom_boms bx WHERE lower(bx.name) = lower(t.sku) LIMIT 1
          ) hb ON TRUE;
      `;

      const sql = hasFx ? sqlWithFx : sqlNoFx;
      const params = hasFx ? [id, baseCur] : [id];
      const r = await pool.query(sql, params);
      let total = r.rows?.[0]?.total != null ? Number(r.rows[0].total) : null;
      return { total, currency: baseCur, _via: hasFx ? 'sql_fx' : 'sql' };
    } catch (e) {
      chatLog('presta_bom_cost_failed', { id, error: e?.message || String(e) });
      return { total: null, currency: null };
    }
  }
  function normKey(s) {
    // Uppercase, remove non-alphanumeric, normalize common confusions
    const u = String(s || '').toUpperCase();
    return u.replace(/[^A-Z0-9]+/g, '');
  }
  // Note: Intentionally DO NOT generate O/0 swap variants to avoid false matches
  async function preloadBomIndex(orgId) {
    try {
      const args = [];
      let where = 'WHERE 1=1';
      if (orgId) { args.push(Number(orgId)); where += ` AND (org_id IS NULL OR org_id = $${args.length})`; }
      const r = await pool.query(`SELECT id, name FROM mod_bom_boms ${where}` , args);
      const byNameExact = new Map();
      const byNorm = new Map();
      for (const row of (r.rows||[])) {
        const nm = String(row.name||'').trim();
        if (!nm) continue;
        const id = Number(row.id);
        byNameExact.set(nm.toLowerCase(), id);
        const k = normKey(nm);
        if (k) byNorm.set(k, id);
      }
      return { byNameExact, byNorm };
    } catch { return { byNameExact: new Map(), byNorm: new Map() }; }
  }

  app.get('/api/bom/presta/__ping', (_req, res) => res.json({ ok:true, module:'bom', feature:'presta' }));

  // List shops for a given MySQL profile
  app.get('/api/bom/presta/shops', async (req, res) => {
    const orgId = pickOrgId(req);
    try {
      const profileId = Number(req.query?.profile_id || 0) || (await getSavedProfile(orgId)) || 0;
      if (!profileId) return res.status(400).json({ ok:false, error:'no_profile_selected', message:'Select a MySQL profile first.' });
      const prof = await getProfileCfg(orgId, profileId);
      if (!prof) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const cfg = normalizeConn(prof);
      const mysql2 = await getMysql2(ctx);
      const conn = await mysql2.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined });
      try {
        const [rows] = await conn.query('SELECT id_shop, name, active FROM ps_shop ORDER BY id_shop');
        const items = Array.isArray(rows) ? rows.map(r => ({ id_shop: r.id_shop, name: r.name, active: !!r.active })) : [];
        return res.json({ ok:true, items });
      } finally { try { await conn.end(); } catch {} }
    } catch (e) {
      const msg = e?.message || String(e);
      if (/mysql2_missing/i.test(msg)) return res.status(503).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend to enable this feature' });
      return res.status(500).json({ ok:false, error:'server_error', message: msg });
    }
  });

  // List languages; if id_shop provided, mark availability via ps_lang_shop
  app.get('/api/bom/presta/langs', async (req, res) => {
    const orgId = pickOrgId(req);
    try {
      const profileId = Number(req.query?.profile_id || 0) || (await getSavedProfile(orgId)) || 0;
      if (!profileId) return res.status(400).json({ ok:false, error:'no_profile_selected', message:'Select a MySQL profile first.' });
      const prof = await getProfileCfg(orgId, profileId);
      if (!prof) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const cfg = normalizeConn(prof);
      const mysql2 = await getMysql2(ctx);
      const conn = await mysql2.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined });
      try {
        const idShop = Number(req.query?.id_shop || 0) || 0;
        if (idShop) {
          const [rows] = await conn.query(
            'SELECT l.id_lang, l.name, l.iso_code, l.active, (ls.id_shop IS NOT NULL) AS in_shop FROM ps_lang l LEFT JOIN ps_lang_shop ls ON ls.id_lang = l.id_lang AND ls.id_shop = ? ORDER BY l.id_lang',
            [idShop]
          );
          const items = Array.isArray(rows) ? rows.map(r => ({ id_lang: r.id_lang, name: r.name, iso_code: r.iso_code, active: !!r.active, in_shop: !!r.in_shop })) : [];
          return res.json({ ok:true, items });
        } else {
          const [rows] = await conn.query('SELECT id_lang, name, iso_code, active FROM ps_lang ORDER BY id_lang');
          const items = Array.isArray(rows) ? rows.map(r => ({ id_lang: r.id_lang, name: r.name, iso_code: r.iso_code, active: !!r.active })) : [];
          return res.json({ ok:true, items });
        }
      } finally { try { await conn.end(); } catch {} }
    } catch (e) {
      const msg = e?.message || String(e);
      if (/mysql2_missing/i.test(msg)) return res.status(503).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend to enable this feature' });
      return res.status(500).json({ ok:false, error:'server_error', message: msg });
    }
  });

  app.get('/api/bom/presta/profile', async (req, res) => {
    try {
      const orgId = pickOrgId(req);
      const pid = await getSavedProfile(orgId);
      return res.json({ ok:true, profile_id: pid || null });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // List available MySQL profiles (no admin required). Org-scoped.
  app.get('/api/bom/presta/profiles', async (req, res) => {
    if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
    const orgId = pickOrgId(req);
    try {
      const args = [];
      const whereOrg = orgId ? ' WHERE (org_id IS NULL OR org_id = $1)' : '';
      if (orgId) args.push(orgId);
      const r = await pool.query(`SELECT id, name, host, port, "database", ssl, is_default, org_id, updated_at FROM mod_db_mysql_profiles${whereOrg} ORDER BY is_default DESC, updated_at DESC`, args);
      return res.json({ ok:true, items: r.rows || [] });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.post('/api/bom/presta/profile', async (req, res) => {
    try {
      const orgId = pickOrgId(req);
      const profileId = Number(req.body?.profile_id || 0) || 0;
      if (!profileId) return res.status(400).json({ ok:false, error:'bad_profile_id' });
      await setSavedProfile(orgId, profileId);
      return res.json({ ok: true });
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  app.get('/api/bom/presta/margins', async (req, res) => {
    const orgId = pickOrgId(req);
    try {
      const q = String(req.query?.q || '').trim();
      const limit = Math.max(1, Math.min(5000, Number(req.query?.limit || 5000))); // hard cap 5000, default 5000
      const dbg = String(req.query?.debug || '') === '1';
      const profileId = Number(req.query?.profile_id || 0) || (await getSavedProfile(orgId)) || 0;
      if (!profileId) return res.status(400).json({ ok:false, error:'no_profile_selected', message:'Select a MySQL profile first.' });

      // Load profile and connect to MySQL
      const prof = await getProfileCfg(orgId, profileId);
      if (!prof) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const cfg = normalizeConn(prof);
      const mysql2 = await getMysql2(ctx);
      const conn = await mysql2.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined });
      try {
        // Query Presta view with dynamic columns (supports id_product1/reference1 aliases)
        const [cols] = await conn.query('SHOW COLUMNS FROM ps_product_type_resolved');
        const names = new Set((cols || []).map(c => (c.Field || c.field || '').toString()));
        const has = (n) => names.has(n);
        const idProductCol = has('id_product') ? 'id_product' : (has('id_product1') ? 'id_product1' : null);
        const nameCol = has('name') ? 'name' : null;
        const ref1Col = has('reference1') ? 'reference1' : null;
        const attrRefCol = has('reference') ? 'reference' : null;
        const supplierRefCol = has('supplier_reference') ? 'supplier_reference' : null;
        const attrIdCol = has('id_product_attribute') ? 'id_product_attribute' : null;
        const finalPriceCol = has('final_price') ? 'final_price' : null;

        const selectCols = [
          'BOM_name',
          idProductCol ? `${idProductCol} AS id_product` : 'NULL AS id_product',
          attrIdCol ? `${attrIdCol} AS id_product_attribute` : 'NULL AS id_product_attribute',
          nameCol ? `${nameCol} AS name` : 'NULL AS name',
          ref1Col ? `${ref1Col} AS reference1` : 'NULL AS reference1',
          attrRefCol ? `${attrRefCol} AS reference` : 'NULL AS reference',
          supplierRefCol ? `${supplierRefCol} AS supplier_reference` : 'NULL AS supplier_reference',
          finalPriceCol ? `${finalPriceCol} AS final_price` : 'NULL AS final_price' 
        ].join(', ');

        const params = [];
        let sql = `SELECT ${selectCols} FROM ps_product_type_resolved`;
        if (q) {
          const like = `%${q}%`;
          const ors = ['BOM_name'];
          if (nameCol) ors.push(nameCol);
          if (attrRefCol) ors.push(attrRefCol);
          if (ref1Col) ors.push(ref1Col);
          sql += ' WHERE ' + ors.map(()=>`${ors.shift()} LIKE ?`).join(' OR ');
          // The above shift mutates ors; rebuild with columns we need to push params for
        }
        // Rebuild WHERE safely
        if (q) {
          const like = `%${q}%`;
          const orCols = ['BOM_name'];
          if (nameCol) orCols.push(nameCol);
          if (attrRefCol) orCols.push(attrRefCol);
          if (ref1Col) orCols.push(ref1Col);
          sql = `SELECT ${selectCols} FROM ps_product_type_resolved WHERE ${orCols.map(c=>`${c} LIKE ?`).join(' OR ')} ORDER BY BOM_name IS NULL, BOM_name ASC LIMIT ?`;
          for (let i=0;i<orCols.length;i++) params.push(like);
        } else {
          sql += ' ORDER BY BOM_name IS NULL, BOM_name ASC LIMIT ?';
        }
        params.push(limit);
        const [rows] = await conn.query(sql, params);
        const items = Array.isArray(rows) ? rows : [];

        // Determine default shop ids per product via ps_product.id_shop_default; fallback to global default only when missing
        async function getGlobalDefaultShopId(connection) {
          try {
            const [r1] = await connection.query("SELECT value FROM ps_configuration WHERE name='PS_SHOP_DEFAULT' ORDER BY id_configuration DESC LIMIT 1");
            const v = Array.isArray(r1) && r1[0] && r1[0].value != null ? Number(r1[0].value) : 0;
            if (Number.isFinite(v) && v > 0) return v;
          } catch {}
          try {
            const [r2] = await connection.query("SELECT id_shop FROM ps_shop WHERE active=1 ORDER BY id_shop LIMIT 1");
            const v2 = Array.isArray(r2) && r2[0] && r2[0].id_shop != null ? Number(r2[0].id_shop) : 0;
            if (Number.isFinite(v2) && v2 > 0) return v2;
          } catch {}
          return 1; // sensible default
        }
        // Load per-product default shops and shop prices for fetched products/attributes
        const productIds = Array.from(new Set(items.map(x => Number(x.id_product || 0)).filter(n => Number.isFinite(n) && n > 0)));
        const attrIds = Array.from(new Set(items.map(x => Number(x.id_product_attribute || 0)).filter(n => Number.isFinite(n) && n > 0)));

        const shopByProduct = new Map(); // id_product -> id_shop_default
        const attrToProduct = new Map(); // id_product_attribute -> id_product
        const shops = new Set();
        const globalDefaultShopId = await getGlobalDefaultShopId(conn);

        if (productIds.length) {
          try {
            const [ps] = await conn.query(`SELECT id_product, id_shop_default FROM ps_product WHERE id_product IN (?)`, [productIds]);
            for (const r of (ps || [])) {
              const pid = Number(r.id_product);
              const sid = Number(r.id_shop_default || 0) || globalDefaultShopId;
              if (Number.isFinite(pid) && Number.isFinite(sid)) { shopByProduct.set(pid, sid); shops.add(sid); }
            }
          } catch {}
        }
        if (attrIds.length) {
          try {
            const [paMap] = await conn.query(`SELECT id_product_attribute, id_product FROM ps_product_attribute WHERE id_product_attribute IN (?)`, [attrIds]);
            for (const r of (paMap || [])) {
              const aid = Number(r.id_product_attribute);
              const pid = Number(r.id_product);
              if (Number.isFinite(aid) && Number.isFinite(pid)) attrToProduct.set(aid, pid);
            }
          } catch {}
        }
        if (!shops.size && globalDefaultShopId) shops.add(globalDefaultShopId);

        // Resolve shop names for display
        const shopNameById = new Map();
        if (shops.size) {
          try {
            const [srows] = await conn.query(`SELECT id_shop, name FROM ps_shop WHERE id_shop IN (?)`, [Array.from(shops)]);
            for (const r of (srows || [])) {
              const sid = Number(r.id_shop);
              if (Number.isFinite(sid)) shopNameById.set(sid, r.name || null);
            }
          } catch {}
        }

        const priceByProduct = new Map(); // key `${shopId}:${productId}` -> price
        const activeByProduct = new Map(); // key `${shopId}:${productId}` -> active (0/1)
        const priceByAttr = new Map();    // key `${shopId}:${attrId}` -> impact price
        if (productIds.length && shops.size) {
          try {
            const [pp] = await conn.query(
              `SELECT id_shop, id_product, price, active FROM ps_product_shop WHERE id_product IN (?) AND id_shop IN (?)`,
              [productIds, Array.from(shops)]
            );
            for (const r of (pp || [])) {
              const sid = Number(r.id_shop); const pid = Number(r.id_product);
              const p = r.price != null ? Number(r.price) : null;
              if (Number.isFinite(sid) && Number.isFinite(pid) && p != null) priceByProduct.set(`${sid}:${pid}`, p);
              const a = (r.active === 1 || r.active === true || r.active === '1') ? 1 : 0;
              if (Number.isFinite(sid) && Number.isFinite(pid)) activeByProduct.set(`${sid}:${pid}`, a);
            }
          } catch {}
        }
        if (attrIds.length && shops.size) {
          try {
            const [pa] = await conn.query(
              `SELECT id_shop, id_product_attribute, price FROM ps_product_attribute_shop WHERE id_product_attribute IN (?) AND id_shop IN (?)`,
              [attrIds, Array.from(shops)]
            );
            for (const r of (pa || [])) {
              const sid = Number(r.id_shop); const aid = Number(r.id_product_attribute);
              const p = r.price != null ? Number(r.price) : null;
              if (Number.isFinite(sid) && Number.isFinite(aid) && p != null) priceByAttr.set(`${sid}:${aid}`, p);
            }
          } catch {}
        }

        // Build a fast BOM lookup (exact and normalized)
        const { byNameExact, byNorm } = await preloadBomIndex(orgId);
        const costByBomId = new Map();
        async function getCostByBomId(id) {
          const nid = Number(id||0);
          if (!nid) return null;
          if (costByBomId.has(nid)) return costByBomId.get(nid);
          const res1 = await computeBomCostTotalById(nid, { debug: dbg });
          const total = res1?.total ?? null;
          const via = res1?._via || null;
          costByBomId.set(nid, { total, via });
          return { total, via };
        }
        async function findBomIdByCandidates(cands) {
          for (const c of cands) {
            const raw = String(c || '').trim();
            if (!raw) continue;
            const exact = byNameExact.get(raw.toLowerCase());
            if (exact) return exact;
            const k = normKey(raw);
            if (k) {
              const hit = byNorm.get(k);
              if (hit) return hit;
            }
            // Fallback: query DB with normalized comparison, org-aware
            try {
              const args = [raw];
              let where = 'lower(name)=lower($1)';
              // normalize both sides by stripping non-alphanumerics in SQL
              args.push(raw);
              where += ` OR (regexp_replace(name, '[^A-Za-z0-9]+', '', 'g') = regexp_replace($2, '[^A-Za-z0-9]+', '', 'g'))`;
              if (orgId) { args.push(Number(orgId)); where = `(${where}) AND (org_id IS NULL OR org_id = $${args.length})`; }
              const r = await pool.query(`SELECT id FROM mod_bom_boms WHERE ${where} LIMIT 1`, args);
              if (r.rowCount) return Number(r.rows[0].id);
            } catch {}
          }
          return 0;
        }

        const out = [];
        for (const r of items) {
          const bom = String(r.BOM_name || '').trim();
          // Name-derived candidates: prefix before ' - ' or comma, and first token
          const nm = String(r.name || '').trim();
          const namePrefix = nm.split(' - ')[0]?.trim() || '';
          const nameBeforeComma = nm.split(',')[0]?.trim() || '';
          const firstToken = nm.split(/[\s\-]+/)[0]?.trim() || '';
          const set = new Set([bom, r.reference, r.supplier_reference, namePrefix, nameBeforeComma, firstToken]);
          const candidates = Array.from(set).filter(Boolean);
          const bomId = await findBomIdByCandidates(candidates);
          const costObj = await getCostByBomId(bomId);
          const cost = (costObj && typeof costObj === 'object') ? costObj.total : costObj;
          // Compute price from per-product default shop: product base + attribute impact (if any)
          let finalPrice = null;
          let active = null;
          let chosenShopId = null;
          let chosenShopName = null;
          try {
            const pid = Number(r.id_product || 0);
            const shopId = shopByProduct.get(pid) || globalDefaultShopId;
            chosenShopId = shopId;
            chosenShopName = shopNameById.get(shopId) || null;
            const base = priceByProduct.get(`${shopId}:${pid}`) ?? null;
            const impact = r.id_product_attribute ? (priceByAttr.get(`${shopId}:${Number(r.id_product_attribute)}`) ?? null) : null;
            if (base != null || impact != null) finalPrice = Number((Number(base || 0) + Number(impact || 0)).toFixed(6));
            if (activeByProduct.has(`${shopId}:${pid}`)) active = activeByProduct.get(`${shopId}:${pid}`) ? true : false;
          } catch {}
          const margin = (finalPrice != null && cost != null) ? (finalPrice - cost) : null;
          const row = {
            id_product: r.id_product,
            id_product_attribute: r.id_product_attribute,
            name: r.name,
            reference1: r.reference1,
            reference: r.reference,
            supplier_reference: r.supplier_reference,
            bom_name: bom || null,
            final_price: finalPrice,
            active,
            shop_default: chosenShopId,
            shop_name: chosenShopName,
            bom_cost_total: cost,
            margin,
            bom_id: bomId || null,
          };
          if (dbg) row._debug = { candidates, via: (costObj && costObj.via) || null, shop_default: shopByProduct.get(Number(r.id_product || 0)) || globalDefaultShopId };
          out.push(row);
        }
        const extra = dbg ? { debug: { sql, params } } : {};
        return res.json({ ok:true, profile_id: profileId, items: out, ...extra });
      } finally { try { await conn.end(); } catch {} }
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg && /mysql2_missing/i.test(msg)) return res.status(503).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend to enable this feature' });
      return res.status(500).json({ ok:false, error:'server_error', message: msg });
    }
  });

  // Search products by shop/lang and try to associate a BOM when BOM name is contained in the product name
  app.get('/api/bom/presta/associator/search', async (req, res) => {
    const orgId = pickOrgId(req);
    try {
      const profileId = Number(req.query?.profile_id || 0) || (await getSavedProfile(orgId)) || 0;
      const idShop = Number(req.query?.id_shop || 0) || 0;
      const idLang = Number(req.query?.id_lang || 0) || 0;
      const limit = Math.max(1, Math.min(1000, Number(req.query?.limit || 200)));
      const idProductFilter = String(req.query?.id_product || '').trim();
      const referenceFilter = String(req.query?.reference || '').trim();
      const supplierRefFilter = String(req.query?.supplier_reference || '').trim();
      if (!profileId) return res.status(400).json({ ok:false, error:'no_profile_selected', message:'Select a MySQL profile first.' });
      if (!idShop || !idLang) return res.status(400).json({ ok:false, error:'bad_request', message:'id_shop and id_lang are required' });

      const prof = await getProfileCfg(orgId, profileId);
      if (!prof) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const cfg = normalizeConn(prof);
      const mysql2 = await getMysql2(ctx);
      const conn = await mysql2.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined });
      try {
        const where = [];
        const params = [idLang, idShop];
        if (idProductFilter) {
          const ids = idProductFilter.split(',').map(s=>s.trim()).filter(Boolean).map(s=>Number(s)).filter(n=>Number.isFinite(n));
          if (ids.length) where.push(`p.id_product IN (${ids.map(()=>'?').join(',')})`), params.push(...ids);
        }
        if (referenceFilter) { where.push('p.reference LIKE ?'); params.push(`%${referenceFilter}%`); }
        if (supplierRefFilter) { where.push('psup.product_supplier_reference LIKE ?'); params.push(`%${supplierRefFilter}%`); }
        const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';

        const sql = `
          SELECT p.id_product,
                 pl.name AS name,
                 p.reference AS reference,
                 MAX(psup.product_supplier_reference) AS supplier_reference
            FROM ps_product p
            LEFT JOIN ps_product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = ? AND pl.id_shop = ?
            LEFT JOIN ps_product_supplier psup ON psup.id_product = p.id_product
            ${whereSql}
            GROUP BY p.id_product, pl.name, p.reference
            ORDER BY p.id_product
            LIMIT ?`;
        params.push(limit);
        const [rows] = await conn.query(sql, params);
        const products = Array.isArray(rows) ? rows : [];

        // Load BOM names from Postgres (org-scoped)
        let bomRows = [];
        try {
          const args = [];
          let whereOrg = '';
          if (orgId) { args.push(Number(orgId)); whereOrg = ' WHERE (org_id IS NULL OR org_id = $1)'; }
          const r = await pool.query(`SELECT id, name FROM mod_bom_boms${whereOrg}` , args);
          bomRows = r.rows || [];
        } catch {}
        // Pre-sort by name length (desc) to prefer longest match
        const boms = (bomRows || [])
          .map(r => ({ id: Number(r.id), name: String(r.name||'').trim() }))
          .filter(r => r.name)
          .sort((a,b) => b.name.length - a.name.length);

        function findMatch(name) {
          const s = String(name || '').toLowerCase();
          if (!s) return null;
          for (const b of boms) {
            if (s.includes(b.name.toLowerCase())) return { bom_id: b.id, bom_name: b.name };
          }
          return null;
        }

        const items = products.map(p => {
          const m = findMatch(p.name);
          return {
            id_product: p.id_product,
            name: p.name || null,
            reference: p.reference || null,
            supplier_reference: p.supplier_reference || null,
            matched_bom_id: m ? m.bom_id : null,
            matched_bom_name: m ? m.bom_name : null,
          };
        });
        return res.json({ ok:true, items });
      } finally { try { await conn.end(); } catch {} }
    } catch (e) {
      const msg = e?.message || String(e);
      if (/mysql2_missing/i.test(msg)) return res.status(503).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend to enable this feature' });
      return res.status(500).json({ ok:false, error:'server_error', message: msg });
    }
  });
}
