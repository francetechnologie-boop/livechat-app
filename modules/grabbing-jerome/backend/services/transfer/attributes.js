// Attributes/Combinations writer (variants)
// Extracted from legacy pipeline: creates attribute group, attributes, combinations,
// product_attribute(_shop), product_attribute_combination, and per-combination stock rows.

export async function runAttributesWriter(ctx = {}) {
  const {
    q, qi, hasTable, hasColumn,
    pool, chatLog,
    PREFIX = 'ps_',
    productId = 0,
    SHOPS = [], ID_LANG = 1, ID_SHOP_GROUP = 0,
    mapping = {}, result = {},
    DEF_ATTR = {}, DEF_ATTR_SHOP = {},
  } = ctx;

  try {
    if (!productId) return;
    // Local helpers to resolve mapping specs (paths, constants, arrays)
    const pickPath = (obj, pathStr) => {
      try {
        if (!pathStr) return undefined;
        const parts = String(pathStr).replace(/^\$\.?/, '').split('.');
        let cur = obj;
        for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
        return cur;
      } catch { return undefined; }
    };
    const pickFlex = (res, item, s) => {
      const str = String(s||'').trim();
      if (!str) return undefined;
      if (str.startsWith('$.')) return pickPath(res, str.slice(2));
      if (str.startsWith('product.')) return pickPath(res.product || res, str.slice('product.'.length));
      if (str.startsWith('item.') || str.startsWith('variant.')) return pickPath(item || {}, str.replace(/^variant\./,'item.').slice('item.'.length));
      return pickPath(res, str) ?? pickPath(res.product||res, str);
    };
    const resolveSpec = (res, item, spec) => {
      if (spec == null) return undefined;
      if (Array.isArray(spec)) { for (const s of spec) { const v = resolveSpec(res, item, s); if (v !== undefined && v !== null && v !== '') return v; } return undefined; }
      if (typeof spec === 'object') {
        if (Object.prototype.hasOwnProperty.call(spec, 'const') || Object.prototype.hasOwnProperty.call(spec, 'value')) {
          return (Object.prototype.hasOwnProperty.call(spec, 'const') ? spec.const : spec.value);
        }
        const paths = Array.isArray(spec.paths) ? spec.paths : (spec.path ? [spec.path] : []);
        let v; for (const p of paths) { const tmp = pickFlex(res, item, p); if (tmp !== undefined && tmp !== null && tmp !== '') { v = tmp; break; } }
        if (v === undefined) v = pickFlex(res, item, spec.path || spec.p || '');
        try {
          const ops = Array.isArray(spec.transforms) ? spec.transforms : [];
          for (const t of ops) {
            const op = String(t?.op||'').toLowerCase();
            if (op === 'trim') { v = String(v==null?'':v).trim(); continue; }
            if (op === 'replace') { v = String(v==null?'':v).split(String(t?.find||''))?.join(String(t?.replace||'')); continue; }
          }
        } catch {}
        return v;
      }
      if (typeof spec === 'string') { if (spec === '') return ''; if (spec.startsWith('=')) return spec.slice(1); return pickFlex(res, item, spec); }
      return spec;
    };
    const variantsCfg = (mapping && typeof mapping.variants==='object') ? mapping.variants : {};
    const enableColors = (variantsCfg && variantsCfg.enabled) !== false; // default on when present
    const colorCodes = Array.isArray(result?.colors?.codes) ? result.colors.codes : [];

    // Helper for PAS mapping across all existing combinations (no variant context)
    const mapAllPAS = async () => {
      const T_PATTR = PREFIX + 'product_attribute';
      const T_PATTR_SHOP = PREFIX + 'product_attribute_shop';
      const PFIELDS_SHOP_ALL = (mapping && mapping.tables && mapping.tables.product_attribute_shop && mapping.tables.product_attribute_shop.fields) ? mapping.tables.product_attribute_shop.fields : {};
      const fKeysAll = Object.keys(PFIELDS_SHOP_ALL||{});
      const PAS_SHOPS = Array.isArray(mapping?.tables?.product_attribute_shop?.settings?.id_shops) && mapping.tables.product_attribute_shop.settings.id_shops.length
        ? mapping.tables.product_attribute_shop.settings.id_shops
        : SHOPS;
      if (!(await hasTable(T_PATTR)) || !fKeysAll.length) return;
      const rows = await q(`SELECT ${qi('id_product_attribute')} as id_product_attribute FROM ${qi(T_PATTR)} WHERE ${qi('id_product')}=? ORDER BY ${qi('id_product_attribute')} ASC`, [productId]);
      for (const r of (Array.isArray(rows) ? rows : [])) {
        const id_pa = Number(r?.id_product_attribute||0) || 0; if (!id_pa) continue;
        for (const SID of PAS_SHOPS) {
          try { await q(`INSERT IGNORE INTO ${qi(T_PATTR_SHOP)} (${[qi('id_product'),qi('id_product_attribute'),qi('id_shop')].join(',')}) VALUES (?,?,?)`, [productId, id_pa, SID]); } catch {}
          const set = []; const vals = [];
          const numericCols = new Set(['price','wholesale_price','ecotax','unit_price_impact','weight','minimal_quantity','low_stock_alert','low_stock_threshold']);
          const coerce = (k, val) => {
            if (val === '' || val === null || val === undefined) return val;
            if (numericCols.has(String(k))) {
              const n = Number(String(val).replace(/,/g,'.').replace(/[^0-9.\-]/g,''));
              return Number.isFinite(n) ? n : 0;
            }
            const n = Number(val); return Number.isFinite(n) ? n : val;
          };
          for (const k of fKeysAll) {
            if (!k || k==='id_product' || k==='id_product_attribute' || k==='id_shop') continue;
            if (!(await hasColumn(T_PATTR_SHOP, k))) continue;
            const spec = PFIELDS_SHOP_ALL[k];
            // Support both constants (=value) and dynamic paths (e.g., item.price)
            const v = (typeof spec === 'string' && spec.startsWith('=')) ? spec.slice(1) : resolveSpec(result||{}, {}, spec);
            if (v === undefined || v === null) continue;
            set.push(qi(k)+'=?'); vals.push(coerce(k, v));
          }
          if (set.length) { await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${set.join(', ')} WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [...vals, id_pa, SID]); }
        }
      }
    };

    // If variants disabled or no color codes, still try applying PAS fields across existing combos
    if (!enableColors || !colorCodes.length) { await mapAllPAS(); return; }

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
    const T_STOCK = PREFIX + 'stock_available';
    const hasAttrs = await hasTable(T_AG) && await hasTable(T_A) && await hasTable(T_PATTR) && await hasTable(T_PATTR_COMB);
    if (!hasAttrs) return;

    // Languages list for names: always use active ps_lang
    let LANGS_ATTR = [];
    const TABLES = (mapping && mapping.tables && typeof mapping.tables==='object') ? mapping.tables : {};
    try {
      const T_LANG = PREFIX + 'lang';
      if (await hasTable(T_LANG)) {
        const rows = await q(`SELECT ${qi('id_lang')} as id_lang FROM ${qi(T_LANG)} WHERE ${qi('active')}=1`);
        const ids = Array.isArray(rows) ? rows.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : [];
        LANGS_ATTR = ids.length ? ids : [ID_LANG];
      } else {
        LANGS_ATTR = [ID_LANG];
      }
    } catch { LANGS_ATTR = [ID_LANG]; }

    // Ensure color group exists
    let id_attribute_group = 0;
    try {
      const r = await q(`SELECT g.${qi('id_attribute_group')} FROM ${qi(T_AG)} g JOIN ${qi(T_AG_LANG)} gl ON gl.${qi('id_attribute_group')}=g.${qi('id_attribute_group')} WHERE gl.${qi('name')}=? LIMIT 1`, [GROUP_NAME]);
      if (Array.isArray(r) && r.length) id_attribute_group = Number(r[0].id_attribute_group)||0;
    } catch {}
    if (!id_attribute_group) {
      try {
        const cols = []; const args = []; const push=(c,v)=>{ cols.push(c); args.push(v); };
        if (await hasColumn(T_AG, 'is_color_group')) push('is_color_group', 1);
        if (await hasColumn(T_AG, 'group_type')) push('group_type', 'color');
        if (await hasColumn(T_AG, 'position')) push('position', 0);
        await q(`INSERT INTO ${qi(T_AG)} (${cols.map(c=>qi(c)).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`, args);
        const ir = await q('SELECT LAST_INSERT_ID() AS id');
        id_attribute_group = Number((ir && ir[0] && ir[0].id) || 0) || 0;
        for (const L of LANGS_ATTR) {
          try { await q(`INSERT INTO ${qi(T_AG_LANG)} (${['id_attribute_group','id_lang','name','public_name'].map(c=>qi(c)).join(',')}) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE ${qi('name')}=VALUES(${qi('name')}), ${qi('public_name')}=VALUES(${qi('public_name')})`, [id_attribute_group, L, GROUP_NAME, GROUP_NAME]); } catch {}
        }
        const SHOPS_AG = SHOPS;
        for (const SID of SHOPS_AG) { try { await q(`INSERT IGNORE INTO ${qi(T_AG_SHOP)} (${['id_attribute_group','id_shop'].map(c=>qi(c)).join(',')}) VALUES (?,?)`, [id_attribute_group, SID]); } catch {} }
        chatLog?.('variant_group_create', { run_id: ctx.run?.id, id_attribute_group, name: GROUP_NAME });
      } catch (e) { chatLog?.('variant_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }
    }
    if (!id_attribute_group) return;

    // Build or fetch attributes for each code
    const codeToAttr = new Map();
    // Helper to create or fetch id_attribute for a code
    const ensureAttribute = async (code) => {
      if (!code) return 0;
      if (codeToAttr.has(code)) return codeToAttr.get(code);
      let id_attr = 0;
      try {
        const r = await q(`SELECT a.${qi('id_attribute')} FROM ${qi(T_A)} a JOIN ${qi(T_A_LANG)} al ON al.${qi('id_attribute')}=a.${qi('id_attribute')} WHERE ${qi('id_attribute_group')}=? AND al.${qi('name')}=? LIMIT 1`, [id_attribute_group, code]);
        if (Array.isArray(r) && r.length) id_attr = Number(r[0].id_attribute)||0;
      } catch {}
      if (!id_attr) {
        try {
          const cols = [ 'id_attribute_group', 'position' ];
          const args = [ id_attribute_group, 0 ];
          await q(`INSERT INTO ${qi(T_A)} (${cols.map(c=>qi(c)).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`, args);
          const ir = await q('SELECT LAST_INSERT_ID() AS id');
          id_attr = Number((ir && ir[0] && ir[0].id) || 0) || 0;
          for (const L of LANGS_ATTR) {
            try { await q(`INSERT INTO ${qi(T_A_LANG)} (${['id_attribute','id_lang','name'].map(c=>qi(c)).join(',')}) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ${qi('name')}=VALUES(${qi('name')})`, [id_attr, L, code]); } catch {}
          }
          for (const SID of SHOPS) { try { await q(`INSERT IGNORE INTO ${qi(T_A_SHOP)} (${['id_attribute','id_shop'].map(c=>qi(c)).join(',')}) VALUES (?,?)`, [id_attr, SID]); } catch {} }
          chatLog?.('variant_attr_create', { run_id: ctx.run?.id, id_attribute: id_attr, code });
        } catch (e) { chatLog?.('variant_attr_error', { run_id: ctx.run?.id, code, error: String(e?.message||e) }); }
      }
      codeToAttr.set(code, id_attr);
      return id_attr;
    };

    let isFirst = true;
    let firstCombinationId = 0;
    for (const codeRaw of colorCodes) {
      const code = String(codeRaw||'').trim(); if (!code) continue;
      const id_attr = await ensureAttribute(code);
      if (!id_attr) continue;
      // Find existing combination
      let id_product_attribute = 0;
      try {
        const rows = await q(`SELECT pa.${qi('id_product_attribute')} FROM ${qi(T_PATTR)} pa JOIN ${qi(T_PATTR_COMB)} pac ON pac.${qi('id_product_attribute')}=pa.${qi('id_product_attribute')} WHERE pac.${qi('id_attribute')}=? AND pa.${qi('id_product')}=? LIMIT 1`, [id_attr, productId]);
        if (rows && rows.length) id_product_attribute = Number(rows[0].id_product_attribute)||0;
      } catch {}
      if (!id_product_attribute) {
        try {
          await q(`INSERT INTO ${qi(T_PATTR)} (${[qi('id_product')].join(',')}) VALUES (?)`, [productId]);
          const ir = await q('SELECT LAST_INSERT_ID() AS id');
          id_product_attribute = Number((ir && ir[0] && ir[0].id) || 0) || 0;
          await q(`INSERT IGNORE INTO ${qi(T_PATTR_COMB)} (${[qi('id_attribute'), qi('id_product_attribute')].join(',')}) VALUES (?,?)`, [id_attr, id_product_attribute]);
          if (id_product_attribute) chatLog?.('variant_pattr_create', { run_id: ctx.run?.id, id_product_attribute, id_attribute: id_attr });
        } catch (e) { chatLog?.('variant_pattr_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); continue; }
      }
      if (isFirst && id_product_attribute && !firstCombinationId) firstCombinationId = id_product_attribute;
      // Apply defaults on product_attribute (textual blanks vs NULL)
      try {
        const keysPA = Object.keys(DEF_ATTR||{});
        if (keysPA.length) {
          const set = []; const vals = [];
          const norm=(x)=>{ if (x === '') return ''; const s=String(x); if(s==='1'||s==='0') return Number(s); const n=Number(s); return Number.isFinite(n)?n:x; };
          for (const k of keysPA) {
            if (!k || k==='id_product' || k==='id_product_attribute') continue;
            if (!(await hasColumn(T_PATTR, k))) continue;
            set.push(qi(k)+'=?'); vals.push(norm(DEF_ATTR[k]));
          }
          if (set.length) {
            await q(`UPDATE ${qi(T_PATTR)} SET ${set.join(', ')} WHERE ${qi('id_product_attribute')}=?`, [...vals, id_product_attribute]);
            chatLog?.('product_attribute_defaults_enforced', { id_product_attribute, cols: keysPA });
          }
        }
      } catch (e) { chatLog?.('variant_pattr_defaults_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }
    // product_attribute_shop per shop (prefer table-specific id_shops if provided)
    // product_attribute_shop per shop — enable only if mapping declares PAS fields
    const PAS_FIELDS_PRESENT = !!(mapping && mapping.tables && mapping.tables.product_attribute_shop && mapping.tables.product_attribute_shop.fields && Object.keys(mapping.tables.product_attribute_shop.fields||{}).length);
    const PAS_SHOPS = Array.isArray(mapping?.tables?.product_attribute_shop?.settings?.id_shops) && mapping.tables.product_attribute_shop.settings.id_shops.length
      ? mapping.tables.product_attribute_shop.settings.id_shops
      : SHOPS;
    const SHOPS_ATTR_SHOP = PAS_FIELDS_PRESENT ? PAS_SHOPS : [];
    try {
      for (const SID of SHOPS_ATTR_SHOP) {
        try { await q(`INSERT IGNORE INTO ${qi(T_PATTR_SHOP)} (${[qi('id_product'),qi('id_product_attribute'),qi('id_shop')].join(',')}) VALUES (?,?,?)`, [productId, id_product_attribute, SID]); } catch {}
        const PFIELDS_SHOP = mapping?.tables?.product_attribute_shop?.fields || {};
        const fKeys = Object.keys(PFIELDS_SHOP||{});
        if (fKeys.length) {
          const set = []; const vals = [];
          const numericCols = new Set(['price','wholesale_price','ecotax','unit_price_impact','weight','minimal_quantity','low_stock_alert','low_stock_threshold']);
          const coerceForCol = (col, val) => {
            if (val === '') return '';
            if (val === undefined || val === null) return val;
            if (numericCols.has(String(col))) {
              const s = String(val);
              const n = Number(s.replace(/,/g,'.').replace(/[^0-9.\-]/g,''));
              return Number.isFinite(n) ? n : 0;
            }
            const n = Number(val);
            return Number.isFinite(n) ? n : val;
          };
          for (const k of fKeys) {
            if (!k || k==='id_product' || k==='id_product_attribute' || k==='id_shop') continue;
            if (!(await hasColumn(T_PATTR_SHOP, k))) continue;
            const spec = PFIELDS_SHOP[k];
            const v = (typeof spec === 'string' && spec.startsWith('=')) ? spec.slice(1) : resolveSpec(result||{}, item||{}, spec);
            if (v === undefined || v === null) continue;
            set.push(qi(k)+'=?'); vals.push(coerceForCol(k, v));
          }
          if (set.length) { await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${set.join(', ')} WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [...vals, id_product_attribute, SID]); }
        }
      }
    } catch (e) { chatLog?.('variant_pattr_shop_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }

      // Stock per combination per shop
      if (await hasTable(T_STOCK)) {
        for (const SID of SHOPS) {
          try { await q(`INSERT INTO ${qi(T_STOCK)} (${[qi('id_product'),qi('id_product_attribute'),qi('id_shop'),qi('id_shop_group'),qi('quantity'),qi('out_of_stock')].join(',')}) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ${qi('quantity')}=VALUES(${qi('quantity')})`, [productId, id_product_attribute, SID, ID_SHOP_GROUP, 0, 0]); } catch (e) { chatLog?.('variant_stock_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }
        }
      }
      // Layered navigation linking (optional)
      try { if (await hasTable(T_LPA)) await q(`INSERT IGNORE INTO ${qi(T_LPA)} (${[qi('id_attribute'),qi('id_product'),qi('id_attribute_group'),qi('id_shop')].join(',')}) VALUES (?,?,?,?)`, [id_attr, productId, id_attribute_group, SHOPS[0]]); } catch {}
      isFirst = false;
    }

    // After creating combinations, set product/product_shop defaults
    try {
      const T_PRODUCT = PREFIX + 'product';
      const T_PRODUCT_SHOP = PREFIX + 'product_shop';
      if (firstCombinationId) {
        // Mark as combinations type when schema allows
        try {
          if (await hasColumn(T_PRODUCT, 'type')) await q(`UPDATE ${qi(T_PRODUCT)} SET ${qi('type')}=? WHERE ${qi('id_product')}=?`, ['combinations', productId]);
          if (await hasColumn(T_PRODUCT, 'product_type')) await q(`UPDATE ${qi(T_PRODUCT)} SET ${qi('product_type')}=? WHERE ${qi('id_product')}=?`, ['combinations', productId]);
        } catch {}
        // Set default combination on product
        try { if (await hasColumn(T_PRODUCT, 'cache_default_attribute')) await q(`UPDATE ${qi(T_PRODUCT)} SET ${qi('cache_default_attribute')}=? WHERE ${qi('id_product')}=?`, [firstCombinationId, productId]); } catch {}
        // And on each shop row
        try {
          if (await hasTable(T_PRODUCT_SHOP)) {
            for (const SID of SHOPS) {
              try {
                if (await hasColumn(T_PRODUCT_SHOP, 'cache_default_attribute')) await q(`UPDATE ${qi(T_PRODUCT_SHOP)} SET ${qi('cache_default_attribute')}=? WHERE ${qi('id_product')}=? AND ${qi('id_shop')}=?`, [firstCombinationId, productId, SID]);
                if (await hasColumn(T_PRODUCT_SHOP, 'type')) await q(`UPDATE ${qi(T_PRODUCT_SHOP)} SET ${qi('type')}=? WHERE ${qi('id_product')}=? AND ${qi('id_shop')}=?`, ['combinations', productId, SID]);
                if (await hasColumn(T_PRODUCT_SHOP, 'product_type')) await q(`UPDATE ${qi(T_PRODUCT_SHOP)} SET ${qi('product_type')}=? WHERE ${qi('id_product')}=? AND ${qi('id_shop')}=?`, ['combinations', productId, SID]);
              } catch {}
            }
          }
        } catch {}
        // Also set default_on on product_attribute and product_attribute_shop when available
        try {
          const T_PATTR = PREFIX + 'product_attribute';
          const T_PATTR_SHOP = PREFIX + 'product_attribute_shop';
          // ps_product_attribute.default_on
          try {
            if (await hasTable(T_PATTR) && await hasColumn(T_PATTR, 'default_on')) {
              await q(`UPDATE ${qi(T_PATTR)} SET ${qi('default_on')}=NULL WHERE ${qi('id_product')}=?`, [productId]);
              await q(`UPDATE ${qi(T_PATTR)} SET ${qi('default_on')}=1 WHERE ${qi('id_product_attribute')}=?`, [firstCombinationId]);
              try { chatLog?.('variant_default_on_set', { run_id: ctx.run?.id, product_id: productId, id_product_attribute: firstCombinationId }); } catch {}
            }
          } catch {}
          // ps_product_attribute_shop.default_on per shop
          try {
            if (await hasTable(T_PATTR_SHOP) && await hasColumn(T_PATTR_SHOP, 'default_on')) {
              for (const SID of SHOPS) {
                try {
                  await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${qi('default_on')}=NULL WHERE ${qi('id_product')}=? AND ${qi('id_shop')}=?`, [productId, SID]);
                  await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${qi('default_on')}=1 WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [firstCombinationId, SID]);
                  try { chatLog?.('product_attribute_shop_default_on_set', { product_id: productId, id_product_attribute: firstCombinationId, shop: SID }); } catch {}
                } catch {}
              }
            }
          } catch {}
        } catch {}
        chatLog?.('variant_default_set', { run_id: ctx.run?.id, product_id: productId, id_product_attribute: firstCombinationId });
      }
    } catch {}
  } catch (e) {
    chatLog?.('transfer_error', { run_id: ctx.run?.id, error: 'variants_failed: '+String(e?.message||e) });
    try {
      await pool?.query(
        `insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [ctx?.run?.id||null, ctx?.domain||null, ctx?.run?.page_type||null, (ctx?.PREFIX||'ps_')+'product_attribute', 'pipeline', ctx?.productId||null, String(e?.message||e), JSON.stringify({})]
      );
    } catch {}
  }
}

export default runAttributesWriter;
