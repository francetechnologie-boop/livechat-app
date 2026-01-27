let PDFDocument = null;
let fetchFn = typeof fetch === 'function' ? fetch : null;
let sharpFn = null;
import fs from 'fs';

function normalizeIso(iso) {
  const raw = String(iso || '').trim().toLowerCase();
  if (!raw) return 'fr';
  if (raw.length === 2) return raw;
  if (raw.includes('-')) return raw.split('-')[0];
  return raw.slice(0, 2);
}

function pickExistingPath(candidates = []) {
  for (const value of candidates) {
    const p = String(value || '').trim();
    if (!p) continue;
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return '';
}

function resolveUnicodeFonts() {
  const regular = pickExistingPath([
    process.env.DEVIS_PDF_FONT_REGULAR,
    // Common Linux fonts with Latin Extended (Czech, Polish, etc.)
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  ]);
  const bold = pickExistingPath([
    process.env.DEVIS_PDF_FONT_BOLD,
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  ]);
  return { regular, bold };
}

function pickLocale(header = {}) {
  const iso = normalizeIso(header.lang_iso_code || header.lang_iso || header.iso_code || header.language || 'fr');
  const locale = String(header.lang_locale || header.locale || '').trim();
  if (locale) return { iso, locale };
  const map = {
    fr: 'fr-FR',
    en: 'en-GB',
    nl: 'nl-NL',
    de: 'de-DE',
    cs: 'cs-CZ',
    it: 'it-IT',
    es: 'es-ES',
    pt: 'pt-PT',
    pl: 'pl-PL',
    lt: 'lt-LT',
  };
  return { iso, locale: map[iso] || 'fr-FR' };
}

function labelsFor(iso) {
  const dict = {
    fr: {
      doc_title: 'Devis',
      quote_number: 'Numéro de devis',
      date: 'Date',
      remarques_text: 'Remarques',
      client_info: 'Informations sur le client',
      vendor_info: 'Informations sur le vendeur',
      client_name: 'Nom du client',
      client_company: 'Société du client',
      client_email: 'Email du client',
      vendor_company: 'Nom de la société du vendeur',
      vendor_contact: 'Nom du contact du vendeur',
      vendor_email: 'Email du vendeur',
      vendor_phone: 'Téléphone du magasin',
      details: 'Détails',
      reference: 'Référence',
      product_name: 'Nom du produit',
      description: 'Description',
      unit_price: 'Prix unitaire',
      quantity: 'Quantité',
      total: 'Total',
      product_link: 'Lien du produit',
      image: 'Image',
      link_text: 'Lien',
      transport_cost: 'Coût du transport',
      delivery_lead_time: 'Délai de livraison',
      summary: 'Résumé',
    },
    en: {
      doc_title: 'Quote',
      quote_number: 'Quote number',
      date: 'Date',
      remarques_text: 'Remarks',
      client_info: 'Customer information',
      vendor_info: 'Vendor information',
      client_name: 'Customer name',
      client_company: 'Customer company',
      client_email: 'Customer email',
      vendor_company: 'Vendor company',
      vendor_contact: 'Vendor contact',
      vendor_email: 'Vendor email',
      vendor_phone: 'Shop phone',
      details: 'Details',
      reference: 'Reference',
      product_name: 'Product name',
      description: 'Description',
      unit_price: 'Unit price',
      quantity: 'Qty',
      total: 'Total',
      product_link: 'Product link',
      image: 'Image',
      link_text: 'Link',
      transport_cost: 'Transport cost',
      delivery_lead_time: 'Delivery time',
      summary: 'Summary',
    },
    nl: {
      doc_title: 'Offerte',
      quote_number: 'Offertenummer',
      date: 'Datum',
      remarques_text: 'Opmerkingen',
      client_info: 'Klantgegevens',
      vendor_info: 'Verkopergegevens',
      client_name: 'Naam klant',
      client_company: 'Bedrijf klant',
      client_email: 'E-mail klant',
      vendor_company: 'Bedrijf verkoper',
      vendor_contact: 'Contactpersoon verkoper',
      vendor_email: 'E-mail verkoper',
      vendor_phone: 'Telefoon winkel',
      details: 'Details',
      reference: 'Referentie',
      product_name: 'Productnaam',
      description: 'Beschrijving',
      unit_price: 'Stukprijs',
      quantity: 'Aantal',
      total: 'Totaal',
      product_link: 'Productlink',
      image: 'Afbeelding',
      link_text: 'Link',
      transport_cost: 'Transportkosten',
      delivery_lead_time: 'Levertijd',
      summary: 'Samenvatting',
    },
    de: {
      doc_title: 'Angebot',
      quote_number: 'Angebotsnummer',
      date: 'Datum',
      remarques_text: 'Bemerkungen',
      client_info: 'Kundendaten',
      vendor_info: 'Verkäuferdaten',
      client_name: 'Kundenname',
      client_company: 'Kundenfirma',
      client_email: 'Kunden-E-Mail',
      vendor_company: 'Firma des Verkäufers',
      vendor_contact: 'Kontakt des Verkäufers',
      vendor_email: 'E-Mail des Verkäufers',
      vendor_phone: 'Telefon des Shops',
      details: 'Details',
      reference: 'Referenz',
      product_name: 'Produktname',
      description: 'Beschreibung',
      unit_price: 'Stückpreis',
      quantity: 'Menge',
      total: 'Gesamt',
      product_link: 'Produktlink',
      image: 'Bild',
      link_text: 'Link',
      transport_cost: 'Transport',
      delivery_lead_time: 'Lieferzeit',
      summary: 'Zusammenfassung',
    },
    cs: {
      doc_title: 'Cenová nabídka',
      quote_number: 'Číslo nabídky',
      date: 'Datum',
      remarques_text: 'Poznámky',
      client_info: 'Informace o zákazníkovi',
      vendor_info: 'Informace o prodejci',
      client_name: 'Jméno zákazníka',
      client_company: 'Společnost zákazníka',
      client_email: 'E-mail zákazníka',
      vendor_company: 'Společnost prodejce',
      vendor_contact: 'Kontakt prodejce',
      vendor_email: 'E-mail prodejce',
      vendor_phone: 'Telefon obchodu',
      details: 'Detaily',
      reference: 'Reference',
      product_name: 'Název produktu',
      description: 'Popis',
      unit_price: 'Jednotková cena',
      quantity: 'Množství',
      total: 'Celkem',
      product_link: 'Odkaz na produkt',
      image: 'Obrázek',
      link_text: 'Odkaz',
      transport_cost: 'Doprava',
      delivery_lead_time: 'Doba dodání',
      summary: 'Souhrn',
    },
    it: {
      doc_title: 'Preventivo',
      quote_number: 'Numero preventivo',
      date: 'Data',
      remarques_text: 'Note',
      client_info: 'Dati cliente',
      vendor_info: 'Dati venditore',
      client_name: 'Nome cliente',
      client_company: 'Azienda cliente',
      client_email: 'Email cliente',
      vendor_company: 'Azienda venditore',
      vendor_contact: 'Contatto venditore',
      vendor_email: 'Email venditore',
      vendor_phone: 'Telefono negozio',
      details: 'Dettagli',
      reference: 'Riferimento',
      product_name: 'Nome prodotto',
      description: 'Descrizione',
      unit_price: 'Prezzo unitario',
      quantity: 'Quantità',
      total: 'Totale',
      product_link: 'Link prodotto',
      image: 'Immagine',
      link_text: 'Link',
      transport_cost: 'Trasporto',
      delivery_lead_time: 'Tempi di consegna',
      summary: 'Riepilogo',
    },
    es: {
      doc_title: 'Presupuesto',
      quote_number: 'Número de presupuesto',
      date: 'Fecha',
      remarques_text: 'Observaciones',
      client_info: 'Información del cliente',
      vendor_info: 'Información del vendedor',
      client_name: 'Nombre del cliente',
      client_company: 'Empresa del cliente',
      client_email: 'Email del cliente',
      vendor_company: 'Empresa del vendedor',
      vendor_contact: 'Contacto del vendedor',
      vendor_email: 'Email del vendedor',
      vendor_phone: 'Teléfono de la tienda',
      details: 'Detalles',
      reference: 'Referencia',
      product_name: 'Nombre del producto',
      description: 'Descripción',
      unit_price: 'Precio unitario',
      quantity: 'Cantidad',
      total: 'Total',
      product_link: 'Enlace del producto',
      image: 'Imagen',
      link_text: 'Enlace',
      transport_cost: 'Transporte',
      delivery_lead_time: 'Plazo de entrega',
      summary: 'Resumen',
    },
    pt: {
      doc_title: 'Orçamento',
      quote_number: 'Número do orçamento',
      date: 'Data',
      remarques_text: 'Observações',
      client_info: 'Informações do cliente',
      vendor_info: 'Informações do vendedor',
      client_name: 'Nome do cliente',
      client_company: 'Empresa do cliente',
      client_email: 'Email do cliente',
      vendor_company: 'Empresa do vendedor',
      vendor_contact: 'Contato do vendedor',
      vendor_email: 'Email do vendedor',
      vendor_phone: 'Telefone da loja',
      details: 'Detalhes',
      reference: 'Referência',
      product_name: 'Nome do produto',
      description: 'Descrição',
      unit_price: 'Preço unitário',
      quantity: 'Quantidade',
      total: 'Total',
      product_link: 'Link do produto',
      image: 'Imagem',
      link_text: 'Link',
      transport_cost: 'Transporte',
      delivery_lead_time: 'Prazo de entrega',
      summary: 'Resumo',
    },
  };
  return dict[iso] || dict.fr;
}

function formatCurrency(value, currency = 'EUR', locale = 'fr-FR') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: String(currency || 'EUR').toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${String(currency || 'EUR').toUpperCase()}`;
  }
}

function normalizeText(value) {
  if (!value) return '';
  return String(value).replace(/<\/?[^>]+>/g, '').trim();
}

function clampText(value, maxChars = 320) {
  const text = String(value || '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}…`;
}

