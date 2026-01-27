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

    const hasFeatureTables = await hasTable(T_FEATURE) && await hasTable(T_FEATURE_LANG) && await hasTable(T_FEATURE_VALUE) && await hasTable(T_FEATURE_VALUE_LANG) && await hasTable(LINK_TABLE);
    if (!hasFeatureTables) return;
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

    const attrs = Array.isArray(result?.attributes) ? result.attributes : [];
    const addProps = Array.isArray(result?.json_ld?.raw?.additionalProperty) ? result.json_ld.raw.additionalProperty : [];
    const addPairs = addProps.map(p => ({ name: (p && (p.name || p.propertyID || p['@id'])) ? String(p.name || p.propertyID || p['@id']) : '', value: (p && (p.value || p.description)) ? String(p.value || p.description) : '' })).filter(x => (x.name || x.value));

    const wanted = [
      { key:'reference', aliases:['référence produit', 'référence', 'reference'], extract:'token' },
      { key:'dimensions', aliases:['dimensions'], extract:'raw' },
      { key:'poids', aliases:['poids'], extract:'raw' },
      { key:'compatibilité', aliases:['compatibilité', 'compatibilite'], extract:'raw' },
    ];

    const pairs = [];
    // Collect wanted from attributes
    for (const w of wanted) {
      const row = attrs.find(a => {
        const nm = String(a?.name||'').toLowerCase().replace(/\s*:$/, '').trim();
        return w.aliases.some(al => nm.includes(al));
      });
      if (!row) continue;
      let val = String(row?.value||'').trim();
      if (w.extract==='token') { const m = val.match(/([A-Za-z0-9._\-]{2,})\s*$/); val = (m && m[1]) ? m[1] : val; }
      const nm = String(row?.name||'').replace(/\s*:$/, '').trim();
      if (!nm || !val) continue;
      pairs.push({ name: nm, value: val, source: 'attributes' });
    }
    // Merge JSON-LD
    for (const p of addPairs) { const nm = String(p.name||'').trim(); const val = String(p.value||'').trim(); if (!nm || !val) continue; pairs.push({ name:nm, value:val, source:'json_ld' }); }

    const seen = new Set();
    for (const pair of pairs) {
      const key = pair.name+'||'+pair.value;
      if (seen.has(key)) continue; seen.add(key);
      const featureName = pair.name; const valueText = pair.value;
      // ensure feature by name
      let id_feature = 0;
      try {
        const r = await q(`SELECT f.${qi('id_feature')} FROM ${qi(T_FEATURE)} f JOIN ${qi(T_FEATURE_LANG)} fl ON fl.${qi('id_feature')}=f.${qi('id_feature')} WHERE fl.${qi('name')}=? LIMIT 1`, [featureName]);
        if (Array.isArray(r) && r.length) id_feature = Number(r[0].id_feature)||0;
      } catch {}
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
            for (const SID of SHOPS_FEAT) { try { await q(`INSERT IGNORE INTO ${qi(T_FEATURE_SHOP)} (${[qi('id_feature'),qi('id_shop')].join(',')}) VALUES (?,?)`, [id_feature, SID]); } catch {} }
          }
          chatLog?.('feature_create', { run_id: run?.id, id_feature, name: featureName });
        } catch (e) {
          chatLog?.('feature_error', { run_id: run?.id, error: String(e?.message||e) });
          try {
            await pool?.query(
              `insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
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
              `insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
              [run?.id||null, domain||null, run?.page_type||null, PREFIX+'feature_value', 'create_value', productId||null, String(e?.message||e), JSON.stringify({ id_feature, value: valueText })]
            );
          } catch {}
          continue; }
      }

      // link product -> feature_value
      try { await q(`INSERT IGNORE INTO ${qi(LINK_TABLE)} (${[qi('id_product'),qi('id_feature'),qi('id_feature_value')].join(',')}) VALUES (?,?,?)`, [productId, id_feature, id_feature_value]); chatLog?.('product_feature_upsert', { run_id: run?.id, id_product: productId, id_feature, id_feature_value, source: pair.source }); } catch (e) { chatLog?.('product_feature_error', { run_id: run?.id, error: String(e?.message||e), source: pair.source }); try { await pool?.query(`insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [run?.id||null, domain||null, run?.page_type||null, LINK_TABLE, 'link', productId||null, String(e?.message||e), JSON.stringify({ id_feature, id_feature_value })]); } catch {} }
    }
  } catch (e) {
    chatLog?.('transfer_error', { run_id: run?.id, error: 'features_failed: '+String(e?.message||e) });
    try { await pool?.query(`insert into public.mod_grabbing_jerome_send_to_presta_error_logs(run_id,domain,page_type,table_name,op,product_id,error,payload) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [run?.id||null, domain||null, run?.page_type||null, PREFIX+'feature', 'pipeline', productId||null, String(e?.message||e), JSON.stringify({})]); } catch {}
  }
}

export default runFeaturesWriter;
