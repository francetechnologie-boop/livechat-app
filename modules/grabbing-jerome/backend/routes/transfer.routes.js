// Transfer-related endpoints (schema, langs, validate, preview, images verify)
// The Send-to-Presta POST endpoint is mounted here and delegates to the service.

import { sendToPresta } from '../services/transfer.service.js';

export function registerGrabbingJeromeTransferRoutes(app, ctx = {}, utils = {}) {
  const { pool, normDomain, chatLog, ensureExtractionRunsTable } = utils;
  if (!pool || typeof pool.query !== 'function') return;
  // Validate mapping against Presta DB (check referenced IDs and shops exist)
  app.post('/api/grabbing-jerome/transfer/prestashop/validate-mapping', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      try { if (typeof ensureExtractionRunsTable === 'function') await ensureExtractionRunsTable(); } catch {}
      const explicitProfileId = req.body?.profile_id != null ? Number(req.body.profile_id) : null;
      const mapping = (req.body && typeof req.body.mapping === 'object') ? req.body.mapping : {};
      let domain = normDomain(req.body?.domain);
      const pageType = String(req.body?.page_type || '').trim().toLowerCase() || 'product';
      // If no explicit profile, try domain transf config
      let profileId = explicitProfileId;
      let ct = {};
      if (!profileId && domain) {
        try {
          const d = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
          ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
          if (ct && typeof ct === 'object' && ct.db_mysql_profile_id) profileId = Number(ct.db_mysql_profile_id) || null;
        } catch {}
      }
      if (!profileId) return res.status(400).json({ ok:false, error:'missing_profile', message:'Select a PrestaShop DB profile (db-mysql) first.' });

      // Load MySQL profile
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];
      let mysql = null;
      try {
        const mod = await import('../../../db-mysql/backend/utils/mysql2.js');
        mysql = await mod.getMysql2(ctx);
      } catch (e) {
        return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' });
      }
      const cfg = { host: String(prof.host||'localhost'), port: Number(prof.port||3306), user: String(prof.user||''), password: String(prof.password||''), database: String(prof.database||''), ssl: prof.ssl ? { rejectUnauthorized: false } : undefined };
      const PREFIX_DEFAULT = String(((ct && (ct.db_mysql_prefix || ct.db_prefix)) || 'ps_'));
      const PREFIX = String(mapping.prefix || PREFIX_DEFAULT || 'ps_');
      const shops = Array.isArray(mapping.id_shops) ? mapping.id_shops : (mapping.id_shop ? [mapping.id_shop] : []);
      const id_shop_default = (mapping.id_shop_default != null) ? Number(mapping.id_shop_default) : (shops[0] || null);
      const id_supplier = (mapping.id_supplier != null) ? Number(mapping.id_supplier) : null;
      const id_manufacturer = (mapping.id_manufacturer != null) ? Number(mapping.id_manufacturer) : null;
      const id_category_default = (mapping.id_category_default != null) ? Number(mapping.id_category_default) : null;
      const id_tax_rules_group = (mapping.id_tax_rules_group != null) ? Number(mapping.id_tax_rules_group) : null;

      const qi = (ident) => '`' + String(ident||'').replace(/`/g, '``') + '`';
      const existsTable = async (conn, table) => {
        const [rows] = await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1', [cfg.database, table]);
        return Array.isArray(rows) && rows.length > 0;
      };
      const existsId = async (conn, table, col, id) => {
        if (id == null) return null;
        if (!(await existsTable(conn, table))) return false;
        const [rows] = await conn.query(`SELECT 1 FROM ${qi(table)} WHERE ${qi(col)}=? LIMIT 1`, [id]);
        return Array.isArray(rows) && rows.length > 0;
  };

      // Connect and perform checks
      let conn;
      try {
        conn = await mysql.createConnection(cfg);
        const tb = {
          product: await existsTable(conn, PREFIX+'product'),
          product_shop: await existsTable(conn, PREFIX+'product_shop'),
          product_lang: await existsTable(conn, PREFIX+'product_lang'),
          stock_available: await existsTable(conn, PREFIX+'stock_available'),
          supplier: await existsTable(conn, PREFIX+'supplier'),
          manufacturer: await existsTable(conn, PREFIX+'manufacturer'),
          category: await existsTable(conn, PREFIX+'category'),
          shop: await existsTable(conn, PREFIX+'shop'),
          tax_rules_group: await existsTable(conn, PREFIX+'tax_rules_group'),
        };
        const check = {
          supplier: await existsId(conn, PREFIX+'supplier', 'id_supplier', id_supplier),
          manufacturer: await existsId(conn, PREFIX+'manufacturer', 'id_manufacturer', id_manufacturer),
          category_default: await existsId(conn, PREFIX+'category', 'id_category', id_category_default),
          shop_default: await existsId(conn, PREFIX+'shop', 'id_shop', id_shop_default),
          shops: await (async ()=>{
            const out = [];
            for (const s of (Array.isArray(shops)? shops: [])) {
              const ok = await existsId(conn, PREFIX+'shop', 'id_shop', Number(s)||0);
              out.push({ id: Number(s)||0, exists: !!ok });
            }
            return out;
          })(),
          tax_rules_group: await existsId(conn, PREFIX+'tax_rules_group', 'id_tax_rules_group', id_tax_rules_group)
        };
        return res.json({ ok:true, tables: tb, check, profile: { id: prof.id, host: prof.host, database: prof.database } });
      } catch (e) {
        return res.status(500).json({ ok:false, error:'validate_failed', message: e?.message || String(e) });
      } finally { try { if (conn) await conn.end(); } catch {} }
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Preview upsert tables/columns for a run (no writes)
  app.post('/api/grabbing-jerome/transfer/prestashop/preview-tables', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const runId = Number(req.body?.run_id || req.body?.id || 0) || 0;
      const explicitProfileId = req.body?.profile_id != null ? Number(req.body.profile_id) : null;
      const explicitMapping = (req.body && typeof req.body.mapping === 'object') ? req.body.mapping : null;
      if (!runId) return res.status(400).json({ ok:false, error:'bad_request', message:'run_id required' });
      const rr = await pool.query(`select id, domain, url, page_type, version, result from public.mod_grabbing_jerome_extraction_runs where id=$1`, [runId]);
      if (!rr.rowCount) return res.status(404).json({ ok:false, error:'not_found' });
      const run = rr.rows[0];
      const domain = normDomain(run.domain);
      try { chatLog('preview_start', { run_id: run.id, domain, url: run.url }); } catch {}

      // Determine profile id: prefer explicit, fallback to domain config_transfert
      let profileId = explicitProfileId;
      let ct = {};
      if (!profileId && domain) {
        try {
          const d = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
          ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
          if (ct && typeof ct === 'object' && ct.db_mysql_profile_id) profileId = Number(ct.db_mysql_profile_id) || null;
        } catch {}
      }
      if (!profileId) return res.status(400).json({ ok:false, error:'missing_profile' });

      // Load profile and connect to Presta MySQL
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];
      let mysql = null;
      try {
        const mod = await import('../../../db-mysql/backend/utils/mysql2.js');
        mysql = await mod.getMysql2(ctx);
      } catch (e) {
        return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' });
      }
      const cfg = { host: String(prof.host||'localhost'), port: Number(prof.port||3306), user: String(prof.user||''), password: String(prof.password||''), database: String(prof.database||''), ssl: prof.ssl ? { rejectUnauthorized: false } : undefined };

      let conn;
      try {
        conn = await mysql.createConnection(cfg);
        const q = async (sql, args=[]) => { const [rows] = await conn.query(sql, args); return rows; };
        const qi = (ident) => '`' + String(ident||'').replace(/`/g, '``') + '`';
        const hasTable = async (name) => { const rows = await q('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1', [cfg.database, name]); return Array.isArray(rows)&&rows.length>0; };
        const hasColumn = async (table, col) => { const rows = await q('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1', [cfg.database, table, col]); return Array.isArray(rows)&&rows.length>0; };
        const getColMaxLen = async (table, column) => {
          try {
            const rows = await q('SELECT CHARACTER_MAXIMUM_LENGTH as max_len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1', [cfg.database, table, column]);
            const len = (Array.isArray(rows) && rows.length) ? Number(rows[0].max_len||0) : 0;
            return len || 0;
          } catch { return 0; }
        };
        const slugify = (s) => String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'product';
        const now = new Date();
        const fmtDateTime = (d) => { try { const p=(n)=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; } catch { return '1970-01-01 00:00:00'; } };
        const nowFmt = fmtDateTime(now);

        // Mapping and settings
        // Allow override of page_type via body (used by split routes)
        const type = String((req.body?.force_page_type || req.body?.page_type || run.page_type || '')).trim().toLowerCase() || 'product';
        // Prefer latest mapping from mapping tools; fallback to legacy domain config
        let toolMap = null;
        try {
          const rMap = await pool.query(
            `select config from public.mod_grabbing_jerome_maping_tools
               where regexp_replace(lower(domain),'^www\\.','') = regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
               order by version desc, updated_at desc
               limit 1`,
            [domain, type]
          );
          if (rMap.rowCount) toolMap = rMap.rows[0]?.config || null;
        } catch {}
        const savedMap = toolMap || (ct && ct.mappings && ct.mappings[type]) || ct?.mapping || null;
        let mapping = explicitMapping || savedMap || {};
        if (mapping && typeof mapping === 'object' && mapping.config && typeof mapping.config === 'object') mapping = mapping.config;
        const PREFIX_DEFAULT = String(((ct && (ct.db_mysql_prefix || ct.db_prefix)) || 'ps_'));
        const PREFIX = String(mapping.prefix || PREFIX_DEFAULT || 'ps_');
        const ID_LANG = Number(mapping.id_lang || 1) || 1;
        const TABLES = (mapping && mapping.tables && typeof mapping.tables === 'object') ? { ...mapping.tables } : {};
        // Build an allow-list from mapping for non-product types to avoid mixing unrelated tables
        let ALLOW_SET = null;
        try {
          if (type !== 'product') {
            ALLOW_SET = new Set(Object.keys(TABLES||{}).map(s=>String(s)));
          }
        } catch {}
        let TSET_PRODUCT = (TABLES.product && typeof TABLES.product.settings === 'object') ? TABLES.product.settings : {};
        let TSET_SHOP = (TABLES.product_shop && typeof TABLES.product_shop.settings === 'object') ? TABLES.product_shop.settings : {};
        let TSET_LANG = (TABLES.product_lang && typeof TABLES.product_lang.settings === 'object') ? TABLES.product_lang.settings : {};
        let TSET_STOCK = (TABLES.stock_available && typeof TABLES.stock_available.settings === 'object') ? TABLES.stock_available.settings : {};
        let TSET_ANY2 = {};
        let MFIELDS2 = {};
        let MDEF2 = {};
        let TDEF_STOCK_TBL2 = (TABLES.stock_available && typeof TABLES.stock_available.defaults === 'object') ? TABLES.stock_available.defaults : {};
        try {
          const rows = await pool.query(`SELECT table_name, settings, mapping FROM public.mod_grabbing_jerome_table_settings WHERE domain=$1 AND lower(page_type)=lower($2)`, [domain, type]);
          const map = new Map((rows.rows||[]).map(r => [String(r.table_name||'').toLowerCase(), r.settings || {}]));
          if (map.has('product')) TSET_PRODUCT = { ...TSET_PRODUCT, ...(map.get('product')||{}) };
          if (map.has('product_shop')) TSET_SHOP = { ...TSET_SHOP, ...(map.get('product_shop')||{}) };
          if (map.has('product_lang')) TSET_LANG = { ...TSET_LANG, ...(map.get('product_lang')||{}) };
          if (map.has('stock_available')) TSET_STOCK = { ...TSET_STOCK, ...(map.get('stock_available')||{}) };
          for (const r of (rows.rows||[])) {
            const t = String(r.table_name||'').toLowerCase();
            if (r.mapping && typeof r.mapping==='object' && r.mapping.defaults && typeof r.mapping.defaults==='object') {
              MDEF2[t] = r.mapping.defaults;
            }
            try { if (r.settings && typeof r.settings==='object') TSET_ANY2[t] = r.settings; } catch {}
            try { if (r.mapping && typeof r.mapping==='object' && r.mapping.fields && typeof r.mapping.fields==='object') MFIELDS2[t] = r.mapping.fields; } catch {}
          }
        } catch {}

        // Resolve global shops for preview (no fallback to 1)
        let SHOPS = ((Array.isArray(TSET_SHOP.id_shops) && TSET_SHOP.id_shops.length)
              ? TSET_SHOP.id_shops.map(n=>Number(n)||0).filter(n=>n>0)
              : (Array.isArray(mapping.id_shops) && mapping.id_shops.length)
                ? mapping.id_shops.map(n=>Number(n)||0).filter(n=>n>0)
                : []);
        if (!SHOPS.length) {
          try {
            const T_SHOP = PREFIX + 'shop';
            if (await hasTable(T_SHOP)) {
              const rows = await q(`SELECT ${qi('id_shop')} as id_shop FROM ${qi(T_SHOP)} WHERE ${qi('active')}=1 ORDER BY ${qi('id_shop')} ASC`);
              const ids = Array.isArray(rows) ? rows.map(r=>Number(r.id_shop)||0).filter(n=>n>0) : [];
              if (ids.length) SHOPS = ids;
            }
          } catch {}
        }
        const DEFAULTS = (mapping && mapping.defaults && typeof mapping.defaults === 'object') ? mapping.defaults : {};
        const DEF_PROD = (DEFAULTS.product && typeof DEFAULTS.product === 'object') ? DEFAULTS.product : {};
        const ID_SHOP_DEFAULT = (mapping.id_shop_default != null)
          ? (Number(mapping.id_shop_default) || (SHOPS[0] || 0))
          : ((TSET_PRODUCT.id_shop_default != null)
              ? (Number(TSET_PRODUCT.id_shop_default) || (SHOPS[0] || 0))
              : ((DEF_PROD && DEF_PROD.id_shop_default != null)
                  ? (Number(DEF_PROD.id_shop_default) || (SHOPS[0] || 0))
                  : (SHOPS[0] || 0)));
        // DEFAULTS and DEF_PROD already declared above; avoid duplicate declarations
        const DEF_SHOP = (DEFAULTS.product_shop && typeof DEFAULTS.product_shop === 'object') ? DEFAULTS.product_shop : {};
        const DEF_STOCK = (DEFAULTS.stock && typeof DEFAULTS.stock === 'object') ? DEFAULTS.stock : {};
        const DEF_STOCK_MERGED = { ...(DEF_STOCK||{}), ...(TDEF_STOCK_TBL2||{}), ...(MDEF2['stock_available']||{}) };
        const DEF_LANG = (DEFAULTS.product_lang && typeof DEFAULTS.product_lang === 'object') ? DEFAULTS.product_lang : {};
        // Derive tax rules groups for preview parity with send
        const productTaxRulesGroup = Number((mapping.id_tax_rules_group ?? TSET_PRODUCT?.id_tax_rules_group ?? DEF_PROD.id_tax_rules_group ?? DEF_SHOP.id_tax_rules_group ?? 0)) || 0;
        const shopTaxRulesGroup = Number((mapping.id_tax_rules_group ?? TSET_SHOP?.id_tax_rules_group ?? TSET_PRODUCT?.id_tax_rules_group ?? DEF_SHOP.id_tax_rules_group ?? DEF_PROD.id_tax_rules_group ?? 0)) || 0;

        // Resolve source values
        const result = run.result && typeof run.result === 'object' ? run.result : (run.result ? JSON.parse(run.result) : {});
        const src = result.product || result.item || result;
        const pickPath = (obj, pathStr) => { try { if (!pathStr) return undefined; const parts = String(pathStr).replace(/^\$\.?/, '').split('.'); let cur=obj; for (const p of parts) { if (cur==null) return undefined; cur = cur[p]; } return cur; } catch { return undefined; } };
        const pickFlex = (pathStr) => { if (!pathStr) return undefined; const s=String(pathStr).trim(); if (s.startsWith('$.')) return pickPath(result, s.slice(2)); if (s.startsWith('product.')) return pickPath(src, s.slice('product.'.length)); if (s.startsWith('item.')) return pickPath(src, s.slice('item.'.length)); if (s.startsWith('meta.')) return pickPath(result, s); let v = pickPath(src, s); if (v===undefined||v===null||v==='') v = pickPath(result, s); return v; };
        const applyTransforms = (val, transforms=[]) => {
          try {
            let out = val;
            for (const t of (Array.isArray(transforms)? transforms: [])) {
              const op = String(t?.op||'').toLowerCase();
              if (op==='trim') { out = (out==null?'':String(out)).trim(); continue; }
              if (op==='replace') { const find=String(t?.find||''); const rep=String(t?.replace||''); out = String(out==null?'':out).split(find).join(rep); continue; }
              if (op==='slugify') { try { const s=String(out==null?'':out); out = s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); } catch {} continue; }
            }
            return out;
          } catch { return val; }
        };
        const resolveSpec = (_obj, spec) => { 
          if (spec==null) return undefined; 
          if (Array.isArray(spec)) { for (const s of spec) { const v = resolveSpec(null, s); if (v!==undefined && v!==null && v!=='') return v; } return undefined; } 
          if (typeof spec === 'object') { const paths = Array.isArray(spec.paths)? spec.paths : (spec.path? [spec.path]: []); let v; for (const p of paths) { const tmp = pickFlex(p); if (tmp!==undefined && tmp!==null && tmp!=='') { v = tmp; break; } } if (v===undefined) v = pickFlex(spec.path||spec.p||''); return applyTransforms(v, spec.transforms||spec.ops||[]); }
          if (typeof spec === 'string') return pickFlex(spec); return spec; };
        const toNumber = (v) => { const n = Number(String(v||'').replace(/,/g,'.').replace(/[^0-9.\-]/g,'')); return Number.isFinite(n)? n: 0; };
        const toInt = (v) => { const n = parseInt(String(v||'').replace(/[^0-9\-]/g,''),10); return Number.isFinite(n)? n: 0; };
        const firstDef = (...arr) => { for (const v of arr) { if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
        const norm01 = (v, fallback=0) => { if (v === undefined || v === null || v === '') return Number(fallback) ? 1 : 0; if (typeof v === 'boolean') return v ? 1 : 0; const s = String(v).trim().toLowerCase(); if (s === 'true') return 1; if (s === 'false') return 0; const n = Number(s); return Number.isFinite(n) ? (n ? 1 : 0) : (s ? 1 : 0); };

        const FIELDS = (mapping && mapping.fields && typeof mapping.fields === 'object') ? mapping.fields : {};
        const F_PRODUCT = (TABLES.product && typeof TABLES.product.fields === 'object') ? TABLES.product.fields : null;
        const F_SHOP = (TABLES.product_shop && typeof TABLES.product_shop.fields === 'object') ? TABLES.product_shop.fields : null;
        const F_LANG = (TABLES.product_lang && typeof TABLES.product_lang.fields === 'object') ? TABLES.product_lang.fields : null;
        const F_STOCK = (TABLES.stock_available && typeof TABLES.stock_available.fields === 'object') ? TABLES.stock_available.fields : null;

        const sanitizeStr = (v) => { try { if (v === undefined || v === null) return ''; let s = String(v); s = s.trim(); const lc = s.toLowerCase(); if (lc==='undefined' || lc==='null' || lc==='nan') return ''; return s; } catch { return ''; } };
        const val = {
          name: firstDef(F_LANG ? resolveSpec(null, F_LANG.name) : undefined, F_PRODUCT ? resolveSpec(null, F_PRODUCT.name) : undefined, resolveSpec(null, FIELDS.name), resolveSpec(null, ['title','name']), 'Imported Product'),
          description: firstDef(F_LANG ? resolveSpec(null, F_LANG.description) : undefined, F_PRODUCT ? resolveSpec(null, F_PRODUCT.description) : undefined, resolveSpec(null, FIELDS.description), resolveSpec(null, ['description','content','product.description_html']), ''),
          reference: sanitizeStr(firstDef(F_PRODUCT ? resolveSpec(null, F_PRODUCT.reference) : undefined, resolveSpec(null, FIELDS.reference), resolveSpec(null, ['sku','reference','json_ld.mapped.mpn']), '') || ''),
          supplier_reference: sanitizeStr(firstDef(F_PRODUCT ? resolveSpec(null, F_PRODUCT.supplier_reference) : undefined, resolveSpec(null, FIELDS.supplier_reference), resolveSpec(null, ['supplier_reference','mpn','json_ld.mapped.mpn']), '') || ''),
          price: toNumber(firstDef(F_PRODUCT ? resolveSpec(null, F_PRODUCT.price) : undefined, resolveSpec(null, FIELDS.price), resolveSpec(null, ['price','price_without_tax','price_with_tax']), 0)),
          quantity: toInt(firstDef(F_STOCK ? resolveSpec(null, F_STOCK.quantity) : undefined, resolveSpec(null, FIELDS.quantity), resolveSpec(null, ['quantity','stock.quantity','qty']), 0)),
          ean13: sanitizeStr(firstDef(F_PRODUCT ? resolveSpec(null, F_PRODUCT.ean13) : undefined, resolveSpec(null, FIELDS.ean13), resolveSpec(null, ['ean','ean13','json_ld.mapped.gtin13']), '')),
          isbn: sanitizeStr(firstDef(F_PRODUCT ? resolveSpec(null, F_PRODUCT.isbn) : undefined, '')),
          upc: sanitizeStr(firstDef(F_PRODUCT ? resolveSpec(null, F_PRODUCT.upc) : undefined, '')),
          mpn: sanitizeStr(firstDef(F_PRODUCT ? resolveSpec(null, F_PRODUCT.mpn) : undefined, resolveSpec(null, FIELDS.mpn), resolveSpec(null, ['mpn','json_ld.mapped.mpn']), '')),
          wholesale_price: toNumber(firstDef(F_PRODUCT ? resolveSpec(null, F_PRODUCT.wholesale_price) : undefined, null)),
          weight: toNumber(firstDef(F_PRODUCT ? resolveSpec(null, F_PRODUCT.weight) : undefined, null)),
          width: toNumber(firstDef(F_PRODUCT ? resolveSpec(null, F_PRODUCT.width) : undefined, null)),
          height: toNumber(firstDef(F_PRODUCT ? resolveSpec(null, F_PRODUCT.height) : undefined, null)),
          depth: toNumber(firstDef(F_PRODUCT ? resolveSpec(null, F_PRODUCT.depth) : undefined, null)),
        };

        // Tables
        const T_PRODUCT = PREFIX + 'product';
        const T_PRODUCT_LANG = PREFIX + 'product_lang';
        const T_PRODUCT_SHOP = PREFIX + 'product_shop';
        const T_STOCK = PREFIX + 'stock_available';

        // Resolve productId for preview matching
        let productId = Number(req.body?.product_id || 0) || 0;
        if (productId > 0) {
          const rows = await q(`SELECT ${'`id_product`'} FROM ${'`'}${T_PRODUCT}${'`'} WHERE ${'`id_product`'}=? LIMIT 1`, [productId]);
          if (!rows || !rows.length) productId = 0;
        }
        if (!productId && val.reference) {
          const rows = await q(`SELECT ${'`id_product`'} FROM ${'`'}${T_PRODUCT}${'`'} WHERE ${'`reference`'} = ? ORDER BY ${'`id_product`'} DESC LIMIT 1`, [String(val.reference)]);
          if (rows && rows.length) productId = Number(rows[0].id_product || 0) || 0;
        }
        if (!productId && val.name) {
          const hasProductLang = await hasTable(T_PRODUCT_LANG);
          const productLangHasShop = hasProductLang ? await hasColumn(T_PRODUCT_LANG, 'id_shop') : false;
          if (hasProductLang && productLangHasShop) {
            const rows = await q(`SELECT p.${'`id_product`'} FROM ${'`'}${T_PRODUCT}${'`'} p JOIN ${'`'}${T_PRODUCT_LANG}${'`'} pl ON pl.${'`id_product`'}=p.${'`id_product`'} WHERE pl.${'`id_lang`'}=? AND pl.${'`id_shop`'}=? AND pl.${'`name`'}=? ORDER BY p.${'`id_product`'} DESC LIMIT 1`, [ID_LANG, ID_SHOP_DEFAULT, String(val.name)]);
            if (rows && rows.length) productId = Number(rows[0].id_product || 0) || 0;
          } else if (hasProductLang) {
            const rows = await q(`SELECT p.${'`id_product`'} FROM ${'`'}${T_PRODUCT}${'`'} p JOIN ${'`'}${T_PRODUCT_LANG}${'`'} pl ON pl.${'`id_product`'}=p.${'`id_product`'} WHERE pl.${'`id_lang`'}=? AND pl.${'`name`'}=? ORDER BY p.${'`id_product`'} DESC LIMIT 1`, [ID_LANG, String(val.name)]);
            if (rows && rows.length) productId = Number(rows[0].id_product || 0) || 0;
          }
        }

        const plan = { product: null, product_shop: [], product_lang: [], stock_available: [], image: [], image_shop: [], image_lang: [], extra: {} };
        const isArticle = (type === 'article');
        const hasProduct = !isArticle && await hasTable(T_PRODUCT);
        const hasProductShop = !isArticle && await hasTable(T_PRODUCT_SHOP);
        const hasProductLang = !isArticle && await hasTable(T_PRODUCT_LANG);

        // product block
        if (!isArticle && hasProduct) {
          const pVisibility = (TSET_PRODUCT.visibility != null) ? String(TSET_PRODUCT.visibility) : String(DEF_SHOP.visibility || DEF_PROD.visibility || 'both');
          const pCondition = (TSET_PRODUCT.condition != null) ? String(TSET_PRODUCT.condition) : String(DEF_SHOP.condition || DEF_PROD.condition || 'new');
          const pAvail = (TSET_PRODUCT.available_for_order != null) ? (TSET_PRODUCT.available_for_order ? 1 : 0) : ((DEF_SHOP.available_for_order ?? 1) ? 1 : 0);
          const pShowPrice = (TSET_PRODUCT.show_price != null) ? (TSET_PRODUCT.show_price ? 1 : 0) : ((DEF_SHOP.show_price ?? 1) ? 1 : 0);
          const pIndexed = (TSET_PRODUCT.indexed != null) ? (TSET_PRODUCT.indexed ? 1 : 0) : ((DEF_SHOP.indexed ?? DEF_PROD.indexed ?? 0) ? 1 : 0);
          const productCols = {};
          const setCols = {};
            if (await hasColumn(T_PRODUCT, 'id_category_default')) {
              const catId = (mapping.id_category_default != null)
                ? (Number(mapping.id_category_default) || null)
                : (TSET_PRODUCT.id_category_default != null)
                  ? (Number(TSET_PRODUCT.id_category_default) || null)
                  : (DEF_PROD.id_category_default != null)
                    ? (Number(DEF_PROD.id_category_default) || null)
                    : null;
              productCols['id_category_default'] = catId;
            }
          if (await hasColumn(T_PRODUCT, 'id_supplier') && (mapping.id_supplier != null)) productCols['id_supplier'] = Number(mapping.id_supplier)||null;
          if (await hasColumn(T_PRODUCT, 'id_manufacturer') && (mapping.id_manufacturer != null)) productCols['id_manufacturer'] = Number(mapping.id_manufacturer)||null;
          if (await hasColumn(T_PRODUCT, 'id_shop_default')) productCols['id_shop_default'] = ID_SHOP_DEFAULT;
          if (await hasColumn(T_PRODUCT, 'visibility')) { productCols['visibility'] = pVisibility; setCols['visibility'] = pVisibility; }
          if (await hasColumn(T_PRODUCT, 'condition')) { productCols['condition'] = pCondition; setCols['condition'] = pCondition; }
          if (await hasColumn(T_PRODUCT, 'available_for_order')) { productCols['available_for_order'] = pAvail; setCols['available_for_order'] = pAvail; }
          if (await hasColumn(T_PRODUCT, 'show_price')) { productCols['show_price'] = pShowPrice; setCols['show_price'] = pShowPrice; }
          if (await hasColumn(T_PRODUCT, 'indexed')) { productCols['indexed'] = pIndexed; setCols['indexed'] = pIndexed; }
          if (await hasColumn(T_PRODUCT, 'active')) { productCols['active'] = 1; setCols['active'] = 1; }
          if (await hasColumn(T_PRODUCT, 'price')) { productCols['price'] = Number(val.price||0); setCols['price'] = Number(val.price||0); }
          if (await hasColumn(T_PRODUCT, 'reference')) { productCols['reference'] = String(val.reference||''); setCols['reference'] = String(val.reference||''); }
          if (await hasColumn(T_PRODUCT, 'supplier_reference')) { productCols['supplier_reference'] = String(val.supplier_reference||''); setCols['supplier_reference'] = String(val.supplier_reference||''); }
          if (await hasColumn(T_PRODUCT, 'ean13')) { productCols['ean13'] = String(val.ean13||''); setCols['ean13'] = String(val.ean13||''); }
          if (await hasColumn(T_PRODUCT, 'isbn')) { productCols['isbn'] = String(val.isbn||''); setCols['isbn'] = String(val.isbn||''); }
          if (await hasColumn(T_PRODUCT, 'upc')) { productCols['upc'] = String(val.upc||''); setCols['upc'] = String(val.upc||''); }
          if (await hasColumn(T_PRODUCT, 'mpn')) { productCols['mpn'] = String(val.mpn||''); setCols['mpn'] = String(val.mpn||''); }
          if (await hasColumn(T_PRODUCT, 'wholesale_price') && Number.isFinite(val.wholesale_price)) { productCols['wholesale_price'] = Number(val.wholesale_price||0); setCols['wholesale_price'] = Number(val.wholesale_price||0); }
          if (await hasColumn(T_PRODUCT, 'weight') && Number.isFinite(val.weight)) { productCols['weight'] = Number(val.weight||0); setCols['weight'] = Number(val.weight||0); }
          if (await hasColumn(T_PRODUCT, 'width') && Number.isFinite(val.width)) { productCols['width'] = Number(val.width||0); setCols['width'] = Number(val.width||0); }
          if (await hasColumn(T_PRODUCT, 'height') && Number.isFinite(val.height)) { productCols['height'] = Number(val.height||0); setCols['height'] = Number(val.height||0); }
          if (await hasColumn(T_PRODUCT, 'depth') && Number.isFinite(val.depth)) { productCols['depth'] = Number(val.depth||0); setCols['depth'] = Number(val.depth||0); }
          if (await hasColumn(T_PRODUCT, 'date_add')) productCols['date_add'] = (DEF_PROD.date_add != null) ? String(DEF_PROD.date_add) : nowFmt;
          if (await hasColumn(T_PRODUCT, 'date_upd')) { const v = (DEF_PROD.date_upd != null) ? String(DEF_PROD.date_upd) : nowFmt; productCols['date_upd'] = v; setCols['date_upd'] = v; }
          if (await hasColumn(T_PRODUCT, 'id_tax_rules_group')) { productCols['id_tax_rules_group'] = productTaxRulesGroup; setCols['id_tax_rules_group'] = productTaxRulesGroup; }
          plan.product = { table: T_PRODUCT, exists: productId>0, product_id: productId||'' , insert: productCols, update: setCols };
        }

        // product_shop (prefer per-table mapping.tables.product_shop.settings.id_shops)
        if (!isArticle && hasProductShop) {
          const TSET_MAP_SHOP = (TABLES.product_shop && typeof TABLES.product_shop.settings === 'object') ? TABLES.product_shop.settings : {};
          const SHOPS_FOR_PRODUCT_SHOP = (Array.isArray(TSET_MAP_SHOP?.id_shops) && TSET_MAP_SHOP.id_shops.length)
            ? TSET_MAP_SHOP.id_shops.map(n=>Number(n)||0).filter(n=>n>0)
            : SHOPS;
          for (const SID of SHOPS_FOR_PRODUCT_SHOP) {
            const sVisibility = (TSET_SHOP.visibility != null) ? String(TSET_SHOP.visibility) : String(DEF_SHOP.visibility || DEF_PROD.visibility || 'both');
            const sCondition = (TSET_SHOP.condition != null) ? String(TSET_SHOP.condition) : String(DEF_SHOP.condition || DEF_PROD.condition || 'new');
            const sAvail = (TSET_SHOP.available_for_order != null) ? (TSET_SHOP.available_for_order ? 1 : 0) : ((DEF_SHOP.available_for_order ?? 1) ? 1 : 0);
            const sShowPrice = (TSET_SHOP.show_price != null) ? (TSET_SHOP.show_price ? 1 : 0) : ((DEF_SHOP.show_price ?? 1) ? 1 : 0);
            const sIndexed = (TSET_SHOP.indexed != null) ? (TSET_SHOP.indexed ? 1 : 0) : ((DEF_SHOP.indexed ?? DEF_PROD.indexed ?? 0) ? 1 : 0);
            const sActive = (TSET_SHOP.active != null) ? (TSET_SHOP.active ? 1 : 0) : 1;
            const rowS = { id_product: productId||'' , id_shop: SID };
            if (await hasColumn(T_PRODUCT_SHOP, 'id_category_default')) rowS['id_category_default'] = (TSET_SHOP.id_category_default != null) ? Number(TSET_SHOP.id_category_default) : null;
            if (await hasColumn(T_PRODUCT_SHOP, 'price')) rowS['price'] = Number(val.price||0);
            if (await hasColumn(T_PRODUCT_SHOP, 'active')) rowS['active'] = sActive;
            if (await hasColumn(T_PRODUCT_SHOP, 'visibility')) rowS['visibility'] = sVisibility;
            if (await hasColumn(T_PRODUCT_SHOP, 'condition')) rowS['condition'] = sCondition;
            if (await hasColumn(T_PRODUCT_SHOP, 'available_for_order')) rowS['available_for_order'] = sAvail;
            if (await hasColumn(T_PRODUCT_SHOP, 'show_price')) rowS['show_price'] = sShowPrice;
            if (await hasColumn(T_PRODUCT_SHOP, 'indexed')) rowS['indexed'] = sIndexed;
            if (await hasColumn(T_PRODUCT_SHOP, 'date_add')) rowS['date_add'] = (DEF_SHOP.date_add != null) ? String(DEF_SHOP.date_add) : nowFmt;
            if (await hasColumn(T_PRODUCT_SHOP, 'date_upd')) rowS['date_upd'] = (DEF_SHOP.date_upd != null) ? String(DEF_SHOP.date_upd) : nowFmt;
            if (await hasColumn(T_PRODUCT_SHOP, 'id_tax_rules_group')) rowS['id_tax_rules_group'] = shopTaxRulesGroup;
            plan.product_shop.push({ table: T_PRODUCT_SHOP, id_shop: SID, columns: rowS });
          }
        }

        // product_lang
        if (!isArticle && hasProductLang) {
          // Always use all active ps_lang (no per-table override)
          let LANGS = [];
          try {
            const T_LANG = PREFIX + 'lang';
            if (await hasTable(T_LANG)) {
              const rows = await q(`SELECT ${'`id_lang`'} as id_lang FROM ${'`'}${T_LANG}${'`'} WHERE ${'`active`'}=1 ORDER BY ${'`id_lang`'} ASC`);
              LANGS = Array.isArray(rows) ? rows.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : [];
            }
          } catch {}
          if (!LANGS.length) LANGS = [ID_LANG];
          const TSET_MAP_LANG = (TABLES.product_lang && typeof TABLES.product_lang.settings === 'object') ? TABLES.product_lang.settings : {};
          const productLangHasShopCol = await hasColumn(T_PRODUCT_LANG, 'id_shop');
          // Always use global Shop destinations for product_lang
          try { chatLog?.('preview_product_lang_scope', { shops: SHOPS, langs: LANGS }); } catch {}
          const SHOPS_FOR_PRODUCT_LANG = SHOPS;
          for (const L of LANGS) {
            const name = String(firstDef(F_LANG ? resolveSpec(null, F_LANG.name) : undefined, val.name, 'Imported Product'));
            const descVal = firstDef(F_LANG ? resolveSpec(null, F_LANG.description) : undefined, val.description, resolveSpec(null, ['product.description_html','meta.description']), '');
            const desc = descVal == null ? '' : String(descVal);
            let descShortRaw = firstDef(F_LANG ? resolveSpec(null, F_LANG.description_short) : undefined, resolveSpec(null, ['product.description_short','meta.description']), '');
            let descShort = descShortRaw == null ? '' : String(descShortRaw);
            try { const maxS = await getColMaxLen(T_PRODUCT_LANG, 'description_short'); if (maxS && descShort && descShort.length > maxS) descShort = descShort.slice(0, maxS); } catch {}
            const slug = slugify(name);
            const metaTitle = sanitizeStr(firstDef(F_LANG ? resolveSpec(null, F_LANG.meta_title) : undefined, ''));
            const metaDesc = sanitizeStr(firstDef(F_LANG ? resolveSpec(null, F_LANG.meta_description) : undefined, ''));
            const row = { id_product: productId||'', id_lang: L, name, link_rewrite: slug, description: desc, description_short: descShort, meta_title: metaTitle, meta_description: metaDesc };
            if (await hasColumn(T_PRODUCT_LANG, 'date_add')) row['date_add'] = (DEF_LANG.date_add != null) ? String(DEF_LANG.date_add) : nowFmt;
            if (await hasColumn(T_PRODUCT_LANG, 'date_upd')) row['date_upd'] = (DEF_LANG.date_upd != null) ? String(DEF_LANG.date_upd) : nowFmt;
            if (productLangHasShopCol) {
              for (const SID of SHOPS_FOR_PRODUCT_LANG) plan.product_lang.push({ table: T_PRODUCT_LANG, id_lang: L, columns: { ...row, id_shop: SID } });
            } else {
              plan.product_lang.push({ table: T_PRODUCT_LANG, id_lang: L, columns: row });
            }
          }
        }

        // stock_available (product only)
        if (type === 'product' && await hasTable(T_STOCK)) {
          const outOfStock = norm01(DEF_STOCK_MERGED.out_of_stock, 0);
          for (const SID of SHOPS) {
            const qtyDefault = (TSET_STOCK?.default_quantity != null) ? Number(TSET_STOCK.default_quantity||0) : Number(DEF_STOCK_MERGED.quantity||0);
            const physDefault = (TSET_STOCK?.default_physical_quantity != null) ? Number(TSET_STOCK.default_physical_quantity||0) : Number(DEF_STOCK_MERGED.physical_quantity||0);
            const row = { id_product: productId||'', id_product_attribute: 0, id_shop: SID, id_shop_group: 0, quantity: qtyDefault, out_of_stock: outOfStock };
            if (await hasColumn(T_STOCK, 'physical_quantity')) row['physical_quantity'] = physDefault;
            plan.stock_available.push({ table: T_STOCK, id_shop: SID, columns: row });
          }
        }

        // Images preview (product only)
        try {
          if (type !== 'product') throw new Error('skip_non_product');
          const T_IMAGE = PREFIX + 'image';
          const T_IMAGE_SHOP = PREFIX + 'image_shop';
          const T_IMAGE_LANG = PREFIX + 'image_lang';
          if (await hasTable(T_IMAGE) && productId) {
            const urls = [];
            try { if (Array.isArray(result.images)) for (const u of result.images) { const s=String(u||'').trim(); if (s) urls.push(s); } } catch {}
            try { const jl = result?.json_ld?.raw?.image; if (Array.isArray(jl)) for (const it of jl) { const s = typeof it==='string'? it: (it&&it.url? it.url: ''); if (s) urls.push(String(s)); } } catch {}
            const uniq = Array.from(new Set(urls));
            if (uniq.length) {
              for (let i=0;i<uniq.length;i++) {
                const position = i + 1;
                const isCover = (i === 0) ? 1 : 0;
                plan.image.push({ table: T_IMAGE, columns: { id_product: productId||'', position, cover: isCover, source_url: uniq[i] } });
                if (await hasTable(T_IMAGE_SHOP)) {
                  // determine shop list for image_shop: prefer mapping.tables.image.settings.id_shops
                  let shopsImg = SHOPS;
                  try {
                    const TSET_IMAGE = (TSET_ANY2 && TSET_ANY2['image']) || (TABLES.image && TABLES.image.settings) || {};
                    if (Array.isArray(TSET_IMAGE?.id_shops) && TSET_IMAGE.id_shops.length) shopsImg = TSET_IMAGE.id_shops.map(n=>Number(n)||0).filter(n=>n>0);
                  } catch {}
                  for (const SID of shopsImg) plan.image_shop.push({ table: T_IMAGE_SHOP, id_shop: SID, columns: { id_image: '', id_shop: SID, cover: isCover } });
                }
                if (await hasTable(T_IMAGE_LANG)) {
                  let langs = [];
                  if (Array.isArray(TSET_LANG?.id_langs) && TSET_LANG.id_langs.length) langs = TSET_LANG.id_langs.map(n=>Number(n)||0).filter(n=>n>0);
                  else {
                    const T_LANG = PREFIX + 'lang';
                    if (await hasTable(T_LANG)) {
                      const rowsL = await q(`SELECT ${'`id_lang`'} as id_lang FROM ${'`'}${T_LANG}${'`'} WHERE ${'`active`'}=1`);
                      langs = Array.isArray(rowsL) ? rowsL.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : [];
                    }
                    if (!langs.length) langs = [ID_LANG];
                  }
                  for (const L of langs) plan.image_lang.push({ table: T_IMAGE_LANG, id_lang: L, columns: { id_image: '', id_lang: L, legend: String(val.name||'') } });
                }
              }
            }
          }
        } catch {}

        // Documents (attachments) preview (product only)
        try {
          if (type !== 'product') throw new Error('skip_non_product');
          const T_ATTACHMENT = PREFIX + 'attachment';
          const T_ATTACHMENT_LANG = PREFIX + 'attachment_lang';
          const T_PRODUCT_ATTACHMENT = PREFIX + 'product_attachment';
          const hasAttach = await hasTable(T_ATTACHMENT);
          const docs = Array.isArray(result?.documents) ? result.documents : [];
          if (hasAttach && docs.length) {
            if (!plan.extra) plan.extra = {};
            plan.extra.attachment = [];
            if (await hasTable(T_ATTACHMENT_LANG)) plan.extra.attachment_lang = [];
            if (await hasTable(T_PRODUCT_ATTACHMENT)) plan.extra.product_attachment = [];
            const baseName = (u) => { try { const p = new URL(String(u)).pathname || ''; const b = decodeURIComponent(p.split('/').pop()||'document'); return b || 'document.pdf'; } catch { return 'document.pdf'; } };
            const guessMime = (n) => { const s=String(n||'').toLowerCase(); if (s.endsWith('.pdf')) return 'application/pdf'; if (s.endsWith('.doc')||s.endsWith('.docx')) return 'application/msword'; if (s.endsWith('.xls')||s.endsWith('.xlsx')) return 'application/vnd.ms-excel'; if (s.endsWith('.zip')) return 'application/zip'; return 'application/octet-stream'; };
            for (const u of docs) {
              const name = baseName(u);
              const mime = guessMime(name);
              plan.extra.attachment.push({ table: T_ATTACHMENT, columns: { file: '(sha1 at send)', file_name: name, mime } });
              if (plan.extra.attachment_lang) plan.extra.attachment_lang.push({ table: T_ATTACHMENT_LANG, id_lang: ID_LANG, columns: { name, description: '' } });
              if (plan.extra.product_attachment) plan.extra.product_attachment.push({ table: T_PRODUCT_ATTACHMENT, columns: { id_product: productId || '' } });
            }
          }
        } catch {}

        // Generic extra tables preview using Smart Settings schema
        // Preload product attribute ids to expand *_product_attribute* rows across shops
        let ATTR_IDS = [];
        try {
          const T_PA = PREFIX + 'product_attribute';
          if (await hasTable(T_PA) && productId) {
            const rowsA = await q(`SELECT ${'`id_product_attribute`'} AS id FROM ${'`'}${T_PA}${'`'} WHERE ${'`id_product`'}=?`, [productId]);
            ATTR_IDS = Array.isArray(rowsA) ? rowsA.map(r=>Number(r.id)||0).filter(n=>n>0) : [];
          }
        } catch {}
        try {
          const handled = new Set(['product','product_shop','product_lang','stock_available','image','image_shop','image_lang']);
          const allNames = new Set();
          try { for (const k of Object.keys(TABLES||{})) allNames.add(String(k)); } catch {}
          try { for (const k of Object.keys(TSET_ANY2||{})) allNames.add(String(k)); } catch {}
          try { for (const k of Object.keys(MFIELDS2||{})) allNames.add(String(k)); } catch {}
          const names = Array.from(allNames).filter(n => !ALLOW_SET || ALLOW_SET.has(String(n)));
          for (const tName of names) {
            if (handled.has(tName)) continue;
            const T = PREFIX + tName;
            if (!(await hasTable(T))) continue;
            const fieldsFromMap = (TABLES[tName] && typeof TABLES[tName].fields === 'object') ? TABLES[tName].fields : {};
            const fieldsFromDb = MFIELDS2[tName] || {};
            const F_T = { ...fieldsFromMap, ...fieldsFromDb };
            const setFromMap = (TABLES[tName] && typeof TABLES[tName].settings === 'object') ? TABLES[tName].settings : {};
            const setFromDb = TSET_ANY2[tName] || {};
            const TSETX = { ...setFromMap, ...setFromDb };
            const DEF_TBL = (DEFAULTS && typeof DEFAULTS[tName] === 'object') ? DEFAULTS[tName] : {};
            const DEF_TSET = (MDEF2 && typeof MDEF2[tName] === 'object') ? MDEF2[tName] : {};
            // mapping.defaults have priority
            const DEF_MERGED = { ...(DEF_TSET||{}), ...(DEF_TBL||{}) };
            const hasShopCol = await hasColumn(T, 'id_shop');
            const hasLangCol = await hasColumn(T, 'id_lang');
            // Enforce global Shop destinations for preview when table has id_shop
            const shopsList = hasShopCol ? [ ...SHOPS ] : [ null ];
            // Always use all active ps_lang for preview when table has id_lang
            const langsList = hasLangCol ? [...LANGS] : [null];
            const SH = hasShopCol ? shopsList : [null];
            const LG = hasLangCol ? langsList : [null];
            for (const SID of SH) {
              for (const L of LG) {
                const row = {};
                for (const [k,v] of Object.entries(DEF_MERGED)) row[k] = v;
                for (const [col, spec] of Object.entries(F_T)) {
                  const v = (typeof spec==='string'||Array.isArray(spec)) ? (function(){
                    const pickPath2 = (obj, pathStr) => { try { if (!pathStr) return undefined; const parts = String(pathStr).replace(/^\$\.?/, '').split('.'); let cur=obj; for (const p of parts){ if(cur==null) return undefined; cur=cur[p]; } return cur; } catch { return undefined; } };
                    const pickFlex2 = (s) => { if (!s) return undefined; const t=String(s).trim(); if (t.startsWith('$.')) return pickPath2(result, t.slice(2)); if (t.startsWith('product.')) return pickPath2(src, t.slice('product.'.length)); if (t.startsWith('item.')) return pickPath2(src, t.slice('item.'.length)); if (t.startsWith('meta.')) return pickPath2(result, t); let v=pickPath2(src, t); if (v===undefined||v===null||v==='') v=pickPath2(result, t); return v; };
                    if (Array.isArray(spec)) { for (const s of spec) { const v = pickFlex2(s); if (v!==undefined&&v!==null&&v!=='') return v; } return undefined; }
                    return pickFlex2(spec);
                  })() : spec;
                  if (v !== undefined && v !== null && v !== '') row[col] = v;
                }
                for (const [k,v] of Object.entries(TSETX)) { if (k!=='id_shops' && k!=='id_langs' && k!=='keys') row[k] = v; }
                if (hasShopCol && SID!=null) row['id_shop'] = SID;
                if (hasLangCol && L!=null) row['id_lang'] = L;
                if (await hasColumn(T, 'id_product') && row['id_product'] == null) row['id_product'] = productId || '';
                if (!plan.extra[tName]) plan.extra[tName] = [];
                let pushed = false;
                try {
                  const hasAttrCol = await hasColumn(T, 'id_product_attribute');
                  const cur = row['id_product_attribute'];
                  const empty = (cur == null || cur === '' || Number(cur) === 0);
                  if (hasAttrCol && empty) {
                    if (ATTR_IDS.length) {
                      for (const pid of ATTR_IDS) {
                        plan.extra[tName].push({ table: T, id_shop: SID, id_lang: L, columns: { ...row, id_product_attribute: pid } });
                      }
                      pushed = true;
                    } else {
                      // leave blank attribute id in preview to indicate dependency
                      plan.extra[tName].push({ table: T, id_shop: SID, id_lang: L, columns: { ...row, id_product_attribute: '' } });
                      pushed = true;
                    }
                  }
                } catch {}
                if (!pushed) plan.extra[tName].push({ table: T, id_shop: SID, id_lang: L, columns: row });
              }
            }
          }
        } catch {}

        // Sort extra tables by name for stable preview order
        try {
          if (plan.extra && typeof plan.extra === 'object') {
            const sorted = {};
            for (const k of Object.keys(plan.extra).sort((a,b)=>String(a).localeCompare(String(b)))) sorted[k] = plan.extra[k];
            plan.extra = sorted;
          }
        } catch {}
        const hasExtraRows = plan.extra && Object.values(plan.extra).some(arr => Array.isArray(arr) && arr.length);
        const hasAny = plan.product || plan.product_shop.length || plan.product_lang.length || plan.stock_available.length || hasExtraRows || plan.image.length || plan.image_shop.length || plan.image_lang.length;
        const counts = { product: plan.product?1:0, product_shop: plan.product_shop.length, product_lang: plan.product_lang.length, stock_available: plan.stock_available.length, image: plan.image.length, image_shop: plan.image_shop.length, image_lang: plan.image_lang.length, extra_keys: Object.keys(plan.extra||{}).length };
        try { chatLog('preview_plan_counts', { run_id: run.id, domain, counts }); } catch {}
        if (!hasAny) return res.status(404).json({ ok:false, error:'nothing_to_preview' });
        try { chatLog('preview_done', { run_id: run.id, ok: true }); } catch {}
        return res.json({ ok:true, plan, mapping: { id_lang: ID_LANG, id_shop_default: ID_SHOP_DEFAULT, id_shops: SHOPS } });
      } catch (e) {
        try { chatLog('preview_failed', { run_id: Number(req.body?.run_id||0)||0, error: String(e?.message||e) }); } catch {}
        return res.status(500).json({ ok:false, error:'preview_failed', message: e?.message || String(e) });
      } finally { try { if (conn) await conn.end(); } catch {} }
    } catch (e) {
      return res.status(500).json({ ok:false, error:'preview_failed', message: e?.message || String(e) });
    }
  });

  // Verify image files for a product/id_image across staging and img_root
  // GET /api/grabbing-jerome/transfer/prestashop/images/verify?domain=&page_type=product&profile_id=&product_id=4077&id_image=
  app.get('/api/grabbing-jerome/transfer/prestashop/images/verify', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const domain = normDomain(req.query?.domain);
      const pageType = String(req.query?.page_type || 'product').trim().toLowerCase();
      const explicitProfileId = req.query?.profile_id != null ? Number(req.query.profile_id) : null;
      const productId = req.query?.product_id != null ? Number(req.query.product_id) : 0;
      const filterIdImage = req.query?.id_image != null ? Number(req.query.id_image) : 0;
      if (!domain || !productId) return res.status(400).json({ ok:false, error:'bad_request', message:'domain and product_id required' });

      // Resolve profile id via domain config when not explicit
      let profileId = explicitProfileId;
      if (!profileId) {
        try {
          const d = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
          const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
          if (ct && typeof ct === 'object' && ct.db_mysql_profile_id) profileId = Number(ct.db_mysql_profile_id) || null;
        } catch {}
      }
      if (!profileId) return res.status(400).json({ ok:false, error:'missing_profile', message:'Select a PrestaShop DB profile (db-mysql) first.' });

      // Load MySQL profile
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];

      let mysql = null;
      try { const mod = await import('../../../db-mysql/backend/utils/mysql2.js'); mysql = await mod.getMysql2(ctx); }
      catch (e) { return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend' }); }
      const cfg = { host: String(prof.host||'localhost'), port: Number(prof.port||3306), user: String(prof.user||''), password: String(prof.password||''), database: String(prof.database||''), ssl: prof.ssl ? { rejectUnauthorized: false } : undefined };

      let conn;
      try {
        conn = await mysql.createConnection(cfg);
        const q = async (sql, args=[]) => { const [rows] = await conn.query(sql, args); return rows; };
        const qi = (ident) => '`' + String(ident||'').replace(/`/g, '``') + '`';
        const hasTable = async (name) => { const rows = await q('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1', [cfg.database, name]); return Array.isArray(rows)&&rows.length>0; };

        // Resolve mapping + settings (prefix, image settings)
        const ctRes = await pool.query('select config_transfert from public.mod_grabbing_jerome_domains where domain=$1', [domain]);
        const ct = ctRes.rowCount ? (ctRes.rows[0]?.config_transfert || {}) : {};
        const mapping = (ct && ct.mappings && ct.mappings[pageType]) || ct?.mapping || {};
        const PREFIX_DEFAULT = String(((ct && (ct.db_mysql_prefix || ct.db_prefix)) || 'ps_'));
        const PREFIX = String(mapping.prefix || PREFIX_DEFAULT || 'ps_');
        let TSET_IMAGE = {};
        try {
          const rows = await pool.query(`SELECT table_name, settings, setting_image FROM public.mod_grabbing_jerome_table_settings WHERE domain=$1 AND lower(page_type)=lower($2)`, [domain, pageType]);
          for (const r of (rows.rows||[])) {
            const t = String(r.table_name||'').toLowerCase();
            if (t === 'image') {
              if (r.setting_image && typeof r.setting_image==='object') TSET_IMAGE = r.setting_image;
              else if (r.settings && typeof r.settings==='object') TSET_IMAGE = r.settings;
            }
          }
        } catch {}
        // Image types
        const T_IT = PREFIX + 'image_type';
        let imageTypes = [];
        if (await hasTable(T_IT)) {
          try {
            const [x] = await conn.query(`SELECT name, width, height FROM ${qi(T_IT)} ORDER BY name asc`);
            imageTypes = Array.isArray(x)? x: [];
          } catch {}
        }
        return res.json({ ok:true, profile: { id: prof.id, host: prof.host, database: prof.database }, table: { image_type: T_IT }, image_types: imageTypes });
      } catch (e) {
        return res.status(500).json({ ok:false, error:'images_verify_failed', message: e?.message || String(e) });
      } finally { try { if (conn) await conn.end(); } catch {} }
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // GET /api/grabbing-jerome/transfer/prestashop/schema?tables=product,product_shop,product_lang,stock_available&domain=&profile_id=&prefix=ps_
  app.get('/api/grabbing-jerome/transfer/prestashop/schema', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const explicitProfileId = req.query?.profile_id != null ? Number(req.query.profile_id) : null;
      const domain = normDomain(req.query?.domain);
      let DEFAULT_PREFIX = 'ps_';
      if (domain) {
        try {
          const d = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
          const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
          const dp = ct.db_mysql_prefix || ct.db_prefix || (ct.mapping && ct.mapping.prefix) || null;
          if (dp && String(dp).trim()) DEFAULT_PREFIX = String(dp).trim();
        } catch {}
      }
      const PREFIX = String(req.query?.prefix || DEFAULT_PREFIX || 'ps_');
      const tablesReq = String(req.query?.tables || '').split(',').map(s=>s.trim()).filter(Boolean);
      let profileId = explicitProfileId;
      if (!profileId && domain) {
        try {
          const d = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
          const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
          if (ct && typeof ct === 'object' && ct.db_mysql_profile_id) profileId = Number(ct.db_mysql_profile_id) || null;
        } catch {}
      }
      if (!profileId) return res.status(400).json({ ok:false, error:'missing_profile', message:'Select a PrestaShop DB profile (db-mysql) first.' });
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];
      let mysql = null;
      try {
        const mod = await import('../../../db-mysql/backend/utils/mysql2.js');
        mysql = await mod.getMysql2(ctx);
      } catch (e) {
        return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' });
      }
      const cfg = { host: String(prof.host||'localhost'), port: Number(prof.port||3306), user: String(prof.user||''), password: String(prof.password||''), database: String(prof.database||''), ssl: prof.ssl ? { rejectUnauthorized: false } : undefined };
      const qi = (ident) => '`' + String(ident||'').replace(/`/g, '``') + '`';
      let conn;
      try {
        conn = await mysql.createConnection(cfg);
        const result = {};
        const want = tablesReq.length ? tablesReq : ['product','product_shop','product_lang','stock_available'];
        for (const t of want) {
          const T = PREFIX + t;
          const [existsRows] = await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1', [cfg.database, T]);
          if (!Array.isArray(existsRows) || !existsRows.length) { result[t] = { exists:false, columns: [] }; continue; }
          const sql = `SELECT COLUMN_NAME as column_name, DATA_TYPE as data_type, COLUMN_DEFAULT as column_default, IS_NULLABLE as is_nullable, COLUMN_TYPE as column_type, EXTRA as extra
                        FROM information_schema.COLUMNS
                       WHERE TABLE_SCHEMA=? AND TABLE_NAME=?
                       ORDER BY ORDINAL_POSITION`;
          const [cols] = await conn.query(sql, [cfg.database, T]);
          result[t] = { exists: true, columns: Array.isArray(cols) ? cols : [] };
        }
        // Sort tables by name for predictable UI ordering
        const sortedNames = Object.keys(result).sort((a,b)=>a.localeCompare(b));
        const sortedSchema = {};
        for (const name of sortedNames) sortedSchema[name] = result[name];
        return res.json({ ok:true, schema: sortedSchema, order: sortedNames, prefix: PREFIX, profile: { id: prof.id, host: prof.host, database: prof.database } });
      } catch (e) {
        return res.status(500).json({ ok:false, error:'schema_failed', message: e?.message || String(e) });
      } finally { try { if (conn) await conn.end(); } catch {} }
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // List active languages from Presta ps_lang (prefix-aware)
  app.get('/api/grabbing-jerome/transfer/prestashop/langs', async (req, res) => {
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      const explicitProfileId = req.query?.profile_id != null ? Number(req.query.profile_id) : null;
      const domain = normDomain(req.query?.domain);
      let DEFAULT_PREFIX = 'ps_';
      if (domain) {
        try {
          const d = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
          const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
          const dp = ct.db_mysql_prefix || ct.db_prefix || (ct.mapping && ct.mapping.prefix) || null;
          if (dp && String(dp).trim()) DEFAULT_PREFIX = String(dp).trim();
        } catch {}
      }
      const PREFIX = String(req.query?.prefix || DEFAULT_PREFIX || 'ps_');
      let profileId = explicitProfileId;
      if (!profileId && domain) {
        try {
          const d = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
          const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
          if (ct && typeof ct === 'object' && ct.db_mysql_profile_id) profileId = Number(ct.db_mysql_profile_id) || null;
        } catch {}
      }
      if (!profileId) return res.status(400).json({ ok:false, error:'missing_profile', message:'Select a PrestaShop DB profile (db-mysql) first.' });

      // Load MySQL profile details
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];
      let mysql = null;
      try {
        const mod = await import('../../../db-mysql/backend/utils/mysql2.js');
        mysql = await mod.getMysql2(ctx);
      } catch (e) {
        return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' });
      }
      const cfg = { host: String(prof.host||'localhost'), port: Number(prof.port||3306), user: String(prof.user||''), password: String(prof.password||''), database: String(prof.database||''), ssl: prof.ssl ? { rejectUnauthorized: false } : undefined };
      const qi = (ident) => '`' + String(ident||'').replace(/`/g, '``') + '`';
      let conn;
      try {
        conn = await mysql.createConnection(cfg);
        const T_LANG = PREFIX + 'lang';
        const [existsRows] = await conn.query('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=? LIMIT 1', [cfg.database, T_LANG]);
        if (!Array.isArray(existsRows) || !existsRows.length) return res.status(404).json({ ok:false, error:'table_missing', table: T_LANG });
        // Attempt to fetch optional columns (iso_code, name) if present
        let cols = ['id_lang','active'];
        try {
          const [c] = await conn.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [cfg.database, T_LANG]);
          const names = new Set(Array.isArray(c) ? c.map(r=>String(r.COLUMN_NAME||'').toLowerCase()) : []);
          if (names.has('iso_code')) cols.push('iso_code');
          if (names.has('name')) cols.push('name');
        } catch {}
        const sql = `SELECT ${cols.map(c=>qi(c)).join(', ')} FROM ${qi(T_LANG)} WHERE ${qi('active')}=1 ORDER BY ${qi('id_lang')} ASC`;
        const [rows] = await conn.query(sql);
        const items = Array.isArray(rows) ? rows : [];
        const ids = items.map(r=>Number(r.id_lang)||0).filter(n=>n>0);
        return res.json({ ok:true, items, ids, profile: { id: prof.id, host: prof.host, database: prof.database }, table: T_LANG });
      } catch (e) {
        return res.status(500).json({ ok:false, error:'langs_failed', message: e?.message || String(e) });
      } finally { try { if (conn) await conn.end(); } catch {} }
    } catch (e) { return res.status(500).json({ ok:false, error:'server_error', message: e?.message || String(e) }); }
  });

  // Unified: Send to Presta (delegates to service -> module handler)
  try {
    app.post('/api/grabbing-jerome/transfer/prestashop', async (req, res) => {
      return sendToPresta(req, res, ctx, utils);
    });
  } catch {}
}
