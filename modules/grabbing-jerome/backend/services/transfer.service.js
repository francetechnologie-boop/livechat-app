// Send-to-Presta service (modern entry)
// Modern orchestrator using extracted helpers (mysql, mapping, images, generic-writer)
// Keeps behavior similar to legacy while being modular and testable.

import { getMysql2FromCtx, connectMySql, makeSqlHelpers } from './transfer/mysql.js';
import { resolveProfileId, resolvePrefix, loadTableSettings } from './transfer/mapping.js';
import { runImagesPipeline } from './transfer/images.pipeline.js';
import { runDocumentsPipeline } from './transfer/documents.pipeline.js';
import { runGenericWriter } from './transfer/generic-writer.js';
import { runAttributesWriter } from './transfer/attributes.js';
import { runFeaturesWriter } from './transfer/features.js';

export async function sendToPresta(req, res, ctx = {}, utils = {}) {
  const pool = utils?.pool;
  const chatLog = typeof utils?.chatLog === 'function' ? utils.chatLog : (()=>{});
  const normDomain = typeof utils?.normDomain === 'function' ? utils.normDomain : (s => String(s||'').toLowerCase().replace(/^www\./,''));
  const ensureExtractionRunsTable = typeof utils?.ensureExtractionRunsTable === 'function' ? utils.ensureExtractionRunsTable : async ()=>{};
  const ensureSendErrorLogsTable = typeof utils?.ensureSendErrorLogsTable === 'function' ? utils.ensureSendErrorLogsTable : async ()=>{};
  const ensureImageMapTable = typeof utils?.ensureImageMapTable === 'function' ? utils.ensureImageMapTable : async ()=>{};

  try {
    if (!pool || typeof pool.query !== 'function') return res.status(503).json({ ok:false, error:'db_unavailable' });
    await ensureExtractionRunsTable();
    await ensureSendErrorLogsTable();

    const runId = Number(req.body?.run_id || req.body?.id || 0) || 0;
    const explicitProfileId = req.body?.profile_id != null ? Number(req.body.profile_id) : null;
    const requestedMode = String(req.body?.mode||'').toLowerCase();
    const debug = req.body?.debug === true;
    const doWrite = (req.body?.write === true) || requestedMode === 'upsert' || requestedMode === 'insert';
    const explicitMapping = (req.body && typeof req.body.mapping === 'object') ? req.body.mapping : null;
    if (!runId) return res.status(400).json({ ok:false, error:'bad_request', message:'run_id required' });

    // Load run
    const rr = await pool.query(`select id, domain, url, page_type, version, result from public.mod_grabbing_jerome_extraction_runs where id=$1`, [runId]);
    if (!rr.rowCount) return res.status(404).json({ ok:false, error:'not_found', message:'run not found' });
    const run = rr.rows[0];
    const domain = normDomain(run.domain);
    // Allow explicit override of page type from request wrappers
    const type = String((req.body?.force_page_type || req.body?.page_type || run.page_type || '')).trim().toLowerCase() || 'product';
    try { chatLog('send_type', { run_id: run.id, resolved_type: type, run_page_type: String(run.page_type||'').toLowerCase(), forced: String(req.body?.force_page_type||'') }); } catch {}
    chatLog('transfer_start', { run_id: runId, domain, page_type: type, write: doWrite });
    try { await pool.query(
      `insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [ run.id, domain, run.page_type, 'transfer', 'start', null, null, null, 'begin', JSON.stringify({ write: !!doWrite }) ]
    ); } catch { try { chatLog('log_table_insert_failed', { stage: 'start' }); } catch {} }

    // Centralized error logger: both file log and DB table
    const logErr = async ({ table_name = null, op = null, product_id = null, id_shop = null, id_lang = null, error = '', payload = {} } = {}) => {
      try {
        await pool.query(
          `insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [ run.id, domain, run.page_type, table_name, op, product_id, id_shop, id_lang, String(error||''), JSON.stringify(payload||{}) ]
        );
      } catch {}
      try { chatLog('transfer_error', { run_id: run.id, table_name, op, product_id, id_shop, id_lang, error: String(error||''), payload: Array.isArray(payload)? '[array]': (payload && typeof payload==='object' ? '[object]' : payload) }); } catch {}
    };

    // Resolve profile + mapping container
    const { profileId, configTransfert: ct } = await resolveProfileId(pool, domain, explicitProfileId);
    if (!profileId) return res.status(400).json({ ok:false, error:'missing_profile', message:'Select a PrestaShop DB profile (db-mysql) first.' });

    // Load MySQL profile details
    const pr = await pool.query(`SELECT id, name, host, port, "database", db_user AS user, db_password AS password, ssl FROM public.mod_db_mysql_profiles WHERE id=$1`, [profileId]);
    if (!pr.rowCount) return res.status(404).json({ ok:false, error:'profile_not_found' });
    const prof = pr.rows[0];

    // Connect to MySQL
    let mysql;
    try { mysql = await getMysql2FromCtx(ctx); } catch { return res.status(500).json({ ok:false, error:'mysql2_missing', message:'Install mysql2 in backend: cd backend && npm i mysql2 --omit=dev' }); }
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
      conn = await connectMySql(ctx, cfg);
      chatLog('mysql_connect_ok', { host: cfg.host, port: cfg.port, database: cfg.database });
      const { q: qBase, qi, hasTable: _hasTable, hasColumn: _hasColumn } = makeSqlHelpers(conn);
      const executedQueries = [];
      const q = async (sql, args = []) => {
        try { if (debug) executedQueries.push({ sql: String(sql||''), args: Array.isArray(args)? args : [] }); } catch {}
        return qBase(sql, args);
      };
      const hasTable = (t) => _hasTable(t, cfg.database);
      const hasColumn = (t,c) => _hasColumn(t,c, cfg.database);

      // -------- Column length enforcement (truncate + log) --------
      const __colLenCache = new Map();
      const getColMaxLen = async (table, column) => {
        try {
          const key = String(table)+'|'+String(column);
          if (__colLenCache.has(key)) return __colLenCache.get(key);
          const rows = await q(
            'SELECT CHARACTER_MAXIMUM_LENGTH as max_len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1',
            [cfg.database, table, column]
          );
          const n = Array.isArray(rows) && rows.length ? (Number(rows[0].max_len||0)||0) : 0;
          __colLenCache.set(key, n);
          return n;
        } catch { return 0; }
      };
      const enforceRowLimits = async (table, row = {}, ctxInfo = {}) => {
        try {
          const T = String(table);
          for (const [col, val] of Object.entries(row)) {
            if (typeof val !== 'string') continue;
            const max = await getColMaxLen(T, col);
            if (max && val.length > max) {
              const before = val;
              row[col] = before.slice(0, max);
              try {
                await logErr({ table_name: T, op: 'truncate', product_id: ctxInfo.product_id||null, id_shop: ctxInfo.id_shop||null, id_lang: ctxInfo.id_lang||null, error: 'truncated', payload: { column: col, max_len: max, before_len: before.length, after_len: row[col].length } });
              } catch {}
              try { chatLog('truncate', { table: T, col, max, before_len: before.length, after_len: row[col].length, product_id: ctxInfo.product_id||null, id_shop: ctxInfo.id_shop||null, id_lang: ctxInfo.id_lang||null }); } catch {}
            }
          }
        } catch {}
        return row;
      };

      // Resolve mapping (prefer latest from mapping tools; fallback to domain config_transfert)
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
      const savedMap = toolMap || (ct && ct.mappings && ct.mappings[type]) || ct?.mapping || {};
      let mapping = explicitMapping || savedMap || {};
      if (mapping && typeof mapping === 'object' && mapping.config && typeof mapping.config === 'object') {
        mapping = mapping.config;
      }
      // track mapping version if provided or from latest tool version
      let mappingVersion = (req.body?.mapping_version != null) ? Number(req.body.mapping_version) : null;
      if (!mappingVersion) {
        try {
          const rVer = await pool.query(`select version from public.mod_grabbing_jerome_maping_tools where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2) order by version desc limit 1`, [domain, type]);
          if (rVer.rowCount) mappingVersion = Number(rVer.rows[0].version||0) || null;
        } catch {}
      }
      const PREFIX = resolvePrefix(ct, mapping);
      const FLAGS = (mapping && typeof mapping.flags === 'object') ? mapping.flags : {};
      const STRICT_MAPPING_ONLY = !!FLAGS.strict_mapping_only;
      const UNIFIED_DYNAMIC = !!FLAGS.unified_dynamic;
      const TABLES = (mapping && mapping.tables && typeof mapping.tables === 'object') ? mapping.tables : {};
      const ID_LANG = Number(mapping.id_lang || 1) || 1;
      // Determine full languages list for *_lang tables
      let LANGS = [];
      try {
        const T_LANG = PREFIX + 'lang';
        if (await hasTable(T_LANG)) {
          const rows = await q(`SELECT ${qi('id_lang')} as id_lang FROM ${qi(T_LANG)} WHERE ${qi('active')}=1 ORDER BY ${qi('id_lang')} ASC`);
          LANGS = Array.isArray(rows) ? rows.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : [];
        }
      } catch {}
      if (!LANGS.length) LANGS = [ID_LANG];

      // Load per-table settings
      const { TSET_PRODUCT, TSET_SHOP, TSET_LANG, TSET_STOCK, TSET_ANY, MFIELDS, MDEF, TDEF_STOCK_TBL } = await loadTableSettings(pool, domain, type);

      // Defaults from mapping (needed before computing ID_SHOP_DEFAULT)
      const DEFAULTS = mapping?.defaults || {};
      const DEF_PROD = (DEFAULTS.product && typeof DEFAULTS.product === 'object') ? DEFAULTS.product : {};
      const DEF_SHOP = (DEFAULTS.product_shop && typeof DEFAULTS.product_shop === 'object') ? DEFAULTS.product_shop : {};

      // Shops + defaults (global list) - no fallback to 1; prefer mapping/tools or DB active shops
      // 1) Try table settings (product_shop), then mapping.id_shops
      let SHOPS = (Array.isArray(TSET_SHOP?.id_shops) && TSET_SHOP.id_shops.length)
        ? TSET_SHOP.id_shops.map(n=>Number(n)||0).filter(n=>n>0)
        : (Array.isArray(mapping.id_shops) && mapping.id_shops.length)
          ? mapping.id_shops.map(n=>Number(n)||0).filter(n=>n>0)
          : [];
      // 2) If empty, read active shops from Presta DB
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
      // 3) Compute id_shop_default from mapping/settings/defaults/shops (no hard-coded 1)
      const ID_SHOP_DEFAULT = (mapping.id_shop_default != null)
        ? Number(mapping.id_shop_default) || (SHOPS[0] || 0)
        : ((TSET_PRODUCT?.id_shop_default != null)
            ? (Number(TSET_PRODUCT.id_shop_default) || (SHOPS[0] || 0))
            : ((DEF_PROD?.id_shop_default != null)
                ? (Number(DEF_PROD.id_shop_default) || (SHOPS[0] || 0))
                : (SHOPS[0] || 0)));
      const ID_SHOP_GROUP = (mapping.id_shop_group != null) ? Number(mapping.id_shop_group)||0 : 0;

      // Groups list for tables with id_group (e.g., category_group) — prefer settings id_groups, fallback to DB groups
      let GROUPS = [];
      let groupsSrc = 'none';
      let groupsActiveFilterUsed = false;
      try {
        const fromTset = (TSET_ANY?.category_group && Array.isArray(TSET_ANY.category_group.id_groups)) ? TSET_ANY.category_group.id_groups.map(n=>Number(n)||0).filter(n=>n>0) : [];
        if (fromTset.length) { GROUPS = fromTset; groupsSrc = 'settings'; }
      } catch {}
      if (!GROUPS.length) {
        try {
          const T_GROUP = PREFIX + 'group';
          if (await hasTable(T_GROUP)) {
            const hasActive = await hasColumn(T_GROUP, 'active');
            const rows = await q(`SELECT ${qi('id_group')} as id_group FROM ${qi(T_GROUP)} ${hasActive? 'WHERE '+qi('active')+'=1' : ''} ORDER BY ${qi('id_group')} ASC`);
            GROUPS = Array.isArray(rows) ? rows.map(r=>Number(r.id_group)||0).filter(n=>n>0) : [];
            groupsSrc = hasActive ? 'db_active' : 'db_all';
            groupsActiveFilterUsed = !!hasActive;
          }
        } catch {}
      }

      // Debug: print resolved scope and notable per-table overrides to spot mismatches fast
      try {
        const TABLES_SAFE = (mapping && mapping.tables && typeof mapping.tables==='object') ? mapping.tables : {};
        const mapSet = (k) => (TABLES_SAFE[k] && typeof TABLES_SAFE[k].settings==='object') ? TABLES_SAFE[k].settings : {};
        const tsetDb = (k) => (TSET_ANY && typeof TSET_ANY==='object' && TSET_ANY[k]) ? TSET_ANY[k] : {};
        const scopeLog = {
          run_id: run.id,
          domain,
          shops: SHOPS,
          langs: LANGS,
          groups: GROUPS,
          id_shop_default_eff: ID_SHOP_DEFAULT,
          base_shop: (SHOPS && SHOPS.length ? SHOPS[0] : null),
          per_table: (function(){
            const t = String(type||'').toLowerCase();
            if (t === 'product') {
              return {
                product_shop: { map: mapSet('product_shop')?.id_shops || null, db: tsetDb('product_shop')?.id_shops || null },
                product_lang: { map: mapSet('product_lang')?.id_shops || null, db: tsetDb('product_lang')?.id_shops || null },
                image:        { map: mapSet('image')?.id_shops || null,        db: tsetDb('image')?.id_shops || null },
                product_attribute_shop: { map: mapSet('product_attribute_shop')?.id_shops || null, db: tsetDb('product_attribute_shop')?.id_shops || null },
              };
            }
            // category/article: show category-related keys if present in mapping/settings
            return {
              category:        { map: TABLES?.category?.settings || null, db: tsetDb('category') || null },
              category_lang:   { map: TABLES?.category_lang?.settings || null, db: tsetDb('category_lang') || null },
              category_shop:   { map: TABLES?.category_shop?.settings || null, db: tsetDb('category_shop') || null },
              category_group:  { map: TABLES?.category_group?.settings || null, db: tsetDb('category_group') || null },
            };
          })()
        };
        chatLog('send_scope', scopeLog);
        // Human-friendly applied shops/langs lines to mirror groups
        try { chatLog('applied_shops', { run_id: run.id, shops: SHOPS, label: (Array.isArray(SHOPS)&&SHOPS.length)? SHOPS.join(',') : 'none' }); } catch {}
        try { chatLog('applied_langs', { run_id: run.id, langs: LANGS, label: 'all active ps_lang' }); } catch {}
        // Human-friendly applied groups line (mirrors shops/langs applied logs)
        try {
          let label = 'none';
          if (groupsSrc === 'settings') label = 'mapping id_groups';
          else if (groupsSrc === 'db_active') label = 'all active ps_group';
          else if (groupsSrc === 'db_all') label = 'all ps_group';
          chatLog('applied_groups', { run_id: run.id, source: groupsSrc, active_filtered: groupsActiveFilterUsed, groups: GROUPS, label });
        } catch {}
      } catch {}

      // Source data
      const result = run.result && typeof run.result === 'object' ? run.result : (run.result ? JSON.parse(run.result) : {});

      // (Unified non-product gate is implemented below)
      const src = result.product || result.item || result;
      const FIELDS = (mapping && mapping.fields && typeof mapping.fields === 'object') ? mapping.fields : {};
      const F_PRODUCT = (TABLES.product && typeof TABLES.product.fields === 'object') ? TABLES.product.fields : null;
      const F_LANG = (TABLES.product_lang && typeof TABLES.product_lang.fields === 'object') ? TABLES.product_lang.fields : null;
      const F_STOCK = (TABLES.stock_available && typeof TABLES.stock_available.fields === 'object') ? TABLES.stock_available.fields : null;

      const pickPath = (obj, pathStr) => {
        try { if (!pathStr) return undefined; const parts = String(pathStr).replace(/^\$\.?/, '').split('.'); let cur = obj; for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; } return cur; } catch { return undefined; }
      };
      const pickFlex = (pathStr) => {
        if (!pathStr) return undefined; const s = String(pathStr).trim();
        if (s.startsWith('$.')) return pickPath(result, s.slice(2));
        if (s.startsWith('product.')) return pickPath(src, s.slice('product.'.length));
        if (s.startsWith('item.')) return pickPath(src, s.slice('item.'.length));
        if (s.startsWith('meta.')) return pickPath(result, s);
        let v = pickPath(src, s); if (v === undefined || v === null || v === '') v = pickPath(result, s); return v;
      };
      const sanitizeStr = (v) => { try { if (v === undefined || v === null) return ''; let s = String(v); s = s.trim(); const lc = s.toLowerCase(); if (lc === 'undefined' || lc === 'null' || lc === 'nan') return ''; return s; } catch { return ''; } };
      const applyTransforms = (val, transforms=[]) => {
        try {
          let out = val;
          for (const t of (Array.isArray(transforms)? transforms: [])) {
            const op = String(t?.op||'').toLowerCase();
            if (op === 'trim') { out = (out==null? '': String(out)).trim(); continue; }
            if (op === 'replace') {
              const find = String(t?.find||''); const rep = String(t?.replace||'');
              out = String(out==null? '': out).split(find).join(rep);
              continue;
            }
            if (op === 'strip_html') {
              try {
                const s = String(out==null? '': out);
                // naive HTML tag removal; safe enough for meta/short fields
                out = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
              } catch {}
              continue;
            }
            if (op === 'truncate') {
              const n = Number(t?.len||t?.n||t?.max||0) || 0;
              if (n > 0) {
                try { const s = String(out==null? '': out); out = s.length>n ? s.slice(0,n) : s; } catch {}
              }
              continue;
            }
            if (op === 'slugify') {
              try { const s = String(out==null? '': out); out = s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); } catch {}
              continue;
            }
          }
          return out;
        } catch { return val; }
      };
      const resolveSpec = (_obj, spec) => {
        if (spec == null) return undefined;
        // Array of specs: pick the first non-empty resolution
        if (Array.isArray(spec)) { for (const s of spec) { const v = resolveSpec(null, s); if (v !== undefined && v !== null && v !== '') return v; } return undefined; }
        if (typeof spec === 'object') {
          // Support constants: { const: "..." } or { value: "..." }
          if (Object.prototype.hasOwnProperty.call(spec, 'const') || Object.prototype.hasOwnProperty.call(spec, 'value')) {
            const base = Object.prototype.hasOwnProperty.call(spec, 'const') ? spec.const : spec.value;
            const out = applyTransforms(base, spec.transforms || spec.ops || []);
            return typeof out === 'string' ? sanitizeStr(out) : out;
          }
          const paths = Array.isArray(spec.paths) ? spec.paths : (spec.path ? [spec.path] : []);
          let v;
          for (const p of paths) { const tmp = pickFlex(p); if (tmp !== undefined && tmp !== null && tmp !== '') { v = tmp; break; } }
          if (v === undefined) v = pickFlex(spec.path || spec.p || '');
          const out = applyTransforms(v, spec.transforms || spec.ops || []);
          return typeof out === 'string' ? sanitizeStr(out) : out;
        }
        if (typeof spec === 'string') {
          // Constant forms:
          //  - "=literal" (e.g., "=100")
          //  - explicit empty: "" or "=\"\""
          const s = String(spec);
          if (s === '""' || s === "''") return '';
          if (s.startsWith('=')) {
            let v = s.slice(1);
            if (v === '""' || v === "''") v = '';
            return sanitizeStr(v);
          }
          if (s === '') { return ''; }
          const out = pickFlex(s);
          return typeof out === 'string' ? sanitizeStr(out) : out;
        }
        return spec;
      };
      const gwResolve = (obj, spec) => {
        try { return resolveSpec(obj, spec); } catch { return undefined; }
      };
      const firstDef = (...arr) => { for (const v of arr) { if (v !== undefined && v !== null && v !== '') return v; } return undefined; };
      const toNumber = (v) => { const n = Number(String(v||'').replace(/,/g,'.').replace(/[^0-9.\-]/g,'')); return Number.isFinite(n)? n: 0; };
      const toInt = (v) => { const n = parseInt(String(v||'').replace(/[^0-9\-]/g,''),10); return Number.isFinite(n)? n: 0; };

      const pickMappedGlobal = (spec, defVal, nonStrictFallback) => {
        const v = resolveSpec(null, spec);
        if (v !== undefined) return typeof v === 'string' ? v : v;
        if (defVal !== undefined) return String(defVal);
        if (!STRICT_MAPPING_ONLY && nonStrictFallback !== undefined) return nonStrictFallback;
        return '';
      };
      const val = {
        name: pickMappedGlobal(F_LANG ? F_LANG.name : (F_PRODUCT ? F_PRODUCT.name : undefined), DEF_PROD?.name, firstDef(resolveSpec(src, FIELDS.name), resolveSpec(src, ['title','name']), 'Imported Product')),
        description: pickMappedGlobal(F_LANG ? F_LANG.description : (F_PRODUCT ? F_PRODUCT.description : undefined), DEF_PROD?.description, firstDef(resolveSpec(src, FIELDS.description), resolveSpec(src, ['description','content']), '')),
        reference: String(pickMappedGlobal(F_PRODUCT ? F_PRODUCT.reference : undefined, DEF_PROD?.reference, firstDef(resolveSpec(src, FIELDS.reference), resolveSpec(src, ['sku','reference']), ''))),
        supplier_reference: String(pickMappedGlobal(F_PRODUCT ? F_PRODUCT.supplier_reference : undefined, DEF_PROD?.supplier_reference, firstDef(resolveSpec(src, FIELDS.supplier_reference), resolveSpec(src, ['supplier_reference','mpn']), ''))),
        price: toNumber(pickMappedGlobal(F_PRODUCT ? F_PRODUCT.price : undefined, DEF_PROD?.price, firstDef(resolveSpec(src, FIELDS.price), resolveSpec(src, ['price','price_without_tax','price_with_tax']), 0))),
        quantity: toInt(pickMappedGlobal(F_STOCK ? F_STOCK.quantity : undefined, undefined, firstDef(resolveSpec(src, FIELDS.quantity), resolveSpec(src, ['quantity','stock.quantity','qty']), 0))),
      };

      // Optional product identifiers resolved from mapping paths (fallback to empty string)
      const valIds = {
        ean13: sanitizeStr(pickMappedGlobal(F_PRODUCT ? F_PRODUCT.ean13 : undefined, DEF_PROD?.ean13, resolveSpec(src, FIELDS.ean13) ?? '')),
        upc: sanitizeStr(pickMappedGlobal(F_PRODUCT ? F_PRODUCT.upc : undefined, DEF_PROD?.upc, resolveSpec(src, FIELDS.upc) ?? '')),
        isbn: sanitizeStr(pickMappedGlobal(F_PRODUCT ? F_PRODUCT.isbn : undefined, DEF_PROD?.isbn, resolveSpec(src, FIELDS.isbn) ?? '')),
        mpn: sanitizeStr(pickMappedGlobal(F_PRODUCT ? F_PRODUCT.mpn : undefined, DEF_PROD?.mpn, resolveSpec(src, FIELDS.mpn) ?? '')),
      };

      // Detect tables
      const T_PRODUCT = PREFIX + 'product';
      const T_PRODUCT_LANG = PREFIX + 'product_lang';
      const T_PRODUCT_SHOP = PREFIX + 'product_shop';
      const T_STOCK = PREFIX + 'stock_available';
      const hasProduct = await hasTable(T_PRODUCT);
      const hasProductShop = await hasTable(T_PRODUCT_SHOP);
      const hasProductLang = await hasTable(T_PRODUCT_LANG);
      const productLangHasShop = hasProductLang ? await hasColumn(T_PRODUCT_LANG, 'id_shop') : false;

      if (!doWrite) {
        chatLog('dry_run_preview', { run_id: run.id, preview: { name: val.name, reference: val.reference, price: val.price, quantity: val.quantity }, checks: { has_product_table: hasProduct } });
        return res.json({ ok:true, mode:'dry_run', run: { id: run.id, url: run.url, page_type: run.page_type, version: run.version }, profile: { id: prof.id, name: prof.name }, checks: { connected: true, has_product_table: hasProduct }, preview: { ...val } });
      }

      // Hard gate: if resolved type is NOT product, do not run any product pipeline; run only generic writer then return
      if (type !== 'product') {
        try {
          const now = new Date();
          const pad = (n)=>String(n).padStart(2,'0');
          const nowFmt = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
          const src = result || {};
          const DEFAULTS = mapping?.defaults || {};
          const ID_SHOP_GROUP = (mapping.id_shop_group != null) ? Number(mapping.id_shop_group)||0 : 0;
          const SEND = (mapping && typeof mapping.send === 'object') ? mapping.send : {};
          // Enforce article/category → category tables only in generic writer
          let ALLOW_TABLES = null;
          if (type === 'article' || type === 'category') {
            ALLOW_TABLES = ['category','category_lang','category_shop','category_group'];
          }
          if (SEND.generic !== false) {
            await runGenericWriter({ q, qi, hasTable, pool, chatLog, PREFIX, TABLES, TSET_ANY, MFIELDS, DEFAULTS, MDEF, SHOPS, ID_LANG, ID_SHOP_GROUP, LANGS, GROUPS, productId: null, src, domain, run, cfgDatabase: cfg.database, fmtDateTime: (d)=>nowFmt, resolveSpec: gwResolve, ALLOW_TABLES });
          } else { chatLog('generic_skipped', { run_id: run.id, reason: 'send.generic=false' }); }
        } catch (e) {
          await logErr({ table_name: PREFIX+'*', op: 'generic', product_id: null, error: e });
          throw e;
        }
        try {
          await pool.query(
            `insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
            [ run.id, domain, run.page_type, 'transfer', 'done_generic', null, null, null, 'ok', JSON.stringify({ generic:true }) ]
          );
        } catch { try { chatLog('log_table_insert_failed', { stage: 'done_generic' }); } catch {} }
        const payload = { ok:true, mode:'upsert', product_id: null, generic: true };
        if (debug) payload.debug = { queries: executedQueries };
        return res.json(payload);
      }

      // Core upsert: find/insert product
      const now = new Date();
      const pad = (n)=>String(n).padStart(2,'0');
      const nowFmt = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const alwaysInsert = requestedMode === 'insert' || req.body?.always_insert === true;
      const FORCED_PRODUCT_ID = req.body?.product_id != null ? (Number(req.body.product_id)||0) : 0;
      let productId = 0;
      if (!alwaysInsert) {
        if (FORCED_PRODUCT_ID > 0) {
          const rows = await q(`SELECT ${'`id_product`'} FROM ${qi(T_PRODUCT)} WHERE ${qi('id_product')}=? LIMIT 1`, [FORCED_PRODUCT_ID]);
          if (rows && rows.length) productId = FORCED_PRODUCT_ID; else return res.status(404).json({ ok:false, error:'forced_product_not_found' });
        }
        if (!productId && val.reference) {
          const rows = await q(`SELECT ${qi('id_product')} FROM ${qi(T_PRODUCT)} WHERE ${qi('reference')}=? LIMIT 1`, [val.reference]);
          if (rows && rows.length) productId = Number(rows[0].id_product||0)||0;
        }
        if (!productId && val.name && hasProductLang) {
          const rows = await q(`SELECT p.${qi('id_product')} FROM ${qi(T_PRODUCT)} p JOIN ${qi(T_PRODUCT_LANG)} pl ON pl.${qi('id_product')}=p.${qi('id_product')} WHERE pl.${qi('id_lang')}=? AND pl.${qi('name')}=? LIMIT 1`, [ID_LANG, String(val.name)]);
          if (rows && rows.length) productId = Number(rows[0].id_product||0)||0;
        }
      }

      // Resolve tax rules group from mapping/settings/defaults
      const productTaxRulesGroup = Number((mapping.id_tax_rules_group ?? TSET_PRODUCT?.id_tax_rules_group ?? DEF_PROD.id_tax_rules_group ?? DEF_SHOP.id_tax_rules_group ?? 0)) || 0;
      const shopTaxRulesGroup = Number((mapping.id_tax_rules_group ?? TSET_SHOP?.id_tax_rules_group ?? TSET_PRODUCT?.id_tax_rules_group ?? DEF_SHOP.id_tax_rules_group ?? DEF_PROD.id_tax_rules_group ?? 0)) || 0;
      const ID_SHOP_DEFAULT_EFF = (mapping.id_shop_default != null)
        ? (Number(mapping.id_shop_default)||SHOPS[0])
        : ((TSET_PRODUCT?.id_shop_default != null)
            ? (Number(TSET_PRODUCT.id_shop_default)||SHOPS[0])
            : ((DEF_PROD?.id_shop_default != null)
                ? (Number(DEF_PROD.id_shop_default)||SHOPS[0])
                : SHOPS[0]));

      if (!productId) {
        // Insert product
        const prodDateAdd = (DEF_PROD.date_add != null) ? String(DEF_PROD.date_add) : nowFmt;
        const prodDateUpd = (DEF_PROD.date_upd != null) ? String(DEF_PROD.date_upd) : nowFmt;
        let cols = [ 'price','reference','active','id_shop_default','date_add','date_upd' ];
        let args = [ Number(val.price||0), sanitizeStr(val.reference||''), 1, ID_SHOP_DEFAULT_EFF, prodDateAdd, prodDateUpd ];
        if (await hasColumn(T_PRODUCT, 'id_tax_rules_group')) { cols.push('id_tax_rules_group'); args.push(productTaxRulesGroup); }
        // Apply identifiers from mapping paths if columns exist
        for (const key of ['ean13','upc','isbn','mpn']) {
          if (await hasColumn(T_PRODUCT, key)) { cols.push(key); args.push(valIds[key]); }
        }
        // supplier_reference if present
        if (await hasColumn(T_PRODUCT, 'supplier_reference')) { cols.push('supplier_reference'); args.push(sanitizeStr(val.supplier_reference||'')); }
        // Apply mapping.defaults.product into insert if columns exist
        for (const [k,v] of Object.entries(DEF_PROD)) {
          const key = String(k);
          if (['date_add','date_upd','id_tax_rules_group'].includes(key)) continue;
          if (cols.includes(key)) continue;
          if (await hasColumn(T_PRODUCT, key)) { cols.push(key); args.push(v); }
        }
        // Enforce truncation
        try { const rowTmp = Object.fromEntries(cols.map((c,i)=>[c, args[i]])); await enforceRowLimits(T_PRODUCT, rowTmp, { product_id: productId||null }); args = cols.map(c=>rowTmp[c]); } catch {}
        const sql = `INSERT INTO ${qi(T_PRODUCT)} (${cols.map(c=>qi(c)).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`;
        const rowP = Object.fromEntries(cols.map((c,i)=>[c, args[i]]));
        try { chatLog('sql_upsert', { table: T_PRODUCT, run_id: run.id, row: rowP }); } catch {}
        try {
          await q(sql, args);
        } catch (e) {
          try { await logErr({ table_name: T_PRODUCT, op: 'insert', product_id: productId||null, error: String(e?.message||e), payload: rowP }); } catch {}
          throw e;
        }
        const ir = await q('SELECT LAST_INSERT_ID() AS id');
        productId = Array.isArray(ir) && ir.length ? Number(ir[0].id||0) : 0;
      } else {
        // Update minimal product fields
        const sets = [];
        const setCols = [];
        let args = [];
        const add = (c,v)=>{ sets.push(qi(c)+'=?'); setCols.push(c); args.push(v); };
        add('price', Number(val.price||0));
        add('reference', sanitizeStr(val.reference||''));
        if (await hasColumn(T_PRODUCT, 'supplier_reference')) add('supplier_reference', sanitizeStr(val.supplier_reference||''));
        if (await hasColumn(T_PRODUCT, 'id_tax_rules_group')) add('id_tax_rules_group', productTaxRulesGroup);
        // Ensure id_shop_default is updated when provided via mapping/settings/defaults
        if (await hasColumn(T_PRODUCT, 'id_shop_default')) add('id_shop_default', ID_SHOP_DEFAULT_EFF);
        // Apply identifiers from mapping paths on update
        for (const key of ['ean13','upc','isbn','mpn']) {
          if (await hasColumn(T_PRODUCT, key)) add(key, valIds[key]);
        }
        add('date_upd', (DEF_PROD.date_upd != null) ? String(DEF_PROD.date_upd) : nowFmt);
        // Apply defaults for product on update when provided
        for (const [k,v] of Object.entries(DEF_PROD)) {
          const key = String(k);
          if (['date_add','date_upd'].includes(key)) continue;
          if (await hasColumn(T_PRODUCT, key)) add(key, v);
        }
        if (sets.length) {
          // Truncate per-column values when needed
          try {
            for (let i=0;i<setCols.length;i++) {
              const c = setCols[i]; const v = args[i];
              if (typeof v === 'string') {
                const max = await getColMaxLen(T_PRODUCT, c);
                if (max && v.length > max) {
                  const before = v;
                  args[i] = before.slice(0, max);
                  try { await logErr({ table_name: T_PRODUCT, op: 'truncate', product_id: productId||null, error: 'truncated', payload: { column: c, max_len: max, before_len: before.length, after_len: args[i].length } }); } catch {}
                }
              }
            }
          } catch {}
          try {
            await q(`UPDATE ${qi(T_PRODUCT)} SET ${sets.join(', ')} WHERE ${qi('id_product')}=?`, [...args, productId]);
          } catch (e) {
            try { await logErr({ table_name: T_PRODUCT, op: 'update', product_id: productId||null, error: String(e?.message||e), payload: { sets, id_product: productId } }); } catch {}
            throw e;
          }
        }
      }

      // product_shop per shop (prefer per-table settings from mapping.tables.product_shop.settings.id_shops)
      if (hasProductShop) {
        const TSET_MAP_SHOP = (TABLES.product_shop && typeof TABLES.product_shop.settings === 'object') ? TABLES.product_shop.settings : {};
        const SHOPS_FOR_PRODUCT_SHOP = (Array.isArray(TSET_MAP_SHOP?.id_shops) && TSET_MAP_SHOP.id_shops.length)
          ? TSET_MAP_SHOP.id_shops.map(n=>Number(n)||0).filter(n=>n>0)
          : SHOPS;
        for (const SID of SHOPS_FOR_PRODUCT_SHOP) {
          const cols = ['id_product','id_shop','active','id_category_default'];
          const args = [productId, SID, 1, (TSET_SHOP?.id_category_default != null) ? Number(TSET_SHOP.id_category_default) : (DEF_SHOP.id_category_default != null ? Number(DEF_SHOP.id_category_default) : null)];
          const shopDateAdd = (DEF_SHOP.date_add != null) ? String(DEF_SHOP.date_add) : nowFmt;
          const shopDateUpd = (DEF_SHOP.date_upd != null) ? String(DEF_SHOP.date_upd) : nowFmt;
          if (await hasColumn(T_PRODUCT_SHOP, 'date_add')) { cols.push('date_add'); args.push(shopDateAdd); }
          if (await hasColumn(T_PRODUCT_SHOP, 'date_upd')) { cols.push('date_upd'); args.push(shopDateUpd); }
          if (await hasColumn(T_PRODUCT_SHOP, 'id_tax_rules_group')) { cols.push('id_tax_rules_group'); args.push(shopTaxRulesGroup); }
          // Apply mapping.defaults.product_shop for any additional columns
          const applied = new Set(cols);
          for (const [k,v] of Object.entries(DEF_SHOP)) {
            const key = String(k);
            if (['date_add','date_upd','id_category_default','id_tax_rules_group'].includes(key)) continue;
            if (applied.has(key)) continue;
            if (await hasColumn(T_PRODUCT_SHOP, key)) { cols.push(key); args.push(v); applied.add(key); }
          }
          const set = [];
          for (const c of cols) {
            if (c === 'id_product' || c === 'id_shop') continue;
            set.push(qi(c)+'=VALUES('+qi(c)+')');
          }
          // Enforce truncation for string columns
          try { const tmp = Object.fromEntries(cols.map((c,i)=>[c, args[i]])); await enforceRowLimits(T_PRODUCT_SHOP, tmp, { product_id: productId, id_shop: SID }); args = cols.map(c=>tmp[c]); } catch {}
          const rowS = Object.fromEntries(cols.map((c,i)=>[c, args[i]]));
          try { chatLog('sql_upsert', { table: T_PRODUCT_SHOP, run_id: run.id, shop: SID, defaults: DEF_SHOP, row: rowS }); } catch {}
          try {
            await q(`INSERT INTO ${qi(T_PRODUCT_SHOP)} (${cols.map(c=>qi(c)).join(',')}) VALUES (${cols.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${set.join(', ')}`, args);
          } catch (e) {
            try { await logErr({ table_name: T_PRODUCT_SHOP, op: 'upsert', product_id: productId||null, id_shop: SID, error: String(e?.message||e), payload: rowS }); } catch {}
          }
        }
      }

      // product_lang (all active languages; per shop if column exists)
      if (hasProductLang) {
        const slugify = (s) => String(s||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'product';
        const DEF_LANG = (DEFAULTS.product_lang && typeof DEFAULTS.product_lang === 'object') ? DEFAULTS.product_lang : {};
        const langDateAdd = (DEF_LANG.date_add != null) ? String(DEF_LANG.date_add) : nowFmt;
        const langDateUpd = (DEF_LANG.date_upd != null) ? String(DEF_LANG.date_upd) : nowFmt;
        // Languages: always use all active ps_lang from target DB (no per‑table override)
        const TSET_MAP_LANG = (TABLES.product_lang && typeof TABLES.product_lang.settings === 'object') ? TABLES.product_lang.settings : {};
        const LANGS_EFF = [...LANGS];
        // Shops: enforce global Shop destinations for product_lang to avoid per‑table drift
        const SHOPS_FOR_PRODUCT_LANG = [...SHOPS];
        // Explicit logs to make scope crystal clear in production
        try { chatLog('product_lang_languages', { run_id: run.id, langs: LANGS_EFF }); } catch {}
        try { chatLog('product_lang_scope', { run_id: run.id, shops: SHOPS_FOR_PRODUCT_LANG, langs: LANGS_EFF }); } catch {}
        // When no per-table shops override is provided, SHOPS_FOR_PRODUCT_LANG will be the global SHOPS
        for (const LID of LANGS_EFF) {
          // Resolve language-specific values using mapping-first precedence:
          // 1) If mapping field is a constant (including empty), use it
          // 2) Else, if mapping.defaults has a value for the column, use it
          // 3) Else, use mapping field path(s) resolution
          // 4) If still undefined and not in strict mode, fallback to legacy heuristics; otherwise use ''
          const FL = F_LANG || {};
          const pickMapped = (spec, defVal, nonStrictFallback) => {
            const v = resolveSpec(null, spec);
            if (v !== undefined) return typeof v === 'string' ? v : v;
            if (defVal !== undefined) return String(defVal);
            if (!STRICT_MAPPING_ONLY && nonStrictFallback !== undefined) return String(nonStrictFallback);
            return '';
          };
          const nameEff = String(pickMapped(FL.name, DEF_LANG.name, firstDef(val.name, resolveSpec(src, ['title','name']), 'Imported Product')));
          const descEff = String(pickMapped(FL.description, DEF_LANG.description, firstDef(val.description, resolveSpec(src, ['product.description_html','product.description','meta.description']), '')));
          const descShortEff = String(pickMapped(FL.description_short, DEF_LANG.description_short, firstDef(resolveSpec(src, ['product.description_short','meta.description']), '')));
          const metaTitleEff = String(pickMapped(FL.meta_title, DEF_LANG.meta_title, ''));
          const metaDescEff = String(pickMapped(FL.meta_description, DEF_LANG.meta_description, ''));

          const baseCols = ['id_product','id_lang','name'];
          let baseArgs = [productId, LID, nameEff];
          const baseSet = ['`name`=VALUES(`name`)'];
          if (await hasColumn(T_PRODUCT_LANG, 'link_rewrite')) { baseCols.push('link_rewrite'); baseArgs.push(slugify(nameEff)); baseSet.push('`link_rewrite`=VALUES(`link_rewrite`)'); }
          if (await hasColumn(T_PRODUCT_LANG, 'description')) { baseCols.push('description'); baseArgs.push(descEff); baseSet.push('`description`=VALUES(`description`)'); }
          if (await hasColumn(T_PRODUCT_LANG, 'description_short')) { baseCols.push('description_short'); baseArgs.push(descShortEff); baseSet.push('`description_short`=VALUES(`description_short`)'); }
          if (await hasColumn(T_PRODUCT_LANG, 'meta_title')) { baseCols.push('meta_title'); baseArgs.push(metaTitleEff); baseSet.push('`meta_title`=VALUES(`meta_title`)'); }
          if (await hasColumn(T_PRODUCT_LANG, 'meta_description')) { baseCols.push('meta_description'); baseArgs.push(metaDescEff); baseSet.push('`meta_description`=VALUES(`meta_description`)'); }
          if (await hasColumn(T_PRODUCT_LANG, 'date_add')) { baseCols.push('date_add'); baseArgs.push(langDateAdd); }
          if (await hasColumn(T_PRODUCT_LANG, 'date_upd')) { baseCols.push('date_upd'); baseArgs.push(langDateUpd); baseSet.push('`date_upd`=VALUES(`date_upd`)'); }
          // Truncate base row
          try { const tmp = Object.fromEntries(baseCols.map((c,i)=>[c, baseArgs[i]])); await enforceRowLimits(T_PRODUCT_LANG, tmp, { product_id: productId, id_lang: LID }); baseArgs = baseCols.map(c=>tmp[c]); } catch {}
          if (productLangHasShop) {
            for (const SID of SHOPS_FOR_PRODUCT_LANG) {
              const cols = baseCols.includes('id_shop') ? [...baseCols] : [...baseCols, 'id_shop'];
              let args = baseCols.includes('id_shop') ? [...baseArgs] : [...baseArgs, SID];
              try { const tmp = Object.fromEntries(cols.map((c,i)=>[c, args[i]])); await enforceRowLimits(T_PRODUCT_LANG, tmp, { product_id: productId, id_shop: SID, id_lang: LID }); args = cols.map(c=>tmp[c]); } catch {}
              const set = baseSet.includes('`id_shop`=VALUES(`id_shop`)') ? [...baseSet] : [...baseSet, '`id_shop`=VALUES(`id_shop`)'];
              const rowL = Object.fromEntries(cols.map((c,i)=>[c, args[i]]));
              try { chatLog('sql_upsert', { table: T_PRODUCT_LANG, run_id: run.id, id_product: productId, shop: SID, lang: LID, row: { ...rowL, description_len: String(val.description||'').length, description_short_len: String(val.description||'').length } }); } catch {}
              try {
                await q(`INSERT INTO ${qi(T_PRODUCT_LANG)} (${cols.map(c=>qi(c)).join(',')}) VALUES (${cols.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${set.join(', ')}`, args);
              } catch (e) {
                try { await logErr({ table_name: T_PRODUCT_LANG, op: 'upsert', product_id: productId||null, id_shop: SID, id_lang: LID, error: String(e?.message||e), payload: rowL }); } catch {}
              }
            }
          } else {
            const rowL = Object.fromEntries(baseCols.map((c,i)=>[c, baseArgs[i]]));
            try { chatLog('sql_upsert', { table: T_PRODUCT_LANG, run_id: run.id, id_product: productId, lang: LID, row: { ...rowL, description_len: String(val.description||'').length, description_short_len: String(val.description||'').length } }); } catch {}
            try {
              await q(`INSERT INTO ${qi(T_PRODUCT_LANG)} (${baseCols.map(c=>qi(c)).join(',')}) VALUES (${baseCols.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${baseSet.join(', ')}`, baseArgs);
            } catch (e) {
              try { await logErr({ table_name: T_PRODUCT_LANG, op: 'upsert', product_id: productId||null, id_lang: LID, error: String(e?.message||e), payload: rowL }); } catch {}
            }
          }
        }
      }

      // stock_available basic
      if (await hasTable(T_STOCK)) {
        for (const SID of SHOPS) {
          const cols = ['id_product','id_product_attribute','id_shop','id_shop_group','quantity'];
          const args = [productId, 0, SID, ID_SHOP_GROUP, Number(val.quantity||0)];
          const set = ['`quantity`=VALUES(`quantity`)'];
          const rowSt = Object.fromEntries(cols.map((c,i)=>[c, args[i]]));
          try { chatLog('sql_upsert', { table: T_STOCK, run_id: run.id, id_product: productId, shop: SID, row: rowSt }); } catch {}
          try {
            await q(`INSERT INTO ${qi(T_STOCK)} (${cols.map(c=>qi(c)).join(',')}) VALUES (${cols.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${set.join(', ')}`, args);
          } catch (e) {
            try { await logErr({ table_name: T_STOCK, op: 'upsert', product_id: productId||null, id_shop: SID, error: String(e?.message||e), payload: rowSt }); } catch {}
          }
        }
      }

      // Persist product_id on the run record
      try { await pool.query(`update public.mod_grabbing_jerome_extraction_runs set product_id=$2, updated_at=now() where id=$1`, [run.id, productId||null]); } catch {}

      // Images pipeline (product-only)
      try {
        const SEND = (mapping && typeof mapping.send === 'object') ? mapping.send : {};
        if (type === 'product' && SEND.images !== false) {
          await runImagesPipeline({ q, qi, hasTable, hasColumn, pool, chatLog, run, result, domain, productId, PREFIX, TSET_LANG, TSET_ANY, TABLES, SHOPS, ID_LANG, fmtDateTime: (d)=>nowFmt, ensureImageMapTable });
        } else { chatLog('images_skipped', { run_id: run.id }); }
      } catch (e) {
        await logErr({ table_name: PREFIX+'image', op: 'pipeline', product_id: productId, error: e });
      }

      // Documents/Attachments pipeline (product-only)
      try {
        const SEND = (mapping && typeof mapping.send === 'object') ? mapping.send : {};
        if (type === 'product' && SEND.documents !== false) {
          await runDocumentsPipeline({ q, qi, hasTable, hasColumn, chatLog, pool, run, result, productId, PREFIX, TSET_ANY, TABLES, SHOPS, ID_LANG, fmtDateTime: (d)=>nowFmt, domain });
        } else { chatLog('documents_skipped', { run_id: run.id }); }
      } catch (e) {
        await logErr({ table_name: PREFIX+'attachment', op: 'pipeline', product_id: productId, error: e });
      }

      // Attributes/Combinations (product-only)
      const DEF_ATTR = (DEFAULTS.product_attribute && typeof DEFAULTS.product_attribute === 'object') ? DEFAULTS.product_attribute : {};
      const DEF_ATTR_SHOP = (DEFAULTS.product_attribute_shop && typeof DEFAULTS.product_attribute_shop === 'object') ? DEFAULTS.product_attribute_shop : {};
      try {
        const SEND = (mapping && typeof mapping.send === 'object') ? mapping.send : {};
        if (type === 'product' && SEND.attributes !== false) {
          await runAttributesWriter({ q, qi, hasTable, hasColumn, pool, chatLog, PREFIX, productId, SHOPS, ID_LANG, ID_SHOP_GROUP, mapping, result, DEF_ATTR, DEF_ATTR_SHOP, run, domain });
        } else { chatLog('attributes_skipped', { run_id: run.id }); }
      } catch (e) {
        await logErr({ table_name: PREFIX+'product_attribute', op: 'pipeline', product_id: productId, error: e });
      }

      // Features mapping (product-only)
      try {
        const SEND = (mapping && typeof mapping.send === 'object') ? mapping.send : {};
        if (type === 'product' && SEND.features !== false) {
          await runFeaturesWriter({ q, qi, hasTable, pool, chatLog, PREFIX, productId, SHOPS, ID_LANG, TABLES, result, run, domain });
        } else { chatLog('features_skipped', { run_id: run.id }); }
      } catch (e) {
        await logErr({ table_name: PREFIX+'feature', op: 'pipeline', product_id: productId, error: e });
      }

      // Generic writer
      {
        const SEND = (mapping && typeof mapping.send === 'object') ? mapping.send : {};
        if (SEND.generic !== false) {
          await runGenericWriter({ q, qi, hasTable, pool, chatLog, PREFIX, TABLES, TSET_ANY, MFIELDS, DEFAULTS: (mapping?.defaults||{}), MDEF, SHOPS, ID_LANG, ID_SHOP_GROUP, LANGS, GROUPS, productId, src, domain, run, cfgDatabase: cfg.database, fmtDateTime: (d)=>nowFmt, resolveSpec: gwResolve });
        } else { chatLog('generic_skipped', { run_id: run.id }); }
      }

      chatLog('upsert_done', { run_id: run.id, product_id: productId });
      try {
        await pool.query(
          `insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
          [ run.id, domain, run.page_type, 'transfer', 'done', productId||null, null, null, 'ok', JSON.stringify({ product_id: productId||null }) ]
        );
      } catch { try { chatLog('log_table_insert_failed', { stage: 'done' }); } catch {} }
      // persist mapping version/config + transfer summary onto the run (best-effort)
      try {
        const summary = { mode: 'upsert', product_id: productId, values: { ...val } };
        await pool.query(`update public.mod_grabbing_jerome_extraction_runs set product_id=$2, mapping_version=$3, mapping=$4::jsonb, transfer=$5::jsonb, updated_at=now() where id=$1`, [run.id, productId||null, mappingVersion, JSON.stringify(mapping||{}), JSON.stringify(summary)]);
      } catch {}
      const payload = { ok:true, mode:'upsert', product_id: productId, values: { ...val } };
      if (debug) payload.debug = { queries: executedQueries };
      return res.json(payload);
    } catch (e) {
      await (async () => { try { await logErr({ table_name: 'connect', op: 'connect_mysql', error: e }); } catch {} })();
      return res.status(500).json({ ok:false, error:'connect_failed', message: e?.message || String(e) });
    } finally {
      try { if (conn) await conn.end(); } catch {}
    }
  } catch (e) {
    try {
      const runId = Number(req.body?.run_id || req.body?.id || 0) || 0;
      // best-effort: log without run context if loading run failed
      await utils?.pool?.query(
        `insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [ runId || null, null, null, 'transfer', 'service', null, null, null, String(e?.message||e), JSON.stringify({}) ]
      );
    } catch {}
    try { chatLog('transfer_error', { run_id: Number(req.body?.run_id||0)||0, error: String(e?.message||e) }); } catch {}
    return res.status(500).json({ ok:false, error:'transfer_failed', message: e?.message || String(e) });
  }
}

export const handleSendToPresta = sendToPresta;
