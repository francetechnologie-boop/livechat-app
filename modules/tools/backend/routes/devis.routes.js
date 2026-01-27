import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadProfileConfig } from '../../../product-search-index/backend/services/indexer.service.js';
import { connectMySql, makeSqlHelpers } from '../../../grabbing-jerome/backend/services/transfer/mysql.js';
import { buildQuotePdf } from '../services/quote-pdf.service.js';
import { queueEmailForDevis } from '../services/devis-queue.service.js';
import { createDraft } from '../../../google-api/backend/services/gmail.service.js';
import { getDevisI18n } from '../utils/devis-i18n.js';
import { buildDevisI18nOverride, loadDevisTranslation } from '../services/devis-translation.service.js';
import { respondWithPrompt } from '../../../../backend/lib/openaiResponses.js';
import { recordPromptConfigHistory } from '../../../../backend/lib/promptConfigHistory.js';
import { loadModToolsConfigRow } from '../utils/modToolsConfig.js';

function pickOrgId(req) {
  try {
    const raw = req.headers['x-org-id'] || req.query?.org_id;
    if (!raw) return null;
    const trimmed = String(raw).trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function requireAdminGuard(ctx) {
  if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

function stripHtml(value = '') {
  try {
    const text = String(value || '');
    return text
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return String(value || '');
  }
}

function mapDevisRow(row = {}) {
  const prefer = (...keys) => {
    for (const key of keys) {
      if (!key) continue;
      const value = row[key];
      if (value !== undefined && value !== null) return value;
    }
    return null;
  };
  const toNumberValue = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    id: toNumberValue(prefer('id_product', 'id', 'product_id')),
    reference: String(prefer('reference', 'ref', 'code') || '').trim(),
    name: String(prefer('name', 'product_name') || '').trim(),
    description: String(prefer('description', 'details') || '').trim(),
    description_short: String(prefer('description_short', 'short_description') || '').trim(),
    price_ht: toNumberValue(prefer('price_ht', 'price_without_tax', 'price')),
    price_ttc: toNumberValue(prefer('price_tax_incl', 'price_ttc', 'price_with_tax', 'price')),
    currency: String(prefer('currency', 'devise', 'currency_code') || 'EUR').trim(),
    product_url: String(prefer('product_url', 'link_product', 'link', 'url') || '').trim(),
    image_url: String(prefer('image_url', 'image', 'link_image', 'picture', 'link_image_product') || '').trim(),
    logo_url: String(prefer('logo_url', 'logo', 'shop_logo') || '').trim(),
    shop_email: String(prefer('shop_email', 'email') || '').trim(),
    shop_phone: String(prefer('shop_phone', 'phone', 'shop_phone') || '').trim(),
    shop_domain: String(prefer('shop_domain', 'domain') || '').trim(),
    language: String(prefer('language', 'iso_code', 'lang') || '').trim(),
    vendor_company_name: String(prefer('vendor_company_name', 'vendor_company') || '').trim(),
    vendor_contact_name: String(prefer('vendor_contact_name', 'vendor_contact') || '').trim(),
  };
}

export function registerToolsDevisRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const defaultChatLogPath = path.resolve(__dirname, '../../../../backend/chat.log');
  const vendorMetaCache = new Map(); // key -> { ts, meta }
  const vendorCacheTtlMs = Number(process.env.DEVIS_VENDOR_CACHE_TTL_MS || 5 * 60 * 1000);
  const chatLog = typeof ctx.chatLog === 'function'
    ? ctx.chatLog
    : ((event, payload) => {
        try {
          const logPath = defaultChatLogPath;
          const line = JSON.stringify({ event, payload, ts: new Date().toISOString() });
          fs.appendFile(logPath, line + '\n', () => {});
        } catch {}
      });
  const requireAdmin = requireAdminGuard(ctx);
  const toNumberValue = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };

  const loadToolsPromptConfigId = async ({ orgId }) => {
    try {
      if (!pool) return null;
      const orgInt = (() => {
        if (orgId == null) return null;
        const n = Number(String(orgId).trim());
        return Number.isFinite(n) ? Math.trunc(n) : null;
      })();
      const row = await loadModToolsConfigRow(pool, 'devis_language_prompt', orgInt);
      const id = row?.value?.prompt_config_id ?? null;
      return id ? String(id).trim() : null;
    } catch {
      return null;
    }
  };

  const guessLanguageHeuristic = (text = '') => {
    const lower = String(text || '').toLowerCase();
    if (!lower) return '';
    if (/\b(bonjour|cordialement|merci|devis|piscine|piscines|salutations)\b/.test(lower)) return 'fr';
    // Prestashop iso_code often uses "gb" for English (UK).
    if (/\b(hello|hi|regards|thank you|thanks|quote|quotation)\b/.test(lower)) return 'gb';
    if (/\b(dobr(ý|y) den|děkuj(i|eme)|pros(í|i)m|s pozdravem)\b/.test(lower)) return 'cs';
    return '';
  };

  const getPrestashopPrefix = () => String(process.env.PRESTASHOP_TABLE_PREFIX || process.env.PS_TABLE_PREFIX || 'ps_');

  const loadPrestashopVariants = async ({ q, hasTable, hasColumn, dbName, productIds, idShop, idLang }) => {
    const ids = Array.from(new Set((Array.isArray(productIds) ? productIds : []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))).slice(
      0,
      250
    );
    const byProductId = new Map();
    if (!ids.length) return byProductId;

    const prefix = getPrestashopPrefix();
    const tProductAttribute = prefix + 'product_attribute';
    const tProductAttributeShop = prefix + 'product_attribute_shop';
    const tProductAttributeCombination = prefix + 'product_attribute_combination';
    const tAttribute = prefix + 'attribute';
    const tAttributeLang = prefix + 'attribute_lang';
    const tAttributeGroupLang = prefix + 'attribute_group_lang';

    const canUse =
      (await hasTable(tProductAttribute, dbName)) &&
      (await hasTable(tProductAttributeCombination, dbName)) &&
      (await hasTable(tAttribute, dbName)) &&
      (await hasTable(tAttributeLang, dbName)) &&
      (await hasColumn(tProductAttribute, 'id_product', dbName)) &&
      (await hasColumn(tProductAttribute, 'id_product_attribute', dbName)) &&
      (await hasColumn(tProductAttributeCombination, 'id_product_attribute', dbName)) &&
      (await hasColumn(tProductAttributeCombination, 'id_attribute', dbName)) &&
      (await hasColumn(tAttribute, 'id_attribute', dbName)) &&
      (await hasColumn(tAttributeLang, 'id_attribute', dbName)) &&
      (await hasColumn(tAttributeLang, 'id_lang', dbName)) &&
      (await hasColumn(tAttributeLang, 'name', dbName));
    if (!canUse) return byProductId;

    const hasAttrGroup = (await hasColumn(tAttribute, 'id_attribute_group', dbName)) && (await hasTable(tAttributeGroupLang, dbName));
    const hasAttrGroupName = hasAttrGroup && (await hasColumn(tAttributeGroupLang, 'name', dbName));
    const hasAttrGroupPublicName = hasAttrGroup && (await hasColumn(tAttributeGroupLang, 'public_name', dbName));

    const hasPaReference = await hasColumn(tProductAttribute, 'reference', dbName);

    const hasPaShop = await hasTable(tProductAttributeShop, dbName);
    const hasPaShopJoin =
      hasPaShop &&
      (await hasColumn(tProductAttributeShop, 'id_product_attribute', dbName)) &&
      (await hasColumn(tProductAttributeShop, 'id_shop', dbName));
    const hasPaShopPrice = hasPaShopJoin && (await hasColumn(tProductAttributeShop, 'price', dbName));
    const hasPaShopDefaultOn = hasPaShopJoin && (await hasColumn(tProductAttributeShop, 'default_on', dbName));

    const joinPaShop = hasPaShopJoin
      ? `LEFT JOIN \`${tProductAttributeShop}\` pas ON pas.id_product_attribute = pa.id_product_attribute AND pas.id_shop = ?`
      : '';
    const selectPriceImpact = hasPaShopPrice ? 'COALESCE(pas.price, 0) AS price_impact_ht' : '0 AS price_impact_ht';
    const selectDefaultOn = hasPaShopDefaultOn ? 'COALESCE(pas.default_on, 0) AS default_on' : '0 AS default_on';
    const selectVariantReference = hasPaReference ? "COALESCE(pa.reference,'') AS variant_reference" : "'' AS variant_reference";

    const groupNameExpr = hasAttrGroup
      ? hasAttrGroupPublicName
        ? 'COALESCE(agl.public_name, agl.name, \'\')'
        : hasAttrGroupName
          ? 'COALESCE(agl.name, \'\')'
          : "''"
      : "''";
    const labelExpr = hasAttrGroup ? `CONCAT(${groupNameExpr}, ': ', al.name)` : 'al.name';
    const orderExpr = hasAttrGroup ? `${groupNameExpr}, al.name` : 'al.name';
    const joinAttrGroupLang = hasAttrGroup
      ? `LEFT JOIN \`${tAttributeGroupLang}\` agl ON agl.id_attribute_group = a.id_attribute_group AND agl.id_lang = ?`
      : '';
    const joinAttrLang = `LEFT JOIN \`${tAttributeLang}\` al ON al.id_attribute = a.id_attribute AND al.id_lang = ?`;

    const placeholders = ids.map(() => '?').join(',');
    const params = [];
    if (hasPaShopJoin) params.push(idShop);
    params.push(idLang);
    if (hasAttrGroup) params.push(idLang);
    params.push(...ids);

    const sql = `
      SELECT
        pa.id_product AS id_product,
        pa.id_product_attribute AS id_product_attribute,
        ${selectVariantReference},
        ${selectPriceImpact},
        ${selectDefaultOn},
        GROUP_CONCAT(DISTINCT ${labelExpr} ORDER BY ${orderExpr} SEPARATOR ', ') AS variant_label
      FROM \`${tProductAttribute}\` pa
      ${joinPaShop}
      JOIN \`${tProductAttributeCombination}\` pac ON pac.id_product_attribute = pa.id_product_attribute
      JOIN \`${tAttribute}\` a ON a.id_attribute = pac.id_attribute
      ${joinAttrLang}
      ${joinAttrGroupLang}
      WHERE pa.id_product IN (${placeholders})
      GROUP BY pa.id_product_attribute
      ORDER BY pa.id_product ASC, pa.id_product_attribute ASC
    `;

    const rows = await q(sql, params);
    for (const row of Array.isArray(rows) ? rows : []) {
      const idProduct = Number(row?.id_product || 0);
      const idProductAttribute = Number(row?.id_product_attribute || 0);
      if (!idProduct || !idProductAttribute) continue;
      const variant = {
        id: idProductAttribute,
        reference: String(row?.variant_reference || '').trim(),
        label: String(row?.variant_label || '').trim(),
        price_impact_ht: toNumberValue(row?.price_impact_ht, 0),
        default_on: toNumberValue(row?.default_on, 0) ? true : false,
      };
      if (!byProductId.has(idProduct)) byProductId.set(idProduct, []);
      byProductId.get(idProduct).push(variant);
    }
    for (const variants of byProductId.values()) {
      variants.sort((a, b) => (b.default_on ? 1 : 0) - (a.default_on ? 1 : 0) || a.id - b.id);
    }

    return byProductId;
  };

  const buildShopUrl = (row = {}) => {
    const domainSsl = String(row.domain_ssl || '').trim();
    const domain = String(row.domain || '').trim();
    const physical = String(row.physical_uri || '/').trim() || '/';
    const virtualUri = String(row.virtual_uri || '').trim();
    const baseDomain = domainSsl || domain;
    if (!baseDomain) return '';
    const cleanPart = (value, { leadingSlash = true, trailingSlash = false } = {}) => {
      const raw = String(value || '').trim();
      if (!raw) return leadingSlash ? '/' : '';
      let out = raw;
      if (leadingSlash && !out.startsWith('/')) out = '/' + out;
      if (!leadingSlash && out.startsWith('/')) out = out.replace(/^\/+/, '');
      if (trailingSlash && !out.endsWith('/')) out = out + '/';
      if (!trailingSlash && out.length > 1) out = out.replace(/\/+$/, '');
      return out;
    };
    const physicalPart = cleanPart(physical, { leadingSlash: true, trailingSlash: false });
    const virtualPart = virtualUri ? cleanPart(virtualUri, { leadingSlash: true, trailingSlash: false }) : '';
    const pathPart = (physicalPart + virtualPart).replace(/\/{2,}/g, '/');
    return `https://${baseDomain}${pathPart.endsWith('/') ? pathPart : pathPart + '/'}`;
  };

  const buildLogoUrl = ({ shopUrl, logoValue }) => {
    const raw = String(logoValue || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const base = String(shopUrl || '').trim().replace(/\/+$/, '');
    if (!base) return raw.startsWith('/') ? raw : '';
    if (raw.startsWith('/')) return `${base}${raw}`;
    // Common Prestashop: logo filename stored without path → /img/<logo>
    return `${base}/img/${raw}`;
  };

  const normalizeLogoToken = (value = '') => {
    try {
      const raw = String(value || '').trim();
      if (!raw) return '';
      if (/^https?:\/\//i.test(raw)) {
        const u = new URL(raw);
        const pathname = u.pathname || '';
        const parts = pathname.split('/').filter(Boolean);
        return String(parts[parts.length - 1] || '').toLowerCase();
      }
      const noQuery = raw.split('?')[0];
      const parts = String(noQuery).split('/').filter(Boolean);
      return String(parts[parts.length - 1] || '').toLowerCase();
    } catch {
      return '';
    }
  };

  const hydrateHeaderFromPrestashop = async ({ profileId, shopId, orgId, header }) => {
    const enriched = { ...header };
    if (!profileId || !shopId) return enriched;
    try {
      const cacheKey = `${orgId || ''}:${profileId}:${shopId}`;
      const cached = vendorMetaCache.get(cacheKey);
      if (cached && cached.ts && Date.now() - cached.ts < vendorCacheTtlMs && cached.meta && typeof cached.meta === 'object') {
        const meta = cached.meta;
        if (meta.shop_domain && !enriched.shop_domain) enriched.shop_domain = meta.shop_domain;
        if (meta.vendor_company_name && !enriched.vendor_company_name) enriched.vendor_company_name = meta.vendor_company_name;
        if (meta.vendor_email && !enriched.vendor_email) enriched.vendor_email = meta.vendor_email;
        if (meta.vendor_phone && !enriched.vendor_phone) enriched.vendor_phone = meta.vendor_phone;
        if (meta.shop_url && !enriched.shop_url) enriched.shop_url = meta.shop_url;
        if (meta.logo_url && !enriched.logo_url) enriched.logo_url = meta.logo_url;
        if (meta.vendor_contact_name && !enriched.vendor_contact_name) enriched.vendor_contact_name = meta.vendor_contact_name;
        if (meta.title && !enriched.title) enriched.title = meta.title;
        return enriched;
      }
    } catch {}
    try {
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      const conn = await connectMySql(ctx, cfg);
      try {
        const { q, hasTable, hasColumn } = makeSqlHelpers(conn);
        const dbName = String(cfg.database);
        const prefix = getPrestashopPrefix();
        const tShop = prefix + 'shop';
        const tShopUrl = prefix + 'shop_url';
        const tConfig = prefix + 'configuration';

        let shopName = '';
        if (await hasTable(tShop, dbName)) {
          const hasName = await hasColumn(tShop, 'name', dbName);
          if (hasName) {
            const rows = await q(`SELECT name FROM \`${tShop}\` WHERE id_shop = ? LIMIT 1`, [Number(shopId)]);
            shopName = String(rows?.[0]?.name || '').trim();
          }
        }

        let shopUrl = '';
        if (await hasTable(tShopUrl, dbName)) {
          const colsNeeded = ['domain', 'domain_ssl', 'physical_uri', 'virtual_uri', 'main'].map((c) => hasColumn(tShopUrl, c, dbName));
          const hasMain = await colsNeeded[4];
          const rows = await q(
            `SELECT domain, domain_ssl, physical_uri, virtual_uri${hasMain ? ', main' : ''} FROM \`${tShopUrl}\` WHERE id_shop = ? ${hasMain ? 'ORDER BY main DESC' : ''} LIMIT 3`,
            [Number(shopId)]
          );
          const picked = Array.isArray(rows) && rows.length ? rows[0] : null;
          shopUrl = buildShopUrl(picked || {});
        }

        let cfgEmail = '';
        let cfgPhone = '';
        let cfgLogo = '';
        if (await hasTable(tConfig, dbName)) {
          const wanted = ['PS_SHOP_EMAIL', 'PS_SHOP_PHONE', 'PS_LOGO_INVOICE', 'PS_LOGO'];
          const rows = await q(
            `SELECT name, value, id_shop FROM \`${tConfig}\` WHERE name IN (${wanted.map(() => '?').join(',')}) AND (id_shop = ? OR id_shop = 0 OR id_shop IS NULL) ORDER BY id_shop DESC`,
            [...wanted, Number(shopId)]
          );
          const bestByName = {};
          for (const r of rows || []) {
            const name = String(r?.name || '').trim();
            if (!name || bestByName[name]) continue;
            bestByName[name] = String(r?.value || '').trim();
          }
          cfgEmail = bestByName.PS_SHOP_EMAIL || '';
          cfgPhone = bestByName.PS_SHOP_PHONE || '';
          const cfgLogoInvoice = String(bestByName.PS_LOGO_INVOICE || '').trim();
          const cfgLogoDefault = String(bestByName.PS_LOGO || '').trim();
          cfgLogo = cfgLogoInvoice || cfgLogoDefault || '';

          try {
            chatLog('devis_prestashop_logo_choice', {
              profileId,
              shopId,
              picked: cfgLogoInvoice ? 'PS_LOGO_INVOICE' : cfgLogoDefault ? 'PS_LOGO' : null,
              invoice_value: cfgLogoInvoice || null,
              default_value: cfgLogoDefault || null,
            });
          } catch {}

          // Prefer invoice logo, but only override an existing logo if it looks like it was the default PS_LOGO.
          const invoiceUrl = cfgLogoInvoice ? buildLogoUrl({ shopUrl, logoValue: cfgLogoInvoice }) : '';
          const defaultUrl = cfgLogoDefault ? buildLogoUrl({ shopUrl, logoValue: cfgLogoDefault }) : '';
          const currentToken = normalizeLogoToken(enriched.logo_url || '');
          const defaultToken = normalizeLogoToken(defaultUrl);
          if (invoiceUrl) {
            const shouldOverride =
              !enriched.logo_url || (currentToken && defaultToken && currentToken === defaultToken);
            if (shouldOverride) enriched.logo_url = invoiceUrl;
          }
          if (!enriched.logo_url && defaultUrl) enriched.logo_url = defaultUrl;
        }

        const domainFromUrl = (() => {
          try {
            if (!shopUrl) return '';
            const u = new URL(shopUrl);
            return u.hostname || '';
          } catch {
            return '';
          }
        })();

        if (domainFromUrl && !enriched.shop_domain) enriched.shop_domain = domainFromUrl;
        if (shopName && !enriched.vendor_company_name) enriched.vendor_company_name = shopName;
        if (cfgEmail && !enriched.vendor_email) enriched.vendor_email = cfgEmail;
        if (cfgPhone && !enriched.vendor_phone) enriched.vendor_phone = cfgPhone;
        if (shopUrl && !enriched.shop_url) enriched.shop_url = shopUrl;
        // cfgLogo already applied above with invoice-preference logic.
        if (!enriched.vendor_contact_name) enriched.vendor_contact_name = 'Olivier Michaud';
        if (!enriched.title) enriched.title = enriched.shop_domain || enriched.vendor_company_name || '';

        try {
          const cacheKey = `${orgId || ''}:${profileId}:${shopId}`;
          vendorMetaCache.set(cacheKey, {
            ts: Date.now(),
            meta: {
              shop_domain: enriched.shop_domain || '',
              vendor_company_name: enriched.vendor_company_name || '',
              vendor_email: enriched.vendor_email || '',
              vendor_phone: enriched.vendor_phone || '',
              shop_url: enriched.shop_url || '',
              logo_url: enriched.logo_url || '',
              vendor_contact_name: enriched.vendor_contact_name || '',
              title: enriched.title || '',
            },
          });
        } catch {}
      } finally {
        try { await conn.end(); } catch {}
      }
    } catch (error) {
      chatLog('devis_prestashop_vendor_hydrate_failed', { profileId, shopId, error: String(error?.message || error) });
    }
    return enriched;
  };
  const formatCurrency = (value, currency = 'EUR') => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '-';
    try {
      return new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: String(currency || 'EUR').toUpperCase(),
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency || 'EUR'}`;
    }
  };
  const escapeHtml = (value = '') =>
    String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const sanitizeHtml = (html = '') => {
    if (!html) return '';
    try {
      return String(html)
        // Drop active content blocks entirely
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
        .replace(/<(iframe|object|embed)[\s\S]*?>[\s\S]*?<\/\1>/gi, '')
        // Remove inline event handlers and styles
        .replace(/\son[a-z]+\s*=\s*["'][\s\S]*?["']/gi, '')
        .replace(/\sstyle\s*=\s*["'][\s\S]*?["']/gi, '')
        // Neutralize javascript: in href/src
        .replace(/\shref\s*=\s*["']\s*javascript:[\s\S]*?["']/gi, ' href="#"')
        .replace(/\ssrc\s*=\s*["']\s*javascript:[\s\S]*?["']/gi, '')
        // Remove stray javascript: tokens
        .replace(/javascript:/gi, '')
        // Preserve plaintext newlines if any
        .replace(/\r?\n/g, '<br>');
    } catch {
      return '';
    }
  };

  const extractBodyInnerHtml = (html = '') => {
    try {
      const raw = String(html || '');
      const match = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (match && match[1] != null) return String(match[1]);
      return raw;
    } catch {
      return String(html || '');
    }
  };

  // Sanitizer for email intro/signature HTML: allow basic markup + inline styles, but drop active content.
  const sanitizeEmailHtml = (html = '') => {
    if (!html) return '';
    try {
      return String(html)
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
        .replace(/<(iframe|object|embed)[\s\S]*?>[\s\S]*?<\/\1>/gi, '')
        .replace(/\son[a-z]+\s*=\s*["'][\s\S]*?["']/gi, '')
        .replace(/\shref\s*=\s*["']\s*javascript:[\s\S]*?["']/gi, ' href="#"')
        .replace(/\ssrc\s*=\s*["']\s*javascript:[\s\S]*?["']/gi, '')
        .replace(/javascript:/gi, '')
        .trim();
    } catch {
      return '';
    }
  };

  const normalizeHeader = (header = {}) => ({
    customer_email: header.customer_email || header.customer_email_text || '',
    customer_name: header.customer_name || header.customer_name_text || '',
    customer_company: header.customer_company || header.customer_company_text || '',
    delivery_lead_time: header.delivery_lead_time || header.delivery_lead_time_text || '',
    transport_by: header.transport_by || header.transport_by_text || '',
    option_vat: header.option_vat || header.Option_VAT_text || '',
    option_discount: toNumberValue(header.option_discount ?? header.Option_Discount_text, 0),
    currency: header.currency || header.currency_text || 'EUR',
    remarks: header.remarks || header.remarques_text || '',
    date: header.date || header.date_devis || header.date_devis_text || '',
    quote_number: header.quote_number || header.devis_number || header.devis_number_text || '',
    vendor_company_name: header.vendor_company_name || header.vendor_company || header.shop_domain || '',
    vendor_contact_name: header.vendor_contact_name || header.vendor_contact || '',
    vendor_email: header.vendor_email || header.shop_email || '',
    vendor_phone: header.vendor_phone || header.shop_phone || header.phone || '',
    shop_domain: header.shop_domain || '',
    shop_url: header.shop_url || header.shopUrl || header.URL || header.url || '',
    logo_url: header.logo_url || header.shop_logo || '',
    title: header.quote_title || header.title || '',
    lang_iso_code: header.lang_iso_code || header.lang_iso || header.iso_code || header.language || '',
    lang_locale: header.lang_locale || header.locale || '',
  });

  const buildItemsPayload = (items = []) =>
    (Array.isArray(items) ? items : []).map((item) => ({
      id: item.id,
      product_id: Number(item.product_id || item.productId || item.id || 0) || null,
      variant_id: item.variant_id ?? item.variantId ?? null,
      variant_label: item.variant_label ?? item.variantLabel ?? '',
      reference: item.reference,
      name: item.name,
      description: item.description,
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
      totalLine: Number(item.totalLine || 0),
      productLink: item.productLink || '',
      image: item.image || '',
    }));

  const buildTotalsPayload = (totals = {}) => ({
    totalBeforeDiscount: toNumberValue(totals.totalBeforeDiscount, 0),
    subtotalAfterDiscount: toNumberValue(totals.subtotalAfterDiscount, 0),
    transportCost: toNumberValue(totals.transportCost, 0),
    grandTotal: toNumberValue(totals.grandTotal ?? totals.finalTotal ?? totals.total, 0),
  });

  const makeQuotePrefix = (label) => {
    try {
      const raw = String(label || '').trim();
      if (!raw) return 'DEVIS';
      const normalized = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      const cleaned = normalized.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      return (cleaned || 'DEVIS').toUpperCase().slice(0, 24);
    } catch {
      return 'DEVIS';
    }
  };

  const toOneLine = (value = '') =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

  const buildQuoteEmailSubject = ({ header, i18n, quoteNumber }) => {
    const domain =
      toOneLine(header?.shop_domain) ||
      toOneLine(header?.vendor_company_name) ||
      toOneLine(header?.title) ||
      'shop';
    const docTitleRaw = toOneLine(i18n?.t?.('doc_title') || 'Devis') || 'Devis';
    const docTitle = docTitleRaw.toUpperCase();
    const customerName = toOneLine(header?.customer_name);
    const customerCompany = toOneLine(header?.customer_company);

    const suffix = customerName && customerCompany
      ? `${customerName} / ${customerCompany}`
      : (customerName || customerCompany);

    const head = `[${domain} - ${docTitle} - ${toOneLine(quoteNumber)}]`;
    return suffix ? `${head} ${suffix}` : head;
  };

  const loadPromptConfigById = async (promptConfigId, orgId) => {
    if (!pool || !promptConfigId) return null;
    const id = String(promptConfigId).trim();
    if (!id) return null;
    const args = [id];
    let whereOrg = 'AND org_id IS NULL';
    if (orgId != null) {
      args.push(orgId);
      whereOrg = 'AND (org_id IS NULL OR org_id = $2)';
    }
    const sql = `
      SELECT id, org_id, name, prompt_id, prompt_version, model, openai_api_key
        FROM mod_automation_suite_prompt_config
       WHERE id = $1
         ${whereOrg}
       LIMIT 1
    `;
    const res = await pool.query(sql, args);
    return res.rowCount ? res.rows[0] : null;
  };

  const persistOffer = async ({ profileId, shopId, langId, header, items, totals, orgId }) => {
    const normalizedHeader = normalizeHeader(header);
    const itemPayload = buildItemsPayload(items);
    const normalizedTotals = buildTotalsPayload(totals);
    const headerJson = JSON.stringify(normalizedHeader);
    const itemsJson = JSON.stringify(itemPayload);
    // Generate a unique quote_number at insert-time to avoid transient duplicates (quote_number was previously default '').
    const result = await pool.query(
      `
        WITH new_row AS (
          SELECT nextval(pg_get_serial_sequence('public.mod_tools_devis_offers','id'))::int AS id
        )
        INSERT INTO mod_tools_devis_offers (
          id, org_id, quote_number, profile_id, shop_id, lang_id,
          customer_email, customer_name, customer_company,
          delivery_lead_time, transport_by, transport_cost,
          currency, option_vat, option_discount, remarks,
          header, items,
          total_before_discount, subtotal_after_discount, grand_total,
          created_at, updated_at
        )
        SELECT
          new_row.id,
          $1,
          CONCAT('DEV-', TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD'), '-', new_row.id::text),
          $2,$3,$4,
          $5,$6,$7,
          $8,$9,$10,
          $11,$12,$13,$14,
          $15::jsonb,$16::jsonb,
          $17,$18,$19,
          NOW(), NOW()
        FROM new_row
        RETURNING id, quote_number
      `,
      [
        orgId,
        profileId,
        shopId,
        langId,
        normalizedHeader.customer_email,
        normalizedHeader.customer_name,
        normalizedHeader.customer_company,
        normalizedHeader.delivery_lead_time,
        normalizedHeader.transport_by,
        normalizedTotals.transportCost,
        normalizedHeader.currency,
        normalizedHeader.option_vat,
        normalizedHeader.option_discount,
        normalizedHeader.remarks,
        headerJson,
        itemsJson,
        normalizedTotals.totalBeforeDiscount,
        normalizedTotals.subtotalAfterDiscount,
        normalizedTotals.grandTotal,
      ]
    );
    const record = result.rows?.[0];
    if (!record) throw new Error('insert_failed');
    const quoteNumber = String(record.quote_number || '').trim();
    if (!quoteNumber) throw new Error('quote_number_missing');
    return {
      id: record.id,
      quoteNumber,
      header: normalizedHeader,
      items: itemPayload,
      totals: normalizedTotals,
    };
  };

	  const renderEmailHtml = ({ header, items, totals, quoteNumber }) => {
	    const { iso, locale, t } = getDevisI18n({
	      isoCode: header.lang_iso_code,
	      locale: header.lang_locale,
	      labelsOverride: header.i18n_labels || null,
	    });
	    const currency = header.currency;
	    const safeText = (value = '') => escapeHtml(String(value || ''));
	    const textWithBreaks = (value = '') => safeText(value).replace(/\n/g, '<br>');
	    const normalizeHref = (rawUrl = '') => {
	      const raw = String(rawUrl || '').trim();
	      if (!raw) return '';
	      // Decode common HTML entities that may have been persisted from scraped HTML.
	      let url = raw
	        .replace(/&amp;/gi, '&')
	        .replace(/&#38;/gi, '&')
	        .replace(/&#x26;/gi, '&');
	      // Strip surrounding <> or quotes
	      url = url.replace(/^<|>$/g, '').replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '').trim();
	      if (!url) return '';
	      // Handle protocol-relative URLs
	      if (url.startsWith('//')) {
	        const base = String(header.shop_url || '').trim();
	        const scheme = /^https:/i.test(base) ? 'https:' : /^http:/i.test(base) ? 'http:' : 'https:';
	        url = scheme + url;
	      }
	      // Absolute path → prefix with shop_url (if available)
	      if (url.startsWith('/')) {
	        const base = String(header.shop_url || '').trim().replace(/\/+$/, '');
	        url = base ? `${base}${url}` : url;
	      }
	      // Add scheme if missing
	      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
	        if (url.includes('.') && !/\s/.test(url)) return `https://${url}`;
	      }
	      // Ensure language prefix for shop domain when missing (e.g. /cs/…)
	      try {
	        const u = new URL(url);
	        const shopHost = (() => {
	          try {
	            return new URL(String(header.shop_url || '')).hostname.toLowerCase();
	          } catch {
	            return String(header.shop_domain || '').toLowerCase();
	          }
	        })();
	        if (!shopHost || u.hostname.toLowerCase() !== shopHost) return url;

	        // Fix Prestashop oddity: "/es2034-..." → "/es/2034-..." (even if lang isn't provided)
	        const glued = (u.pathname || '').match(/^\/([a-z]{2})(\d)/i);
	        if (glued && glued[1] && glued[2] && !String(u.pathname || '').startsWith(`/${glued[1]}/`)) {
	          u.pathname = `/${String(glued[1]).toLowerCase()}/${String(u.pathname || '').slice(3)}`;
	          return u.toString();
	        }

	        const lang = String(header.lang_iso_code || iso || '').trim().toLowerCase();
	        if (!lang) return url;
	        const basePath = (() => {
	          try {
	            const p = new URL(String(header.shop_url || '')).pathname || '/';
	            return p.replace(/\/+$/, '/') || '/';
	          } catch {
	            return '/';
	          }
	        })();
	        const desiredPrefix = basePath === '/' ? `/${lang}/` : `${basePath}${lang}/`;
	        const pathname = u.pathname || '/';
	        const afterBase = basePath !== '/' && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname.replace(/^\/+/, '');
	        if (/^[a-z]{2}\//i.test(afterBase)) return url; // already has a language prefix
	        if (pathname.startsWith(desiredPrefix)) return url;

	        // Common Prestashop pattern: language code glued to product id, e.g. "/de2034-...".
	        // If the path starts with the target lang code and the next char is a digit, insert the missing slash.
	        if (afterBase.toLowerCase().startsWith(lang) && afterBase.length > lang.length) {
	          const rest = afterBase.slice(lang.length);
	          if (rest && rest[0] !== '/' && /^\d/.test(rest)) {
	            const fixed = `${lang}/${rest}`;
	            u.pathname = (basePath === '/' ? '/' : basePath) + fixed;
	            return u.toString();
	          }
	        }

	        if (basePath !== '/' && pathname.startsWith(basePath)) {
	          u.pathname = desiredPrefix + pathname.slice(basePath.length).replace(/^\/+/, '');
	          return u.toString();
	        }
	        if (basePath === '/' && pathname.startsWith('/')) {
	          u.pathname = desiredPrefix + pathname.replace(/^\/+/, '');
	          return u.toString();
	        }
	      } catch {}
	      return url;
	    };
	    const stripTagsToText = (value = '') =>
	      String(value || '')
	        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
	        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const formatDate = (value) => {
      if (!value) return '';
      try {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return safeText(value);
        return safeText(new Intl.DateTimeFormat(locale).format(parsed));
      } catch {
        return safeText(value);
      }
    };
    const formatMoney = (value, curr) => {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return '-';
      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: String(curr || 'EUR').toUpperCase(),
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(amount);
      } catch {
        return `${amount.toFixed(2)} ${String(curr || 'EUR').toUpperCase()}`;
      }
    };
    const title = header.shop_domain || header.title || header.vendor_company_name || '';
    const vendorName = header.shop_domain || header.vendor_company_name || '';
    const vendorContact = header.vendor_contact_name || '';
	    const vendorEmail = header.vendor_email || '';
	    const vendorPhone = header.vendor_phone || '';
	    const clientCompany = header.customer_company || '';
	    const clientEmail = header.customer_email || '';
	    const clientName = header.customer_name || '';
    const delivery = header.delivery_lead_time || '';
    const transportCost = formatMoney(totals.transportCost, currency);
    const grandTotal = formatMoney(totals.grandTotal, currency);
    const subtotalProducts = formatMoney(totals.totalBeforeDiscount, currency);
    const discountPercent = Math.max(0, Math.min(100, Number(header.option_discount || 0)));
	    const discountAmountValue = Number(totals.totalBeforeDiscount) - Number(totals.subtotalAfterDiscount);
	    const discountAmount = formatMoney(Math.max(0, discountAmountValue), currency);
	    const logo = header.logo_url || '';
	    const emailIntroHtml = sanitizeEmailHtml(extractBodyInnerHtml(t('email_intro_html', '')));

    const inlineizeDescriptionHtml = (html = '') => {
      const source = String(html || '');
      const patchTag = (tag, style) =>
        source.replace(new RegExp(`<${tag}([^>]*)>`, 'gi'), (match, attrs) => {
          if (/\sstyle\s*=/i.test(attrs || '')) return match;
          return `<${tag}${attrs} style="${style}">`;
        });
      let out = source;
      out = out.replace(/<h([1-6])([^>]*)>/gi, (match, level, attrs) => {
        if (/\sstyle\s*=/i.test(attrs || '')) return match;
        return `<h${level}${attrs} style="margin:0 0 4px;font-size:12px;font-weight:bold;line-height:1.25;">`;
      });
      out = out.replace(/<p([^>]*)>/gi, (match, attrs) => {
        if (/\sstyle\s*=/i.test(attrs || '')) return match;
        return `<p${attrs} style="margin:0 0 4px;line-height:1.25;">`;
      });
      out = out.replace(/<ul([^>]*)>/gi, (match, attrs) => {
        if (/\sstyle\s*=/i.test(attrs || '')) return match;
        return `<ul${attrs} style="margin:0 0 4px 16px;padding:0;line-height:1.25;">`;
      });
      out = out.replace(/<ol([^>]*)>/gi, (match, attrs) => {
        if (/\sstyle\s*=/i.test(attrs || '')) return match;
        return `<ol${attrs} style="margin:0 0 4px 16px;padding:0;line-height:1.25;">`;
      });
      out = out.replace(/<li([^>]*)>/gi, (match, attrs) => {
        if (/\sstyle\s*=/i.test(attrs || '')) return match;
        return `<li${attrs} style="margin:0 0 2px;line-height:1.25;">`;
      });
      return out;
    };

    const tdBase = 'border:1px solid #e5e7eb;padding:6px;font-size:12px;vertical-align:top;';
    const thBase = 'border:1px solid #e5e7eb;padding:8px 6px;font-size:11px;text-transform:uppercase;letter-spacing:0.03em;color:#4b5563;background:#f3f4f6;';

    const rows = items
      .map((item) => {
        const descriptionRaw = item.description || item.description_short || '';
        const descriptionSanitized = sanitizeHtml(descriptionRaw);
        const descriptionText = stripTagsToText(descriptionSanitized);
        const shouldClamp = descriptionText.length > 320 || descriptionSanitized.length > 600;
        const description = shouldClamp
          ? safeText(descriptionText.slice(0, 320) + (descriptionText.length > 320 ? '…' : ''))
          : inlineizeDescriptionHtml(descriptionSanitized || '');
	        const descHtml = `<div style="font-size:11px;line-height:1.25;color:#374151;">${description || '&nbsp;'}</div>`;
	        const normalizedLink = normalizeHref(item.productLink);
	        const linkHtml = normalizedLink
	          ? `<a href="${safeText(normalizedLink)}" target="_blank" rel="noreferrer" style="color:#2563eb;text-decoration:underline;">${safeText(t('link_text', t('product_link')))}</a>`
	          : '&nbsp;';
        const imgHtml = item.image
          ? `<img src="${safeText(item.image)}" alt="${safeText(item.name || '')}" style="max-width:90px;max-height:90px;object-fit:contain;display:block;margin:0 auto;" />`
          : '<span style="color:#999;font-size:11px;">—</span>';

        return `
          <tr>
            <td style="${tdBase}width:13%;">${safeText(item.reference || '')}</td>
            <td style="${tdBase}width:18%;">${safeText(item.name || '')}</td>
            <td style="${tdBase}width:31%;">${descHtml}</td>
            <td style="${tdBase}width:10%;text-align:right;white-space:nowrap;">${safeText(formatMoney(item.unitPrice, currency))}</td>
            <td style="${tdBase}width:6%;text-align:right;white-space:nowrap;">${safeText(item.quantity)}</td>
            <td style="${tdBase}width:10%;text-align:right;white-space:nowrap;">${safeText(formatMoney(item.totalLine, currency))}</td>
            <td style="${tdBase}width:6%;text-align:center;">${linkHtml}</td>
            <td style="${tdBase}width:6%;text-align:center;">${imgHtml}</td>
          </tr>
        `;
      })
      .join('\n');

	    const quoteTitleHtml = title ? `<span style="font-weight:700;font-size:14px;color:#374151;">${safeText(title)}</span>` : '';
	    const logoHtml = logo
	      ? `<img src="${safeText(logo)}" alt="Logo" style="height:48px;max-width:120px;object-fit:contain;display:block;border:0;outline:none;text-decoration:none;" />`
	      : '<div style="width:48px;height:48px;border:1px solid #e5e7eb;border-radius:6px;background:#f8fafc;"></div>';

	    const signatureWebUrl = header.shop_url || (header.shop_domain ? `https://${header.shop_domain}/` : '');
	    const signatureWebText = header.shop_domain || signatureWebUrl;
	    const signatureRows = [
	      vendorContact ? `<div style="font-size:12px;color:#111827;font-weight:600;margin:0 0 6px 0;">${safeText(vendorContact)}</div>` : '',
	      vendorPhone
	        ? `<div style="font-size:12px;color:#111827;margin:0 0 2px 0;">${safeText(t('mobil_text', 'Tel'))} ${safeText(vendorPhone)}</div>`
	        : '',
	      vendorEmail
	        ? `<div style="font-size:12px;color:#111827;margin:0 0 2px 0;">${safeText(t('email_text', 'Email'))} <a href="mailto:${safeText(vendorEmail)}" style="color:#2563eb;text-decoration:underline;">${safeText(vendorEmail)}</a></div>`
	        : '',
	      signatureWebUrl
	        ? `<div style="font-size:12px;color:#111827;margin:0 0 6px 0;">${safeText(t('web_text', 'Web'))} <a href="${safeText(signatureWebUrl)}" target="_blank" rel="noreferrer" style="color:#2563eb;text-decoration:underline;">${safeText(signatureWebText)}</a></div>`
	        : '',
	    ].filter(Boolean);
	    const signatureBrandBlock = logo
	      ? `<div style="margin-top:6px;">
	          <table role="presentation" cellspacing="0" cellpadding="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
	            <tr>
	              <td valign="middle" style="padding-right:10px;">
	                <img src="${safeText(logo)}" alt="Logo" style="height:42px;max-width:120px;object-fit:contain;display:block;border:0;outline:none;text-decoration:none;" />
	              </td>
	              <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;">
	                ${header.shop_domain ? `<div style="font-size:15px;line-height:1.1;font-weight:600;color:#38bdf8;">${safeText(header.shop_domain)}</div>` : ''}
	              </td>
	            </tr>
	          </table>
	        </div>`
	      : '';
	    const signatureBlock = signatureRows.length
	      ? `<tr><td style="padding:14px 0 0 0;">
	          <table role="presentation" cellspacing="0" cellpadding="0" width="100%" bgcolor="#ffffff" style="max-width:680px;width:100%;background:#ffffff;border:1px solid #dcdfe6;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
	            <tr><td style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;border-top:1px solid #e5e7eb;">
	              ${signatureRows.join('')}
	              ${signatureBrandBlock}
	            </td></tr>
	          </table>
	        </td></tr>`
	      : '';

	    const clientRows = [
	      clientName ? `${safeText(t('client_name'))} : ${safeText(clientName)}` : '',
	      clientCompany ? `${safeText(t('client_company'))} : ${safeText(clientCompany)}` : '',
	      clientEmail ? `${safeText(t('client_email'))} : ${safeText(clientEmail)}` : '',
    ].filter(Boolean);
    const vendorRows = [
      vendorName ? `${safeText(t('vendor_company'))} : ${safeText(vendorName)}` : '',
      vendorContact ? `${safeText(t('vendor_contact'))} : ${safeText(vendorContact)}` : '',
      vendorEmail ? `${safeText(t('vendor_email'))} : ${safeText(vendorEmail)}` : '',
      vendorPhone ? `${safeText(t('vendor_phone'))} : ${safeText(vendorPhone)}` : '',
    ].filter(Boolean);

    const totalsLines = [
      { label: safeText(t('subtotal_products')), value: safeText(subtotalProducts) },
      ...(discountPercent > 0 && discountAmountValue > 0.0001
        ? [{ label: `${safeText(t('discount'))} (${safeText(discountPercent.toFixed(0))}%)`, value: `-${safeText(discountAmount)}` }]
        : []),
      { label: safeText(t('transport_cost')), value: safeText(transportCost) },
      { label: safeText(t('total')), value: safeText(grandTotal), strong: true },
      ...(delivery ? [{ label: safeText(t('delivery_lead_time')), value: safeText(delivery) }] : []),
    ];

	    const emailIntroBlock = emailIntroHtml
	      ? `<tr><td style="padding:0 0 12px 0;">
	          <table role="presentation" cellspacing="0" cellpadding="0" width="100%" bgcolor="#ffffff" style="max-width:680px;width:100%;background:#ffffff;border:1px solid #dcdfe6;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
	            <tr><td style="padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111827;">
	              ${emailIntroHtml}
	            </td></tr>
	          </table>
	        </td></tr>`
	      : '';

	    const remarksBlock = header.remarks
	      ? `<tr><td style="padding:14px 0 0 0;">
	          <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;">
	            <tr>
	              <td style="font-family:Arial,Helvetica,sans-serif;">
	                <div style="font-size:12px;font-weight:700;color:#111827;margin:0 0 6px 0;">${safeText(t('remarques_text', 'Remarques'))}</div>
	                <div style="font-size:12px;color:#374151;line-height:1.35;">${textWithBreaks(header.remarks)}</div>
	              </td>
	            </tr>
	          </table>
	        </td></tr>`
	      : '';

    return `<!doctype html>
<html lang="${safeText(iso)}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${safeText(quoteNumber || t('doc_title'))}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f7fa;" bgcolor="#f5f7fa">
    <table role="presentation" cellspacing="0" cellpadding="0" width="100%" bgcolor="#f5f7fa" style="background:#f5f7fa;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
      <tr>
        <td align="center" style="padding:24px;">
          <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="max-width:680px;width:100%;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
            ${emailIntroBlock}
	            <tr>
	              <td>
                <table role="presentation" cellspacing="0" cellpadding="0" width="100%" bgcolor="#ffffff" style="background:#ffffff;border:1px solid #dcdfe6;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;">
                  <tr>
                    <td style="padding:16px;border-bottom:1px solid #e5e7eb;">
                      <table role="presentation" cellspacing="0" cellpadding="0" width="100%">
                        <tr>
                          <td valign="middle" style="font-family:Arial,Helvetica,sans-serif;">
                            <table role="presentation" cellspacing="0" cellpadding="0">
                              <tr>
                                <td valign="middle" style="padding-right:10px;">${logoHtml}</td>
                                <td valign="middle">${quoteTitleHtml}</td>
                              </tr>
                            </table>
                          </td>
                          <td valign="middle" align="right" style="font-family:Arial,Helvetica,sans-serif;">
                            <div style="font-size:16px;font-weight:700;color:#111827;">${safeText(t('quote_number'))}: ${safeText(quoteNumber)}</div>
                            ${header.date ? `<div style="font-size:12px;color:#4b5563;margin-top:4px;">${safeText(t('date'))}: ${formatDate(header.date)}</div>` : ''}
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:16px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" width="100%">
                        <tr>
                          <td valign="top" style="padding-right:6px;width:50%;">
                            <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border:1px solid #e5e7eb;background:#fafafa;">
                              <tr><td style="padding:12px;font-family:Arial,Helvetica,sans-serif;">
                                <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:8px;">${safeText(t('client_info'))}</div>
                                ${clientRows.map((line) => `<div style="font-size:12px;margin:2px 0;color:#111827;">${line}</div>`).join('')}
                              </td></tr>
                            </table>
                          </td>
                          <td valign="top" style="padding-left:6px;width:50%;">
                            <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border:1px solid #e5e7eb;background:#fafafa;">
                              <tr><td style="padding:12px;font-family:Arial,Helvetica,sans-serif;">
                                <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:8px;">${safeText(t('vendor_info'))}</div>
                                ${vendorRows.map((line) => `<div style="font-size:12px;margin:2px 0;color:#111827;">${line}</div>`).join('')}
                              </td></tr>
                            </table>
                          </td>
                        </tr>
                      </table>

                      <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;margin:16px 0 8px;color:#111827;">
                        ${safeText(t('details'))}
                      </div>

                      <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="border-collapse:collapse;">
                        <thead>
                          <tr>
                            <th style="${thBase}width:13%;text-align:left;">${safeText(t('reference'))}</th>
                            <th style="${thBase}width:18%;text-align:left;">${safeText(t('product_name'))}</th>
                            <th style="${thBase}width:31%;text-align:left;">${safeText(t('description'))}</th>
                            <th style="${thBase}width:10%;text-align:right;">${safeText(t('unit_price'))}</th>
                            <th style="${thBase}width:6%;text-align:right;">${safeText(t('quantity'))}</th>
                            <th style="${thBase}width:10%;text-align:right;">${safeText(t('line_total', t('total')))}</th>
                            <th style="${thBase}width:6%;text-align:center;">${safeText(t('product_link'))}</th>
                            <th style="${thBase}width:6%;text-align:center;">${safeText(t('image'))}</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${rows}
                        </tbody>
                      </table>

                      <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="margin-top:12px;">
                        ${totalsLines.map((line) => `
                          <tr>
                            <td style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111827;">${line.label} :</td>
                            <td align="right" style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:${line.strong ? '13px' : '12px'};font-weight:${line.strong ? '700' : '400'};color:#111827;white-space:nowrap;">${line.value}</td>
                          </tr>
                        `).join('')}
	                      </table>

	                      ${remarksBlock}
	                    </td>
	                  </tr>
	                </table>
	              </td>
	            </tr>
	            ${signatureBlock}
	          </table>
	        </td>
	      </tr>
	    </table>
	  </body>
	</html>`;
  };

  const applyDevisTranslation = async ({ orgId, shopId, langId, header }) => {
    try {
      const row = await loadDevisTranslation(pool, { orgId, shopId, langId });
      if (!row) return { header, i18nLabels: null };
      const { overrideLabels, vendorOverride, isoCode, locale } = buildDevisI18nOverride(row);
      const enriched = { ...header };
      if (vendorOverride.vendor_company_name && !enriched.vendor_company_name) enriched.vendor_company_name = vendorOverride.vendor_company_name;
      if (vendorOverride.vendor_contact_name && !enriched.vendor_contact_name) enriched.vendor_contact_name = vendorOverride.vendor_contact_name;
      if (vendorOverride.vendor_email && !enriched.vendor_email) enriched.vendor_email = vendorOverride.vendor_email;
      if (vendorOverride.vendor_phone && !enriched.vendor_phone) enriched.vendor_phone = vendorOverride.vendor_phone;
      if (vendorOverride.shop_domain && !enriched.shop_domain) enriched.shop_domain = vendorOverride.shop_domain;
      if (vendorOverride.logo_url && !enriched.logo_url) enriched.logo_url = vendorOverride.logo_url;
      if (vendorOverride.shop_url && !enriched.shop_url) enriched.shop_url = vendorOverride.shop_url;
      if (!enriched.title) {
        if (vendorOverride.shop_domain) enriched.title = vendorOverride.shop_domain;
        else if (vendorOverride.vendor_company_name) enriched.title = vendorOverride.vendor_company_name;
      }
      if (isoCode && !enriched.lang_iso_code) enriched.lang_iso_code = isoCode;
      if (locale && !enriched.lang_locale) enriched.lang_locale = locale;
      const mergedLabels = Object.keys(overrideLabels || {}).length ? overrideLabels : null;
      if (mergedLabels) enriched.i18n_labels = mergedLabels;
      return { header: enriched, i18nLabels: mergedLabels };
    } catch {
      return { header, i18nLabels: null };
    }
  };

  app.get('/api/tools/devis/products', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const orgId = pickOrgId(req);
      const search = String(req.query?.search || req.query?.q || '').trim();
      const idsParam = String(req.query?.ids || '').trim();
      const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 20)));
      const offset = Math.max(0, Number(req.query?.offset || 0));
      const ids = idsParam
        ? idsParam
            .split(',')
            .map((value) => Number(value.trim()))
            .filter((value) => Number.isFinite(value))
        : [];

      const args = [];
      let where = 'WHERE 1=1';
      if (orgId) {
        args.push(orgId);
        where += ` AND (org_id IS NULL OR org_id = $${args.length})`;
      }
      if (ids.length) {
        args.push(ids);
        where += ` AND id = ANY($${args.length})`;
      } else if (search) {
        args.push(`%${search}%`);
        where += ` AND (reference ILIKE $${args.length} OR name ILIKE $${args.length})`;
      }
      const limitIndex = args.length + 1;
      const offsetIndex = args.length + 2;
      args.push(limit, offset);

      const query = `
        SELECT id, org_id, product_id, reference, name, description, description_short,
               image_url, product_url, price_ht, price_ttc, currency, created_at, updated_at
          FROM mod_tools_devis_products
        ${where}
        ORDER BY name ASC, id ASC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `;

      const results = await pool.query(query, args);
      const items = (results.rows || []).map((row) => ({
        id: row.id,
        org_id: row.org_id,
        product_id: row.product_id,
        reference: row.reference,
        name: row.name,
        description: row.description,
        description_short: row.description_short,
        image_url: row.image_url,
        product_url: row.product_url,
        price_ht: Number(row.price_ht || 0),
        price_ttc: Number(row.price_ttc || 0),
        currency: row.currency || 'EUR',
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));

      chatLog('devis_products_list', { count: items.length, org_id: orgId || null });
      return res.json({ ok: true, items });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'list_failed', message: String(error?.message || error) });
    }
  });

  app.get('/api/tools/devis/products/:id', async (req, res) => {
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const orgId = pickOrgId(req);
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'invalid_id' });

      const args = [id];
      let where = 'WHERE id = $1';
      if (orgId) {
        args.push(orgId);
        where += ` AND (org_id IS NULL OR org_id = $${args.length})`;
      }
      const query = `
        SELECT id, org_id, product_id, reference, name, description, description_short,
               image_url, product_url, price_ht, price_ttc, currency, created_at, updated_at
          FROM mod_tools_devis_products
        ${where}
        LIMIT 1
      `;
      const results = await pool.query(query, args);
      const item = (results.rows || [])[0] || null;
      return res.json({ ok: true, item });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'fetch_failed', message: String(error?.message || error) });
    }
  });

  app.get('/api/tools/devis/shop-by-email', async (req, res) => {
    if (!requireAdmin(req, res)) {
      chatLog('devis_shop_match_denied', { reason: 'requireAdmin' });
      return;
    }
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const profileId = Number(req.query?.profile_id || 0);
    const requestedEmail = String(req.query?.email || '').trim().toLowerCase();
    const messageId = String(req.query?.message_id || '').trim();
    if (!profileId || (!requestedEmail && !messageId)) {
      return res.status(400).json({ ok: false, error: 'missing_params', message: 'profile_id and email or message_id are required' });
    }
    try {
      const orgId = pickOrgId(req);
      const normalizeEmail = (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (!raw) return '';
        const match = raw.match(/<([^>]+)>/);
        return String(match?.[1] || raw).trim();
      };

      const resolveQueueRow = async () => {
        if (!pool) return null;
        if (messageId) {
          const lookup = await pool.query(
            `
              SELECT message_id, to_email, from_email, customer_email
                FROM mod_tools_devis_queue
               WHERE message_id = $1
               LIMIT 1
            `,
            [messageId]
          );
          return lookup.rows?.[0] || null;
        }
        if (requestedEmail) {
          // Match by normalized email (handles "Name <email>" and whitespace).
          const lookup = await pool.query(
            `
              SELECT message_id, to_email, from_email, customer_email
                FROM mod_tools_devis_queue
               WHERE LOWER(TRIM(REGEXP_REPLACE(COALESCE(customer_email,''), '^.*<([^>]+)>.*$', '\\1'))) = $1
                  OR LOWER(TRIM(REGEXP_REPLACE(COALESCE(from_email,''), '^.*<([^>]+)>.*$', '\\1'))) = $1
                  OR LOWER(TRIM(REGEXP_REPLACE(COALESCE(to_email,''), '^.*<([^>]+)>.*$', '\\1'))) = $1
               ORDER BY updated_at DESC
               LIMIT 1
            `,
            [requestedEmail]
          );
          return lookup.rows?.[0] || null;
        }
        return null;
      };

      let queueRow = null;
      try {
        queueRow = await resolveQueueRow();
      } catch (err) {
        chatLog('devis_shop_match_lookup_error', { message_id: messageId || null, email: requestedEmail || null, error: String(err?.message || err) });
      }

      const resolvedMessageId = String(queueRow?.message_id || messageId || '') || null;
      const candidates = Array.from(
        new Set(
          [queueRow?.to_email, queueRow?.from_email]
            .map(normalizeEmail)
            .filter(Boolean)
        )
      );
      const source = queueRow?.to_email
        ? 'queue_to_email'
        : queueRow?.from_email
          ? 'queue_from_email'
          : queueRow
            ? 'queue_row_no_shop_email'
            : messageId
              ? 'queue_message_id_not_found'
              : requestedEmail
                ? 'queue_lookup_by_email_not_found'
                : 'query_param';

      chatLog('devis_shop_match_candidates', {
        profile_id: profileId,
        input_email: requestedEmail || null,
        message_id: resolvedMessageId,
        source,
        candidates,
      });

      if (!candidates.length) {
        return res.json({ ok: true, match: null });
      }

      const cfg = await loadProfileConfig(pool, orgId, profileId);
      const conn = await connectMySql(ctx, cfg);
      try {
        const { q } = makeSqlHelpers(conn);
        for (const candidate of candidates) {
          chatLog('devis_shop_match_attempt', { profile_id: profileId, email: candidate, source, message_id: resolvedMessageId });
          const rows = await q(
            `SELECT id_shop, id_shop_group, value
               FROM ps_configuration
              WHERE name = 'PS_SHOP_EMAIL'
                AND LOWER(value) = ?
              ORDER BY id_shop ASC
              LIMIT 1`,
            [candidate]
          );
          if (!Array.isArray(rows) || !rows.length) continue;
          const row = rows[0] || {};
          const shopId = Number(row.id_shop || 0);
          if (!Number.isFinite(shopId) || shopId <= 0) continue;
          const shopRow = await q(`SELECT id_shop, name FROM ps_shop WHERE id_shop = ? LIMIT 1`, [shopId]);
          const shop = Array.isArray(shopRow) && shopRow.length
            ? { id_shop: Number(shopRow[0]?.id_shop || shopId), name: shopRow[0]?.name || '' }
            : { id_shop: shopId, name: '' };
          chatLog('devis_shop_match', { profile_id: profileId, email: candidate, match_id: shop.id_shop, match_name: shop.name || null, source, message_id: resolvedMessageId });
          return res.json({ ok: true, match: shop });
        }

        chatLog('devis_shop_match_none', { profile_id: profileId, candidates, source, message_id: resolvedMessageId });
        return res.json({ ok: true, match: null });
      } finally {
        try { await conn.end(); } catch {}
      }
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'shop_match_failed', message: String(error?.message || error) });
    }
  });

  app.get('/api/tools/devis/vendor-meta', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const profileId = Number(req.query?.profile_id || 0);
    const shopId = Number(req.query?.id_shop || 0);
    if (!profileId || !shopId) {
      return res.status(400).json({ ok: false, error: 'missing_scope', message: 'profile_id and id_shop are required' });
    }
    try {
      const orgId = pickOrgId(req);
      const header = await hydrateHeaderFromPrestashop({ profileId, shopId, orgId, header: {} });
      return res.json({
        ok: true,
        meta: {
          shop_domain: header.shop_domain || '',
          vendor_company_name: header.vendor_company_name || '',
          vendor_contact_name: header.vendor_contact_name || '',
          vendor_email: header.vendor_email || '',
          vendor_phone: header.vendor_phone || '',
          shop_url: header.shop_url || '',
          logo_url: header.logo_url || '',
          title: header.title || '',
        },
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'vendor_meta_failed', message: String(error?.message || error) });
    }
  });

  app.get('/api/tools/devis/queue', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    try {
      const orgId = pickOrgId(req);
      const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 20)));
      const args = [limit];
      let where = 'WHERE 1=1';
      if (orgId) {
        args.push(orgId);
        where += ` AND (org_id IS NULL OR org_id = $${args.length})`;
      }
      const rows = await pool.query(
        `
          SELECT id, org_id, message_id, subject, customer_email,
                 from_email, to_email,
                 customer_first_name, customer_last_name, customer_company,
                 customer_language,
                 status, created_at, extraction
            FROM mod_tools_devis_queue
          ${where}
          ORDER BY created_at DESC
          LIMIT $1
        `,
        args
      );
        const items = (rows.rows || []).map((row) => {
          const applied = row.extraction?.applied || null;
          return {
            id: row.id,
            org_id: row.org_id,
            message_id: row.message_id,
            subject: row.subject,
            from_email: row.from_email || null,
            to_email: row.to_email || null,
            customer_email: row.customer_email || applied?.customer_email || '',
            customer_first_name: row.customer_first_name || applied?.customer_first_name || '',
            customer_last_name: row.customer_last_name || applied?.customer_last_name || '',
            customer_language: row.customer_language || applied?.customer_language || '',
            customer_company: row.customer_company || applied?.customer_company || '',
            status: row.status || 'queued',
          created_at: row.created_at,
          extraction_applied: applied,
          model_used: row.extraction?.prompt?.model || row.extraction?.llm?.model || null,
        };
      });
      return res.json({ ok: true, items });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'queue_list_failed', message: String(error?.message || error) });
    }
  });

  app.post('/api/tools/devis/detect-language', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const body = req.body || {};
    const messageId = String(body.message_id || body.messageId || '').trim();
    const promptConfigIdRaw = String(body.promptConfigId || body.prompt_config_id || '').trim();
    const orgId = pickOrgId(req);
    if (!messageId) return res.status(400).json({ ok: false, error: 'missing_message_id', message: 'message_id is required' });

    try {
      const promptConfigId = promptConfigIdRaw || (await loadToolsPromptConfigId({ orgId })) || '';
      if (!promptConfigId) {
        return res.status(400).json({ ok: false, error: 'missing_prompt_config', message: 'promptConfigId is required (or configure it in Tools → Settings).' });
      }
      const rowRes = await pool.query(
        `
          SELECT message_id, subject, from_email, to_email, body_snippet, body_text, body_html, customer_language
            FROM mod_tools_devis_queue
           WHERE message_id = $1
             AND ( $2::text IS NULL OR org_id IS NULL OR org_id::text = $2::text )
           LIMIT 1
        `,
        [messageId, orgId]
      );
      const row = rowRes.rows?.[0] || null;
      if (!row) return res.status(404).json({ ok: false, error: 'message_not_found' });

      const cfg = await loadPromptConfigById(promptConfigId, orgId);
      if (!cfg) return res.status(404).json({ ok: false, error: 'prompt_config_not_found' });
      const promptId = String(cfg.prompt_id || '').trim();
      const promptVersion = cfg.prompt_version ? String(cfg.prompt_version).trim() : '';
      const model = String(cfg.model || '').trim();
      if (!promptId) return res.status(400).json({ ok: false, error: 'prompt_id_missing', message: 'prompt_id is missing on this prompt config' });
      if (!model) return res.status(400).json({ ok: false, error: 'model_missing', message: 'model is missing on this prompt config (no fallback)' });

      const subject = String(row.subject || '');
      const fromLine = String(row.from_email || '');
      const toLine = String(row.to_email || '');
      const snippet = String(row.body_snippet || '');
      const bodyText = String(row.body_text || '');
      const bodyHtml = String(row.body_html || '');
      const body = bodyText || stripHtml(bodyHtml) || snippet || '';

      const inputPayload = {
        message_id: messageId,
        subject,
        from: fromLine,
        to: toLine,
        snippet,
        body: String(body).slice(0, 8000),
        task: 'Detect the customer language from the email content.',
      };

      const t0Prompt = Date.now();
      const out = await respondWithPrompt({
        apiKey: String(cfg.openai_api_key || '').trim() || undefined,
        promptId,
        promptVersion: promptVersion || undefined,
        model,
        input: JSON.stringify(inputPayload),
        responseFormat: 'json_object',
        instructions:
          'Return JSON only: {"iso_code":"fr"} where iso_code is a 2-letter lowercase ISO language code like fr,en,cs,de,es,it,nl. Use empty string if unknown.',
      });
      const msPrompt = Date.now() - t0Prompt;
      const text = String(out?.text || '');
      try {
        await recordPromptConfigHistory(pool, {
          promptConfigId: cfg.id || promptConfigId,
          input: JSON.stringify(inputPayload),
          output: text,
          requestBody: out?.request_body || null,
          response: out?.raw || null,
          ms: msPrompt,
        });
      } catch {}

      let iso = '';
      try {
        const parsed = JSON.parse(String(text || '{}'));
        iso = String(parsed?.iso_code || parsed?.language || parsed?.lang || '').trim().toLowerCase();
      } catch {}
      if (!iso) {
        iso = guessLanguageHeuristic(`${subject}\n${snippet}\n${body}`);
      }
      iso = String(iso || '').trim().toLowerCase();
      if (iso.length > 2) iso = iso.slice(0, 2);
      // Normalize English to Prestashop's common "gb" iso_code when possible/desired.
      if (iso === 'en' || iso === 'uk') iso = 'gb';

      if (iso) {
        await pool.query(
          `
            UPDATE mod_tools_devis_queue
               SET customer_language = $3,
                   updated_at = NOW()
             WHERE message_id = $1
               AND ( $2::text IS NULL OR org_id IS NULL OR org_id::text = $2::text )
          `,
          [messageId, orgId, iso]
        );
      }

      chatLog('devis_detect_language', { message_id: messageId, org_id: orgId || null, iso_code: iso || null, prompt_config_id: cfg.id });
      return res.json({ ok: true, iso_code: iso || '' });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'detect_failed', message: String(error?.message || error) });
    }
  });

  app.get('/api/tools/devis/data', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const profileId = Number(req.query?.profile_id || 0);
    const idShop = Number(req.query?.id_shop || 0);
    const idLang = Number(req.query?.id_lang || 0);
    const search = String(req.query?.search || '').trim();
    const includeAccessoriesRaw = String(req.query?.include_accessories ?? req.query?.accessories ?? '').trim().toLowerCase();
    const includeAccessories = includeAccessoriesRaw === '1' || includeAccessoriesRaw === 'true' || includeAccessoriesRaw === 'yes';
    if (!profileId || !idShop || !idLang) {
      return res.status(400).json({ ok: false, error: 'missing_scope', message: 'profile_id, id_shop and id_lang are required' });
    }
    try {
      const orgId = pickOrgId(req);
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      const conn = await connectMySql(ctx, cfg);
      try {
        const { q, hasTable, hasColumn } = makeSqlHelpers(conn);
        const dbName = String(cfg.database);
        const viewName = String(process.env.DEVIS_PRODUCT_VIEW || 'data_devis_4');
        if (!(await hasTable(viewName, dbName))) return res.json({ ok: true, items: [] });

        const hasIdLang = await hasColumn(viewName, 'id_lang', dbName);
        const hasIdShop = await hasColumn(viewName, 'id_shop', dbName);
        if (!hasIdLang || !hasIdShop) {
          const payload = { profileId, shop: idShop, lang: idLang, view: viewName, hasIdLang, hasIdShop };
          chatLog('devis_data_view_missing_scope', payload);
          return res.status(500).json({
            ok: false,
            error: 'view_missing_scope',
            message: `MySQL view/table "${viewName}" must include id_lang and id_shop columns.`,
            details: payload,
          });
        }

        const hasReference = await hasColumn(viewName, 'reference', dbName);
        const hasProductName = await hasColumn(viewName, 'product_name', dbName);
        const hasName = await hasColumn(viewName, 'name', dbName);
        const hasCategoryTypo = await hasColumn(viewName, 'catgeory', dbName);
        const hasCategory = await hasColumn(viewName, 'category', dbName);
        const hasIdProduct = await hasColumn(viewName, 'id_product', dbName);
        const hasProductId = await hasColumn(viewName, 'product_id', dbName);
        const idCol = hasIdProduct ? 'id_product' : hasProductId ? 'product_id' : null;
        const orderCol = idCol || 'id_product';

        const args = [idLang, idShop];
        let where = 'WHERE id_lang = ? AND id_shop = ?';
        if (search) {
          const pattern = `%${search}%`;
          const clauses = [];
          if (hasReference) clauses.push('reference LIKE ?');
          if (hasProductName) clauses.push('product_name LIKE ?');
          if (!hasProductName && hasName) clauses.push('name LIKE ?');
          if (hasCategoryTypo) clauses.push('catgeory LIKE ?');
          if (!hasCategoryTypo && hasCategory) clauses.push('category LIKE ?');
          if (hasIdProduct) clauses.push('CAST(id_product AS CHAR) LIKE ?');
          if (!hasIdProduct && hasProductId) clauses.push('CAST(product_id AS CHAR) LIKE ?');

          if (clauses.length) {
            where += ` AND (${clauses.join(' OR ')})`;
            args.push(...clauses.map(() => pattern));
          }
        }
        const rows = await q(`SELECT * FROM \`${viewName}\` ${where} ORDER BY \`${orderCol}\` DESC LIMIT 60`, args);
        const items = (Array.isArray(rows) ? rows : []).map(mapDevisRow);

        // Optional: hydrate Prestashop accessories (ps_accessory) and attach per-product.
        if (includeAccessories && idCol && items.length) {
          try {
            const prefix = String(process.env.PRESTASHOP_TABLE_PREFIX || process.env.PS_TABLE_PREFIX || 'ps_');
            const tAccessory = prefix + 'accessory';
            const canUseAccessory =
              (await hasTable(tAccessory, dbName)) &&
              (await hasColumn(tAccessory, 'id_product_1', dbName)) &&
              (await hasColumn(tAccessory, 'id_product_2', dbName));

            if (canUseAccessory) {
              const parentIds = Array.from(new Set(items.map((x) => Number(x.id)).filter((n) => Number.isFinite(n) && n > 0)));
              if (parentIds.length) {
                const placeholders = parentIds.map(() => '?').join(',');
                const relRows = await q(
                  `SELECT id_product_1, id_product_2 FROM \`${tAccessory}\` WHERE id_product_1 IN (${placeholders})`,
                  parentIds
                );
                const byParent = new Map(); // parentId -> Set(accessoryId)
                const accessoryIds = new Set();
                for (const rel of Array.isArray(relRows) ? relRows : []) {
                  const p = Number(rel?.id_product_1 || 0);
                  const a = Number(rel?.id_product_2 || 0);
                  if (!p || !a) continue;
                  accessoryIds.add(a);
                  if (!byParent.has(p)) byParent.set(p, new Set());
                  byParent.get(p).add(a);
                }

                if (accessoryIds.size) {
                  const ids = Array.from(accessoryIds).slice(0, 400);
                  const accPlaceholders = ids.map(() => '?').join(',');
                  const accRows = await q(
                    `SELECT * FROM \`${viewName}\` WHERE id_lang = ? AND id_shop = ? AND \`${idCol}\` IN (${accPlaceholders})`,
                    [idLang, idShop, ...ids]
                  );
                  const accItems = (Array.isArray(accRows) ? accRows : []).map(mapDevisRow);
                  const accById = new Map(accItems.map((x) => [Number(x.id), x]));

                  for (const item of items) {
                    const set = byParent.get(Number(item.id));
                    if (!set) continue;
                    const accList = Array.from(set)
                      .map((id) => accById.get(Number(id)))
                      .filter(Boolean)
                      .map((x) => ({ ...x, is_accessory: true }));
                    item.accessories = accList;
                  }
                }
              }
            }
          } catch (e) {
            chatLog('devis_data_accessories_failed', { profileId, shop: idShop, lang: idLang, error: String(e?.message || e) });
          }
        }

        // Hydrate Prestashop combinations / attributes (variants) and attach per-product.
        if (items.length) {
          try {
            const ids = [];
            const visit = (item) => {
              const id = Number(item?.id || 0);
              if (id) ids.push(id);
              const acc = item?.accessories;
              if (Array.isArray(acc)) {
                for (const a of acc) visit(a);
              }
            };
            for (const item of items) visit(item);

            const variantsByProduct = await loadPrestashopVariants({
              q,
              hasTable,
              hasColumn,
              dbName,
              productIds: ids,
              idShop,
              idLang,
            });

            const attach = (item) => {
              const id = Number(item?.id || 0);
              if (!id) return;
              const baseHt = toNumberValue(item.price_ht, 0);
              const baseTtc = toNumberValue(item.price_ttc, 0);
              const ratio = baseHt > 0 ? baseTtc / baseHt : 1;
              const variants = (variantsByProduct.get(id) || []).map((v) => {
                const nextHt = baseHt + toNumberValue(v.price_impact_ht, 0);
                const nextTtc = nextHt * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
                return {
                  ...v,
                  price_ht: Number.isFinite(nextHt) ? nextHt : baseHt,
                  price_ttc: Number.isFinite(nextTtc) ? nextTtc : baseTtc,
                };
              });
              item.variants = variants;
              const acc = item?.accessories;
              if (Array.isArray(acc)) {
                for (const a of acc) attach(a);
              }
            };
            for (const item of items) attach(item);
          } catch (e) {
            chatLog('devis_data_variants_failed', { profileId, shop: idShop, lang: idLang, error: String(e?.message || e) });
          }
        }

        chatLog('devis_data_search', { profileId, shop: idShop, lang: idLang, hits: items.length, accessories: includeAccessories });
        return res.json({ ok: true, items });
      } finally {
        try { await conn.end(); } catch {}
      }
    } catch (error) {
      const msg = (error && error.message) || String(error);
      if (/mysql2_missing/i.test(msg)) {
        return res.status(503).json({ ok: false, error: 'mysql2_missing', message: 'Install mysql2 in backend' });
      }
      chatLog('devis_data_search_failed', { profileId, shop: idShop, lang: idLang, error: msg });
      return res.status(500).json({ ok: false, error: 'data_failed', message: msg });
    }
  });

  app.post('/api/tools/devis/queue/from-email', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const body = req.body || {};
    const messageId = String(body.messageId || body.id || '').trim();
    const fromLine = String(body.from || body.from_email || '').trim();
    const subject = String(body.subject || '').trim();
    if (!messageId || !fromLine) {
      return res.status(400).json({ ok: false, error: 'missing_fields', message: 'messageId and from are required' });
    }
    try {
      const orgId = pickOrgId(req);
      const payload = {
        ...body,
        messageId,
        subject,
        from: fromLine,
        to: body.to || body.to_email || '',
        snippet: body.snippet || '',
        body_text: typeof body.body_text === 'string' ? body.body_text : typeof body.bodyText === 'string' ? body.bodyText : '',
        body_html: typeof body.body_html === 'string' ? body.body_html : typeof body.bodyHtml === 'string' ? body.bodyHtml : '',
        promptId: body.promptId || body.prompt_id,
        promptVersion: body.promptVersion || body.prompt_version,
        promptModel: body.promptModel || body.prompt_model,
        promptConfigId: body.promptConfigId || body.prompt_config_id,
        request_preview: body.request_preview || null,
      };
      const { item, extraction } = await queueEmailForDevis({ pool, payload, orgId, chatLog, ctx });
      return res.json({ ok: true, item, extraction });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'queue_failed', message: String(error?.message || error) });
    }
  });

  app.post('/api/tools/devis/offers', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const payload = req.body || {};
    const profileId = Number(payload.profileId || 0);
    const shopId = Number(payload.shopId || 0);
    const langId = Number(payload.langId || 0);
    if (!profileId || !shopId || !langId) {
      return res.status(400).json({ ok: false, error: 'missing_scope', message: 'profileId, shopId and langId are required' });
    }
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) {
      return res.status(400).json({ ok: false, error: 'missing_items', message: 'Add at least one item to create a quote' });
    }
    const header = payload.header || {};
    const totals = payload.totals || {};
    const orgId = pickOrgId(req);
    try {
      const normalizedHeader = normalizeHeader(header);
      const hydratedHeader = await hydrateHeaderFromPrestashop({ profileId, shopId, orgId, header: normalizedHeader });
      const result = await persistOffer({ profileId, shopId, langId, header: hydratedHeader, items, totals, orgId });
      chatLog('devis_offer_created', {
        org_id: orgId || null,
        profileId,
        shopId,
        langId,
        quoteNumber: result.quoteNumber,
      });
      return res.json({ ok: true, offer: { id: result.id, quote_number: result.quoteNumber } });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'offer_failed', message: String(error?.message || error) });
    }
  });

  app.post('/api/tools/devis/offers/email', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const payload = req.body || {};
    const profileId = Number(payload.profileId || 0);
    const shopId = Number(payload.shopId || 0);
    const langId = Number(payload.langId || 0);
    if (!profileId || !shopId || !langId) {
      return res.status(400).json({ ok: false, error: 'missing_scope', message: 'profileId, shopId and langId are required' });
    }
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (!items.length) {
      return res.status(400).json({ ok: false, error: 'missing_items', message: 'Add at least one item to create a quote' });
    }
    const header = payload.header || {};
    const totals = payload.totals || {};
    const orgId = pickOrgId(req);
    try {
      const normalizedHeader = normalizeHeader(header);
      const hydratedHeader = await hydrateHeaderFromPrestashop({ profileId, shopId, orgId, header: normalizedHeader });
      const translated = await applyDevisTranslation({ orgId, shopId, langId, header: hydratedHeader });
      const result = await persistOffer({ profileId, shopId, langId, header: translated.header, items, totals, orgId });
      let emailInfo = { status: 'skipped', message: 'Pas d’email client renseigné.' };
      if (result.header.customer_email) {
        try {
          const pdfBuffer = await buildQuotePdf({
            quoteNumber: result.quoteNumber,
            header: { ...result.header, i18n_labels: translated.i18nLabels || result.header.i18n_labels || null },
            items: result.items,
            totals: result.totals,
          });
          const emailHtml = renderEmailHtml({
            header: { ...result.header, i18n_labels: translated.i18nLabels || result.header.i18n_labels || null },
            items: result.items,
            totals: result.totals,
            quoteNumber: result.quoteNumber,
          });
          const i18n = getDevisI18n({
            isoCode: result.header.lang_iso_code,
            locale: result.header.lang_locale,
            labelsOverride: translated.i18nLabels || result.header.i18n_labels || null,
          });
          const emailSubject = buildQuoteEmailSubject({ header: result.header, i18n, quoteNumber: result.quoteNumber });
          const emailText = `Bonjour ${result.header.customer_name || ''},\n\nVoici votre devis ${result.quoteNumber}.\nTotal estimé: ${formatCurrency(
            result.totals.grandTotal,
            result.header.currency
          )}\n`;
          const fromAddress = toOneLine(result.header.vendor_email || result.header.shop_email || '');
          let draftOk = false;
          let lastError = null;
          const tryCreateDraft = async (fromValue) => {
            try {
              await createDraft({
                ctx,
                to: result.header.customer_email,
                subject: emailSubject,
                html: emailHtml,
                text: emailText,
                from: fromValue || undefined,
                attachments: [
                  {
                    filename: `${result.quoteNumber}.pdf`,
                    mimeType: 'application/pdf',
                    data: pdfBuffer,
                  },
                ],
              });
              draftOk = true;
            } catch (err) {
              lastError = err;
            }
          };

          // First try with explicit from; if Gmail rejects it, retry without from so the account default is used.
          await tryCreateDraft(fromAddress);
          if (!draftOk && fromAddress) {
            await tryCreateDraft(null);
          }

          if (draftOk) {
            emailInfo = { status: 'draft_created', message: 'Brouillon Gmail créé avec pièce jointe.' };
          } else {
            throw lastError || new Error('draft_failed');
          }
        } catch (emailError) {
          emailInfo = {
            status: 'failed',
            message: String(emailError?.message || emailError || 'Erreur lors de la création du mail'),
          };
        }
      }
      chatLog('devis_offer_created', {
        org_id: orgId || null,
        profileId,
        shopId,
        langId,
        quoteNumber: result.quoteNumber,
      });
      return res.json({
        ok: true,
        offer: { id: result.id, quote_number: result.quoteNumber },
        email: emailInfo,
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'offer_failed', message: String(error?.message || error) });
    }
  });

  app.post('/api/tools/devis/offers/preview', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const payload = req.body || {};
    const profileId = Number(payload.profileId || 0);
    const shopId = Number(payload.shopId || 0);
    const langId = Number(payload.langId || 0);
    if (!profileId || !shopId || !langId) {
      return res.status(400).json({ ok: false, error: 'missing_scope', message: 'profileId, shopId and langId are required' });
    }
    const items = buildItemsPayload(payload.items);
    if (!items.length) {
      return res.status(400).json({ ok: false, error: 'missing_items', message: 'Add at least one item to preview the quote' });
    }
    const normalizedHeader = normalizeHeader(payload.header || {});
    const orgId = pickOrgId(req);
    const hydratedHeader = await hydrateHeaderFromPrestashop({ profileId, shopId, orgId, header: normalizedHeader });
    const translated = await applyDevisTranslation({ orgId, shopId, langId, header: hydratedHeader });
    const normalizedTotals = buildTotalsPayload(payload.totals);
    const headerPayload = payload.header || {};
    const i18n = getDevisI18n({
      isoCode: translated.header.lang_iso_code,
      locale: translated.header.lang_locale,
      labelsOverride: translated.header.i18n_labels || null,
    });
    const previewQuoteNumber =
      headerPayload.quote_number ||
      headerPayload.devis_number ||
      `DEV-${new Date().toISOString().slice(0, 10)}-PREVIEW`;
    const html = renderEmailHtml({
      header: translated.header,
      items,
      totals: normalizedTotals,
      quoteNumber: previewQuoteNumber,
    });
    return res.json({ ok: true, html, quoteNumber: previewQuoteNumber });
  });

  app.get('/api/tools/devis/translations', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    try {
      const orgId = pickOrgId(req);
      const shopId = Number(req.query?.shop_id || 0);
      const langId = Number(req.query?.lang_id || 0);
      const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50)));
      const args = [];
      let where = 'WHERE 1=1';
      if (shopId) { args.push(shopId); where += ` AND shop_id = $${args.length}`; }
      if (langId) { args.push(langId); where += ` AND lang_id = $${args.length}`; }
      if (orgId) { args.push(Number(orgId)); where += ` AND (org_id IS NULL OR org_id = $${args.length})`; }
      args.push(limit);
      const rows = await pool.query(
        `
          SELECT id, org_id, shop_id, lang_id, iso_code, locale, vendor, labels, created_at, updated_at
            FROM mod_tools_devis_translations
          ${where}
          ORDER BY updated_at DESC
          LIMIT $${args.length}
        `,
        args
      );
      return res.json({ ok: true, items: rows.rows || [] });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'list_failed', message: String(error?.message || error) });
    }
  });

  app.post('/api/tools/devis/translations/upsert', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const body = req.body || {};
    const shopId = Number(body.shop_id || body.shopId || 0);
    const langId = Number(body.lang_id || body.langId || 0);
    if (!shopId || !langId) {
      return res.status(400).json({ ok: false, error: 'missing_scope', message: 'shop_id and lang_id are required' });
    }
    const orgId = body.org_id !== undefined ? body.org_id : pickOrgId(req);
    const orgInt = orgId === null || orgId === '' || orgId === undefined ? null : Number(orgId);
    const isoCode = body.iso_code ? String(body.iso_code) : null;
    const locale = body.locale ? String(body.locale) : null;
    const vendor = body.vendor && typeof body.vendor === 'object' ? body.vendor : {};
    const labels = body.labels && typeof body.labels === 'object' ? body.labels : {};
    try {
      const updateRes = await pool.query(
        `
          UPDATE mod_tools_devis_translations
             SET iso_code = COALESCE($4, iso_code),
                 locale = COALESCE($5, locale),
                 vendor = $6::jsonb,
                 labels = $7::jsonb,
                 updated_at = NOW()
           WHERE shop_id = $1
             AND lang_id = $2
             AND ( ($3::int IS NULL AND org_id IS NULL) OR (org_id = $3::int) )
         RETURNING *
        `,
        [shopId, langId, orgInt, isoCode, locale, JSON.stringify(vendor), JSON.stringify(labels)]
      );
      if (updateRes.rows?.length) return res.json({ ok: true, item: updateRes.rows[0] });
      const insertRes = await pool.query(
        `
          INSERT INTO mod_tools_devis_translations (org_id, shop_id, lang_id, iso_code, locale, vendor, labels, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,NOW(),NOW())
          RETURNING *
        `,
        [orgInt, shopId, langId, isoCode, locale, JSON.stringify(vendor), JSON.stringify(labels)]
      );
      return res.json({ ok: true, item: insertRes.rows?.[0] || null });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'upsert_failed', message: String(error?.message || error) });
    }
  });

  app.post('/api/tools/devis/translations/bulk-upsert', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const body = req.body || {};
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return res.status(400).json({ ok: false, error: 'missing_items', message: 'items[] required' });
    const orgId = pickOrgId(req);
    const orgInt = orgId === null || orgId === '' || orgId === undefined ? null : Number(orgId);
    const clamp = items.slice(0, 500);
    const saved = [];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const it of clamp) {
        const shopId = Number(it.shop_id || it.shopId || 0);
        const langId = Number(it.lang_id || it.langId || 0);
        if (!shopId || !langId) continue;
        const isoCode = it.iso_code ? String(it.iso_code) : null;
        const locale = it.locale ? String(it.locale) : null;
        const vendor = it.vendor && typeof it.vendor === 'object' && !Array.isArray(it.vendor) ? it.vendor : {};
        const labels = it.labels && typeof it.labels === 'object' && !Array.isArray(it.labels) ? it.labels : {};
        const updateRes = await client.query(
          `
            UPDATE mod_tools_devis_translations
               SET iso_code = COALESCE($4, iso_code),
                   locale = COALESCE($5, locale),
                   vendor = $6::jsonb,
                   labels = $7::jsonb,
                   updated_at = NOW()
             WHERE shop_id = $1
               AND lang_id = $2
               AND ( ($3::int IS NULL AND org_id IS NULL) OR (org_id = $3::int) )
           RETURNING *
          `,
          [shopId, langId, orgInt, isoCode, locale, JSON.stringify(vendor), JSON.stringify(labels)]
        );
        let row = updateRes.rows?.[0] || null;
        if (!row) {
          const insertRes = await client.query(
            `
              INSERT INTO mod_tools_devis_translations (org_id, shop_id, lang_id, iso_code, locale, vendor, labels, created_at, updated_at)
              VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,NOW(),NOW())
              RETURNING *
            `,
            [orgInt, shopId, langId, isoCode, locale, JSON.stringify(vendor), JSON.stringify(labels)]
          );
          row = insertRes.rows?.[0] || null;
        }
        if (row) saved.push(row);
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      return res.status(500).json({ ok: false, error: 'bulk_upsert_failed', message: String(error?.message || error) });
    } finally {
      client.release();
    }
    return res.json({ ok: true, count: saved.length, items: saved });
  });

  app.post('/api/tools/devis/translations/generate', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const body = req.body || {};
    const shopId = Number(body.shop_id || body.shopId || 0);
    const langId = Number(body.lang_id || body.langId || 0);
    const promptConfigId = String(body.promptConfigId || body.prompt_config_id || '').trim();
    const orgId = pickOrgId(req);
    if (!shopId || !langId || !promptConfigId) {
      return res.status(400).json({ ok: false, error: 'missing_fields', message: 'shop_id, lang_id and promptConfigId are required' });
    }

    const targetIso = String(body.target_iso_code || body?.target?.iso_code || body.iso_code || '').trim().toLowerCase();
    const targetLocale = String(body.target_locale || body?.target?.locale || body.locale || '').trim();
    const sourceVendor = (body.source && typeof body.source === 'object') ? body.source.vendor : body.vendor;
    const sourceLabels = (body.source && typeof body.source === 'object') ? body.source.labels : body.labels;
    const safeVendor = sourceVendor && typeof sourceVendor === 'object' && !Array.isArray(sourceVendor) ? sourceVendor : {};
    const safeLabels = sourceLabels && typeof sourceLabels === 'object' && !Array.isArray(sourceLabels) ? sourceLabels : {};

    try {
      const cfg = await loadPromptConfigById(promptConfigId, orgId);
      if (!cfg) return res.status(404).json({ ok: false, error: 'prompt_config_not_found' });
      const promptId = String(cfg.prompt_id || '').trim();
      const model = String(cfg.model || '').trim();
      if (!promptId) return res.status(400).json({ ok: false, error: 'prompt_id_missing', message: 'prompt_id is missing on this prompt config' });
      if (!model) return res.status(400).json({ ok: false, error: 'model_missing', message: 'model is missing on this prompt config (no fallback)' });

      const inputPayload = {
        shop_id: shopId,
        lang_id: langId,
        target: { iso_code: targetIso || null, locale: targetLocale || null },
        source: { vendor: safeVendor, labels: safeLabels },
        keys: {
          vendor: ['contact_vendor', 'URL', 'name_web_site', 'logo', 'mobil_number_vendor', 'e-mail_vendor'],
          labels: [
            // Core template keys
            'doc_title',
            'quote_number',
            'date',
            'subtotal_products',
            'discount',
            'client_info',
            'vendor_info',
            'client_name',
            'client_company',
            'client_email',
            'vendor_company',
            'vendor_contact',
            'vendor_email',
            'vendor_phone',
            'details',
            'reference',
            'product_name',
            'description',
            'unit_price',
            'quantity',
            'line_total',
            'total',
            'product_link',
            'image',
            'link_text',
            'transport_cost',
	            'delivery_lead_time',
	            'summary',
	            'email_intro_html',
	            // Legacy keys
	            'web_text',
	            'votre_contact_text',
	            'email_text',
            'mobil_text',
            'date_devis_text',
            'adresse_de_facturation_text',
            'adresse_de_livraison_text',
            'references_text',
            'qty_text',
            'description_text',
            'port_text',
            'delai_text',
            'total_avant_remise_text',
            'remise_text',
            'total_text',
            'remarques_text',
            'customer_name_text',
            'customer_company_text',
            'prix_unitaire_text',
            'prix_total_text',
            'devis_number_text',
            'link_to_order_text',
            'transport_cost_text',
            'transport_by_text',
            'delivery_lead_time_text',
            'jour_ouvrable_text',
          ],
        },
      };

      const t0 = Date.now();
      chatLog('devis_translations_generate_start', { shop_id: shopId, lang_id: langId, prompt_config_id: promptConfigId, model });
      const out = await respondWithPrompt({
        apiKey: cfg.openai_api_key || undefined,
        model,
        promptId,
        promptVersion: cfg.prompt_version ? String(cfg.prompt_version) : undefined,
        input: JSON.stringify(inputPayload),
        responseFormat: 'json_object',
        instructions:
          'Return JSON only. Translate/normalize quote labels for the target language. Keep keys unchanged. Keep URLs/emails/phones unchanged. Preserve punctuation like ":" when provided. Output: { vendor: {...}, labels: {...}, iso_code?, locale? }.',
      });
      const ms = Date.now() - t0;

      let parsed = {};
      try { parsed = JSON.parse(String(out?.text || '{}')); } catch { parsed = {}; }
      const vendor = parsed?.vendor && typeof parsed.vendor === 'object' && !Array.isArray(parsed.vendor) ? parsed.vendor : null;
      const labels = parsed?.labels && typeof parsed.labels === 'object' && !Array.isArray(parsed.labels) ? parsed.labels : null;
      if (!vendor || !labels) {
        throw new Error('prompt_invalid_output: expected JSON with { vendor: object, labels: object }');
      }
      const isoCode = String(parsed?.iso_code || targetIso || '').trim() || null;
      const locale = String(parsed?.locale || targetLocale || '').trim() || null;

      // Persist in prompt test history so it appears in Automation Suite
      try {
        const hid = `pth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await pool.query(
          `INSERT INTO mod_automation_suite_prompt_test_history (id, prompt_config_id, input, output, request, response, ms, created_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,NOW())`,
          [hid, promptConfigId, JSON.stringify(inputPayload), JSON.stringify({ vendor, labels, iso_code: isoCode, locale }), JSON.stringify(out.request_body || {}), JSON.stringify(out.raw || {}), ms]
        );
      } catch {}

      // Upsert into translations table
      const orgInt = orgId === null || orgId === '' || orgId === undefined ? null : Number(orgId);
      const updateRes = await pool.query(
        `
          UPDATE mod_tools_devis_translations
             SET iso_code = COALESCE($4, iso_code),
                 locale = COALESCE($5, locale),
                 vendor = $6::jsonb,
                 labels = $7::jsonb,
                 updated_at = NOW()
           WHERE shop_id = $1
             AND lang_id = $2
             AND ( ($3::int IS NULL AND org_id IS NULL) OR (org_id = $3::int) )
         RETURNING *
        `,
        [shopId, langId, orgInt, isoCode, locale, JSON.stringify(vendor), JSON.stringify(labels)]
      );
      let item = updateRes.rows?.[0] || null;
      if (!item) {
        const insertRes = await pool.query(
          `
            INSERT INTO mod_tools_devis_translations (org_id, shop_id, lang_id, iso_code, locale, vendor, labels, created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,NOW(),NOW())
            RETURNING *
          `,
          [orgInt, shopId, langId, isoCode, locale, JSON.stringify(vendor), JSON.stringify(labels)]
        );
        item = insertRes.rows?.[0] || null;
      }
      chatLog('devis_translations_generate_done', { shop_id: shopId, lang_id: langId, ms, prompt_config_id: promptConfigId, model, saved: !!item });
      return res.json({
        ok: true,
        item,
        generated: { vendor, labels, iso_code: isoCode, locale },
        prompt: { prompt_config_id: promptConfigId, prompt_id: promptId, prompt_version: cfg.prompt_version || null, model },
        ms,
      });
    } catch (error) {
      const msg = String(error?.message || error);
      chatLog('devis_translations_generate_error', { shop_id: shopId, lang_id: langId, message: msg.slice(0, 240) });
      return res.status(500).json({ ok: false, error: 'generate_failed', message: msg });
    }
  });
}
