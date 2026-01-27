// Legacy Send-to-Presta handler extracted from backend/index.js
// Kept verbatim to preserve behavior; wired via index.js to allow the
// service to delegate without Express stack scanning.

import path from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import { sanitizeFilename, resolveModuleRoot, downloadToFileWithHash } from '../utils/image.utils.js';
import { slugify, fmtDateTime } from '../utils/db.utils.js';

export async function legacySendToPresta(req, res, ctx = {}, utils = {}) {
  const pool = utils?.pool;
  const chatLog = typeof utils?.chatLog === 'function' ? utils.chatLog : (()=>{});
  const normDomain = typeof utils?.normDomain === 'function' ? utils.normDomain : (s => String(s||'').toLowerCase().replace(/^www\./,''));
  const ensureExtractionRunsTable = typeof utils?.ensureExtractionRunsTable === 'function' ? utils.ensureExtractionRunsTable : async ()=>{};
  const ensureSendErrorLogsTable = typeof utils?.ensureSendErrorLogsTable === 'function' ? utils.ensureSendErrorLogsTable : async ()=>{};
  const ensureImageMapTable = typeof utils?.ensureImageMapTable === 'function' ? utils.ensureImageMapTable : async ()=>{};
  const ensureUrlTables = typeof utils?.ensureUrlTables === 'function' ? utils.ensureUrlTables : async ()=>{};
    try {
      if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
      await ensureExtractionRunsTable();
      await ensureSendErrorLogsTable();
      const runId = Number(req.body?.run_id || req.body?.id || 0) || 0;
      const explicitProfileId = req.body?.profile_id != null ? Number(req.body.profile_id) : null;
      const doWrite = (req.body?.write === true) || String(req.body?.mode||'').toLowerCase() === 'upsert';
      const explicitMapping = (req.body && typeof req.body.mapping === 'object') ? req.body.mapping : null;
      if (!runId) return res.status(400).json({ ok:false, error:'bad_request', message:'run_id required' });
      // Load run
      const rr = await pool.query(`select id, domain, url, page_type, version, result from public.mod_grabbing_jerome_extraction_runs where id=$1`, [runId]);
      if (!rr.rowCount) return res.status(404).json({ ok:false, error:'not_found', message:'run not found' });
      const run = rr.rows[0];
      const domain = normDomain(run.domain);
      chatLog('transfer_start', { run_id: runId, domain, page_type: run.page_type, write: doWrite });
      // Determine profile id: prefer explicit, fallback to domain config_transfert
      let profileId = explicitProfileId;
      if (!profileId && domain) {
        try {
          const d = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
          const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
          if (ct && typeof ct === 'object' && ct.db_mysql_profile_id) profileId = Number(ct.db_mysql_profile_id) || null;
        } catch {}
      }
      if (!profileId) return res.status(400).json({ ok:false, error:'missing_profile', message:'Select a PrestaShop DB profile (db-mysql) first.' });

      // Load MySQL profile details from mod_db_mysql_profiles
      const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
      if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
      const prof = pr.rows[0];
      chatLog('profile_resolved', { profile_id: prof.id, host: prof.host, port: prof.port, database: prof.database });

      // Connect to MySQL and run simple checks (dry-run)
      let mysql = null;
      try {
        const mod = await import('../../../db-mysql/backend/utils/mysql2.js');
        mysql = await mod.getMysql2(ctx);
      } catch (e) {
        return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' });
      }
      const cfg = {
        host: String(prof.host||'localhost'),
        port: Number(prof.port||3306),
        user: String(prof.user||''),
        password: String(prof.password||''),
        database: String(prof.database||''),
        ssl: prof.ssl ? { rejectUnauthorized: false } : undefined,
      };
      let conn;
      try {
        conn = await mysql.createConnection(cfg);
        chatLog('mysql_connect_ok', { host: cfg.host, port: cfg.port, database: cfg.database });
        // Helpers
        const q = async (sql, args=[]) => { const [rows] = await conn.query(sql, args); return rows; };
        const qi = (ident) => '`' + String(ident||'').replace(/`/g, '``') + '`';
        const hasTable = async (name) => {
          try {
            const rows = await q('SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? LIMIT 1', [cfg.database, name]);
            return Array.isArray(rows) && rows.length > 0;
          } catch { return false; }
        };
        const hasColumn = async (table, col) => {
          try {
            const rows = await q('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1', [cfg.database, table, col]);
            return Array.isArray(rows) && rows.length > 0;
          } catch { return false; }
        };
        const slugify = (s) => String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'product';
        let lastOp = null;
        // Detect mapping
        const ctRes = await pool.query('select config_transfert from public.mod_grabbing_jerome_domains where domain=$1', [domain]);
        const ct = ctRes.rowCount ? (ctRes.rows[0]?.config_transfert || {}) : {};
        const type = String(run.page_type||'').toLowerCase() || 'product';
        const savedMap = (ct && ct.mappings && ct.mappings[type]) || ct?.mapping || null;
        const mapping = explicitMapping || savedMap || {};
        const PREFIX_DEFAULT = String(((ct && (ct.db_mysql_prefix || ct.db_prefix)) || 'ps_'));
        const PREFIX = String(mapping.prefix || PREFIX_DEFAULT || 'ps_');
        const ID_LANG = Number(mapping.id_lang || 1) || 1;
        const TABLES = (mapping && mapping.tables && typeof mapping.tables === 'object') ? mapping.tables : {};
        // Load per-table settings from mapping JSON (fallback) and DB table (overrides)
        let TSET_PRODUCT = (TABLES.product && typeof TABLES.product.settings === 'object') ? TABLES.product.settings : {};
        let TSET_SHOP = (TABLES.product_shop && typeof TABLES.product_shop.settings === 'object') ? TABLES.product_shop.settings : {};
        let TSET_LANG = (TABLES.product_lang && typeof TABLES.product_lang.settings === 'object') ? TABLES.product_lang.settings : {};
        let TSET_STOCK = (TABLES.stock_available && typeof TABLES.stock_available.settings === 'object') ? TABLES.stock_available.settings : {};
       // let TSET_STOCK = (TABLES.stock_available && typeof TABLES.stock_available.settings === 'object') ? TABLES.stock_available.settings : {};
        let TDEF_STOCK_TBL = (TABLES.stock_available && typeof TABLES.stock_available.defaults === 'object') ? TABLES.stock_available.defaults : {};
        let MDEF = {}; // defaults provided via table-settings.mapping
        let TSET_ANY = {}; // settings per table from DB (all tables)
        let MFIELDS = {}; // mapping.fields per table from DB (all tables)
        try {
          const rows = await pool.query(`SELECT table_name, settings, mapping, setting_image FROM public.mod_grabbing_jerome_table_settings WHERE domain=$1 AND lower(page_type)=lower($2)`, [domain, type]);
          const map = new Map((rows.rows||[]).map(r => [String(r.table_name||'').toLowerCase(), r.settings || {}]));
          if (map.has('product')) TSET_PRODUCT = { ...TSET_PRODUCT, ...(map.get('product')||{}) };
          if (map.has('product_shop')) TSET_SHOP = { ...TSET_SHOP, ...(map.get('product_shop')||{}) };
          if (map.has('product_lang')) TSET_LANG = { ...TSET_LANG, ...(map.get('product_lang')||{}) };
          for (const r of (rows.rows||[])) {
            const t = String(r.table_name||'').toLowerCase();
            if (r.mapping && typeof r.mapping==='object' && r.mapping.defaults && typeof r.mapping.defaults==='object') {
              MDEF[t] = r.mapping.defaults;
            }
            // capture settings + mapping.fields for all tables to support generic writer
            try {
              if (t === 'image' && r.setting_image && typeof r.setting_image==='object') {
                TSET_ANY[t] = r.setting_image;
              } else if (r.settings && typeof r.settings==='object') {
                TSET_ANY[t] = r.settings;
              }
            } catch {}
            try { if (r.mapping && typeof r.mapping==='object' && r.mapping.fields && typeof r.mapping.fields==='object') MFIELDS[t] = r.mapping.fields; } catch {}
          }
        } catch {}
        const baseShop = Number(mapping.id_shop || TSET_PRODUCT.id_shop_default || 1) || 1;
        const SHOPS = (Array.isArray(mapping.id_shops) && mapping.id_shops.length
          ? mapping.id_shops.map((n)=>Number(n)||0).filter(n=>n>0)
          : (Array.isArray(TSET_SHOP.id_shops) && TSET_SHOP.id_shops.length
            ? TSET_SHOP.id_shops.map((n)=>Number(n)||0).filter(n=>n>0)
            : [baseShop]));
        const ID_SHOP_DEFAULT = (mapping.id_shop_default != null) ? (Number(mapping.id_shop_default)||SHOPS[0]) : ((TSET_PRODUCT.id_shop_default != null) ? Number(TSET_PRODUCT.id_shop_default)||SHOPS[0] : SHOPS[0]);
        const ID_SHOP_GROUP = (mapping.id_shop_group != null) ? Number(mapping.id_shop_group)||0 : 0;
        const MATCH_BY = Array.isArray(mapping.match_by) ? mapping.match_by.map(s=>String(s).toLowerCase()) : ['reference','sku'];
        const FIELDS = (mapping && mapping.fields && typeof mapping.fields === 'object') ? mapping.fields : {};
        const F_PRODUCT = (TABLES.product && typeof TABLES.product.fields === 'object') ? TABLES.product.fields : null;
        const F_SHOP = (TABLES.product_shop && typeof TABLES.product_shop.fields === 'object') ? TABLES.product_shop.fields : null;
        const F_LANG = (TABLES.product_lang && typeof TABLES.product_lang.fields === 'object') ? TABLES.product_lang.fields : null;
        const F_STOCK = (TABLES.stock_available && typeof TABLES.stock_available.fields === 'object') ? TABLES.stock_available.fields : null;
        // Helpers used by defaults below
        const firstDef = (...arr) => { for (const v of arr) { if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
        const norm01 = (v, fallback=0) => {
          if (v === undefined || v === null || v === '') return Number(fallback) ? 1 : 0;
          if (typeof v === 'boolean') return v ? 1 : 0;
          const s = String(v).trim().toLowerCase();
          if (s === 'true') return 1; if (s === 'false') return 0;
          const n = Number(s);
          return Number.isFinite(n) ? (n ? 1 : 0) : (s ? 1 : 0);
        };
        const DEFAULTS = (mapping && mapping.defaults && typeof mapping.defaults === 'object') ? mapping.defaults : {};
        const DEF_PROD = (DEFAULTS.product && typeof DEFAULTS.product === 'object') ? DEFAULTS.product : {};
        const DEF_SHOP = (DEFAULTS.product_shop && typeof DEFAULTS.product_shop === 'object') ? DEFAULTS.product_shop : {};
        const DEF_LANG = (DEFAULTS.product_lang && typeof DEFAULTS.product_lang === 'object') ? DEFAULTS.product_lang : {};
        const DEF_ATTR = (DEFAULTS.product_attribute && typeof DEFAULTS.product_attribute === 'object') ? DEFAULTS.product_attribute : {};
        const DEF_ATTR_SHOP = (DEFAULTS.product_attribute_shop && typeof DEFAULTS.product_attribute_shop === 'object') ? DEFAULTS.product_attribute_shop : {};
        const DEF_STOCK = (DEFAULTS.stock && typeof DEFAULTS.stock === 'object') ? DEFAULTS.stock : {};
        const DEF_STOCK_MERGED = { ...(DEF_STOCK||{}), ...(TDEF_STOCK_TBL||{}), ...(MDEF['stock_available']||{}) };
        if (DEF_STOCK_MERGED.quantity == null && DEF_PROD.quantity != null) {
          const qd = Number(DEF_PROD.quantity);
          if (Number.isFinite(qd)) DEF_STOCK_MERGED.quantity = qd;
        }
        // Precedence: mapping override → per-table settings → per-table defaults → mapping.defaults
        const productTaxRulesGroup = Number((mapping.id_tax_rules_group ?? TSET_PRODUCT.id_tax_rules_group ?? DEF_PROD.id_tax_rules_group ?? DEF_SHOP.id_tax_rules_group ?? 0)) || 0;
        const shopTaxRulesGroup = Number((mapping.id_tax_rules_group ?? TSET_SHOP.id_tax_rules_group ?? TSET_PRODUCT.id_tax_rules_group ?? DEF_SHOP.id_tax_rules_group ?? DEF_PROD.id_tax_rules_group ?? 0)) || 0;
        const supplierId = (mapping.id_supplier ?? TSET_PRODUCT.id_supplier ?? DEF_PROD.id_supplier) != null ? (Number(mapping.id_supplier ?? TSET_PRODUCT.id_supplier ?? DEF_PROD.id_supplier) || null) : null;
        const manufacturerId = (mapping.id_manufacturer ?? TSET_PRODUCT.id_manufacturer ?? DEF_PROD.id_manufacturer) != null ? (Number(mapping.id_manufacturer ?? TSET_PRODUCT.id_manufacturer ?? DEF_PROD.id_manufacturer) || null) : null;
        const visibilityDef = String(DEF_SHOP.visibility || DEF_PROD.visibility || 'both');
        const conditionDef = String(DEF_SHOP.condition || DEF_PROD.condition || 'new');
        const availableForOrderDef = norm01(firstDef(DEF_SHOP.available_for_order, DEF_PROD.available_for_order, 1));
        const showPriceDef = norm01(firstDef(DEF_SHOP.show_price, DEF_PROD.show_price, 1));
        const indexedDef = norm01(firstDef(DEF_SHOP.indexed, DEF_PROD.indexed, 0));

        // Fetch run result and map fields
        const result = run.result && typeof run.result === 'object' ? run.result : (run.result ? JSON.parse(run.result) : {});
        const src = result.product || result.item || result;
        const pickPath = (obj, pathStr) => {
          try {
            if (!pathStr) return undefined;
            const parts = String(pathStr).replace(/^\$\.?/, '').split('.');
            let cur = obj;
            for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
            return cur;
          } catch { return undefined; }
        };
        // Flexible picker: supports relative (to product) and absolute/root paths
        const pickFlex = (pathStr) => {
          if (!pathStr) return undefined;
          const s = String(pathStr).trim();
          if (s.startsWith('$.')) return pickPath(result, s.slice(2));
          if (s.startsWith('product.')) return pickPath(src, s.slice('product.'.length));
          if (s.startsWith('item.')) return pickPath(src, s.slice('item.'.length));
          if (s.startsWith('meta.')) return pickPath(result, s); // meta lives at root
          // try relative to product first, then root as fallback
          let v = pickPath(src, s);
          if (v === undefined || v === null || v === '') v = pickPath(result, s);
          return v;
        };
        const resolveSpec = (_obj, spec) => {
          if (!spec) return undefined;
          if (Array.isArray(spec)) { for (const s of spec) { const v = resolveSpec(null, s); if (v !== undefined && v !== null && v !== '') return v; } return undefined; }
          if (typeof spec === 'string') return pickFlex(spec);
          return spec; // literal
        };
        const toNumber = (v) => { const n = Number(String(v||'').replace(/,/g,'.').replace(/[^0-9.\-]/g,'')); return Number.isFinite(n)? n: 0; };
        const toInt = (v) => { const n = parseInt(String(v||'').replace(/[^0-9\-]/g,''),10); return Number.isFinite(n)? n: 0; };
        const val = {
          name: firstDef(
            F_LANG ? resolveSpec(src, F_LANG.name) : undefined,
            F_PRODUCT ? resolveSpec(src, F_PRODUCT.name) : undefined,
            resolveSpec(src, FIELDS.name), resolveSpec(src, ['title','name']), 'Imported Product'
          ),
          description: firstDef(
            F_LANG ? resolveSpec(src, F_LANG.description) : undefined,
            F_PRODUCT ? resolveSpec(src, F_PRODUCT.description) : undefined,
            resolveSpec(src, FIELDS.description), resolveSpec(src, ['description','content']), ''
          ),
          reference: String(firstDef(
            F_PRODUCT ? resolveSpec(src, F_PRODUCT.reference) : undefined,
            resolveSpec(src, FIELDS.reference), resolveSpec(src, ['sku','reference']), ''
          ) || ''),
          price: toNumber(firstDef(
            F_PRODUCT ? resolveSpec(src, F_PRODUCT.price) : undefined,
            resolveSpec(src, FIELDS.price), resolveSpec(src, ['price','price_without_tax','price_with_tax']), 0
          )),
          quantity: toInt(firstDef(
            F_STOCK ? resolveSpec(src, F_STOCK.quantity) : undefined,
            resolveSpec(src, FIELDS.quantity), resolveSpec(src, ['quantity','stock.quantity','qty']), 0
          )),
          ean13: firstDef(
            F_PRODUCT ? resolveSpec(src, F_PRODUCT.ean13) : undefined,
            resolveSpec(src, FIELDS.ean13), resolveSpec(src, ['ean13','ean']), null
          ),
          isbn: firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.isbn) : undefined, null),
          upc: firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.upc) : undefined, null),
          mpn: firstDef(
            F_PRODUCT ? resolveSpec(src, F_PRODUCT.mpn) : undefined,
            resolveSpec(src, FIELDS.mpn), resolveSpec(src, ['mpn']), null
          ),
          supplier_reference: (function(){
            // Prefer explicit mapping (product.supplier_reference or fields.supplier_reference)
            let v = firstDef(
              F_PRODUCT ? resolveSpec(src, F_PRODUCT.supplier_reference) : undefined,
              resolveSpec(src, FIELDS.supplier_reference),
              undefined
            );
            if (v != null && v !== '') return cleanSupplierRef(v);
            // Fallback: scan attributes array for a 'Référence' label value (domain source often stores it there)
            try {
              const arr = (src && Array.isArray(src.attributes)) ? src.attributes : (result && Array.isArray(result.attributes) ? result.attributes : []);
              for (const it of arr) {
                const nm = (it && it.name) ? String(it.name).toLowerCase() : '';
                const val = (it && it.value) ? String(it.value) : '';
                if (nm.includes('référence') || nm.includes('reference')) {
                  const token = cleanSupplierRef(val);
                  if (token) return token;
                }
              }
            } catch {}
            return '';
          })(),
          wholesale_price: toNumber(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.wholesale_price) : undefined, null)),
          weight: toNumber(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.weight) : undefined, null)),
          width: toNumber(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.width) : undefined, null)),
          height: toNumber(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.height) : undefined, null)),
          depth: toNumber(firstDef(F_PRODUCT ? resolveSpec(src, F_PRODUCT.depth) : undefined, null)),
        };

        // Detect tables
        const T_PRODUCT = PREFIX + 'product';
        const T_PRODUCT_LANG = PREFIX + 'product_lang';
        const T_PRODUCT_SHOP = PREFIX + 'product_shop';
        const T_STOCK = PREFIX + 'stock_available';
        const hasProduct = await hasTable(T_PRODUCT);
        const hasPsProduct = hasProduct; // same meaning here
        const hasProductShop = await hasTable(T_PRODUCT_SHOP);
        const hasProductLang = await hasTable(T_PRODUCT_LANG);
        const productLangHasShop = hasProductLang ? await hasColumn(T_PRODUCT_LANG, 'id_shop') : false;
        // Cache VARCHAR max lengths to pre-truncate meta fields safely
        const __colMaxLen = new Map();
        const getColMaxLen = async (table, column) => {
          const key = `${table}|${column}`;
          if (__colMaxLen.has(key)) return __colMaxLen.get(key);
          try {
            const rows = await q('SELECT CHARACTER_MAXIMUM_LENGTH as max_len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1', [cfg.database, table, column]);
            const len = (Array.isArray(rows) && rows.length) ? Number(rows[0].max_len||0) : 0;
            __colMaxLen.set(key, len || 0);
            return len || 0;
          } catch { __colMaxLen.set(key, 0); return 0; }
        };

        if (!doWrite) {
          chatLog('dry_run_preview', { run_id: run.id, preview: { name: val.name, reference: val.reference, price: val.price, quantity: val.quantity }, checks: { has_product_table: hasProduct, has_ps_product_table: hasPsProduct } });
          return res.json({ ok:true, mode:'dry_run', run: { id: run.id, url: run.url, page_type: run.page_type, version: run.version }, profile: { id: prof.id, name: prof.name }, checks: { connected: true, has_product_table: hasProduct, has_ps_product_table: hasPsProduct }, preview: { ...val } });
        }

        // UPSERT -----------------------------------------------------------
        // Honor explicit product_id from request to force update path
        const FORCED_PRODUCT_ID = req.body?.product_id != null ? (Number(req.body.product_id)||0) : 0;
        // 1) Try to find existing product by reference or name
        let productId = 0;
        if (FORCED_PRODUCT_ID > 0) {
          try {
            const rows = await q(`SELECT ${'`id_product`'} FROM ${'`'}${T_PRODUCT}${'`'} WHERE ${'`id_product`'}=? LIMIT 1`, [FORCED_PRODUCT_ID]);
            if (rows && rows.length) { productId = FORCED_PRODUCT_ID; chatLog('forced_product_id', { run_id: run.id, product_id: productId }); }
            else { chatLog('forced_product_id_missing', { run_id: run.id, product_id: FORCED_PRODUCT_ID }); }
          } catch { chatLog('forced_product_id_check_error', { run_id: run.id, product_id: FORCED_PRODUCT_ID }); }
        }
        // If not forced or missing, fallback to reference/name matching
        if (val.reference && (MATCH_BY.includes('reference') || MATCH_BY.includes('sku'))) {
          const rows = await q(`SELECT ${'`id_product`'} FROM ${'`'}${T_PRODUCT}${'`'} WHERE ${'`reference`'} = ? LIMIT 1`, [String(val.reference)]);
          if (rows && rows.length) productId = Number(rows[0].id_product || 0) || 0;
        }
        if (!productId && val.name && MATCH_BY.includes('name') && hasProductLang) {
          if (productLangHasShop) {
            const rows = await q(`SELECT p.${'`id_product`'} FROM ${'`'}${T_PRODUCT}${'`'} p JOIN ${'`'}${T_PRODUCT_LANG}${'`'} pl ON pl.${'`id_product`'}=p.${'`id_product`'} WHERE pl.${'`id_lang`'}=? AND pl.${'`id_shop`'}=? AND pl.${'`name`'}=? LIMIT 1`, [ID_LANG, ID_SHOP, String(val.name)]);
            if (rows && rows.length) productId = Number(rows[0].id_product || 0) || 0;
          } else {
            const rows = await q(`SELECT p.${'`id_product`'} FROM ${'`'}${T_PRODUCT}${'`'} p JOIN ${'`'}${T_PRODUCT_LANG}${'`'} pl ON pl.${'`id_product`'}=p.${'`id_product`'} WHERE pl.${'`id_lang`'}=? AND pl.${'`name`'}=? LIMIT 1`, [ID_LANG, String(val.name)]);
            if (rows && rows.length) productId = Number(rows[0].id_product || 0) || 0;
          }
        }

        const now = new Date();
        const nowFmt = fmtDateTime(now);
        let created = false; let updated = false;
        if (!productId) {
          if (FORCED_PRODUCT_ID > 0) {
            chatLog('forced_product_id_insert_block', { run_id: run.id, forced: FORCED_PRODUCT_ID });
            return res.status(404).json({ ok:false, error:'forced_product_not_found', message:'Requested product_id not found; update aborted (no insert performed).', product_id: FORCED_PRODUCT_ID });
          }
          chatLog('upsert_insert_product', { run_id: run.id, name: val.name, reference: val.reference, price: val.price, quantity: val.quantity });
          // Insert product row with guarded presence of columns
          const cols = [];
          const args = [];
          const rowKV = {};
          const push = (col, val) => { cols.push(col); args.push(val); rowKV[col] = val; };
          // Optional columns by detection
          if (await hasColumn(T_PRODUCT, 'id_category_default')) {
            // Prefer per-table settings/defaults from UI; fall back to mapping override
            const catId = (TSET_PRODUCT.id_category_default != null)
              ? Number(TSET_PRODUCT.id_category_default)
              : (MDEF['product'] && MDEF['product'].id_category_default != null)
                ? Number(MDEF['product'].id_category_default)
                : (mapping.id_category_default != null)
                  ? Number(mapping.id_category_default)
                  : (DEF_PROD.id_category_default != null)
                    ? Number(DEF_PROD.id_category_default)
                    : null;
            if (catId) push('id_category_default', catId);
          }
          if (await hasColumn(T_PRODUCT, 'id_tax_rules_group')) push('id_tax_rules_group', productTaxRulesGroup);
          if (await hasColumn(T_PRODUCT, 'id_supplier') && (supplierId !== null)) push('id_supplier', supplierId);
          if (await hasColumn(T_PRODUCT, 'id_manufacturer') && (manufacturerId !== null)) push('id_manufacturer', manufacturerId);
          if (await hasColumn(T_PRODUCT, 'id_shop_default')) push('id_shop_default', ID_SHOP_DEFAULT);
          const pVisibility = (TSET_PRODUCT.visibility != null) ? String(TSET_PRODUCT.visibility) : visibilityDef;
          const pCondition = (TSET_PRODUCT.condition != null) ? String(TSET_PRODUCT.condition) : conditionDef;
          const pAvail = (TSET_PRODUCT.available_for_order != null) ? norm01(TSET_PRODUCT.available_for_order) : availableForOrderDef;
          const pShowPrice = (TSET_PRODUCT.show_price != null) ? norm01(TSET_PRODUCT.show_price) : showPriceDef;
          const pIndexed = (TSET_PRODUCT.indexed != null) ? norm01(TSET_PRODUCT.indexed) : indexedDef;
          const pActive = (TSET_PRODUCT.active != null) ? norm01(TSET_PRODUCT.active, 1) : 1;
          const pRedirectType = (TSET_PRODUCT.redirect_type != null) ? String(TSET_PRODUCT.redirect_type) : (String(DEF_PROD.redirect_type || 'default'));
          const pIdTypeRedirected = Number((TSET_PRODUCT.id_type_redirected ?? DEF_PROD.id_type_redirected ?? 0)) || 0;
          const pProductType = (TSET_PRODUCT.product_type != null) ? String(TSET_PRODUCT.product_type) : String(DEF_PROD.product_type || '');
          if (await hasColumn(T_PRODUCT, 'visibility')) push('visibility', pVisibility);
          if (await hasColumn(T_PRODUCT, 'condition')) push('condition', pCondition);
          if (await hasColumn(T_PRODUCT, 'available_for_order')) push('available_for_order', pAvail);
          if (await hasColumn(T_PRODUCT, 'show_price')) push('show_price', pShowPrice);
          if (await hasColumn(T_PRODUCT, 'indexed')) push('indexed', pIndexed);
          if (await hasColumn(T_PRODUCT, 'active')) push('active', pActive);
          if (await hasColumn(T_PRODUCT, 'redirect_type')) push('redirect_type', pRedirectType);
          if (await hasColumn(T_PRODUCT, 'id_type_redirected')) push('id_type_redirected', pIdTypeRedirected);
          if (await hasColumn(T_PRODUCT, 'product_type')) push('product_type', pProductType);
          // Common fields
          if (await hasColumn(T_PRODUCT, 'price')) push('price', Number(val.price||0));
          if (await hasColumn(T_PRODUCT, 'reference')) push('reference', String(val.reference||''));
          if (await hasColumn(T_PRODUCT, 'supplier_reference')) push('supplier_reference', String(val.supplier_reference||''));
          if (await hasColumn(T_PRODUCT, 'ean13')) push('ean13', String(val.ean13 || ''));
          if (await hasColumn(T_PRODUCT, 'isbn')) push('isbn', String(val.isbn || ''));
          if (await hasColumn(T_PRODUCT, 'upc')) push('upc', String(val.upc || ''));
          if (await hasColumn(T_PRODUCT, 'mpn')) push('mpn', String(val.mpn || ''));
          if (await hasColumn(T_PRODUCT, 'wholesale_price') && Number.isFinite(val.wholesale_price)) push('wholesale_price', Number(val.wholesale_price||0));
          if (await hasColumn(T_PRODUCT, 'weight') && Number.isFinite(val.weight)) push('weight', Number(val.weight||0));
          if (await hasColumn(T_PRODUCT, 'width') && Number.isFinite(val.width)) push('width', Number(val.width||0));
          if (await hasColumn(T_PRODUCT, 'height') && Number.isFinite(val.height)) push('height', Number(val.height||0));
          if (await hasColumn(T_PRODUCT, 'depth') && Number.isFinite(val.depth)) push('depth', Number(val.depth||0));
          if (await hasColumn(T_PRODUCT, 'date_add')) push('date_add', nowFmt);
          if (await hasColumn(T_PRODUCT, 'date_upd')) push('date_upd', nowFmt);
          const sql = `INSERT INTO ${'`'}${T_PRODUCT}${'`'} (${cols.map(c=>('`'+c+'`')).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`;
          try { lastOp = { type: 'insert', table: T_PRODUCT, row: rowKV }; chatLog('sql_insert', { table: T_PRODUCT, run_id: run.id, defaults: DEF_PROD, row: rowKV }); } catch {}
          try {
            await q(sql, args);
            const idRow = await q('SELECT LAST_INSERT_ID() AS id');
            productId = Number((idRow && idRow[0] && idRow[0].id) || 0) || 0;
            created = productId > 0;
            // Ensure category linkage immediately after product insert using product-level UI setting
            try {
              // Prefer product table settings/defaults; mapping only as fallback
              let catIns = null;
              try {
                if (rowKV && rowKV.id_category_default != null) catIns = Number(rowKV.id_category_default) || null;
              } catch {}
              if (catIns == null) {
                catIns = (TSET_PRODUCT.id_category_default != null)
                  ? Number(TSET_PRODUCT.id_category_default)
                  : (MDEF['product'] && MDEF['product'].id_category_default != null)
                    ? Number(MDEF['product'].id_category_default)
                    : (DEF_PROD.id_category_default != null)
                      ? Number(DEF_PROD.id_category_default)
                      : (mapping.id_category_default != null)
                        ? Number(mapping.id_category_default)
                        : null;
              }
              if (catIns != null) {
                const T_CAT_PROD = PREFIX + 'category_product';
                const T_CAT_PROD_SHOP = PREFIX + 'category_product_shop';
                if (await hasTable(T_CAT_PROD)) {
                  const ex = await q(`SELECT 1 FROM ${qi(T_CAT_PROD)} WHERE ${qi('id_category')}=? AND ${qi('id_product')}=? LIMIT 1`, [catIns, productId]);
                  if (!Array.isArray(ex) || ex.length === 0) {
                    let pos = 0;
                    try {
                      const rp = await q(`SELECT COALESCE(MAX(${qi('position')}),-1)+1 AS p FROM ${qi(T_CAT_PROD)} WHERE ${qi('id_category')}=?`, [catIns]);
                      pos = (Array.isArray(rp) && rp.length) ? (Number(rp[0]?.p || 0) || 0) : 0;
                    } catch {}
                    await q(`INSERT INTO ${qi(T_CAT_PROD)} (${qi('id_category')},${qi('id_product')},${qi('position')}) VALUES (?,?,?)`, [catIns, productId, pos]);
                    try { chatLog('category_product_link_on_insert', { product_id: productId, id_category: catIns, position: pos }); } catch {}
                  }
                }
                if (await hasTable(T_CAT_PROD_SHOP) && Array.isArray(SHOPS) && SHOPS.length) {
                  for (const SID of SHOPS) {
                    try {
                      const exs = await q(`SELECT 1 FROM ${qi(T_CAT_PROD_SHOP)} WHERE ${qi('id_category')}=? AND ${qi('id_product')}=? AND ${qi('id_shop')}=? LIMIT 1`, [catIns, productId, SID]);
                      if (!Array.isArray(exs) || exs.length === 0) {
                        await q(`INSERT INTO ${qi(T_CAT_PROD_SHOP)} (${qi('id_category')},${qi('id_product')},${qi('id_shop')}) VALUES (?,?,?)`, [catIns, productId, SID]);
                        try { chatLog('category_product_shop_link_on_insert', { product_id: productId, id_category: catIns, id_shop: SID }); } catch {}
                      }
                    } catch {}
                  }
                }
              }
            } catch {}
          } catch (e) {
            try { await pool.query(`insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [run.id, domain, run.page_type, T_PRODUCT, 'insert', null, String(e?.message||e), JSON.stringify(rowKV)]); } catch {}
            chatLog('transfer_error', { run_id: run.id, error: String(e?.message || e), last_op: { type:'insert', table:T_PRODUCT, row: rowKV } });
          }
          // product_shop
          try { chatLog('shops_resolved', { run_id: run.id, table: T_PRODUCT_SHOP, shops: SHOPS }); } catch {}
          if (hasProductShop && productId) {
            for (const SID of SHOPS) {
              const colsS = ['id_product','id_shop'];
              const argsS = [productId, SID];
              const upd = [];
              const rowS = { id_product: productId, id_shop: SID };
              const addCol = (name, value, update=true) => { colsS.push(name); argsS.push(value); rowS[name] = value; if (update) upd.push('`'+name+'`=VALUES(`'+name+'`)'); };
              if (await hasColumn(T_PRODUCT_SHOP, 'id_category_default')) {
                const catIdS = (TSET_SHOP.id_category_default != null)
                  ? Number(TSET_SHOP.id_category_default)
                  : ((mapping.id_category_default != null) ? Number(mapping.id_category_default) : null);
                if (catIdS) addCol('id_category_default', catIdS);
              }
              if (await hasColumn(T_PRODUCT_SHOP, 'id_tax_rules_group')) addCol('id_tax_rules_group', shopTaxRulesGroup);
              if (await hasColumn(T_PRODUCT_SHOP, 'price')) addCol('price', Number(val.price||0));
              const sVisibility = (TSET_SHOP.visibility != null) ? String(TSET_SHOP.visibility) : visibilityDef;
              const sCondition = (TSET_SHOP.condition != null) ? String(TSET_SHOP.condition) : conditionDef;
              const sAvail = (TSET_SHOP.available_for_order != null) ? norm01(TSET_SHOP.available_for_order) : availableForOrderDef;
              const sShowPrice = (TSET_SHOP.show_price != null) ? norm01(TSET_SHOP.show_price) : showPriceDef;
              const sIndexed = (TSET_SHOP.indexed != null) ? norm01(TSET_SHOP.indexed) : indexedDef;
              const sActive = (TSET_SHOP.active != null) ? norm01(TSET_SHOP.active, 1) : 1;
              if (await hasColumn(T_PRODUCT_SHOP, 'active')) addCol('active', sActive);
              if (await hasColumn(T_PRODUCT_SHOP, 'visibility')) addCol('visibility', sVisibility);
              if (await hasColumn(T_PRODUCT_SHOP, 'condition')) addCol('condition', sCondition);
              if (await hasColumn(T_PRODUCT_SHOP, 'available_for_order')) addCol('available_for_order', sAvail);
              if (await hasColumn(T_PRODUCT_SHOP, 'show_price')) addCol('show_price', sShowPrice);
              if (await hasColumn(T_PRODUCT_SHOP, 'indexed')) addCol('indexed', sIndexed);
              if (await hasColumn(T_PRODUCT_SHOP, 'date_add')) addCol('date_add', nowFmt, false);
              if (await hasColumn(T_PRODUCT_SHOP, 'date_upd')) addCol('date_upd', nowFmt);
              const sqlS = `INSERT INTO ${'`'}${T_PRODUCT_SHOP}${'`'} (${colsS.map(c=>('`'+c+'`')).join(',')}) VALUES (${colsS.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${upd.join(', ')}`;
              try { chatLog('sql_begin', { table: T_PRODUCT_SHOP, run_id: run.id, shop: SID, label: `${T_PRODUCT_SHOP} / Start` }); } catch {}
              try { lastOp = { type: 'upsert', table: T_PRODUCT_SHOP, row: rowS }; chatLog('sql_upsert', { table: T_PRODUCT_SHOP, run_id: run.id, shop: SID, defaults: DEF_SHOP, row: rowS }); } catch {}
              try { await q(sqlS, argsS); try { chatLog('sql_end', { table: T_PRODUCT_SHOP, run_id: run.id, shop: SID, status: 'success', label: `${T_PRODUCT_SHOP} / Success` }); } catch {} } catch (e) {
                try { chatLog('sql_end', { table: T_PRODUCT_SHOP, run_id: run.id, shop: SID, status: 'failure', label: `${T_PRODUCT_SHOP} / Failure`, error: String(e?.message||e) }); } catch {}
                try { await pool.query(`insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [run.id, domain, run.page_type, T_PRODUCT_SHOP, 'upsert', productId, SID, String(e?.message||e), JSON.stringify(rowS)]); } catch {}
                chatLog('transfer_error', { run_id: run.id, error: String(e?.message || e), last_op: { type:'upsert', table:T_PRODUCT_SHOP, shop:SID, row: rowS } });
              }
              // Safety net: ensure id_category_default is set via explicit UPDATE when present
              // Precedence MUST be UI-first (table settings) → mapping.defaults → mapping top-level
              try {
                if (await hasColumn(T_PRODUCT_SHOP, 'id_category_default')) {
                  const catFix = (TSET_SHOP.id_category_default != null)
                    ? Number(TSET_SHOP.id_category_default)
                    : (MDEF['product_shop'] && MDEF['product_shop'].id_category_default != null)
                      ? Number(MDEF['product_shop'].id_category_default)
                      : (DEF_SHOP.id_category_default != null)
                        ? Number(DEF_SHOP.id_category_default)
                        : (DEF_PROD.id_category_default != null)
                          ? Number(DEF_PROD.id_category_default)
                          : (mapping.id_category_default != null)
                            ? Number(mapping.id_category_default)
                            : null;
                  if (catFix != null) {
                    await q(`UPDATE ${'`'}${T_PRODUCT_SHOP}${'`'} SET ${'`id_category_default`'}=? WHERE ${'`id_product`'}=? AND ${'`id_shop`'}=?`, [catFix, productId, SID]);
                    try { chatLog('shop_category_update_forced', { product_id: productId, shop: SID, id_category_default: catFix, precedence: 'ui-first' }); } catch {}
                  } else {
                    try { chatLog('shop_category_update_skipped', { product_id: productId, shop: SID, reason: 'no_resolved_category' }); } catch {}
                  }
                } else {
                  try { chatLog('shop_category_update_skipped', { product_id: productId, shop: SID, reason: 'column_missing' }); } catch {}
                }
              } catch (e) { try { chatLog('shop_category_update_error', { product_id: productId, shop: SID, error: String(e?.message||e) }); } catch {} }
            }
          }
        } else {
          // Update product core fields
          chatLog('upsert_update_product', { run_id: run.id, product_id: productId, reference: val.reference, price: val.price, quantity: val.quantity });
          const sets = [];
          const argsU = [];
          const setKV = {};
          const addSet = (col, v) => { sets.push('`'+col+'`=?'); argsU.push(v); setKV[col] = v; };
          if (await hasColumn(T_PRODUCT, 'price')) addSet('price', Number(val.price||0));
          if (await hasColumn(T_PRODUCT, 'reference')) addSet('reference', String(val.reference||''));
          if (await hasColumn(T_PRODUCT, 'supplier_reference')) addSet('supplier_reference', String(val.supplier_reference||''));
          if (await hasColumn(T_PRODUCT, 'active')) addSet('active', (TSET_PRODUCT.active != null) ? (TSET_PRODUCT.active ? 1 : 0) : 1);
          if (await hasColumn(T_PRODUCT, 'id_tax_rules_group')) addSet('id_tax_rules_group', productTaxRulesGroup);
          if (await hasColumn(T_PRODUCT, 'id_supplier') && (supplierId !== null)) addSet('id_supplier', supplierId);
          if (await hasColumn(T_PRODUCT, 'id_manufacturer') && (manufacturerId !== null)) addSet('id_manufacturer', manufacturerId);
          if (await hasColumn(T_PRODUCT, 'redirect_type')) addSet('redirect_type', (TSET_PRODUCT.redirect_type != null) ? String(TSET_PRODUCT.redirect_type) : (String(DEF_PROD.redirect_type || 'default')));
          if (await hasColumn(T_PRODUCT, 'id_type_redirected')) addSet('id_type_redirected', Number((TSET_PRODUCT.id_type_redirected ?? DEF_PROD.id_type_redirected ?? 0)) || 0);
          if (await hasColumn(T_PRODUCT, 'product_type')) addSet('product_type', (TSET_PRODUCT.product_type != null) ? String(TSET_PRODUCT.product_type) : String(DEF_PROD.product_type || ''));
          if (await hasColumn(T_PRODUCT, 'id_category_default')) {
            // Prefer UI per-table values; mapping overrides only when table defaults not set
            const catUpd = (TSET_PRODUCT.id_category_default != null)
              ? Number(TSET_PRODUCT.id_category_default)
              : ((MDEF['product'] && MDEF['product'].id_category_default != null)
                ? Number(MDEF['product'].id_category_default)
                : (mapping.id_category_default != null)
                  ? Number(mapping.id_category_default)
                  : (DEF_PROD.id_category_default != null)
                    ? Number(DEF_PROD.id_category_default)
                    : null);
            if (catUpd != null) addSet('id_category_default', catUpd);
          }
          if (await hasColumn(T_PRODUCT, 'id_shop_default')) addSet('id_shop_default', ID_SHOP_DEFAULT);
          if (await hasColumn(T_PRODUCT, 'ean13')) addSet('ean13', String(val.ean13 || ''));
          if (await hasColumn(T_PRODUCT, 'isbn')) addSet('isbn', String(val.isbn || ''));
          if (await hasColumn(T_PRODUCT, 'upc')) addSet('upc', String(val.upc || ''));
          if (await hasColumn(T_PRODUCT, 'mpn')) addSet('mpn', String(val.mpn || ''));
          if (await hasColumn(T_PRODUCT, 'wholesale_price') && Number.isFinite(val.wholesale_price)) addSet('wholesale_price', Number(val.wholesale_price||0));
          if (await hasColumn(T_PRODUCT, 'weight') && Number.isFinite(val.weight)) addSet('weight', Number(val.weight||0));
          if (await hasColumn(T_PRODUCT, 'width') && Number.isFinite(val.width)) addSet('width', Number(val.width||0));
          if (await hasColumn(T_PRODUCT, 'height') && Number.isFinite(val.height)) addSet('height', Number(val.height||0));
          if (await hasColumn(T_PRODUCT, 'depth') && Number.isFinite(val.depth)) addSet('depth', Number(val.depth||0));
          if (await hasColumn(T_PRODUCT, 'visibility')) addSet('visibility', (TSET_PRODUCT.visibility != null) ? String(TSET_PRODUCT.visibility) : visibilityDef);
          if (await hasColumn(T_PRODUCT, 'condition')) addSet('condition', (TSET_PRODUCT.condition != null) ? String(TSET_PRODUCT.condition) : conditionDef);
          if (await hasColumn(T_PRODUCT, 'available_for_order')) addSet('available_for_order', (TSET_PRODUCT.available_for_order != null) ? (TSET_PRODUCT.available_for_order ? 1 : 0) : availableForOrderDef);
          if (await hasColumn(T_PRODUCT, 'show_price')) addSet('show_price', (TSET_PRODUCT.show_price != null) ? (TSET_PRODUCT.show_price ? 1 : 0) : showPriceDef);
          if (await hasColumn(T_PRODUCT, 'indexed')) addSet('indexed', (TSET_PRODUCT.indexed != null) ? (TSET_PRODUCT.indexed ? 1 : 0) : indexedDef);
          if (await hasColumn(T_PRODUCT, 'date_upd')) addSet('date_upd', nowFmt);
          const sqlU = `UPDATE ${'`'}${T_PRODUCT}${'`'} SET ${sets.join(', ')} WHERE ${'`id_product`'}=?`;
          try { chatLog('sql_begin', { table: T_PRODUCT, run_id: run.id, label: `${T_PRODUCT} / Update Start` }); } catch {}
          try { lastOp = { type: 'update', table: T_PRODUCT, id_product: productId, set: setKV }; chatLog('sql_update', { table: T_PRODUCT, run_id: run.id, id_product: productId, defaults: DEF_PROD, set: setKV }); } catch {}
          try { await q(sqlU, [...argsU, productId]); } catch (e) {
            try { await pool.query(`insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [run.id, domain, run.page_type, T_PRODUCT, 'update', productId, String(e?.message||e), JSON.stringify(setKV)]); } catch {}
            chatLog('transfer_error', { run_id: run.id, error: String(e?.message || e), last_op: { type:'update', table:T_PRODUCT, id_product: productId, set: setKV } });
          }
          try { chatLog('sql_end', { table: T_PRODUCT, run_id: run.id, label: `${T_PRODUCT} / Update Success` }); } catch {}
          if (hasProductShop) {
            for (const SID of SHOPS) {
              const colsS = ['id_product','id_shop'];
              const argsS = [productId, SID];
              const upd = [];
              const rowS = { id_product: productId, id_shop: SID };
              const addCol = (name, value, update=true) => { colsS.push(name); argsS.push(value); rowS[name] = value; if (update) upd.push('`'+name+'`=VALUES(`'+name+'`)'); };
              // Ensure default category is maintained on update as well (if provided)
              if (await hasColumn(T_PRODUCT_SHOP, 'id_category_default')) {
                // Prefer shop-level settings/defaults; mapping only as fallback
                const catIdS = (TSET_SHOP.id_category_default != null)
                  ? Number(TSET_SHOP.id_category_default)
                  : (MDEF['product_shop'] && MDEF['product_shop'].id_category_default != null)
                    ? Number(MDEF['product_shop'].id_category_default)
                    : (DEF_SHOP.id_category_default != null)
                      ? Number(DEF_SHOP.id_category_default)
                      : (mapping.id_category_default != null)
                        ? Number(mapping.id_category_default)
                        : (DEF_PROD.id_category_default != null)
                          ? Number(DEF_PROD.id_category_default)
                          : null;
                try { chatLog('shop_category_resolved', { shop: SID, cat: catIdS, from: (mapping.id_category_default!=null)?'mapping':(TSET_SHOP.id_category_default!=null)?'tset_shop':(MDEF['product_shop']&&MDEF['product_shop'].id_category_default!=null)?'mdef_shop':(DEF_SHOP.id_category_default!=null)?'def_shop':(DEF_PROD.id_category_default!=null)?'def_prod':'none' }); } catch {}
                if (catIdS != null) addCol('id_category_default', catIdS);
              }
              else { try { chatLog('shop_category_skipped_no_column', { table: T_PRODUCT_SHOP }); } catch {} }
              if (await hasColumn(T_PRODUCT_SHOP, 'id_tax_rules_group')) addCol('id_tax_rules_group', shopTaxRulesGroup);
              if (await hasColumn(T_PRODUCT_SHOP, 'price')) addCol('price', Number(val.price||0));
              const sVisibility = (TSET_SHOP.visibility != null) ? String(TSET_SHOP.visibility) : visibilityDef;
              const sCondition = (TSET_SHOP.condition != null) ? String(TSET_SHOP.condition) : conditionDef;
          const sAvail = (TSET_SHOP.available_for_order != null) ? norm01(TSET_SHOP.available_for_order) : availableForOrderDef;
          const sShowPrice = (TSET_SHOP.show_price != null) ? norm01(TSET_SHOP.show_price) : showPriceDef;
          const sIndexed = (TSET_SHOP.indexed != null) ? norm01(TSET_SHOP.indexed) : indexedDef;
              const sActive = (TSET_SHOP.active != null) ? (TSET_SHOP.active ? 1 : 0) : 1;
              if (await hasColumn(T_PRODUCT_SHOP, 'active')) addCol('active', sActive);
              if (await hasColumn(T_PRODUCT_SHOP, 'visibility')) addCol('visibility', sVisibility);
              if (await hasColumn(T_PRODUCT_SHOP, 'condition')) addCol('condition', sCondition);
              if (await hasColumn(T_PRODUCT_SHOP, 'available_for_order')) addCol('available_for_order', sAvail);
              if (await hasColumn(T_PRODUCT_SHOP, 'show_price')) addCol('show_price', sShowPrice);
              if (await hasColumn(T_PRODUCT_SHOP, 'indexed')) addCol('indexed', sIndexed);
              if (await hasColumn(T_PRODUCT_SHOP, 'date_upd')) addCol('date_upd', nowFmt);
              const sqlS = `INSERT INTO ${'`'}${T_PRODUCT_SHOP}${'`'} (${colsS.map(c=>('`'+c+'`')).join(',')}) VALUES (${colsS.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${upd.join(', ')}`;
              try { chatLog('sql_begin', { table: T_PRODUCT_SHOP, run_id: run.id, shop: SID, label: `${T_PRODUCT_SHOP} / Start` }); } catch {}
              try { lastOp = { type: 'upsert', table: T_PRODUCT_SHOP, id_product: productId, shop: SID, row: rowS }; chatLog('sql_upsert', { table: T_PRODUCT_SHOP, run_id: run.id, shop: SID, defaults: DEF_SHOP, row: rowS }); } catch {}
              try { await q(sqlS, argsS); try { chatLog('sql_end', { table: T_PRODUCT_SHOP, run_id: run.id, shop: SID, status: 'success', label: `${T_PRODUCT_SHOP} / Success` }); } catch {} } catch (e) {
                try { chatLog('sql_end', { table: T_PRODUCT_SHOP, run_id: run.id, shop: SID, status: 'failure', label: `${T_PRODUCT_SHOP} / Failure`, error: String(e?.message||e) }); } catch {}
                try { await pool.query(`insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [run.id, domain, run.page_type, T_PRODUCT_SHOP, 'upsert', productId, SID, String(e?.message||e), JSON.stringify(rowS)]); } catch {}
                chatLog('transfer_error', { run_id: run.id, error: String(e?.message || e), last_op: { type:'upsert', table:T_PRODUCT_SHOP, id_product: productId, shop: SID, row: rowS } });
              }
            }
            // Final ensure: set category across all shops in bulk (in case ON DUPLICATE path didn't persist it)
            try {
              if (await hasColumn(T_PRODUCT_SHOP, 'id_category_default')) {
                const catBulk = (TSET_SHOP.id_category_default != null)
                  ? Number(TSET_SHOP.id_category_default)
                  : (MDEF['product_shop'] && MDEF['product_shop'].id_category_default != null)
                    ? Number(MDEF['product_shop'].id_category_default)
                    : (DEF_SHOP.id_category_default != null)
                      ? Number(DEF_SHOP.id_category_default)
                      : (mapping.id_category_default != null)
                        ? Number(mapping.id_category_default)
                        : (DEF_PROD.id_category_default != null)
                          ? Number(DEF_PROD.id_category_default)
                          : null;
                if (catBulk != null && Array.isArray(SHOPS) && SHOPS.length) {
                  const ph = SHOPS.map(()=>'?').join(',');
                  const sqlBulk = `UPDATE ${'`'}${T_PRODUCT_SHOP}${'`'} SET ${'`id_category_default`'}=? WHERE ${'`id_product`'}=? AND ${'`id_shop`'} IN (${ph})`;
                  await q(sqlBulk, [catBulk, productId, ...SHOPS]);
                  try { chatLog('shop_category_bulk_update', { product_id: productId, cat: catBulk, shops: SHOPS }); } catch {}
                }

                // Ensure category linkage in category_product (+ optional category_product_shop)
                try {
                  const T_CAT_PROD = PREFIX + 'category_product';
                  const T_CAT_PROD_SHOP = PREFIX + 'category_product_shop';
                  if (await hasTable(T_CAT_PROD)) {
                    const ex = await q(`SELECT 1 FROM ${'`'}${T_CAT_PROD}${'`'} WHERE ${'`id_category`'}=? AND ${'`id_product`'}=? LIMIT 1`, [catBulk, productId]);
                    if (!Array.isArray(ex) || ex.length === 0) {
                      let pos = 0;
                      try {
                        const rp = await q(`SELECT COALESCE(MAX(${"`position`"}),-1)+1 AS p FROM ${'`'}${T_CAT_PROD}${'`'} WHERE ${'`id_category`'}=?`, [catBulk]);
                        pos = (Array.isArray(rp) && rp.length) ? (Number(rp[0]?.p || 0) || 0) : 0;
                      } catch {}
                      await q(`INSERT INTO ${'`'}${T_CAT_PROD}${'`'} (${"`id_category`"},${"`id_product`"},${"`position`"}) VALUES (?,?,?)`, [catBulk, productId, pos]);
                      try { chatLog('category_product_link', { product_id: productId, id_category: catBulk, position: pos }); } catch {}
                    }
                  }
                  if (await hasTable(T_CAT_PROD_SHOP) && Array.isArray(SHOPS) && SHOPS.length) {
                    for (const SID of SHOPS) {
                      try {
                        const exs = await q(`SELECT 1 FROM ${'`'}${T_CAT_PROD_SHOP}${'`'} WHERE ${'`id_category`'}=? AND ${'`id_product`'}=? AND ${'`id_shop`'}=? LIMIT 1`, [catBulk, productId, SID]);
                        if (!Array.isArray(exs) || exs.length === 0) {
                          await q(`INSERT INTO ${'`'}${T_CAT_PROD_SHOP}${'`'} (${"`id_category`"},${"`id_product`"},${"`id_shop`"}) VALUES (?,?,?)`, [catBulk, productId, SID]);
                          try { chatLog('category_product_shop_link', { product_id: productId, id_category: catBulk, id_shop: SID }); } catch {}
                        }
                      } catch {}
                    }
                  }
                } catch (e) { try { chatLog('category_product_link_error', { product_id: productId, error: String(e?.message||e) }); } catch {} }
              }
            } catch {}

            // Sync product-level id_category_default to the resolved category (UI-first precedence)
            try {
              const finalCat = (TSET_SHOP.id_category_default != null)
                ? Number(TSET_SHOP.id_category_default)
                : (TSET_PRODUCT.id_category_default != null)
                  ? Number(TSET_PRODUCT.id_category_default)
                  : (MDEF['product_shop'] && MDEF['product_shop'].id_category_default != null)
                    ? Number(MDEF['product_shop'].id_category_default)
                    : (MDEF['product'] && MDEF['product'].id_category_default != null)
                      ? Number(MDEF['product'].id_category_default)
                      : (DEF_SHOP.id_category_default != null)
                        ? Number(DEF_SHOP.id_category_default)
                        : (DEF_PROD.id_category_default != null)
                          ? Number(DEF_PROD.id_category_default)
                          : (mapping.id_category_default != null)
                            ? Number(mapping.id_category_default)
                            : null;
              if (finalCat != null && await hasColumn(T_PRODUCT, 'id_category_default')) {
                await q(`UPDATE ${'`'}${T_PRODUCT}${'`'} SET ${'`id_category_default`'}=? WHERE ${'`id_product`'}=?`, [finalCat, productId]);
                try { chatLog('product_category_update_forced', { product_id: productId, id_category_default: finalCat, precedence: 'ui-first' }); } catch {}
              }
              // Ensure category_product linkage for finalCat as well (idempotent)
              if (finalCat != null) {
                const T_CAT_PROD = PREFIX + 'category_product';
                const T_CAT_PROD_SHOP = PREFIX + 'category_product_shop';
                if (await hasTable(T_CAT_PROD)) {
                  const ex = await q(`SELECT 1 FROM ${qi(T_CAT_PROD)} WHERE ${qi('id_category')}=? AND ${qi('id_product')}=? LIMIT 1`, [finalCat, productId]);
                  if (!Array.isArray(ex) || ex.length === 0) {
                    let pos = 0; try { const rp = await q(`SELECT COALESCE(MAX(${qi('position')}),-1)+1 AS p FROM ${qi(T_CAT_PROD)} WHERE ${qi('id_category')}=?`, [finalCat]); pos = (Array.isArray(rp) && rp.length) ? (Number(rp[0]?.p || 0) || 0) : 0; } catch {}
                    await q(`INSERT INTO ${qi(T_CAT_PROD)} (${qi('id_category')},${qi('id_product')},${qi('position')}) VALUES (?,?,?)`, [finalCat, productId, pos]);
                    try { chatLog('category_product_link_final', { product_id: productId, id_category: finalCat, position: pos }); } catch {}
                  }
                }
                if (await hasTable(T_CAT_PROD_SHOP) && Array.isArray(SHOPS) && SHOPS.length) {
                  for (const SID of SHOPS) {
                    try {
                      const exs = await q(`SELECT 1 FROM ${qi(T_CAT_PROD_SHOP)} WHERE ${qi('id_category')}=? AND ${qi('id_product')}=? AND ${qi('id_shop')}=? LIMIT 1`, [finalCat, productId, SID]);
                      if (!Array.isArray(exs) || exs.length === 0) {
                        await q(`INSERT INTO ${qi(T_CAT_PROD_SHOP)} (${qi('id_category')},${qi('id_product')},${qi('id_shop')}) VALUES (?,?,?)`, [finalCat, productId, SID]);
                        try { chatLog('category_product_shop_link_final', { product_id: productId, id_category: finalCat, id_shop: SID }); } catch {}
                      }
                    } catch {}
                  }
                }
              }
            } catch (e) { try { chatLog('product_category_update_error', { product_id: productId, error: String(e?.message||e) }); } catch {} }

            // Enforce per-table defaults (UI) for product_shop across all shops
            try {
              const defCols = [];
              const defVals = [];
              const keys = Object.keys(DEF_SHOP || {});
              for (const k of keys) {
                if (!k || k === 'id_product' || k === 'id_shop') continue;
                if (!(await hasColumn(T_PRODUCT_SHOP, k))) continue;
                const v = DEF_SHOP[k];
                // Normalize booleans/01
                const norm = (x) => { const s = String(x); if (s === '1' || s === '0') return Number(s); if (s.toLowerCase() === 'true') return 1; if (s.toLowerCase() === 'false') return 0; const n = Number(s); return Number.isFinite(n) ? n : x; };
                defCols.push('`'+k+'`=?');
                defVals.push(norm(v));
              }
              if (defCols.length) {
                const ph = SHOPS.map(()=>'?').join(',');
                const sqlDef = `UPDATE ${'`'}${T_PRODUCT_SHOP}${'`'} SET ${defCols.join(', ')} WHERE ${'`id_product`'}=? AND ${'`id_shop`'} IN (${ph})`;
                await q(sqlDef, [...defVals, productId, ...SHOPS]);
                try { chatLog('shop_defaults_enforced', { product_id: productId, cols: keys, shops: SHOPS }); } catch {}
              }
            } catch {}
          }

          // Enforce per-table defaults (UI) for product table
          try {
            const defColsP = [];
            const defValsP = [];
            const keysP = Object.keys(DEF_PROD || {});
            for (const k of keysP) {
              if (!k || k === 'id_product') continue;
              if (!(await hasColumn(T_PRODUCT, k))) continue;
              const v = DEF_PROD[k];
              const norm = (x) => { const s = String(x); if (s === '1' || s === '0') return Number(s); if (s.toLowerCase() === 'true') return 1; if (s.toLowerCase() === 'false') return 0; const n = Number(s); return Number.isFinite(n) ? n : x; };
              defColsP.push('`'+k+'`=?');
              defValsP.push(norm(v));
            }
            if (defColsP.length) {
              const sqlDefP = `UPDATE ${'`'}${T_PRODUCT}${'`'} SET ${defColsP.join(', ')} WHERE ${'`id_product`'}=?`;
              await q(sqlDefP, [...defValsP, productId]);
              try { chatLog('product_defaults_enforced', { product_id: productId, cols: keysP }); } catch {}
            }
          } catch {}
          updated = true;
        }

        // product_lang
        if (hasProductLang && productId) {
          // Resolve languages: prefer per-table settings; otherwise take all active from ps_lang
          let LANGS = [];
          if (Array.isArray(TSET_LANG?.id_langs) && TSET_LANG.id_langs.length) {
            LANGS = TSET_LANG.id_langs.map(n=>Number(n)||0).filter(n=>n>0);
          } else {
            try {
              const T_LANG = PREFIX + 'lang';
              if (await hasTable(T_LANG)) {
                const rows = await q(`SELECT ${'`id_lang`'} as id_lang FROM ${'`'}${T_LANG}${'`'} WHERE ${'`active`'}=1`);
                const ids = Array.isArray(rows) ? rows.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : [];
                if (ids.length) LANGS = ids;
              }
            } catch {}
            if (!LANGS.length) LANGS = [ID_LANG];
          }
          if (productLangHasShop) {
            for (const SID of SHOPS) {
              for (const L of LANGS) {
                const name = String(firstDef(F_LANG ? resolveSpec(src, F_LANG.name) : undefined, val.name, 'Imported Product'));
                const descVal = firstDef(
                  F_LANG ? resolveSpec(src, F_LANG.description) : undefined,
                  val.description,
                  resolveSpec(src, ['product.description_html','meta.description']),
                  ''
                );
                const desc = sanitizeHtmlForPresta(descVal == null ? '' : String(descVal));
                let descShortRaw = firstDef(
                  F_LANG ? resolveSpec(src, F_LANG.description_short) : undefined,
                  resolveSpec(src, ['product.description_short','meta.description']),
                  ''
                );
                let descShort = sanitizeHtmlForPresta(descShortRaw == null ? '' : String(descShortRaw));
                try {
                  const maxS = await getColMaxLen(T_PRODUCT_LANG, 'description_short');
                  if (maxS && descShort && descShort.length > maxS) descShort = descShort.slice(0, maxS);
                } catch {}
                const slug = slugify(name);
                let metaTitle = String(firstDef(
                  F_LANG ? resolveSpec(src, F_LANG.meta_title) : undefined,
                  resolveSpec(src, FIELDS.meta_title),
                  resolveSpec(src, ['meta.title','json_ld.mapped.name','json_ld.raw.name']),
                  name
                ) || '');
                let metaDesc = String(firstDef(
                  F_LANG ? resolveSpec(src, F_LANG.meta_description) : undefined,
                  resolveSpec(src, FIELDS.meta_description),
                  resolveSpec(src, ['meta.description','json_ld.mapped.description', 'product.description_html'])
                ) || '');
                // Truncate meta fields to DB-defined max length when available
                try {
                  const maxT = await getColMaxLen(T_PRODUCT_LANG, 'meta_title');
                  const maxD = await getColMaxLen(T_PRODUCT_LANG, 'meta_description');
                  if (maxT && metaTitle && metaTitle.length > maxT) metaTitle = metaTitle.slice(0, maxT);
                  if (maxD && metaDesc && metaDesc.length > maxD) metaDesc = metaDesc.slice(0, maxD);
                } catch {}
                const cols = ['id_product','id_shop','id_lang','name','description','link_rewrite'];
                const args = [productId, SID, L, name, desc, slug];
                const upd = ['`name`=VALUES(`name`)','`description`=VALUES(`description`)','`link_rewrite`=VALUES(`link_rewrite`)'];
                if (await hasColumn(T_PRODUCT_LANG, 'description_short')) { cols.push('description_short'); args.push(descShort); upd.push('`description_short`=VALUES(`description_short`)'); }
                if (await hasColumn(T_PRODUCT_LANG, 'meta_title')) { cols.push('meta_title'); args.push(metaTitle); upd.push('`meta_title`=VALUES(`meta_title`)'); }
                if (await hasColumn(T_PRODUCT_LANG, 'meta_description')) { cols.push('meta_description'); args.push(metaDesc); upd.push('`meta_description`=VALUES(`meta_description`)'); }
                try { chatLog('sql_begin', { table: T_PRODUCT_LANG, run_id: run.id, shop: SID, lang: L, label: `${T_PRODUCT_LANG} / Start` }); } catch {}
                try { lastOp = { type: 'upsert', table: T_PRODUCT_LANG, id_product: productId, shop: SID, lang: L }; chatLog('sql_upsert', { table: T_PRODUCT_LANG, run_id: run.id, id_product: productId, shop: SID, lang: L, row: { name, link_rewrite: slug, description_len: (desc||'').length, description_short_len: (descShort||'').length, meta_title: metaTitle ? '[set]' : '', meta_description: metaDesc ? '[set]' : '' } }); } catch {}
                try {
                  const sql = `INSERT INTO ${'`'}${T_PRODUCT_LANG}${'`'} (${cols.map(c=>'`'+c+'`').join(',')}) VALUES (${cols.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${upd.join(', ')}`;
                  await q(sql, args);
                  // Enforce per-table product_lang defaults from UI
                  try {
                    const keysL = Object.keys(DEF_LANG||{});
                    if (keysL.length) {
                      const set = [];
                      const vals = [];
                      for (const k of keysL) {
                        if (!k) continue;
                        if (!(await hasColumn(T_PRODUCT_LANG, k))) continue;
                        const v = DEF_LANG[k];
                        set.push('`'+k+'`=?');
                        vals.push(String(v));
                      }
                      if (set.length) {
                        const sqlDef = `UPDATE ${'`'}${T_PRODUCT_LANG}${'`'} SET ${set.join(', ')} WHERE ${'`id_product`'}=? AND ${'`id_shop`'}=? AND ${'`id_lang`'}=?`;
                        await q(sqlDef, [...vals, productId, SID, L]);
                        try { chatLog('product_lang_defaults_enforced', { product_id: productId, shop: SID, lang: L, cols: keysL }); } catch {}
                      }
                    }
                  } catch {}
                  try { chatLog('sql_end', { table: T_PRODUCT_LANG, run_id: run.id, shop: SID, lang: L, status: 'success', label: `${T_PRODUCT_LANG} / Success` }); } catch {}
                } catch (e) {
                  try { chatLog('sql_end', { table: T_PRODUCT_LANG, run_id: run.id, shop: SID, lang: L, status: 'failure', label: `${T_PRODUCT_LANG} / Failure`, error: String(e?.message||e) }); } catch {}
                  // Log the failure, then retry without problematic columns (e.g., meta_description)
                  try { await pool.query(`insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [run.id, domain, run.page_type, T_PRODUCT_LANG, 'upsert', productId, SID, L, String(e?.message||e), JSON.stringify({ row: { name, link_rewrite: slug, description: (desc||'').slice(0,128), meta_title: metaTitle, meta_description: (metaDesc||'').slice(0,128) } })]); } catch {}
                  chatLog('transfer_error', { run_id: run.id, error: String(e?.message||e), last_op: { type:'upsert', table:T_PRODUCT_LANG, id_product: productId, shop: SID, lang: L } });
                  // Fallback: drop meta_description (and meta_title if needed) and retry
                  try {
                    const fc = []; const fa = []; const fu = [];
                    for (let i=0;i<cols.length;i++) {
                      const c = cols[i]; const a = args[i];
                      const low = String(c).toLowerCase();
                      if (low==='meta_description' || low==='description_short') continue;
                      fc.push(c); fa.push(a);
                    }
                    for (const u of upd) if (!/`meta_description`|`description_short`/i.test(u)) fu.push(u);
                    const sql2 = `INSERT INTO ${'`'}${T_PRODUCT_LANG}${'`'} (${fc.map(c=>'`'+c+'`').join(',')}) VALUES (${fc.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${fu.join(', ')}`;
                    try { chatLog('sql_begin', { table: T_PRODUCT_LANG, run_id: run.id, shop: SID, lang: L, attempt: 2, label: `${T_PRODUCT_LANG} / Start` }); } catch {}
                    await q(sql2, fa);
                    try { chatLog('sql_end', { table: T_PRODUCT_LANG, run_id: run.id, shop: SID, lang: L, attempt: 2, status: 'success', label: `${T_PRODUCT_LANG} / Success` }); } catch {}
                  } catch (e2) {
                    // Fallback 2: also drop meta_title if still failing
                    try {
                      const fc2 = []; const fa2 = []; const fu2 = [];
                      for (let i=0;i<cols.length;i++) {
                        const c = cols[i]; const a = args[i];
                        const low = String(c).toLowerCase();
                        if (low==='meta_description' || low==='meta_title' || low==='description_short') continue;
                        fc2.push(c); fa2.push(a);
                      }
                      for (const u of upd) if (!/`meta_description`|`meta_title`|`description_short`/i.test(u)) fu2.push(u);
                      if (fc2.length) {
                        const sql3 = `INSERT INTO ${'`'}${T_PRODUCT_LANG}${'`'} (${fc2.map(c=>'`'+c+'`').join(',')}) VALUES (${fc2.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${fu2.join(', ')}`;
                        try { chatLog('sql_begin', { table: T_PRODUCT_LANG, run_id: run.id, shop: SID, lang: L, attempt: 3, label: `${T_PRODUCT_LANG} / Start` }); } catch {}
                        await q(sql3, fa2);
                        try { chatLog('sql_end', { table: T_PRODUCT_LANG, run_id: run.id, shop: SID, lang: L, attempt: 3, status: 'success', label: `${T_PRODUCT_LANG} / Success` }); } catch {}
                      }
                    } catch (e3) {
                      // Give up for this row; already logged
                    }
                  }
                }
              }
            }
          } else {
            for (const L of LANGS) {
              const name = String(firstDef(F_LANG ? resolveSpec(src, F_LANG.name) : undefined, val.name, 'Imported Product'));
              const descVal = firstDef(
                F_LANG ? resolveSpec(src, F_LANG.description) : undefined,
                val.description,
                resolveSpec(src, ['product.description_html','meta.description']),
                ''
              );
              const desc = sanitizeHtmlForPresta(descVal == null ? '' : String(descVal));
              const descShortRaw = firstDef(
                F_LANG ? resolveSpec(src, F_LANG.description_short) : undefined,
                resolveSpec(src, ['product.description_short','meta.description']),
                ''
              );
              const descShort = sanitizeHtmlForPresta(descShortRaw == null ? '' : String(descShortRaw));
              const slug = slugify(name);
              let metaTitle = String(firstDef(
                F_LANG ? resolveSpec(src, F_LANG.meta_title) : undefined,
                resolveSpec(src, FIELDS.meta_title),
                resolveSpec(src, ['meta.title','json_ld.mapped.name','json_ld.raw.name']),
                name
              ) || '');
              let metaDesc = String(firstDef(
                F_LANG ? resolveSpec(src, F_LANG.meta_description) : undefined,
                resolveSpec(src, FIELDS.meta_description),
                resolveSpec(src, ['meta.description','json_ld.mapped.description','product.description_html'])
              ) || '');
              try {
                const maxT = await getColMaxLen(T_PRODUCT_LANG, 'meta_title');
                const maxD = await getColMaxLen(T_PRODUCT_LANG, 'meta_description');
                if (maxT && metaTitle && metaTitle.length > maxT) metaTitle = metaTitle.slice(0, maxT);
                if (maxD && metaDesc && metaDesc.length > maxD) metaDesc = metaDesc.slice(0, maxD);
              } catch {}
              const cols = ['id_product','id_lang','name','description','link_rewrite'];
              const args = [productId, L, name, desc, slug];
              const upd = ['`name`=VALUES(`name`)','`description`=VALUES(`description`)','`link_rewrite`=VALUES(`link_rewrite`)'];
              if (await hasColumn(T_PRODUCT_LANG, 'description_short')) { cols.push('description_short'); args.push(descShort); upd.push('`description_short`=VALUES(`description_short`)'); }
              if (await hasColumn(T_PRODUCT_LANG, 'meta_title')) { cols.push('meta_title'); args.push(metaTitle); upd.push('`meta_title`=VALUES(`meta_title`)'); }
              if (await hasColumn(T_PRODUCT_LANG, 'meta_description')) { cols.push('meta_description'); args.push(metaDesc); upd.push('`meta_description`=VALUES(`meta_description`)'); }
              try { lastOp = { type: 'upsert', table: T_PRODUCT_LANG, id_product: productId, lang: L }; chatLog('sql_upsert', { table: T_PRODUCT_LANG, run_id: run.id, id_product: productId, lang: L, row: { name, link_rewrite: slug, description_len: (desc||'').length, description_short_len: (descShort||'').length, meta_title: metaTitle ? '[set]' : '', meta_description: metaDesc ? '[set]' : '' } }); } catch {}
              try {
                const sql = `INSERT INTO ${'`'}${T_PRODUCT_LANG}${'`'} (${cols.map(c=>'`'+c+'`').join(',')}) VALUES (${cols.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${upd.join(', ')}`;
                await q(sql, args);
                // Enforce per-table product_lang defaults from UI (no shop)
                try {
                  const keysL = Object.keys(DEF_LANG||{});
                  if (keysL.length) {
                    const set = [];
                    const vals = [];
                    for (const k of keysL) {
                      if (!k) continue;
                      if (!(await hasColumn(T_PRODUCT_LANG, k))) continue;
                      const v = DEF_LANG[k];
                      set.push('`'+k+'`=?');
                      vals.push(String(v));
                    }
                    if (set.length) {
                      const sqlDef = `UPDATE ${'`'}${T_PRODUCT_LANG}${'`'} SET ${set.join(', ')} WHERE ${'`id_product`'}=? AND ${'`id_lang`'}=?`;
                      await q(sqlDef, [...vals, productId, L]);
                      try { chatLog('product_lang_defaults_enforced', { product_id: productId, lang: L, cols: keysL }); } catch {}
                    }
                  }
                } catch {}
              } catch (e) {
                try { await pool.query(`insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [run.id, domain, run.page_type, T_PRODUCT_LANG, 'upsert', productId, L, String(e?.message||e), JSON.stringify({ row: { name, link_rewrite: slug, description: (desc||'').slice(0,128), meta_title: metaTitle, meta_description: (metaDesc||'').slice(0,128) } })]); } catch {}
                chatLog('transfer_error', { run_id: run.id, error: String(e?.message||e), last_op: { type:'upsert', table:T_PRODUCT_LANG, id_product: productId, lang: L } });
                // Fallback: drop meta_description; then also meta_title if needed
                try {
                  const fc = []; const fa = []; const fu = [];
                  for (let i=0;i<cols.length;i++) { const c = cols[i]; const a = args[i]; if (String(c).toLowerCase()==='meta_description') continue; fc.push(c); fa.push(a); }
                  for (const u of upd) if (!/`meta_description`/i.test(u)) fu.push(u);
                  const sql2 = `INSERT INTO ${'`'}${T_PRODUCT_LANG}${'`'} (${fc.map(c=>'`'+c+'`').join(',')}) VALUES (${fc.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${fu.join(', ')}`;
                  await q(sql2, fa);
                } catch (e2) {
                  try {
                    const fc2 = []; const fa2 = []; const fu2 = [];
                    for (let i=0;i<cols.length;i++) { const c = cols[i]; const a = args[i]; const low=String(c).toLowerCase(); if (low==='meta_description' || low==='meta_title') continue; fc2.push(c); fa2.push(a); }
                    for (const u of upd) if (!/`meta_description`|`meta_title`/i.test(u)) fu2.push(u);
                    if (fc2.length) {
                      const sql3 = `INSERT INTO ${'`'}${T_PRODUCT_LANG}${'`'} (${fc2.map(c=>'`'+c+'`').join(',')}) VALUES (${fc2.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${fu2.join(', ')}`;
                      await q(sql3, fa2);
                    }
                  } catch (e3) {}
                }
              }
            }
          }
        }

// Images pipeline (moved to services/transfer/images.pipeline.js)
try {
  const { runImagesPipeline } = await import('./transfer/images.pipeline.js');
  await runImagesPipeline({ q, qi, hasTable, hasColumn, pool, chatLog, run, result: (run && run.result) || {}, domain, productId, PREFIX, TSET_LANG, TSET_ANY, TABLES, SHOPS, ID_LANG, fmtDateTime, ensureImageMapTable });
} catch (e) { chatLog('transfer_error', { run_id: run.id, error: 'images_failed: '+String(e?.message||e) }); }


        // Attachments (ps_attachment, ps_attachment_lang, ps_product_attachment)
        if (productId) {
          try {
            const T_ATTACHMENT = PREFIX + 'attachment';
            const T_ATTACHMENT_LANG = PREFIX + 'attachment_lang';
            const T_PRODUCT_ATTACHMENT = PREFIX + 'product_attachment';
            const hasAttach = await hasTable(T_ATTACHMENT);
            if (hasAttach) {
              // Collect document URLs from result
              const docs = [];
              try { if (Array.isArray(result.documents)) for (const u of result.documents) { const s=String(u||'').trim(); if (s) docs.push(s); } } catch {}
              const uniqDocs = Array.from(new Set(docs));
              if (uniqDocs.length) {
                // Languages for attachment_lang name/desc (mirror product_lang)
                let LANGS_ATTACH = [];
                if (Array.isArray(TSET_LANG?.id_langs) && TSET_LANG.id_langs.length) {
                  LANGS_ATTACH = TSET_LANG.id_langs.map(n=>Number(n)||0).filter(n=>n>0);
                } else {
                  try { const rowsL = await q(`SELECT ${'`id_lang`'} as id_lang FROM ${'`'}${PREFIX+'lang'}${'`'} WHERE ${'`active`'}=1`); const ids = Array.isArray(rowsL) ? rowsL.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : []; if (ids.length) LANGS_ATTACH = ids; } catch {}
                  if (!LANGS_ATTACH.length) LANGS_ATTACH = [ID_LANG];
                }
                // Create mapping table for attachments
                await pool.query(`CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_attachment_map (id BIGSERIAL PRIMARY KEY, domain TEXT NOT NULL, product_id BIGINT NOT NULL, source_url TEXT, url_hash TEXT, content_sha1 TEXT NOT NULL, id_attachment BIGINT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
                await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS mod_gj_attach_map_uq ON public.mod_grabbing_jerome_attachment_map (domain, product_id, content_sha1)`);
                // Staging root
                const stagingRoot = getStagingRoot(String(TSET_ANY?.attachment?.staging_root||''));
                const tmpDir = path.join(stagingRoot, 'tmp');
                // Store human-readable copies under modules/grabbing-jerome/document_folder/<id_product>
                const prodAttachDir = path.join(resolveModuleRoot(), 'document_folder', String(productId));
                try { fs.mkdirSync(prodAttachDir, { recursive: true }); } catch {}
                // Presta download root
                const downloadRoot = chooseDownloadRoot(TSET_ANY?.attachment || {});
                for (const url of uniqDocs) {
                  try {
                    const urlHash = createHash('sha1').update(String(url)).digest('hex');
                    let base = '';
                    try { const u = new URL(String(url)); base = decodeURIComponent(u.pathname || '').split('/').pop() || ''; } catch {}
                    const ext = (base.match(/\.([A-Za-z0-9]{1,8})$/) || [,'pdf'])[1];
                    const tmpName = sanitizeFilename(base, `${urlHash}.${ext}`);
                    const tmpPath = path.join(tmpDir, tmpName);
                    chatLog('attachment_download_start', { run_id: run.id, url, tmp: tmpPath });
                    const dl = await downloadToFileWithHash(url, tmpPath, Number(TSET_ANY?.attachment?.timeout_ms||20000));
                    const contentSha1 = String(dl && dl.sha1 || '');
                    if (!contentSha1) throw new Error('empty_sha1');
                    // Copy into document_folder/<id_product>/
                    try { const prodCopy = path.join(prodAttachDir, tmpName); fs.copyFileSync(tmpPath, prodCopy); let sz=null; try{sz=fs.statSync(prodCopy).size;}catch{}; chatLog('attachment_archive_store', { run_id: run.id, product_id: productId, file: prodCopy, bytes: sz }); } catch {}
                    // Reuse if same content already mapped
                    let id_attachment = 0;
                    try {
                      const rmap = await pool.query(`SELECT id_attachment FROM public.mod_grabbing_jerome_attachment_map WHERE domain=$1 AND product_id=$2 AND content_sha1=$3 LIMIT 1`, [domain, productId, contentSha1]);
                      const mapped = rmap.rowCount ? Number(rmap.rows[0].id_attachment||0) || 0 : 0;
                      if (mapped) {
                        const rowsE = await q(`SELECT ${'`id_attachment`'} FROM ${'`'}${T_ATTACHMENT}${'`'} WHERE ${'`id_attachment`'}=? LIMIT 1`, [mapped]);
                        if (Array.isArray(rowsE) && rowsE.length) { id_attachment = mapped; chatLog('attachment_dedupe_hit', { run_id: run.id, product_id: productId, id_attachment }); }
                      }
                    } catch {}
                    // Insert ps_attachment if not reused
                    if (!id_attachment) {
                      // ensure columns
                      const cols = ['file']; const args = [];
                      // Presta usually stores a 40-char token in `file` and physical path download/<file>
                      const token = contentSha1.slice(0,40);
                      args.push(token);
                      if (await hasColumn(T_ATTACHMENT, 'mime')) { cols.push('mime'); args.push(String(dl?.contentType||'application/pdf')); }
                      if (await hasColumn(T_ATTACHMENT, 'file_name')) { cols.push('file_name'); args.push(base || 'document'); }
                      if (await hasColumn(T_ATTACHMENT, 'file_size')) { let sz=0; try{ sz = fs.statSync(tmpPath).size; } catch {}; cols.push('file_size'); args.push(sz); }
                      const sqlA = `INSERT INTO ${'`'}${T_ATTACHMENT}${'`'} (${cols.map(c=>('`'+c+'`')).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`;
                      await q(sqlA, args);
                      const idRow = await q('SELECT LAST_INSERT_ID() AS id');
                      id_attachment = Number((idRow && idRow[0] && idRow[0].id) || 0) || 0;
                      try { await pool.query(`INSERT INTO public.mod_grabbing_jerome_attachment_map(domain,product_id,source_url,url_hash,content_sha1,id_attachment) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (domain,product_id,content_sha1) DO UPDATE SET id_attachment=EXCLUDED.id_attachment`, [domain, productId, url, urlHash, contentSha1, id_attachment]); } catch {}
                      chatLog('attachment_insert', { run_id: run.id, product_id: productId, id_attachment, file: token });
                    }
                    // ps_attachment_lang
                    if (await hasTable(T_ATTACHMENT_LANG) && id_attachment) {
                      for (const L of LANGS_ATTACH) {
                        const colsL = ['id_attachment','id_lang']; const argsL = [id_attachment, L]; const updL = [];
                        if (await hasColumn(T_ATTACHMENT_LANG, 'name')) { colsL.push('name'); argsL.push(base || 'document'); updL.push('`name`=VALUES(`name`)'); }
                        if (await hasColumn(T_ATTACHMENT_LANG, 'description')) { colsL.push('description'); argsL.push(''); updL.push('`description`=VALUES(`description`)'); }
                        const sqlL = `INSERT INTO ${'`'}${T_ATTACHMENT_LANG}${'`'} (${colsL.map(c=>'`'+c+'`').join(',')}) VALUES (${colsL.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${updL.length?updL.join(', '):`${'`id_lang`'}=${'`id_lang`'}`}`;
                        await q(sqlL, argsL);
                        chatLog('attachment_lang_upsert', { run_id: run.id, id_attachment, id_lang: L });
                      }
                    }
                    // ps_product_attachment link
                    if (await hasTable(T_PRODUCT_ATTACHMENT) && id_attachment) {
                      const colsPA = ['id_product','id_attachment']; const argsPA = [productId, id_attachment];
                      const sqlPA = `INSERT IGNORE INTO ${'`'}${T_PRODUCT_ATTACHMENT}${'`'} (${colsPA.map(c=>'`'+c+'`').join(',')}) VALUES (${colsPA.map(()=>'?').join(',')})`;
                      try { await q(sqlPA, argsPA); } catch {}
                      chatLog('product_attachment_upsert', { run_id: run.id, id_product: productId, id_attachment });
                    }
                    // Copy into Presta download directory
                    if (downloadRoot && id_attachment) {
                      const token = contentSha1.slice(0,40);
                      const dest = path.join(downloadRoot, token);
                      try { fs.mkdirSync(downloadRoot, { recursive: true, mode: getPermsSettings(TSET_ANY?.attachment||{}).dir_mode }); } catch {}
                      try { fs.copyFileSync(tmpPath, dest); applyOwnershipAndPerms(dest, false, TSET_ANY?.attachment||{}); let sz=0; try{sz=fs.statSync(dest).size;}catch{}; chatLog('attachment_copy', { run_id: run.id, id_attachment, dest, bytes: sz }); } catch (e) { chatLog('attachment_copy_error', { run_id: run.id, id_attachment, error: String(e?.message||e) }); }
                    }
                  } catch (e) {
                    chatLog('attachment_error', { run_id: run.id, error: String(e?.message||e) });
                  }
                }
              }
            }
          } catch (e) {
            chatLog('transfer_error', { run_id: run.id, error: 'attachments_failed: '+String(e?.message||e) });
          }
        }

        // Variants: build color combinations (RAL codes) when provided
        try {
          const variantsCfg = (mapping && typeof mapping.variants==='object') ? mapping.variants : {};
          const enableColors = (variantsCfg && variantsCfg.enabled) !== false; // default on when present
          const colorCodes = Array.isArray(result?.colors?.codes) ? result.colors.codes : [];
          if (enableColors && productId && colorCodes.length) {
            const GROUP_NAME = String((variantsCfg && variantsCfg.group_name) || 'Couleur (RAL)');
            // Tables
            const T_AG = PREFIX + 'attribute_group';
            const T_AG_LANG = PREFIX + 'attribute_group_lang';
            const T_AG_SHOP = PREFIX + 'attribute_group_shop';
            const T_A = PREFIX + 'attribute';
            const T_A_LANG = PREFIX + 'attribute_lang';
            const T_A_SHOP = PREFIX + 'attribute_shop';
            const T_PATTR = PREFIX + 'product_attribute';
            const T_PATTR_SHOP = PREFIX + 'product_attribute_shop';
            const T_PATTR_COMB = PREFIX + 'product_attribute_combination';
            const T_LPA = PREFIX + 'layered_product_attribute'; // optional
            const hasAttrs = await hasTable(T_AG) && await hasTable(T_A) && await hasTable(T_PATTR) && await hasTable(T_PATTR_COMB);
            if (hasAttrs) {
              // Languages and shops
              let LANGS_ATTR = [];
              try {
                const T_LANG = PREFIX + 'lang';
                if (await hasTable(T_LANG)) {
                  const rows = await q(`SELECT ${'`id_lang`'} as id_lang FROM ${'`'}${T_LANG}${'`'} WHERE ${'`active`'}=1`);
                  const ids = Array.isArray(rows) ? rows.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : [];
                  LANGS_ATTR = ids.length ? ids : [ID_LANG];
                }
              } catch { LANGS_ATTR = [ID_LANG]; }
              // Ensure color group exists
              let id_attribute_group = 0;
              try {
                const r = await q(`SELECT g.${'`id_attribute_group`'} FROM ${'`'}${T_AG}${'`'} g JOIN ${'`'}${T_AG_LANG}${'`'} gl ON gl.${'`id_attribute_group`'}=g.${'`id_attribute_group`'} WHERE gl.${'`name`'}=? LIMIT 1`, [GROUP_NAME]);
                if (Array.isArray(r) && r.length) id_attribute_group = Number(r[0].id_attribute_group)||0;
              } catch {}
              if (!id_attribute_group) {
                try {
                  const cols = []; const args = []; const colsSet = new Set();
                  const push = (c,v)=>{ cols.push(c); args.push(v); colsSet.add(c); };
                  if (await hasColumn(T_AG, 'is_color_group')) push('is_color_group', 1);
                  if (await hasColumn(T_AG, 'group_type')) push('group_type', 'color');
                  if (await hasColumn(T_AG, 'position')) push('position', 0);
                  await q(`INSERT INTO ${'`'}${T_AG}${'`'} (${cols.map(c=>'`'+c+'`').join(',')}) VALUES (${cols.map(()=>'?').join(',')})`, args);
                  const ir = await q('SELECT LAST_INSERT_ID() AS id');
                  id_attribute_group = Number((ir && ir[0] && ir[0].id) || 0) || 0;
                  for (const L of LANGS_ATTR) {
                    try { await q(`INSERT INTO ${'`'}${T_AG_LANG}${'`'} (${['id_attribute_group','id_lang','name','public_name'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE ${'`name`'}=VALUES(${ '`name`' }), ${'`public_name`'}=VALUES(${ '`public_name`' })`, [id_attribute_group, L, GROUP_NAME, GROUP_NAME]); } catch {}
                  }
                  for (const SID of SHOPS) { try { await q(`INSERT IGNORE INTO ${'`'}${T_AG_SHOP}${'`'} (${['id_attribute_group','id_shop'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?)`, [id_attribute_group, SID]); } catch {} }
                  chatLog('variant_group_create', { run_id: run.id, id_attribute_group, name: GROUP_NAME });
                } catch (e) { chatLog('variant_error', { run_id: run.id, error: String(e?.message||e) }); }
              }
              if (id_attribute_group) {
                // Build a map of code -> id_attribute
                const codeToAttr = new Map();
                // Attempt to derive hex from swatches array
                const sw = Array.isArray(result?.colors?.swatches) ? result.colors.swatches : [];
                const hexOf = (idx) => { try { const s = String(sw[idx]||''); const m=s.match(/#([0-9A-Fa-f]{3,8})/); return m? ('#'+m[1]): ''; } catch { return ''; } };
                for (let i=0;i<colorCodes.length;i++) {
                  const code = String(colorCodes[i]||'').trim(); if (!code) continue;
                  // find existing attribute
                  let id_attr = 0;
                  try {
                    const r = await q(`SELECT a.${'`id_attribute`'} FROM ${'`'}${T_A}${'`'} a JOIN ${'`'}${T_A_LANG}${'`'} al ON al.${'`id_attribute`'}=a.${'`id_attribute`'} WHERE a.${'`id_attribute_group`'}=? AND al.${'`name`'}=? LIMIT 1`, [id_attribute_group, code]);
                    if (Array.isArray(r) && r.length) id_attr = Number(r[0].id_attribute)||0;
                  } catch {}
                  if (!id_attr) {
                    try {
                      const colorHex = hexOf(i);
                      await q(`INSERT INTO ${'`'}${T_A}${'`'} (${['id_attribute_group','color','position'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?,?)`, [id_attribute_group, colorHex||'', i]);
                      const ir = await q('SELECT LAST_INSERT_ID() AS id'); id_attr = Number((ir && ir[0] && ir[0].id) || 0) || 0;
                      for (const L of LANGS_ATTR) { try { await q(`INSERT INTO ${'`'}${T_A_LANG}${'`'} (${['id_attribute','id_lang','name'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ${'`name`'}=VALUES(${ '`name`' })`, [id_attr, L, code]); } catch {} }
                      for (const SID of SHOPS) { try { await q(`INSERT IGNORE INTO ${'`'}${T_A_SHOP}${'`'} (${['id_attribute','id_shop'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?)`, [id_attr, SID]); } catch {} }
                      chatLog('variant_attr_create', { run_id: run.id, id_attribute: id_attr, code });
                    } catch (e) { chatLog('variant_attr_error', { run_id: run.id, code, error: String(e?.message||e) }); continue; }
                  }
                  if (id_attr) codeToAttr.set(code, id_attr);
                }
                // Build combinations for product (reuse existing combos when present)
                let isFirst = true;
                for (let i=0;i<colorCodes.length;i++) {
                  const code = String(colorCodes[i]||'').trim();
                  const id_attr = codeToAttr.get(code); if (!id_attr) continue;
                  let id_product_attribute = 0;
                  // Try to reuse existing combination for this attribute
                  try {
                    const rowsExist = await q(`SELECT pa.${'`id_product_attribute`'} FROM ${'`'}${T_PATTR}${'`'} pa JOIN ${'`'}${T_PATTR_COMB}${'`'} pac ON pac.${'`id_product_attribute`'}=pa.${'`id_product_attribute`'} WHERE pa.${'`id_product`'}=? AND pac.${'`id_attribute`'}=? LIMIT 1`, [productId, id_attr]);
                    if (Array.isArray(rowsExist) && rowsExist.length) {
                      id_product_attribute = Number(rowsExist[0].id_product_attribute||0) || 0;
                      if (id_product_attribute) chatLog('variant_pattr_reuse', { run_id: run.id, id_product_attribute, id_attribute: id_attr });
                    }
                  } catch {}
                  // Create if not found
                  if (!id_product_attribute) {
                    try {
                      await q(`INSERT INTO ${'`'}${T_PATTR}${'`'} (${['id_product','reference','supplier_reference','ean13','isbn','upc','mpn','price','weight','default_on','minimal_quantity'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [productId, null, null, null, null, null, null, 0, 0, isFirst?1:null, 1]);
                      const ir = await q('SELECT LAST_INSERT_ID() AS id'); id_product_attribute = Number((ir && ir[0] && ir[0].id) || 0) || 0;
                      // Enforce product_attribute defaults (schema-aware)
                      try {
                        const keysA = Object.keys(DEF_ATTR||{});
                        if (keysA.length && id_product_attribute) {
                          const set = []; const vals = []; const norm = (x)=>{ const s=String(x); if(s==='1'||s==='0') return Number(s); const n=Number(s); return Number.isFinite(n)?n:x; };
                          for (const k of keysA) { if (!k) continue; if (!(await hasColumn(T_PATTR, k))) continue; set.push('`'+k+'`=?'); vals.push(norm(DEF_ATTR[k])); }
                          if (set.length) { await q(`UPDATE ${'`'}${T_PATTR}${'`'} SET ${set.join(', ')} WHERE ${'`id_product_attribute`'}=?`, [...vals, id_product_attribute]); try { chatLog('product_attribute_defaults_enforced', { id_product_attribute, cols: keysA }); } catch {} }
                        }
                      } catch {}
                    } catch (e) { chatLog('variant_pattr_error', { run_id: run.id, error: String(e?.message||e) }); continue; }
                    if (!id_product_attribute) continue;
                    // Link attribute to combination
                    try { await q(`INSERT IGNORE INTO ${'`'}${T_PATTR_COMB}${'`'} (${['id_attribute','id_product_attribute'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?)`, [id_attr, id_product_attribute]); } catch {}
                  }
                  // Per shop row: skip product_attribute_shop writes (requested removal)
                  for (const SID of SHOPS) {
                    try { chatLog('product_attribute_shop_write_skipped', { id_product_attribute, shop: SID }); } catch {}
                  }
                  // Stock per combination per shop
                  if (await hasTable(T_STOCK)) {
                    for (const SID of SHOPS) {
                      try { await q(`INSERT INTO ${'`'}${T_STOCK}${'`'} (${['id_product','id_product_attribute','id_shop','id_shop_group','quantity','out_of_stock'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ${'`quantity`'}=VALUES(${ '`quantity`' })`, [productId, id_product_attribute, SID, ID_SHOP_GROUP, 0, 0]); } catch (e) { chatLog('variant_stock_error', { run_id: run.id, error: String(e?.message||e) }); }
                    }
                  }
                  // Layered navigation linking (optional; ignore errors)
                  try { await q(`INSERT IGNORE INTO ${'`'}${T_LPA}${'`'} (${['id_attribute','id_product','id_attribute_group','id_shop'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?,?,?)`, [id_attr, productId, id_attribute_group, SHOPS[0]]); } catch {}
                  isFirst = false;
                }
              }
            }
          }
        } catch (e) { chatLog('transfer_error', { run_id: run.id, error: 'variants_failed: '+String(e?.message||e) }); }

        // stock_available (id_product_attribute = 0)
        if (await hasTable(T_STOCK) && productId) {
          const outOfStock = norm01(DEF_STOCK_MERGED.out_of_stock, 0);
          for (const SID of SHOPS) {
            chatLog('upsert_stock', { run_id: run.id, product_id: productId, shop: SID, quantity: val.quantity });
            const qtyDefault = firstDef(TSET_STOCK?.default_quantity, DEF_STOCK_MERGED.quantity);
            const physDefault = firstDef(TSET_STOCK?.default_physical_quantity, DEF_STOCK_MERGED.physical_quantity);
            let qtyVal = Number(firstDef(
              F_STOCK ? resolveSpec(src, F_STOCK.quantity) : undefined,
              resolveSpec(src, FIELDS.quantity),
              resolveSpec(src, ['quantity','stock.quantity','qty']),
              qtyDefault,
              0
            ));
            if (!Number.isFinite(qtyVal)) qtyVal = Number(qtyDefault||0);
            let physVal = Number(firstDef(
              F_STOCK ? resolveSpec(src, F_STOCK.physical_quantity) : undefined,
              resolveSpec(src, FIELDS.physical_quantity),
              physDefault
            ));
            if (!Number.isFinite(physVal)) physVal = Number(physDefault||0)||0;
            try { chatLog('sql_begin', { table: T_STOCK, run_id: run.id, shop: SID, label: `${T_STOCK} / Start` }); } catch {}
            try { lastOp = { type: 'upsert', table: T_STOCK, id_product: productId, id_shop: SID }; chatLog('sql_upsert', { table: T_STOCK, run_id: run.id, defaults: DEF_STOCK_MERGED, row: { id_product: productId, id_product_attribute: 0, id_shop: SID, id_shop_group: ID_SHOP_GROUP, quantity: qtyVal, physical_quantity: physVal, out_of_stock: outOfStock } }); } catch {}
            try {
              const colsSA = ['id_product','id_product_attribute','id_shop','id_shop_group','quantity','out_of_stock'];
              const valsSA = [productId, 0, SID, ID_SHOP_GROUP, Number.isFinite(qtyVal)?qtyVal:0, outOfStock];
              const updSA = ['`quantity`=VALUES(`quantity`)','`out_of_stock`=VALUES(`out_of_stock`)'];
              if (await hasColumn(T_STOCK, 'physical_quantity')) { colsSA.push('physical_quantity'); valsSA.push(Number.isFinite(physVal)?physVal:0); updSA.push('`physical_quantity`=VALUES(`physical_quantity`)'); }
              await q(`INSERT INTO ${'`'}${T_STOCK}${'`'} (${colsSA.map(c=>'`'+c+'`').join(',')}) VALUES (${colsSA.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${updSA.join(', ')}`, valsSA);
              // Enforce stock_available defaults (schema-aware) per shop
              try {
                const keysS = Object.keys(DEF_STOCK_MERGED||{});
                if (keysS.length) {
                  const set = [];
                  const vals = [];
                  const norm = (x) => { const s = String(x); if (s==='1'||s==='0') return Number(s); if (s.toLowerCase()==='true') return 1; if (s.toLowerCase()==='false') return 0; const n = Number(s); return Number.isFinite(n)?n:x; };
                  for (const k of keysS) {
                    if (!k || k==='id_product' || k==='id_shop' || k==='id_product_attribute' || k==='id_shop_group') continue;
                    if (!(await hasColumn(T_STOCK, k))) continue;
                    set.push('`'+k+'`=?');
                    vals.push(norm(DEF_STOCK_MERGED[k]));
                  }
                  if (set.length) {
                    const sqlDef = `UPDATE ${'`'}${T_STOCK}${'`'} SET ${set.join(', ')} WHERE ${'`id_product`'}=? AND ${'`id_product_attribute`'}=0 AND ${'`id_shop`'}=? AND ${'`id_shop_group`'}=?`;
                    await q(sqlDef, [...vals, productId, SID, ID_SHOP_GROUP]);
                    try { chatLog('stock_defaults_enforced', { product_id: productId, shop: SID, cols: keysS }); } catch {}
                  }
                }
              } catch {}
              try { chatLog('sql_end', { table: T_STOCK, run_id: run.id, shop: SID, status: 'success', label: `${T_STOCK} / Success` }); } catch {}
            } catch (e) {
              try { chatLog('sql_end', { table: T_STOCK, run_id: run.id, shop: SID, status: 'failure', label: `${T_STOCK} / Failure`, error: String(e?.message||e) }); } catch {}
              try { await pool.query(`insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [run.id, domain, run.page_type, T_STOCK, 'upsert', productId, SID, String(e?.message||e), JSON.stringify({ quantity: Number(val.quantity||0), out_of_stock: outOfStock })]); } catch {}
              chatLog('transfer_error', { run_id: run.id, error: String(e?.message||e), last_op: { type:'upsert', table:T_STOCK, id_product: productId, id_shop: SID } });
            }
          }
        }

        // Features mapping: map known spec attributes + JSON-LD additionalProperty to Presta features
        try {
          const T_FEATURE = PREFIX + 'feature';
          const T_FEATURE_LANG = PREFIX + 'feature_lang';
          const T_FEATURE_VALUE = PREFIX + 'feature_value';
          const T_FEATURE_VALUE_LANG = PREFIX + 'feature_value_lang';
          const T_FEATURE_SHOP = PREFIX + 'feature_shop';
          // Presta 8 may use either `product_feature` or `feature_product` for the link table
          let LINK_TABLE = PREFIX + 'product_feature';
          if (!(await hasTable(LINK_TABLE)) && await hasTable(PREFIX + 'feature_product')) LINK_TABLE = PREFIX + 'feature_product';
          const hasFeatureTables = await hasTable(T_FEATURE) && await hasTable(T_FEATURE_LANG) && await hasTable(T_FEATURE_VALUE) && await hasTable(T_FEATURE_VALUE_LANG) && await hasTable(LINK_TABLE);
          const hasFeatureShop = await hasTable(T_FEATURE_SHOP);
          if (hasFeatureTables && productId) {
            // Collect language ids for feature_lang/value_lang
            let FEAT_LANGS = [];
            try {
              const T_LANG = PREFIX + 'lang';
              if (await hasTable(T_LANG)) {
                const rows = await q(`SELECT ${'`id_lang`'} as id_lang FROM ${'`'}${T_LANG}${'`'} WHERE ${'`active`'}=1`);
                const ids = Array.isArray(rows) ? rows.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : [];
                FEAT_LANGS = ids.length ? ids : [ID_LANG];
              }
            } catch { FEAT_LANGS = [ID_LANG]; }
            const attrs = Array.isArray(result?.attributes) ? result.attributes : [];
            // JSON-LD: additionalProperty [{ name, value }]
            const addProps = Array.isArray(result?.json_ld?.raw?.additionalProperty) ? result.json_ld.raw.additionalProperty : [];
            const addPairs = addProps.map(p => ({
              name: (p && (p.name || p.propertyID || p['@id'])) ? String(p.name || p.propertyID || p['@id']) : '',
              value: (p && (p.value || p.description)) ? String(p.value || p.description) : ''
            })).filter(x => (x.name || x.value));
            const seenFeaturePairs = new Set();
            const wanted = [
              { key:'reference', aliases:['référence produit', 'référence', 'reference'], extract:'token' },
              { key:'dimensions', aliases:['dimensions'], extract:'raw' },
              { key:'poids', aliases:['poids'], extract:'raw' },
              { key:'compatibilité', aliases:['compatibilité', 'compatibilite'], extract:'raw' },
            ];
            for (const w of wanted) {
              const row = attrs.find(a => {
                const nm = String(a?.name||'').toLowerCase().replace(/\s*:$/, '').trim();
                return w.aliases.some(al => nm.includes(al));
              });
              if (!row) continue;
              const rawVal = String(row?.value||'').trim();
              const featureName = String(row?.name||'').replace(/\s*:$/, '').trim();
              let valueText = rawVal;
              if (w.extract==='token') {
                const m = rawVal.match(/([A-Za-z0-9._\-]{2,})\s*$/); valueText = (m && m[1]) ? m[1] : rawVal;
              }
              if (!featureName || !valueText) continue;
              // Ensure feature exists (by name)
              let id_feature = 0;
              try {
                const r = await q(`SELECT f.${'`id_feature`'} FROM ${'`'}${T_FEATURE}${'`'} f JOIN ${'`'}${T_FEATURE_LANG}${'`'} fl ON fl.${'`id_feature`'}=f.${'`id_feature`'} WHERE fl.${'`name`'}=? LIMIT 1`, [featureName]);
                if (Array.isArray(r) && r.length) id_feature = Number(r[0].id_feature)||0;
              } catch {}
              if (!id_feature) {
                try {
                  await q(`INSERT INTO ${'`'}${T_FEATURE}${'`'} () VALUES ()`);
                  const ir = await q('SELECT LAST_INSERT_ID() AS id');
                  id_feature = Number((ir && ir[0] && ir[0].id) || 0) || 0;
                  for (const L of FEAT_LANGS) {
                    try { await q(`INSERT INTO ${'`'}${T_FEATURE_LANG}${'`'} (${['id_feature','id_lang','name'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ${'`name`'}=VALUES(${ '`name`' })`, [id_feature, L, featureName]); } catch {}
                  }
                  chatLog('feature_create', { run_id: run.id, id_feature, name: featureName });
                } catch (e) { chatLog('feature_error', { run_id: run.id, error: String(e?.message||e) }); continue; }
              }
              // Ensure feature is linked to all destination shops
              if (hasFeatureShop) {
                for (const SID of SHOPS) {
                  try {
                    await q(`INSERT IGNORE INTO ${'`'}${T_FEATURE_SHOP}${'`'} (${['id_feature','id_shop'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?)`, [id_feature, SID]);
                    chatLog('feature_shop_upsert', { run_id: run.id, id_feature, id_shop: SID });
                  } catch (e) { chatLog('feature_shop_error', { run_id: run.id, error: String(e?.message||e) }); }
                }
              }
              // Ensure feature is linked to shops if table exists
              if (await hasTable(T_FEATURE_SHOP)) {
                for (const SID of SHOPS) {
                  try { await q(`INSERT IGNORE INTO ${'`'}${T_FEATURE_SHOP}${'`'} (${['id_feature','id_shop'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?)`, [id_feature, SID]); chatLog('feature_shop_upsert', { run_id: run.id, id_feature, id_shop: SID }); } catch (e) { chatLog('feature_shop_error', { run_id: run.id, error: String(e?.message||e) }); }
                }
              }
              // Ensure feature value exists for this feature
              let id_feature_value = 0;
              try {
                const r = await q(`SELECT v.${'`id_feature_value`'} FROM ${'`'}${T_FEATURE_VALUE}${'`'} v JOIN ${'`'}${T_FEATURE_VALUE_LANG}${'`'} vl ON vl.${'`id_feature_value`'}=v.${'`id_feature_value`'} WHERE v.${'`id_feature`'}=? AND vl.${'`value`'}=? LIMIT 1`, [id_feature, valueText]);
                if (Array.isArray(r) && r.length) id_feature_value = Number(r[0].id_feature_value)||0;
              } catch {}
              if (!id_feature_value) {
                try {
                  await q(`INSERT INTO ${'`'}${T_FEATURE_VALUE}${'`'} (${['id_feature','custom'].map(c=>'`'+c+'`').join(',')}) VALUES (?,0)`, [id_feature]);
                  const ir = await q('SELECT LAST_INSERT_ID() AS id');
                  id_feature_value = Number((ir && ir[0] && ir[0].id) || 0) || 0;
                  for (const L of FEAT_LANGS) {
                    try { await q(`INSERT INTO ${'`'}${T_FEATURE_VALUE_LANG}${'`'} (${['id_feature_value','id_lang','value'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ${'`value`'}=VALUES(${ '`value`' })`, [id_feature_value, L, valueText]); } catch {}
                  }
                  chatLog('feature_value_create', { run_id: run.id, id_feature, id_feature_value, value: valueText });
                } catch (e) { chatLog('feature_value_error', { run_id: run.id, error: String(e?.message||e) }); continue; }
              }
              // Link to product
              try { await q(`INSERT IGNORE INTO ${'`'}${LINK_TABLE}${'`'} (${['id_product','id_feature','id_feature_value'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?,?)`, [productId, id_feature, id_feature_value]); chatLog('product_feature_upsert', { run_id: run.id, id_product: productId, id_feature, id_feature_value }); } catch (e) { chatLog('product_feature_error', { run_id: run.id, error: String(e?.message||e) }); }
            }

            // Map JSON-LD additionalProperty as features (name → value)
            for (const ap of addPairs) {
              let featureName = String(ap.name || '').replace(/^\s+|\s+$/g,'');
              const valueText = String(ap.value || '').trim();
              if (!featureName || !valueText) continue;
              const dedupeKey = featureName.toLowerCase() + '::' + valueText.toLowerCase();
              if (seenFeaturePairs.has(dedupeKey)) continue;
              seenFeaturePairs.add(dedupeKey);
              // Optional normalization: drop common prefix like pa_ and replace dashes/underscores
              try {
                const norm = featureName.replace(/^pa[_-]/i, '').replace(/[_-]+/g, ' ').trim();
                if (norm) featureName = norm;
              } catch {}
              // Ensure feature exists (by name)
              let id_feature = 0;
              try {
                const r = await q(`SELECT f.${'`id_feature`'} FROM ${'`'}${T_FEATURE}${'`'} f JOIN ${'`'}${T_FEATURE_LANG}${'`'} fl ON fl.${'`id_feature`'}=f.${'`id_feature`'} WHERE fl.${'`name`'}=? LIMIT 1`, [featureName]);
                if (Array.isArray(r) && r.length) id_feature = Number(r[0].id_feature)||0;
              } catch {}
              if (!id_feature) {
                try {
                  await q(`INSERT INTO ${'`'}${T_FEATURE}${'`'} () VALUES ()`);
                  const ir = await q('SELECT LAST_INSERT_ID() AS id');
                  id_feature = Number((ir && ir[0] && ir[0].id) || 0) || 0;
                  for (const L of FEAT_LANGS) {
                    try { await q(`INSERT INTO ${'`'}${T_FEATURE_LANG}${'`'} (${['id_feature','id_lang','name'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ${'`name`'}=VALUES(${ '`name`' })`, [id_feature, L, featureName]); } catch {}
                  }
                  chatLog('feature_create', { run_id: run.id, id_feature, name: featureName, source: 'json_ld.additionalProperty' });
                } catch (e) { chatLog('feature_error', { run_id: run.id, error: String(e?.message||e), source: 'json_ld.additionalProperty' }); continue; }
              }
              // Ensure feature is linked to shops
              if (await hasTable(T_FEATURE_SHOP)) {
                for (const SID of SHOPS) {
                  try { await q(`INSERT IGNORE INTO ${'`'}${T_FEATURE_SHOP}${'`'} (${['id_feature','id_shop'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?)`, [id_feature, SID]); chatLog('feature_shop_upsert', { run_id: run.id, id_feature, id_shop: SID, source: 'json_ld.additionalProperty' }); } catch (e) { chatLog('feature_shop_error', { run_id: run.id, error: String(e?.message||e), source: 'json_ld.additionalProperty' }); }
                }
              }
              // Ensure feature value exists
              let id_feature_value = 0;
              try {
                const r = await q(`SELECT v.${'`id_feature_value`'} FROM ${'`'}${T_FEATURE_VALUE}${'`'} v JOIN ${'`'}${T_FEATURE_VALUE_LANG}${'`'} vl ON vl.${'`id_feature_value`'}=v.${'`id_feature_value`'} WHERE v.${'`id_feature`'}=? AND vl.${'`value`'}=? LIMIT 1`, [id_feature, valueText]);
                if (Array.isArray(r) && r.length) id_feature_value = Number(r[0].id_feature_value)||0;
              } catch {}
              if (!id_feature_value) {
                try {
                  await q(`INSERT INTO ${'`'}${T_FEATURE_VALUE}${'`'} (${['id_feature','custom'].map(c=>'`'+c+'`').join(',')}) VALUES (?,0)`, [id_feature]);
                  const ir = await q('SELECT LAST_INSERT_ID() AS id');
                  id_feature_value = Number((ir && ir[0] && ir[0].id) || 0) || 0;
                  for (const L of FEAT_LANGS) {
                    try { await q(`INSERT INTO ${'`'}${T_FEATURE_VALUE_LANG}${'`'} (${['id_feature_value','id_lang','value'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ${'`value`'}=VALUES(${ '`value`' })`, [id_feature_value, L, valueText]); } catch {}
                  }
                  chatLog('feature_value_create', { run_id: run.id, id_feature, id_feature_value, value: valueText, source: 'json_ld.additionalProperty' });
                } catch (e) { chatLog('feature_value_error', { run_id: run.id, error: String(e?.message||e), source: 'json_ld.additionalProperty' }); continue; }
              }
              // Link to product
              try { await q(`INSERT IGNORE INTO ${'`'}${LINK_TABLE}${'`'} (${['id_product','id_feature','id_feature_value'].map(c=>'`'+c+'`').join(',')}) VALUES (?,?,?)`, [productId, id_feature, id_feature_value]); chatLog('product_feature_upsert', { run_id: run.id, id_product: productId, id_feature, id_feature_value, source: 'json_ld.additionalProperty' }); } catch (e) { chatLog('product_feature_error', { run_id: run.id, error: String(e?.message||e), source: 'json_ld.additionalProperty' }); }
            }
          }
        } catch (e) { chatLog('transfer_error', { run_id: run.id, error: 'features_failed: '+String(e?.message||e) }); }

        // Generic writer for any additional tables declared in mapping.tables
        // (extracted to keep legacy lean)
        try {
          const { runGenericWriter } = await import('./transfer/generic-writer.js');
          await runGenericWriter({
            q, qi, hasTable, pool, chatLog,
            PREFIX, TABLES, TSET_ANY, MFIELDS,
            DEFAULTS, MDEF,
            SHOPS, ID_LANG, ID_SHOP_GROUP,
            productId, src, domain, run,
            cfgDatabase: cfg.database,
            fmtDateTime,
            resolveSpec,
          });
        } catch (e) {
          chatLog('transfer_error', { run_id: run.id, error: 'generic_writer_failed: '+String(e?.message||e) });
        }

        chatLog('upsert_done', { run_id: run.id, product_id: productId, created, updated });
        // Persist product_id on the run record for traceability
        try { await pool.query(`update public.mod_grabbing_jerome_extraction_runs set product_id=$2, updated_at=now() where id=$1`, [run.id, productId||null]); } catch {}
        return res.json({ ok:true, mode:'upsert', product_id: productId, created, updated, values: { ...val } });
      } catch (e) {
        chatLog('transfer_error', { run_id: runId, error: String(e?.message || e), last_op: (typeof lastOp==='object'? lastOp: null) });
        return res.status(500).json({ ok:false, error:'connect_failed', message: e?.message || String(e) });
      } finally { try { if (conn) await conn.end(); } catch {} }
    } catch (e) { return res.status(500).json({ ok:false, error:'transfer_failed', message: e?.message || String(e) }); }
}

export default legacySendToPresta;
