// Generic writer for additional tables declared in mapping.tables or DB Smart Settings
// Extracted from legacy handler to keep the service lean and composable.

export async function runGenericWriter(ctx = {}) {
  const {
    // DB helpers
    q, qi, hasTable,
    // Logging + environment
    pool, chatLog,
    // Context
    PREFIX = 'ps_', TABLES = {}, TSET_ANY = {}, MFIELDS = {}, DEFAULTS = {}, MDEF = {},
    SHOPS = [], ID_LANG = 1, ID_SHOP_GROUP = 0,
    ID_SHOP_DEFAULT = null,
    LANGS = [],
    productId = null, src = {}, domain = '', run = {},
    cfgDatabase = '', fmtDateTime = (d)=>d?.toISOString?.() || '',
    // Resolve from mapping spec to value
    resolveSpec = () => undefined,
    // Optional allow-list of table base names to process (e.g., ['category','category_lang',...])
    ALLOW_TABLES = null,
    // Optional groups list for tables having id_group (e.g., category_group)
    GROUPS = [],
    strictMappingOnly = false,
    includeHandled = false,
    autoInsertIfMissingPk = false,
    // Optional full mapping (for defaults like id_tax_rules_group when missing)
    mapping = {},
  } = ctx;

  // Track auto-increment IDs captured during inserts (product/category, etc.)
  let lastIds = {};

  try {
    // small local slugify for category link_rewrite fallback
    const slugify = (s='') => {
      try {
        return String(s||'')
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g,'')
          .replace(/[^a-zA-Z0-9]+/g,'-')
          .replace(/^-+|-+$/g,'')
          .toLowerCase() || 'imported-category';
      } catch { return 'imported-category'; }
    };
    const isNA = (v) => { try { const s=String(v||'').trim().toLowerCase(); return s==='n/a' || s==='na' || s==='n.a' || s==='n - a'; } catch { return false; } };
    // Helpers: column length enforcement for generic tables
    const __lenCache = new Map();
    const getColMaxLen = async (table, column) => {
      try {
        const key = String(table)+'|'+String(column);
        if (__lenCache.has(key)) return __lenCache.get(key);
        const rows = await q('SELECT CHARACTER_MAXIMUM_LENGTH as max_len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1', [cfgDatabase, table, column]);
        const n = Array.isArray(rows) && rows.length ? (Number(rows[0].max_len||0)||0) : 0;
        __lenCache.set(key, n);
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
              await pool.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
                [ctx?.run?.id||null, ctx?.domain||null, ctx?.run?.page_type||null, T, 'truncate', ctxInfo.product_id||null, ctxInfo.id_shop||null, ctxInfo.id_lang||null, 'truncated', JSON.stringify({ column: col, max_len: max, before_len: before.length, after_len: row[col].length })]
              );
            } catch {}
            try { chatLog?.('truncate', { table: T, col, max, before_len: before.length, after_len: row[col].length, product_id: ctxInfo.product_id||null, id_shop: ctxInfo.id_shop||null, id_lang: ctxInfo.id_lang||null }); } catch {}
          }
        }
      } catch {}
      return row;
    };
    // Column type helpers (for safe coercion of empty strings on numeric/date types)
    const __typeCache = new Map();
    const getColType = async (table, column) => {
      try {
        const key = String(table)+'|'+String(column);
        if (__typeCache.has(key)) return __typeCache.get(key);
        const rows = await q('SELECT DATA_TYPE, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1', [cfgDatabase, table, column]);
        const info = Array.isArray(rows) && rows.length ? { data_type: String(rows[0].DATA_TYPE||rows[0].data_type||'').toLowerCase(), column_type: String(rows[0].COLUMN_TYPE||rows[0].column_type||''), is_nullable: String(rows[0].IS_NULLABLE||rows[0].is_nullable||'').toUpperCase()==='YES' } : { data_type: '', column_type: '', is_nullable: false };
        __typeCache.set(key, info);
        return info;
      } catch { return { data_type: '', column_type: '', is_nullable: false }; }
    };
    const normalizeRowTypes = async (table, row) => {
      try {
        const T = String(table);
        for (const [col, val] of Object.entries(row)) {
          if (val !== '') continue;
          const t = await getColType(T, col);
          const dt = String(t.data_type||'');
          const isNumeric = /^(?:int|integer|bigint|smallint|tinyint|decimal|numeric|double|float|real|mediumint)$/i.test(dt);
          const isDate = /^(?:date|datetime|timestamp|time|year)$/i.test(dt);
          if (isNumeric) row[col] = 0; else if (isDate) row[col] = null; else row[col] = '';
        }
      } catch {}
      return row;
    };
    const handled = new Set(['product','product_shop','product_lang','stock_available','product_attribute','product_attribute_shop','product_attribute_combination']);
    // derive all table names from mapping JSON and DB Smart Settings
    const allNames = new Set();
    try { for (const k of Object.keys(TABLES||{})) allNames.add(String(k)); } catch {}
    try { for (const k of Object.keys(TSET_ANY||{})) allNames.add(String(k)); } catch {}
    try { for (const k of Object.keys(MFIELDS||{})) allNames.add(String(k)); } catch {}

    // Compute allow-list filter when provided
    let allowSet = null;
    try {
      if (Array.isArray(ALLOW_TABLES)) allowSet = new Set(ALLOW_TABLES.map(s=>String(s)));
      else if (ALLOW_TABLES && typeof ALLOW_TABLES === 'object' && typeof ALLOW_TABLES.has === 'function') allowSet = ALLOW_TABLES;
    } catch {}
    // Ensure allow-list tables are included in the candidate set even if mapping/settings are missing
    try { if (allowSet) { for (const n of allowSet) allNames.add(String(n)); } } catch {}

    // Emit which generic tables are being considered + filtered list
    let namesAllowed = [];
    try {
      const namesAll = Array.from(allNames);
      namesAllowed = allowSet ? namesAll.filter(n => allowSet.has(String(n))) : namesAll;
      chatLog?.('generic_tables', { names: namesAll, allowed: namesAllowed });
    } catch {}

    // Plan log: record intended tables for this run (one row per table/op=plan)
    try {
      for (const tName of namesAllowed) {
        const T = PREFIX + tName;
        try {
          if (!(await hasTable(T))) {
            // Log missing-table so runs can diagnose why nothing appeared later
            try {
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
                [ run?.id||null, domain||null, run?.page_type||null, T, 'plan', null, null, null, 'missing_table', JSON.stringify({}) ]
              );
            } catch {}
            continue;
          }
          await pool?.query(
            `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
             values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
             on conflict (run_id, table_name, op, id_shop, id_lang)
             do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
            [ run?.id||null, domain||null, run?.page_type||null, T, 'plan', null, null, null, JSON.stringify({}) ]
          );
        } catch {}
      }
    } catch {}

    // cache table columns to reduce information_schema queries
    const tableColsCache = new Map();
    const getTableCols = async (tableName) => {
      if (tableColsCache.has(tableName)) return tableColsCache.get(tableName);
      try {
        const rows = await q('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [cfgDatabase, tableName]);
        const cols = new Set(Array.isArray(rows) ? rows.map(r => String(r.COLUMN_NAME)) : []);
        tableColsCache.set(tableName, cols);
        return cols;
      } catch {
        const s = new Set(); tableColsCache.set(tableName, s); return s;
      }
    };

    // helper to get primary key columns
    const getPkCols = async (tableName) => {
      try {
        const rows = await q('SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME = "PRIMARY" ORDER BY ORDINAL_POSITION', [cfgDatabase, tableName]);
        return Array.isArray(rows) ? rows.map(r => String(r.COLUMN_NAME)) : [];
      } catch { return []; }
    };

    const now = new Date();
    const nowFmt = fmtDateTime(now);

    let namesSorted = Array.from(allNames);
    if (allowSet) namesSorted = namesSorted.filter(n => allowSet.has(String(n)));
    // Ensure base product first, then category before its satellites
    namesSorted.sort((a,b) => {
      const rank = (n) => (n==='product' ? 0 : (n==='category' ? 1 : 2));
      return rank(a) - rank(b);
    });
    const previewLoggedOnce = new Set();
    for (const tName of namesSorted) {
      if (!includeHandled && handled.has(tName)) continue;
      const T = PREFIX + tName;
      if (!(await hasTable(T))) {
        try { chatLog?.('gw_missing_table', { table: T }); } catch {}
        try {
          await pool?.query(
            `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
            [ run?.id||null, domain||null, run?.page_type||null, T, 'skip', null, null, null, 'missing_table', JSON.stringify({}) ]
          );
        } catch {}
        continue;
      }
      const fieldsFromMap = (TABLES[tName] && typeof TABLES[tName].fields === 'object') ? TABLES[tName].fields : {};
      const fieldsFromDb = MFIELDS[tName] || {};
      const F_T = strictMappingOnly ? fieldsFromMap : { ...fieldsFromMap, ...fieldsFromDb };
      const setFromMap = (TABLES[tName] && typeof TABLES[tName].settings === 'object') ? TABLES[tName].settings : {};
      const setFromDb = TSET_ANY[tName] || {};
      const TSET = strictMappingOnly ? setFromMap : { ...setFromMap, ...setFromDb };
      // Strict mapping only: no defaults layer
      const DEF_MERGED = {};
      const colsSet = await getTableCols(T);
      try { chatLog?.('gw_schema_cols', { table: T, columns: Array.from(colsSet) }); } catch {}
      // resolve expansions based on id_shop/id_lang/id_group arrays
      // Per-table overrides via TSET.id_shops / TSET.id_langs take precedence when provided
      let shopsList = colsSet.has('id_shop')
        ? ((Array.isArray(TSET?.id_shops) && TSET.id_shops.length) ? TSET.id_shops : SHOPS)
        : [null];
      if (strictMappingOnly && colsSet.has('id_shop') && (!Array.isArray(shopsList) || shopsList.length === 0)) {
        try { chatLog?.('gw_missing_shops_for_table', { table: T, run_id: run?.id||null }); } catch {}
        try { await pool?.query(`insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [ run?.id||null, domain||null, run?.page_type||null, T, 'skip', null, null, null, 'mapping_missing_shops_table', JSON.stringify({}) ]); } catch {}
        continue; // skip this table entirely when mapping did not provide shops
      }
      if (!strictMappingOnly) {
        // Ensure base/default shop row exists for key tables even if mapping filtered shops out
        try {
          if (colsSet.has('id_shop')) {
            const wantDefault = (ID_SHOP_DEFAULT != null) ? Number(ID_SHOP_DEFAULT)||0 : 0;
            if (wantDefault && Array.isArray(shopsList)) {
              const needFor = (tName === 'product_shop' || tName === 'product_lang');
              if (needFor && !shopsList.some(s => Number(s) === wantDefault)) shopsList = [...shopsList, wantDefault];
            }
          }
        } catch {}
      }

      const langsList = colsSet.has('id_lang')
        ? ((Array.isArray(TSET?.id_langs) && TSET.id_langs.length) ? TSET.id_langs : ((Array.isArray(LANGS) && LANGS.length) ? LANGS : (strictMappingOnly ? [] : [ID_LANG])))
        : [null];
      const groupsList = colsSet.has('id_group') ? ((Array.isArray(TSET?.id_groups) && TSET.id_groups.length) ? TSET.id_groups : (Array.isArray(GROUPS)&&GROUPS.length? GROUPS : (strictMappingOnly ? [] : []))) : [null];
      if (strictMappingOnly && colsSet.has('id_group') && (!Array.isArray(groupsList) || groupsList.length === 0)) {
        try { chatLog?.('gw_missing_groups_for_table', { table: T, run_id: run?.id||null }); } catch {}
        try { await pool?.query(`insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [ run?.id||null, domain||null, run?.page_type||null, T, 'skip', null, null, null, 'mapping_missing_groups_table', JSON.stringify({}) ]); } catch {}
        continue;
      }
      const pkColsDb = await getPkCols(T);
      const pkCols = Array.isArray(TSET.keys) && TSET.keys.length ? TSET.keys.map(k=>String(k)) : pkColsDb;
      try { chatLog?.('gw_pk', { table: T, pk: pkCols }); } catch {}

      for (const SID of shopsList) {
        for (const LID of langsList) {
          for (const GID of groupsList) {
          const row = {};
          const defaultCols = new Set();
          const mappedCols = new Set();
          const forcedEmptyCols = new Set();
          // defaults layer removed (strict mapping only)
          try {
            const effType = String(ctx?.effectiveType || run?.page_type || '').toLowerCase();
            const isCategoryMode = (effType === 'article' || effType === 'category');
            if (isCategoryMode && tName === 'category') {
              if (colsSet.has('active') && row['active'] == null) row['active'] = 1;
              if (colsSet.has('position') && row['position'] == null) row['position'] = 0;
              if (colsSet.has('id_parent') && row['id_parent'] == null) row['id_parent'] = 2;
              if (colsSet.has('id_shop_default') && row['id_shop_default'] == null) row['id_shop_default'] = Array.isArray(SHOPS) && SHOPS.length ? SHOPS[0] : 1;
            }
          } catch {}
          // mapping fields
          const allowEmpty = true;
          const isPathSpec = (spec) => {
            if (spec == null) return false;
            if (Array.isArray(spec)) return true; // array of paths/specs
            if (typeof spec === 'string') { return !(spec === '' || spec.startsWith('=')); }
            if (typeof spec === 'object') {
              if (Object.prototype.hasOwnProperty.call(spec,'const') || Object.prototype.hasOwnProperty.call(spec,'value')) return false;
              return !!(spec.path || (Array.isArray(spec.paths) && spec.paths.length));
            }
            return false;
          };
          const isConstSpec = (spec) => {
            if (spec == null) return false;
            if (typeof spec === 'string') return (spec === '' || spec.startsWith('='));
            if (typeof spec === 'object') return (Object.prototype.hasOwnProperty.call(spec,'const') || Object.prototype.hasOwnProperty.call(spec,'value'));
            return false;
          };
          for (const [col, spec] of Object.entries(F_T)) {
            if (!colsSet.has(col)) continue;
            // If a default exists for this column (or forced empty), skip any mapping spec (path or constant)
            if (defaultCols.has(String(col)) || forcedEmptyCols.has(String(col))) continue;
            const v = resolveSpec(src, spec);
            if (v !== undefined && v !== null) {
              if (v === '' && !allowEmpty) {
                // Skip empty when not allowed — keeps existing DB value/default
              } else {
                row[col] = v;
                mappedCols.add(String(col));
              }
            }
          }
          // Sanitize foreign keys set to explicit empty string in mapping so we can backfill ids
          try {
            if (colsSet.has('id_product') && row['id_product'] === '') delete row['id_product'];
            if (colsSet.has('id_product_attribute') && row['id_product_attribute'] === '') delete row['id_product_attribute'];
          } catch {}
          // fixed settings values (except helper arrays/keys)
          for (const [k,v] of Object.entries(TSET)) {
            if (k === 'id_shops' || k === 'id_langs' || k === 'keys') continue;
            if (!colsSet.has(k)) continue; row[k] = v;
          }
          // sanitize common identifiers
          try { if (colsSet.has('reference') && isNA(row['reference'])) row['reference'] = ''; } catch {}
          try { if (colsSet.has('supplier_reference') && isNA(row['supplier_reference'])) row['supplier_reference'] = ''; } catch {}
          // product-level fallback: supplier_reference from sku when not provided/empty
          try {
            if (tName === 'product' && colsSet.has('supplier_reference') && (row['supplier_reference'] == null || row['supplier_reference'] === '')) {
              const sku = String((src && (src.product?.sku ?? src.sku)) || '').trim();
              row['supplier_reference'] = isNA(sku) ? '' : sku;
            }
          } catch {}
          // ensure ids
          if (colsSet.has('id_product') && (row['id_product'] == null || row['id_product'] === '')) row['id_product'] = productId || lastIds['product'] || lastIds['product_id'] || null;
          // Ensure id_category is carried into satellites when available from the last inserted category
          if (tName !== 'category' && colsSet.has('id_category')) {
            if (row['id_category'] == null || row['id_category'] === '' || Number(row['id_category']) === 0) {
              if (lastIds['category']) row['id_category'] = lastIds['category'];
            }
          }
          if (colsSet.has('id_product_attribute') && (row['id_product_attribute'] == null || row['id_product_attribute'] === '')) row['id_product_attribute'] = lastIds['product_attribute'] || 0;
          if (colsSet.has('id_shop') && SID != null) row['id_shop'] = SID;
          if (colsSet.has('id_lang') && LID != null) row['id_lang'] = LID;
          if (colsSet.has('id_group') && GID != null) row['id_group'] = GID;
          if (colsSet.has('id_shop_group') && row['id_shop_group'] == null) row['id_shop_group'] = ID_SHOP_GROUP || 0;
          if (colsSet.has('date_add') && row['date_add'] == null) row['date_add'] = nowFmt;
          if (colsSet.has('date_upd') && row['date_upd'] == null) row['date_upd'] = nowFmt;
          if (!strictMappingOnly) {
            // Category base table: default id_shop_default to the first selected shop when missing or invalid
            try {
              if (tName === 'category' && colsSet.has('id_shop_default')) {
                const cur = row['id_shop_default'];
                const shopsSet = new Set(Array.isArray(SHOPS) ? SHOPS.map(n=>Number(n)||0) : []);
                const curNum = Number(cur)||0;
                if (cur == null || cur === '' || curNum === 0 || (shopsSet.size && !shopsSet.has(curNum))) {
                  const v = (Array.isArray(SHOPS) && SHOPS.length) ? (Number(SHOPS[0]) || 0) : 0;
                  row['id_shop_default'] = v;
                }
              }
            } catch {}
          }
          // Product table: guard NOT NULL defaults if schema requires them and mapping/settings were empty
          try {
            if (tName === 'product') {
              const TSET_PROD = (TSET_ANY && TSET_ANY['product']) || {};
              if (colsSet.has('active') && (row['active'] == null || row['active'] === '')) row['active'] = 1;
              if (colsSet.has('id_tax_rules_group') && (row['id_tax_rules_group'] == null || row['id_tax_rules_group'] === '')) {
                const v = Number((mapping?.id_tax_rules_group ?? TSET_PROD?.id_tax_rules_group ?? 0)) || 0;
                row['id_tax_rules_group'] = v;
              }
              if (colsSet.has('id_category_default') && (row['id_category_default'] == null || row['id_category_default'] === '')) {
                const v = Number((mapping?.id_category_default ?? TSET_PROD?.id_category_default ?? 0)) || 0;
                row['id_category_default'] = v;
              }
              if (colsSet.has('id_shop_default') && (row['id_shop_default'] == null || row['id_shop_default'] === '')) {
                const v = (mapping?.id_shop_default != null) ? (Number(mapping.id_shop_default)||0) : ((Array.isArray(SHOPS)&&SHOPS.length)? (Number(SHOPS[0])||0) : 0);
                row['id_shop_default'] = v;
              }
            }
          } catch {}
          // backfill id_category from last inserted category if present
          if (tName !== 'category' && colsSet.has('id_category') && row['id_category'] == null && lastIds['category']) row['id_category'] = lastIds['category'];
          if (tName !== 'product' && colsSet.has('id_product') && (row['id_product'] == null || row['id_product'] === '') && (lastIds['product'] || lastIds['product_id'])) row['id_product'] = lastIds['product'] || lastIds['product_id'];

          // Fallbacks for satellites: provide minimal required fields
          try {
            const effType = String(ctx?.effectiveType || run?.page_type || '').toLowerCase();
            const isCategoryMode = (effType === 'article' || effType === 'category');
            if (isCategoryMode && tName === 'category_lang') {
              // Prefer extraction title when available; otherwise fall back to a generic name
              const title = (()=>{ try { return String(src?.title || src?.product?.name || src?.product_lang?.name || ''); } catch { return ''; } })();
              if (colsSet.has('name') && (row['name'] == null || row['name'] === '')) row['name'] = title || 'Imported Category';
              if (colsSet.has('link_rewrite') && (row['link_rewrite'] == null || row['link_rewrite'] === '')) row['link_rewrite'] = slugify(row['name']||title||'Imported Category');
            }
          } catch {}
          // Always enforce slug on link_rewrite if present or derivable
          try {
            if (colsSet.has('link_rewrite')) {
              const base = (row['link_rewrite'] != null && row['link_rewrite'] !== '') ? String(row['link_rewrite']) : String(row['name']||'');
              if (base) row['link_rewrite'] = slugify(base);
            }
          } catch {}

          // Emit a one-off row preview per table to show what will be sent
          if (!previewLoggedOnce.has(T)) {
            try { chatLog?.('gw_row_preview', { table: T, id_shop: SID, id_lang: LID, id_group: GID, row: Object.fromEntries(Object.entries(row).slice(0, 24)) }); } catch {}
            previewLoggedOnce.add(T);
          }

          // Normalize suspicious FK values that break PK logic
          try {
            if (typeof row['id_image'] !== 'undefined' && (row['id_image'] === '' || row['id_image'] === 0)) delete row['id_image'];
            if (typeof row['id_product'] !== 'undefined' && (row['id_product'] === '' || row['id_product'] === 0)) row['id_product'] = productId || lastIds['product'] || lastIds['product_id'] || null;
            if (typeof row['id_category'] !== 'undefined' && (row['id_category'] === '' || row['id_category'] === 0)) row['id_category'] = lastIds['category'] || row['id_category'];
            if (typeof row['id_product_attribute'] !== 'undefined' && (row['id_product_attribute'] === '' || row['id_product_attribute'] === 0)) delete row['id_product_attribute'];
          } catch {}
          // Validate PK presence
          let missingPk = false;
          if (pkCols.length) { for (const pk of pkCols) { if (row[pk] == null) { missingPk = true; break; } } }
          if (missingPk) {
            // Allow auto-increment PK insert for base tables (product/category) or when explicitly enabled
            if ((tName === 'category' && pkCols.length === 1 && pkCols[0] === 'id_category') || (tName === 'product' && pkCols.length === 1 && pkCols[0] === 'id_product') || (autoInsertIfMissingPk && pkCols.length === 1)) {
              try {
                // remove PK from insert set if present
                const pk = pkCols[0];
                const colsAll = Object.keys(row).filter(c => colsSet.has(c) && c !== pk);
                try { chatLog?.('gw_insert_auto_attempt', { table: T, columns: colsAll }); } catch {}
                if (colsAll.length) {
                  const argsAll = colsAll.map(c => row[c]);
                  const sql = `INSERT INTO ${'`'}${T}${'`'} (${colsAll.map(c=>'`'+c+'`').join(',')}) VALUES (${colsAll.map(()=>'?').join(',')})`;
                  await q(sql, argsAll);
                  try {
                    await pool?.query(
                      `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                       values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                       on conflict (run_id, table_name, op, id_shop, id_lang)
                       do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                      [ run?.id||null, domain||null, run?.page_type||null, T, 'insert', (row['id_product'] ?? productId ?? null), SID ?? null, LID ?? null, JSON.stringify({}) ]
                    );
                  } catch {}
                  try {
                    const rid = await q('SELECT LAST_INSERT_ID() AS id', []);
                    const newId = Array.isArray(rid)&&rid.length ? Number(rid[0].id||0) : 0;
                    if (newId > 0) {
                      lastIds[tName] = newId;
                      if (pk === 'id_product') lastIds['product'] = newId;
                      if (pk === 'id_category') lastIds['category'] = newId;
                    }
                    chatLog?.('sql_insert', { table: T, run_id: run.id, inserted_id: newId, pk: pk });
                  } catch {}
                }
              } catch (e) {
                try {
                  await pool.query(
                    `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
                    [run.id, domain, run.page_type, T, 'insert', productId||null, SID||null, LID||null, String(e?.message||e), JSON.stringify({ row })]
                  );
                } catch {}
              }
              continue;
            }
            try {
              await pool.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
                [run.id, domain, run.page_type, T, 'skip_missing_pk', productId||null, SID||null, LID||null, 'missing_primary_key_values', JSON.stringify({ pk: pkCols, row_preview: Object.fromEntries(Object.entries(row).slice(0,12)) })]
              );
            } catch {}
            continue;
          }

          // Enforce truncation according to schema and normalize types (avoid DECIMAL='')
          try { await enforceRowLimits(T, row, { product_id: productId, id_shop: SID, id_lang: LID }); } catch {}
          try { await normalizeRowTypes(T, row); } catch {}
          // Build upsert
          const cols = Object.keys(row).filter(c => colsSet.has(c));
          if (!cols.length) {
            // Log no-mapped-columns so the run shows why a table produced no writes
            try {
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
                [ run?.id||null, domain||null, run?.page_type||null, T, 'skip', productId||null, SID||null, LID||null, 'no_mapped_columns', JSON.stringify({}) ]
              );
            } catch {}
            continue;
          }
          const args = cols.map(c => row[c]);
          // Guard defaults so they only fill NULL/blank on UPDATE; mapping/explicit values update unconditionally
          const upd = cols.map(c => {
            const isDefault = defaultCols.has(String(c)) && !mappedCols.has(String(c));
            if (isDefault) {
              const v = row[c];
              if (v === '') { return '\`'+c+'\`=VALUES(\`'+c+'\`)'; }
              const isStr = (typeof v === 'string');
              const cond = isStr ? `\`${c}\` IS NULL OR \`${c}\`=''` : `\`${c}\` IS NULL`;
              return `\`${c}\` = CASE WHEN ${cond} THEN VALUES(\`${c}\`) ELSE \`${c}\` END`;
            }
            return '`'+c+'`=VALUES(`'+c+'`)';
          });
          const rmap = Object.fromEntries(cols.map((c,i)=>[c,args[i]]));
          try { chatLog?.('sql_upsert', { table: T, run_id: run.id, row: rmap }); } catch {}
          try {
            const sql = `INSERT INTO ${'`'}${T}${'`'} (${cols.map(c=>'`'+c+'`').join(',')}) VALUES (${cols.map(()=>'?').join(',')}) ON DUPLICATE KEY UPDATE ${upd.join(', ')}`;
            await q(sql, args);
            try {
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,sql_query,payload)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10::jsonb)
                 on conflict (run_id, table_name, op, id_shop, id_lang)
                 do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                [ run?.id||null, domain||null, run?.page_type||null, T, 'upsert', (row['id_product'] ?? productId ?? null), SID ?? null, LID ?? null, String(sql), JSON.stringify({}) ]
              );
            } catch {}
          } catch (e) {
            try {
              await pool.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
                [run.id, domain, run.page_type, T, 'upsert', productId||null, SID||null, LID||null, String(e?.message||e), JSON.stringify({ row: Object.fromEntries(cols.map(c=>[c,row[c]])) })]
              );
            } catch {}
            chatLog?.('transfer_error', { run_id: run.id, error: String(e?.message||e), last_op: { type:'upsert', table: T } });
          }
          // Per-field detail
          try {
            const ctxInfo = { id_product: row['id_product'] ?? productId ?? null, id_shop: SID ?? null, id_lang: LID ?? null, id_group: GID ?? null };
            for (const [k,v] of Object.entries(rmap)) {
              chatLog?.('upsert_field', { table: T, run_id: run.id, ...ctxInfo, field: k, value: v });
              try {
                await pool.query(
                  `insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                  [run.id||null, domain||null, run?.page_type||null, T, ctxInfo.id_product||null, ctxInfo.id_shop||null, ctxInfo.id_lang||null, ctxInfo.id_group||null, String(k), (v==null? null : String(v))]
                );
              } catch {}
            }
          } catch {}
          }
        }
      }
    }
  } catch (e) {
    chatLog?.('transfer_error', { run_id: run?.id, error: 'generic_writer_failed: '+String(e?.message||e) });
  }
  // Expose any auto-increment IDs captured during this writer (e.g., category)
  return { lastIds };
}

export default runGenericWriter;