function normalizeUrl(rawUrl = '', baseUrl = '', langIso = '', shopDomain = '') {
  try {
    const raw = String(rawUrl || '').trim();
    if (!raw) return '';
    let url = raw
      .replace(/&amp;/gi, '&')
      .replace(/&#38;/gi, '&')
      .replace(/&#x26;/gi, '&');
    url = url.replace(/^<|>$/g, '').replace(/^"+|"+$/g, '').replace(/^'+|'+$/g, '').trim();
    if (!url) return '';
    if (url.startsWith('//')) {
      const base = String(baseUrl || '').trim();
      const scheme = /^https:/i.test(base) ? 'https:' : /^http:/i.test(base) ? 'http:' : 'https:';
      url = scheme + url;
    }
    if (url.startsWith('/')) {
      const base = String(baseUrl || '').trim().replace(/\/+$/, '');
      if (base) {
        url = `${base}${url}`;
      } else if (shopDomain) {
        // If we know the shop domain but not the full base URL, assume https://<domain><path>
        const scheme = 'https://';
        url = `${scheme}${String(shopDomain).replace(/^https?:\/\//i, '')}${url}`;
      }
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      if (url.includes('.') && !/\s/.test(url)) return `https://${url}`;
    }
    // Ensure language prefix for shop domain when missing (e.g. /cs/…)
    try {
      const u = new URL(url);
      const shopHost = (() => {
        try {
          return new URL(String(baseUrl || '')).hostname.toLowerCase();
        } catch {
          return String(shopDomain || '').toLowerCase();
        }
      })();
      if (!shopHost || u.hostname.toLowerCase() !== shopHost) return url;

      // Fix Prestashop oddity: "/es2034-..." → "/es/2034-..." (even if lang isn't provided)
      const glued = (u.pathname || '').match(/^\/([a-z]{2})(\d)/i);
      if (glued && glued[1] && glued[2] && !String(u.pathname || '').startsWith(`/${glued[1]}/`)) {
        u.pathname = `/${String(glued[1]).toLowerCase()}/${String(u.pathname || '').slice(3)}`;
        return u.toString();
      }

      const lang = String(langIso || '').trim().toLowerCase();
      if (!lang) return url;
      const basePath = (() => {
        try {
          const p = new URL(String(baseUrl || '')).pathname || '/';
          return p.replace(/\/+$/, '/') || '/';
        } catch {
          return '/';
        }
      })();
      const desiredPrefix = basePath === '/' ? `/${lang}/` : `${basePath}${lang}/`;
      const pathname = u.pathname || '/';
      const afterBase = basePath !== '/' && pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname.replace(/^\/+/, '');
      if (/^[a-z]{2}\//i.test(afterBase)) return url; // already has language prefix
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
  } catch {
    return '';
  }
}

async function loadPdfkit() {
  if (PDFDocument) return PDFDocument;
  try {
    const mod = await import('pdfkit');
    PDFDocument = mod.default || mod;
    return PDFDocument;
  } catch (error) {
    throw new Error(`pdfkit_missing:${error?.message || 'install pdfkit in backend'}`);
  }
}

async function ensureFetch() {
  if (fetchFn) return fetchFn;
  try {
    const mod = await import('node-fetch');
    fetchFn = mod.default || mod;
    return fetchFn;
  } catch {
    fetchFn = null;
    return null;
  }
}

async function ensureSharp() {
  if (sharpFn !== null) return sharpFn;
  try {
    const mod = await import('sharp');
    sharpFn = mod.default || mod;
    return sharpFn;
  } catch {
    sharpFn = null;
    return null;
  }
}

function isWebpBuffer(buffer) {
  try {
    if (!buffer || buffer.length < 12) return false;
    return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  } catch {
    return false;
  }
}

function isPngBuffer(buffer) {
  try {
    if (!buffer || buffer.length < 8) return false;
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    );
  } catch {
    return false;
  }
}

function isJpegBuffer(buffer) {
  try {
    if (!buffer || buffer.length < 3) return false;
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  } catch {
    return false;
  }
}

function isProbablyHtmlBuffer(buffer) {
  try {
    if (!buffer || buffer.length < 16) return false;
    const head = buffer.slice(0, 64).toString('utf8').toLowerCase();
    return head.includes('<!doctype') || head.includes('<html') || head.includes('<head') || head.includes('<body');
  } catch {
    return false;
  }
}

export async function buildQuotePdf({ quoteNumber, header = {}, items = [], totals = {} }) {
  const PDFKit = await loadPdfkit();
  await ensureFetch();
  await ensureSharp();
  const pageMargin = 36;
  return new Promise((resolve, reject) => {
    const { iso, locale } = pickLocale(header);
    const baseLabels = labelsFor(iso);
    const overrideLabels = header.i18n_labels && typeof header.i18n_labels === 'object' && !Array.isArray(header.i18n_labels)
      ? header.i18n_labels
      : null;
    const labels = overrideLabels ? { ...baseLabels, ...overrideLabels } : baseLabels;
    const currency = header.currency_text || totals.currency || 'EUR';
    const doc = new PDFKit({ size: 'A4', margin: pageMargin });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (err) => reject(err));

    // Use a Unicode-capable font to render Czech/diacritics correctly. Fallback remains Helvetica.
    let fontRegularName = 'Helvetica';
    let fontBoldName = 'Helvetica-Bold';
    try {
      const { regular, bold } = resolveUnicodeFonts();
      if (regular) {
        doc.registerFont('DevisUnicode', regular);
        fontRegularName = 'DevisUnicode';
      }
      if (bold) {
        doc.registerFont('DevisUnicodeBold', bold);
        fontBoldName = 'DevisUnicodeBold';
      } else if (regular) {
        // If only regular exists, reuse it for bold calls (PDFKit will still render; weight won't be bold).
        fontBoldName = fontRegularName;
      }
    } catch {
      // ignore
    }
    const useRegular = () => doc.font(fontRegularName);
    const useBold = () => doc.font(fontBoldName);
    useRegular();

    const safeText = (value = '') => normalizeText(value) || '';
    const drawHorizontalRule = (y) => {
      const { left, right } = doc.page.margins;
      doc.save();
      doc.strokeColor('#d1d5db').lineWidth(0.5).moveTo(left, y).lineTo(doc.page.width - right, y).stroke();
      doc.restore();
    };

    const fetchImageBuffer = async (url) => {
      if (!url) return null;

      // Inline data URLs (base64) → buffer directly, skipping fetch.
      try {
        const dataMatch = String(url).trim().match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
        if (dataMatch && dataMatch[2]) {
          return Buffer.from(dataMatch[2], 'base64');
        }
      } catch {}

      const tryNormalizeForPdf = async (buf, contentType = '') => {
        if (!buf || !buf.length) return null;
        if (isProbablyHtmlBuffer(buf)) return null;

        // PDFKit supports JPEG/PNG. If it's already one of those, keep it.
        const ct = String(contentType || '').toLowerCase();
        if (isPngBuffer(buf) || isJpegBuffer(buf) || ct.includes('image/png') || ct.includes('image/jpeg')) return buf;

        // Convert any other image formats (webp/avif/gif/svg/...) to PNG if sharp is available.
        const sharp = await ensureSharp();
        if (!sharp) return null;
        try {
          return await sharp(buf, { animated: true }).png().toBuffer();
        } catch {
          // If conversion fails, keep PDF generation working (no image).
          return null;
        }
      };

      const attemptFetch = async (insecure = false, customUrl = null) => {
        if (!fetchFn) return null;
        try {
          const referer = (() => {
            try {
              const raw = String(header?.shop_url || '').trim();
              if (raw) return raw;
              const domain = String(header?.shop_domain || '').trim();
              return domain ? `https://${domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}/` : '';
            } catch {
              return '';
            }
          })();
          const headers = {
            'User-Agent': 'LiveChat-Quote-PDF/1.0',
            // Prefer JPEG/PNG to avoid AVIF/WEBP when the server does content negotiation.
            Accept: 'image/jpeg,image/png,image/*;q=0.8,*/*;q=0.5',
            ...(referer ? { Referer: referer } : {}),
          };
          const opts = insecure
            ? { agent: new (await import('https')).Agent({ rejectUnauthorized: false }), headers }
            : { headers };
          const targetUrl = customUrl || url;
          const resp = await fetchFn(targetUrl, opts);
          if (!resp?.ok) return null;
          const arr = await resp.arrayBuffer();
          const buf = Buffer.from(arr);
          const contentType = String(resp.headers?.get?.('content-type') || '').toLowerCase();
          return await tryNormalizeForPdf(buf, contentType);
        } catch {
          return null;
        }
      };

      // First pass: normal fetch
      let buffer = await attemptFetch(false);
      if (buffer) return buffer;

      // Retry with relaxed TLS (self-signed) if needed.
      buffer = await attemptFetch(true);
      if (buffer) return buffer;

      let altUrl = null;
      // Retry over http if the URL is https (some hosts block strict TLS)
      if (/^https:/i.test(url)) {
        altUrl = url.replace(/^https:/i, 'http:');
        buffer = await attemptFetch(false, altUrl);
        if (buffer) return buffer;
      }

      // Final fallback: node http/https without fetch (keeps PDF usable even if node-fetch is missing)
      try {
        const { default: https } = await import('https');
        const { default: http } = await import('http');
        const finalUrl = altUrl || url;
        const client = /^https:/i.test(finalUrl) ? https : http;
        buffer = await new Promise((resolve) => {
          const req = client.get(
            finalUrl,
            { rejectUnauthorized: false },
            (res) => {
              if (res.statusCode && res.statusCode >= 400) {
                res.resume();
                return resolve(null);
              }
              const data = [];
              res.on('data', (chunk) => data.push(chunk));
              res.on('end', async () => {
                const buf = Buffer.concat(data);
                const ct = String(res.headers?.['content-type'] || '').toLowerCase();
                resolve(await tryNormalizeForPdf(buf, ct));
              });
            }
          );
          req.on('error', () => resolve(null));
        });
        return buffer;
      } catch {
        return null;
      }
    };

    const drawHeader = async () => {
      const brandY = doc.y;
      let logoHeight = 0;
      if (header.logo_url) {
        const logoBuffer = await fetchImageBuffer(header.logo_url);
        if (logoBuffer) {
          logoHeight = 40;
          doc.image(logoBuffer, doc.x, brandY, { fit: [50, 40] });
        }
      }
      const brandTextX = doc.x + (logoHeight ? 60 : 0);
      const brandText = safeText(header.shop_domain || header.quote_title || header.vendor_company_name || labels.doc_title);
      const metaWidth = 240;
      const metaX = doc.page.width - doc.page.margins.right - metaWidth;

      // Keep brand text from flowing under the meta block.
      const brandWidth = Math.max(80, metaX - brandTextX - 10);
      useBold().fontSize(13).text(brandText, brandTextX, brandY, { width: brandWidth });

      const quoteLine = `${labels.quote_number}: ${quoteNumber || ''}`;
      const dateLine = `${labels.date}: ${safeText(header.date || header.date_devis_text || '') || new Date().toLocaleDateString(locale)}`;

      useBold().fontSize(15);
      const quoteH = doc.heightOfString(quoteLine, { width: metaWidth, align: 'right' });
      doc.text(quoteLine, metaX, brandY, { align: 'right', width: metaWidth });

      const dateY = brandY + quoteH + 4;
      useRegular().fontSize(10);
      const dateH = doc.heightOfString(dateLine, { width: metaWidth, align: 'right' });
      doc.text(dateLine, metaX, dateY, { align: 'right', width: metaWidth });

      // Ensure y advances past the tallest block (logo/brand vs meta), avoiding overlap with next section
      useBold().fontSize(13);
      const brandH = doc.heightOfString(brandText, { width: brandWidth });
      const leftBlockBottom = brandY + Math.max(logoHeight || 0, brandH, 40);
      const rightBlockBottom = dateY + dateH;
      doc.y = Math.max(leftBlockBottom, rightBlockBottom) + 12;
    };

    const drawInfoCards = () => {
      const startY = doc.y;
      const cardGap = 12;
      const cardWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right - cardGap) / 2;
      const cardPaddingX = 8;
      const cardPaddingY = 8;
      const contentWidth = cardWidth - cardPaddingX * 2;

      const clientRows = [
        header.customer_name ? `${labels.client_name} : ${safeText(header.customer_name)}` : null,
        header.customer_company ? `${labels.client_company} : ${safeText(header.customer_company)}` : null,
        header.customer_email ? `${labels.client_email} : ${safeText(header.customer_email)}` : null,
      ].filter(Boolean);

      const vendorRows = [
        (header.shop_domain || header.vendor_company_name) ? `${labels.vendor_company} : ${safeText(header.shop_domain || header.vendor_company_name)}` : null,
        header.vendor_contact_name ? `${labels.vendor_contact} : ${safeText(header.vendor_contact_name)}` : null,
        header.vendor_email ? `${labels.vendor_email} : ${safeText(header.vendor_email)}` : null,
        header.vendor_phone ? `${labels.vendor_phone} : ${safeText(header.vendor_phone)}` : null,
      ].filter(Boolean);

      const measureRowsHeight = (rows) => {
        let h = 0;
        for (const row of rows) {
          useRegular().fontSize(10);
          h += doc.heightOfString(String(row), { width: contentWidth }) + 2;
        }
        return h;
      };

      useBold().fontSize(11);
      const titleHClient = doc.heightOfString(String(labels.client_info || ''), { width: contentWidth });
      const titleHVendor = doc.heightOfString(String(labels.vendor_info || ''), { width: contentWidth });
      const rowsHClient = measureRowsHeight(clientRows);
      const rowsHVendor = measureRowsHeight(vendorRows);
      const headerOffset = cardPaddingY + Math.max(titleHClient, titleHVendor) + 6;
      const cardHeight = Math.max(90, headerOffset + Math.max(rowsHClient, rowsHVendor) + 10);

      const drawCard = (title, rows, x) => {
        const cardY = startY;
        doc
          .rect(x, cardY, cardWidth, cardHeight)
          .lineWidth(0.6)
          .strokeColor('#e5e7eb')
          .fillAndStroke('#fafafa', '#e5e7eb');
        doc.fillColor('#111827');
        useBold().fontSize(11).text(title, x + cardPaddingX, cardY + cardPaddingY, { width: contentWidth });
        let y = cardY + headerOffset;
        useRegular().fontSize(10).fillColor('#374151');
        for (const row of rows) {
          const h = doc.heightOfString(String(row), { width: contentWidth });
          doc.text(String(row), x + cardPaddingX, y, { width: contentWidth });
          y += h + 2;
        }
        doc.fillColor('#111827');
      };

      drawCard(labels.client_info, clientRows, doc.page.margins.left);
      drawCard(labels.vendor_info, vendorRows, doc.page.margins.left + cardWidth + cardGap);

      doc.y = startY + cardHeight + 10;
    };

    const tableColumns = [
      { key: 'reference', label: labels.reference, width: 55 },
      { key: 'name', label: labels.product_name, width: 85 },
      { key: 'description', label: labels.description, width: 120 },
      { key: 'unitPrice', label: labels.unit_price, width: 55, align: 'right' },
      { key: 'quantity', label: labels.quantity, width: 35, align: 'right' },
      { key: 'totalLine', label: labels.line_total || labels.total, width: 60, align: 'right' },
      { key: 'productLink', label: labels.product_link, width: 45, align: 'center' },
      { key: 'image', label: labels.image, width: 60, align: 'center' },
    ];

    const drawTableHeader = () => {
      const startX = doc.page.margins.left;
      const startY = doc.y;
      // Allow multi-line column headers (Czech and others), then advance y accordingly
      useBold().fontSize(9);
      const headerHeight = Math.max(
        20,
        ...tableColumns.map((col) => doc.heightOfString(String(col.label || ''), { width: col.width - 8 }) + 10)
      );
      doc.save();
      doc.rect(startX, startY, tableColumns.reduce((sum, col) => sum + col.width, 0), headerHeight).fill('#f3f4f6');
      doc.fillColor('#4b5563'); useBold().fontSize(9);
      let x = startX;
      tableColumns.forEach((col) => {
        doc.text(col.label, x + 4, startY + 5, { width: col.width - 8, align: col.align || 'left' });
        x += col.width;
      });
      doc.restore();
      doc.y = startY + headerHeight;
    };

    const ensureSpace = (rowHeight) => {
      const bottom = doc.page.height - doc.page.margins.bottom - 60;
      if (doc.y + rowHeight > bottom) {
        doc.addPage({ margin: pageMargin });
        drawTableHeader();
      }
    };

    const drawRow = async (item) => {
      const startX = doc.page.margins.left;
      useRegular().fontSize(9).fillColor('#111827');
      const description = clampText(normalizeText(item.description || item.description_short || ''), 320);
      const name = normalizeText(item.name);
      const heights = {
        reference: doc.heightOfString(item.reference || '—', { width: tableColumns[0].width - 8 }),
        name: doc.heightOfString(name || '—', { width: tableColumns[1].width - 8 }),
        description: doc.heightOfString(description || '—', { width: tableColumns[2].width - 8 }),
        image: item.image ? 60 : 14,
      };
      const rowHeight = Math.max(22, heights.reference + 8, heights.name + 8, heights.description + 8, heights.image + 8);
      ensureSpace(rowHeight);
      const startY = doc.y;
      let x = startX;
      tableColumns.forEach((col) => {
        doc.rect(x, doc.y, col.width, rowHeight).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
        x += col.width;
      });

      x = startX;
      const writeCell = (text, col, opts = {}) => {
        doc.text(text, x + 4, startY + 6, { width: col.width - 8, align: col.align || 'left', ...opts });
        x += col.width;
      };

      writeCell(item.reference || '—', tableColumns[0]);
      writeCell(name || '—', tableColumns[1]);
      writeCell(description || '—', tableColumns[2]);
      writeCell(formatCurrency(item.unitPrice, currency, locale), tableColumns[3]);
      writeCell(String(Math.max(0, Number(item.quantity) || 0)), tableColumns[4]);
      writeCell(formatCurrency(item.totalLine, currency, locale), tableColumns[5]);

      // Link cell
      const normalizedLink = normalizeUrl(item.productLink, header.shop_url || '', header.lang_iso_code || '', header.shop_domain || '');
      doc.fillColor('#2563eb').text(
        normalizedLink ? labels.link_text : '—',
        x + 4,
        startY + 6,
        { width: tableColumns[6].width - 8, align: 'center', link: normalizedLink || undefined, underline: !!normalizedLink }
      );
      doc.fillColor('#111827');
      x += tableColumns[6].width;

      // Image cell
      // Images are typically under `/img/...` and should NOT be prefixed with the language code.
      const normalizedImage = normalizeUrl(item.image, header.shop_url || '', '', header.shop_domain || '');
      if (normalizedImage) {
        const imgBuffer = await fetchImageBuffer(normalizedImage);
        if (imgBuffer) {
          const fitSize = [tableColumns[7].width - 10, rowHeight - 12];
          try {
            doc.image(imgBuffer, x + 5, startY + 6, { fit: fitSize, align: 'center', valign: 'center' });
          } catch {
            // Fallback to placeholder if PDFKit rejects the image format
            doc.text('—', x, startY + 6, { width: tableColumns[7].width, align: 'center' });
          }
        } else {
          doc.text('—', x, startY + 6, { width: tableColumns[7].width, align: 'center' });
        }
      } else {
        doc.text('—', x, startY + 6, { width: tableColumns[7].width, align: 'center' });
      }
      x += tableColumns[7].width;

      doc.y = startY + rowHeight;
    };

    const drawTotals = () => {
      doc.moveDown(0.5);

      const blockWidth = 240;
      const blockX = doc.page.width - doc.page.margins.right - blockWidth;
      let y = doc.y;

      useBold().fontSize(11).fillColor('#111827');
      const title = String(labels.summary || 'Summary');
      const titleH = doc.heightOfString(title, { width: blockWidth, align: 'right' });
      doc.text(title, blockX, y, { width: blockWidth, align: 'right' });
      y += titleH + 6;

      const rows = [
        [String(labels.transport_cost || 'Transport'), String(formatCurrency(totals.transportCost, currency, locale))],
        [String(labels.total || 'Total'), String(formatCurrency(totals.grandTotal ?? totals.finalTotal ?? 0, currency, locale))],
      ];
      if (header.delivery_lead_time) rows.push([String(labels.delivery_lead_time || 'Delivery'), String(safeText(header.delivery_lead_time))]);

      const labelWidth = 150;
      const valueWidth = blockWidth - labelWidth;
      useRegular().fontSize(10).fillColor('#111827');
      for (const [label, value] of rows) {
        const hLabel = doc.heightOfString(label, { width: labelWidth });
        const hValue = doc.heightOfString(value, { width: valueWidth, align: 'right' });
        const rowH = Math.max(hLabel, hValue);
        doc.text(label, blockX, y, { width: labelWidth, align: 'left' });
        doc.text(value, blockX + labelWidth, y, { width: valueWidth, align: 'right' });
        y += rowH + 3;
      }

      doc.y = y;
    };

    const drawRemarks = () => {
      const raw = String(header.remarks || '').trim();
      if (!raw) return;

      const label = safeText(labels.remarques_text || 'Remarks');
      const content = safeText(raw);

      // Ensure we have enough room; otherwise move to a new page.
      const maxWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      useBold().fontSize(11);
      const labelH = doc.heightOfString(label, { width: maxWidth });
      useRegular().fontSize(10);
      const contentH = doc.heightOfString(content, { width: maxWidth });
      const required = labelH + 6 + contentH + 8;
      const bottomLimit = doc.page.height - doc.page.margins.bottom;
      if (doc.y + required > bottomLimit) doc.addPage();

      useBold().fontSize(11).fillColor('#111827').text(label, { width: maxWidth });
      doc.moveDown(0.25);
      useRegular().fontSize(10).fillColor('#111827').text(content, { width: maxWidth });
    };

    (async () => {
      try {
        await drawHeader();
        drawInfoCards();
        doc.moveDown(1);
        useBold().fontSize(12).text(labels.details, { continued: false });
        doc.moveDown(0.5);
        drawTableHeader();
        for (const item of items) {
          // eslint-disable-next-line no-await-in-loop
          await drawRow(item);
        }
        drawTotals();
        doc.moveDown(1);
        drawRemarks();
        doc.end();
      } catch (err) {
        try {
          doc.destroy();
        } catch {
          // ignore
        }
        reject(err);
      }
    })();
  });
}
