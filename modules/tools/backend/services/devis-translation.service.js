function safeObject(value) {
  if (!value || typeof value !== 'object') return {};
  if (Array.isArray(value)) return {};
  return value;
}

function safeString(value) {
  const v = String(value ?? '').trim();
  return v;
}

function pickFirstNonEmpty(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeIso(iso) {
  const raw = safeString(iso).toLowerCase();
  if (!raw) return '';
  if (raw.length === 2) return raw;
  if (raw.includes('-')) return raw.split('-')[0];
  return raw.slice(0, 2);
}

export async function loadDevisTranslation(pool, { orgId = null, shopId, langId }) {
  if (!pool) return null;
  const s = Number(shopId || 0);
  const l = Number(langId || 0);
  if (!s || !l) return null;
  const args = [s, l];
  let sql = `
    SELECT *
      FROM mod_tools_devis_translations
     WHERE shop_id = $1
       AND lang_id = $2
       AND org_id IS NULL
     ORDER BY updated_at DESC
     LIMIT 1
  `;
  if (orgId !== null && orgId !== undefined && String(orgId) !== '') {
    args.push(Number(orgId));
    sql = `
      SELECT *
        FROM mod_tools_devis_translations
       WHERE shop_id = $1
         AND lang_id = $2
         AND (org_id IS NULL OR org_id = $3)
       ORDER BY (org_id = $3) DESC, updated_at DESC
       LIMIT 1
    `;
  }
  const res = await pool.query(sql, args);
  return res.rows?.[0] || null;
}

// Fallback loader: some flows (e.g. order languages) may not have a dedicated translation row.
// This returns the newest row for the shop regardless of lang_id, preferring org-specific rows when orgId is provided.
export async function loadDevisTranslationAnyLang(pool, { orgId = null, shopId }) {
  if (!pool) return null;
  const s = Number(shopId || 0);
  if (!s) return null;

  const args = [s];
  let sql = `
    SELECT *
      FROM mod_tools_devis_translations
     WHERE shop_id = $1
       AND org_id IS NULL
     ORDER BY updated_at DESC
     LIMIT 1
  `;
  if (orgId !== null && orgId !== undefined && String(orgId) !== '') {
    args.push(Number(orgId));
    sql = `
      SELECT *
        FROM mod_tools_devis_translations
       WHERE shop_id = $1
         AND (org_id IS NULL OR org_id = $2)
       ORDER BY (org_id = $2) DESC, updated_at DESC
       LIMIT 1
    `;
  }

  const res = await pool.query(sql, args);
  return res.rows?.[0] || null;
}

export function buildDevisI18nOverride(row) {
  const labels = safeObject(row?.labels);
  const vendor = safeObject(row?.vendor);

  // Support legacy keys (the user’s previous table) by mapping them into the keys used by the quote templates.
  const overrideLabels = {
    doc_title: pickFirstNonEmpty(labels, ['doc_title', 'devis_text', 'devis_number_text']),
    quote_number: pickFirstNonEmpty(labels, ['quote_number', 'devis_number_text']),
    date: pickFirstNonEmpty(labels, ['date', 'date_devis_text']),
    subtotal_products: pickFirstNonEmpty(labels, ['subtotal_products']),
    discount: pickFirstNonEmpty(labels, ['discount']),
    client_info: pickFirstNonEmpty(labels, ['client_info']),
    vendor_info: pickFirstNonEmpty(labels, ['vendor_info']),
    client_name: pickFirstNonEmpty(labels, ['client_name', 'customer_name_text']),
    client_company: pickFirstNonEmpty(labels, ['client_company', 'customer_company_text']),
    client_email: pickFirstNonEmpty(labels, ['client_email', 'customer_email_text', 'email_client_text']),
    vendor_company: pickFirstNonEmpty(labels, ['vendor_company', 'name_web_site']),
    vendor_contact: pickFirstNonEmpty(labels, ['vendor_contact', 'votre_contact_text', 'contact_vendor']),
    vendor_email: pickFirstNonEmpty(labels, ['vendor_email', 'email_text']),
    vendor_phone: pickFirstNonEmpty(labels, ['vendor_phone', 'mobil_text']),
    details: pickFirstNonEmpty(labels, ['details']),
    reference: pickFirstNonEmpty(labels, ['reference', 'references_text']),
    product_name: pickFirstNonEmpty(labels, ['product_name', 'name_text', 'product_text']),
    description: pickFirstNonEmpty(labels, ['description', 'description_text']),
    unit_price: pickFirstNonEmpty(labels, ['unit_price', 'prix_unitaire_text']),
    quantity: pickFirstNonEmpty(labels, ['quantity', 'qty_text']),
    line_total: pickFirstNonEmpty(labels, ['line_total', 'prix_total_text']),
    total: pickFirstNonEmpty(labels, ['total', 'total_text']),
    transport_cost: pickFirstNonEmpty(labels, ['transport_cost', 'transport_cost_text', 'port_text']),
    delivery_lead_time: pickFirstNonEmpty(labels, ['delivery_lead_time', 'delivery_lead_time_text', 'delai_text']),
    product_link: pickFirstNonEmpty(labels, ['product_link', 'link_to_order_text']),
    image: pickFirstNonEmpty(labels, ['image']),
    summary: pickFirstNonEmpty(labels, ['summary']),
    link_text: pickFirstNonEmpty(labels, ['link_text']),
    email_intro_html: pickFirstNonEmpty(labels, ['email_intro_html', 'email_intro', 'email_body_html']),
    // Used by email/PDF remarks section title (legacy table key).
    remarques_text: pickFirstNonEmpty(labels, ['remarques_text', 'remarks_text', 'remark_text']),
  };

  Object.keys(overrideLabels).forEach((key) => {
    if (!overrideLabels[key]) delete overrideLabels[key];
  });

  const vendorOverride = {
    vendor_company_name: pickFirstNonEmpty(vendor, ['vendor_company_name', 'name_web_site', 'shop_domain']),
    vendor_contact_name: pickFirstNonEmpty(vendor, ['vendor_contact_name', 'contact_vendor', 'votre_contact_text']),
    vendor_email: pickFirstNonEmpty(vendor, ['vendor_email', 'email_vendor', 'e-mail_vendor', 'e_mail_vendor']),
    vendor_phone: pickFirstNonEmpty(vendor, ['vendor_phone', 'mobil_number_vendor', 'mobile_vendor', 'mobil_text']),
    shop_domain: pickFirstNonEmpty(vendor, ['shop_domain', 'name_web_site', 'domain']),
    logo_url: pickFirstNonEmpty(vendor, ['logo_url', 'logo', 'logo_vendor']),
    shop_url: pickFirstNonEmpty(vendor, ['shop_url', 'url', 'URL']),
  };

  Object.keys(vendorOverride).forEach((key) => {
    if (!vendorOverride[key]) delete vendorOverride[key];
  });

  const isoCode = normalizeIso(pickFirstNonEmpty(row || {}, ['iso_code']) || pickFirstNonEmpty(labels, ['iso_code', 'lang_iso_code']));
  const locale = pickFirstNonEmpty(row || {}, ['locale']) || pickFirstNonEmpty(labels, ['locale', 'lang_locale']);

  return { overrideLabels, vendorOverride, isoCode, locale };
}
