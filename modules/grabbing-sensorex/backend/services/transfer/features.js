// Features writer
// Maps attributes and JSON-LD additionalProperty into Presta features + values, and links to product

export async function runFeaturesWriter(ctx = {}) {
  const {
    q, qi, hasTable,
    pool, chatLog,
    PREFIX = 'ps_',
    productId = 0,
    SHOPS = [], ID_LANG = 1,
    TABLES = {},
    result = {}, domain = '', run = {},
    // Always preserve symbols; toggle removed
    keepSymbols = true,
  } = ctx;

  try {
    if (!productId) return;
    const T_FEATURE = PREFIX + 'feature';
    const T_FEATURE_LANG = PREFIX + 'feature_lang';
    const T_FEATURE_VALUE = PREFIX + 'feature_value';
    const T_FEATURE_VALUE_LANG = PREFIX + 'feature_value_lang';
    const T_FEATURE_SHOP = PREFIX + 'feature_shop';
    let LINK_TABLE = PREFIX + 'product_feature';
    if (!(await hasTable(LINK_TABLE)) && await hasTable(PREFIX + 'feature_product')) LINK_TABLE = PREFIX + 'feature_product';

    // Diagnostics: check required tables individually and log a compact snapshot
    const _exists = {
      feature: await hasTable(T_FEATURE),
      feature_lang: await hasTable(T_FEATURE_LANG),
      feature_value: await hasTable(T_FEATURE_VALUE),
      feature_value_lang: await hasTable(T_FEATURE_VALUE_LANG),
      link: await hasTable(LINK_TABLE),
      link_table: LINK_TABLE,
    };
    try { chatLog?.('features_tables', { run_id: run?.id, ..._exists }); } catch {}
    const hasFeatureTables = _exists.feature && _exists.feature_lang && _exists.feature_value && _exists.feature_value_lang && _exists.link;
    if (!hasFeatureTables) {
      try { chatLog?.('features_tables_missing', { run_id: run?.id, ..._exists }); } catch {}
      try {
        await pool?.query(
          `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [ run?.id||null, domain||null, run?.page_type||null, PREFIX+'feature', 'features_tables_missing', productId||null, 'missing_required_tables', JSON.stringify(_exists) ]
        );
      } catch {}
      return;
    }
    const hasFeatureShop = await hasTable(T_FEATURE_SHOP);

    // languages for *_lang tables (prefer per-table id_langs)
    let FEAT_LANGS = [];
    const TSET_FEAT_LANG = (TABLES.feature_lang && typeof TABLES.feature_lang.settings==='object') ? TABLES.feature_lang.settings : {};
    const TSET_FEAT_VAL_LANG = (TABLES.feature_value_lang && typeof TABLES.feature_value_lang.settings==='object') ? TABLES.feature_value_lang.settings : {};
    const PREF_LANGS = (Array.isArray(TSET_FEAT_LANG?.id_langs) && TSET_FEAT_LANG.id_langs.length)
      ? TSET_FEAT_LANG.id_langs
      : (Array.isArray(TSET_FEAT_VAL_LANG?.id_langs) && TSET_FEAT_VAL_LANG.id_langs.length)
        ? TSET_FEAT_VAL_LANG.id_langs
        : [];
    try {
      if (PREF_LANGS.length) {
        FEAT_LANGS = PREF_LANGS.map(n=>Number(n)||0).filter(n=>n>0);
      } else {
        const T_LANG = PREFIX + 'lang';
        if (await hasTable(T_LANG)) {
          const rows = await q(`SELECT ${qi('id_lang')} as id_lang FROM ${qi(T_LANG)} WHERE ${qi('active')}=1`);
          const ids = Array.isArray(rows) ? rows.map(r=>Number(r.id_lang)||0).filter(n=>n>0) : [];
          FEAT_LANGS = ids.length ? ids : [ID_LANG];
        } else {
          FEAT_LANGS = [ID_LANG];
        }
      }
    } catch { FEAT_LANGS = [ID_LANG]; }
    try { chatLog?.('features_langs', { run_id: run?.id, langs: FEAT_LANGS }); } catch {}

    // Basic unicode/whitespace normalizer; optionally keep symbols when requested
    const normalizeText = (s='') => {
      try {
        let t = String(s);
        t = t.replace(/\u00A0/g, ' ');            // nbsp → space
        t = t.replace(/[\u2013\u2014]/g, '-');    // – — → -
        t = t.replace(/[\u2018\u2019]/g, "'");   // ‘ ’ → '
        t = t.replace(/[\u201C\u201D]/g, '"');   // “ ” → "
        t = t.replace(/\u00D7/g, 'x');            // × → x
        if (!keepSymbols) {
          // Remove Registered mark and normalize degree symbol
          t = t.replace(/[\u00AE]/g, '');           // ® → ''
          t = t.replace(/[\u00B0]/g, ' deg ');      // ° → ' deg '
          t = t.replace(/\bdeg\s*(C|F)\b/gi, 'deg $1'); // degC/degF → deg C / deg F
          // Greek omega to ASCII 'Ohm' for materials/units
          t = t.replace(/[\u03A9\u03C9]/g, 'Ohm');
        }
        t = t.replace(/\s+/g, ' ').trim();        // collapse whitespace
        // Common scientific name fix: "p H" → "pH"
        t = t.replace(/\bp\s*h\b/gi, (m)=> m.replace(/\s+/g,''));
        return t;
      } catch { return String(s||''); }
    };
    const clamp = (s, max=255) => {
      try { const str = String(s||''); return str.length>max ? str.slice(0,max) : str; } catch { return s; }
    };

    const attrs = Array.isArray(result?.attributes) ? result.attributes : [];
    const addProps = Array.isArray(result?.json_ld?.raw?.additionalProperty) ? result.json_ld.raw.additionalProperty : [];
    const addPairs = addProps.map(p => ({ name: (p && (p.name || p.propertyID || p['@id'])) ? String(p.name || p.propertyID || p['@id']) : '', value: (p && (p.value || p.description)) ? String(p.value || p.description) : '' })).filter(x => (x.name || x.value));

    // Build feature pairs from all extracted attributes (name/value),
    // plus JSON-LD additionalProperty. Keep a few normalizations so common
    // fields like Reference/Dimensions are usable as-is.
    const pairs = [];
    for (const a of attrs) {
      try {
        const nm = normalizeText(String((a && a.name) || '').replace(/\s*:$/, '').trim());
        let val = normalizeText(String((a && a.value) || '').trim());
        if (!nm || !val) continue;
        pairs.push({ name: clamp(nm,255), value: clamp(val,255), source: 'attributes' });
      } catch {}
    }
    // Merge JSON-LD key-value style props
    for (const p of addPairs) {
      const nm = clamp(normalizeText(String(p.name||'').trim()),255);
      const val = clamp(normalizeText(String(p.value||'').trim()),255);
      if (!nm || !val) continue;
      pairs.push({ name:nm, value:val, source:'json_ld' });
    }

    // Diagnostics: log pairs count (attributes + json_ld)
    try { chatLog?.('features_pairs_count', { run_id: run?.id, total: pairs.length, attrs: attrs.length, json_ld: addPairs.length }); } catch {}
    if (!pairs.length) {
      try {
        await pool?.query(
          `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [ run?.id||null, domain||null, run?.page_type||null, PREFIX+'feature', 'features_no_pairs', productId||null, 'no_feature_pairs', JSON.stringify({ attrs: attrs.length, json_ld: addPairs.length }) ]
        );
      } catch {}
      // Nothing to do
      return;
    }

    const seen = new Set();
    for (const pair of pairs) {
      const key = pair.name+'||'+pair.value;
      if (seen.has(key)) continue; seen.add(key);
      const featureName = clamp(normalizeText(pair.name),255);
      const valueText = clamp(normalizeText(pair.value),255);
      // ensure feature by name
      let id_feature = 0;
      try {
        const r = await q(`SELECT f.${qi('id_feature')} FROM ${qi(T_FEATURE)} f JOIN ${qi(T_FEATURE_LANG)} fl ON fl.${qi('id_feature')}=f.${qi('id_feature')} WHERE fl.${qi('name')}=? LIMIT 1`, [featureName]);
        if (Array.isArray(r) && r.length) id_feature = Number(r[0].id_feature)||0;
      } catch {}
      // If the feature already exists, ensure it is scoped to all target shops when feature_shop is present
      try {
        if (id_feature && hasFeatureShop) {
          const TSET_FEAT_SHOP = (TABLES.feature_shop && typeof TABLES.feature_shop.settings==='object') ? TABLES.feature_shop.settings : {};
          const SHOPS_FEAT = (Array.isArray(TSET_FEAT_SHOP?.id_shops) && TSET_FEAT_SHOP.id_shops.length)
            ? TSET_FEAT_SHOP.id_shops.map(n=>Number(n)||0).filter(n=>n>0)
            : SHOPS;
          try { chatLog?.('features_shops', { run_id: run?.id, shops: SHOPS_FEAT }); } catch {}
          for (const SID of (SHOPS_FEAT||[])) { try { await q(`INSERT IGNORE INTO ${qi(T_FEATURE_SHOP)} (${[qi('id_feature'),qi('id_shop')].join(',')}) VALUES (?,?)`, [id_feature, SID]); } catch {} }
        }
      } catch {}
      if (!id_feature) {
        // Fallback search for legacy tokens (Ω/°/®) before normalization
        try {
          const altSet = new Set();
          try { altSet.add(String(featureName).replace(/\bOhm\b/gi, 'Ω')); } catch {}
          try { altSet.add(String(featureName).replace(/\bdeg\s*(C|F)\b/gi, '°$1')); } catch {}
          try { altSet.add(String(featureName)+'®'); } catch {}
          for (const alt of altSet) {
            if (!alt || alt === featureName) continue;
            const r2 = await q(`SELECT f.${qi('id_feature')} FROM ${qi(T_FEATURE)} f JOIN ${qi(T_FEATURE_LANG)} fl ON fl.${qi('id_feature')}=f.${qi('id_feature')} WHERE fl.${qi('name')}=? LIMIT 1`, [alt]);
            if (Array.isArray(r2) && r2.length) { id_feature = Number(r2[0].id_feature)||0; if (id_feature) break; }
          }
        } catch {}
      }
      if (!id_feature) {
        try {
          await q(`INSERT INTO ${qi(T_FEATURE)} (${[qi('position')].join(',')}) VALUES (0)`);
          const ir = await q('SELECT LAST_INSERT_ID() AS id');
          id_feature = Number((ir && ir[0] && ir[0].id) || 0) || 0;
          for (const L of FEAT_LANGS) {
            try { await q(`INSERT INTO ${qi(T_FEATURE_LANG)} (${[qi('id_feature'),qi('id_lang'),qi('name')].join(',')}) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ${qi('name')}=VALUES(${qi('name')})`, [id_feature, L, featureName]); } catch {}
          }
          if (hasFeatureShop) {
            const TSET_FEAT_SHOP = (TABLES.feature_shop && typeof TABLES.feature_shop.settings==='object') ? TABLES.feature_shop.settings : {};
            const SHOPS_FEAT = (Array.isArray(TSET_FEAT_SHOP?.id_shops) && TSET_FEAT_SHOP.id_shops.length)
              ? TSET_FEAT_SHOP.id_shops.map(n=>Number(n)||0).filter(n=>n>0)
              : SHOPS;
            try { chatLog?.('features_shops', { run_id: run?.id, shops: SHOPS_FEAT }); } catch {}
            for (const SID of SHOPS_FEAT) { try { await q(`INSERT IGNORE INTO ${qi(T_FEATURE_SHOP)} (${[qi('id_feature'),qi('id_shop')].join(',')}) VALUES (?,?)`, [id_feature, SID]); } catch {} }
          }
          chatLog?.('feature_create', { run_id: run?.id, id_feature, name: featureName });
        } catch (e) {
          chatLog?.('feature_error', { run_id: run?.id, error: String(e?.message||e) });
          try {
            await pool?.query(
              `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
              [run?.id||null, domain||null, run?.page_type||null, PREFIX+'feature', 'create_feature', productId||null, String(e?.message||e), JSON.stringify({ name: featureName })]
            );
          } catch {}
          continue; }
      }

      // ensure value exists
      let id_feature_value = 0;
      try {
        const r = await q(`SELECT v.${qi('id_feature_value')} FROM ${qi(T_FEATURE_VALUE)} v JOIN ${qi(T_FEATURE_VALUE_LANG)} vl ON vl.${qi('id_feature_value')}=v.${qi('id_feature_value')} WHERE v.${qi('id_feature')}=? AND vl.${qi('value')}=? LIMIT 1`, [id_feature, valueText]);
        if (Array.isArray(r) && r.length) id_feature_value = Number(r[0].id_feature_value)||0;
      } catch {}
      if (!id_feature_value) {
        // Fallback search for legacy tokens before normalization (Ω/°/®)
        try {
          const altSetV = new Set();
          try { altSetV.add(String(valueText).replace(/\bOhm\b/gi, 'Ω')); } catch {}
          try { altSetV.add(String(valueText).replace(/\bdeg\s*(C|F)\b/gi, '°$1')); } catch {}
          try { altSetV.add(String(valueText)+'®'); } catch {}
          for (const alt of altSetV) {
            if (!alt || alt === valueText) continue;
            const r2 = await q(`SELECT v.${qi('id_feature_value')} FROM ${qi(T_FEATURE_VALUE)} v JOIN ${qi(T_FEATURE_VALUE_LANG)} vl ON vl.${qi('id_feature_value')}=v.${qi('id_feature_value')} WHERE v.${qi('id_feature')}=? AND vl.${qi('value')}=? LIMIT 1`, [id_feature, alt]);
            if (Array.isArray(r2) && r2.length) { id_feature_value = Number(r2[0].id_feature_value)||0; if (id_feature_value) break; }
          }
        } catch {}
      }
      if (!id_feature_value) {
        try {
          await q(`INSERT INTO ${qi(T_FEATURE_VALUE)} (${[qi('id_feature'),qi('custom')].join(',')}) VALUES (?,?)`, [id_feature, 0]);
          const ir = await q('SELECT LAST_INSERT_ID() AS id');
          id_feature_value = Number((ir && ir[0] && ir[0].id) || 0) || 0;
          for (const L of FEAT_LANGS) {
            try { await q(`INSERT INTO ${qi(T_FEATURE_VALUE_LANG)} (${[qi('id_feature_value'),qi('id_lang'),qi('value')].join(',')}) VALUES (?,?,?) ON DUPLICATE KEY UPDATE ${qi('value')}=VALUES(${qi('value')})`, [id_feature_value, L, valueText]); } catch {}
          }
        } catch (e) {
          chatLog?.('feature_value_error', { run_id: run?.id, error: String(e?.message||e) });
          try {
            await pool?.query(
              `insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
              [run?.id||null, domain||null, run?.page_type||null, PREFIX+'feature_value', 'create_value', productId||null, String(e?.message||e), JSON.stringify({ id_feature, value: valueText })]
            );
          } catch {}
          continue; }
      }

      // link product -> feature_value
      try {
        await q(`INSERT IGNORE INTO ${qi(LINK_TABLE)} (${[qi('id_product'),qi('id_feature'),qi('id_feature_value')].join(',')}) VALUES (?,?,?)`, [productId, id_feature, id_feature_value]);
        chatLog?.('product_feature_upsert', { run_id: run?.id, id_product: productId, id_feature, id_feature_value, source: pair.source });
        try {
          await pool?.query(
            `insert into public.mod_grabbing_sensorex_send_to_presta_success_logs(run_id,domain,page_type,table_name,op,product_id,id_shop,id_lang,count,payload)
             values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9::jsonb)
             on conflict (run_id, table_name, op, id_shop, id_lang)
             do update set count = public.mod_grabbing_sensorex_send_to_presta_success_logs.count + 1, updated_at=now()`,
            [ run?.id||null, domain||null, run?.page_type||null, LINK_TABLE, 'link', productId||null, null, null, JSON.stringify({}) ]
          );
        } catch {}
      } catch (e) {
        chatLog?.('product_feature_error', { run_id: run?.id, error: String(e?.message||e), source: pair.source });
        try { await pool?.query(`insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [run?.id||null, domain||null, run?.page_type||null, LINK_TABLE, 'link', productId||null, String(e?.message||e), JSON.stringify({ id_feature, id_feature_value })]); } catch {}
      }
    }
  } catch (e) {
    chatLog?.('transfer_error', { run_id: run?.id, error: 'features_failed: '+String(e?.message||e) });
    try { await pool?.query(`insert into public.mod_grabbing_sensorex_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [run?.id||null, domain||null, run?.page_type||null, PREFIX+'feature', 'pipeline', productId||null, String(e?.message||e), JSON.stringify({})]); } catch {}
  }
}

export default runFeaturesWriter;
