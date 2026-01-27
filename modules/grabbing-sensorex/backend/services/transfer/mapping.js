// Mapping + settings resolution helpers for the send pipeline

export async function resolveProfileId(_pool, _domain, explicitProfileId) {
  // Domains.config_transfert removed; mapping_tools is the source of truth and is resolved elsewhere.
  const profileId = explicitProfileId != null ? Number(explicitProfileId) : null;
  return { profileId, configTransfert: {} };
}

export function resolvePrefix(_ct = {}, mapping = {}) {
  // Prefer mapping.prefix; default to ps_
  return String(mapping.prefix || 'ps_');
}

export async function loadTableSettings(pool, domain, pageType) {
  const result = { TSET_PRODUCT: {}, TSET_SHOP: {}, TSET_LANG: {}, TSET_STOCK: {}, TSET_ANY: {}, MFIELDS: {}, MDEF: {}, TDEF_STOCK_TBL: {} };
  const norm = (s='') => String(s||'').toLowerCase().replace(/^www\./,'');
  const dkey = norm(domain);
  try {
    // Prefer mapping.tools config (authoritative)
    const rMap = await pool.query(
      `select config from public.mod_grabbing_sensorex_maping_tools
         where regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') and lower(page_type)=lower($2)
         order by version desc, updated_at desc limit 1`,
      [dkey, pageType]
    );
    if (rMap.rowCount && rMap.rows[0]?.config && typeof rMap.rows[0].config==='object') {
      const cfg = rMap.rows[0].config || {};
      const tbl = (cfg.tables && typeof cfg.tables==='object') ? cfg.tables : {};
      for (const [name, block] of Object.entries(tbl)) {
        const t = String(name||'').toLowerCase();
        const settings = block && typeof block==='object' ? (block.settings || {}) : {};
        const mapping = block && typeof block==='object' ? (block.mapping || {}) : {};
        if (t === 'product' && settings && typeof settings==='object') result.TSET_PRODUCT = { ...result.TSET_PRODUCT, ...settings };
        if (t === 'product_shop' && settings && typeof settings==='object') result.TSET_SHOP = { ...result.TSET_SHOP, ...settings };
        if (t === 'product_lang' && settings && typeof settings==='object') result.TSET_LANG = { ...result.TSET_LANG, ...settings };
        if (t === 'stock_available' && settings && typeof settings==='object') result.TSET_STOCK = { ...result.TSET_STOCK, ...settings };
        if (t) {
          try { if (t === 'image' && block.setting_image && typeof block.setting_image==='object') result.TSET_ANY['image'] = block.setting_image; } catch {}
          if (settings && typeof settings==='object') result.TSET_ANY[t] = { ...(result.TSET_ANY[t]||{}), ...settings };
        }
        try { if (mapping && typeof mapping==='object' && mapping.fields && typeof mapping.fields==='object') result.MFIELDS[t] = mapping.fields; } catch {}
      }
    } else {
      // Fallback: legacy per-table rows
      const rows = await pool.query(`SELECT table_name, settings, mapping, setting_image FROM public.mod_grabbing_sensorex_table_settings WHERE regexp_replace(lower(domain),'^www\\.','')=regexp_replace(lower($1),'^www\\.','') AND lower(page_type)=lower($2)`, [dkey, pageType]);
      const map = new Map((rows.rows || []).map(r => [String(r.table_name || '').toLowerCase(), r.settings || {}]));
      if (map.has('product')) result.TSET_PRODUCT = { ...result.TSET_PRODUCT, ...(map.get('product') || {}) };
      if (map.has('product_shop')) result.TSET_SHOP = { ...result.TSET_SHOP, ...(map.get('product_shop') || {}) };
      if (map.has('product_lang')) result.TSET_LANG = { ...result.TSET_LANG, ...(map.get('product_lang') || {}) };
      if (map.has('stock_available')) result.TSET_STOCK = { ...result.TSET_STOCK, ...(map.get('stock_available') || {}) };
      for (const r of (rows.rows || [])) {
        const t = String(r.table_name || '').toLowerCase();
        try { if (r.mapping && typeof r.mapping === 'object' && r.mapping.fields && typeof r.mapping.fields === 'object') result.MFIELDS[t] = r.mapping.fields; } catch {}
        try {
          if (t === 'image' && r.setting_image && typeof r.setting_image === 'object') {
            result.TSET_ANY['image'] = r.setting_image;
          } else if (t && r.settings && typeof r.settings === 'object') {
            result.TSET_ANY[t] = r.settings;
          }
        } catch {}
      }
    }
  } catch { /* ignore */ }
  return result;
}
