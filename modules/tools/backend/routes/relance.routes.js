import { connectMySql, makeSqlHelpers, getMysql2FromCtx } from '../../../grabbing-jerome/backend/services/transfer/mysql.js';
import { loadProfileConfig } from '../../../product-search-index/backend/services/indexer.service.js';
import { respondWithPrompt } from '../../../../backend/lib/openaiResponses.js';
import { recordPromptConfigHistory, redactMcpToolsInRequestBody } from '../../../../backend/lib/promptConfigHistory.js';
import { createDraft, sendEmail } from '../../../google-api/backend/services/gmail.service.js';
import { loadDevisTranslation, loadDevisTranslationAnyLang, buildDevisI18nOverride } from '../services/devis-translation.service.js';
import { loadModToolsConfigRow, upsertModToolsConfig } from '../utils/modToolsConfig.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

function pickOrgId(req) {
  try {
    const raw = req.headers['x-org-id'] || req.query?.org_id || req.body?.org_id;
    if (!raw) return null;
    const trimmed = String(raw).trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function requireAdminGuard(ctx = {}) {
  if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

function requireAuthGuard(ctx = {}) {
  if (typeof ctx.requireAuth === 'function') return ctx.requireAuth;
  if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

function toOrgInt(value) {
  try {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  } catch {
    return null;
  }
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

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeShopDomainNoWww(raw = '') {
  try {
    let s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/&amp;/gi, '&');
    try {
      if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
      const u = new URL(s);
      let host = String(u.hostname || '').trim();
      host = host.replace(/^www\./i, '');
      return host;
    } catch {
      s = s.replace(/^https?:\/\//i, '');
      s = s.replace(/\/.*$/, '');
      s = s.replace(/^www\./i, '');
      return s;
    }
  } catch {
    return '';
  }
}

function normalizePhone(raw, callPrefix) {
  try {
    const input = String(raw || '').trim();
    if (!input) return null;
    let s = input.replace(/[^\d+]/g, '');
    if (!s) return null;
    if (s.startsWith('00')) s = `+${s.slice(2)}`;
    if (s.startsWith('+')) return s.replace(/[^\d+]/g, '');
    const cp = String(callPrefix || '').trim().replace(/\D/g, '');
    let digits = s.replace(/\D/g, '');
    if (!digits) return null;
    if (cp && digits.startsWith(cp) && digits.length > cp.length + 5) return `+${digits}`;
    if (cp) {
      digits = digits.replace(/^0+/, '');
      return `+${cp}${digits}`;
    }
    return digits;
  } catch {
    return null;
  }
}

function formatMoney(amount, currency) {
  const n = Number(amount);
  const cur = String(currency || '').trim().toUpperCase();
  if (!Number.isFinite(n)) return '';
  if (!/^[A-Z]{3}$/.test(cur)) return String(n.toFixed(2));
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
}

function buildBankWireBlocks({ amount, currency, reference, details, countryOverride }) {
  const amt = formatMoney(amount, currency);
  const ref = String(reference || '').trim();
  const d = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
  const holder = String(d.account_holder || '').trim();
  const bankName = String(d.bank_name || '').trim();
  const addr = d.address && typeof d.address === 'object' && !Array.isArray(d.address) ? d.address : null;
  const country = String(countryOverride || (addr && addr.country) || '').trim();
  const bankAddress = (() => {
    if (!addr) return String(d.bank_address || '').trim();
    const line1 = String(addr.line1 || '').trim();
    const line2 = String(addr.line2 || '').trim();
    const postal = String(addr.postal_code || '').trim();
    const city = String(addr.city || '').trim();
    const parts = [];
    if (line1) parts.push(line1);
    if (line2) parts.push(line2);
    const cityLine = [postal, city].filter(Boolean).join(' ').trim();
    if (cityLine) parts.push(cityLine);
    const joined = parts.join(', ').trim();
    return joined || String(d.bank_address || '').trim();
  })();
  const acctCur = String(d.account_currency || currency || '').trim().toUpperCase();
  const iban = String(d.iban || '').trim();
  const bic = String(d.bic || '').trim();

  const textLines = [];
  textLines.push('---');
  textLines.push('Coordonnées bancaires (virement)');
  textLines.push(`Montant à régler : ${amt || ''}`.trim());
  textLines.push(`Référence de la commande : ${ref || ''}`.trim());
  textLines.push('');
  if (holder) textLines.push(`Titulaire du compte : ${holder}`);
  if (bankName) textLines.push(`Banque : ${bankName}`);
  if (bankAddress) textLines.push(`Adresse de la banque : ${bankAddress}`);
  if (country) textLines.push(`Pays : ${country}`);
  if (acctCur) textLines.push(`Devise du compte : ${acctCur}`);
  textLines.push('');
  if (iban) textLines.push(`IBAN : ${iban}`);
  if (bic) textLines.push(`BIC / SWIFT : ${bic}`);
  const blockText = textLines.filter((l) => l !== null && l !== undefined).join('\n').trim();

  const rows = [];
  rows.push(['Montant à régler', amt || '']);
  rows.push(['Référence de la commande', ref || '']);
  if (holder) rows.push(['Titulaire du compte', holder]);
  if (bankName) rows.push(['Banque', bankName]);
  if (bankAddress) rows.push(['Adresse de la banque', bankAddress]);
  if (country) rows.push(['Pays', country]);
  if (acctCur) rows.push(['Devise du compte', acctCur]);
  if (iban) rows.push(['IBAN', iban]);
  if (bic) rows.push(['BIC / SWIFT', bic]);

  const tr = rows
    .map(
      ([k, v]) => `
        <tr>
          <td style="padding:6px 0;font-weight:600;vertical-align:top;white-space:nowrap;">${escapeHtml(k)} :</td>
          <td style="padding:6px 0 6px 12px;vertical-align:top;">${escapeHtml(v)}</td>
        </tr>`
    )
    .join('\n');

  const blockHtml = [
    '<div style="margin:16px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;">',
    '<div style="font-weight:700;margin:0 0 8px 0;">Coordonnées bancaires (virement)</div>',
    '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:0;width:100%;max-width:680px;">',
    '<tbody>',
    tr,
    '</tbody>',
    '</table>',
    '</div>',
  ].join('\n');

  return { blockText, blockHtml };
}

function buildBankWireI18nSeed({ amount, currency, reference, details, countryOverride }) {
  const amt = formatMoney(amount, currency);
  const ref = String(reference || '').trim();
  const d = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
  const holder = String(d.account_holder || '').trim();
  const bankName = String(d.bank_name || '').trim();
  const addr = d.address && typeof d.address === 'object' && !Array.isArray(d.address) ? d.address : null;
  const country = String(countryOverride || (addr && addr.country) || '').trim();
  const bankAddress = (() => {
    if (!addr) return String(d.bank_address || '').trim();
    const line1 = String(addr.line1 || '').trim();
    const line2 = String(addr.line2 || '').trim();
    const postal = String(addr.postal_code || '').trim();
    const city = String(addr.city || '').trim();
    const parts = [];
    if (line1) parts.push(line1);
    if (line2) parts.push(line2);
    const cityLine = [postal, city].filter(Boolean).join(' ').trim();
    if (cityLine) parts.push(cityLine);
    const joined = parts.join(', ').trim();
    return joined || String(d.bank_address || '').trim();
  })();
  const acctCur = String(d.account_currency || currency || '').trim().toUpperCase();
  const iban = String(d.iban || '').trim();
  const bic = String(d.bic || '').trim();

  return {
    labels_fr: {
      section_title: 'Coordonnées bancaires (virement)',
      amount_due: 'Montant à régler',
      order_reference: 'Référence de la commande',
      account_holder: 'Titulaire du compte',
      bank_name: 'Banque',
      bank_address: 'Adresse de la banque',
      country: 'Pays',
      account_currency: 'Devise du compte',
      iban: 'IBAN',
      bic: 'BIC / SWIFT',
    },
    values: {
      amount_due: amt || null,
      order_reference: ref || null,
      account_holder: holder || null,
      bank_name: bankName || null,
      bank_address: bankAddress || null,
      account_currency: acctCur || null,
      iban: iban || null,
      bic: bic || null,
      country: country || null,
    },
  };
}

function stripBankBlockText(text = '') {
  try {
    const lines = String(text || '').split(/\r?\n/);
    let start = -1;
    let end = -1;
    for (let i = 0; i < lines.length; i += 1) {
      const l = String(lines[i] || '').toLowerCase();
      if (start === -1 && l.includes('montant à régler')) start = i;
      if (start !== -1 && (l.includes('bic') || l.includes('swift'))) { end = i; break; }
    }
    if (start === -1 || end === -1 || end < start) return String(text || '').trim();
    const kept = [...lines.slice(0, start), ...lines.slice(end + 1)];
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return String(text || '').trim();
  }
}

function stripBankBlockHtml(html = '') {
  try {
    const s = String(html || '');
    const lower = s.toLowerCase();
    const start = lower.indexOf('montant à régler');
    if (start === -1) return s.trim();
    let end = lower.indexOf('bic', start);
    if (end === -1) end = lower.indexOf('swift', start);
    if (end === -1) return s.trim();
    // Extend to a likely boundary
    let cut = s.indexOf('</div>', end);
    if (cut !== -1) cut += '</div>'.length;
    else {
      cut = s.indexOf('<br', end);
      if (cut !== -1) cut += 4;
      else cut = Math.min(s.length, end + 120);
    }
    const out = (s.slice(0, start) + s.slice(cut)).replace(/\s{2,}/g, ' ');
    return out.trim();
  } catch {
    return String(html || '').trim();
  }
}

function appendEmailHtml(baseHtml, extraHtml) {
  const html = String(baseHtml || '').trim();
  const extra = String(extraHtml || '').trim();
  if (!extra) return html;
  if (!html) return extra;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${extra}\n</body>`);
  return `${html}\n${extra}`;
}

function appendEmailText(baseText, extraText) {
  const t = String(baseText || '').trim();
  const extra = String(extraText || '').trim();
  if (!extra) return t;
  if (!t) return extra;
  return `${t}\n\n${extra}`;
}

function normalizeUrl(raw, fallbackDomain) {
  let s = String(raw || '').trim();
  if (!s) {
    const d = String(fallbackDomain || '').trim();
    if (d) s = d;
  }
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return s;
}

function normalizeLogoUrl(rawLogo, fallbackDomain) {
  const logo = String(rawLogo || '').trim();
  if (!logo) return '';
  if (/^https?:\/\//i.test(logo)) return logo;
  const domain = String(fallbackDomain || '').trim();
  if (!domain) return '';
  const base = normalizeUrl(domain, domain).replace(/\/+$/, '');
  // If the value already looks like a path, just prepend the domain once.
  if (logo.includes('/')) return `${base}/${logo.replace(/^\/+/, '')}`;
  // In our Presta setups, PS_LOGO_INVOICE points to a filename under /img/.
  return `${base}/img/${logo.replace(/^\/+/, '')}`;
}

function stripHtmlImages(html = '') {
  const s = String(html || '');
  if (!s) return '';
  // Relance emails/drafts should not contain images (logos cause cross-shop + preview inconsistencies).
  return s
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<figure\b[^>]*>\s*<\/figure>/gi, '')
    .replace(/<p\b[^>]*>\s*<\/p>/gi, '');
}

function stripSignatureLikeLinesFromText(text = '') {
  const raw = String(text || '');
  if (!raw) return '';
  const lines = raw.split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    const t = String(line || '').trim();
    // Remove obvious signature contact lines (multi-language).
    if (/^(tel|t[ée]l|telefon|phone)\s*[:]/i.test(t)) continue;
    if (/^(e-?mail|mail)\s*[:]/i.test(t)) continue;
    if (/^(website|site|web)\s*[:]/i.test(t)) continue;
    if (/^https?:\/\/\S+$/i.test(t) && /\/img\/os\//i.test(t)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripSignatureLikeBlocksFromHtml(html = '') {
  let s = String(html || '');
  if (!s) return '';
  // Remove blocks containing signature contact labels. Best-effort; keeps tracking links etc.
  s = s.replace(/<p\b[^>]*>[\s\S]*?(Tel|T[ée]l|Telefon|Phone)\s*:\s*[\s\S]*?<\/p>/gi, '');
  s = s.replace(/<div\b[^>]*>[\s\S]*?(Tel|T[ée]l|Telefon|Phone)\s*:\s*[\s\S]*?<\/div>/gi, '');
  s = s.replace(/<p\b[^>]*>[\s\S]*?(E-?mail|Mail)\s*:\s*[\s\S]*?<\/p>/gi, '');
  s = s.replace(/<div\b[^>]*>[\s\S]*?(E-?mail|Mail)\s*:\s*[\s\S]*?<\/div>/gi, '');
  s = s.replace(/<p\b[^>]*>[\s\S]*?(Website|Site|Web)\s*:\s*[\s\S]*?<\/p>/gi, '');
  s = s.replace(/<div\b[^>]*>[\s\S]*?(Website|Site|Web)\s*:\s*[\s\S]*?<\/div>/gi, '');
  return s.trim();
}

function sanitizeRelanceEmailOutput({ html, text }) {
  // Keep images in the model output if present; we'll strip body images separately and add our own shop logo via signature.
  const cleanHtml = stripSignatureLikeBlocksFromHtml(html || '');
  const cleanText = stripSignatureLikeLinesFromText(text || '');
  return { html: cleanHtml, text: cleanText };
}

function labelHouseNumber(langIso) {
  const iso = String(langIso || '').trim().toLowerCase();
  if (!iso) return 'house number';
  if (iso === 'fr') return 'numéro de maison';
  if (iso === 'cs') return 'číslo domu';
  if (iso === 'de') return 'Hausnummer';
  if (iso === 'es') return 'número de casa';
  if (iso === 'it') return 'numero civico';
  if (iso === 'pl') return 'numer domu';
  return 'house number';
}

async function buildDevisLikeSignature({ pool, orgId, shopId, langId, fallbackDomain, fallbackEmail, fallbackPhone, fallbackLogo }) {
  const result = {
    contact_name: null,
    company_name: null,
    phone: null,
    email: null,
    website: null,
    logo_url: null,
    html: '',
    text: '',
    _debug: null,
  };
  try {
    // No fallback: use only the exact (shop_id + lang_id) translation row when present.
    // If it's missing, keep those fields empty.
    const row = await loadDevisTranslation(pool, { orgId, shopId, langId });
    const { vendorOverride } = row ? buildDevisI18nOverride(row) : { vendorOverride: {} };
    const contact = String(vendorOverride?.vendor_contact_name || '').trim();
    // No fallback: company/email/website/phone come strictly from shop configs (id_shop).
    const company = String(fallbackDomain || '').trim();
    // Phone must come from the shop's Presta config (PS_SHOP_PHONE) for the correct id_shop.
    // If missing, keep it empty rather than falling back to a vendor override (which may be for another shop).
    const phone = String(fallbackPhone || '').trim();
    const email = String(fallbackEmail || '').trim();
    const website = normalizeUrl(fallbackDomain || '', fallbackDomain);
    // Use only the shop's PS_LOGO_INVOICE (no fallbacks to avoid cross-shop logos).
    const logo = normalizeLogoUrl(fallbackLogo || '', fallbackDomain);

    result.contact_name = contact || null;
    result.company_name = company || null;
    result.phone = phone || null;
    result.email = email || null;
    result.website = website || null;
    result.logo_url = logo || null;
    result._debug = {
      shop_id: shopId ?? null,
      lang_id: langId ?? null,
      used_any_lang: false,
      source_row_id: row?.id ?? null,
      source_shop_id: row?.shop_id ?? null,
      source_lang_id: row?.lang_id ?? null,
      has_vendor_override: !!(vendorOverride && Object.keys(vendorOverride).length),
      fallback_phone_used: !!(phone && fallbackPhone),
      fallback_logo_used: !!(logo && fallbackLogo),
      logo_source: '',
      fallback_domain_used: !!(website && fallbackDomain),
    };

    const lines = [];
    lines.push('');
    if (contact) lines.push(contact);
    if (company) lines.push(company);
    if (phone) lines.push(`Tel : ${phone}`);
    if (email) lines.push(`E-mail : ${email}`);
    if (website) lines.push(`Website : ${website.replace(/^https?:\/\//i, '')}`);
    result.text = lines.filter(Boolean).join('\n').trim();

    const h = [];
    h.push('<div style="margin-top:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;">');
    if (contact) h.push(`<div style="font-weight:700;">${escapeHtml(contact)}</div>`);
    if (company) h.push(`<div>${escapeHtml(company)}</div>`);
    if (phone) h.push(`<div>Tel : ${escapeHtml(phone)}</div>`);
    if (email) h.push(`<div>E-mail : <a href="mailto:${encodeHtmlAttr(email)}">${escapeHtml(email)}</a></div>`);
    if (website) {
      const clean = website.replace(/^https?:\/\//i, '');
      h.push(`<div>Website : <a href="${encodeHtmlAttr(website)}">${escapeHtml(clean)}</a></div>`);
    }
    if (logo && /^https?:\/\//i.test(logo)) {
      h.push(`<div style="margin-top:10px;"><img src="${encodeHtmlAttr(logo)}" alt="logo" style="max-width:220px;height:auto;" /></div>`);
    }
    h.push('</div>');
    result.html = h.join('\n');
  } catch {}
  return result;
}

async function buildSignatureForItem(pool, orgId, item = {}) {
  // Small in-memory cache (per org) to avoid reloading tools_config on every request.
  // The signature cache is refreshed manually via Tools > EmailRelance > Parametres > Update signature.
  const now = Date.now();
  const orgKey = String(orgId ?? '');
  const shopId = Number(item?.id_shop ?? 0) || null;
  const langId = Number(item?.id_lang ?? 0) || null;
  const fallbackDomain = item.shop_domain_no_www || item.shop_domain_ssl || '';
  const fallbackEmail = item.shop_email || '';
  const fallbackPhone = item.shop_phone || '';
  const fallbackLogo = item.shop_logo_invoice || '';
  try {
    if (pool && shopId && langId) {
      const cache = await loadRelanceSignatureCache(pool, orgKey, now);
      const s = cache?.shops?.[String(shopId)] || null;
      const entry = s?.by_lang?.[String(langId)] || s?.by_lang?.['0'] || null;
      if (entry && typeof entry === 'object') {
        return {
          ...entry,
          _debug: {
            cache: 'hit',
            cache_updated_at: cache?.updated_at || null,
            shop_id: shopId,
            lang_id: langId,
          },
        };
      }
    }
  } catch {}

  const computed = await buildDevisLikeSignature({
    pool,
    orgId,
    shopId,
    langId,
    fallbackDomain,
    fallbackEmail,
    fallbackPhone,
    fallbackLogo,
  });
  return {
    ...computed,
    _debug: { ...(computed?._debug || null), cache: 'miss' },
  };
}

const relanceSignatureCacheMem = new Map();

async function loadRelanceSignatureCache(pool, orgKey, nowMs) {
  const key = String(orgKey || '');
  if (!key) return null;
  const ttlMs = 60_000;
  const prev = relanceSignatureCacheMem.get(key) || null;
  if (prev && prev.loaded_at_ms && (nowMs - prev.loaded_at_ms) < ttlMs) return prev.value || null;
  try {
    const row = await loadToolsConfigValue(pool, KEY_RELANCE_SIGNATURE_CACHE, toOrgInt(key));
    const value = row?.value && typeof row.value === 'object' && !Array.isArray(row.value) ? row.value : null;
    const normalized = value && typeof value === 'object' ? value : null;
    relanceSignatureCacheMem.set(key, { loaded_at_ms: nowMs, value: normalized });
    return normalized;
  } catch {
    relanceSignatureCacheMem.set(key, { loaded_at_ms: nowMs, value: null });
    return null;
  }
}

async function fetchLogoDataUrl(url, timeoutMs = 6000) {
  const u = String(url || '').trim();
  if (!u || !/^https?:\/\//i.test(u)) return null;
  if (typeof fetch !== 'function') return null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => { try { ac.abort(); } catch {} }, Math.max(1000, Number(timeoutMs) || 6000));
    try {
      const resp = await fetch(u, { signal: ac.signal });
      if (!resp.ok) return null;
      const ct = String(resp.headers.get('content-type') || '').trim().toLowerCase();
      const buf = Buffer.from(await resp.arrayBuffer());
      if (!buf.length) return null;
      const mime = ct.includes('image/') ? ct.split(';')[0] : 'image/png';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

function buildRelanceSignatureEntry({ contact = '', domainNoWww = '', email = '', phone = '', logoInvoice = '', logoUrlOverride = '' }) {
  const company = String(domainNoWww || '').trim();
  const contactName = String(contact || '').trim();
  const phoneStr = String(phone || '').trim();
  const emailStr = String(email || '').trim();
  const website = normalizeUrl(company || '', company || '');
  const logoUrl = String(logoUrlOverride || '').trim() || normalizeLogoUrl(String(logoInvoice || '').trim(), company);

  const lines = [];
  lines.push('');
  if (contactName) lines.push(contactName);
  if (company) lines.push(company);
  if (phoneStr) lines.push(`Tel : ${phoneStr}`);
  if (emailStr) lines.push(`E-mail : ${emailStr}`);
  if (website) lines.push(`Website : ${website.replace(/^https?:\/\//i, '')}`);
  const text = lines.filter(Boolean).join('\n').trim();

  const h = [];
  h.push('<div style="margin-top:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;">');
  if (contactName) h.push(`<div style="font-weight:700;">${escapeHtml(contactName)}</div>`);
  if (company) h.push(`<div>${escapeHtml(company)}</div>`);
  if (phoneStr) h.push(`<div>Tel : ${escapeHtml(phoneStr)}</div>`);
  if (emailStr) h.push(`<div>E-mail : <a href="mailto:${encodeHtmlAttr(emailStr)}">${escapeHtml(emailStr)}</a></div>`);
  if (website) {
    const clean = website.replace(/^https?:\/\//i, '');
    h.push(`<div>Website : <a href="${encodeHtmlAttr(website)}">${escapeHtml(clean)}</a></div>`);
  }
  if (logoUrl && /^https?:\/\//i.test(logoUrl)) {
    h.push(`<div style="margin-top:10px;"><img src="${encodeHtmlAttr(logoUrl)}" alt="logo" style="max-width:220px;height:auto;" /></div>`);
  }
  h.push('</div>');
  const html = h.join('\n');

  return {
    contact_name: contactName || null,
    company_name: company || null,
    phone: phoneStr || null,
    email: emailStr || null,
    website: website || null,
    logo_url: logoUrl || null,
    html,
    text,
  };
}

function encodeHtmlAttr(value = '') {
  return escapeHtml(String(value || '').replace(/"/g, '&quot;'));
}

async function hydrateShopEmailsByIdShop(q, prefix, items) {
  const list = Array.isArray(items) ? items : [];
  const missing = list.filter((it) => it && !String(it.shop_email || '').trim() && Number(it.id_shop) > 0);
  if (!missing.length) return;
  const ids = Array.from(new Set(missing.map((it) => Number(it.id_shop)).filter((n) => Number.isFinite(n) && n > 0))).slice(0, 200);
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  const table = `\`${String(prefix || 'ps_')}configuration\``;
  let rows = [];
  let globalEmail = '';
  try {
    rows = await q(
      `SELECT id_shop, value FROM ${table} WHERE name='PS_SHOP_EMAIL' AND (id_shop IN (${ph}) OR id_shop IS NULL OR id_shop = 0)`,
      ids
    );
  } catch {
    return;
  }
  const map = new Map();
  for (const r of rows || []) {
    const v = String(r?.value || '').trim();
    if (!v) continue;
    const idShop = r?.id_shop == null ? 0 : Number(r?.id_shop);
    if (!Number.isFinite(idShop) || idShop < 0) continue;
    if (idShop === 0 && !globalEmail) globalEmail = v;
    if (idShop > 0 && !map.has(idShop)) map.set(idShop, v);
  }
  for (const it of missing) {
    const idShop = Number(it.id_shop);
    const v = map.get(idShop) || globalEmail;
    if (v) it.shop_email = v;
  }
}

async function getShopEmailWithFallback(q, prefix, idShop) {
  const shopId = Number(idShop);
  if (!Number.isFinite(shopId) || shopId <= 0) return '';
  const table = `\`${String(prefix || 'ps_')}configuration\``;
  try {
    const r1 = await q(`SELECT value FROM ${table} WHERE name='PS_SHOP_EMAIL' AND id_shop = ? LIMIT 1`, [shopId]);
    const v1 = String(r1?.[0]?.value || '').trim();
    if (v1) return v1;
  } catch {}
  return '';
}

async function getShopPhoneWithFallback(q, prefix, idShop) {
  const shopId = Number(idShop);
  if (!Number.isFinite(shopId) || shopId <= 0) return '';
  const table = `\`${String(prefix || 'ps_')}configuration\``;
  try {
    const r1 = await q(`SELECT value FROM ${table} WHERE name='PS_SHOP_PHONE' AND id_shop = ? LIMIT 1`, [shopId]);
    const v1 = String(r1?.[0]?.value || '').trim();
    if (v1) return v1;
  } catch {}
  return '';
}

async function getShopLogoInvoiceWithFallback(q, prefix, idShop) {
  const shopId = Number(idShop);
  if (!Number.isFinite(shopId) || shopId <= 0) return '';
  const table = `\`${String(prefix || 'ps_')}configuration\``;
  try {
    const r1 = await q(`SELECT value FROM ${table} WHERE name='PS_LOGO_INVOICE' AND id_shop = ? LIMIT 1`, [shopId]);
    const v1 = String(r1?.[0]?.value || '').trim();
    if (v1) return v1;
  } catch {}
  return '';
}

async function hydrateOrderShopLangAndConfigs(q, prefix, item) {
  const it = item && typeof item === 'object' ? item : null;
  const idOrder = Number(it?.id_order);
  if (!it || !Number.isFinite(idOrder) || idOrder <= 0) return;
  try {
    const rows = await q(
      `
        SELECT
          o.id_shop AS id_shop,
          o.id_lang AS id_lang,
          c.firstname AS firstname,
          c.lastname AS lastname,
          c.email AS email,
          conf.value AS shop_domain_ssl,
          conf2.value AS shop_email,
          conf3.value AS shop_phone,
          conf4.value AS shop_logo_invoice,
          l.name AS lang_name,
          l.iso_code AS iso_code
        FROM \`${prefix}orders\` o
        JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
        LEFT JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
        LEFT JOIN \`${prefix}configuration\` conf2 ON conf2.id_shop = o.id_shop AND conf2.name = 'PS_SHOP_EMAIL'
        LEFT JOIN \`${prefix}configuration\` conf3 ON conf3.id_shop = o.id_shop AND conf3.name = 'PS_SHOP_PHONE'
        LEFT JOIN \`${prefix}configuration\` conf4 ON conf4.id_shop = o.id_shop AND conf4.name = 'PS_LOGO_INVOICE'
        LEFT JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
        WHERE o.id_order = ?
        LIMIT 1
      `,
      [idOrder]
    );
    const r = rows?.[0] || null;
    if (!r) return;
    // Always prefer ps_orders and shop-scoped configs (id_shop) over view-provided columns.
    it.id_shop = Number(r.id_shop) || null;
    it.id_lang = Number(r.id_lang) || null;
    it.shop_domain_ssl = String(r.shop_domain_ssl || '').trim();
    it.shop_domain_no_www = normalizeShopDomainNoWww(String(it.shop_domain_ssl || '').trim());
    it.shop_email = String(r.shop_email || '').trim();
    // Phone/logo are authoritative from Presta config for the order's id_shop (avoid stale values coming from views).
    const ph = String(r.shop_phone || '').trim();
    if (ph) it.shop_phone = ph;
    const li = String(r.shop_logo_invoice || '').trim();
    if (li) it.shop_logo_invoice = li;
    it.langue = String(r.lang_name || '').trim();
    it.lang_iso_code = String(r.iso_code || '').trim().toLowerCase() || null;
    it.customer_email = String(r.email || '').trim();
    it.firstname = String(r.firstname || '').trim();
    it.lastname = String(r.lastname || '').trim();
    it.customer_name = [it.firstname, it.lastname].filter(Boolean).join(' ').trim();
  } catch {}
}

async function hydrateOrderAmountsAndCurrency(q, prefix, items) {
  const list = Array.isArray(items) ? items : [];
  const missing = list.filter((it) => it && Number(it.id_order) > 0 && (!it.currency_iso || it.total_paid_tax_incl == null || !Number.isFinite(Number(it.total_paid_tax_incl))));
  if (!missing.length) return;
  const ids = Array.from(new Set(missing.map((it) => Number(it.id_order)).filter((n) => Number.isFinite(n) && n > 0))).slice(0, 500);
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  const tOrders = `\`${String(prefix || 'ps_')}orders\``;
  const tCurrency = `\`${String(prefix || 'ps_')}currency\``;
  let rows = [];
  try {
    rows = await q(
      `SELECT o.id_order, o.total_paid_tax_incl, o.id_currency, cur.iso_code AS currency_iso
         FROM ${tOrders} o
         LEFT JOIN ${tCurrency} cur ON cur.id_currency = o.id_currency
        WHERE o.id_order IN (${ph})`,
      ids
    );
  } catch {
    return;
  }
  const map = new Map();
  for (const r of rows || []) {
    const idOrder = Number(r?.id_order);
    if (!Number.isFinite(idOrder) || idOrder <= 0) continue;
    map.set(idOrder, {
      total: r?.total_paid_tax_incl != null ? Number(r.total_paid_tax_incl) : null,
      currency: String(r?.currency_iso || '').trim().toUpperCase() || null,
    });
  }
  for (const it of missing) {
    const idOrder = Number(it.id_order);
    const v = map.get(idOrder);
    if (!v) continue;
    if (it.total_paid_tax_incl == null && v.total != null && Number.isFinite(v.total)) it.total_paid_tax_incl = v.total;
    if (!it.currency_iso && v.currency) it.currency_iso = v.currency;
  }
}

async function hydrateCallPrefixesByOrderId(q, prefix, items) {
  const list = Array.isArray(items) ? items : [];
  const missing = list.filter((it) => it && Number(it.id_order) > 0 && (!it.call_prefix || !String(it.call_prefix).trim()));
  if (!missing.length) return;
  const ids = Array.from(new Set(missing.map((it) => Number(it.id_order)).filter((n) => Number.isFinite(n) && n > 0))).slice(0, 500);
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  const tOrders = `\`${String(prefix || 'ps_')}orders\``;
  const tAddress = `\`${String(prefix || 'ps_')}address\``;
  const tCountry = `\`${String(prefix || 'ps_')}country\``;
  let rows = [];
  try {
    rows = await q(
      `SELECT o.id_order, co.call_prefix
         FROM ${tOrders} o
         JOIN ${tAddress} a ON a.id_address = o.id_address_delivery
         JOIN ${tCountry} co ON co.id_country = a.id_country
        WHERE o.id_order IN (${ph})`,
      ids
    );
  } catch {
    return;
  }
  const map = new Map();
  for (const r of rows || []) {
    const idOrder = Number(r?.id_order);
    const cp = String(r?.call_prefix || '').trim();
    if (!Number.isFinite(idOrder) || idOrder <= 0 || !cp) continue;
    map.set(idOrder, cp);
  }
  for (const it of missing) {
    const idOrder = Number(it.id_order);
    const cp = map.get(idOrder);
    if (!cp) continue;
    it.call_prefix = cp;
    if (!it.phone_e164) it.phone_e164 = normalizePhone(it.phone, cp);
    if (!it.mobile_e164) it.mobile_e164 = normalizePhone(it.mobile, cp);
  }
}

function normalizeCurrencyCode(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : '';
}

function normalizeIban(raw) {
  return String(raw || '').replace(/\s+/g, '').trim().toUpperCase();
}

function normalizeBic(raw) {
  return String(raw || '').replace(/\s+/g, '').trim().toUpperCase();
}

function pickBankDetailsForCurrency(bankDetails, currencyIso) {
  const cur = normalizeCurrencyCode(currencyIso);
  const bd = bankDetails && typeof bankDetails === 'object' && !Array.isArray(bankDetails) ? bankDetails : {};

  // New format: { banks: [ { label?, account_holder, bank_name, address:{...}, accounts:[{currency,iban,bic}] } ] }
  const banks = Array.isArray(bd.banks) ? bd.banks : null;
  const legacyAccounts = Array.isArray(bd.accounts) ? bd.accounts : [];
  const normalizedLegacyAccounts = legacyAccounts
    .map((a) => ({ currency: normalizeCurrencyCode(a?.currency), iban: normalizeIban(a?.iban), bic: normalizeBic(a?.bic) }))
    .filter((a) => a.currency && a.iban);

  const normalizedBanks = (banks && banks.length ? banks : [
    {
      label: null,
      account_holder: bd.account_holder,
      bank_name: bd.bank_name,
      address: { line1: bd.bank_address, line2: '', postal_code: '', city: '', country: '' },
      accounts: normalizedLegacyAccounts,
    },
  ])
    .map((b) => {
      const addr = b?.address && typeof b.address === 'object' && !Array.isArray(b.address) ? b.address : {};
      const accounts2 = Array.isArray(b?.accounts) ? b.accounts : [];
      const normalizedAccounts = accounts2
        .map((a) => ({ currency: normalizeCurrencyCode(a?.currency), iban: normalizeIban(a?.iban), bic: normalizeBic(a?.bic) }))
        .filter((a) => a.currency && a.iban);
      return {
        label: String(b?.label || '').trim() || null,
        account_holder: String(b?.account_holder || '').trim() || null,
        bank_name: String(b?.bank_name || '').trim() || null,
        address: {
          line1: String(addr.line1 || '').trim() || null,
          line2: String(addr.line2 || '').trim() || null,
          postal_code: String(addr.postal_code || '').trim() || null,
          city: String(addr.city || '').trim() || null,
          country: String(addr.country || '').trim() || null,
        },
        accounts: normalizedAccounts,
      };
    });

  const pickFromBank = (bank) => {
    const accs = Array.isArray(bank?.accounts) ? bank.accounts : [];
    const preferred = cur ? accs.find((a) => a.currency === cur) : null;
    const fallback = accs[0] || null;
    const selected = preferred || fallback;
    return {
      label: bank?.label || null,
      account_holder: bank?.account_holder || null,
      bank_name: bank?.bank_name || null,
      address: bank?.address || null,
      account_currency: (selected && selected.currency) || cur || null,
      iban: (selected && selected.iban) || null,
      bic: (selected && selected.bic) || null,
    };
  };

  // Choose bank by currency match (first bank that has matching account), else first bank.
  let chosenBank = normalizedBanks[0] || null;
  if (cur) {
    for (const b of normalizedBanks) {
      const accs = Array.isArray(b?.accounts) ? b.accounts : [];
      if (accs.some((a) => a.currency === cur)) { chosenBank = b; break; }
    }
  }
  const picked = chosenBank ? pickFromBank(chosenBank) : null;
  return picked || { label: null, account_holder: null, bank_name: null, address: null, account_currency: cur || null, iban: null, bic: null };
}

async function getToolsMysqlProfileId(pool, orgId) {
  const row = await loadModToolsConfigRow(pool, 'mysql_profile', orgId);
  const profileId = row?.value?.profile_id ?? null;
  return profileId == null ? null : String(profileId).trim() || null;
}

async function loadToolsConfigValue(pool, key, orgId) {
  return loadModToolsConfigRow(pool, key, orgId);
}

async function upsertToolsConfigValue(pool, key, value, orgId) {
  const row = await upsertModToolsConfig(pool, key, value, orgId);
  return row;
}

const KEY_RELANCE_VIREMENT_PROMPT = 'relance_virement_prompt';
const KEY_RELANCE_VIREMENT_EMAIL_PROMPT = 'relance_virement_email_prompt';
const KEY_RELANCE_VIREMENT_BANK_DETAILS = 'relance_virement_bank_details';
const KEY_RELANCE_MAISON_PROMPT = 'relance_numero_maison_prompt';
const KEY_RELANCE_TELEPHONE_PROMPT = 'relance_numero_telephone_prompt';
const KEY_RELANCE_TRACKING_MCP2 = 'relance_tracking_mcp2_servers';
const KEY_RELANCE_TRACKING_PROMPT = 'relance_tracking_prompt';
const KEY_RELANCE_GATEWAY_DEFAULT_LINE = 'relance_gateway_default_subscription_id';
const KEY_RELANCE_SIGNATURE_CACHE = 'relance_signature_cache_v1';

function isObj(v) { return !!(v && typeof v === 'object' && !Array.isArray(v)); }
function countSignatureCacheEntries(cache) {
  try {
    const shops = cache && typeof cache === 'object' ? cache.shops : null;
    if (!shops || typeof shops !== 'object') return { shopCount: 0, entryCount: 0 };
    let shopCount = 0;
    let entryCount = 0;
    for (const [k, v] of Object.entries(shops)) {
      if (!k) continue;
      const s = v && typeof v === 'object' ? v : null;
      if (!s) continue;
      shopCount += 1;
      const byLang = s.by_lang && typeof s.by_lang === 'object' ? s.by_lang : null;
      if (!byLang) continue;
      for (const _ of Object.keys(byLang)) entryCount += 1;
    }
    return { shopCount, entryCount };
  } catch {
    return { shopCount: 0, entryCount: 0 };
  }
}

async function loadMcp2ServerAuth(pool, serverId) {
  try {
    if (!pool || typeof pool.query !== 'function') return null;
    const id = String(serverId || '').trim();
    if (!id) return null;
    const r = await pool.query(
      `SELECT id, name, token, enabled
         FROM mod_mcp2_server
        WHERE id = $1 OR name = $1 OR lower(name) = lower($1)
        LIMIT 1`,
      [id]
    );
    if (!r?.rowCount) return null;
    const row = r.rows[0] || {};
    return {
      id: String(row.id || id),
      name: String(row.name || '').trim(),
      token: String(row.token || '').trim(),
      enabled: row.enabled !== false,
    };
  } catch {
    return null;
  }
}

function parseMcp2NameFromUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    const m = u.pathname.match(/\/api\/mcp2\/([^/]+)(?:\/|$)/i);
    if (!m) return null;
    return decodeURIComponent(String(m[1] || '').trim()) || null;
  } catch {
    try {
      const s = String(url || '').trim();
      const m = s.match(/\/api\/mcp2\/([^/]+)(?:\/|$)/i);
      if (!m) return null;
      return decodeURIComponent(String(m[1] || '').trim()) || null;
    } catch {
      return null;
    }
  }
}

function extractMcp2ServerRefsFromPromptTools(toolsValue) {
  const tools = Array.isArray(toolsValue) ? toolsValue : [];
  const refs = [];
  for (const t of tools) {
    const o = t && typeof t === 'object' ? t : null;
    if (!o) continue;
    if (String(o.type || '').toLowerCase() !== 'mcp') continue;
    const label = String(o.server_label || '').trim();
    const url = String(o.server_url || '').trim();
    const fromUrl = url ? parseMcp2NameFromUrl(url) : null;
    for (const r of [label, fromUrl]) {
      const v = String(r || '').trim();
      if (v) refs.push(v);
    }
  }
  return Array.from(new Set(refs));
}

async function resolveMcp2ServerIdsFromPromptConfig(pool, promptConfigId, orgId) {
  try {
    if (!pool || typeof pool.query !== 'function') return [];
    const pcId = String(promptConfigId || '').trim();
    if (!pcId) return [];

    // 1) Preferred: prompt_config ↔ mcp2_server links managed by Automation Suite UI
    try {
      const r = await pool.query(
        `SELECT mcp2_server_id
           FROM mod_automation_suite_prompt_mcp2
          WHERE prompt_config_id = $1`,
        [pcId]
      );
      const ids = (r.rows || []).map((x) => String(x?.mcp2_server_id || '').trim()).filter(Boolean);
      if (ids.length) return Array.from(new Set(ids));
    } catch {}

    // 2) Fallback: if prompt_config.tools happens to embed MCP definitions (non-standard)
    const cfg = await loadPromptConfigById(pool, pcId, orgId);
    const toolsValue = (() => {
      try {
        if (Array.isArray(cfg?.tools)) return cfg.tools;
        if (typeof cfg?.tools === 'string') return JSON.parse(cfg.tools);
        return cfg?.tools || null;
      } catch { return null; }
    })();
    const refs = extractMcp2ServerRefsFromPromptTools(toolsValue);
    if (!refs.length) return [];

    const out = [];
    for (const ref of refs) {
      try {
        const r = await pool.query(
          `SELECT id
             FROM mod_mcp2_server
            WHERE id = $1
               OR name = $1
               OR lower(name) = lower($1)
               OR (stream_url ILIKE '%' || '/api/mcp2/' || $1 || '/%')
               OR (sse_url ILIKE '%' || '/api/mcp2/' || $1 || '/%')
            ORDER BY updated_at DESC NULLS LAST
            LIMIT 1`,
          [ref]
        );
        const id = r?.rows?.[0]?.id ? String(r.rows[0].id) : '';
        if (id) out.push(id);
      } catch {}
    }
    return Array.from(new Set(out));
  } catch {
    return [];
  }
}

function computeLocalBaseUrl() {
  try {
    const port = Number(process.env.PORT || 3010);
    return `http://127.0.0.1:${port}`;
  } catch {
    return 'http://127.0.0.1:3010';
  }
}

async function callMcp2JsonRpc({ serverAuth, method, params, timeoutMs = 20000 }) {
  const srv = serverAuth && typeof serverAuth === 'object' ? serverAuth : null;
  if (!srv?.id) return { ok: false, error: 'missing_server' };
  const m = String(method || '').trim();
  if (!m) return { ok: false, error: 'missing_method' };

  const base = computeLocalBaseUrl();
  const url = `${base}/api/mcp2/${encodeURIComponent(String(srv.id))}`;
  const headers = { 'Content-Type': 'application/json' };
  if (srv.token) headers.Authorization = `Bearer ${srv.token}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => { try { ctrl.abort(); } catch {} }, Math.max(500, Math.min(60000, Number(timeoutMs) || 20000)));
  try {
    const body = { jsonrpc: '2.0', id: Math.random().toString(16).slice(2), method: m, params: params ?? {} };
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: j?.error?.message || j?.error || `HTTP ${r.status}`, status: r.status, response: j };
    if (j && j.error) return { ok: false, error: j.error?.message || 'rpc_error', response: j };
    return { ok: true, result: j?.result };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    try { clearTimeout(t); } catch {}
  }
}

function scoreTrackingTool(tool) {
  try {
    const name = String(tool?.name || '').trim().toLowerCase();
    const desc = String(tool?.description || '').trim().toLowerCase();
    const schema = isObj(tool?.inputSchema) ? tool.inputSchema : {};
    const props = isObj(schema.properties) ? schema.properties : {};
    const propKeys = Object.keys(props).map((k) => String(k).toLowerCase());
    const required = Array.isArray(schema.required) ? schema.required.map((k) => String(k).toLowerCase()) : [];

    const hasIdOrder = propKeys.some((k) => k === 'id_order' || k === 'idorder' || k === 'order_id');
    const hasEmail = propKeys.some((k) => k === 'customer_email' || k === 'email' || k === 'customeremail');

    let score = 0;
    if (name.includes('tracking')) score += 6;
    if (name.includes('shipment') || name.includes('shipping') || name.includes('delivery') || name.includes('parcel') || name.includes('colis') || name.includes('follow')) score += 2;
    if (desc.includes('tracking') || desc.includes('suivi')) score += 2;
    if (hasIdOrder) score += 2;
    if (hasEmail) score += 2;
    if (required.includes('id_order') || required.includes('order_id') || required.includes('idorder')) score += 1;
    if (required.includes('customer_email') || required.includes('email')) score += 1;
    return score;
  } catch {
    return 0;
  }
}

function pickTrackingToolName(tools) {
  const list = Array.isArray(tools) ? tools : [];
  let best = null;
  let bestScore = -1;
  for (const t of list) {
    const s = scoreTrackingTool(t);
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }
  const name = String(best?.name || '').trim();
  return name ? { name, score: bestScore } : null;
}

function extractFirstUrl(value) {
  const urlRe = /\bhttps?:\/\/[^\s<>"')\]]+/i;
  const seen = new Set();
  const walk = (v) => {
    if (v == null) return null;
    if (typeof v === 'string') {
      const m = v.match(urlRe);
      if (!m) return null;
      const u = String(m[0] || '').trim();
      if (!u || seen.has(u)) return null;
      seen.add(u);
      return u;
    }
    if (typeof v === 'number' || typeof v === 'boolean') return null;
    if (Array.isArray(v)) {
      for (const x of v) {
        const u = walk(x);
        if (u) return u;
      }
      return null;
    }
    if (typeof v === 'object') {
      for (const k of ['tracking_url', 'trackingUrl', 'url', 'link', 'tracking_link', 'trackingLink']) {
        if (Object.prototype.hasOwnProperty.call(v, k)) {
          const u = walk(v[k]);
          if (u) return u;
        }
      }
      for (const k of Object.keys(v)) {
        const u = walk(v[k]);
        if (u) return u;
      }
      return null;
    }
    return null;
  };
  return walk(value);
}

async function resolveTrackingLinkFromMcp2({ pool, serverIds, order }) {
  const ids = (Array.isArray(serverIds) ? serverIds : []).map((x) => String(x || '').trim()).filter(Boolean);
  if (!ids.length) return { ok: false, error: 'no_mcp2_server' };
  const ord = order && typeof order === 'object' ? order : {};
  const customerName = String(ord.customer_name || '').trim();
  const customerEmail = String(ord.customer_email || '').trim();
  const recipientName = String(ord.firstname || '').trim();
  const recipientSurname = String(ord.lastname || '').trim();
  const carrierName = String(ord.carrier || '').trim();
  const trackingNumber = String(ord.tracking_number || '').trim();
  const idOrderStr = ord.id_order == null ? '' : String(ord.id_order).trim();
  const ref = String(ord.reference || '').trim();
  const shopDomain = String(ord.shop_domain_no_www || ord.shop_domain_ssl || '').trim();
  const naturalInput =
    `Trouve le lien de suivi pour id_order = ${idOrderStr || '?'}`
    + (ref ? ` (reference: ${ref})` : '')
    + (customerEmail ? `, email: ${customerEmail}` : '')
    + (trackingNumber ? `, tracking_number: ${trackingNumber}` : '')
    + (carrierName ? `, carrier: ${carrierName}` : '');
  const args = {
    id_order: ord.id_order ?? null,
    order_id: ord.id_order ?? null,
    reference: ord.reference || null,
    customer_email: customerEmail || null,
    email: customerEmail || null,
    customer_name: customerName || null,
    name: customerName || null,
    recipient_name: recipientName || null,
    recipient_surname: recipientSurname || null,
    carrier: carrierName || null,
    carrier_name: carrierName || null,
    tracking_number: trackingNumber || null,
    trackingNumber: trackingNumber || null,
    tracking: trackingNumber || null,
    input: naturalInput,
    q: naturalInput,
    query: naturalInput,
    text: naturalInput,
    id_shop: ord.id_shop ?? null,
    shop_domain: shopDomain || null,
  };

  for (const id of ids) {
    const srv = await loadMcp2ServerAuth(pool, id);
    if (!srv || srv.enabled === false) continue;
    const listResp = await callMcp2JsonRpc({ serverAuth: srv, method: 'tools/list', params: {} });
    const tools = (listResp.ok && isObj(listResp.result) && Array.isArray(listResp.result.tools)) ? listResp.result.tools : [];
    const ranked = (Array.isArray(tools) ? tools : [])
      .map((t) => ({ tool: t, score: scoreTrackingTool(t) }))
      .filter((x) => x.tool && String(x.tool.name || '').trim())
      .sort((a, b) => b.score - a.score);
    const candidates = ranked.filter((x) => x.score > 0).slice(0, 5);
    const fallback = candidates.length ? candidates : ranked.slice(0, 5);

    for (const cand of fallback) {
      const toolName = String(cand?.tool?.name || '').trim();
      if (!toolName) continue;
      const callResp = await callMcp2JsonRpc({
        serverAuth: srv,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
        timeoutMs: 30000,
      });
      if (!callResp.ok) continue;
      const url = extractFirstUrl(callResp.result);
      if (!url) continue;
      return { ok: true, tracking_url: url, server_id: srv.id, server_name: srv.name || null, tool_name: toolName };
    }
  }
  return { ok: false, error: 'tracking_link_not_found' };
}

async function loadPromptConfigById(pool, promptConfigId, orgId) {
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
    SELECT id, org_id, name, dev_message, messages, tools, openai_api_key, prompt_id, prompt_version, model,
           vector_store_id, vector_store_ids, metadata
      FROM mod_automation_suite_prompt_config
     WHERE id = $1
       ${whereOrg}
     LIMIT 1
  `;
  const res = await pool.query(sql, args);
  return res.rowCount ? res.rows[0] : null;
}

function normalizePromptConfigTools(rawTools) {
  const parsed = (() => {
    try {
      if (rawTools == null) return null;
      if (Array.isArray(rawTools)) return rawTools;
      if (typeof rawTools === 'string') return JSON.parse(rawTools);
      if (typeof rawTools === 'object') return rawTools;
      return null;
    } catch {
      return null;
    }
  })();

  // Two supported shapes:
  // 1) Object of flags: { file_search, web_search, web_search_allowed_domains, ... }
  // 2) Array of tool objects: [{ type: 'mcp', server_url, ... }, ...]
  const out = {
    toolsFileSearch: false,
    toolsCodeInterpreter: false,
    webSearchEnabled: false,
    webSearchAllowedDomains: undefined,
    webSearchContextSize: undefined,
    extraTools: undefined,
  };

  if (Array.isArray(parsed)) {
    out.extraTools = parsed;
    return out;
  }

  const obj = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  if (!obj) return out;

  out.toolsFileSearch = !!obj.file_search;
  out.toolsCodeInterpreter = !!obj.code_interpreter;
  out.webSearchEnabled = !!obj.web_search;
  if (Array.isArray(obj.web_search_allowed_domains)) {
    out.webSearchAllowedDomains = obj.web_search_allowed_domains.map((v) => String(v || '').trim()).filter(Boolean);
  }
  if (obj.web_search_context_size != null) out.webSearchContextSize = String(obj.web_search_context_size);

  if (Array.isArray(obj.tools)) out.extraTools = obj.tools;
  return out;
}

function sanitizeServerLabel(raw, fallback = 'mcp') {
  try {
    let s = String(raw || '').trim();
    s = s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!s) s = fallback;
    if (!/^[A-Za-z]/.test(s)) s = `mcp_${s}`;
    return s.slice(0, 64);
  } catch {
    return 'mcp';
  }
}

function uniqueServerLabel(raw, used) {
  const base = sanitizeServerLabel(raw || 'mcp');
  if (!used.has(base)) { used.add(base); return base; }
  for (let i = 2; i < 1000; i += 1) {
    const next = `${base}_${i}`;
    if (!used.has(next)) { used.add(next); return next; }
  }
  return `${base}_${Date.now().toString(36)}`;
}

async function buildMcpExtraToolsFromPromptConfig(pool, promptConfigId) {
  const out = [];
  if (!pool || !promptConfigId) return out;
  const seenLabels = new Set();
  try {
    const rr = await pool.query(
      `SELECT s.id, s.name, s.stream_url, s.sse_url, s.token, s.options, COALESCE(s.enabled,false) AS enabled
         FROM mod_automation_suite_prompt_mcp2 x
         JOIN mod_mcp2_server s ON s.id = x.mcp2_server_id
        WHERE x.prompt_config_id = $1
        ORDER BY s.updated_at DESC NULLS LAST`,
      [String(promptConfigId)]
    );
    for (const srow of rr.rows || []) {
      if (!srow || srow.enabled === false) continue;
      const name = String(srow.name || srow.id || '').trim();
      if (!name) continue;
      let opts = srow.options;
      try { if (typeof opts === 'string') opts = JSON.parse(opts); } catch { opts = {}; }
      const pref = (opts && opts.server_url_pref === 'stream') ? 'stream' : 'sse';
      let url = pref === 'stream' ? (srow.stream_url || srow.sse_url || '') : (srow.sse_url || srow.stream_url || '');
      url = String(url || '').trim();
      if (!url) continue;

      // MCP2 transport accepts query ?token=... (or Authorization). We use query token here.
      try {
        const token = String(srow.token || '').trim();
        if (token) {
          const u = new URL(url);
          if (!u.searchParams.get('token')) u.searchParams.set('token', token);
          url = u.toString();
        }
      } catch {}

      const allowed = Array.isArray(opts?.allowed_tools) ? opts.allowed_tools : undefined;
      const serverLabel = uniqueServerLabel(name, seenLabels);
      out.push({ type: 'mcp', server_url: url, server_label: serverLabel, allowed_tools: allowed, require_approval: 'never' });
    }
  } catch {}
  return out;
}

function sanitizeOpenAiResponseForDebug(out) {
  // `out.raw` is not always JSON-serializable (e.g. Response headers). Pick safe fields only.
  try {
    return {
      response_id: out?.response_id || null,
      openai_request_id: out?.openai_request_id || null,
      model: out?.raw?.model || null,
      usage: out?.raw?.usage || null,
      output: out?.raw?.output || null,
      output_text: (typeof out?.text === 'string') ? out.text : null,
    };
  } catch {
    return {
      response_id: out?.response_id || null,
      openai_request_id: out?.openai_request_id || null,
      output_text: (typeof out?.text === 'string') ? out.text : null,
    };
  }
}

function redactSecretsDeep(value, depth = 0, maxDepth = 6) {
  const SENSITIVE_KEY_RE = /(api[_-]?key|authorization|cookie|token|secret|password)/i;
  const OPENAI_KEY_RE = /\bsk-(?:proj-)?[A-Za-z0-9]{16,}\b/g;
  const BEARER_RE = /\bBearer\s+[A-Za-z0-9._-]+\b/g;
  const BASIC_RE = /\bBasic\s+[A-Za-z0-9+/=]+\b/g;

  const redactString = (s) => {
    try {
      let out = String(s)
        .replace(OPENAI_KEY_RE, '****')
        .replace(BEARER_RE, 'Bearer ****')
        .replace(BASIC_RE, 'Basic ****');
      // Redact token=... query param in URLs (MCP server_url commonly uses this).
      try {
        const u = new URL(out);
        if (u.searchParams.has('token')) u.searchParams.set('token', '****');
        out = u.toString();
      } catch {}
      return out;
    } catch {
      return '****';
    }
  };

  if (value == null) return value;
  if (depth >= maxDepth) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSecretsDeep(v, depth + 1, maxDepth));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const key = String(k || '');
    if (SENSITIVE_KEY_RE.test(key)) {
      out[key] = '****';
    } else if (typeof v === 'string') {
      out[key] = redactString(v);
    } else {
      out[key] = redactSecretsDeep(v, depth + 1, maxDepth);
    }
  }
  return out;
}

async function generateTextFromPromptConfig({ pool, orgId, promptConfigId, input, instructions, debug = false }) {
  const cfg = await loadPromptConfigById(pool, promptConfigId, orgId);
  if (!cfg) throw new Error('prompt_config_not_found');
  const promptId = String(cfg.prompt_id || '').trim() || undefined;
  const model = String(cfg.model || '').trim() || undefined;
  const devMessage = String(cfg.dev_message || '').trim();
  const seedMessages = Array.isArray(cfg.messages) ? cfg.messages : [];
  const hasAny = !!promptId || !!devMessage || (Array.isArray(seedMessages) && seedMessages.length);
  if (!hasAny) throw new Error('prompt_config_empty');
  const toolCfg = normalizePromptConfigTools(cfg.tools);
  const linkedMcpTools = await buildMcpExtraToolsFromPromptConfig(pool, cfg.id || promptConfigId);
  const mergedExtraTools = [
    ...(Array.isArray(toolCfg.extraTools) ? toolCfg.extraTools : []),
    ...(Array.isArray(linkedMcpTools) ? linkedMcpTools : []),
  ].filter((t) => t && typeof t === 'object');
  const t0 = Date.now();
  const out = await respondWithPrompt({
    apiKey: cfg.openai_api_key || undefined,
    model,
    promptId,
    promptVersion: cfg.prompt_version ? String(cfg.prompt_version) : undefined,
    input: String(input || ''),
    seedMessages,
    instructions: [devMessage, instructions ? String(instructions) : ''].filter(Boolean).join('\n\n') || undefined,
    toolsFileSearch: !!toolCfg.toolsFileSearch,
    toolsCodeInterpreter: !!toolCfg.toolsCodeInterpreter,
    vectorStoreId: cfg.vector_store_id || undefined,
    vectorStoreIds: Array.isArray(cfg.vector_store_ids) ? cfg.vector_store_ids : undefined,
    webSearchEnabled: !!toolCfg.webSearchEnabled,
    webSearchAllowedDomains: toolCfg.webSearchAllowedDomains,
    webSearchContextSize: toolCfg.webSearchContextSize,
    extraTools: mergedExtraTools.length ? mergedExtraTools : undefined,
    metadata: (cfg.metadata && typeof cfg.metadata === 'object' && !Array.isArray(cfg.metadata)) ? cfg.metadata : undefined,
  });
  const ms = Date.now() - t0;
  const text = String(out?.text || '').trim();
  try {
    await recordPromptConfigHistory(pool, {
      promptConfigId: cfg.id || promptConfigId,
      input: String(input || ''),
      output: text,
      requestBody: redactMcpToolsInRequestBody(out?.request_body || {}),
      response: out?.raw || null,
      ms,
    });
  } catch {}
  if (!debug) return text;
  return {
    text,
    debug: {
      prompt_config: {
        id: cfg.id || null,
        name: cfg.name || null,
        model: cfg.model || null,
        prompt_id: cfg.prompt_id || null,
        prompt_version: cfg.prompt_version ? String(cfg.prompt_version) : null,
      },
      request_body: redactSecretsDeep(out?.request_body || null),
      request_summary: redactSecretsDeep(out?.request || null),
      conversation: redactSecretsDeep(out?.conversation || null),
      response: redactSecretsDeep(sanitizeOpenAiResponseForDebug(out)),
    },
  };
}

async function generateJsonFromPromptConfig({ pool, orgId, promptConfigId, input, instructions, debug = false }) {
  const cfg = await loadPromptConfigById(pool, promptConfigId, orgId);
  if (!cfg) throw new Error('prompt_config_not_found');
  const promptId = String(cfg.prompt_id || '').trim() || undefined;
  const model = String(cfg.model || '').trim() || undefined;
  const devMessage = String(cfg.dev_message || '').trim();
  const seedMessages = Array.isArray(cfg.messages) ? cfg.messages : [];
  const hasAny = !!promptId || !!devMessage || (Array.isArray(seedMessages) && seedMessages.length);
  if (!hasAny) throw new Error('prompt_config_empty');
  const toolCfg = normalizePromptConfigTools(cfg.tools);
  const linkedMcpTools = await buildMcpExtraToolsFromPromptConfig(pool, cfg.id || promptConfigId);
  const mergedExtraTools = [
    ...(Array.isArray(toolCfg.extraTools) ? toolCfg.extraTools : []),
    ...(Array.isArray(linkedMcpTools) ? linkedMcpTools : []),
  ].filter((t) => t && typeof t === 'object');
  const t0 = Date.now();
  const out = await respondWithPrompt({
    apiKey: cfg.openai_api_key || undefined,
    model,
    promptId,
    promptVersion: cfg.prompt_version ? String(cfg.prompt_version) : undefined,
    input: String(input || ''),
    responseFormat: 'json_object',
    seedMessages,
    instructions: [devMessage, instructions ? String(instructions) : ''].filter(Boolean).join('\n\n') || undefined,
    toolsFileSearch: !!toolCfg.toolsFileSearch,
    toolsCodeInterpreter: !!toolCfg.toolsCodeInterpreter,
    vectorStoreId: cfg.vector_store_id || undefined,
    vectorStoreIds: Array.isArray(cfg.vector_store_ids) ? cfg.vector_store_ids : undefined,
    webSearchEnabled: !!toolCfg.webSearchEnabled,
    webSearchAllowedDomains: toolCfg.webSearchAllowedDomains,
    webSearchContextSize: toolCfg.webSearchContextSize,
    extraTools: mergedExtraTools.length ? mergedExtraTools : undefined,
    metadata: (cfg.metadata && typeof cfg.metadata === 'object' && !Array.isArray(cfg.metadata)) ? cfg.metadata : undefined,
  });
  const ms = Date.now() - t0;
  const outText = String(out?.text || '').trim();
  try {
    await recordPromptConfigHistory(pool, {
      promptConfigId: cfg.id || promptConfigId,
      input: String(input || ''),
      output: outText,
      requestBody: redactMcpToolsInRequestBody(out?.request_body || {}),
      response: out?.raw || null,
      ms,
    });
  } catch {}
  let parsed = null;
  try { parsed = JSON.parse(outText); } catch { parsed = null; }
  const debugPayload = debug ? {
    prompt_config: {
      id: cfg.id || null,
      name: cfg.name || null,
      model: cfg.model || null,
      prompt_id: cfg.prompt_id || null,
      prompt_version: cfg.prompt_version ? String(cfg.prompt_version) : null,
    },
    request_body: redactSecretsDeep(out?.request_body || null),
    request_summary: redactSecretsDeep(out?.request || null),
    conversation: redactSecretsDeep(out?.conversation || null),
    response: redactSecretsDeep(sanitizeOpenAiResponseForDebug(out)),
  } : null;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (debug) return { parsed: null, debug: debugPayload, error: 'prompt_invalid_output' };
    throw new Error('prompt_invalid_output');
  }
  if (!debug) return parsed;
  return { parsed, debug: debugPayload };
}

function mapVirementRow(row = {}) {
  const get = (...keys) => {
    for (const key of keys) {
      if (!key) continue;
      const v = row[key];
      if (v !== undefined && v !== null) return v;
    }
    return null;
  };
  const idOrder = Number(get('id_order'));
  const shopDomain = String(get('shop_domain_ssl', 'domain', 'value', 'value0', 'name1', 'PS_SHOP_DOMAIN_SSL') || '').trim();
  const shopEmail = String(get('shop_email', 'value1', 'PS_SHOP_EMAIL') || '').trim();
  const langName = String(get('langue', 'language', 'name2', 'lang_name') || '').trim();
  const langIso = String(get('lang_iso_code', 'iso_code', 'language_iso') || '').trim().toLowerCase();
  const currencyIso = String(get('currency_iso', 'iso_currency', 'iso_code_currency', 'currency_iso_code') || '').trim().toUpperCase();
  const totalPaid = get('total_paid_tax_incl', 'total_paid', 'total', 'amount') ?? null;
  const firstname = String(get('firstname') || '').trim();
  const lastname = String(get('lastname') || '').trim();
  const customerEmail = String(get('email') || '').trim();
  return {
    id_order: Number.isFinite(idOrder) ? idOrder : null,
    reference: String(get('reference') || '').trim(),
    id_lang: get('id_lang') != null ? Number(get('id_lang')) : null,
    id_shop: get('id_shop') != null ? Number(get('id_shop')) : null,
    payment: String(get('payment') || '').trim(),
    current_state: get('current_state') != null ? Number(get('current_state')) : null,
    order_state: String(get('name') || '').trim(),
    firstname,
    lastname,
    customer_name: [firstname, lastname].filter(Boolean).join(' ').trim(),
    customer_email: customerEmail,
    shop_domain_ssl: shopDomain,
    shop_domain_no_www: normalizeShopDomainNoWww(shopDomain),
    shop_email: shopEmail,
    shop_phone: String(get('shop_phone', 'phone_shop') || '').trim(),
    shop_logo_invoice: String(get('shop_logo_invoice', 'logo_invoice', 'PS_LOGO_INVOICE') || '').trim(),
    langue: langName,
    lang_iso_code: langIso || null,
    currency_iso: currencyIso || null,
    total_paid_tax_incl: totalPaid != null && totalPaid !== '' ? Number(totalPaid) : null,
  };
}

function mapNumeroMaisonRow(row = {}) {
  const get = (...keys) => {
    for (const key of keys) {
      if (!key) continue;
      const v = row[key];
      if (v !== undefined && v !== null) return v;
    }
    return null;
  };
  const idOrder = Number(get('id_order'));
  const shopDomain = String(get('shop_domain_ssl', 'domain', 'value', 'value0') || '').trim();
  const shopEmail = String(get('shop_email', 'value1', 'PS_SHOP_EMAIL') || '').trim();
  const langName = String(get('langue', 'language', 'name2', 'lang_name') || '').trim();
  const langIso = String(get('lang_iso_code', 'iso_code', 'language_iso') || '').trim().toLowerCase();
  const firstname = String(get('firstname') || '').trim();
  const lastname = String(get('lastname') || '').trim();
  const shopPhone = String(get('shop_phone', 'phone_shop') || '').trim();
  const shopLogoInvoice = String(get('shop_logo_invoice', 'logo_invoice', 'PS_LOGO_INVOICE') || '').trim();
  const phone = String(get('phone') || '').trim();
  const mobile = String(get('mobile', 'phone_mobile') || '').trim();
  const callPrefix = String(get('call_prefix') || '').trim();
  return {
    id_order: Number.isFinite(idOrder) ? idOrder : null,
    reference: String(get('reference') || '').trim(),
    id_lang: get('id_lang') != null ? Number(get('id_lang')) : null,
    id_shop: get('id_shop') != null ? Number(get('id_shop')) : null,
    payment: String(get('payment') || '').trim(),
    current_state: get('current_state') != null ? Number(get('current_state')) : null,
    firstname,
    lastname,
    customer_name: [firstname, lastname].filter(Boolean).join(' ').trim(),
    customer_email: String(get('email') || '').trim(),
    shop_domain_ssl: shopDomain,
    shop_domain_no_www: normalizeShopDomainNoWww(shopDomain),
    shop_email: shopEmail,
    shop_phone: shopPhone,
    shop_logo_invoice: shopLogoInvoice,
    langue: langName,
    lang_iso_code: langIso || null,
    country: String(get('country', 'country_name', 'name') || '').trim(),
    call_prefix: callPrefix || null,
    phone,
    phone_e164: normalizePhone(phone, callPrefix),
    mobile,
    mobile_e164: normalizePhone(mobile, callPrefix),
  };
}

function mapTrackingRow(row = {}) {
  const base = mapNumeroMaisonRow(row);
  const get = (...keys) => {
    for (const key of keys) {
      if (!key) continue;
      const v = row[key];
      if (v !== undefined && v !== null) return v;
    }
    return null;
  };
  const trackingUrl = String(get('tracking_url', 'tracking_link', 'trackingUrl', 'url') || '').trim();
  const trackingNumber = String(get('tracking_number', 'tracking', 'tracking_no', 'trackingNo') || '').trim();
  const carrierName = String(get('carrier_name', 'carrier', 'carrierName') || '').trim();
  return {
    ...base,
    tracking_url: trackingUrl || null,
    tracking_number: trackingNumber || null,
    carrier: carrierName || null,
  };
}

export function registerToolsRelanceRoutes(app, ctx = {}) {
  const pool = ctx.pool;
  const requireAdmin = requireAdminGuard(ctx);
  const requireAuth = requireAuthGuard(ctx);
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const defaultChatLogPath = path.resolve(__dirname, '../../../../backend/chat.log');
  const chatLog = typeof ctx.chatLog === 'function'
    ? ctx.chatLog
    : ((event, payload) => {
        try {
          const line = JSON.stringify({ event, payload, ts: new Date().toISOString() });
          fs.appendFile(defaultChatLogPath, line + '\n', () => {});
        } catch {}
      });
  const logTrackingEvent = (event, payload = {}) => {
    if (!chatLog) return;
    try {
      chatLog(event, { module: 'tools-relance', ...payload });
    } catch {}
  };

  app.get('/api/tools/relance/__ping', (_req, res) => res.json({ ok: true, module: 'tools', feature: 'relance' }));

  app.get('/api/tools/relance/settings', async (req, res) => {
    if (!requireAuth(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const orgId = toOrgInt(pickOrgId(req));
    try {
      const virement = await loadToolsConfigValue(pool, KEY_RELANCE_VIREMENT_PROMPT, orgId);
      const virementEmail = await loadToolsConfigValue(pool, KEY_RELANCE_VIREMENT_EMAIL_PROMPT, orgId);
      const virementBank = await loadToolsConfigValue(pool, KEY_RELANCE_VIREMENT_BANK_DETAILS, orgId);
      const maison = await loadToolsConfigValue(pool, KEY_RELANCE_MAISON_PROMPT, orgId);
      const telephone = await loadToolsConfigValue(pool, KEY_RELANCE_TELEPHONE_PROMPT, orgId);
      const trackingPrompt = await loadToolsConfigValue(pool, KEY_RELANCE_TRACKING_PROMPT, orgId);
      const gw = await loadToolsConfigValue(pool, KEY_RELANCE_GATEWAY_DEFAULT_LINE, orgId);
      const sigCacheRow = await loadToolsConfigValue(pool, KEY_RELANCE_SIGNATURE_CACHE, orgId);
      const sigCache = (sigCacheRow && typeof sigCacheRow.value === 'object' && !Array.isArray(sigCacheRow.value)) ? sigCacheRow.value : null;
      const sigCounts = countSignatureCacheEntries(sigCache);
      return res.json({
        ok: true,
        org_id: orgId ?? null,
        settings: {
          virement_prompt_config_id: virement?.value?.prompt_config_id ?? null,
          virement_email_prompt_config_id: virementEmail?.value?.prompt_config_id ?? null,
          virement_bank_details: (virementBank && typeof virementBank.value === 'object') ? virementBank.value : null,
          numero_maison_prompt_config_id: maison?.value?.prompt_config_id ?? null,
          numero_telephone_prompt_config_id: telephone?.value?.prompt_config_id ?? null,
          tracking_mcp2_server_ids: [],
          tracking_prompt_config_id: trackingPrompt?.value?.prompt_config_id ?? null,
          gateway_default_subscription_id: gw?.value?.subscription_id ?? null,
          signature_cache_updated_at: sigCache?.updated_at || null,
          signature_cache_shop_count: sigCounts.shopCount,
          signature_cache_entry_count: sigCounts.entryCount,
        },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'settings_load_failed', message: String(e?.message || e) });
    }
  });

  app.post('/api/tools/relance/settings', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const orgId = toOrgInt(pickOrgId(req));
    const b = req.body || {};
    try {
      const virementId = b.virement_prompt_config_id == null ? null : String(b.virement_prompt_config_id).trim() || null;
      const virementEmailId = b.virement_email_prompt_config_id == null ? null : String(b.virement_email_prompt_config_id).trim() || null;
      const bankRaw = b.virement_bank_details && typeof b.virement_bank_details === 'object' && !Array.isArray(b.virement_bank_details) ? b.virement_bank_details : {};
      const rawBanks = Array.isArray(bankRaw.banks) ? bankRaw.banks : null;
      const legacyAccounts = Array.isArray(bankRaw.accounts) ? bankRaw.accounts : [];
      const normalizeAccounts = (arr) =>
        (Array.isArray(arr) ? arr : [])
          .map((a) => ({
            currency: normalizeCurrencyCode(a?.currency),
            iban: normalizeIban(a?.iban),
            bic: normalizeBic(a?.bic),
          }))
          .filter((a) => a.currency && a.iban)
          .slice(0, 50);
      const normalizeAddress = (addr) => {
        const a = addr && typeof addr === 'object' && !Array.isArray(addr) ? addr : {};
        return {
          line1: String(a.line1 || '').trim() || null,
          line2: String(a.line2 || '').trim() || null,
          postal_code: String(a.postal_code || '').trim() || null,
          city: String(a.city || '').trim() || null,
          country: String(a.country || '').trim() || null,
        };
      };
      const banks = rawBanks
        ? rawBanks
            .map((bk) => ({
              label: String(bk?.label || '').trim() || null,
              account_holder: String(bk?.account_holder || '').trim() || null,
              bank_name: String(bk?.bank_name || '').trim() || null,
              address: normalizeAddress(bk?.address),
              accounts: normalizeAccounts(bk?.accounts),
            }))
            .slice(0, 20)
        : [
            {
              label: null,
              account_holder: String(bankRaw.account_holder || '').trim() || null,
              bank_name: String(bankRaw.bank_name || '').trim() || null,
              address: normalizeAddress({ line1: String(bankRaw.bank_address || '').trim() || null }),
              accounts: normalizeAccounts(legacyAccounts),
            },
          ];
      const bankDetails = { banks };
      const maisonId = b.numero_maison_prompt_config_id == null ? null : String(b.numero_maison_prompt_config_id).trim() || null;
      const telId = b.numero_telephone_prompt_config_id == null ? null : String(b.numero_telephone_prompt_config_id).trim() || null;
      const trackingPromptId = b.tracking_prompt_config_id == null ? null : String(b.tracking_prompt_config_id).trim() || null;
      const subRaw = b.gateway_default_subscription_id;
      const subId = subRaw === null || subRaw === undefined || String(subRaw).trim() === '' ? null : Number(subRaw);

      await upsertToolsConfigValue(pool, KEY_RELANCE_VIREMENT_PROMPT, { prompt_config_id: virementId }, orgId);
      await upsertToolsConfigValue(pool, KEY_RELANCE_VIREMENT_EMAIL_PROMPT, { prompt_config_id: virementEmailId }, orgId);
      await upsertToolsConfigValue(pool, KEY_RELANCE_VIREMENT_BANK_DETAILS, bankDetails, orgId);
      await upsertToolsConfigValue(pool, KEY_RELANCE_MAISON_PROMPT, { prompt_config_id: maisonId }, orgId);
      await upsertToolsConfigValue(pool, KEY_RELANCE_TELEPHONE_PROMPT, { prompt_config_id: telId }, orgId);
      await upsertToolsConfigValue(pool, KEY_RELANCE_TRACKING_PROMPT, { prompt_config_id: trackingPromptId }, orgId);
      await upsertToolsConfigValue(pool, KEY_RELANCE_GATEWAY_DEFAULT_LINE, { subscription_id: Number.isFinite(subId) ? Math.trunc(subId) : null }, orgId);

      return res.json({
        ok: true,
        org_id: orgId ?? null,
        settings: {
          virement_prompt_config_id: virementId,
          virement_email_prompt_config_id: virementEmailId,
          virement_bank_details: bankDetails,
          numero_maison_prompt_config_id: maisonId,
          numero_telephone_prompt_config_id: telId,
          tracking_mcp2_server_ids: [],
          tracking_prompt_config_id: trackingPromptId,
          gateway_default_subscription_id: Number.isFinite(subId) ? Math.trunc(subId) : null,
        },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'settings_save_failed', message: String(e?.message || e) });
    }
  });

  // Refresh cached signatures (per org_id, per shop_id/lang_id) to speed up EmailRelance generation.
  // This is intentionally manual ("Update signature") so we avoid accidental cross-shop mixing.
  app.post('/api/tools/relance/signature/update', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const orgRaw = pickOrgId(req);
    const orgId = toOrgInt(orgRaw);
    const prefix = String(req.body?.prefix || req.query?.prefix || 'ps_');
    const profileId = String(req.body?.profile_id || req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgRaw)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });
    const t0 = Date.now();
    let conn;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgRaw, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);

      // Load shop ids
      let shopIds = [];
      try {
        const rows = await q(`SELECT id_shop FROM \`${prefix}shop\` ORDER BY id_shop ASC`, []);
        shopIds = (rows || []).map((r) => Number(r?.id_shop)).filter((n) => Number.isFinite(n) && n > 0);
      } catch {
        try {
          const rows = await q(`SELECT DISTINCT id_shop FROM \`${prefix}orders\` ORDER BY id_shop ASC LIMIT 50`, []);
          shopIds = (rows || []).map((r) => Number(r?.id_shop)).filter((n) => Number.isFinite(n) && n > 0);
        } catch {
          shopIds = [];
        }
      }
      shopIds = Array.from(new Set(shopIds)).slice(0, 200);
      if (!shopIds.length) return res.status(400).json({ ok: false, error: 'no_shops' });

      // Load shop-scoped config values
      const ph = shopIds.map(() => '?').join(',');
      const confRows = await q(
        `SELECT id_shop, name, value
           FROM \`${prefix}configuration\`
          WHERE id_shop IN (${ph})
            AND name IN ('PS_SHOP_DOMAIN_SSL','PS_SHOP_EMAIL','PS_SHOP_PHONE','PS_LOGO_INVOICE')`,
        shopIds
      );
      const byShop = new Map();
      for (const id of shopIds) byShop.set(id, { id_shop: id, shop_domain_ssl: '', shop_email: '', shop_phone: '', shop_logo_invoice: '' });
      for (const r of confRows || []) {
        const id = Number(r?.id_shop);
        if (!Number.isFinite(id) || id <= 0) continue;
        const s = byShop.get(id);
        if (!s) continue;
        const name = String(r?.name || '').trim();
        const value = String(r?.value || '').trim();
        if (!value) continue;
        if (name === 'PS_SHOP_DOMAIN_SSL') s.shop_domain_ssl = value;
        else if (name === 'PS_SHOP_EMAIL') s.shop_email = value;
        else if (name === 'PS_SHOP_PHONE') s.shop_phone = value;
        else if (name === 'PS_LOGO_INVOICE') s.shop_logo_invoice = value;
      }

      // Load latest (shop_id, lang_id) translation rows for contact name.
      let transRows = [];
      try {
        const resTrans = await pool.query(
          `
            SELECT DISTINCT ON (shop_id, lang_id)
              shop_id, lang_id, vendor, org_id, updated_at
            FROM mod_tools_devis_translations
            WHERE shop_id = ANY($1)
              AND ($2::int IS NULL OR org_id IS NULL OR org_id = $2)
            ORDER BY shop_id, lang_id, (org_id = $2) DESC, updated_at DESC
          `,
          [shopIds, orgId]
        );
        transRows = resTrans?.rows || [];
      } catch {
        transRows = [];
      }

      const cacheValue = {
        version: 1,
        updated_at: new Date().toISOString(),
        shops: {},
      };

      // Base per-shop signature (lang_id = 0)
      for (const [id, s] of byShop.entries()) {
        const domainNoWww = normalizeShopDomainNoWww(String(s.shop_domain_ssl || '').trim());
        let logoDataUrl = null;
        if (domainNoWww && String(s.shop_logo_invoice || '').trim()) {
          const url = normalizeLogoUrl(String(s.shop_logo_invoice || '').trim(), domainNoWww);
          logoDataUrl = await fetchLogoDataUrl(url, 8000);
        }
        const base = buildRelanceSignatureEntry({
          contact: '',
          domainNoWww,
          email: s.shop_email,
          phone: s.shop_phone,
          logoInvoice: s.shop_logo_invoice,
          logoUrlOverride: logoDataUrl || '',
        });
        cacheValue.shops[String(id)] = {
          id_shop: id,
          domain: domainNoWww || null,
          shop_email: s.shop_email || null,
          shop_phone: s.shop_phone || null,
          shop_logo_invoice: s.shop_logo_invoice || null,
          shop_logo_data_url: logoDataUrl || null,
          by_lang: { '0': base },
        };
      }

      // Per-language contact override
      for (const tr of transRows) {
        const shopId = Number(tr?.shop_id);
        const langId = Number(tr?.lang_id);
        if (!Number.isFinite(shopId) || shopId <= 0) continue;
        if (!Number.isFinite(langId) || langId <= 0) continue;
        const shop = cacheValue.shops[String(shopId)];
        if (!shop) continue;
        const vendor = tr?.vendor && typeof tr.vendor === 'object' && !Array.isArray(tr.vendor) ? tr.vendor : {};
        const contact = String(vendor?.vendor_contact_name || vendor?.contact_vendor || vendor?.votre_contact_text || '').trim();
        if (!contact) continue;
        const entry = buildRelanceSignatureEntry({
          contact,
          domainNoWww: String(shop.domain || '').trim(),
          email: String(shop.shop_email || '').trim(),
          phone: String(shop.shop_phone || '').trim(),
          logoInvoice: String(shop.shop_logo_invoice || '').trim(),
          logoUrlOverride: String(shop.shop_logo_data_url || '').trim(),
        });
        shop.by_lang[String(langId)] = entry;
      }

      await upsertToolsConfigValue(pool, KEY_RELANCE_SIGNATURE_CACHE, cacheValue, orgId);
      // Bust memory cache for this org immediately.
      try { relanceSignatureCacheMem.delete(String(orgId)); } catch {}

      const counts = countSignatureCacheEntries(cacheValue);
      logTrackingEvent('tools_relance_signature_cache_updated', {
        org_id: orgId ?? null,
        shop_count: counts.shopCount,
        entry_count: counts.entryCount,
        ms: Date.now() - t0,
      });
      return res.json({ ok: true, org_id: orgId ?? null, cache: { updated_at: cacheValue.updated_at, ...counts } });
    } catch (e) {
      const msg = String(e?.message || e);
      logTrackingEvent('tools_relance_signature_cache_error', { org_id: orgId ?? null, message: msg.slice(0, 240), ms: Date.now() - t0 });
      return res.status(500).json({ ok: false, error: 'signature_update_failed', message: msg });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  app.get('/api/tools/relance/virement-bancaire', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const orgId = pickOrgId(req);
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 100)));
    const prefix = String(req.query?.prefix || 'ps_');
    const profileId = String(req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });
    let conn;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);
      let rows = [];
      try {
        rows = await q('SELECT * FROM `relance_virement_bancaire` ORDER BY id_order DESC LIMIT ?', [limit]);
      } catch {
        // Fallback query when the view does not exist; uses Presta defaults (ps_ prefix)
        rows = await q(
          `
            SELECT
              o.id_order AS id_order,
              o.reference AS reference,
              o.id_lang AS id_lang,
              o.id_shop AS id_shop,
              o.payment AS payment,
              o.current_state AS current_state,
              osl.id_lang AS id_lang1,
              osl.name AS name,
              osl.id_order_state AS id_order_state,
              c.firstname AS firstname,
              c.lastname AS lastname,
              c.email AS email,
              conf.name AS name1,
              conf.value AS value,
              l.name AS name2,
              l.iso_code AS iso_code,
              conf2.name AS name3,
              conf2.value AS value1
            FROM \`${prefix}orders\` o
            JOIN \`${prefix}order_state_lang\` osl ON osl.id_order_state = o.current_state
            JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
            JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
            JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
            JOIN \`${prefix}configuration\` conf2 ON conf2.id_shop = o.id_shop AND conf2.name = 'PS_SHOP_EMAIL'
            WHERE o.current_state = 10
              AND osl.id_lang = 1
            ORDER BY o.id_order DESC
            LIMIT ?
          `,
          [limit]
        );
      }
      const items = (rows || []).map(mapVirementRow).filter((x) => x && x.id_order != null);
      // Ensure sender email is present (PS_SHOP_EMAIL by id_shop)
      try {
        await hydrateShopEmailsByIdShop(q, prefix, items);
      } catch {}
      // Ensure amount + currency are present (ps_orders + ps_currency)
      try {
        await hydrateOrderAmountsAndCurrency(q, prefix, items);
      } catch {}
      return res.json({ ok: true, items, count: items.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'mysql_query_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  app.get('/api/tools/relance/numero-de-maison', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const orgId = pickOrgId(req);
    const limit = Math.max(1, Math.min(100, Number(req.query?.limit || 100)));
    const prefix = String(req.query?.prefix || 'ps_');
    const profileId = String(req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });
    let conn;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);
      let rows = [];
      try {
        rows = await q('SELECT * FROM `relance_numero_de_maison` ORDER BY id_order DESC LIMIT ?', [limit]);
      } catch {
        // Fallback query when the view does not exist; uses Presta defaults (ps_ prefix)
        rows = await q(
          `
	            SELECT
	              o.id_order AS id_order,
	              o.reference AS reference,
	              o.id_lang AS id_lang,
	              o.id_shop AS id_shop,
	              o.payment AS payment,
	              o.current_state AS current_state,
	              c.firstname AS firstname,
	              c.lastname AS lastname,
	              c.email AS email,
	              conf.value AS shop_domain_ssl,
	              l.name AS name2,
	              l.iso_code AS iso_code,
	              a.phone AS phone,
	              a.phone_mobile AS mobile,
	              cl.name AS country_name,
	              co.call_prefix AS call_prefix
	            FROM \`${prefix}orders\` o
            JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
            JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
            JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
            JOIN \`${prefix}address\` a ON a.id_address = o.id_address_delivery
            JOIN \`${prefix}country\` co ON co.id_country = a.id_country
            JOIN \`${prefix}country_lang\` cl ON cl.id_country = a.id_country AND cl.id_lang = 1
            ORDER BY o.id_order DESC
            LIMIT ?
          `,
          [limit]
        );
      }
      const items = (rows || []).map(mapNumeroMaisonRow).filter((x) => x && x.id_order != null);
      // Ensure call_prefix is present even if the MySQL view doesn't include it
      try {
        await hydrateCallPrefixesByOrderId(q, prefix, items);
      } catch {}
      // Ensure sender email is present (PS_SHOP_EMAIL by id_shop)
      try {
        await hydrateShopEmailsByIdShop(q, prefix, items);
      } catch {}
      return res.json({ ok: true, items, count: items.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'mysql_query_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  app.get('/api/tools/relance/tracking', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const orgId = pickOrgId(req);
    const limit = Math.max(1, Math.min(250, Number(req.query?.limit || 100)));
    const prefix = String(req.query?.prefix || 'ps_');
    const profileId = String(req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });
    let conn;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);
      let rows = [];
      try {
        rows = await q('SELECT * FROM `relance_tracking_link` ORDER BY id_order DESC LIMIT ?', [limit]);
      } catch {
        rows = await q(
          `
            SELECT
              o.id_order AS id_order,
              o.reference AS reference,
              o.id_lang AS id_lang,
              o.id_shop AS id_shop,
              o.payment AS payment,
              o.current_state AS current_state,
              c.firstname AS firstname,
              c.lastname AS lastname,
              c.email AS email,
              conf.value AS shop_domain_ssl,
              conf2.value AS shop_email,
              l.name AS name2,
              l.iso_code AS iso_code,
              a.phone AS phone,
              a.phone_mobile AS mobile,
              cl.name AS country_name,
              co.call_prefix AS call_prefix,
              MAX(oc.tracking_number) AS tracking_number,
              MAX(car.name) AS carrier_name
            FROM \`${prefix}orders\` o
            JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
            JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
            LEFT JOIN \`${prefix}configuration\` conf2 ON conf2.id_shop = o.id_shop AND conf2.name = 'PS_SHOP_EMAIL'
            JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
            JOIN \`${prefix}address\` a ON a.id_address = o.id_address_delivery
            JOIN \`${prefix}country\` co ON co.id_country = a.id_country
            JOIN \`${prefix}country_lang\` cl ON cl.id_country = a.id_country AND cl.id_lang = 1
            LEFT JOIN \`${prefix}order_carrier\` oc ON oc.id_order = o.id_order
            LEFT JOIN \`${prefix}carrier\` car ON car.id_carrier = oc.id_carrier
            GROUP BY o.id_order
            ORDER BY o.id_order DESC
            LIMIT ?
          `,
          [limit]
        );
      }
      const items = (rows || []).map(mapTrackingRow).filter((x) => x && x.id_order != null);
      try {
        await hydrateCallPrefixesByOrderId(q, prefix, items);
      } catch {}
      // Ensure sender email is present (PS_SHOP_EMAIL by id_shop)
      try {
        await hydrateShopEmailsByIdShop(q, prefix, items);
      } catch {}
      return res.json({ ok: true, items, count: items.length });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'mysql_query_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  app.post('/api/tools/relance/tracking/:idOrder/sms-draft', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const idOrder = Number(req.params?.idOrder || 0);
    if (!idOrder) return res.status(400).json({ ok: false, error: 'bad_request', message: 'idOrder is required' });
    const orgId = pickOrgId(req);
    const orgInt = toOrgInt(orgId);
    const profileId = String(req.body?.profile_id || req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });
    const prefix = String(req.query?.prefix || 'ps_');
    const wantDebug = String(req.query?.debug || '').trim() === '1';

    let promptConfigId = String(req.body?.prompt_config_id || '').trim() || null;
    if (!promptConfigId) {
      try {
        const row = await loadToolsConfigValue(pool, KEY_RELANCE_TRACKING_PROMPT, orgInt);
        promptConfigId = row?.value?.prompt_config_id ? String(row.value.prompt_config_id).trim() : null;
      } catch {}
    }
    if (!promptConfigId) return res.status(400).json({ ok: false, error: 'prompt_id_missing', message: 'Configure a Prompt Config for Tracking in Tools > Paramètres.' });

    let conn;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);

      let row = null;
      try {
        const rows = await q('SELECT * FROM `relance_tracking_link` WHERE id_order = ? LIMIT 1', [idOrder]);
        row = rows?.[0] || null;
      } catch {
        const rows = await q(
          `
            SELECT
              o.id_order AS id_order,
              o.reference AS reference,
              o.id_lang AS id_lang,
              o.id_shop AS id_shop,
              o.payment AS payment,
              o.current_state AS current_state,
              c.firstname AS firstname,
              c.lastname AS lastname,
              c.email AS email,
              conf.value AS shop_domain_ssl,
              l.name AS name2,
              l.iso_code AS iso_code,
              a.phone AS phone,
              a.phone_mobile AS mobile,
              cl.name AS country_name,
              co.call_prefix AS call_prefix,
              oc.tracking_number AS tracking_number,
              car.name AS carrier_name
            FROM \`${prefix}orders\` o
            JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
            JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
            JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
            JOIN \`${prefix}address\` a ON a.id_address = o.id_address_delivery
            JOIN \`${prefix}country\` co ON co.id_country = a.id_country
            JOIN \`${prefix}country_lang\` cl ON cl.id_country = a.id_country AND cl.id_lang = 1
            LEFT JOIN \`${prefix}order_carrier\` oc ON oc.id_order = o.id_order
            LEFT JOIN \`${prefix}carrier\` car ON car.id_carrier = oc.id_carrier
            WHERE o.id_order = ?
            LIMIT 1
          `,
          [idOrder]
        );
        row = rows?.[0] || null;
      }
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      const item = mapTrackingRow(row);

      try {
        await hydrateCallPrefixesByOrderId(q, prefix, [item]);
      } catch {}

      const domain = item.shop_domain_no_www || 'shop';
      // Prompt-only mode: do not look up the tracking link via MCP2.
      // If Presta provides a tracking_url, we include it; otherwise we ask the prompt to draft a message without inventing a URL.
      logTrackingEvent('tracking_prompt_only', {
        prompt_config_id: promptConfigId,
        order_id: item.id_order,
        has_existing_url: !!item.tracking_url,
      });
      const resolved = {
        ok: true,
        tracking_url: item.tracking_url || null,
        server_id: null,
        server_name: null,
        tool_name: null,
        mode: 'prompt_only',
      };

      const langName = String(item.langue || '').trim();
      const langIsoRaw = String(item.lang_iso_code || '').trim().toLowerCase();
      const langIso = (langIsoRaw === 'gb' ? 'en' : langIsoRaw) || '';
      const langLabel = (langIso === 'en' ? 'English' : (langIso ? langIso.toUpperCase() : (langName || 'customer language')));

      let text = '';
      let openaiDebug = null;
      try {
        const payload = {
          // For Automation Suite prompts/tools that expect a direct id_order input.
          id_order: item.id_order ?? null,
          id_shop: item.id_shop ?? null,
          shop_domain: item.shop_domain_no_www || null,
          client: { name: item.customer_name || null, email: item.customer_email || null },
          lang: { name: item.langue || null, iso_code: langIso || item.lang_iso_code || null, id_lang: item.id_lang ?? null },
          shop: { id_shop: item.id_shop ?? null, domain: item.shop_domain_no_www || null },
          order: { id_order: item.id_order ?? null, reference: item.reference || null },
          tracking: {
            url: resolved.tracking_url,
            number: item.tracking_number || null,
            carrier: item.carrier || null,
            source: { server_id: resolved.server_id || null, server_name: resolved.server_name || null, tool: resolved.tool_name || null },
          },
          requested: { type: 'tracking_sms' },
        };
        const gen = await generateTextFromPromptConfig({
          pool,
          orgId: orgInt,
          promptConfigId,
          input: JSON.stringify(payload),
          instructions:
            'Return only a single SMS text. No markdown. Keep it concise (<= 320 chars). ' +
            `Start with "[${domain}]" and include the order reference. ` +
            `IMPORTANT: Write the SMS in ${langLabel}. Do not include bilingual terms. ` +
            'If tracking.url is present, include it. If tracking.url is missing/null, you MUST resolve a real tracking URL by calling the MCP2 tools (as described in the Prompt Config developer message) and then include it exactly once.',
          debug: wantDebug,
        });
        if (wantDebug && gen && typeof gen === 'object') {
          text = String(gen.text || '').trim();
          openaiDebug = gen.debug || null;
        } else {
          text = String(gen || '').trim();
        }
      } catch (e) {
        if (wantDebug) openaiDebug = { error: String(e?.message || e) };
      }

      if (!text) {
        const ref = item.reference || item.id_order;
        if (resolved.tracking_url) {
          text = langIso === 'fr'
            ? `[${domain}] Commande ${ref} : voici votre lien de suivi : ${resolved.tracking_url}`
            : `[${domain}] Order ${ref}: your tracking link: ${resolved.tracking_url}`;
        } else if (item.tracking_number || item.carrier) {
          const tn = item.tracking_number ? `#${item.tracking_number}` : '';
          const car = item.carrier ? String(item.carrier) : '';
          const info = [tn, car].filter(Boolean).join(' ');
          text = langIso === 'fr'
            ? `[${domain}] Commande ${ref} : suivi ${info || ''}`.trim()
            : `[${domain}] Order ${ref}: tracking ${info || ''}`.trim();
        } else {
          text = langIso === 'fr'
            ? `[${domain}] Commande ${ref} : suivi en cours. Besoin d'aide ? Répondez à ce SMS.`
            : `[${domain}] Order ${ref}: tracking in progress. Need help? Reply to this SMS.`;
        }
      }

      return res.json({
        ok: true,
        sms_text: text,
        tracking: resolved,
        item: { ...item, tracking_url: resolved.tracking_url },
        ...(wantDebug ? { openai_debug: openaiDebug } : {}),
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'sms_draft_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

	  app.post('/api/tools/relance/tracking/:idOrder/email-generate', async (req, res) => {
	    if (!requireAdmin(req, res)) return;
	    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
	    const t0 = Date.now();
	    const idOrder = Number(req.params?.idOrder || 0);
	    if (!idOrder) return res.status(400).json({ ok: false, error: 'bad_request', message: 'idOrder is required' });
    const orgId = pickOrgId(req);
    const orgInt = toOrgInt(orgId);
    const profileId = String(req.body?.profile_id || req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });
    const prefix = String(req.query?.prefix || 'ps_');
    const wantDebug = String(req.query?.debug || '').trim() === '1';

    let promptConfigId = String(req.body?.prompt_config_id || '').trim() || null;
    if (!promptConfigId) {
      try {
        const row = await loadToolsConfigValue(pool, KEY_RELANCE_TRACKING_PROMPT, orgInt);
        promptConfigId = row?.value?.prompt_config_id ? String(row.value.prompt_config_id).trim() : null;
      } catch {}
    }
    if (!promptConfigId) return res.status(400).json({ ok: false, error: 'prompt_id_missing', message: 'Configure a Prompt Config for Tracking in Tools > Paramètres.' });

	    let conn;
	    try {
	      let msMysql = 0;
	      let msOpenai = 0;
	      let msSignature = 0;
	      try { await getMysql2FromCtx(ctx); } catch {}
	      const cfg = await loadProfileConfig(pool, orgId, profileId);
	      conn = await connectMySql(ctx, cfg);
	      const { q } = makeSqlHelpers(conn);

      let row = null;
      try {
        const rows = await q('SELECT * FROM `relance_tracking_link` WHERE id_order = ? LIMIT 1', [idOrder]);
        row = rows?.[0] || null;
      } catch {
        const rows = await q(
          `
            SELECT
              o.id_order AS id_order,
              o.reference AS reference,
              o.id_lang AS id_lang,
              o.id_shop AS id_shop,
              o.payment AS payment,
              o.current_state AS current_state,
              c.firstname AS firstname,
              c.lastname AS lastname,
              c.email AS email,
              conf.value AS shop_domain_ssl,
              conf2.value AS shop_email,
              l.name AS name2,
              l.iso_code AS iso_code,
              a.phone AS phone,
              a.phone_mobile AS mobile,
              cl.name AS country_name,
              co.call_prefix AS call_prefix,
              oc.tracking_number AS tracking_number,
              car.name AS carrier_name
            FROM \`${prefix}orders\` o
            JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
            JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
            LEFT JOIN \`${prefix}configuration\` conf2 ON conf2.id_shop = o.id_shop AND conf2.name = 'PS_SHOP_EMAIL'
            JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
            JOIN \`${prefix}address\` a ON a.id_address = o.id_address_delivery
            JOIN \`${prefix}country\` co ON co.id_country = a.id_country
            JOIN \`${prefix}country_lang\` cl ON cl.id_country = a.id_country AND cl.id_lang = 1
            LEFT JOIN \`${prefix}order_carrier\` oc ON oc.id_order = o.id_order
            LEFT JOIN \`${prefix}carrier\` car ON car.id_carrier = oc.id_carrier
            WHERE o.id_order = ?
            LIMIT 1
          `,
          [idOrder]
        );
        row = rows?.[0] || null;
      }
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      const item = mapTrackingRow(row);
      if (!String(item.customer_email || '').trim()) return res.status(400).json({ ok: false, error: 'missing_customer_email' });

      // Match virement-bancaire behavior: derive signature from id_shop (+ lang) and shop configs.
      // Some MySQL views omit id_shop/id_lang/shop_email -> hydrate from ps_orders.
      try { await hydrateOrderShopLangAndConfigs(q, prefix, item); } catch {}
	      if (Number(item.id_shop) > 0) {
	        // No fallback: enforce shop-scoped configs for this id_shop (PS_SHOP_EMAIL / PS_SHOP_PHONE).
	        try { item.shop_email = await getShopEmailWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_email = ''; }
	        try { item.shop_phone = await getShopPhoneWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_phone = ''; }
	        try { item.shop_logo_invoice = await getShopLogoInvoiceWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_logo_invoice = ''; }
	      }
	      msMysql = Date.now() - t0;

      const domain = item.shop_domain_no_www || 'shop';
      // Prompt-only mode: do not look up the tracking link via MCP2.
      logTrackingEvent('tracking_prompt_only', {
        prompt_config_id: promptConfigId,
        order_id: item.id_order,
        has_existing_url: !!item.tracking_url,
      });
      const resolved = {
        ok: true,
        tracking_url: item.tracking_url || null,
        server_id: null,
        server_name: null,
        tool_name: null,
        mode: 'prompt_only',
      };

      const langIso = String(item.lang_iso_code || '').trim().toLowerCase();
      const name = item.customer_name || '';
      const ref = item.reference || item.id_order;

      const payload = {
        // For Automation Suite prompts/tools that expect a direct id_order input.
        id_order: item.id_order ?? null,
        id_shop: item.id_shop ?? null,
        shop_domain: item.shop_domain_no_www || null,
        client: { name: item.customer_name || null, email: item.customer_email || null },
        lang: { name: item.langue || null, iso_code: item.lang_iso_code || null, id_lang: item.id_lang ?? null },
        // Do not provide shop contact fields to the model; the server appends the correct signature from id_shop.
        shop: { id_shop: item.id_shop ?? null, domain: item.shop_domain_no_www || null },
        order: { id_order: item.id_order ?? null, reference: item.reference || null },
        tracking: {
          url: resolved.tracking_url,
          number: item.tracking_number || null,
          carrier: item.carrier || null,
          source: { server_id: resolved.server_id || null, server_name: resolved.server_name || null, tool: resolved.tool_name || null },
        },
        requested: { type: 'tracking_email' },
      };

      const instructions =
        'Return JSON only with keys: subject (string), html (string), text (string). ' +
        'Subject must start with the shop domain without www in [brackets] and include the order reference. ' +
        'HTML must be a clean email body (no markdown). Text must be a plain-text alternative. ' +
        'If tracking.url is present, include it and ask the customer to use it. If tracking.url is missing/null, you MUST resolve a real tracking URL by calling the MCP2 tools (as described in the Prompt Config developer message) and then include it exactly once. ' +
        'End with a short polite closing line only. ' +
        'IMPORTANT: Do NOT include any signature block or contact details (no name, no phone, no email, no website, no address). ' +
        'The server will append the correct signature based on id_shop.';

	      let outJson = null;
	      let openaiDebug = null;
	      try {
	        const tOpenai = Date.now();
	        const gen = await generateJsonFromPromptConfig({
	          pool,
	          orgId: orgInt,
	          promptConfigId,
          input: JSON.stringify(payload),
          instructions,
          debug: wantDebug,
        });
	        if (wantDebug && gen && typeof gen === 'object') {
	          outJson = gen.parsed || null;
	          openaiDebug = gen.debug || null;
	          if (openaiDebug && gen.error) openaiDebug = { ...openaiDebug, error: gen.error };
	        } else {
	          outJson = gen || null;
	        }
	        msOpenai = Date.now() - tOpenai;
	      } catch (e) {
	        if (wantDebug) openaiDebug = { error: String(e?.message || e) };
	      }

      const fallbackSubject = langIso === 'fr' ? `[${domain}] Lien de suivi - Commande ${ref}` : `[${domain}] Tracking link - Order ${ref}`;
      const trackingLineHtml = resolved.tracking_url
        ? `<p><a href="${escapeHtml(resolved.tracking_url)}">${escapeHtml(resolved.tracking_url)}</a></p>`
        : (item.tracking_number || item.carrier)
          ? `<p>${escapeHtml(langIso === 'fr' ? 'Numéro de suivi' : 'Tracking number')}: <b>${escapeHtml(String(item.tracking_number || ''))}</b>${item.carrier ? ` (${escapeHtml(String(item.carrier))})` : ''}</p>`
          : `<p>${escapeHtml(langIso === 'fr' ? 'Le suivi est en cours de préparation.' : 'Tracking is being prepared.')}</p>`;
      const fallbackHtml =
        `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">` +
        `<p>${langIso === 'fr' ? 'Bonjour' : 'Hello'} ${escapeHtml(name)},</p>` +
        `<p>${langIso === 'fr' ? 'Voici les informations de suivi pour la commande' : 'Here is the tracking information for order'} <b>${escapeHtml(ref)}</b> :</p>` +
        trackingLineHtml +
        `<p>${langIso === 'fr' ? 'Merci.' : 'Thank you.'}</p>` +
        `</div>`;
      const trackingLineText = resolved.tracking_url
        ? `${resolved.tracking_url}`
        : (item.tracking_number || item.carrier)
          ? `${langIso === 'fr' ? 'Numero de suivi' : 'Tracking number'}: ${String(item.tracking_number || '')}${item.carrier ? ` (${String(item.carrier)})` : ''}`
          : `${langIso === 'fr' ? 'Le suivi est en cours de preparation.' : 'Tracking is being prepared.'}`;
      const fallbackText =
        `${langIso === 'fr' ? 'Bonjour' : 'Hello'} ${name}\n\n` +
        `${langIso === 'fr' ? 'Voici les informations de suivi pour la commande' : 'Here is the tracking information for order'} ${ref}:\n` +
        `${trackingLineText}\n\n` +
        `${langIso === 'fr' ? 'Merci.' : 'Thank you.'}`;

      const subject = String(outJson?.subject || '').trim() || fallbackSubject;
      let htmlBody = String(outJson?.html || '').trim() || fallbackHtml;
      let textBody = String(outJson?.text || '').trim() || fallbackText;
      const sanitized = sanitizeRelanceEmailOutput({ html: htmlBody, text: textBody });
      htmlBody = sanitized.html || htmlBody;
      textBody = sanitized.text || textBody;

	      const tSig = Date.now();
	      const signature = await buildSignatureForItem(pool, orgInt, item);
	      msSignature = Date.now() - tSig;
	      // Strip images from the model output, but keep the shop logo from the server-side signature.
	      const finalHtml = appendEmailHtml(stripHtmlImages(htmlBody), signature.html);
	      const finalText = appendEmailText(textBody || stripHtml(htmlBody), signature.text);

	      logTrackingEvent('tools_relance_email_generate_timing', {
	        kind: 'tracking',
	        org_id: orgInt ?? null,
	        id_order: idOrder,
	        id_shop: item.id_shop ?? null,
	        id_lang: item.id_lang ?? null,
	        ms_total: Date.now() - t0,
	        ms_mysql: msMysql,
	        ms_openai: msOpenai,
	        ms_signature: msSignature,
	        cache: signature?._debug?.cache || null,
	      });
	      return res.json({
	        ok: true,
	        email: { subject, html: finalHtml, text: finalText },
	        tracking: resolved,
        item: { ...item, tracking_url: resolved.tracking_url },
        ...(wantDebug ? { openai_debug: openaiDebug, signature_debug: signature?._debug || null } : {}),
      });
    } catch (e) {
      const code = String(e?.message || '');
      if (code === 'prompt_id_missing' || code === 'model_missing' || code === 'prompt_config_empty') {
        return res.status(400).json({
          ok: false,
          error: code,
          message:
            code === 'prompt_config_empty'
              ? 'This Prompt Config is empty. Configure either prompt_id (OpenAI prompt) OR dev_message/messages in Automation Suite.'
              : 'This Prompt Config is missing required fields. In Automation Suite, ensure it has a model and either prompt_id or messages/dev_message.',
          prompt_config_id: promptConfigId,
        });
      }
      return res.status(500).json({ ok: false, error: 'email_generate_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  app.post('/api/tools/relance/tracking/:idOrder/email-send', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const idOrder = Number(req.params?.idOrder || 0);
    if (!idOrder) return res.status(400).json({ ok: false, error: 'bad_request', message: 'idOrder is required' });
    const orgId = pickOrgId(req);
    const profileId = String(req.body?.profile_id || req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });
    const prefix = String(req.query?.prefix || 'ps_');

    const toOverride = String(req.body?.to || req.body?.email?.to || '').trim();
    const providedHtml = String(req.body?.html || req.body?.email?.html || req.body?.content_html || '').trim();
    const providedText = String(req.body?.text || req.body?.email?.text || '').trim();
    const providedSubject = String(req.body?.subject || req.body?.email?.subject || '').trim();
    if (!providedHtml) return res.status(400).json({ ok: false, error: 'missing_html' });
    if (!providedSubject) return res.status(400).json({ ok: false, error: 'missing_subject' });

    let conn;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);
      const rows = await q(
        `
          SELECT
            o.id_order AS id_order,
            o.reference AS reference,
            o.id_lang AS id_lang,
            o.id_shop AS id_shop,
            c.firstname AS firstname,
            c.lastname AS lastname,
            c.email AS email,
            conf.value AS shop_domain_ssl,
            conf2.value AS shop_email,
            l.name AS name2,
            l.iso_code AS iso_code
          FROM \`${prefix}orders\` o
          JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
          JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
          LEFT JOIN \`${prefix}configuration\` conf2 ON conf2.id_shop = o.id_shop AND conf2.name = 'PS_SHOP_EMAIL'
          JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
          WHERE o.id_order = ?
          LIMIT 1
        `,
        [idOrder]
      );
      const row = rows?.[0] || null;
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      const item = mapTrackingRow(row);

      const toFinal = toOverride || String(item.customer_email || '').trim();
      if (!toFinal) return res.status(400).json({ ok: false, error: 'missing_to' });
      if (!String(item.shop_email || '').trim() && Number(item.id_shop) > 0) {
        try {
          const v = await getShopEmailWithFallback(q, prefix, Number(item.id_shop));
          if (v) item.shop_email = v;
        } catch {}
      }
      const fromCandidate = String(item.shop_email || '').trim();
      const textFinal = providedText || stripHtml(providedHtml);

      let msg = null;
      let fromUsed = null;
      let fromFallback = false;
      try {
        msg = await sendEmail({ ctx, to: toFinal, subject: providedSubject, html: providedHtml, text: textFinal, from: fromCandidate || undefined });
        fromUsed = fromCandidate || null;
      } catch (err) {
        try {
          msg = await sendEmail({ ctx, to: toFinal, subject: providedSubject, html: providedHtml, text: textFinal });
          fromUsed = null;
          fromFallback = true;
        } catch {
          throw err;
        }
      }

      return res.json({
        ok: true,
        to: toFinal,
        subject: providedSubject,
        message_id: msg?.id || msg?.threadId || null,
        message: msg || null,
        sender: { from_candidate: fromCandidate || null, from_used: fromUsed, fallback_used: fromFallback },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'send_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  // Create a Gmail draft for Tracking (requires email payload from the frontend).
  app.post('/api/tools/relance/tracking/:idOrder/email-draft', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const idOrder = Number(req.params?.idOrder || 0);
    if (!idOrder) return res.status(400).json({ ok: false, error: 'bad_request', message: 'idOrder is required' });
    const orgId = pickOrgId(req);
    const profileId = String(req.body?.profile_id || req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });
    const prefix = String(req.query?.prefix || 'ps_');

    const toOverride = String(req.body?.to || req.body?.email?.to || '').trim();
    const providedHtml = String(req.body?.html || req.body?.email?.html || req.body?.content_html || '').trim();
    const providedText = String(req.body?.text || req.body?.email?.text || '').trim();
    const providedSubject = String(req.body?.subject || req.body?.email?.subject || '').trim();
    if (!providedHtml) return res.status(400).json({ ok: false, error: 'missing_html' });

    let conn;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);
      const rows = await q(
        `
          SELECT
            o.id_order AS id_order,
            o.reference AS reference,
            o.id_lang AS id_lang,
            o.id_shop AS id_shop,
            c.firstname AS firstname,
            c.lastname AS lastname,
            c.email AS email,
            conf.value AS shop_domain_ssl,
            conf2.value AS shop_email,
            l.name AS name2,
            l.iso_code AS iso_code
          FROM \`${prefix}orders\` o
          JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
          JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
          LEFT JOIN \`${prefix}configuration\` conf2 ON conf2.id_shop = o.id_shop AND conf2.name = 'PS_SHOP_EMAIL'
          JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
          WHERE o.id_order = ?
          LIMIT 1
        `,
        [idOrder]
      );
      const row = rows?.[0] || null;
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      const item = mapTrackingRow(row);
      const domain = item.shop_domain_no_www || 'shop';
      const ref = item.reference || item.id_order;
      const langIso = String(item.lang_iso_code || '').trim().toLowerCase();

      const toFinal = toOverride || String(item.customer_email || '').trim();
      if (!toFinal) return res.status(400).json({ ok: false, error: 'missing_to' });
      if (!String(item.shop_email || '').trim() && Number(item.id_shop) > 0) {
        try {
          const v = await getShopEmailWithFallback(q, prefix, Number(item.id_shop));
          if (v) item.shop_email = v;
        } catch {}
      }
      const fromCandidate = String(item.shop_email || '').trim();
      const subject = providedSubject || (langIso === 'fr' ? `[${domain}] Lien de suivi - Commande ${ref}` : `[${domain}] Tracking link - Order ${ref}`);
      const textFinal = providedText || stripHtml(providedHtml);

      let draft = null;
      let fromUsed = null;
      let fromFallback = false;
      try {
        draft = await createDraft({ ctx, to: toFinal, subject, html: providedHtml, text: textFinal, from: fromCandidate || undefined });
        fromUsed = fromCandidate || null;
      } catch (err) {
        try {
          draft = await createDraft({ ctx, to: toFinal, subject, html: providedHtml, text: textFinal });
          fromUsed = null;
          fromFallback = true;
        } catch {
          throw err;
        }
      }
      return res.json({
        ok: true,
        to: toFinal,
        subject,
        draft,
        sender: { from_candidate: fromCandidate || null, from_used: fromUsed, fallback_used: fromFallback },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'draft_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  app.post('/api/tools/relance/virement-bancaire/:idOrder/email-draft', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const idOrder = Number(req.params?.idOrder || 0);
    if (!idOrder) return res.status(400).json({ ok: false, error: 'bad_request', message: 'idOrder is required' });
    const orgId = pickOrgId(req);
    const profileId = String(req.body?.profile_id || req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });
    const prefix = String(req.query?.prefix || 'ps_');

    const toOverride = String(req.body?.to || req.body?.email?.to || '').trim() || null;
    const providedHtml = String(req.body?.html || req.body?.email?.html || req.body?.content_html || '').trim();
    const providedText = String(req.body?.text || req.body?.email?.text || '').trim();
    const providedSubject = String(req.body?.subject || req.body?.email?.subject || '').trim();
    if (!providedHtml) return res.status(400).json({ ok: false, error: 'missing_html' });

    let promptConfigId = String(req.body?.prompt_config_id || '').trim() || null;
    if (!promptConfigId) {
      try {
        const orgInt = toOrgInt(orgId);
        const row = await loadToolsConfigValue(pool, KEY_RELANCE_VIREMENT_PROMPT, orgInt);
        promptConfigId = row?.value?.prompt_config_id ? String(row.value.prompt_config_id).trim() : null;
      } catch {}
    }

    let conn;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);
      let row = null;
      try {
        const rows = await q('SELECT * FROM `relance_virement_bancaire` WHERE id_order = ? LIMIT 1', [idOrder]);
        row = rows?.[0] || null;
      } catch {
        const prefix = String(req.query?.prefix || 'ps_');
        const rows = await q(
          `
            SELECT
              o.id_order AS id_order,
              o.reference AS reference,
              o.id_lang AS id_lang,
              o.id_shop AS id_shop,
              o.payment AS payment,
              o.current_state AS current_state,
              osl.id_lang AS id_lang1,
              osl.name AS name,
              osl.id_order_state AS id_order_state,
              c.firstname AS firstname,
              c.lastname AS lastname,
              c.email AS email,
              conf.name AS name1,
              conf.value AS value,
              l.name AS name2,
              l.iso_code AS iso_code,
              conf2.name AS name3,
              conf2.value AS value1
            FROM \`${prefix}orders\` o
            JOIN \`${prefix}order_state_lang\` osl ON osl.id_order_state = o.current_state
            JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
            JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
            JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
            JOIN \`${prefix}configuration\` conf2 ON conf2.id_shop = o.id_shop AND conf2.name = 'PS_SHOP_EMAIL'
            WHERE o.id_order = ?
              AND o.current_state = 10
              AND osl.id_lang = 1
            LIMIT 1
          `,
          [idOrder]
        );
        row = rows?.[0] || null;
      }
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      const item = mapVirementRow(row);
      if (!item.customer_email) return res.status(400).json({ ok: false, error: 'missing_customer_email' });

      // Ensure sender email is present (PS_SHOP_EMAIL by id_shop)
      if (Number(item.id_shop) > 0) {
        // No fallback: enforce shop-scoped configs for this id_shop (PS_SHOP_EMAIL / PS_SHOP_PHONE).
        try { item.shop_email = await getShopEmailWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_email = ''; }
        try { item.shop_phone = await getShopPhoneWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_phone = ''; }
        try { item.shop_logo_invoice = await getShopLogoInvoiceWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_logo_invoice = ''; }
      }
      // Ensure amount + currency are present (ps_orders + ps_currency)
      if ((!item.currency_iso || item.total_paid_tax_incl == null || !Number.isFinite(Number(item.total_paid_tax_incl))) && Number(item.id_order) > 0) {
        try {
          await hydrateOrderAmountsAndCurrency(q, prefix, [item]);
        } catch {}
      }

      const domain = item.shop_domain_no_www || 'shop';
      const langue = item.langue || item.lang_iso_code || '';
      const contentText = providedText || stripHtml(providedHtml);

      let subject = providedSubject;
      if (!subject) {
        if (promptConfigId) {
          const promptInput = `peux-tu me rédiger l objet de cette email en ${langue} avec le nom du site sans les www , entre [] au début , avec le numero de commande , avec demande de virement ${contentText}`;
          try {
            subject = await generateTextFromPromptConfig({
              pool,
              orgId,
              promptConfigId,
              input: promptInput,
              instructions: 'Return only the email subject line. No quotes, no prefix/suffix, no markdown.',
            });
          } catch {}
        }
        if (!subject) subject = `[${domain}] Commande ${item.reference || item.id_order} - Demande de virement`;
      }

      const text = contentText || `Bonjour ${item.customer_name || ''},\n\nCommande ${item.reference || item.id_order}\n`;

      const fromCandidate = String(item.shop_email || '').trim();
      const toFinal = toOverride || item.customer_email;
      let draft = null;
      let fromUsed = null;
      let fromFallback = false;
      try {
        draft = await createDraft({ ctx, to: toFinal, subject, html: providedHtml, text, from: fromCandidate || undefined });
        fromUsed = fromCandidate || null;
      } catch (err) {
        // Gmail may reject non-matching "From". Retry without From header (uses account default).
        try {
          draft = await createDraft({ ctx, to: toFinal, subject, html: providedHtml, text });
          fromUsed = null;
          fromFallback = true;
        } catch {
          throw err;
        }
      }
      return res.json({
        ok: true,
        subject,
        to: toFinal,
        draft,
        sender: { from_candidate: fromCandidate || null, from_used: fromUsed, fallback_used: fromFallback },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'draft_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  app.post('/api/tools/relance/virement-bancaire/:idOrder/email-send', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const idOrder = Number(req.params?.idOrder || 0);
    if (!idOrder) return res.status(400).json({ ok: false, error: 'bad_request', message: 'idOrder is required' });
    const orgId = pickOrgId(req);
    const profileId = String(req.body?.profile_id || req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });
    const prefix = String(req.query?.prefix || 'ps_');

    const toOverride = String(req.body?.to || req.body?.email?.to || '').trim() || null;
    const providedHtml = String(req.body?.html || req.body?.email?.html || req.body?.content_html || '').trim();
    const providedText = String(req.body?.text || req.body?.email?.text || '').trim();
    const providedSubject = String(req.body?.subject || req.body?.email?.subject || '').trim();
    if (!providedHtml) return res.status(400).json({ ok: false, error: 'missing_html' });

    let promptConfigId = String(req.body?.prompt_config_id || '').trim() || null;
    if (!promptConfigId) {
      try {
        const orgInt = toOrgInt(orgId);
        const row = await loadToolsConfigValue(pool, KEY_RELANCE_VIREMENT_PROMPT, orgInt);
        promptConfigId = row?.value?.prompt_config_id ? String(row.value.prompt_config_id).trim() : null;
      } catch {}
    }

    let conn;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);
      let row = null;
      try {
        const rows = await q('SELECT * FROM `relance_virement_bancaire` WHERE id_order = ? LIMIT 1', [idOrder]);
        row = rows?.[0] || null;
      } catch {
        const rows = await q(
          `
            SELECT
              o.id_order AS id_order,
              o.reference AS reference,
              o.id_lang AS id_lang,
              o.id_shop AS id_shop,
              o.payment AS payment,
              o.current_state AS current_state,
              osl.id_lang AS id_lang1,
              osl.name AS name,
              osl.id_order_state AS id_order_state,
              c.firstname AS firstname,
              c.lastname AS lastname,
              c.email AS email,
              conf.value AS shop_domain_ssl,
              l.name AS name2,
              l.iso_code AS iso_code,
              conf2.value AS value1
            FROM \`${prefix}orders\` o
            JOIN \`${prefix}order_state_lang\` osl ON osl.id_order_state = o.current_state
            JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
            JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
            JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
            JOIN \`${prefix}configuration\` conf2 ON conf2.id_shop = o.id_shop AND conf2.name = 'PS_SHOP_EMAIL'
            WHERE o.id_order = ?
            LIMIT 1
          `,
          [idOrder]
        );
        row = rows?.[0] || null;
      }
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      const item = mapVirementRow(row);
      if (!item.customer_email) return res.status(400).json({ ok: false, error: 'missing_customer_email' });

      // Ensure we use authoritative ps_orders/shop config values (id_shop/id_lang/domain/email/phone) for the signature.
      try { await hydrateOrderShopLangAndConfigs(q, prefix, item); } catch {}

      // Ensure sender email is present (PS_SHOP_EMAIL by id_shop)
      if (!String(item.shop_email || '').trim() && Number(item.id_shop) > 0) {
        try {
          const v = await getShopEmailWithFallback(q, prefix, Number(item.id_shop));
          if (v) item.shop_email = v;
        } catch {}
      }
      if (Number(item.id_shop) > 0) {
        // No fallback: enforce shop-scoped phone for this id_shop.
        try { item.shop_phone = await getShopPhoneWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_phone = ''; }
        try { item.shop_logo_invoice = await getShopLogoInvoiceWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_logo_invoice = ''; }
      }

      const domain = item.shop_domain_no_www || 'shop';
      const langue = item.langue || item.lang_iso_code || '';
      const contentText = providedText || stripHtml(providedHtml);

      let subject = providedSubject;
      if (!subject) {
        if (promptConfigId) {
          const promptInput = `peux-tu me rédiger l objet de cette email en ${langue} avec le nom du site sans les www , entre [] au début , avec le numero de commande , avec demande de virement ${contentText}`;
          try {
            subject = await generateTextFromPromptConfig({
              pool,
              orgId,
              promptConfigId,
              input: promptInput,
              instructions: 'Return only the email subject line. No quotes, no prefix/suffix, no markdown.',
            });
          } catch {}
        }
        if (!subject) subject = `[${domain}] Commande ${item.reference || item.id_order} - Demande de virement`;
      }

      const text = contentText || `Bonjour ${item.customer_name || ''},\n\nCommande ${item.reference || item.id_order}\n`;
      const fromCandidate = String(item.shop_email || '').trim();
      const toFinal = toOverride || item.customer_email;

      let msg = null;
      let fromUsed = null;
      let fromFallback = false;
      try {
        msg = await sendEmail({ ctx, to: toFinal, subject, html: providedHtml, text, from: fromCandidate || undefined });
        fromUsed = fromCandidate || null;
      } catch (err) {
        try {
          msg = await sendEmail({ ctx, to: toFinal, subject, html: providedHtml, text });
          fromUsed = null;
          fromFallback = true;
        } catch {
          throw err;
        }
      }

      return res.json({
        ok: true,
        subject,
        to: toFinal,
        message_id: msg?.id || msg?.threadId || null,
        message: msg || null,
        sender: { from_candidate: fromCandidate || null, from_used: fromUsed, fallback_used: fromFallback },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'send_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  // Generate a full email (subject + html + text) from prompt using order/shop/client metadata.
  app.post('/api/tools/relance/virement-bancaire/:idOrder/email-generate', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const t0 = Date.now();
    const idOrder = Number(req.params?.idOrder || 0);
    if (!idOrder) return res.status(400).json({ ok: false, error: 'bad_request', message: 'idOrder is required' });
    const orgId = pickOrgId(req);
    const orgInt = toOrgInt(orgId);
    const prefix = String(req.query?.prefix || 'ps_');
    const profileId = String(req.body?.profile_id || req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });

    let promptConfigId = String(req.body?.prompt_config_id || '').trim() || null;
    if (!promptConfigId) {
      try {
        const row = await loadToolsConfigValue(pool, KEY_RELANCE_VIREMENT_EMAIL_PROMPT, orgInt);
        promptConfigId = row?.value?.prompt_config_id ? String(row.value.prompt_config_id).trim() : null;
      } catch {}
    }
    if (!promptConfigId) {
      return res
        .status(400)
        .json({ ok: false, error: 'missing_prompt_config', message: 'Set "Virement bancaire → Prompt (email complet)" in Paramètres.' });
    }

    let conn;
    try {
      let msMysql = 0;
      let msOpenai = 0;
      let msSignature = 0;
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);

      let row = null;
      try {
        const rows = await q('SELECT * FROM `relance_virement_bancaire` WHERE id_order = ? LIMIT 1', [idOrder]);
        row = rows?.[0] || null;
      } catch {
        const rows = await q(
          `
            SELECT
              o.id_order AS id_order,
              o.reference AS reference,
              o.id_lang AS id_lang,
              o.id_shop AS id_shop,
              o.payment AS payment,
              o.current_state AS current_state,
              osl.id_lang AS id_lang1,
              osl.name AS name,
              osl.id_order_state AS id_order_state,
              c.firstname AS firstname,
              c.lastname AS lastname,
              c.email AS email,
              conf.value AS shop_domain_ssl,
              l.name AS name2,
              l.iso_code AS iso_code,
              conf2.value AS value1
            FROM \`${prefix}orders\` o
            JOIN \`${prefix}order_state_lang\` osl ON osl.id_order_state = o.current_state
            JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
            JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
            JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
            JOIN \`${prefix}configuration\` conf2 ON conf2.id_shop = o.id_shop AND conf2.name = 'PS_SHOP_EMAIL'
            WHERE o.id_order = ?
            LIMIT 1
          `,
          [idOrder]
        );
        row = rows?.[0] || null;
      }
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });

      const item = mapVirementRow(row);
      if (!item.customer_email) return res.status(400).json({ ok: false, error: 'missing_customer_email' });

      // Ensure we use authoritative ps_orders/shop config values (id_shop/id_lang/domain/email/phone/logo) for the signature.
      try { await hydrateOrderShopLangAndConfigs(q, prefix, item); } catch {}

      // Ensure sender email is present (PS_SHOP_EMAIL by id_shop)
      if (!String(item.shop_email || '').trim() && Number(item.id_shop) > 0) {
        try {
          const v = await getShopEmailWithFallback(q, prefix, Number(item.id_shop));
          if (v) item.shop_email = v;
        } catch {}
      }
      if (Number(item.id_shop) > 0) {
        // No fallback: enforce shop-scoped phone/logo for this id_shop.
        try { item.shop_phone = await getShopPhoneWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_phone = ''; }
        try { item.shop_logo_invoice = await getShopLogoInvoiceWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_logo_invoice = ''; }
      }
      msMysql = Date.now() - t0;
      // Ensure amount + currency are present (ps_orders + ps_currency)
      if ((!item.currency_iso || item.total_paid_tax_incl == null || !Number.isFinite(Number(item.total_paid_tax_incl))) && Number(item.id_order) > 0) {
        try {
          await hydrateOrderAmountsAndCurrency(q, prefix, [item]);
        } catch {}
      }

      // Load bank details and select IBAN/BIC based on order currency
      let bankDetails = null;
      try {
        const rowBank = await loadToolsConfigValue(pool, KEY_RELANCE_VIREMENT_BANK_DETAILS, orgInt);
        bankDetails = rowBank?.value || null;
      } catch {}
      const selectedBank = pickBankDetailsForCurrency(bankDetails, item.currency_iso || '');
      const bankBlocks = buildBankWireBlocks({
        amount: item.total_paid_tax_incl ?? null,
        currency: item.currency_iso || '',
        reference: item.reference || String(item.id_order || '').trim(),
        details: selectedBank,
        countryOverride: null,
      });
      const bankI18nSeed = buildBankWireI18nSeed({
        amount: item.total_paid_tax_incl ?? null,
        currency: item.currency_iso || '',
        reference: item.reference || String(item.id_order || '').trim(),
        details: selectedBank,
        countryOverride: null,
      });

      const tSig = Date.now();
      const signature = await buildSignatureForItem(pool, orgInt, item);
      msSignature = Date.now() - tSig;

      const payload = {
        client: {
          name: item.customer_name || null,
          email: item.customer_email || null,
        },
        lang: {
          name: item.langue || null,
          iso_code: item.lang_iso_code || null,
          id_lang: item.id_lang ?? null,
        },
        shop: {
          id_shop: item.id_shop ?? null,
          domain: item.shop_domain_no_www || null,
          email: item.shop_email || null,
        },
        order: {
          id_order: item.id_order ?? null,
          reference: item.reference || null,
          total_paid_tax_incl: item.total_paid_tax_incl ?? null,
          currency_iso: item.currency_iso || null,
          payment: item.payment || null,
          current_state: item.current_state ?? null,
          state_name: item.order_state || null,
        },
        bank_wire: {
          amount_due: item.total_paid_tax_incl ?? null,
          currency: item.currency_iso || null,
          order_reference: item.reference || (item.id_order != null ? String(item.id_order) : null),
          account_holder: selectedBank.account_holder,
          bank_name: selectedBank.bank_name,
          bank_address: selectedBank.address ? null : selectedBank.bank_address,
          address: selectedBank.address || null,
          account_currency: selectedBank.account_currency,
          iban: selectedBank.iban,
          bic: selectedBank.bic,
          i18n_seed: bankI18nSeed,
        },
        signature: {
          contact_name: signature.contact_name,
          company_name: signature.company_name,
          phone: signature.phone,
          email: signature.email,
          website: signature.website,
          logo_url: signature.logo_url,
          block_text: signature.text,
          block_html: signature.html,
        },
        requested: {
          type: 'virement_bancaire',
        },
      };

      const instructions =
        'Return JSON only with keys: subject (string), html (string), text (string), bank_wire_html (string, optional), bank_wire_text (string, optional), bank_country_translated (string, optional). ' +
        'Subject must include the shop domain without www in [brackets] at start and the order reference. ' +
        'HTML must be a clean email body (no markdown). Text must be a plain-text alternative. ' +
        'Start the message with a proper salutation in the customer language (e.g. "Estimado/a <name>," when Spanish). End with a short polite closing line (no contact details). ' +
        'If bank_wire.i18n_seed.values.country is provided, translate the country name to the customer language and return it in bank_country_translated (string). ' +
        'Translate the bank wire section to the customer language using bank_wire.i18n_seed.labels_fr + bank_wire.i18n_seed.values, and return it as bank_wire_html + bank_wire_text. ' +
        'The bank wire section HTML MUST be a 2-column table (role="presentation") with inline styles and NO visible borders; include only non-empty fields. ' +
        'Note: bank_wire.i18n_seed.values.bank_address does NOT include the country; use values.country as its own row. ' +
        'IMPORTANT: Do NOT include the bank wire section nor the signature block inside html/text; return the bank section only via bank_wire_html/bank_wire_text. The server will append both bank section and signature. ' +
        'Focus on the message body only.';

      const tOpenai = Date.now();
      const out = await generateJsonFromPromptConfig({
        pool,
        orgId: orgInt,
        promptConfigId,
        input: JSON.stringify(payload),
        instructions,
      });
      msOpenai = Date.now() - tOpenai;
      const subject = String(out?.subject || '').trim();
      const htmlBody = String(out?.html || '').trim();
      const textBody = String(out?.text || '').trim();
      if (!subject || !htmlBody) return res.status(500).json({ ok: false, error: 'prompt_invalid_output', message: 'Expected JSON with subject + html.' });
      const countryTranslated = String(out?.bank_country_translated || out?.bank_country || '').trim() || null;
      const bankBlocksFinal = countryTranslated
        ? buildBankWireBlocks({
            amount: item.total_paid_tax_incl ?? null,
            currency: item.currency_iso || '',
            reference: item.reference || String(item.id_order || '').trim(),
            details: selectedBank,
            countryOverride: countryTranslated,
          })
        : bankBlocks;

      const promptBankHtml = String(out?.bank_wire_html || out?.bank_wire_section_html || '').trim();
      const promptBankText = String(out?.bank_wire_text || out?.bank_wire_section_text || '').trim();
      const bankHtmlToAppend = promptBankHtml || bankBlocksFinal.blockHtml;
      const bankTextToAppend = promptBankText || bankBlocksFinal.blockText;

      const sanitized = sanitizeRelanceEmailOutput({ html: htmlBody, text: textBody });
      const cleanedHtml = String(sanitized.html || htmlBody || '').trim();
      const cleanedText = String(sanitized.text || textBody || '').trim() || stripHtml(cleanedHtml);
      // Strip images from the model output and bank block, but keep the shop logo from the server-side signature.
      const finalHtml = appendEmailHtml(appendEmailHtml(stripHtmlImages(cleanedHtml), stripHtmlImages(bankHtmlToAppend)), signature.html);
      const finalText = appendEmailText(appendEmailText(cleanedText, bankTextToAppend), signature.text);
      logTrackingEvent('tools_relance_email_generate_timing', {
        kind: 'virement_bancaire',
        org_id: orgInt ?? null,
        id_order: idOrder,
        id_shop: item.id_shop ?? null,
        id_lang: item.id_lang ?? null,
        ms_total: Date.now() - t0,
        ms_mysql: msMysql,
        ms_openai: msOpenai,
        ms_signature: msSignature,
        cache: signature?._debug?.cache || null,
      });
      return res.json({ ok: true, email: { subject, html: finalHtml, text: finalText }, item });
    } catch (e) {
      const code = String(e?.message || '');
      if (code === 'prompt_id_missing' || code === 'model_missing' || code === 'prompt_config_empty') {
        return res.status(400).json({
          ok: false,
          error: code,
          message:
            code === 'prompt_config_empty'
              ? 'This Prompt Config is empty. Configure either prompt_id (OpenAI prompt) OR dev_message/messages in Automation Suite.'
              : 'This Prompt Config is missing required fields. In Automation Suite, ensure it has a model and either prompt_id or messages/dev_message.',
          prompt_config_id: promptConfigId,
        });
      }
      return res.status(500).json({ ok: false, error: 'email_generate_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  // Generate a full email (subject + html + text) for "numero de maison" from prompt using order/shop/client metadata.
  app.post('/api/tools/relance/numero-de-maison/:idOrder/email-generate', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const t0 = Date.now();
    const idOrder = Number(req.params?.idOrder || 0);
    if (!idOrder) return res.status(400).json({ ok: false, error: 'bad_request', message: 'idOrder is required' });
    const orgId = pickOrgId(req);
    const orgInt = toOrgInt(orgId);
    const profileId = String(req.body?.profile_id || req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });
    const prefix = String(req.query?.prefix || 'ps_');

    let promptConfigId = String(req.body?.prompt_config_id || '').trim() || null;
    if (!promptConfigId) {
      try {
        const row = await loadToolsConfigValue(pool, KEY_RELANCE_MAISON_PROMPT, orgInt);
        promptConfigId = row?.value?.prompt_config_id ? String(row.value.prompt_config_id).trim() : null;
      } catch {}
    }
    if (!promptConfigId) return res.status(400).json({ ok: false, error: 'prompt_id_missing', message: 'Configure a Prompt Config for "numero de maison" in Tools > Paramètres.' });

    const wantDebug = String(req.query?.debug || '').trim() === '1';
    let conn;
    try {
      let msMysql = 0;
      let msOpenai = 0;
      let msSignature = 0;
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);

      let row = null;
      try {
        const rows = await q('SELECT * FROM `relance_numero_de_maison` WHERE id_order = ? LIMIT 1', [idOrder]);
        row = rows?.[0] || null;
      } catch {
        const rows = await q(
          `
            SELECT
              o.id_order AS id_order,
              o.reference AS reference,
              o.id_lang AS id_lang,
              o.id_shop AS id_shop,
              o.payment AS payment,
              o.current_state AS current_state,
              c.firstname AS firstname,
              c.lastname AS lastname,
              c.email AS email,
              conf.value AS shop_domain_ssl,
              l.name AS name2,
              l.iso_code AS iso_code,
              a.phone AS phone,
              a.phone_mobile AS mobile,
              cl.name AS country_name,
              co.call_prefix AS call_prefix,
              conf2.value AS shop_email
            FROM \`${prefix}orders\` o
            JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
            JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
            JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
            JOIN \`${prefix}address\` a ON a.id_address = o.id_address_delivery
            JOIN \`${prefix}country\` co ON co.id_country = a.id_country
            JOIN \`${prefix}country_lang\` cl ON cl.id_country = a.id_country AND cl.id_lang = 1
            LEFT JOIN \`${prefix}configuration\` conf2 ON conf2.id_shop = o.id_shop AND conf2.name = 'PS_SHOP_EMAIL'
            WHERE o.id_order = ?
            LIMIT 1
          `,
          [idOrder]
        );
        row = rows?.[0] || null;
      }
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      const item = mapNumeroMaisonRow(row);
      if (!item.customer_email) return res.status(400).json({ ok: false, error: 'missing_customer_email' });

      // Match virement-bancaire behavior: derive signature from id_shop (+ lang) and shop configs.
      // Some MySQL views omit id_shop/id_lang/shop_email -> hydrate from ps_orders.
      try { await hydrateOrderShopLangAndConfigs(q, prefix, item); } catch {}
      if (Number(item.id_shop) > 0) {
        // No fallback: enforce shop-scoped configs for this id_shop (PS_SHOP_EMAIL / PS_SHOP_PHONE).
        try { item.shop_email = await getShopEmailWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_email = ''; }
        try { item.shop_phone = await getShopPhoneWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_phone = ''; }
        try { item.shop_logo_invoice = await getShopLogoInvoiceWithFallback(q, prefix, Number(item.id_shop)); } catch { item.shop_logo_invoice = ''; }
      }
      msMysql = Date.now() - t0;

      const domain = item.shop_domain_no_www || 'shop';
      const tSig = Date.now();
      const signature = await buildSignatureForItem(pool, orgInt, item);
      msSignature = Date.now() - tSig;

      const payload = {
        client: {
          name: item.customer_name || null,
          email: item.customer_email || null,
        },
        lang: {
          name: item.langue || null,
          iso_code: item.lang_iso_code || null,
          id_lang: item.id_lang ?? null,
        },
        shop: {
          id_shop: item.id_shop ?? null,
          domain: item.shop_domain_no_www || null,
        },
        order: {
          id_order: item.id_order ?? null,
          reference: item.reference || null,
        },
        delivery: {
          country: item.country || null,
          call_prefix: item.call_prefix || null,
          phone: item.phone || null,
          phone_e164: item.phone_e164 || null,
          mobile: item.mobile || null,
          mobile_e164: item.mobile_e164 || null,
        },
        requested: { type: 'numero_de_maison_email' },
      };

      const instructions =
        'Return JSON only with keys: subject (string), html (string), text (string). ' +
        'Subject must start with the shop domain without www in [brackets] and include the order reference. ' +
        'HTML must be a clean email body (no markdown). Text must be a plain-text alternative. ' +
        'Ask the customer to reply with their house number needed for delivery. ' +
        'End with a short polite closing line only. ' +
        'IMPORTANT: Do NOT include any signature block or contact details (no name, no phone, no email, no website, no address). ' +
        'The server will append the correct signature based on id_shop.';

      let out = null;
      try {
        const tOpenai = Date.now();
        out = await generateJsonFromPromptConfig({
          pool,
          orgId: orgInt,
          promptConfigId,
          input: JSON.stringify(payload),
          instructions,
        });
        msOpenai = Date.now() - tOpenai;
      } catch {}

      const langIso = String(item.lang_iso_code || '').trim().toLowerCase();
      const name = item.customer_name || '';
      const ref = item.reference || item.id_order;
      const houseLabel = labelHouseNumber(langIso);
      const fallbackSubject = `[${domain}] Commande ${ref} - Numéro de maison`;
      const fallbackHtml =
        `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">` +
        `<p>${langIso === 'fr' ? 'Bonjour' : 'Hello'} ${escapeHtml(name)},</p>` +
        `<p>${langIso === 'fr' ? 'Pour la livraison de votre commande' : 'For the delivery of your order'} <b>${escapeHtml(ref)}</b>, ` +
        `${langIso === 'fr' ? `merci de nous communiquer votre ${escapeHtml(houseLabel)}.` : `please provide your ${escapeHtml(houseLabel)}.`}</p>` +
        `<p>${langIso === 'fr' ? 'Répondez à cet email.' : 'Reply to this email.'}</p>` +
        `<p>${langIso === 'fr' ? 'Merci.' : 'Thank you.'}</p>` +
        `</div>`;
      const fallbackText =
        `${langIso === 'fr' ? 'Bonjour' : 'Hello'} ${name}\n\n` +
        `${langIso === 'fr' ? 'Pour la livraison de votre commande' : 'For the delivery of your order'} ${ref}, ` +
        `${langIso === 'fr' ? `merci de nous communiquer votre ${houseLabel}.` : `please provide your ${houseLabel}.`}\n\n` +
        `${langIso === 'fr' ? 'Répondez à cet email.' : 'Reply to this email.'}\n\n` +
        `${langIso === 'fr' ? 'Merci.' : 'Thank you.'}`;

      const subject = String(out?.subject || '').trim() || fallbackSubject;
      let htmlBody = String(out?.html || '').trim() || fallbackHtml;
      let textBody = String(out?.text || '').trim() || fallbackText;
      const sanitized = sanitizeRelanceEmailOutput({ html: htmlBody, text: textBody });
      htmlBody = sanitized.html || htmlBody;
      textBody = sanitized.text || textBody;

      // Strip images from the model output, but keep the shop logo from the server-side signature.
      const finalHtml = appendEmailHtml(stripHtmlImages(htmlBody), signature.html);
      const finalText = appendEmailText(textBody || stripHtml(htmlBody), signature.text);
      logTrackingEvent('tools_relance_email_generate_timing', {
        kind: 'numero_de_maison',
        org_id: orgInt ?? null,
        id_order: idOrder,
        id_shop: item.id_shop ?? null,
        id_lang: item.id_lang ?? null,
        ms_total: Date.now() - t0,
        ms_mysql: msMysql,
        ms_openai: msOpenai,
        ms_signature: msSignature,
        cache: signature?._debug?.cache || null,
      });
      return res.json({ ok: true, email: { subject, html: finalHtml, text: finalText }, item, ...(wantDebug ? { signature_debug: signature?._debug || null } : {}) });
    } catch (e) {
      const code = String(e?.message || '');
      if (code === 'prompt_id_missing' || code === 'model_missing' || code === 'prompt_config_empty') {
        return res.status(400).json({
          ok: false,
          error: code,
          message:
            code === 'prompt_config_empty'
              ? 'This Prompt Config is empty. Configure either prompt_id (OpenAI prompt) OR dev_message/messages in Automation Suite.'
              : 'This Prompt Config is missing required fields. In Automation Suite, ensure it has a model and either prompt_id or messages/dev_message.',
          prompt_config_id: promptConfigId,
        });
      }
      return res.status(500).json({ ok: false, error: 'email_generate_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  // Send email for "numero de maison" (requires email payload from the frontend).
  app.post('/api/tools/relance/numero-de-maison/:idOrder/email-send', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const idOrder = Number(req.params?.idOrder || 0);
    if (!idOrder) return res.status(400).json({ ok: false, error: 'bad_request', message: 'idOrder is required' });
    const orgId = pickOrgId(req);
    const profileId = String(req.body?.profile_id || req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });
    const emailIn = req.body?.email && typeof req.body.email === 'object' ? req.body.email : null;
    const subjectIn = String(emailIn?.subject || '').trim();
    const htmlIn = String(emailIn?.html || '').trim();
    const textIn = String(emailIn?.text || '').trim();
    if (!subjectIn || !htmlIn) return res.status(400).json({ ok: false, error: 'bad_request', message: 'email.subject + email.html are required' });

    let conn;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);

      let row = null;
      try {
        const rows = await q('SELECT * FROM `relance_numero_de_maison` WHERE id_order = ? LIMIT 1', [idOrder]);
        row = rows?.[0] || null;
      } catch {
        const prefix = String(req.query?.prefix || 'ps_');
        const rows = await q(
          `
            SELECT
              o.id_order AS id_order,
              o.reference AS reference,
              o.id_lang AS id_lang,
              o.id_shop AS id_shop,
              o.payment AS payment,
              o.current_state AS current_state,
              c.firstname AS firstname,
              c.lastname AS lastname,
              c.email AS email,
              conf.value AS shop_domain_ssl,
              l.name AS name2,
              l.iso_code AS iso_code,
              a.phone AS phone,
              a.phone_mobile AS mobile,
              cl.name AS country_name,
              co.call_prefix AS call_prefix,
              conf2.value AS shop_email
            FROM \`${prefix}orders\` o
            JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
            JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
            JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
            JOIN \`${prefix}address\` a ON a.id_address = o.id_address_delivery
            JOIN \`${prefix}country\` co ON co.id_country = a.id_country
            JOIN \`${prefix}country_lang\` cl ON cl.id_country = a.id_country AND cl.id_lang = 1
            LEFT JOIN \`${prefix}configuration\` conf2 ON conf2.id_shop = o.id_shop AND conf2.name = 'PS_SHOP_EMAIL'
            WHERE o.id_order = ?
            LIMIT 1
          `,
          [idOrder]
        );
        row = rows?.[0] || null;
      }
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      const item = mapNumeroMaisonRow(row);
      if (!item.customer_email) return res.status(400).json({ ok: false, error: 'missing_customer_email' });

      // Ensure sender email is present (PS_SHOP_EMAIL by id_shop)
      if (!String(item.shop_email || '').trim() && Number(item.id_shop) > 0) {
        try {
          const v = await getShopEmailWithFallback(q, prefix, Number(item.id_shop));
          if (v) item.shop_email = v;
        } catch {}
      }

      const toOverride = String(req.body?.to || '').trim() || null;
      const toFinal = toOverride || item.customer_email;
      const fromCandidate = String(item.shop_email || '').trim();
      const textFinal = textIn || stripHtml(htmlIn);

      let msg = null;
      let fromUsed = null;
      let fromFallback = false;
      try {
        msg = await sendEmail({ ctx, to: toFinal, subject: subjectIn, html: htmlIn, text: textFinal, from: fromCandidate || undefined });
        fromUsed = fromCandidate || null;
      } catch (err) {
        try {
          msg = await sendEmail({ ctx, to: toFinal, subject: subjectIn, html: htmlIn, text: textFinal });
          fromUsed = null;
          fromFallback = true;
        } catch {
          throw err;
        }
      }

      return res.json({
        ok: true,
        to: toFinal,
        subject: subjectIn,
        message_id: msg?.id || msg?.threadId || null,
        message: msg || null,
        sender: { from_candidate: fromCandidate || null, from_used: fromUsed, fallback_used: fromFallback },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'send_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  // Create a Gmail draft for "numero de maison" (requires email payload from the frontend).
  app.post('/api/tools/relance/numero-de-maison/:idOrder/email-draft', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const idOrder = Number(req.params?.idOrder || 0);
    if (!idOrder) return res.status(400).json({ ok: false, error: 'bad_request', message: 'idOrder is required' });
    const orgId = pickOrgId(req);
    const profileId = String(req.body?.profile_id || req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });

    const toOverride = String(req.body?.to || req.body?.email?.to || '').trim();
    const providedHtml = String(req.body?.html || req.body?.email?.html || req.body?.content_html || '').trim();
    const providedText = String(req.body?.text || req.body?.email?.text || '').trim();
    const providedSubject = String(req.body?.subject || req.body?.email?.subject || '').trim();
    if (!providedHtml) return res.status(400).json({ ok: false, error: 'missing_html' });

    let conn;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);

      let row = null;
      try {
        const rows = await q('SELECT * FROM `relance_numero_de_maison` WHERE id_order = ? LIMIT 1', [idOrder]);
        row = rows?.[0] || null;
      } catch {
        const prefix = String(req.query?.prefix || 'ps_');
        const rows = await q(
          `
            SELECT
              o.id_order AS id_order,
              o.reference AS reference,
              o.id_lang AS id_lang,
              o.id_shop AS id_shop,
              o.payment AS payment,
              o.current_state AS current_state,
              c.firstname AS firstname,
              c.lastname AS lastname,
              c.email AS email,
              conf.value AS shop_domain_ssl,
              l.name AS name2,
              l.iso_code AS iso_code,
              a.phone AS phone,
              a.phone_mobile AS mobile,
              cl.name AS country_name,
              co.call_prefix AS call_prefix,
              conf2.value AS shop_email
            FROM \`${prefix}orders\` o
            JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
            JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
            JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
            JOIN \`${prefix}address\` a ON a.id_address = o.id_address_delivery
            JOIN \`${prefix}country\` co ON co.id_country = a.id_country
            JOIN \`${prefix}country_lang\` cl ON cl.id_country = a.id_country AND cl.id_lang = 1
            LEFT JOIN \`${prefix}configuration\` conf2 ON conf2.id_shop = o.id_shop AND conf2.name = 'PS_SHOP_EMAIL'
            WHERE o.id_order = ?
            LIMIT 1
          `,
          [idOrder]
        );
        row = rows?.[0] || null;
      }
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      const item = mapNumeroMaisonRow(row);
      if (!item.customer_email) return res.status(400).json({ ok: false, error: 'missing_customer_email' });

      const domain = item.shop_domain_no_www || 'shop';
      const ref = item.reference || item.id_order;
      const langIso = String(item.lang_iso_code || '').trim().toLowerCase();

      const toFinal = toOverride || item.customer_email;
      if (!String(item.shop_email || '').trim() && Number(item.id_shop) > 0) {
        try {
          const v = await getShopEmailWithFallback(q, prefix, Number(item.id_shop));
          if (v) item.shop_email = v;
        } catch {}
      }
      const fromCandidate = String(item.shop_email || '').trim();
      const subject = providedSubject || (langIso === 'fr' ? `[${domain}] Adresse - Commande ${ref}` : `[${domain}] Delivery address - Order ${ref}`);
      const textFinal = providedText || stripHtml(providedHtml);

      let draft = null;
      let fromUsed = null;
      let fromFallback = false;
      try {
        draft = await createDraft({ ctx, to: toFinal, subject, html: providedHtml, text: textFinal, from: fromCandidate || undefined });
        fromUsed = fromCandidate || null;
      } catch (err) {
        try {
          draft = await createDraft({ ctx, to: toFinal, subject, html: providedHtml, text: textFinal });
          fromUsed = null;
          fromFallback = true;
        } catch {
          throw err;
        }
      }

      return res.json({
        ok: true,
        to: toFinal,
        subject,
        draft,
        sender: { from_candidate: fromCandidate || null, from_used: fromUsed, fallback_used: fromFallback },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'draft_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });

  app.post('/api/tools/relance/numero-de-maison/:idOrder/sms-draft', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
    const idOrder = Number(req.params?.idOrder || 0);
    if (!idOrder) return res.status(400).json({ ok: false, error: 'bad_request', message: 'idOrder is required' });
    const orgId = pickOrgId(req);
    const profileId = String(req.body?.profile_id || req.query?.profile_id || (await getToolsMysqlProfileId(pool, orgId)) || '').trim();
    if (!profileId) return res.status(400).json({ ok: false, error: 'missing_mysql_profile', message: 'Configure MySQL profile in Tools > Settings.' });

    let promptConfigId = String(req.body?.prompt_config_id || '').trim() || null;
    if (!promptConfigId) {
      try {
        const orgInt = toOrgInt(orgId);
        const row = await loadToolsConfigValue(pool, KEY_RELANCE_MAISON_PROMPT, orgInt);
        promptConfigId = row?.value?.prompt_config_id ? String(row.value.prompt_config_id).trim() : null;
      } catch {}
    }

    let conn;
    try {
      try { await getMysql2FromCtx(ctx); } catch {}
      const cfg = await loadProfileConfig(pool, orgId, profileId);
      conn = await connectMySql(ctx, cfg);
      const { q } = makeSqlHelpers(conn);

      let row = null;
      try {
        const rows = await q('SELECT * FROM `relance_numero_de_maison` WHERE id_order = ? LIMIT 1', [idOrder]);
        row = rows?.[0] || null;
      } catch {
        const prefix = String(req.query?.prefix || 'ps_');
        const rows = await q(
          `
	            SELECT
	              o.id_order AS id_order,
	              o.reference AS reference,
	              o.id_lang AS id_lang,
	              o.id_shop AS id_shop,
	              o.payment AS payment,
	              o.current_state AS current_state,
	              c.firstname AS firstname,
	              c.lastname AS lastname,
	              c.email AS email,
	              conf.value AS shop_domain_ssl,
	              l.name AS name2,
	              l.iso_code AS iso_code,
	              a.phone AS phone,
	              a.phone_mobile AS mobile,
	              cl.name AS country_name,
	              co.call_prefix AS call_prefix
	            FROM \`${prefix}orders\` o
            JOIN \`${prefix}customer\` c ON c.id_customer = o.id_customer
            JOIN \`${prefix}configuration\` conf ON conf.id_shop = o.id_shop AND conf.name = 'PS_SHOP_DOMAIN_SSL'
            JOIN \`${prefix}lang\` l ON l.id_lang = o.id_lang
            JOIN \`${prefix}address\` a ON a.id_address = o.id_address_delivery
            JOIN \`${prefix}country\` co ON co.id_country = a.id_country
            JOIN \`${prefix}country_lang\` cl ON cl.id_country = a.id_country AND cl.id_lang = 1
            WHERE o.id_order = ?
            LIMIT 1
          `,
          [idOrder]
        );
        row = rows?.[0] || null;
      }
      if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
      const item = mapNumeroMaisonRow(row);
      const domain = item.shop_domain_no_www || 'shop';

      let text = '';
      if (promptConfigId) {
        try {
          const langName = String(item.langue || '').trim();
          const langIsoRaw = String(item.lang_iso_code || '').trim().toLowerCase();
          const langIsoFromName = (() => {
            const n = langName.toLowerCase();
            if (!n) return '';
            if (n.includes('english')) return 'en';
            if (n.includes('français') || n.includes('francais') || n.includes('french')) return 'fr';
            if (n.includes('czech') || n.includes('tchèque') || n.includes('tcheque') || n.includes('čeština') || n.includes('cestina')) return 'cs';
            if (n.includes('german') || n.includes('deutsch')) return 'de';
            if (n.includes('spanish') || n.includes('español') || n.includes('espanol')) return 'es';
            if (n.includes('italian') || n.includes('italiano')) return 'it';
            if (n.includes('polish') || n.includes('polski')) return 'pl';
            return '';
          })();
          const langIso = (langIsoRaw === 'gb' ? 'en' : (langIsoRaw || langIsoFromName || '')).trim();
          const langLabel = (langIso === 'en' ? 'English' : (langIso ? langIso.toUpperCase() : (langName || 'customer language')));
          const houseLabel = labelHouseNumber(langIso);

          const payload = {
            client: {
              name: item.customer_name || null,
              email: item.customer_email || null,
            },
            lang: {
              name: item.langue || null,
              iso_code: langIso || item.lang_iso_code || null,
              id_lang: item.id_lang ?? null,
            },
            shop: {
              id_shop: item.id_shop ?? null,
              domain: item.shop_domain_no_www || null,
            },
            order: {
              id_order: item.id_order ?? null,
              reference: item.reference || null,
            },
            delivery: {
              country: item.country || null,
              call_prefix: item.call_prefix || null,
              phone: item.phone || null,
              phone_e164: item.phone_e164 || null,
              mobile: item.mobile || null,
              mobile_e164: item.mobile_e164 || null,
            },
            requested_language: {
              iso_code: langIso || null,
              name: langName || null,
              label: langLabel || null,
              house_number_label: houseLabel || null,
            },
            requested: { type: 'numero_de_maison_sms' },
          };
          text = await generateTextFromPromptConfig({
            pool,
            orgId,
            promptConfigId,
            input: JSON.stringify(payload),
            instructions:
              'Return only a single SMS text. No markdown. Keep it concise (<= 320 chars). ' +
              `Start with "[${domain}]" and include the order reference. ` +
              `IMPORTANT: Write the SMS in ${langLabel}. Do not write in French unless the customer language is French. ` +
              `Do not include bilingual terms. Use "${houseLabel}" as the only label for house number. ` +
              'Ask the customer to provide their house number for delivery.',
          });
        } catch {}
      }
      if (!text) {
        text = `[${domain}] Commande ${item.reference || item.id_order}: merci de compléter votre adresse (numéro de maison) pour la livraison.`;
      }
      return res.json({ ok: true, sms_text: text, item });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'sms_draft_failed', message: String(e?.message || e) });
    } finally {
      try { await conn?.end?.(); } catch {}
    }
  });
}
