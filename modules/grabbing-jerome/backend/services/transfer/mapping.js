// Mapping + settings resolution helpers for the send pipeline

export async function resolveProfileId(pool, domain, explicitProfileId) {
  let profileId = explicitProfileId != null ? Number(explicitProfileId) : null;
  if (!profileId && domain) {
    try {
      const d = await pool.query(`select config_transfert from public.mod_grabbing_jerome_domains where domain=$1`, [domain]);
      const ct = d.rowCount ? (d.rows[0]?.config_transfert || {}) : {};
      if (ct && typeof ct === 'object' && ct.db_mysql_profile_id) profileId = Number(ct.db_mysql_profile_id) || null;
      return { profileId, configTransfert: ct };
    } catch { /* ignore */ }
  }
  return { profileId, configTransfert: {} };
}

export function resolvePrefix(ct = {}, mapping = {}) {
  const DEFAULT = String(((ct && (ct.db_mysql_prefix || ct.db_prefix)) || 'ps_'));
  return String(mapping.prefix || DEFAULT || 'ps_');
}

export async function loadTableSettings(pool, domain, pageType) {
  const result = { TSET_PRODUCT: {}, TSET_SHOP: {}, TSET_LANG: {}, TSET_STOCK: {}, TSET_ANY: {}, MFIELDS: {}, MDEF: {}, TDEF_STOCK_TBL: {} };
  try {
    const rows = await pool.query(`SELECT table_name, settings, mapping, setting_image FROM public.mod_grabbing_jerome_table_settings WHERE domain=$1 AND lower(page_type)=lower($2)`, [domain, pageType]);
    const map = new Map((rows.rows || []).map(r => [String(r.table_name || '').toLowerCase(), r.settings || {}]));
    if (map.has('product')) result.TSET_PRODUCT = { ...result.TSET_PRODUCT, ...(map.get('product') || {}) };
    if (map.has('product_shop')) result.TSET_SHOP = { ...result.TSET_SHOP, ...(map.get('product_shop') || {}) };
    if (map.has('product_lang')) result.TSET_LANG = { ...result.TSET_LANG, ...(map.get('product_lang') || {}) };
    if (map.has('stock_available')) result.TSET_STOCK = { ...result.TSET_STOCK, ...(map.get('stock_available') || {}) };
    for (const r of (rows.rows || [])) {
      const t = String(r.table_name || '').toLowerCase();
      // mapping defaults/fields capture for generic writers
      try { if (r.mapping && typeof r.mapping === 'object' && r.mapping.defaults && typeof r.mapping.defaults === 'object') result.MDEF[t] = r.mapping.defaults; } catch {}
      try { if (r.mapping && typeof r.mapping === 'object' && r.mapping.fields && typeof r.mapping.fields === 'object') result.MFIELDS[t] = r.mapping.fields; } catch {}
      try { if (t === 'stock_available' && r.settings && typeof r.settings === 'object') result.TDEF_STOCK_TBL = r.settings.defaults || {}; } catch {}
      // Prefer per-table special image settings when present
      try {
        if (t === 'image' && r.setting_image && typeof r.setting_image === 'object') {
          result.TSET_ANY['image'] = r.setting_image;
        } else if (t && r.settings && typeof r.settings === 'object') {
          result.TSET_ANY[t] = r.settings;
        }
      } catch {}
    }
  } catch { /* ignore */ }
  return result;
}
