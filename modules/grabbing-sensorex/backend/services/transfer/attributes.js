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
    forceCreateEmptyCombination = false,
    strictMappingOnly = false,
  } = ctx;

  try {
    if (!productId) return;
    // Shared helpers for resolving mapping specs (constants, paths, transforms)
    const pickPath = (obj, pathStr) => {
      try { if (!pathStr) return undefined; const parts = String(pathStr).replace(/^\$\.?/, '').split('.'); let cur = obj; for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; } return cur; } catch { return undefined; }
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
            if (op === 'replace') { v = String(v==null?'':v).split(String(t?.find||'')).join(String(t?.replace||'')); continue; }
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
      const T_PATTR_LANG = PREFIX + 'product_attribute_lang';
    const T_LPA = PREFIX + 'layered_product_attribute'; // optional
    const T_STOCK = PREFIX + 'stock_available';
    const hasAttrs = await hasTable(T_AG) && await hasTable(T_A) && await hasTable(T_PATTR) && await hasTable(T_PATTR_COMB);
    try { chatLog?.('attributes_begin', { product_id: productId, has_attrs: !!hasAttrs, shops: SHOPS }); } catch {}

    // Important: do NOT return early when core attribute tables are missing.
    // We still want to run the mapping passes that do not require those tables
    // (e.g., product_attribute_shop map-all updates on existing combinations).
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

    // Generic variants (build combinations from result.variants.items)
    const varItems = Array.isArray(result?.variants?.items) ? (result.variants.items || []) : [];
    if (varItems.length && hasAttrs) {
      // Tables
      const T_AG = PREFIX + 'attribute_group';
      const T_AG_LANG = PREFIX + 'attribute_group_lang';
      const T_AG_SHOP = PREFIX + 'attribute_group_shop';
      const T_A = PREFIX + 'attribute';
      const T_A_LANG = PREFIX + 'attribute_lang';
      const T_A_SHOP = PREFIX + 'attribute_shop';
      const T_PATTR = PREFIX + 'product_attribute';
      const T_PATTR_SHOP = PREFIX + 'product_attribute_shop';
      const T_PATTR_LANG = PREFIX + 'product_attribute_lang';
      const T_PATTR_COMB = PREFIX + 'product_attribute_combination';
      const T_STOCK = PREFIX + 'stock_available';
      const T_PRODUCT = PREFIX + 'product';
      const T_PRODUCT_SHOP = PREFIX + 'product_shop';
      if (!(await hasTable(T_AG)) || !(await hasTable(T_A)) || !(await hasTable(T_PATTR)) || !(await hasTable(T_PATTR_COMB))) return;

      // Normalizers (handle special characters and spacing)
      const normalizeText = (s='') => {
        try {
          let t = String(s);
          t = t.replace(/\u00A0/g, ' ');            // nbsp → space
          t = t.replace(/[\u2013\u2014]/g, '-');    // – — → -
          t = t.replace(/[\u2018\u2019]/g, "'");   // ‘ ’ → '
          t = t.replace(/[\u201C\u201D]/g, '"');   // “ ” → "
          t = t.replace(/\u00D7/g, 'x');            // × → x
          // Always keep symbols (Ω / ° / ®); do not normalize to ASCII
          t = t.replace(/\s+/g, ' ').trim();        // collapse whitespace
          // Common fix: "p H" → "pH"
          t = t.replace(/\bp\s*h\b/gi, (m)=> m.replace(/\s+/g,''));
          return t;
        } catch { return String(s||''); }
      };
      const clamp = (s, max=255) => {
        try { const str = String(s||''); return str.length>max ? str.slice(0,max) : str; } catch { return s; }
      };

      // Determine groups
      const groupsSpec = Array.isArray(variantsCfg?.groups) ? variantsCfg.groups : null;
      let groups = [];
      if (groupsSpec && groupsSpec.length) {
        groups = groupsSpec.map(g => ({ name: normalizeText(String(g.name||'').trim()), key: String(g.key||g.path||'').trim() }));
      } else {
        const first = varItems.find(x => x && typeof x==='object' && x.attributes && typeof x.attributes==='object');
        const keys = first ? Object.keys(first.attributes||{}) : [];
        const nice = (s)=> {
          try {
            let t = String(s||'');
            // Strip Woo prefixes for display: attribute_*, attribute_pa_*
            t = t.replace(/^attribute_pa_/, '').replace(/^attribute_/, '');
            t = t.replace(/[_-]+/g,' ');
            t = t.replace(/\b\w/g, c=>c.toUpperCase());
            return normalizeText(t);
          } catch { return normalizeText(String(s||'')); }
        };
        groups = keys.map(k => ({ name: nice(k), key: k }));
      }
      // Ensure groups and attributes
      const groupIds = new Map();
      const ensureGroup = async (name) => {
        const nname = clamp(normalizeText(name), 128);
        if (groupIds.has(nname)) return groupIds.get(nname);
        let idg = 0;
        try {
          const r = await q(`SELECT g.${qi('id_attribute_group')} FROM ${qi(T_AG)} g JOIN ${qi(T_AG_LANG)} gl ON gl.${qi('id_attribute_group')}=g.${qi('id_attribute_group')} WHERE gl.${qi('name')}=? LIMIT 1`, [nname]);
          if (Array.isArray(r) && r.length) idg = Number(r[0].id_attribute_group)||0;
        } catch {}
        if (!idg) {
          try {
            const cols = []; const args = []; const push=(c,v)=>{ cols.push(c); args.push(v); };
            if (await hasColumn(T_AG, 'is_color_group')) push('is_color_group', 0);
            if (await hasColumn(T_AG, 'group_type')) push('group_type', 'select');
            if (await hasColumn(T_AG, 'position')) push('position', 0);
            await q(`INSERT INTO ${qi(T_AG)} (${cols.map(c=>qi(c)).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`, args);
            const ir = await q('SELECT LAST_INSERT_ID() AS id');
            idg = Number((ir && ir[0] && ir[0].id) || 0) || 0;
            // Aggregate success for attribute_group
            try {
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                 on conflict (run_id, table_name, op, id_shop, id_lang)
                 do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_AG, 'insert', ctx.productId||null, null, null, JSON.stringify({}) ]
              );
            } catch {}
            for (const L of LANGS_ATTR) {
              try { 
                const pub = clamp(nname, 64);
                await q(`INSERT INTO ${qi(T_AG_LANG)} (${['id_attribute_group','id_lang','name','public_name'].map(c=>qi(c)).join(',')}) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE ${qi('name')}=VALUES(${qi('name')}), ${qi('public_name')}=VALUES(${qi('public_name')})`, [idg, L, nname, pub]);
                try {
                  await pool?.query(
                    `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                     on conflict (run_id, table_name, op, id_shop, id_lang)
                     do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                    [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_AG_LANG, 'upsert', ctx.productId||null, null, L||null, JSON.stringify({}) ]
                  );
                } catch {}
                try {
                  const rmap = { id_attribute_group: idg, id_lang: L, name: nname, public_name: pub };
                  for (const [k,v] of Object.entries(rmap)) {
                    try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_AG_LANG, ctx.productId||null, null, L||null, null, String(k), (v==null? null : String(v))]); } catch {}
                  }
                } catch {}
              } catch {}
            }
            for (const SID of SHOPS) { try { await q(`INSERT IGNORE INTO ${qi(T_AG_SHOP)} (${['id_attribute_group','id_shop'].map(c=>qi(c)).join(',')}) VALUES (?,?)`, [idg, SID]); } catch {} }
            chatLog?.('variant_group_create', { run_id: ctx.run?.id, id_attribute_group: idg, name: nname });
          } catch (e) { chatLog?.('variant_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }
        }
        groupIds.set(nname, idg);
        return idg;
      };
      const attrIds = new Map(); // key: groupId||'g#'+id + '::' + value -> id_attribute
      const ensureAttr = async (groupId, value) => {
        const nval = clamp(normalizeText(String(value)), 128);
        const key = 'g#'+groupId+'::'+nval;
        if (attrIds.has(key)) return attrIds.get(key);
        let ida = 0;
        try {
          const r = await q(`SELECT a.${qi('id_attribute')} FROM ${qi(T_A)} a JOIN ${qi(T_A_LANG)} al ON al.${qi('id_attribute')}=a.${qi('id_attribute')} WHERE ${qi('id_attribute_group')}=? AND al.${qi('name')}=? LIMIT 1`, [groupId, nval]);
          if (Array.isArray(r) && r.length) ida = Number(r[0].id_attribute)||0;
        } catch {}
        // Fallback: try common legacy variants (prior to normalization): Ω and ° tokens
        if (!ida) {
          try {
            const altSet = new Set();
            // Both directions to find pre-existing rows regardless of normalization
            try { altSet.add(clamp(String(nval).replace(/[\u03A9\u03C9]/g, 'Ohm'), 128)); } catch {}
            try { altSet.add(clamp(String(nval).replace(/[\u03A9\u03C9]/g, ' Ohm '), 128)); } catch {}
            try { altSet.add(clamp(String(nval).replace(/\bOhm\b/gi, 'Ω'), 128)); } catch {}
            try { altSet.add(clamp(String(nval).replace(/\bdeg\s*(C|F)\b/gi, '°$1'), 128)); } catch {}
            try { altSet.add(clamp(String(nval).replace(/°\s*(C|F)\b/gi, 'deg $1'), 128)); } catch {}
            try { altSet.add(clamp(String(nval).replace(/\s+/g,' ').trim().replace(/\s*Ohm\s*/gi,'Ω'), 128)); } catch {}
            // Also try collapsing/expanding spaces around Ohm to match rows like "100 Ohm RTD"
            try { altSet.add(clamp(String(nval).replace(/\s*Ohm\s*/gi, 'Ohm '), 128)); } catch {}
            try { altSet.add(clamp(String(nval).replace(/\s*Ohm\s*/gi, ' Ohm '), 128)); } catch {}
            for (const alt of altSet) {
              if (!alt || alt === nval) continue;
              const r2 = await q(`SELECT a.${qi('id_attribute')} FROM ${qi(T_A)} a JOIN ${qi(T_A_LANG)} al ON al.${qi('id_attribute')}=a.${qi('id_attribute')} WHERE ${qi('id_attribute_group')}=? AND al.${qi('name')}=? LIMIT 1`, [groupId, alt]);
              if (Array.isArray(r2) && r2.length) { ida = Number(r2[0].id_attribute)||0; if (ida) break; }
            }
          } catch {}
        }
        // No automatic rename based on symbols; keep existing labels
        if (!ida) {
          try {
            const cols = ['id_attribute_group','position'];
            const args = [groupId, 0];
            // Some schemas require `color` NOT NULL on ps_attribute
            try { if (await hasColumn(T_A, 'color')) { cols.push('color'); args.push('#000000'); } } catch {}
            await q(`INSERT INTO ${qi(T_A)} (${cols.map(c=>qi(c)).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`, args);
            const ir = await q('SELECT LAST_INSERT_ID() AS id');
            ida = Number((ir && ir[0] && ir[0].id) || 0) || 0;
            // Aggregate success for attribute
            try {
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                 on conflict (run_id, table_name, op, id_shop, id_lang)
                 do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_A, 'insert', ctx.productId||null, null, null, JSON.stringify({}) ]
              );
            } catch {}
            for (const L of LANGS_ATTR) {
              try { 
                await q(`INSERT INTO ${qi(T_A_LANG)} (${['id_attribute','id_lang','name'].map(c=>qi(c)).join(',')}) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ${qi('name')}=VALUES(${qi('name')})`, [ida, L, nval]);
                try {
                  await pool?.query(
                    `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                     on conflict (run_id, table_name, op, id_shop, id_lang)
                     do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                    [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_A_LANG, 'upsert', ctx.productId||null, null, L||null, JSON.stringify({}) ]
                  );
                } catch {}
                try {
                  const rmap = { id_attribute: ida, id_lang: L, name: nval };
                  for (const [k,v] of Object.entries(rmap)) {
                    try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_A_LANG, ctx.productId||null, null, L||null, null, String(k), (v==null? null : String(v))]); } catch {}
                  }
                } catch {}
              } catch {}
            }
            for (const SID of SHOPS) { try { await q(`INSERT IGNORE INTO ${qi(T_A_SHOP)} (${['id_attribute','id_shop'].map(c=>qi(c)).join(',')}) VALUES (?,?)`, [ida, SID]); } catch {} }
          } catch (e) { chatLog?.('variant_attr_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }
        }
        // Ensure attribute is visible in all target shops even when it already existed
        try {
          if (ida && await hasTable(T_A_SHOP) && Array.isArray(SHOPS) && SHOPS.length) {
            for (const SID of SHOPS) {
              try { await q(`INSERT IGNORE INTO ${qi(T_A_SHOP)} (${['id_attribute','id_shop'].map(c=>qi(c)).join(',')}) VALUES (?,?)`, [ida, SID]); } catch {}
            }
          }
        } catch {}
        attrIds.set(key, ida);
        return ida;
      };

      let firstCombinationId = 0;
      // Helper: safe path picker from result or current variant item
      const pickPath = (obj, pathStr) => {
        try { if (!pathStr) return undefined; const parts = String(pathStr).replace(/^\$\.?/, '').split('.'); let cur = obj; for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; } return cur; } catch { return undefined; }
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
        // Arrays: first non-empty
        if (Array.isArray(spec)) { for (const s of spec) { const v = resolveSpec(res, item, s); if (v !== undefined && v !== null && v !== '') return v; } return undefined; }
        if (typeof spec === 'object') {
          // Constant literal value
          if (Object.prototype.hasOwnProperty.call(spec, 'const') || Object.prototype.hasOwnProperty.call(spec, 'value')) {
            return (Object.prototype.hasOwnProperty.call(spec, 'const') ? spec.const : spec.value);
          }
          // Note: resolveSpec is synchronous; DB updates (like price fallback) must be handled outside
          const paths = Array.isArray(spec.paths) ? spec.paths : (spec.path ? [spec.path] : []);
          let v; for (const p of paths) { const tmp = pickFlex(res, item, p); if (tmp !== undefined && tmp !== null && tmp !== '') { v = tmp; break; } }
          if (v === undefined) v = pickFlex(res, item, spec.path || spec.p || '');
          // minimal transforms: trim/replace
          try {
            const ops = Array.isArray(spec.transforms) ? spec.transforms : [];
            for (const t of ops) {
              const op = String(t?.op||'').toLowerCase();
              if (op === 'trim') { v = String(v==null?'':v).trim(); continue; }
              if (op === 'replace') { v = String(v==null?'':v).split(String(t?.find||'')).join(String(t?.replace||'')); continue; }
            }
          } catch {}
          return v;
        }
        if (typeof spec === 'string') {
          if (spec === '') return '';
          if (spec.startsWith('=')) return spec.slice(1);
          return pickFlex(res, item, spec);
        }
        return spec;
      };

      for (const item of varItems) {
        try {
          // Reuse existing combination by reference (item.sku) when possible to avoid duplicates
          let id_pa = 0;
          try {
            const sku = String(item?.sku || '').trim();
            if (sku && await hasColumn(T_PATTR, 'reference')) {
              const rr = await q(`SELECT ${qi('id_product_attribute')} AS id_product_attribute FROM ${qi(T_PATTR)} WHERE ${qi('id_product')}=? AND ${qi('reference')}=? LIMIT 1`, [productId, sku]);
              if (Array.isArray(rr) && rr.length) id_pa = Number(rr[0]?.id_product_attribute||0) || 0;
              if (id_pa) { try { chatLog?.('variant_pattr_reuse', { run_id: ctx.run?.id, id_product_attribute: id_pa, reference: sku }); } catch {} }
            }
          } catch {}
          if (!id_pa) {
            // Create product_attribute
            await q(`INSERT INTO ${qi(T_PATTR)} (${[qi('id_product')].join(',')}) VALUES (?)`, [productId]);
            try {
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                 on conflict (run_id, table_name, op, id_shop, id_lang)
                 do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR, 'insert', productId||null, null, null, JSON.stringify({}) ]
              );
            } catch {}
            const ir = await q('SELECT LAST_INSERT_ID() AS id');
            id_pa = Number((ir && ir[0] && ir[0].id) || 0) || 0;
          }
          if (!firstCombinationId) firstCombinationId = id_pa;
          // Ensure language rows exist for this combination
          try {
            if (await hasTable(T_PATTR_LANG)) {
              for (const L of LANGS_ATTR) {
                try { await q(`INSERT IGNORE INTO ${qi(T_PATTR_LANG)} (${[qi('id_product_attribute'),qi('id_lang'),qi('available_now'),qi('available_later')].join(',')}) VALUES (?,?,?,?)`, [id_pa, L, '', '']); } catch {}
              }
            }
          } catch {}
          // Link all attributes for this variant
          const attrs = (item && item.attributes && typeof item.attributes==='object') ? item.attributes : {};
          for (const g of groups) {
            const name = g.name;
            const key = g.key || name;
            // Be tolerant to dash/underscore mismatches between extracted keys and mapping keys.
            // Try exact match, then swap '_' and '-' variants to find a non-empty value.
            let rawVal = undefined;
            if (attrs) {
              const base = String(key);
              const candidates = [
                base,
                base.includes('_') ? base.replace(/_/g, '-') : null,
                base.includes('-') ? base.replace(/-/g, '_') : null,
                // Accept Woo-style keys with attribute_ prefix
                base.startsWith('attribute_') ? base.slice('attribute_'.length) : ('attribute_' + base),
                base.startsWith('attribute_') ? (base.slice('attribute_'.length).replace(/_/g, '-')) : ('attribute_' + base.replace(/_/g, '-')),
                base.startsWith('attribute_') ? (base.slice('attribute_'.length).replace(/-/g, '_')) : ('attribute_' + base.replace(/-/g, '_')),
                // Accept Woo global attribute keys with attribute_pa_ prefix
                base.startsWith('attribute_pa_') ? base.slice('attribute_pa_'.length) : ('attribute_pa_' + base),
                base.startsWith('attribute_pa_') ? (base.slice('attribute_pa_'.length).replace(/_/g, '-')) : ('attribute_pa_' + base.replace(/_/g, '-')),
                base.startsWith('attribute_pa_') ? (base.slice('attribute_pa_'.length).replace(/-/g, '_')) : ('attribute_pa_' + base.replace(/-/g, '_')),
              ].filter(Boolean);
              for (const k of candidates) {
                const v = attrs[k];
                if (v !== undefined && v !== null && String(v).trim() !== '') { rawVal = v; break; }
              }
            }
            const val = String(rawVal ?? '').trim();
            if (!val) { try { chatLog?.('variant_attr_missing_value', { run_id: ctx.run?.id, group: name, base_key: key, tried_keys: (attrs ? Object.keys(attrs) : []), id_product: productId, sku: (item && item.sku) ? String(item.sku) : null }); } catch {}; continue; }
            const idg = await ensureGroup(name);
            const ida = await ensureAttr(idg, val);
            // Guard: never link with a missing/zero attribute id
            if (!idg || !ida) {
              try { chatLog?.('pac_skip_missing_attr', { run_id: ctx.run?.id, group: name, value: val, id_group: idg||0, id_attribute: ida||0, id_product_attribute: id_pa }); } catch {}
              continue;
            }
            try {
              // Enforce one attribute per group per combination: replace duplicates, then insert target
              const existing = await q(`SELECT pac.${qi('id_attribute')} as id_attribute
                                          FROM ${qi(T_PATTR_COMB)} pac
                                          JOIN ${qi(T_A)} a ON a.${qi('id_attribute')}=pac.${qi('id_attribute')}
                                         WHERE pac.${qi('id_product_attribute')}=? AND a.${qi('id_attribute_group')}=?`, [id_pa, idg]);
              if (Array.isArray(existing) && existing.length) {
                const hasSame = existing.some(r => Number(r.id_attribute||0) === Number(ida));
                if (!hasSame) {
                  await q(`DELETE pac FROM ${qi(T_PATTR_COMB)} pac JOIN ${qi(T_A)} a ON a.${qi('id_attribute')}=pac.${qi('id_attribute')} WHERE pac.${qi('id_product_attribute')}=? AND a.${qi('id_attribute_group')}=?`, [id_pa, idg]);
                }
              }
              await q(`INSERT IGNORE INTO ${qi(T_PATTR_COMB)} (${[qi('id_attribute'), qi('id_product_attribute')].join(',')}) VALUES (?,?)`, [ida, id_pa]);
              // Per-field audit for combination link
              try {
                await pool?.query(
                  `insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                  [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_COMB, productId||null, null, null, idg||null, 'id_attribute', String(ida) ]
                );
                await pool?.query(
                  `insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                  [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_COMB, productId||null, null, null, idg||null, 'id_product_attribute', String(id_pa) ]
                );
              } catch {}
              try { await pool?.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                 on conflict (run_id, table_name, op, id_shop, id_lang)
                 do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_COMB, 'insert', productId||null, null, null, JSON.stringify({}) ]
              ); } catch {}
            } catch {}
          }
          // Ensure product_attribute_shop row per shop when mapping declares PAS fields
          try {
            const PASpec = (mapping && mapping.tables && mapping.tables.product_attribute_shop && mapping.tables.product_attribute_shop.fields) ? mapping.tables.product_attribute_shop.fields : {};
            const allowPAS = PASpec && Object.keys(PASpec||{}).length > 0;
            for (const SID of (allowPAS ? SHOPS : [])) {
              try { await q(`INSERT IGNORE INTO ${qi(T_PATTR_SHOP)} (${[qi('id_product'),qi('id_product_attribute'),qi('id_shop')].join(',')}) VALUES (?,?,?)`, [productId, id_pa, SID]); } catch {}
            }
            if (!allowPAS) { try { chatLog?.('product_attribute_shop_write_skipped', { product_id: productId, id_product_attribute: id_pa, reason: 'no PAS fields in mapping' }); } catch {} }
          } catch {}

          // Apply mapped fields from mapping.tables.product_attribute.fields onto this combination
          try {
            const PFIELDS = (mapping && mapping.tables && mapping.tables.product_attribute && mapping.tables.product_attribute.fields) ? mapping.tables.product_attribute.fields : {};
            const keys = Object.keys(PFIELDS||{});
            if (keys.length) {
              const set = []; const vals = []; const updRow = {};
              const isPathSpec = (s) => {
                if (s == null) return false;
                if (typeof s === 'string') return !(s === '' || s.startsWith('='));
                if (typeof s === 'object') {
                  if (Object.prototype.hasOwnProperty.call(s,'const') || Object.prototype.hasOwnProperty.call(s,'value')) return false;
                  return !!(s.path || (Array.isArray(s.paths) && s.paths.length));
                }
                return false;
              };
              for (const col of keys) {
                const spec = PFIELDS[col];
                // Skip path mapping if default exists for this column (unless strict mapping only)
                if (!strictMappingOnly && Object.prototype.hasOwnProperty.call(DEF_ATTR||{}, col) && isPathSpec(spec)) continue;
                const val = resolveSpec(result || {}, item || {}, spec);
                if (val === undefined || val === null) continue;
                // Allow explicit empty string for known text id columns
                if (val === '') {
                  const allowEmpty = new Set(['mpn','upc','isbn','ean13','reference','supplier_reference']);
                  if (!allowEmpty.has(String(col))) continue;
                }
                if (!(await hasColumn(T_PATTR, col))) continue;
                set.push(qi(col)+'=?');
                const vv = String(val);
                vals.push(vv);
                updRow[col] = vv;
              }
              if (set.length) {
                await q(`UPDATE ${qi(T_PATTR)} SET ${set.join(', ')} WHERE ${qi('id_product_attribute')}=?`, [...vals, id_pa]);
                try {
                  chatLog?.('sql_update', { table: T_PATTR, run_id: ctx.run?.id, id_product_attribute: id_pa, row: updRow });
                  for (const [k,v] of Object.entries(updRow)) {
                    chatLog?.('upsert_field', { table: T_PATTR, run_id: ctx.run?.id, id_product_attribute: id_pa, field: k, value: v });
                    try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, null, ctx.run?.page_type||null, T_PATTR, productId||null, null, null, null, String(k), (v==null? null : String(v))]); } catch {}
                  }
                } catch {}
                chatLog?.('product_attribute_mapped', { run_id: ctx.run?.id, id_product_attribute: id_pa, cols: Object.keys(updRow) });
              }
              // Ensure reference/supplier_reference from variant SKU when available
              try {
                const sku = String(item?.sku || '').trim();
                if (sku) {
                  const set2 = []; const vals2 = []; const row2 = {};
                  if (await hasColumn(T_PATTR, 'reference')) { set2.push(`${qi('reference')}=?`); vals2.push(sku); row2.reference = sku; }
                  if (await hasColumn(T_PATTR, 'supplier_reference')) { set2.push(`${qi('supplier_reference')}=?`); vals2.push(sku); row2.supplier_reference = sku; }
                  if (set2.length) {
                    await q(`UPDATE ${qi(T_PATTR)} SET ${set2.join(', ')} WHERE ${qi('id_product_attribute')}=?`, [...vals2, id_pa]);
                    try { for (const [k,v] of Object.entries(row2)) { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, null, ctx.run?.page_type||null, T_PATTR, productId||null, null, null, null, String(k), String(v)]); } } catch {}
                  }
                }
              } catch {}
            }
          } catch (e) { chatLog?.('variant_pattr_map_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }
          // stock per shop
          if (await hasTable(T_STOCK)) {
            for (const SID of SHOPS) {
              try { await q(`INSERT INTO ${qi(T_STOCK)} (${[qi('id_product'),qi('id_product_attribute'),qi('id_shop'),qi('id_shop_group'),qi('quantity'),qi('out_of_stock')].join(',')}) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ${qi('quantity')}=VALUES(${qi('quantity')})`, [productId, id_pa, SID, ID_SHOP_GROUP, 0, 0]);
                try { await pool?.query(
                  `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                   on conflict (run_id, table_name, op, id_shop, id_lang)
                   do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                  [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_STOCK, 'upsert', productId||null, SID||null, null, JSON.stringify({}) ]
                ); } catch {}
              } catch {}
            }
          }
        } catch (e) { chatLog?.('variant_generic_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }
      }
      // Mark default combination and product types
      try {
        if (firstCombinationId) {
          const T_PATTR = PREFIX + 'product_attribute';
          const T_PATTR_SHOP = PREFIX + 'product_attribute_shop';
          try { if (await hasColumn(T_PRODUCT, 'type')) await q(`UPDATE ${qi(T_PRODUCT)} SET ${qi('type')}=? WHERE ${qi('id_product')}=?`, ['combinations', productId]); } catch {}
          try { if (await hasColumn(T_PRODUCT, 'product_type')) await q(`UPDATE ${qi(T_PRODUCT)} SET ${qi('product_type')}=? WHERE ${qi('id_product')}=?`, ['combinations', productId]); } catch {}
          try { for (const SID of SHOPS) { if (await hasColumn(T_PRODUCT_SHOP, 'cache_default_attribute')) await q(`UPDATE ${qi(T_PRODUCT_SHOP)} SET ${qi('cache_default_attribute')}=? WHERE ${qi('id_product')}=? AND ${qi('id_shop')}=?`, [firstCombinationId, productId, SID]); } } catch {}
          try {
            await pool?.query(
              `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
               values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
               on conflict (run_id, table_name, op, id_shop, id_lang)
               do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
              [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, PREFIX+'product_shop', 'update', productId||null, null, null, JSON.stringify({ field:'cache_default_attribute' }) ]
            );
          } catch {}

          // Enforce default_on at combination level (ps_product_attribute)
          try {
            if (await hasTable(T_PATTR) && await hasColumn(T_PATTR, 'default_on')) {
              await q(`UPDATE ${qi(T_PATTR)} SET ${qi('default_on')}=NULL WHERE ${qi('id_product')}=?`, [productId]);
              await q(`UPDATE ${qi(T_PATTR)} SET ${qi('default_on')}=1 WHERE ${qi('id_product_attribute')}=?`, [firstCombinationId]);
              chatLog?.('variant_default_on_set', { run_id: ctx.run?.id, product_id: productId, id_product_attribute: firstCombinationId });
              try {
                await pool?.query(
                  `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                   on conflict (run_id, table_name, op, id_shop, id_lang)
                   do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                  [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR, 'update', productId||null, null, null, JSON.stringify({ field:'default_on' }) ]
                );
              } catch {}
              try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR, productId||null, null, null, null, 'default_on', '1']); } catch {}
            }
          } catch {}
          // Enforce default_on at shop-combination level for the first combination in each targeted shop
          try {
            if (await hasTable(T_PATTR_SHOP) && await hasColumn(T_PATTR_SHOP, 'default_on')) {
              for (const SID of SHOPS) {
                try {
                  await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${qi('default_on')}=NULL WHERE ${qi('id_product')}=? AND ${qi('id_shop')}=?`, [productId, SID]);
                  await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${qi('default_on')}=1 WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [firstCombinationId, SID]);
                  try { chatLog?.('product_attribute_shop_default_on_set', { product_id: productId, id_product_attribute: firstCombinationId, shop: SID }); } catch {}
                  try {
                    await pool?.query(
                      `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                       values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                       on conflict (run_id, table_name, op, id_shop, id_lang)
                       do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                      [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, 'update', productId||null, SID||null, null, JSON.stringify({ field:'default_on' }) ]
                    );
                  } catch {}
                } catch {}
              }
            }
          } catch {}
        }
      } catch {}
      return;
    }

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
      const ncode = clamp(normalizeText(code), 128);
      if (codeToAttr.has(ncode)) return codeToAttr.get(ncode);
      let id_attr = 0;
      try {
        const r = await q(`SELECT a.${qi('id_attribute')} FROM ${qi(T_A)} a JOIN ${qi(T_A_LANG)} al ON al.${qi('id_attribute')}=a.${qi('id_attribute')} WHERE ${qi('id_attribute_group')}=? AND al.${qi('name')}=? LIMIT 1`, [id_attribute_group, ncode]);
        if (Array.isArray(r) && r.length) id_attr = Number(r[0].id_attribute)||0;
      } catch {}
      if (!id_attr) {
        try {
          const cols = [ 'id_attribute_group', 'position' ];
          const args = [ id_attribute_group, 0 ];
          // Some schemas have attribute.color NOT NULL without default
          try { if (await hasColumn(T_A, 'color')) { cols.push('color'); args.push('#000000'); } } catch {}
          await q(`INSERT INTO ${qi(T_A)} (${cols.map(c=>qi(c)).join(',')}) VALUES (${cols.map(()=>'?').join(',')})`, args);
          const ir = await q('SELECT LAST_INSERT_ID() AS id');
          id_attr = Number((ir && ir[0] && ir[0].id) || 0) || 0;
          for (const L of LANGS_ATTR) {
            try { await q(`INSERT INTO ${qi(T_A_LANG)} (${['id_attribute','id_lang','name'].map(c=>qi(c)).join(',')}) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ${qi('name')}=VALUES(${qi('name')})`, [id_attr, L, ncode]); } catch {}
          }
          for (const SID of SHOPS) { try { await q(`INSERT IGNORE INTO ${qi(T_A_SHOP)} (${['id_attribute','id_shop'].map(c=>qi(c)).join(',')}) VALUES (?,?)`, [id_attr, SID]); } catch {} }
          chatLog?.('variant_attr_create', { run_id: ctx.run?.id, id_attribute: id_attr, code: ncode });
        } catch (e) { chatLog?.('variant_attr_error', { run_id: ctx.run?.id, code, error: String(e?.message||e) }); }
      }
      codeToAttr.set(ncode, id_attr);
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
          // Ensure language rows exist for this combination
          try {
            if (await hasTable(T_PATTR_LANG)) {
              for (const L of LANGS_ATTR) {
                try { await q(`INSERT IGNORE INTO ${qi(T_PATTR_LANG)} (${[qi('id_product_attribute'),qi('id_lang'),qi('available_now'),qi('available_later')].join(',')}) VALUES (?,?,?,?)`, [id_product_attribute, L, '', '']); } catch {}
              }
            }
          } catch {}
          // Guard: only link when both ids are valid
          if (id_attr && id_product_attribute) {
            await q(`INSERT IGNORE INTO ${qi(T_PATTR_COMB)} (${[qi('id_attribute'), qi('id_product_attribute')].join(',')}) VALUES (?,?)`, [id_attr, id_product_attribute]);
            // Per-field audit for fallback link
            try {
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_COMB, productId||null, null, null, null, 'id_attribute', String(id_attr) ]
              );
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_COMB, productId||null, null, null, null, 'id_product_attribute', String(id_product_attribute) ]
              );
            } catch {}
          } else {
            try { chatLog?.('pac_skip_missing_attr', { run_id: ctx.run?.id, id_attribute: id_attr||0, id_product_attribute }); } catch {}
          }
          if (id_product_attribute) chatLog?.('variant_pattr_create', { run_id: ctx.run?.id, id_product_attribute, id_attribute: id_attr });
        } catch (e) { chatLog?.('variant_pattr_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); continue; }
      }
      if (isFirst && id_product_attribute && !firstCombinationId) firstCombinationId = id_product_attribute;
      // Apply defaults on product_attribute for this newly created/located combination
      try {
        if (!strictMappingOnly) {
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
        }
      } catch (e) { chatLog?.('variant_pattr_defaults_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }
    // product_attribute_shop per shop (prefer table-specific id_shops if provided)
    const PAS_FIELDS_PRESENT = !!(mapping && mapping.tables && mapping.tables.product_attribute_shop && mapping.tables.product_attribute_shop.fields && Object.keys(mapping.tables.product_attribute_shop.fields||{}).length);
    const PAS_SHOPS = Array.isArray(mapping?.tables?.product_attribute_shop?.settings?.id_shops) && mapping.tables.product_attribute_shop.settings.id_shops.length
      ? mapping.tables.product_attribute_shop.settings.id_shops
      : SHOPS;
    // Always ensure product_attribute_shop rows exist for all shops in scope,
    // even when no explicit PAS fields are mapped. Themes and core queries
    // filter by pas.id_shop, and missing rows hide selectors.
    const SHOPS_ATTR_SHOP = PAS_SHOPS && PAS_SHOPS.length ? PAS_SHOPS : SHOPS;
    try { chatLog?.('pattr_shop_variant_enter', { product_id: productId, id_product_attribute, shops: SHOPS_ATTR_SHOP, has_fields: PAS_FIELDS_PRESENT }); } catch {}
    // product_attribute_shop per shop
    try {
      for (const SID of SHOPS_ATTR_SHOP) {
        // Ensure the per-shop row exists
        try { await q(`INSERT IGNORE INTO ${qi(T_PATTR_SHOP)} (${[qi('id_product'),qi('id_product_attribute'),qi('id_shop')].join(',')}) VALUES (?,?,?)`, [productId, id_product_attribute, SID]); } catch {}
        // Apply defaults from DEF_ATTR_SHOP (schema-aware)
        const keysAS = Object.keys(DEF_ATTR_SHOP||{});
          if (keysAS.length) {
            const set = []; const vals = []; const norm=(x)=>{ const s=String(x); if(s==='1'||s==='0') return Number(s); const n=Number(s); return Number.isFinite(n)?n:x; };
            for (const k of keysAS) { if (!k || k==='id_product' || k==='id_product_attribute' || k==='id_shop') continue; if (!(await hasColumn(T_PATTR_SHOP, k))) continue; set.push(qi(k)+'=?'); vals.push(norm(DEF_ATTR_SHOP[k])); }
            if (set.length) {
              await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${set.join(', ')} WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [...vals, id_product_attribute, SID]);
              chatLog?.('product_attribute_shop_defaults_enforced', { id_product_attribute, shop: SID, cols: keysAS });
              try {
                await pool?.query(
                  `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                   on conflict (run_id, table_name, op, id_shop, id_lang)
                   do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                  [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, 'update', productId||null, SID||null, null, JSON.stringify({ kind: 'defaults' }) ]
                );
              } catch {}
            }
        }
        // Apply mapping.fields for product_attribute_shop (when present)
        try {
          const PFIELDS_SHOP = (mapping && mapping.tables && mapping.tables.product_attribute_shop && mapping.tables.product_attribute_shop.fields) ? mapping.tables.product_attribute_shop.fields : {};
          const fKeys = Object.keys(PFIELDS_SHOP||{});
          try { chatLog?.('pattr_shop_fkeys_variant', { id_product_attribute, shop: SID, keys: fKeys }); } catch {}
          if (fKeys.length) {
            const set = []; const vals = []; const colsApplied = [];
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
              if (String(k) === 'default_on') continue; // handled by dedicated default logic to avoid UNIQUE(id_product,id_shop,default_on) conflicts
              if (!k || k==='id_product' || k==='id_product_attribute' || k==='id_shop') continue;
              if (!(await hasColumn(T_PATTR_SHOP, k))) continue;
              const spec = PFIELDS_SHOP[k];
              // Use current variant item context so item.* paths resolve (price, weight, etc.)
              const v = resolveSpec(result || {}, item || {}, spec);
              if (v === undefined || v === null) continue;
              set.push(qi(k)+'=?'); vals.push(coerceForCol(k, v)); colsApplied.push(k);
            }
            // Trace always, even when no fields will apply (diagnostic)
            try {
              const priceDeclared = Object.prototype.hasOwnProperty.call(PFIELDS_SHOP||{}, 'price');
              chatLog?.('pattr_shop_pass', {
                run_id: ctx.run?.id,
                mode: 'variant',
                id_product: productId || null,
                id_product_attribute,
                shop: SID,
                declared_keys: Array.isArray(fKeys) ? fKeys.length : 0,
                applied_keys: colsApplied.length,
                price_declared: !!priceDeclared
              });
            } catch {}
            if (set.length) {
              await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${set.join(', ')} WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [...vals, id_product_attribute, SID]);
              chatLog?.('product_attribute_shop_mapped', { id_product_attribute, shop: SID, cols: colsApplied, values: Object.fromEntries(colsApplied.map((k,i)=>[k, vals[i]])) });
              try {
                await pool?.query(
                  `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                   on conflict (run_id, table_name, op, id_shop, id_lang)
                   do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                  [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, 'upsert', productId||null, SID||null, null, JSON.stringify({ cols: colsApplied }) ]
                );
              } catch {}
              try {
                for (let i=0;i<colsApplied.length;i++) {
                  const k = colsApplied[i]; const v = vals[i];
                  try { chatLog?.('upsert_field', { table: T_PATTR_SHOP, run_id: ctx.run?.id, id_product: productId||null, id_shop: SID||null, id_lang: null, id_group: null, field: String(k), value: v }); } catch {}
                  try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, productId||null, SID||null, null, null, String(k), (v==null? null : String(v))]); } catch {}
              }
              } catch {}
            } else {
              chatLog?.('product_attribute_shop_no_mapped_cols', { id_product_attribute, shop: SID, keys: fKeys });
            }
            // Price fallback: even when no other columns were applied, try price alone if mapping declares it
            try {
              if (!colsApplied.includes('price') && Object.prototype.hasOwnProperty.call(PFIELDS_SHOP||{}, 'price')) {
                const pv = resolveSpec(result || {}, item || {}, PFIELDS_SHOP.price);
                if (pv !== undefined && pv !== null && await hasColumn(T_PATTR_SHOP, 'price')) {
                  const n = Number(String(pv).replace(/,/g,'.').replace(/[^0-9.\-]/g,''));
                  await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${qi('price')}=? WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [Number.isFinite(n)? n : 0, id_product_attribute, SID]);
                  chatLog?.('product_attribute_shop_price_fallback', { id_product_attribute, shop: SID, price: Number(pv) });
                  try {
                    await pool?.query(
                      `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                       values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                       on conflict (run_id, table_name, op, id_shop, id_lang)
                       do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                      [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, 'update', productId||null, SID||null, null, JSON.stringify({ field: 'price', source: 'mapping_price' }) ]
                    );
                  } catch {}
                  try { chatLog?.('upsert_field', { table: T_PATTR_SHOP, run_id: ctx.run?.id, id_product: productId||null, id_shop: SID||null, id_lang: null, id_group: null, field: 'price', value: pv }); } catch {}
                  try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, productId||null, SID||null, null, null, 'price', String(pv)]); } catch {}
                } else if (await hasColumn(T_PATTR_SHOP, 'price')) {
                  // Secondary fallback: reuse price from product_attribute if present
                  try {
                    const rpa = await q(`SELECT ${qi('price')} as price FROM ${qi(T_PATTR)} WHERE ${qi('id_product_attribute')}=? LIMIT 1`, [id_product_attribute]);
                    const vpa = (Array.isArray(rpa) && rpa.length) ? (rpa[0]?.price) : null;
                    if (vpa !== undefined && vpa !== null) {
                      const n = Number(String(vpa).replace(/,/g,'.').replace(/[^0-9.\-]/g,''));
                      await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${qi('price')}=? WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [Number.isFinite(n)? n : 0, id_product_attribute, SID]);
                      chatLog?.('product_attribute_shop_price_from_pa', { id_product_attribute, shop: SID, price: Number(vpa) });
                      try {
                        await pool?.query(
                          `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                           values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                           on conflict (run_id, table_name, op, id_shop, id_lang)
                           do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                          [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, 'update', productId||null, SID||null, null, JSON.stringify({ field: 'price', source: 'from_pa' }) ]
                        );
                      } catch {}
                      try { chatLog?.('upsert_field', { table: T_PATTR_SHOP, run_id: ctx.run?.id, id_product: productId||null, id_shop: SID||null, id_lang: null, id_group: null, field: 'price', value: vpa }); } catch {}
                      try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, productId||null, SID||null, null, null, 'price', String(vpa)]); } catch {}
                    }
                  } catch {}
                }
              }
            } catch {}

            // Safety correction: if price on ps_product_attribute_shop remains NULL/0 but product_attribute.price is non-zero, sync it
            try {
              if (await hasColumn(T_PATTR_SHOP, 'price')) {
                const rps = await q(`SELECT ${qi('price')} as price FROM ${qi(T_PATTR_SHOP)} WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=? LIMIT 1`, [id_product_attribute, SID]);
                const cur = Array.isArray(rps) && rps.length ? rps[0]?.price : null;
                const curNum = Number(String(cur??'').replace(/,/g,'.').replace(/[^0-9.\-]/g,''));
                if (!Number.isFinite(curNum) || curNum === 0) {
                  const rpa2 = await q(`SELECT ${qi('price')} as price FROM ${qi(T_PATTR)} WHERE ${qi('id_product_attribute')}=? LIMIT 1`, [id_product_attribute]);
                  const vpa2 = (Array.isArray(rpa2) && rpa2.length) ? rpa2[0]?.price : null;
                  const n2 = Number(String(vpa2??'').replace(/,/g,'.').replace(/[^0-9.\-]/g,''));
                  if (Number.isFinite(n2) && n2 !== 0) {
                    await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${qi('price')}=? WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [n2, id_product_attribute, SID]);
                    chatLog?.('product_attribute_shop_price_sync_from_pa_if_zero', { id_product_attribute, shop: SID, price: n2 });
                    try { chatLog?.('upsert_field', { table: T_PATTR_SHOP, run_id: ctx.run?.id, id_product: productId||null, id_shop: SID||null, id_lang: null, id_group: null, field: 'price', value: n2 }); } catch {}
                    try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, productId||null, SID||null, null, null, 'price', String(n2)]); } catch {}
                  }
                }
              }
            } catch {}
          }
        } catch (e) { chatLog?.('variant_pattr_shop_map_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }
      }
    } catch (e) { chatLog?.('variant_pattr_shop_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }

      // Stock per combination per shop
      if (await hasTable(T_STOCK)) {
        for (const SID of (PAS_FIELDS_PRESENT ? SHOPS : [])) {
          try { await q(`INSERT INTO ${qi(T_STOCK)} (${[qi('id_product'),qi('id_product_attribute'),qi('id_shop'),qi('id_shop_group'),qi('quantity'),qi('out_of_stock')].join(',')}) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ${qi('quantity')}=VALUES(${qi('quantity')})`, [productId, id_product_attribute, SID, ID_SHOP_GROUP, 0, 0]); } catch (e) { chatLog?.('variant_stock_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }
        }
      }
      // Layered navigation linking (optional)
      try { if (await hasTable(T_LPA)) await q(`INSERT IGNORE INTO ${qi(T_LPA)} (${[qi('id_attribute'),qi('id_product'),qi('id_attribute_group'),qi('id_shop')].join(',')}) VALUES (?,?,?,?)`, [id_attr, productId, id_attribute_group, SHOPS[0]]); } catch {}
      isFirst = false;
    }

    // Map-all pass: apply product_attribute_shop mapping to all existing combinations
    try {
      const T_PATTR = PREFIX + 'product_attribute';
      const T_PATTR_SHOP = PREFIX + 'product_attribute_shop';
      const PFIELDS_SHOP_ALL = (mapping && mapping.tables && mapping.tables.product_attribute_shop && mapping.tables.product_attribute_shop.fields) ? mapping.tables.product_attribute_shop.fields : {};
      const keysAll = Object.keys(PFIELDS_SHOP_ALL||{});
      if (await hasTable(T_PATTR)) {
        try { chatLog?.('pattr_shop_map_all_enter', { product_id: productId, shops: SHOPS, keys: keysAll }); } catch {}
        const rows = await q(`SELECT ${qi('id_product_attribute')} as id_product_attribute FROM ${qi(T_PATTR)} WHERE ${qi('id_product')}=? ORDER BY ${qi('id_product_attribute')} ASC`, [productId]);
        for (const r of (Array.isArray(rows)? rows: [])) {
          const id_pa = Number(r?.id_product_attribute||0) || 0; if (!id_pa) continue;
          const PAS_FIELDS_PRESENT = !!(mapping && mapping.tables && mapping.tables.product_attribute_shop && mapping.tables.product_attribute_shop.fields && Object.keys(mapping.tables.product_attribute_shop.fields||{}).length);
          const PAS_SHOPS_LOCAL = Array.isArray(mapping?.tables?.product_attribute_shop?.settings?.id_shops) && mapping.tables.product_attribute_shop.settings.id_shops.length
            ? mapping.tables.product_attribute_shop.settings.id_shops
            : SHOPS;
          const SHOPS_FOR_PA = (Array.isArray(PAS_SHOPS_LOCAL) && PAS_SHOPS_LOCAL.length) ? PAS_SHOPS_LOCAL : SHOPS;
          for (const SID of SHOPS_FOR_PA) {
            // Always ensure base pas row exists; mapping fields may be applied below
            try { await q(`INSERT IGNORE INTO ${qi(T_PATTR_SHOP)} (${[qi('id_product'),qi('id_product_attribute'),qi('id_shop')].join(',')}) VALUES (?,?,?)`, [productId, id_pa, SID]); } catch {}
            const set = []; const vals = []; const colsApplied = [];
            const coerce = (k, val) => {
              if (val === '' || val === null || val === undefined) return val;
              // numeric-ish columns
              if (/^(price|weight|ecotax|unit_price_impact|wholesale_price)$/.test(String(k))) {
                const n = Number(String(val).replace(/,/g,'.').replace(/[^0-9.\-]/g,''));
                return Number.isFinite(n) ? n : val;
              }
              if (/^(default_on|minimal_quantity|low_stock_threshold|low_stock_alert)$/.test(String(k))) {
                const n = parseInt(String(val).replace(/[^0-9\-]/g,''),10); return Number.isFinite(n)? n : val;
              }
              return val;
            };
            // Provide a reasonable item context in map-all so item.* paths resolve for simple products
            const itemCtxAll = (result && typeof result==='object')
              ? (result.item || (Array.isArray(result?.variants?.items) && result.variants.items.length ? result.variants.items[0] : null) || result.variant || null)
              : null;
            for (const k of (keysAll || [])) {
              if (!k || k==='id_product' || k==='id_product_attribute' || k==='id_shop') continue;
              if (!(await hasColumn(T_PATTR_SHOP, k))) continue;
              const spec = PFIELDS_SHOP_ALL[k];
              const v = resolveSpec(result || {}, itemCtxAll || {}, spec);
              if (v === undefined || v === null) continue;
              set.push(qi(k)+'=?'); vals.push(coerce(k, v)); colsApplied.push(k);
            }
            // Trace always, even when no fields will apply (diagnostic)
            try {
              const priceDeclaredAll = Object.prototype.hasOwnProperty.call(PFIELDS_SHOP_ALL||{}, 'price');
              chatLog?.('pattr_shop_pass', {
                run_id: ctx.run?.id,
                mode: 'map_all',
                id_product: productId || null,
                id_product_attribute: id_pa,
                shop: SID,
                declared_keys: Array.isArray(keysAll) ? keysAll.length : 0,
                applied_keys: colsApplied.length,
                price_declared: !!priceDeclaredAll
              });
            } catch {}
            if (set.length) {
              await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${set.join(', ')} WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [...vals, id_pa, SID]);
              chatLog?.('product_attribute_shop_mapped_all', { id_product_attribute: id_pa, shop: SID, cols: colsApplied });
              try {
                await pool?.query(
                  `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                   on conflict (run_id, table_name, op, id_shop, id_lang)
                   do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                  [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, 'upsert', productId||null, SID||null, null, JSON.stringify({ cols: colsApplied, mode: 'map_all' }) ]
                );
              } catch {}
              try {
                for (let i=0;i<colsApplied.length;i++) {
                  const k = colsApplied[i]; const v = vals[i];
                  try { chatLog?.('upsert_field', { table: T_PATTR_SHOP, run_id: ctx.run?.id, id_product: productId||null, id_shop: SID||null, id_lang: null, id_group: null, field: String(k), value: v }); } catch {}
                  try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, productId||null, SID||null, null, null, String(k), (v==null? null : String(v))]); } catch {}
                }
              } catch {}
            }
          }
        }
      }
    } catch (e) { chatLog?.('pattr_shop_map_all_error', { run_id: ctx.run?.id, error: String(e?.message||e) }); }

    // If requested, force-create a minimal combination when none exist but defaults are provided
    try {
      const T_PATTR = PREFIX + 'product_attribute';
      const T_PATTR_SHOP = PREFIX + 'product_attribute_shop';
      const T_STOCK = PREFIX + 'stock_available';
      if (!firstCombinationId && forceCreateEmptyCombination && hasAttrs) {
        const hasAnyDefaults = (Object.keys(DEF_ATTR||{}).length > 0) || (Object.keys(DEF_ATTR_SHOP||{}).length > 0);
        if (hasAnyDefaults && (await hasTable(T_PATTR))) {
          let newPaId = 0;
          try {
            await q(`INSERT INTO ${qi(T_PATTR)} (${qi('id_product')}) VALUES (?)`, [productId]);
            const ir = await q('SELECT LAST_INSERT_ID() AS id');
            newPaId = Array.isArray(ir) && ir.length ? Number(ir[0].id||0) : 0;
            if (newPaId) {
              // Apply DEF_ATTR on the new combination
              const keysPA = Object.keys(DEF_ATTR||{});
              if (keysPA.length) {
                const set = []; const vals = [];
                const norm=(x)=>{ if (x === '') return ''; const s=String(x); if(s==='1'||s==='0') return Number(s); const n=Number(s); return Number.isFinite(n)?n:x; };
                for (const k of keysPA) {
                  if (!k || k==='id_product' || k==='id_product_attribute') continue;
                  if (!(await hasColumn(T_PATTR, k))) continue; set.push(qi(k)+'=?'); vals.push(norm(DEF_ATTR[k]));
                }
                if (set.length) await q(`UPDATE ${qi(T_PATTR)} SET ${set.join(', ')} WHERE ${qi('id_product_attribute')}=?`, [...vals, newPaId]);
              }
              // Ensure product_attribute_shop rows + DEF_ATTR_SHOP
              if (await hasTable(T_PATTR_SHOP)) {
                for (const SID of (PAS_FIELDS_PRESENT ? SHOPS : [])) {
                  try { await q(`INSERT IGNORE INTO ${qi(T_PATTR_SHOP)} (${[qi('id_product'),qi('id_product_attribute'),qi('id_shop')].join(',')}) VALUES (?,?,?)`, [productId, newPaId, SID]); } catch {}
                  const keysAS = Object.keys(DEF_ATTR_SHOP||{});
                  if (keysAS.length) {
                    const set = []; const vals = []; const norm=(x)=>{ if (x === '') return ''; const s=String(x); if(s==='1'||s==='0') return Number(s); const n=Number(s); return Number.isFinite(n)?n:x; };
                    for (const k of keysAS) { if (!k || k==='id_product' || k==='id_product_attribute' || k==='id_shop') continue; if (!(await hasColumn(T_PATTR_SHOP, k))) continue; set.push(qi(k)+'=?'); vals.push(norm(DEF_ATTR_SHOP[k])); }
                    if (set.length) { await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${set.join(', ')} WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [...vals, newPaId, SID]); }
                  }
                }
              }
              // Stock rows per shop (quantity 0 by default) if stock table exists
              if (await hasTable(T_STOCK)) {
                for (const SID of SHOPS) {
                  try { await q(`INSERT INTO ${qi(T_STOCK)} (${[qi('id_product'),qi('id_product_attribute'),qi('id_shop'),qi('id_shop_group'),qi('quantity'),qi('out_of_stock')].join(',')}) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE ${qi('quantity')}=VALUES(${qi('quantity')})`, [productId, newPaId, SID, ID_SHOP_GROUP, 0, 0]); } catch {}
                }
              }
              firstCombinationId = newPaId;
              chatLog?.('forced_min_combination_created', { product_id: productId, id_product_attribute: newPaId });
            }
          } catch (e) { chatLog?.('forced_min_combination_error', { product_id: productId, error: String(e?.message||e) }); }
        }
      }
    } catch {}

    // Apply DEF_ATTR to all combinations for this product with override for empty defaults
    try {
      if (!strictMappingOnly) {
        const T_PATTR = PREFIX + 'product_attribute';
        const keysPA = Object.keys(DEF_ATTR||{});
        if (keysPA.length && (await hasTable(T_PATTR))) {
          const setParts = [];
          const args = [];
          const norm=(x)=>{ if (x === '') return ''; const s=String(x); if(s==='1'||s==='0') return Number(s); const n=Number(s); return Number.isFinite(n)?n:x; };
          for (const k of keysPA) {
            if (!k || k==='id_product' || k==='id_product_attribute') continue;
            if (!(await hasColumn(T_PATTR, k))) continue;
            const v = DEF_ATTR[k];
            if (v === '') { setParts.push(`${qi(k)} = ''`); }
            else {
              const isStr = (typeof v === 'string');
              const cond = isStr ? `${qi(k)} IS NULL OR ${qi(k)}=''` : `${qi(k)} IS NULL`;
              setParts.push(`${qi(k)} = CASE WHEN ${cond} THEN ? ELSE ${qi(k)} END`);
              args.push(norm(v));
            }
          }
          if (setParts.length) { await q(`UPDATE ${qi(T_PATTR)} SET ${setParts.join(', ')} WHERE ${qi('id_product')}=?`, [...args, productId]); chatLog?.('product_attribute_defaults_backfill', { product_id: productId, cols: keysPA }); }
        }
      }
    } catch (e) { chatLog?.('variant_pattr_backfill_error', { product_id: productId, error: String(e?.message||e) }); }

    // Apply mapping.tables.product_attribute.fields across all combinations (template-level overrides)
    try {
      const T_PATTR = PREFIX + 'product_attribute';
      const PFIELDS = (mapping && mapping.tables && mapping.tables.product_attribute && mapping.tables.product_attribute.fields) ? mapping.tables.product_attribute.fields : {};
      const keys = Object.keys(PFIELDS||{});
      if (keys.length && (await hasTable(T_PATTR))) {
        const set = []; const vals = [];
        const eff = {};
        for (const col of keys) {
          if (!(await hasColumn(T_PATTR, col))) continue;
          const spec = PFIELDS[col];
          const v = resolveSpec(result || {}, null, spec);
          if (v === undefined || v === null) continue;
          if (v === '') {
            // For explicit empty string, avoid overriding non-empty values
            set.push(`${qi(col)} = CASE WHEN ${qi(col)} IS NULL OR ${qi(col)}='' THEN '' ELSE ${qi(col)} END`);
            eff[col] = '';
          } else {
            set.push(qi(col)+'=?'); vals.push(String(v));
            eff[col] = String(v);
          }
        }
        if (set.length) {
          await q(`UPDATE ${qi(T_PATTR)} SET ${set.join(', ')} WHERE ${qi('id_product')}=?`, [...vals, productId]);
          try {
            chatLog?.('product_attribute_mapped_all', { product_id: productId, cols: Object.keys(eff) });
            for (const [k,v] of Object.entries(eff)) {
              chatLog?.('upsert_field', { table: T_PATTR, run_id: ctx.run?.id, id_product: productId, field: k, value: v });
              try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, null, ctx.run?.page_type||null, T_PATTR, productId||null, null, null, null, String(k), (v==null? null : String(v))]); } catch {}
            }
          } catch {}
        }
      }
    } catch (e) { chatLog?.('variant_pattr_map_all_error', { product_id: productId, error: String(e?.message||e) }); }

    // Apply mapping.tables.product_attribute_shop.fields across all combinations per shop (template-level overrides)
    try {
      const T_PATTR_SHOP = PREFIX + 'product_attribute_shop';
      const T_PATTR = PREFIX + 'product_attribute';
      // Be robust to either flattened fields or nested mapping.fields
      const PASpecBlock = (mapping && mapping.tables && mapping.tables.product_attribute_shop) ? mapping.tables.product_attribute_shop : {};
      const PFIELDS_SHOP_ALL = (PASpecBlock && typeof PASpecBlock==='object')
        ? (PASpecBlock.fields || (PASpecBlock.mapping && PASpecBlock.mapping.fields) || {})
        : {};
      const fKeysAll = Object.keys(PFIELDS_SHOP_ALL||{});
      try { chatLog?.('pattr_shop_pass', { product_id: productId, shops: SHOPS, keys_all: fKeysAll }); } catch {}
      if (fKeysAll.length && (await hasTable(T_PATTR_SHOP))) {
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
        for (const SID of SHOPS) {
          // Start banner for this shop upsert block
          try { chatLog?.('pattr_shop_upsert_start', { banner: '-------------------', product_id: productId, shop: SID }); } catch {}
          const set = []; const vals = []; const eff = {};
          for (const col of fKeysAll) {
            if (String(col) === 'default_on') continue; // avoid breaking UNIQUE(id_product,id_shop,default_on)
            if (!col || col==='id_product' || col==='id_product_attribute' || col==='id_shop') continue;
            if (!(await hasColumn(T_PATTR_SHOP, col))) continue;
            const spec = PFIELDS_SHOP_ALL[col];
            // Resolve without variant item context; supports constants (e.g., =5) and product-level paths
            const v = resolveSpec(result || {}, null, spec);
            if (v === undefined || v === null) {
              // Special fallback for numeric mirrors: when mapping exists but cannot resolve without variant context,
              // copy the value from product_attribute for each combination (per shop)
              const PA_MIRROR_COLS = new Set(['price','weight','wholesale_price']);
              if (PA_MIRROR_COLS.has(String(col)) && Object.prototype.hasOwnProperty.call(PFIELDS_SHOP_ALL, col)) {
                try {
                  const rows = await q(`SELECT ${qi('id_product_attribute')}, ${qi(col)} AS v FROM ${qi(T_PATTR)} WHERE ${qi('id_product')}=?`, [productId]);
                  let updCount = 0;
                  for (const r of (rows||[])) {
                    const idpa = r?.id_product_attribute; const vpa = r?.v;
                    if (idpa == null || vpa == null) continue;
                    const n = Number(String(vpa).replace(/,/g,'.').replace(/[^0-9.\-]/g,''));
                    const nv = Number.isFinite(n) ? n : 0;
                    await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${qi(col)}=? WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=? AND ${qi('id_product')}=?`, [nv, idpa, SID, productId]);
                    updCount++;
                    try {
                      await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, productId||null, SID||null, null, null, String(col), String(nv)]);
                    } catch {}
                    // Read-back per row for diagnostics
                    try {
                      const rb = await q(`SELECT ${qi('price')}, ${qi('wholesale_price')}, ${qi('weight')}, ${qi('minimal_quantity')}, ${qi('default_on')} FROM ${qi(T_PATTR_SHOP)} WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=? AND ${qi('id_product')}=? LIMIT 1`, [idpa, SID, productId]);
                      const snap = Array.isArray(rb) && rb[0] ? rb[0] : null;
                      if (snap) {
                        try { chatLog?.('pas_readback', { product_id: productId, id_product_attribute: idpa, shop: SID, field: col, values: { price: String(snap.price), wholesale_price: String(snap.wholesale_price), weight: String(snap.weight), minimal_quantity: String(snap.minimal_quantity), default_on: String(snap.default_on) } }); } catch {}
                        try {
                          const pairs = Object.entries({ price: snap.price, wholesale_price: snap.wholesale_price, weight: snap.weight, minimal_quantity: snap.minimal_quantity, default_on: snap.default_on });
                          for (const [k,v] of pairs) {
                            await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, productId||null, SID||null, null, null, `post:${k}`, (v==null? null : String(v))]);
                          }
                        } catch {}
                      }
                    } catch {}
                  }
                  chatLog?.('product_attribute_shop_field_from_pa_all', { product_id: productId, shop: SID, field: col, updated: updCount });
                  try { chatLog?.('upsert_pas_mirror', { product_id: productId, shop: SID, field: col, count: updCount }); } catch {}
                  try {
                    await pool?.query(
                      `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
                       on conflict (run_id, table_name, op, id_shop, id_lang)
                       do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + EXCLUDED.count, updated_at=now()`,
                      [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, 'update', productId||null, SID||null, null, Math.max(1, updCount||0), JSON.stringify({ field:String(col) }) ]
                    );
                  } catch {}
                } catch {}
              }
              continue;
            }
            set.push(qi(col)+'=?');
            const vv = coerceForCol(col, v);
            vals.push(vv);
            eff[col] = vv;
          }
          if (set.length) {
            try {
              const rows = await q(`SELECT ${qi('id_product_attribute')} as idpa FROM ${qi(T_PATTR)} WHERE ${qi('id_product')}=?`, [productId]);
              const sql = `UPDATE ${qi(T_PATTR_SHOP)} SET ${set.join(', ')} WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=? AND ${qi('id_product')}=?`;
              let updCount = 0;
              for (const r of (rows||[])) {
                const idpa = Number(r?.idpa||0); if (!idpa) continue;
                await q(sql, [...vals, idpa, SID, productId]);
                updCount++;
                // One-shot read-back to diagnose post-update values
                try {
                  const rb = await q(`SELECT ${qi('price')}, ${qi('wholesale_price')}, ${qi('weight')}, ${qi('minimal_quantity')}, ${qi('default_on')} FROM ${qi(T_PATTR_SHOP)} WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=? AND ${qi('id_product')}=? LIMIT 1`, [idpa, SID, productId]);
                  const snap = Array.isArray(rb) && rb[0] ? rb[0] : null;
                  if (snap) {
                    try { chatLog?.('pas_readback', { product_id: productId, id_product_attribute: idpa, shop: SID, values: { price: String(snap.price), wholesale_price: String(snap.wholesale_price), weight: String(snap.weight), minimal_quantity: String(snap.minimal_quantity), default_on: String(snap.default_on) } }); } catch {}
                    try {
                      const pairs = Object.entries({ price: snap.price, wholesale_price: snap.wholesale_price, weight: snap.weight, minimal_quantity: snap.minimal_quantity, default_on: snap.default_on });
                      for (const [k,v] of pairs) {
                        await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, productId||null, SID||null, null, null, `post:${k}`, (v==null? null : String(v))]);
                      }
                    } catch {}
                  }
                } catch {}
              }
              // Log executed SQL for visibility
              try { chatLog?.('pattr_shop_sql', { product_id: productId, shop: SID, sql, updated: updCount }); } catch {}
              try {
                await pool?.query(
                  `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,sql_query,payload)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
                   on conflict (run_id, table_name, op, id_shop, id_lang)
                   do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + EXCLUDED.count, sql_query = EXCLUDED.sql_query, updated_at=now()`,
                  [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, 'update', productId||null, SID||null, null, Math.max(1, updCount||0), String(sql), JSON.stringify({ cols: Object.keys(eff||{}) }) ]
                );
              } catch {}
            } catch {}
            try {
              chatLog?.('product_attribute_shop_mapped_all', { product_id: productId, shop: SID, cols: Object.keys(eff) });
              for (const [k,v] of Object.entries(eff)) {
                try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, null, ctx.run?.page_type||null, T_PATTR_SHOP, productId||null, SID||null, null, null, String(k), (v==null? null : String(v))]); } catch {}
              }
            } catch {}
          }
          // End banner for this shop upsert block
          try { chatLog?.('pattr_shop_upsert_end', { banner: '-------------------', product_id: productId, shop: SID }); } catch {}
        }
      }
    } catch (e) { chatLog?.('variant_pattr_shop_map_all_error', { product_id: productId, error: String(e?.message||e) }); }

    // Final guard: in strict mapping mode, ensure shop price mirrors combination price when still zero
    // This applies only where pas.price IS NULL or = 0 to avoid overwriting valid shop overrides.
    try {
      if (strictMappingOnly) {
        const T_PATTR = PREFIX + 'product_attribute';
        const T_PATTR_SHOP = PREFIX + 'product_attribute_shop';
        if (await hasTable(T_PATTR_SHOP) && await hasTable(T_PATTR) && await hasColumn(T_PATTR_SHOP,'price') && await hasColumn(T_PATTR,'price')) {
          for (const SID of SHOPS) {
            try {
              const rows = await q(
                `SELECT pas.${qi('id_product_attribute')} AS id_pa, pa.${qi('price')} AS price
                   FROM ${qi(T_PATTR_SHOP)} pas
                   JOIN ${qi(T_PATTR)} pa ON pa.${qi('id_product_attribute')} = pas.${qi('id_product_attribute')}
                  WHERE pas.${qi('id_product')}=? AND pas.${qi('id_shop')}=?`,
                [productId, SID]
              );
              for (const r of (rows||[])) {
                const idpa = r?.id_pa; const vpa = r?.price;
                if (idpa == null || vpa == null) continue;
                const n = Number(String(vpa).replace(/,/g,'.').replace(/[^0-9.\-]/g,''));
                const nv = Number.isFinite(n) ? n : 0;
                await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${qi('price')}=? WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [nv, idpa, SID]);
                try {
                  await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, productId||null, SID||null, null, null, 'price', String(nv)]);
                } catch {}
              }
              try {
                await pool?.query(
                  `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                   values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                   on conflict (run_id, table_name, op, id_shop, id_lang)
                   do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                  [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, 'update', productId||null, SID||null, null, JSON.stringify({ field:'price', mode:'sync_from_pa_all' }) ]
                );
              } catch {}
            } catch (e) { chatLog?.('product_attribute_shop_sync_price_error', { product_id: productId, shop: SID, error: String(e?.message||e) }); }
          }
        }
      }
    } catch (e) { chatLog?.('product_attribute_shop_sync_price_failed', { product_id: productId, error: String(e?.message||e) }); }

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
        // Also set default_on in product_attribute and product_attribute_shop
        try {
          const T_PATTR = PREFIX + 'product_attribute';
          const T_PATTR_SHOP = PREFIX + 'product_attribute_shop';
          if (await hasTable(T_PATTR) && await hasColumn(T_PATTR, 'default_on')) {
            await q(`UPDATE ${qi(T_PATTR)} SET ${qi('default_on')}=NULL WHERE ${qi('id_product')}=?`, [productId]);
            await q(`UPDATE ${qi(T_PATTR)} SET ${qi('default_on')}=1 WHERE ${qi('id_product_attribute')}=?`, [firstCombinationId]);
            try {
              await pool?.query(
                `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                 values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                 on conflict (run_id, table_name, op, id_shop, id_lang)
                 do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR, 'update', productId||null, null, null, JSON.stringify({ field:'default_on' }) ]
              );
            } catch {}
            try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR, productId||null, null, null, null, 'default_on', '1']); } catch {}
          }
          if (await hasTable(T_PATTR_SHOP) && await hasColumn(T_PATTR_SHOP, 'default_on')) {
            for (const SID of SHOPS) {
              try {
                await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${qi('default_on')}=NULL WHERE ${qi('id_product')}=? AND ${qi('id_shop')}=?`, [productId, SID]);
                await q(`UPDATE ${qi(T_PATTR_SHOP)} SET ${qi('default_on')}=1 WHERE ${qi('id_product_attribute')}=? AND ${qi('id_shop')}=?`, [firstCombinationId, SID]);
                try {
                  await pool?.query(
                    `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
                     on conflict (run_id, table_name, op, id_shop, id_lang)
                     do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
                    [ ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, 'update', productId||null, SID||null, null, JSON.stringify({ field:'default_on' }) ]
                  );
                } catch {}
                try { await pool?.query(`insert into public.mod_grabbing_sensorex_upsert_field_logs(run_id,domain,page_type,table_name,product_id,id_shop,id_lang,id_group,field,value) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [ctx.run?.id||null, ctx.domain||null, ctx.run?.page_type||null, T_PATTR_SHOP, productId||null, SID||null, null, null, 'default_on', '1']); } catch {}
              } catch {}
            }
          }
        } catch {}
        chatLog?.('variant_default_set', { run_id: ctx.run?.id, product_id: productId, id_product_attribute: firstCombinationId });
      }
    } catch {}
  } catch (e) {
    chatLog?.('transfer_error', { run_id: ctx.run?.id, error: 'variants_failed: '+String(e?.message||e) });
    try {
      await pool?.query(
        `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [ctx?.run?.id||null, ctx?.domain||null, ctx?.run?.page_type||null, (ctx?.PREFIX||'ps_')+'product_attribute', 'pipeline', ctx?.productId||null, String(e?.message||e), JSON.stringify({})]
      );
    } catch {}
  }
}

export default runAttributesWriter;
