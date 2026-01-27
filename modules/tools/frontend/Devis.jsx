import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DevisTranslationsPanel from './components/DevisTranslationsPanel.jsx';
import { fetchDevisLanguagePromptSetting, useMySqlProfileSetting } from './utils/toolsSettings.js';

const DEFAULT_SHOP_ID = '3';

const DEFAULT_HEADER_VALUES = {
  shop_email_text: '',
  customer_email_text: '',
  customer_name_text: '',
  customer_company_text: '',
  devis_number_text: '',
  transport_cost_text: '',
  transport_by_text: '',
  delivery_lead_time_text: '',
  remarques_text: '',
  id_shop_text: '',
  id_lang_text: '',
  date_devis_text: '',
  Option_VAT_text: 'YES',
  Option_Discount_text: '0',
  currency_text: 'EUR',
  rounding_method: 'HALF_AWAY',
  rounding_scope: 'per_line',
};

const ROUNDING_METHODS = [
  { id: 'HALF_AWAY', label: 'Arrondir vers l’infini (mi-chemin)' },
  { id: 'HALF_UP', label: 'Arrondir commercial (demi supérieur)' },
  { id: 'HALF_DOWN', label: 'Demi inférieur (vers zéro)' },
  { id: 'HALF_EVEN', label: 'Demi pair (banque)' },
  { id: 'CEIL', label: 'Arrondir toujours vers le haut' },
  { id: 'FLOOR', label: 'Arrondir toujours vers le bas' },
];

const ROUNDING_SCOPES = [
  { id: 'per_line', label: 'Arrondir pour chaque ligne' },
  { id: 'per_total', label: 'Arrondir sur le total' },
];

const HEADER_INPUTS = [
  { key: 'shop_email_text', label: 'Email boutique / expéditeur', type: 'email', placeholder: 'shop@example.com' },
  { key: 'customer_email_text', label: 'Email client', type: 'email', placeholder: 'contact@client.com' },
  { key: 'customer_name_text', label: 'Nom client', type: 'text', placeholder: 'Jean Dupont' },
  { key: 'customer_company_text', label: 'Société', type: 'text', placeholder: 'Piscines Ondes Pro' },
  { key: 'devis_number_text', label: 'Numéro de devis', type: 'text', placeholder: 'DEV-2025-0001' },
  { key: 'date_devis_text', label: 'Date du devis', type: 'date' },
  { key: 'delivery_lead_time_text', label: 'Délais de livraison', type: 'text', placeholder: '4 days' },
  { key: 'transport_by_text', label: 'Transporteur / méthode', type: 'text', placeholder: 'Transporteur local' },
  { key: 'transport_cost_text', label: 'Coût transport', type: 'number', placeholder: '50.00' },
  { key: 'Option_VAT_text', label: 'TVA incluse ?', type: 'select', options: ['YES', 'NO'] },
  { key: 'Option_Discount_text', label: 'Remise globale (%)', type: 'number', placeholder: '0' },
  { key: 'currency_text', label: 'Devise (ps_currency)', type: 'select', options: [] },
];

function toLocalIsoDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCurrency(value, currency) {
  const fractionDigits = arguments.length >= 3 ? Number(arguments[2]) : 2;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  const digits = Number.isFinite(fractionDigits) ? Math.max(0, Math.min(6, Math.trunc(fractionDigits))) : 2;
  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: String(currency || 'EUR').toUpperCase(),
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toFixed(digits)} ${currency || 'EUR'}`;
  }
}

function formatQuoteDate(value) {
  if (!value) return '';
  try {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString('fr-FR');
  } catch {
    return value;
  }
}

function splitDescription(text) {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function sanitizeHtml(html = '') {
  if (!html) return '';
  return String(html)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/on[a-z]+\s*=\s*["'][\s\S]*?["']/gi, '')
    .replace(/javascript:[\s\S]*?("|\')/gi, '$1');
}

export default function Devis() {
  const [header, setHeader] = useState(() => ({
    ...DEFAULT_HEADER_VALUES,
    date_devis_text: toLocalIsoDate(new Date()),
  }));
  const [deliveryLeadDays, setDeliveryLeadDays] = useState(4);
  const [items, setItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedVariantByProductId, setSelectedVariantByProductId] = useState({});
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const normalizedOrgFilter = String(orgFilter || '').trim();
  const { setting: mysqlSetting } = useMySqlProfileSetting({ orgId: normalizedOrgFilter });
  const [profiles, setProfiles] = useState([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [shops, setShops] = useState([]);
  const [shopsLoading, setShopsLoading] = useState(false);
  const [shopsError, setShopsError] = useState('');
  const [selectedShopId, setSelectedShopId] = useState('');
  const [languages, setLanguages] = useState([]);
  const [languagesLoading, setLanguagesLoading] = useState(false);
  const [languagesError, setLanguagesError] = useState('');
  const [selectedLanguageId, setSelectedLanguageId] = useState('');
  const [currencies, setCurrencies] = useState([]);
  const [currenciesLoading, setCurrenciesLoading] = useState(false);
  const [currenciesError, setCurrenciesError] = useState('');
  const [defaultCurrencyIso, setDefaultCurrencyIso] = useState('');
  const [currenciesHasRate, setCurrenciesHasRate] = useState(true);
  const [offerLoading, setOfferLoading] = useState(false);
  const [offerMessage, setOfferMessage] = useState('');
  const [offerError, setOfferError] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [promptConfigId, setPromptConfigId] = useState('');
  const [promptId, setPromptId] = useState('');
  const [promptVersion, setPromptVersion] = useState('');
  const [promptSavedMsg, setPromptSavedMsg] = useState('');
  const [langPromptConfigId, setLangPromptConfigId] = useState('');
  const [langPromptId, setLangPromptId] = useState('');
  const [langPromptVersion, setLangPromptVersion] = useState('');
  const [langPromptSavedMsg, setLangPromptSavedMsg] = useState('');
  const [promptsTab, setPromptsTab] = useState('extraction');
  const [langDetectStatus, setLangDetectStatus] = useState({ key: '', loading: false, error: '' });
  const [autoLanguage, setAutoLanguage] = useState('');
  const [languageManuallySelected, setLanguageManuallySelected] = useState(false);
  const [autoEmail, setAutoEmail] = useState('');
  const [autoShopPending, setAutoShopPending] = useState(false);
  const [autoShopMatchId, setAutoShopMatchId] = useState('');
  const [autoShopMatchName, setAutoShopMatchName] = useState('');
  const [autoShopEmail, setAutoShopEmail] = useState('');
  const [autoMessageId, setAutoMessageId] = useState('');
  const [promptConfigs, setPromptConfigs] = useState([]);
  const [promptConfigsLoading, setPromptConfigsLoading] = useState(false);
  const [promptConfigsError, setPromptConfigsError] = useState('');

  const optionVat = header.Option_VAT_text === 'YES';
  const discountPercent = Math.max(0, Math.min(100, Number(header.Option_Discount_text) || 0));
  const currencyCode = (header.currency_text || 'EUR').toUpperCase();
  const currencyRatio = useMemo(() => {
    const selectedIso = String(header.currency_text || '').toUpperCase();
    const defaultIso = String(defaultCurrencyIso || '').toUpperCase();
    const selected = currencies.find((cur) => cur.iso_code === selectedIso) || null;
    const def = currencies.find((cur) => cur.iso_code === defaultIso) || null;
    const selectedRate = Number(selected?.conversion_rate);
    const defaultRate = Number(def?.conversion_rate);
    const safeSelected = Number.isFinite(selectedRate) && selectedRate > 0 ? selectedRate : 1;
    const safeDefault = Number.isFinite(defaultRate) && defaultRate > 0 ? defaultRate : 1;
    if (!selectedIso) return 1;
    if (defaultIso && selectedIso === defaultIso) return 1;
    return safeSelected / safeDefault;
  }, [header.currency_text, currencies, defaultCurrencyIso]);
  const roundingMethod = header.rounding_method || 'HALF_AWAY';
  const roundingScope = header.rounding_scope || 'per_line';
  const roundingPerLine = roundingScope === 'per_line';
  const roundingFunctions = {
    HALF_AWAY: (value) => {
      const sign = value >= 0 ? 1 : -1;
      const absValue = Math.abs(value);
      const base = Math.floor(absValue);
      const diff = absValue - base;
      if (diff > 0.5) return sign * (base + 1);
      if (diff < 0.5) return sign * base;
      return sign * (base + 1);
    },
    HALF_UP: (value) => {
      const sign = value >= 0 ? 1 : -1;
      const absValue = Math.abs(value);
      const base = Math.floor(absValue + 0.5);
      return sign * base;
    },
    HALF_DOWN: (value) => {
      const sign = value >= 0 ? 1 : -1;
      const absValue = Math.abs(value);
      const base = Math.floor(absValue);
      const diff = absValue - base;
      if (diff > 0.5) return sign * (base + 1);
      if (diff < 0.5) return sign * base;
      return sign * base;
    },
    HALF_EVEN: (value) => {
      const sign = value >= 0 ? 1 : -1;
      const absValue = Math.abs(value);
      const base = Math.floor(absValue);
      const diff = absValue - base;
      if (diff > 0.5) return sign * (base + 1);
      if (diff < 0.5) return sign * base;
      return sign * ((base % 2 === 0) ? base : base + 1);
    },
    CEIL: (value) => Math.ceil(value),
    FLOOR: (value) => Math.floor(value),
  };
  const applyRounding = (value) => {
    const fn = roundingFunctions[String(roundingMethod)] || roundingFunctions.HALF_AWAY;
    const rounded = fn(value);
    return Number.isFinite(rounded) ? rounded : value;
  };

  const [vendorMeta, setVendorMeta] = useState(null);

  useEffect(() => {
    const profileId = Number(selectedProfileId || 0);
    const shopId = Number(selectedShopId || 0);
    if (!profileId || !shopId) {
      setVendorMeta(null);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set('profile_id', String(profileId));
        params.set('id_shop', String(shopId));
        const headers = {};
        if (orgFilter) headers['X-Org-Id'] = orgFilter;
        const resp = await fetch(`/api/tools/devis/vendor-meta?${params.toString()}`, {
          credentials: 'include',
          headers,
          signal: controller.signal,
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data?.ok) return;
        setVendorMeta(data?.meta || null);
      } catch (err) {
        if (String(err?.name || '') === 'AbortError') return;
      }
    })();
    return () => controller.abort();
  }, [selectedProfileId, selectedShopId, orgFilter]);

  const shopSummary = useMemo(() => {
    if (searchResults.length) {
      const first = searchResults[0];
      return {
        logo_url: vendorMeta?.logo_url || first.logo_url || first.image_url,
        shop_domain: vendorMeta?.shop_domain || first.shop_domain || first.domain || '',
        shop_url: vendorMeta?.shop_url || first.shop_url || first.url || '',
        shop_email: vendorMeta?.vendor_email || first.shop_email || first.email || '',
        shop_phone: vendorMeta?.vendor_phone || first.shop_phone || first.phone || '',
        vendor_company_name: vendorMeta?.vendor_company_name || first.vendor_company_name || first.vendor || '',
        vendor_contact_name: vendorMeta?.vendor_contact_name || first.vendor_contact_name || first.contact_name || '',
        language: first.language || first.iso_code || first.lang,
      };
    }
    const selectedShop = shops.find((s) => String(s.id_shop) === String(selectedShopId))
      || (autoShopMatchId ? { id_shop: Number(autoShopMatchId), name: autoShopMatchName || `ID ${autoShopMatchId}` } : null);
    const selectedLang = languages.find((l) => String(l.id_lang) === String(selectedLanguageId));
    if (selectedShop || selectedLang || autoShopEmail) {
      return {
        logo_url: vendorMeta?.logo_url || '',
        shop_domain: vendorMeta?.shop_domain || '',
        shop_url: vendorMeta?.shop_url || '',
        shop_email: vendorMeta?.vendor_email || autoShopEmail || '',
        shop_phone: vendorMeta?.vendor_phone || '',
        vendor_company_name: vendorMeta?.vendor_company_name || selectedShop?.name || '',
        vendor_contact_name: vendorMeta?.vendor_contact_name || '',
        language: selectedLang?.iso_code || selectedLang?.name || '',
      };
    }
    return null;
  }, [searchResults, shops, selectedShopId, languages, selectedLanguageId, autoShopEmail, vendorMeta]);

  useEffect(() => {
    const candidate = String(shopSummary?.shop_email || autoShopEmail || '').trim();
    const current = String(header.shop_email_text || '').trim();
    if (candidate && !current) {
      setHeader((prev) => ({ ...prev, shop_email_text: candidate }));
    }
  }, [shopSummary?.shop_email, autoShopEmail, header.shop_email_text]);

  const selectedLanguageIso = useMemo(() => {
    const selected = languages.find((lang) => String(lang.id_lang) === String(selectedLanguageId));
    return (selected?.iso_code || '').toLowerCase();
  }, [languages, selectedLanguageId]);

  const getDaysLabel = (isoCodeRaw, days) => {
    const iso = String(isoCodeRaw || '').toLowerCase();
    const n = Math.max(0, Math.trunc(Number(days) || 0));
    const code = iso === 'gb' ? 'en' : iso;
    if (code === 'fr') return n === 1 ? 'jour' : 'jours';
    if (code === 'en') return n === 1 ? 'day' : 'days';
    if (code === 'de') return n === 1 ? 'Tag' : 'Tage';
    if (code === 'es') return n === 1 ? 'día' : 'días';
    if (code === 'it') return n === 1 ? 'giorno' : 'giorni';
    if (code === 'nl') return n === 1 ? 'dag' : 'dagen';
    if (code === 'cs') return n === 1 ? 'den' : 'dní';
    return n === 1 ? 'day' : 'days';
  };

  const formatLeadTime = (daysValue, isoCode) => {
    const n = Math.max(0, Math.trunc(Number(daysValue) || 0));
    if (!n) return '';
    return `${n} ${getDaysLabel(isoCode, n)}`;
  };

  const parseLeadTimeDays = (text) => {
    const m = String(text || '').match(/(\d+)/);
    if (!m) return 0;
    const n = Number(m[1]);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  };

  const getVatRatioForProduct = (product) => {
    const ht = Number(product?.price_ht || 0);
    const ttc = Number(product?.price_ttc || 0);
    if (Number.isFinite(ht) && ht > 0 && Number.isFinite(ttc) && ttc > 0) {
      // If the source rounds TTC to an integer (common in `data_devis_*` views), prefer the standard VAT ratio.
      // This avoids propagating rounding artifacts (e.g. 50 instead of 49.99).
      if (Math.abs(ttc - Math.round(ttc)) < 1e-9) return 1.21;
      const ratio = ttc / ht;
      if (Number.isFinite(ratio) && ratio > 1.001) return ratio;
    }
    // Fallback: default VAT ratio used by existing `data_devis_*` views in this project.
    return 1.21;
  };

  const computeVariantPrices = (product, variant) => {
    const baseHt = Number(product?.price_ht || 0);
    const ratio = getVatRatioForProduct(product);
    const impactHt = Number(variant?.price_impact_ht || 0);
    const variantHtRaw = Number(variant?.price_ht || 0);
    const ht = Number.isFinite(variantHtRaw) && variantHtRaw > 0 ? variantHtRaw : (Number.isFinite(baseHt) ? baseHt : 0) + (Number.isFinite(impactHt) ? impactHt : 0);
    const ttc = ht * ratio;
    return {
      price_ht: Number.isFinite(ht) ? ht : 0,
      price_ttc: Number.isFinite(ttc) ? ttc : 0,
      reference: String(variant?.reference || product?.reference || '').trim(),
      label: String(variant?.label || '').trim(),
    };
  };

  const getUnitPrice = (item) => {
    const base = optionVat ? Number(item.price_ttc || 0) : Number(item.price_ht || 0);
    const raw = Number.isFinite(base) ? base : 0;
    const converted = raw * currencyRatio;
    return Number.isFinite(converted) ? converted : raw;
  };

  const getRoundedUnitPrice = (item) => (roundingPerLine ? applyRounding(getUnitPrice(item)) : getUnitPrice(item));

  const totalBeforeDiscount = useMemo(() => {
    return items.reduce((sum, item) => {
      const quantity = Math.max(0, Number(item.quantity) || 0);
      if (!quantity) return sum;
      return sum + getUnitPrice(item) * quantity;
    }, 0);
  }, [items, optionVat, currencyRatio]);

  const transportCost = Math.max(0, Number(header.transport_cost_text) || 0);

  const subtotalAfterDiscount = useMemo(() => {
    const sum = items.reduce((acc, item) => {
      const quantity = Math.max(0, Number(item.quantity) || 0);
      if (!quantity) return acc;
      const line = getUnitPrice(item) * quantity * (1 - discountPercent / 100);
      return acc + (roundingPerLine ? applyRounding(line) : line);
    }, 0);
    return sum;
  }, [items, discountPercent, roundingPerLine, optionVat, currencyRatio, roundingMethod]);

  const discountAmount = totalBeforeDiscount - subtotalAfterDiscount;
  const totalWithTransport = subtotalAfterDiscount + transportCost;
  const finalTotal =
    roundingScope === 'per_total' ? applyRounding(totalWithTransport) : totalWithTransport;

  const handleHeaderChange = (key, value) => {
    setHeader((prev) => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    const parsed = parseLeadTimeDays(header.delivery_lead_time_text);
    if (parsed && parsed !== deliveryLeadDays) setDeliveryLeadDays(parsed);
    if (!parsed && deliveryLeadDays && !String(header.delivery_lead_time_text || '').trim()) {
      // Keep state default when header is empty (common after resets).
      return;
    }
    if (!parsed && deliveryLeadDays === 0) return;
  }, [header.delivery_lead_time_text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const nextText = formatLeadTime(deliveryLeadDays, selectedLanguageIso);
    if (String(nextText) !== String(header.delivery_lead_time_text || '')) {
      setHeader((prev) => ({ ...prev, delivery_lead_time_text: nextText }));
    }
  }, [deliveryLeadDays, selectedLanguageIso]); // eslint-disable-line react-hooks/exhaustive-deps

  const getApiErrorMessage = (data, fallback) => {
    if (data?.message) return data.message;
    if (data?.error) return data.error;
    return fallback;
  };

  const handleProfileSelection = useCallback((value) => {
    const next = value || '';
    setSelectedProfileId(next);
    setShops([]);
    setSelectedShopId('');
    handleHeaderChange('id_shop_text', '');
    handleHeaderChange('shop_email_text', '');
    setShopsError('');
    setLanguages([]);
    setSelectedLanguageId('');
    setLanguageManuallySelected(false);
    handleHeaderChange('id_lang_text', '');
    setLanguagesError('');
    // Reset auto shop matching so a new profile can trigger a fresh lookup
    setAutoShopMatchId('');
    setAutoShopMatchName('');
    if (autoEmail || autoShopEmail) {
      setAutoShopPending(true);
    }
  }, [autoEmail, autoShopEmail]);

  const handleShopSelection = (value) => {
    const next = value || '';
    setSelectedShopId(next);
    handleHeaderChange('id_shop_text', next);
    handleHeaderChange('shop_email_text', '');
    setSearchResults([]);
    setSearchError('');
    setLanguages([]);
    setSelectedLanguageId('');
    setLanguageManuallySelected(false);
    handleHeaderChange('id_lang_text', '');
    setLanguagesError('');
    setCurrencies([]);
    setCurrenciesError('');
    setDefaultCurrencyIso('');
    setCurrenciesHasRate(true);
  };

  const handleShopSelectionFromUser = (value) => {
    // User intent should override any auto-matched shop.
    setAutoShopMatchId('');
    setAutoShopMatchName('');
    setAutoShopPending(false);
    handleShopSelection(value);
  };

  const setLanguageAndReset = (value, { manual = false } = {}) => {
    const next = value || '';
    setSelectedLanguageId(next);
    handleHeaderChange('id_lang_text', next);
    setSearchResults([]);
    setSearchError('');
    setCurrencies([]);
    setCurrenciesError('');
    setDefaultCurrencyIso('');
    setCurrenciesHasRate(true);
    if (manual) setLanguageManuallySelected(true);
  };

  const handleLanguageSelection = (value) => {
    setLanguageAndReset(value, { manual: true });
  };

  const loadProfiles = async () => {
    setProfileLoading(true);
    setProfileError('');
    try {
      const response = await fetch('/api/db-mysql/profiles?limit=200', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.ok) {
        const items = Array.isArray(data.items) ? data.items : [];
        setProfiles(items);
        if (!selectedProfileId && items.length) {
          handleProfileSelection(String(items[0].id));
        }
      } else {
        setProfiles([]);
        setProfileError(getApiErrorMessage(data, 'Impossible de charger les profils MySQL.'));
      }
    } catch (error) {
      setProfiles([]);
      setProfileError(error?.message || 'Erreur réseau');
    } finally {
      setProfileLoading(false);
    }
  };

  const loadShops = async (profileId) => {
    if (!profileId) return;
    setShopsLoading(true);
    setShopsError('');
    try {
      const params = new URLSearchParams({ profile_id: String(profileId) });
      const response = await fetch(`/api/product-search-index/mysql/shops?${params.toString()}`, { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.ok) {
        const sanitized = (Array.isArray(data.items) ? data.items : [])
          .map((row) => ({
            id_shop: Number(row?.id_shop ?? row?.id ?? 0),
            name: typeof row?.name === 'string' ? row.name : '',
          }))
          .filter((row) => Number.isFinite(row.id_shop) && row.id_shop > 0);
        setShops(sanitized);
        const match = sanitized.find((s) => String(s.id_shop) === String(autoShopMatchId));
        if (match) {
          handleShopSelection(String(match.id_shop));
          setAutoShopPending(false);
        } else if (autoShopMatchId) {
          // Match not in list: still select the matched id (option is injected)
          handleShopSelection(String(autoShopMatchId));
          setAutoShopPending(false);
        } else if (!selectedShopId && sanitized.length && !autoShopPending) {
          // Default shop: prefer id_shop=3 when available
          const preferred = sanitized.find((s) => String(s.id_shop) === DEFAULT_SHOP_ID);
          handleShopSelection(String(preferred ? preferred.id_shop : sanitized[0].id_shop));
        }
      } else {
        setShops([]);
        setShopsError(getApiErrorMessage(data, 'Impossible de charger les boutiques.'));
      }
    } catch (error) {
      setShops([]);
      setShopsError(error?.message || 'Erreur réseau');
    } finally {
      setShopsLoading(false);
    }
  };

  const loadLanguages = async (profileId, shopId) => {
    if (!profileId || !shopId) return;
    setLanguagesLoading(true);
    setLanguagesError('');
    try {
      const params = new URLSearchParams({
        profile_id: String(profileId),
        id_shop: String(shopId),
      });
      const response = await fetch(`/api/product-search-index/mysql/languages?${params.toString()}`, {
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.ok) {
        const rows = Array.isArray(data.items) ? data.items : [];
        const filtered = Array.from(
          new Map(
            rows
              .map((item) => {
                const id = Number(item?.id_lang ?? item?.id ?? item);
                const iso = typeof item?.iso_code === 'string' ? item.iso_code : '';
                return Number.isFinite(id) && id > 0
                  ? [id, { id_lang: id, name: typeof item?.name === 'string' ? item.name : '', iso_code: iso }]
                  : null;
              })
              .filter(Boolean)
          ).values()
        );

        setLanguages(filtered);

        const autoRaw = (autoLanguage || '').trim().toLowerCase();
        const autoCode = autoRaw.length === 2 ? autoRaw : '';
        const codeCandidates =
          autoCode === 'en' ? ['gb', 'en'] : autoCode === 'gb' ? ['gb', 'en'] : autoCode ? [autoCode] : [];
        const match =
          (codeCandidates.length
            ? filtered.find((lang) => lang.iso_code && codeCandidates.includes(lang.iso_code.toLowerCase()))
            : null) ||
          (!autoCode && autoRaw
            ? filtered.find((lang) => lang.name && lang.name.toLowerCase().includes(autoRaw))
            : null);

        setSelectedLanguageId((prev) => {
          const prevStr = prev ? String(prev) : '';
          const prevStillValid = prevStr && filtered.some((lang) => String(lang.id_lang) === prevStr);
          const next = prevStillValid
            ? prevStr
            : match
              ? String(match.id_lang)
              : filtered.length
                ? String(filtered[0].id_lang)
                : '';
          handleHeaderChange('id_lang_text', next);
          return next;
        });
      } else {
        setLanguages([]);
        setLanguagesError(getApiErrorMessage(data, 'Impossible de charger les langues.'));
      }
    } catch (error) {
      setLanguages([]);
      setLanguagesError(error?.message || 'Erreur réseau');
    } finally {
      setLanguagesLoading(false);
    }
  };

  const loadCurrencies = async (profileId, shopId, langId) => {
    if (!profileId || !shopId || !langId) return;
    setCurrenciesLoading(true);
    setCurrenciesError('');
    try {
      const params = new URLSearchParams({
        profile_id: String(profileId),
        id_shop: String(shopId),
        id_lang: String(langId),
      });
      if (orgFilter) params.set('org_id', orgFilter);
      const headers = {};
      if (orgFilter) headers['X-Org-Id'] = orgFilter;
      const response = await fetch(`/api/product-search-index/mysql/currencies?${params.toString()}`, {
        headers,
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.ok) {
        const items = (Array.isArray(data.items) ? data.items : [])
          .map((row) => ({
            id_currency: Number(row?.id_currency ?? row?.id_currency ?? 0),
            iso_code: typeof row?.iso_code === 'string' ? row.iso_code.toUpperCase() : '',
            sign: typeof row?.sign === 'string' ? row.sign : '',
            name: typeof row?.name === 'string' ? row.name : '',
            conversion_rate: row?.conversion_rate === null || row?.conversion_rate === undefined ? null : Number(row.conversion_rate),
          }))
          .filter((row) => row.iso_code);
        setCurrencies(items);
        setDefaultCurrencyIso(typeof data.default_iso === 'string' ? data.default_iso.toUpperCase() : '');
        setCurrenciesHasRate(data.has_conversion_rate !== false);
        const available = new Set(items.map((it) => it.iso_code));
        const current = String((header.currency_text || '')).toUpperCase();
        const defaultIso = typeof data.default_iso === 'string' ? data.default_iso.toUpperCase() : '';
        const next =
          (current && available.has(current) ? current : '') ||
          (defaultIso && available.has(defaultIso) ? defaultIso : '') ||
          (items[0]?.iso_code || 'EUR');
        if (next && next !== current) {
          setHeader((prev) => ({ ...prev, currency_text: next }));
        }
      } else {
        setCurrencies([]);
        setDefaultCurrencyIso('');
        setCurrenciesHasRate(true);
        setCurrenciesError(getApiErrorMessage(data, 'Impossible de charger les devises.'));
      }
    } catch (error) {
      setCurrencies([]);
      setDefaultCurrencyIso('');
      setCurrenciesHasRate(true);
      setCurrenciesError(error?.message || 'Erreur réseau');
    } finally {
      setCurrenciesLoading(false);
    }
  };

  useEffect(() => {
    loadProfiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedProfileId) return;
    if (!mysqlSetting.profileId) return;
    handleProfileSelection(String(mysqlSetting.profileId));
  }, [mysqlSetting.profileId, selectedProfileId, handleProfileSelection]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('tools_devis_prefill') || '{}');
      if (saved && typeof saved === 'object' && Object.keys(saved).length) {
        setHeader((prev) => ({ ...prev, ...saved }));
        setOrgFilter(saved.org_id || '');
        setAutoLanguage(saved.customer_language_text || saved.customer_language || '');
        setLanguageManuallySelected(false);
        setAutoEmail(saved.customer_email_text || '');
        setAutoShopEmail(saved.shop_email_text || '');
        setAutoMessageId(saved.message_id || '');
        setAutoShopPending(true);
        setAutoShopMatchId('');
        setAutoShopMatchName('');
        setSelectedShopId('');
        setSelectedLanguageId('');
        setShops([]);
        setLanguages([]);
        setCurrencies([]);
        setCurrenciesError('');
        setDefaultCurrencyIso('');
        setCurrenciesHasRate(true);
        localStorage.removeItem('tools_devis_prefill');
      }
    } catch {}
  }, []);

  useEffect(() => {
    const handler = (event) => {
      try {
        const saved = event?.detail || {};
        if (saved && typeof saved === 'object') {
          setHeader((prev) => ({ ...prev, ...saved }));
          if (saved.org_id) setOrgFilter(saved.org_id);
          setAutoLanguage(saved.customer_language_text || saved.customer_language || '');
          setLanguageManuallySelected(false);
          setAutoEmail(saved.customer_email_text || '');
          setAutoShopEmail(saved.shop_email_text || '');
          setAutoMessageId(saved.message_id || '');
          setAutoShopPending(true);
          setAutoShopMatchId('');
          setAutoShopMatchName('');
          setSelectedShopId('');
          setSelectedLanguageId('');
          setShops([]);
          setLanguages([]);
          setCurrencies([]);
          setCurrenciesError('');
          setDefaultCurrencyIso('');
          setCurrenciesHasRate(true);
        }
      } catch {}
    };
    window.addEventListener('tools-devis-prefill', handler);
    return () => window.removeEventListener('tools-devis-prefill', handler);
  }, []);

  useEffect(() => {
    const loadPromptConfigs = async () => {
      setPromptConfigsLoading(true);
      setPromptConfigsError('');
      try {
        const params = new URLSearchParams();
        params.set('limit', '200');
        if (orgFilter) params.set('org_id', orgFilter);
        const response = await fetch(`/api/automation-suite/prompt-configs?${params.toString()}`, { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data?.ok) {
          const items = Array.isArray(data.items) ? data.items : [];
          setPromptConfigs(items);
          // Auto-select saved or first
          if (!promptConfigId) {
            const saved = JSON.parse(localStorage.getItem('tools_devis_prompt_config') || '{}');
            const savedId = saved.promptConfigId || '';
            if (savedId && items.find((it) => it.id === savedId)) {
              setPromptConfigId(savedId);
              setPromptId(saved.promptId || '');
              setPromptVersion(saved.promptVersion || '');
            } else if (items.length) {
              setPromptConfigId(items[0].id || '');
              if (items[0].prompt_id) setPromptId(items[0].prompt_id);
              if (items[0].prompt_version) setPromptVersion(items[0].prompt_version);
            }
          }
          if (!langPromptConfigId) {
            const saved = JSON.parse(localStorage.getItem('tools_devis_lang_prompt_config') || '{}');
            const savedId = saved.promptConfigId || '';
            if (savedId && items.find((it) => it.id === savedId)) {
              setLangPromptConfigId(savedId);
              setLangPromptId(saved.promptId || '');
              setLangPromptVersion(saved.promptVersion || '');
            }
          }
        } else {
          setPromptConfigs([]);
          setPromptConfigsError(data?.message || data?.error || 'Impossible de charger les prompts.');
        }
      } catch (error) {
        setPromptConfigs([]);
        setPromptConfigsError(error?.message || 'Erreur réseau');
      } finally {
        setPromptConfigsLoading(false);
      }
    };
    loadPromptConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgFilter]);

  useEffect(() => {
    const loadLangPromptSetting = async () => {
      if (langPromptConfigId) return;
      try {
        const resp = await fetchDevisLanguagePromptSetting({ orgId: String(orgFilter || '').trim() || undefined });
        const configId = String(resp?.prompt_config_id || '').trim();
        if (configId) setLangPromptConfigId(configId);
      } catch {}
    };
    loadLangPromptSetting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgFilter, langPromptConfigId]);

  useEffect(() => {
    if (!langPromptConfigId || !promptConfigs.length) return;
    const found = promptConfigs.find((item) => item.id === langPromptConfigId);
    if (!found) return;
    if (found.prompt_id) setLangPromptId(found.prompt_id);
    if (found.prompt_version) setLangPromptVersion(found.prompt_version);
    if (!found.prompt_id) setLangPromptId('');
    if (!found.prompt_version) setLangPromptVersion('');
  }, [langPromptConfigId, promptConfigs]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('tools_devis_prompt_config') || '{}');
      if (saved.promptConfigId) setPromptConfigId(saved.promptConfigId);
      if (saved.promptId) setPromptId(saved.promptId);
      if (saved.promptVersion) setPromptVersion(saved.promptVersion);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('tools_devis_lang_prompt_config') || '{}');
      if (saved.promptConfigId) setLangPromptConfigId(saved.promptConfigId);
      if (saved.promptId) setLangPromptId(saved.promptId);
      if (saved.promptVersion) setLangPromptVersion(saved.promptVersion);
    } catch {}
  }, []);

  const savePromptConfig = () => {
    try {
      const payload = {
        promptConfigId: promptConfigId || '',
        promptId: promptId || '',
        promptVersion: promptVersion || '',
      };
      localStorage.setItem('tools_devis_prompt_config', JSON.stringify(payload));
      setPromptSavedMsg('Prompt config enregistrée pour la file devis.');
      setTimeout(() => setPromptSavedMsg(''), 2000);
    } catch {
      setPromptSavedMsg('Impossible de sauvegarder localement.');
    }
  };

  const saveLangPromptConfig = () => {
    try {
      const payload = {
        promptConfigId: langPromptConfigId || '',
        promptId: langPromptId || '',
        promptVersion: langPromptVersion || '',
      };
      localStorage.setItem('tools_devis_lang_prompt_config', JSON.stringify(payload));
      setLangPromptSavedMsg('Prompt config enregistrée pour la détection de langue.');
      setTimeout(() => setLangPromptSavedMsg(''), 2000);
    } catch {
      setLangPromptSavedMsg('Impossible de sauvegarder localement.');
    }
  };

  const handlePromptConfigSelection = (value) => {
    setPromptConfigId(value);
    const found = promptConfigs.find((item) => item.id === value);
    if (found) {
      if (found.prompt_id) setPromptId(found.prompt_id);
      if (found.prompt_version) setPromptVersion(found.prompt_version);
      if (!found.prompt_id) setPromptId('');
      if (!found.prompt_version) setPromptVersion('');
    } else {
      setPromptId('');
      setPromptVersion('');
    }
  };

  const handleLangPromptConfigSelection = (value) => {
    setLangPromptConfigId(value);
    const found = promptConfigs.find((item) => item.id === value);
    if (found) {
      if (found.prompt_id) setLangPromptId(found.prompt_id);
      if (found.prompt_version) setLangPromptVersion(found.prompt_version);
      if (!found.prompt_id) setLangPromptId('');
      if (!found.prompt_version) setLangPromptVersion('');
    } else {
      setLangPromptId('');
      setLangPromptVersion('');
    }
  };

  const promptConfigsOptions = promptConfigs.map((item) => ({
    id: item.id,
    label: item.name ? `${item.name} (${item.id})` : item.id,
    promptIdValue: item.prompt_id || '',
    promptVersionValue: item.prompt_version || '',
  }));

  useEffect(() => {
    if (!selectedProfileId) {
      setShops([]);
      return;
    }
    loadShops(selectedProfileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfileId]);

  useEffect(() => {
    if (!selectedProfileId || !selectedShopId) {
      setLanguages([]);
      return;
    }
    loadLanguages(selectedProfileId, selectedShopId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfileId, selectedShopId]);

  useEffect(() => {
    if (!selectedProfileId || !selectedShopId || !selectedLanguageId) {
      setCurrencies([]);
      setCurrenciesError('');
      return;
    }
    loadCurrencies(selectedProfileId, selectedShopId, selectedLanguageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfileId, selectedShopId, selectedLanguageId, orgFilter]);

  useEffect(() => {
    const tryMatchShop = async () => {
      const primaryEmail = autoShopEmail || '';
      if (!selectedProfileId || !autoShopPending) return;
      try {
        const params = new URLSearchParams();
        params.set('profile_id', String(selectedProfileId));
        if (autoMessageId) {
          params.set('message_id', String(autoMessageId));
          if (primaryEmail) params.set('email', String(primaryEmail));
        } else if (primaryEmail) {
          params.set('email', String(primaryEmail));
        }
        const resp = await fetch(`/api/tools/devis/shop-by-email?${params.toString()}`, { credentials: 'include' });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data?.ok && data.match && data.match.id_shop) {
          setAutoShopMatchId(String(data.match.id_shop));
          setAutoShopMatchName(data.match.name || '');
          handleShopSelection(String(data.match.id_shop));
        }
      } catch {} finally {
        setAutoShopPending(false);
      }
    };
    tryMatchShop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfileId, autoEmail, autoShopEmail, autoShopPending]);

  useEffect(() => {
    if (autoShopPending && selectedProfileId && !shops.length && !shopsLoading) {
      loadShops(selectedProfileId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoShopPending, selectedProfileId, shops.length, shopsLoading]);

  // Force reload shops once when prefill is pending, even if list is present
  useEffect(() => {
    if (autoShopPending && selectedProfileId && !shopsLoading) {
      loadShops(selectedProfileId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoShopPending, selectedProfileId]);

  useEffect(() => {
    // Apply auto-matched shop only if nothing is currently selected.
    if (autoShopMatchId && !selectedShopId) handleShopSelection(String(autoShopMatchId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoShopMatchId]);

  useEffect(() => {
    const auto = (autoLanguage || '').trim().toLowerCase();
    if (languageManuallySelected) return;
    if (!auto || !languages.length) return;
    const autoCode = auto.length === 2 ? auto : '';
    const codeCandidates =
      autoCode === 'en' ? ['gb', 'en'] : autoCode === 'gb' ? ['gb', 'en'] : autoCode ? [autoCode] : [];
    const match =
      (codeCandidates.length
        ? languages.find((lang) => lang.iso_code && codeCandidates.includes(lang.iso_code.toLowerCase()))
        : null) ||
      (!autoCode ? languages.find((lang) => lang.name && lang.name.toLowerCase().includes(auto)) : null);
    if (!match) return;
    const next = String(match.id_lang);
    if (String(selectedLanguageId || '') === next) return;
    setLanguageAndReset(next, { manual: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLanguage, languages, languageManuallySelected, selectedLanguageId]);

  useEffect(() => {
    const run = async () => {
      const messageId = String(autoMessageId || '').trim();
      if (!messageId) return;
      if ((autoLanguage || '').trim()) return;
      const promptCfgId = String(langPromptConfigId || '').trim();
      if (!promptCfgId) return;
      const key = `${messageId}:${promptCfgId}:${String(orgFilter || '').trim()}`;
      if (langDetectStatus.key === key) return;

      setLangDetectStatus({ key, loading: true, error: '' });
      const headers = { 'Content-Type': 'application/json' };
      if (orgFilter) headers['X-Org-Id'] = orgFilter;
      try {
        try {
          window.dispatchEvent(new CustomEvent('tools-devis-language-detecting', { detail: { message_id: messageId } }));
        } catch {}
        const resp = await fetch('/api/tools/devis/detect-language', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({ message_id: messageId, promptConfigId: promptCfgId }),
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data?.ok) {
          const iso = String(data.iso_code || '').trim().toLowerCase();
          if (iso) {
            setAutoLanguage(iso);
            try {
              window.dispatchEvent(new CustomEvent('tools-devis-language-detected', { detail: { message_id: messageId, iso_code: iso } }));
            } catch {}
          }
          setLangDetectStatus((prev) => ({ ...prev, loading: false, error: '' }));
        } else {
          const msg = data?.message || data?.error || 'Détection de langue impossible.';
          setLangDetectStatus((prev) => ({ ...prev, loading: false, error: msg }));
          try {
            window.dispatchEvent(new CustomEvent('tools-devis-language-detect-failed', { detail: { message_id: messageId, error: msg } }));
          } catch {}
        }
      } catch (e) {
        const msg = e?.message || 'Erreur réseau';
        setLangDetectStatus((prev) => ({ ...prev, loading: false, error: msg }));
        try {
          window.dispatchEvent(new CustomEvent('tools-devis-language-detect-failed', { detail: { message_id: messageId, error: msg } }));
        } catch {}
      }
    };
    run();
  }, [autoMessageId, autoLanguage, langPromptConfigId, orgFilter, langDetectStatus.key]);

  const handleSearch = async (overrideQuery) => {
    if (!selectedProfileId || !selectedShopId || !selectedLanguageId) {
      setSearchResults([]);
      setSearchError('Sélectionnez un profil, une boutique et une langue avant de lancer la recherche.');
      return;
    }
    const effectiveOverride =
      typeof overrideQuery === 'string' || typeof overrideQuery === 'number'
        ? String(overrideQuery)
        : '';
    const query = String(effectiveOverride || searchTerm || '').trim();
    setSearching(true);
    setSearchError('');
    const params = new URLSearchParams();
    params.set('profile_id', selectedProfileId);
    params.set('id_shop', selectedShopId);
    params.set('id_lang', selectedLanguageId);
    params.set('search', query);
    params.set('include_accessories', '1');
    params.set('limit', '12');
    if (orgFilter) params.set('org_id', orgFilter);
    const headers = {};
    if (orgFilter) headers['X-Org-Id'] = orgFilter;

    try {
      const response = await fetch(`/api/tools/devis/data?${params.toString()}`, {
        headers,
        credentials: 'include',
      });
      const isJson = (response.headers.get('content-type') || '').toLowerCase().includes('application/json');
      const data = isJson ? await response.json() : null;
      if (response.ok && data?.ok) {
        setSearchResults(Array.isArray(data.items) ? data.items : []);
        setSelectedVariantByProductId({});
        setSearchError('');
      } else {
        setSearchResults([]);
        setSelectedVariantByProductId({});
        const text = !isJson ? await response.text().catch(() => '') : '';
        setSearchError(
          data?.message ||
            data?.error ||
            (text ? `Serveur: ${text.slice(0, 200)}` : 'Impossible de récupérer les produits.')
        );
      }
    } catch (error) {
      setSearchResults([]);
      setSearchError(error?.message || 'Erreur réseau');
    } finally {
      setSearching(false);
    }
  };

  const makeLineId = (productId, variantId) => `${String(productId || '')}:${String(variantId || 0)}`;

  const resolveSelectedVariant = (product) => {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    if (!variants.length) return null;
    const key = String(product?.id || '');
    const pickedId = selectedVariantByProductId[key];
    if (pickedId) {
      const found = variants.find((v) => String(v?.id) === String(pickedId));
      if (found) return found;
    }
    return variants.find((v) => v?.default_on) || variants[0] || null;
  };

  const addProduct = (product, variant = null) => {
    const resolvedVariant = variant || resolveSelectedVariant(product);
    const computed = resolvedVariant ? computeVariantPrices(product, resolvedVariant) : null;
    const productId = Number(product?.id || 0);
    const variantId = resolvedVariant?.id ? Number(resolvedVariant.id) : 0;
    const lineId = makeLineId(productId, variantId);
    const baseHt = Number(product?.price_ht || 0);
    const ratio = getVatRatioForProduct(product);
    const baseTtcComputed = (Number.isFinite(baseHt) ? baseHt : 0) * ratio;
    const next = {
      ...product,
      line_id: lineId,
      variant_id: variantId || null,
      variant_label: computed?.label || (resolvedVariant?.label ? String(resolvedVariant.label) : ''),
      reference: computed?.reference || (resolvedVariant?.reference || product?.reference || '').trim(),
      price_ht: computed ? computed.price_ht : Number(product?.price_ht || 0),
      price_ttc: computed
        ? computed.price_ttc
        : (Number.isFinite(baseTtcComputed) && baseTtcComputed > 0 ? baseTtcComputed : Number(product?.price_ttc || 0)),
    };

    setItems((prev) => {
      const existing = prev.find((item) => String(item.line_id || makeLineId(item.id, item.variant_id || 0)) === lineId);
      if (existing) {
        return prev.map((item) =>
          String(item.line_id || makeLineId(item.id, item.variant_id || 0)) === lineId
            ? { ...item, quantity: Math.max(0, Number(item.quantity || 0)) + 1 }
            : item
        );
      }
      return [
        ...prev,
        {
          ...next,
          quantity: 1,
        },
      ];
    });
  };

  const updateQuantity = (lineId, quantity) => {
    setItems((prev) =>
      prev.map((item) => (String(item.line_id) === String(lineId) ? { ...item, quantity: Number(quantity) } : item))
    );
  };

  const removeItem = (lineId) => {
    setItems((prev) => prev.filter((item) => String(item.line_id) !== String(lineId)));
  };

  const clearItems = () => {
    setItems([]);
  };

  const quoteDate = formatQuoteDate(header.date_devis_text);
  const previewGreeting = header.customer_name_text
    ? `Bonjour ${header.customer_name_text},`
    : 'Bonjour,';
  const previewIntro = header.remarques_text
    ? header.remarques_text
    : 'Pour donner suite à notre échange, voici le devis correspondant aux éléments demandés.';
  const canGenerateOffer = items.length > 0 && selectedProfileId && selectedShopId && selectedLanguageId;

  const getLineTotal = (item) => {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    if (!quantity) return 0;
    return getUnitPrice(item) * quantity * (1 - discountPercent / 100);
  };
  const getVisibleLineTotal = (item) => (roundingPerLine ? applyRounding(getLineTotal(item)) : getLineTotal(item));

  const quotePreviewItems = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        variant_id: item.variant_id || null,
        variant_label: item.variant_label || '',
        reference: item.reference || item.product_reference || item.product_id || '',
        name: (item.name || item.product_name || '') + (item.variant_label ? ` — ${item.variant_label}` : ''),
        description: item.description_short || item.description || '',
        quantity: Math.max(0, Number(item.quantity) || 0),
        unitPrice: getRoundedUnitPrice(item),
        totalLine: getVisibleLineTotal(item),
        productLink: item.product_url || item.link_product || '',
        image: item.image_url || item.link_image_product || '',
      })),
    [items, optionVat, discountPercent, roundingPerLine, currencyRatio, roundingMethod]
  );
  const payloadHeader = useMemo(
    () => ({
      customer_email: header.customer_email_text || '',
      customer_name: header.customer_name_text || '',
      customer_company: header.customer_company_text || '',
      delivery_lead_time: header.delivery_lead_time_text || '',
      transport_by: header.transport_by_text || '',
      transport_cost: Number(header.transport_cost_text || 0),
      option_vat: header.Option_VAT_text || 'YES',
      option_discount: Math.max(0, Number(header.Option_Discount_text) || 0),
      currency: (header.currency_text || 'EUR').toUpperCase(),
      remarks: header.remarques_text || '',
      quote_number: header.devis_number_text || '',
      date: header.date_devis_text || '',
      vendor_company_name: shopSummary?.vendor_company_name || shopSummary?.shop_domain || '',
      vendor_contact_name: shopSummary?.vendor_contact_name || '',
      vendor_email: header.shop_email_text || shopSummary?.shop_email || '',
      vendor_phone: shopSummary?.shop_phone || '',
      shop_email: header.shop_email_text || shopSummary?.shop_email || '',
      shop_domain: shopSummary?.shop_domain || '',
      shop_url: shopSummary?.shop_url || '',
      logo_url: vendorMeta?.logo_url || shopSummary?.logo_url || '',
      quote_title: shopSummary?.shop_domain || shopSummary?.vendor_company_name || '',
      lang_iso_code: selectedLanguageIso || '',
    }),
    [header, shopSummary, selectedLanguageIso, vendorMeta]
  );
  const totalsPayload = useMemo(
    () => ({
      totalBeforeDiscount,
      subtotalAfterDiscount,
      transportCost,
      grandTotal: finalTotal,
    }),
    [totalBeforeDiscount, subtotalAfterDiscount, transportCost, finalTotal]
  );


  const handleGenerateOffer = async () => {
    if (!selectedProfileId || !selectedShopId || !selectedLanguageId) {
      setOfferError('Sélectionnez un profil, une boutique et une langue avant d’enregistrer le devis.');
      return;
    }
    if (!items.length) {
      setOfferError('Ajoutez au moins un produit à la colonne Articles.');
      return;
    }
    setOfferLoading(true);
    setOfferError('');
    setOfferMessage('');
    try {
      const payload = {
        profileId: Number(selectedProfileId),
        shopId: Number(selectedShopId),
        langId: Number(selectedLanguageId),
        header: payloadHeader,
        totals: totalsPayload,
        items: quotePreviewItems,
      };
      const headers = {
        'Content-Type': 'application/json',
      };
      if (orgFilter) {
        headers['X-Org-Id'] = orgFilter;
      }
      const response = await fetch('/api/tools/devis/offers/email', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.ok) {
        const quoteNumber = data?.offer?.quote_number;
        if (quoteNumber) {
          setHeader((prev) => ({ ...prev, devis_number_text: quoteNumber }));
          const emailStatus = data?.email?.message || (data?.email?.status === 'draft_created'
            ? 'Brouillon Gmail créé avec pièce jointe.'
            : '');
          setOfferMessage(`Devis ${quoteNumber} généré.${emailStatus ? ' ' + emailStatus : ''}`);
        } else {
          setOfferMessage('Devis enregistré.');
        }
        setOfferError('');
      } else {
        setOfferMessage('');
        setOfferError(data?.message || data?.error || 'Impossible d’enregistrer le devis.');
      }
    } catch (error) {
      setOfferMessage('');
      setOfferError(error?.message || 'Erreur réseau');
    } finally {
      setOfferLoading(false);
    }
  };

  useEffect(() => {
    if (!canGenerateOffer) {
      setPreviewHtml('');
      setPreviewError('');
      setPreviewLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    const debounceMs = 450;
    const payload = {
      profileId: Number(selectedProfileId),
      shopId: Number(selectedShopId),
      langId: Number(selectedLanguageId),
      header: payloadHeader,
      totals: totalsPayload,
      items: quotePreviewItems,
    };
    const headers = {
      'Content-Type': 'application/json',
    };
    if (orgFilter) {
      headers['X-Org-Id'] = orgFilter;
    }
    setPreviewLoading(true);
    setPreviewError('');
    const timer = setTimeout(() => (async () => {
      try {
        const response = await fetch('/api/tools/devis/offers/preview', {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (response.ok && data?.ok && data.html) {
          setPreviewHtml(data.html);
          setPreviewError('');
        } else if (response.ok && data?.ok) {
          setPreviewHtml(data.html || '');
          setPreviewError(data.html ? '' : 'Aperçu vide');
        } else {
          setPreviewHtml('');
          setPreviewError(data?.message || data?.error || 'Impossible de générer l’aperçu.');
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setPreviewHtml('');
          setPreviewError(error?.message || 'Erreur réseau');
        }
      } finally {
        if (!controller.signal.aborted) {
          setPreviewLoading(false);
        }
      }
    })(), debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    canGenerateOffer,
    payloadHeader,
    totalsPayload,
    quotePreviewItems,
    selectedProfileId,
    selectedShopId,
    selectedLanguageId,
    orgFilter,
  ]);

  const formattedHeaderLabel = header.customer_name_text
    ? `${header.customer_name_text} (${header.customer_company_text || 'Entreprise'})`
    : 'Entête du devis';

  return (
    <div className="p-4 space-y-4">
      <div className="panel">
        <div className="panel__header">{formattedHeaderLabel}</div>
        <div className="panel__body">
          <div className="grid gap-4">
            <div className="space-y-4 rounded border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-gray-500">
                <span>Sources PrestaShop (db-mysql)</span>
                <span className="text-[11px] text-gray-400">ps_shop · ps_lang</span>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Profil MySQL</label>
                  <select
                    className="mt-1 w-full rounded border px-2 py-1 text-sm bg-[#e8ffd8] border-[#7ed957]"
                    value={selectedProfileId}
                    onChange={(event) => handleProfileSelection(event.target.value)}
                    disabled={profileLoading}
                  >
                    <option value="">{profileLoading ? 'Chargement…' : 'Choisissez un profil db-mysql'}</option>
                    {profiles.map((profile) => (
                      <option key={`profile-${profile.id}`} value={String(profile.id)}>
                        {profile.name ? `${profile.name} (ID ${profile.id})` : `Profil ${profile.id}`}
                      </option>
                    ))}
                  </select>
                  <p className={`text-[11px] ${profileError ? 'text-red-600' : 'text-gray-500'}`}>
                    {profileError || 'Profil utilisé pour interroger ps_shop et ps_lang.'}
                  </p>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Shop (ps_shop)</label>
                  <select
                    className="mt-1 w-full rounded border px-2 py-1 text-sm bg-[#e8ffd8] border-[#7ed957]"
                    value={selectedShopId}
                    onChange={(event) => handleShopSelectionFromUser(event.target.value)}
                    disabled={!selectedProfileId || shopsLoading}
                  >
                    <option value="">{shopsLoading ? 'Chargement…' : 'Sélectionnez une boutique'}</option>
                    {shops.map((shop) => (
                      <option key={`shop-${shop.id_shop}`} value={String(shop.id_shop)}>
                        {shop.name ? `${shop.name} (ID ${shop.id_shop})` : `ID ${shop.id_shop}`}
                      </option>
                    ))}
                    {autoShopMatchId && !shops.find((s) => String(s.id_shop) === String(autoShopMatchId)) && (
                      <option value={autoShopMatchId}>
                        {autoShopMatchName ? `${autoShopMatchName} (ID ${autoShopMatchId})` : `ID ${autoShopMatchId} (match email)`}
                      </option>
                    )}
                  </select>
                  <p className={`text-[11px] ${shopsError ? 'text-red-600' : 'text-gray-500'}`}>
                    {shopsError || (autoShopMatchId ? 'Boutique préselectionnée via PS_SHOP_EMAIL.' : 'Boutiques disponibles pour ce profil db-mysql.')}
                  </p>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Langue (ps_lang / ps_lang_shop)</label>
                  <select
                    className="mt-1 w-full rounded border px-2 py-1 text-sm bg-[#e8ffd8] border-[#7ed957]"
                    value={selectedLanguageId}
                    onChange={(event) => handleLanguageSelection(event.target.value)}
                    disabled={!selectedShopId || languagesLoading || !languages.length}
                  >
                    <option value="">{languagesLoading ? 'Chargement…' : 'Sélectionnez un ID langue'}</option>
                    {languages.map((lang) => (
                      <option key={`lang-${lang.id_lang}`} value={String(lang.id_lang)}>
                        {lang.name ? `${lang.name} (ID ${lang.id_lang})` : `ID ${lang.id_lang}`}
                      </option>
                    ))}
                  </select>
                  <p className={`text-[11px] ${languagesError ? 'text-red-600' : 'text-gray-500'}`}>
                    {languagesError || 'Langues actives pour la boutique.'}
                  </p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {HEADER_INPUTS.map((field) => (
                  <div key={field.key}>
                    <label className="text-[11px] font-semibold uppercase text-gray-500">{field.label}</label>
                    {field.key === 'delivery_lead_time_text' ? (
                      <div className="mt-1 flex items-center gap-2">
                        <input
                          className="w-full rounded border px-2 py-1 text-sm bg-[#fbffc8] border-[#a8ff5f]"
                          type="number"
                          min="0"
                          max="365"
                          step="1"
                          value={deliveryLeadDays}
                          onChange={(event) => setDeliveryLeadDays(Math.max(0, Math.trunc(Number(event.target.value) || 0)))}
                        />
                        <div className="shrink-0 text-[12px] text-gray-600">
                          {getDaysLabel(selectedLanguageIso, deliveryLeadDays)}
                        </div>
                      </div>
                    ) : field.key === 'currency_text' ? (
                      <>
                        <select
                          className="mt-1 w-full rounded border px-2 py-1 text-sm bg-[#fbffc8] border-[#a8ff5f]"
                          value={header[field.key]}
                          onChange={(event) => handleHeaderChange(field.key, event.target.value)}
                          disabled={!currencies.length || currenciesLoading}
                        >
                          <option value="">
                            {currenciesLoading ? 'Chargement…' : currencies.length ? 'Sélectionnez une devise' : 'Aucune devise'}
                          </option>
                          {currencies.map((cur) => (
                            <option key={`${cur.iso_code}-${cur.id_currency}`} value={cur.iso_code}>
                              {cur.iso_code}{cur.name ? ` — ${cur.name}` : ''}{cur.sign ? ` (${cur.sign})` : ''}
                            </option>
                          ))}
                        </select>
                        <p className={`text-[11px] ${currenciesError ? 'text-red-600' : 'text-gray-500'}`}>
                          {currenciesError ||
                            (currenciesHasRate
                              ? 'Devises actives pour la boutique (ps_currency / ps_currency_shop).'
                              : 'Devises actives (ps_currency.conversion_rate indisponible).')}
                        </p>
                      </>
                    ) : field.type === 'select' ? (
                      <select
                        className="mt-1 w-full rounded border px-2 py-1 text-sm bg-[#fbffc8] border-[#a8ff5f]"
                        value={header[field.key]}
                        onChange={(event) => handleHeaderChange(field.key, event.target.value)}
                      >
                        {field.options?.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="mt-1 w-full rounded border px-2 py-1 text-sm bg-[#fbffc8] border-[#a8ff5f]"
                        type={field.type}
                        placeholder={field.placeholder}
                        value={header[field.key]}
                        onChange={(event) => handleHeaderChange(field.key, event.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-[11px] font-semibold uppercase text-gray-500">Mode d'arrondi</label>
                  <select
                    className="mt-1 w-full rounded border px-2 py-1 text-sm bg-[#fff7bf] border-[#f7df45]"
                    value={header.rounding_method}
                    onChange={(event) => handleHeaderChange('rounding_method', event.target.value)}
                  >
                    {ROUNDING_METHODS.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-gray-500">Arrondis à l’entier selon la méthode choisie.</p>
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase text-gray-500">Type d'arrondi</label>
                  <select
                    className="mt-1 w-full rounded border px-2 py-1 text-sm bg-[#fff7bf] border-[#f7df45]"
                    value={header.rounding_scope}
                    onChange={(event) => handleHeaderChange('rounding_scope', event.target.value)}
                  >
                    {ROUNDING_SCOPES.map((scope) => (
                      <option key={scope.id} value={scope.id}>
                        {scope.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-gray-500">Appliquer l'arrondi aux lignes ou au total.</p>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold uppercase text-gray-500">Remarques</label>
                <textarea
                  className="mt-1 w-full rounded border px-2 py-2 text-sm min-h-[90px] bg-[#fff7bf] border-[#f7df45]"
                  placeholder="Notes commerciales, conditions, options..."
                  value={header.remarques_text}
                  onChange={(event) => handleHeaderChange('remarques_text', event.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel space-y-3">
        <div className="panel__header">Produits & recherche</div>
        <div className="panel__body space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
            <div>
              Profil: <span className="font-mono">{selectedProfileId || '—'}</span>
            </div>
            <div>
              id_shop: <span className="font-mono">{selectedShopId || '—'}</span>
            </div>
            <div>
              id_lang: <span className="font-mono">{selectedLanguageId || '—'}</span>
            </div>
            <div>
              iso: <span className="font-mono">{selectedLanguageIso || '—'}</span>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-[1.5fr_1fr]">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Rechercher un produit
              </label>
              <input
                className="mt-1 w-full border rounded px-2 py-1 text-sm"
                type="search"
                placeholder="Référence, nom ou ID"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleSearch();
                  }
                }}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Org ID (X-Org-Id, optionnel)
              </label>
              <input
                className="mt-1 w-full border rounded px-2 py-1 text-sm"
                type="text"
                placeholder="ex: primary-company"
                value={orgFilter}
                onChange={(event) => setOrgFilter(event.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="px-3 py-1 rounded border bg-white text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => handleSearch()}
              disabled={searching}
            >
              {searching ? 'Recherche…' : 'Lancer la recherche'}
            </button>
            <span className="text-xs text-gray-500">{searchError || 'Utilisez au moins 2 caractères.'}</span>
          </div>
          <div className="border rounded divide-y">
            {searchResults.length > 0 ? (
              searchResults.map((product) => {
                const variants = Array.isArray(product?.variants) ? product.variants : [];
                const selectedVariant = resolveSelectedVariant(product);
                const computed = selectedVariant ? computeVariantPrices(product, selectedVariant) : null;
                const ratio = getVatRatioForProduct(product);
                const baseHt = Number(product?.price_ht || 0);
                const baseTtc = (Number.isFinite(baseHt) ? baseHt : 0) * ratio;
                const priceSource = computed || {
                  price_ht: Number(product?.price_ht || 0),
                  price_ttc: Number.isFinite(baseTtc) && baseTtc > 0 ? baseTtc : Number(product?.price_ttc || 0),
                };
                const displayPrice = optionVat ? Number(priceSource?.price_ttc || 0) : Number(priceSource?.price_ht || 0);
                const key = String(product?.id || '');
                const selectValue = selectedVariantByProductId[key] || (selectedVariant?.id ? String(selectedVariant.id) : '');

                return (
                <div key={product.id}>
                  <div className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-50">
                    <div>
                      <div className="text-sm font-semibold">{product.name}</div>
                      <div className="text-xs text-gray-500">
                        {product.reference || `ID ${product.product_id || product.id}`}
                      </div>
                      {variants.length > 0 && (
                        <div className="mt-1">
                          <select
                            className="border rounded px-2 py-1 text-xs bg-white"
                            value={selectValue}
                            onChange={(event) => {
                              const nextId = String(event.target.value || '');
                              setSelectedVariantByProductId((prev) => ({ ...prev, [key]: nextId }));
                            }}
                          >
                            {variants.map((v) => {
                              const computedV = computeVariantPrices(product, v);
                              const vPrice = optionVat ? Number(computedV?.price_ttc || 0) : Number(computedV?.price_ht || 0);
                              const priceLabel = formatCurrency(vPrice * currencyRatio, currencyCode);
                              const label = [String(v?.label || '').trim(), String(v?.reference || '').trim()].filter(Boolean).join(' · ');
                              return (
                                <option key={`variant-${product.id}-${v.id}`} value={String(v.id)}>
                                  {label || `Attribut #${v.id}`} — {priceLabel}
                                </option>
                              );
                            })}
                          </select>
                        </div>
                      )}
                      <div className="text-xs text-gray-500">
                        {formatCurrency(
                          displayPrice * currencyRatio,
                          currencyCode
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-xs px-3 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
                      onClick={() => addProduct(product, selectedVariant)}
                    >
                      Ajouter
                    </button>
                  </div>
                  {Array.isArray(product.accessories) && product.accessories.length > 0 && (
                    <div className="border-t bg-gray-50/40">
                      <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide font-semibold bg-amber-100/70 text-amber-900">
                        Accessoires ({product.accessories.length})
                      </div>
                      <div className="divide-y">
                        {product.accessories.map((acc) => (
                          (() => {
                            const accVariants = Array.isArray(acc?.variants) ? acc.variants : [];
                            const selectedAccVariant = resolveSelectedVariant(acc);
                            const computedAcc = selectedAccVariant ? computeVariantPrices(acc, selectedAccVariant) : null;
                            const accRatio = getVatRatioForProduct(acc);
                            const accBaseHt = Number(acc?.price_ht || 0);
                            const accBaseTtc = (Number.isFinite(accBaseHt) ? accBaseHt : 0) * accRatio;
                            const accPriceSource = computedAcc || {
                              price_ht: Number(acc?.price_ht || 0),
                              price_ttc: Number.isFinite(accBaseTtc) && accBaseTtc > 0 ? accBaseTtc : Number(acc?.price_ttc || 0),
                            };
                            const accDisplayPrice = optionVat ? Number(accPriceSource?.price_ttc || 0) : Number(accPriceSource?.price_ht || 0);
                            const accKey = String(acc?.id || '');
                            const accSelectValue = selectedVariantByProductId[accKey] || (selectedAccVariant?.id ? String(selectedAccVariant.id) : '');
                            return (
                              <div
                                key={`acc-${product.id}-${acc.id}`}
                                className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-50"
                              >
                                <div>
                                  <div className="text-sm font-medium text-gray-800">{acc.name}</div>
                                  <div className="text-xs text-gray-500">
                                    {acc.reference || `ID ${acc.product_id || acc.id}`}
                                  </div>
                                  {accVariants.length > 0 && (
                                    <div className="mt-1">
                                      <select
                                        className="border rounded px-2 py-1 text-xs bg-white"
                                        value={accSelectValue}
                                        onChange={(event) => {
                                          const nextId = String(event.target.value || '');
                                          setSelectedVariantByProductId((prev) => ({ ...prev, [accKey]: nextId }));
                                        }}
                                      >
                                        {accVariants.map((v) => {
                                          const computedV = computeVariantPrices(acc, v);
                                          const vPrice = optionVat ? Number(computedV?.price_ttc || 0) : Number(computedV?.price_ht || 0);
                                          const priceLabel = formatCurrency(vPrice * currencyRatio, currencyCode);
                                          const label = [String(v?.label || '').trim(), String(v?.reference || '').trim()].filter(Boolean).join(' · ');
                                          return (
                                            <option key={`variant-${acc.id}-${v.id}`} value={String(v.id)}>
                                              {label || `Attribut #${v.id}`} — {priceLabel}
                                            </option>
                                          );
                                        })}
                                      </select>
                                    </div>
                                  )}
                                  <div className="text-xs text-gray-500">
                                    {formatCurrency(
                                      accDisplayPrice * currencyRatio,
                                      currencyCode
                                    )}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  className="text-xs px-3 py-1 rounded border border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
                                  onClick={() => addProduct(acc, selectedAccVariant)}
                                >
                                  Ajouter
                                </button>
                              </div>
                            );
                          })()
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                );
              })
            ) : (
              <div className="px-3 py-2 text-xs text-gray-500">{searching ? 'Chargement…' : 'Aucun résultat.'}</div>
            )}
          </div>
          {shopSummary && (
            <div className="border rounded px-3 py-2 bg-white text-xs space-y-1 text-gray-600">
              <div className="flex items-center gap-3">
                {shopSummary.logo_url ? (
                  <img src={shopSummary.logo_url} alt="Logo" className="h-10 w-10 object-contain rounded-sm border" />
                ) : (
                  <div className="h-10 w-10 rounded-sm border bg-gray-100 flex items-center justify-center text-[10px] uppercase text-gray-400">
                    logo
                  </div>
                )}
                <div>
                  <div className="font-semibold text-sm text-gray-800">
                    {shopSummary.vendor_company_name || shopSummary.shop_domain || 'Fiche PrestaShop'}
                  </div>
                  {shopSummary.vendor_contact_name && <div>Contact: {shopSummary.vendor_contact_name}</div>}
                  {shopSummary.language && <div>Langue active: {shopSummary.language}</div>}
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                {shopSummary.shop_domain && (
                  <div>
                    Domaine: <span className="font-semibold text-gray-800">{shopSummary.shop_domain}</span>
                  </div>
                )}
                {shopSummary.shop_email && (
                  <div>
                    Email: <span className="font-semibold text-gray-800">{shopSummary.shop_email}</span>
                  </div>
                )}
                {shopSummary.shop_phone && (
                  <div>
                    Tel: <span className="font-semibold text-gray-800">{shopSummary.shop_phone}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="panel space-y-3">
        <div className="panel__header flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span>Articles ({items.length})</span>
            <span className="text-[11px] text-gray-500">{optionVat ? 'TTC' : 'HT'}</span>
            {discountPercent > 0 && (
              <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] bg-amber-50 text-amber-800 border border-amber-100">
                Remise {discountPercent.toFixed(0)}%
              </span>
            )}
          </div>
          <button
            type="button"
            className="text-xs px-3 py-1 rounded border bg-white hover:bg-gray-50"
            onClick={clearItems}
            disabled={!items.length}
          >
            Vider la liste
          </button>
        </div>
        <div className="panel__body space-y-3">
          {items.length === 0 && (
            <div className="text-sm text-gray-500">Ajoutez un produit depuis la recherche ci-dessus.</div>
          )}
          {items.map((item) => (
            <div key={item.line_id || `${item.id}:${item.variant_id || 0}`} className="border rounded p-3 bg-white shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row">
                <div className="w-full md:w-32 h-24 flex items-center justify-center rounded border bg-gray-50 overflow-hidden">
                  {item.image_url ? (
                    <img
                      className="h-full w-full object-cover"
                      src={item.image_url}
                      alt={item.name || ''}
                    />
                  ) : (
                    <span className="text-[11px] text-gray-400 uppercase">Pas d’image</span>
                  )}
                </div>
                <div className="flex-1 space-y-1 text-sm">
                  <div className="font-semibold">{item.name}</div>
                  <div className="text-xs text-gray-600">{item.reference}</div>
                  {item.variant_label && (
                    <div className="text-xs text-gray-500">{item.variant_label}</div>
                  )}
                  {item.description_short && (
                    <div
                      className="text-xs text-gray-500 overflow-hidden"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.description_short) }}
                    />
                  )}
                  {item.product_url && (
                    <a className="text-xs text-blue-600" href={item.product_url} target="_blank" rel="noreferrer">
                      Voir la fiche
                    </a>
                  )}
                </div>
                <div className="grid gap-2 text-sm w-full md:w-[220px]">
                  <div>
                    <label className="text-[11px] uppercase text-gray-500">Quantité</label>
                    <input
                      className="mt-1 w-full border rounded px-2 py-1 text-sm"
                      type="number"
                      min="0"
                      value={item.quantity}
                      onChange={(event) => updateQuantity(item.line_id || `${item.id}:${item.variant_id || 0}`, Math.max(0, Number(event.target.value) || 0))}
                    />
                  </div>
                  <div className="text-xs text-gray-500">Prix unitaire</div>
                  <div className="text-sm font-semibold">
                    {formatCurrency(getRoundedUnitPrice(item), currencyCode)}
                  </div>
                  <div className="text-xs text-gray-500">Total ligne</div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">
                      {formatCurrency(getVisibleLineTotal(item), currencyCode)}
                    </span>
                    <button
                      type="button"
                      className="text-[11px] px-2 py-1 rounded bg-red-50 text-red-700 border border-red-100 hover:bg-red-100"
                      onClick={() => removeItem(item.line_id || `${item.id}:${item.variant_id || 0}`)}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel__header">Aperçu du devis</div>
        <div className="panel__body space-y-4 text-[12px] leading-relaxed">
          <p className="text-gray-600">{previewGreeting}</p>
          <p className="italic text-gray-500">{previewIntro}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="px-3 py-1 rounded border bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              onClick={handleGenerateOffer}
              disabled={offerLoading || !canGenerateOffer}
            >
              {offerLoading ? 'Enregistrement…' : 'Générer le devis'}
            </button>
            {offerMessage && <span className="text-[11px] text-green-700">{offerMessage}</span>}
            {offerError && <span className="text-[11px] text-red-600">{offerError}</span>}
          </div>
          <div className="border rounded-md bg-white">
            <div className="border-b px-4 py-3 text-[11px] text-gray-500">
              {previewLoading
                ? 'Génération de l’aperçu…'
                : previewError
                ? previewError
                : previewHtml
                ? 'Aperçu du mail généré'
                : 'Ajoutez un produit pour générer l’aperçu.'}
            </div>
            {previewHtml ? (
              <div
                className="p-4 overflow-auto text-[12px] leading-relaxed"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <div className="p-4 space-y-3 text-[11px]">
                <div className="grid gap-3 border-b p-4 md:grid-cols-[1.4fr_1fr]">
                  <div className="space-y-2">
                    <div className="font-semibold text-sm">Informations sur le client</div>
                    {header.customer_name_text && <div>Nom du client : {header.customer_name_text}</div>}
                    {header.customer_company_text && <div>Société : {header.customer_company_text}</div>}
                    {header.customer_email_text && <div>Email du client : {header.customer_email_text}</div>}
                  </div>
                  <div className="space-y-2">
                    <div className="font-semibold text-sm">Numéro de devis</div>
                    <div className="text-lg font-semibold">{header.devis_number_text || '- - -'}</div>
                    {quoteDate && <div>Date : {quoteDate}</div>}
                    <div className="pt-2 font-semibold text-sm">Informations sur le vendeur</div>
                    <div className="text-sm">Domaine : {shopSummary?.shop_domain || shopSummary?.domain || '—'}</div>
                    <div className="text-sm">Contact : {shopSummary?.vendor_contact_name || '—'}</div>
                    <div className="text-sm">Email : {shopSummary?.shop_email || '—'}</div>
                    <div className="text-sm">Téléphone : {shopSummary?.shop_phone || '—'}</div>
                  </div>
                </div>
                {quotePreviewItems.length === 0 ? (
                  <div className="p-4 text-xs text-gray-500">Ajoutez un produit pour générer l’aperçu ici.</div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-4 space-y-3 text-[11px]">
                      <table className="w-full border-collapse text-[11px]">
                        <thead>
                          <tr className="h-10 border-b bg-gray-100 uppercase text-[10px] tracking-wide text-gray-600">
                            <th className="border-r px-2 text-left">Référence</th>
                            <th className="border-r px-2 text-left">Nom du produit</th>
                            <th className="border-r px-2 text-left">Description</th>
                            <th className="border-r px-2 text-right">Prix unitaire</th>
                            <th className="border-r px-2 text-right">Quantité</th>
                            <th className="border-r px-2 text-right">Total</th>
                            <th className="border-r px-2 text-center">Lien</th>
                            <th className="px-2 text-center">Image</th>
                          </tr>
                        </thead>
                        <tbody>
                          {quotePreviewItems.map((item) => (
                            <tr key={`preview-${item.id}`} className="h-20 border-b last:border-b-0 align-top">
                              <td className="border-r px-2 py-1 text-xs text-gray-600">{item.reference || '—'}</td>
                              <td className="border-r px-2 py-1 font-semibold text-[12px]">{item.name}</td>
                              <td className="border-r px-2 py-1 text-[11px] text-gray-600">
                                {item.description ? (
                                  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.description) }} />
                                ) : (
                                  splitDescription(item.description).map((line, index) => (
                                    <p key={`desc-${item.id}-${index}`}>{line}</p>
                                  ))
                                )}
                              </td>
                              <td className="border-r px-2 py-1 text-right">
                                {formatCurrency(item.unitPrice, currencyCode)}
                              </td>
                              <td className="border-r px-2 py-1 text-right">{item.quantity}</td>
                              <td className="border-r px-2 py-1 text-right font-semibold">
                                {formatCurrency(item.totalLine, currencyCode)}
                              </td>
                              <td className="border-r px-2 py-1 text-center">
                                {item.productLink ? (
                                  <a className="text-blue-600 underline" href={item.productLink} target="_blank" rel="noreferrer">
                                    Lien du produit
                                  </a>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className="px-2 py-1 text-center">
                                {item.image ? (
                                  <img src={item.image} alt={item.name} className="mx-auto h-16 w-16 object-contain" />
                                ) : (
                                  <span className="text-[10px] text-gray-400">Pas d’image</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div className="border-t pt-3 text-[12px]">
                        <div className="flex justify-between">
                          <span>Coût du transport</span>
                          <span>{formatCurrency(transportCost, currencyCode)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Total</span>
                          <span className="font-semibold">{formatCurrency(finalTotal, currencyCode)}</span>
                        </div>
                      </div>
                      {header.delivery_lead_time_text && (
                        <div className="text-[11px]">
                          Délai de livraison estimé : {header.delivery_lead_time_text}
                        </div>
                      )}
                      <div className="pt-3 text-[11px]">
                        <p>Sincères salutations</p>
                        <p className="font-semibold">{shopSummary?.vendor_contact_name || '—'}</p>
                        <p>{shopSummary?.vendor_company_name || shopSummary?.shop_domain || ''}</p>
                        {shopSummary?.shop_phone && <p>Tél : {shopSummary.shop_phone}</p>}
                        {shopSummary?.shop_email && <p>Email : {shopSummary.shop_email}</p>}
                        {shopSummary?.shop_domain && <p>Website : {shopSummary.shop_domain}</p>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
      </div>

      <div className="panel">
        <div className="panel__header flex items-center justify-between">
          <span>Prompts (Automation Suite)</span>
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              className={`px-2 py-1 rounded border ${promptsTab === 'extraction' ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-white hover:bg-gray-50'}`}
              onClick={() => setPromptsTab('extraction')}
            >
              Extraction
            </button>
            <button
              type="button"
              className={`px-2 py-1 rounded border ${promptsTab === 'language' ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-white hover:bg-gray-50'}`}
              onClick={() => setPromptsTab('language')}
            >
              Détection langue
            </button>
          </div>
        </div>
        <div className="panel__body space-y-3 text-sm text-gray-700">
          {promptsTab === 'extraction' ? (
            <>
              <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
                <div>
                  <label className="text-[11px] font-semibold uppercase text-gray-500">Config (mod_automation_suite_prompt_config)</label>
                  <select
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                    value={promptConfigId}
                    onChange={(e) => handlePromptConfigSelection(e.target.value)}
                    disabled={promptConfigsLoading}
                  >
                    <option value="">{promptConfigsLoading ? 'Chargement…' : 'Sélectionnez une config'}</option>
                    {promptConfigsOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className={`text-[11px] ${promptConfigsError ? 'text-red-600' : 'text-gray-500'}`}>
                    {promptConfigsError || 'Liste depuis automation-suite.'}
                  </p>
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase text-gray-500">Prompt ID (lecture seule)</label>
                  <input
                    className="mt-1 w-full rounded border px-2 py-1 text-sm bg-gray-50"
                    placeholder="prompt_xxx"
                    value={promptId}
                    readOnly
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase text-gray-500">Version (lecture seule)</label>
                  <input
                    className="mt-1 w-full rounded border px-2 py-1 text-sm bg-gray-50"
                    placeholder="latest"
                    value={promptVersion}
                    readOnly
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 text-[12px]">
                <button
                  type="button"
                  className="px-3 py-1 rounded border bg-white hover:bg-gray-50"
                  onClick={savePromptConfig}
                >
                  Sauvegarder pour la file devis
                </button>
                <span className="text-gray-500">Utilisé par Email → “Ajouter au devis”.</span>
                {promptSavedMsg && <span className="text-emerald-700">{promptSavedMsg}</span>}
              </div>
            </>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_0.8fr]">
                <div>
                  <label className="text-[11px] font-semibold uppercase text-gray-500">Config (mod_automation_suite_prompt_config)</label>
                  <select
                    className="mt-1 w-full rounded border px-2 py-1 text-sm"
                    value={langPromptConfigId}
                    onChange={(e) => handleLangPromptConfigSelection(e.target.value)}
                    disabled={promptConfigsLoading}
                  >
                    <option value="">{promptConfigsLoading ? 'Chargement…' : 'Sélectionnez une config'}</option>
                    {promptConfigsOptions.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className={`text-[11px] ${promptConfigsError ? 'text-red-600' : 'text-gray-500'}`}>
                    {promptConfigsError || 'Liste depuis automation-suite.'}
                  </p>
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase text-gray-500">Prompt ID (lecture seule)</label>
                  <input
                    className="mt-1 w-full rounded border px-2 py-1 text-sm bg-gray-50"
                    placeholder="prompt_xxx"
                    value={langPromptId}
                    readOnly
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold uppercase text-gray-500">Version (lecture seule)</label>
                  <input
                    className="mt-1 w-full rounded border px-2 py-1 text-sm bg-gray-50"
                    placeholder="latest"
                    value={langPromptVersion}
                    readOnly
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[12px]">
                <button
                  type="button"
                  className="px-3 py-1 rounded border bg-white hover:bg-gray-50"
                  onClick={saveLangPromptConfig}
                >
                  Sauvegarder pour “Pré-remplir devis”
                </button>
                <span className="text-gray-500">Utilisé pour choisir automatiquement la langue (ps_lang / ps_lang_shop).</span>
                {langDetectStatus.loading && autoMessageId && <span className="text-gray-500">Détection…</span>}
                {langDetectStatus.error && <span className="text-red-600">{langDetectStatus.error}</span>}
                {langPromptSavedMsg && <span className="text-emerald-700">{langPromptSavedMsg}</span>}
              </div>
            </>
          )}
        </div>
      </div>

      <DevisTranslationsPanel
        orgId={orgFilter}
        selectedShopId={selectedShopId}
        selectedLanguageId={selectedLanguageId}
        selectedLanguageIso={selectedLanguageIso}
        shops={shops}
        languages={languages}
        promptConfigs={promptConfigs}
      />

        </div>
      </div>
    </div>
  );
}
