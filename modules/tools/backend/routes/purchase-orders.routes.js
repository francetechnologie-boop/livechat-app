import { createDraft } from '../../../google-api/backend/services/gmail.service.js';

function requireAdminGuard(ctx) {
  if (typeof ctx.requireAdmin === 'function') {
    return function requireAdmin(req, res) {
      try {
        const out = ctx.requireAdmin(req, res);
        if (out) return out;
        if (res && res.headersSent) return null;
      } catch (e) {
        try {
          if (res && !res.headersSent) return res.status(500).json({ ok: false, error: 'auth_error' });
        } catch {}
        return null;
      }
      try {
        if (res && !res.headersSent) res.status(401).json({ ok: false, error: 'unauthorized' });
      } catch {}
      return null;
    };
  }
  return () => true;
}

function pickOrgId(req) {
  try {
    const raw = req.headers['x-org-id'] || req.query?.org_id || req.body?.org_id;
    if (raw === null || raw === undefined) return null;
    const trimmed = String(raw).trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function toOrgInt(orgId) {
  try {
    if (orgId === null || orgId === undefined) return null;
    const s = String(orgId).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  } catch {
    return null;
  }
}

function clampInt(value, { min = 0, max = 1_000_000, fallback = 0 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function fmtPragueDate(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function padSeq(n, width = 5) {
  const s = String(Math.max(0, Number(n) || 0));
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return n.toFixed(2);
}

function formatDateIso(value) {
  const s = String(value ?? '').trim();
  if (!s) return '';
  try {
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return s;
    return d.toISOString().slice(0, 10);
  } catch {
    return s;
  }
}

const HISTORICAL_OUR_INFO = {
  company: 'Ivana Gottvaldova',
  contact: 'Olivier Michaud',
  address: 'Dobrovodská 21, 370 06 České Budějovice',
  phone: '+420 602 429 381',
  email: 'francetechnologie@gmail.com',
};

const IMPORT_HEADER_ALIASES = {
  ponumber: 'po_number',
  ponumberlong: 'po_number_long',
  ponumber_long: 'po_number_long',
  poline: 'po_line',
  line: 'po_line',
  dateorder: 'date_order',
  deliverydate: 'delivery_date',
  qty: 'qty',
  quantity: 'qty',
  unitprice: 'unit_price',
  unit_price: 'unit_price',
  unitprice_eur: 'unit_price',
  currency: 'currency',
  vendor: 'vendor',
  supplier: 'vendor',
  reference: 'reference',
  descriptionshort: 'description_short',
  description: 'description',
  itemcode: 'item_code',
  vat: 'vat_rate',
  taxrate: 'vat_rate',
  vatcurrency: 'vat_currency',
  status: 'status',
  dateupdate: 'date_update',
  date_update: 'date_update',
  reste: 'rest',
  rest: 'rest',
  qtydelivered: 'qty_delivered',
  qty_delivered: 'qty_delivered',
  qtypartiel: 'qty_partial',
  qty_partiel: 'qty_partial',
  qty_partial: 'qty_partial',
  replan: 'replan_date',
  replan_date: 'replan_date',
  notes: 'notes',
};

function normalizeImportHeader(raw = '') {
  const cleaned = String(raw ?? '').toLowerCase().trim();
  if (!cleaned) return '';
  const compact = cleaned.replace(/[^a-z0-9]+/g, '');
  if (!compact) return '';
  return IMPORT_HEADER_ALIASES[compact] || compact;
}

function parseNumeric(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/,/g, '.').replace(/[^\d.-]+/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseDmyDate(value) {
  if (!value) return null;
  const cleaned = String(value).trim();
  if (!cleaned) return null;
  const dmy = cleaned.match(/(\d{1,2})[^\d]+(\d{1,2})[^\d]+(\d{4})/);
  if (dmy) {
    const year = Number(dmy[3]);
    const month = Number(dmy[2]);
    const day = Number(dmy[1]);
    if (
      Number.isFinite(year) &&
      Number.isFinite(month) &&
      Number.isFinite(day) &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= 31
    ) {
      return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const iso = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function normalizeIsoDateValue(value) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).trim();
  if (!cleaned) return null;
  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const dmy = parseDmyDate(cleaned);
  if (dmy) return dmy;
  return cleaned;
}

function parseTimestamp(value) {
  if (!value) return null;
  const cleaned = String(value).trim();
  if (!cleaned) return null;
  const match = cleaned.match(/(\d{1,2})[^\d]+(\d{1,2})[^\d]+(\d{4})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    const hour = (match[4] ?? '00').padStart(2, '0');
    const minute = (match[5] ?? '00').padStart(2, '0');
    const second = (match[6] ?? '00').padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }
  const iso = new Date(cleaned);
  if (Number.isFinite(iso.getTime())) {
    return iso.toISOString();
  }
  return null;
}

function parsePoSeq(value) {
  const n = parseNumeric(value);
  if (n !== null) return Math.max(0, Math.trunc(n));
  const str = String(value ?? '').trim();
  if (!str) return 0;
  const match = str.match(/(\d+)\s*$/);
  if (match) return Math.max(0, Math.trunc(Number(match[1])));
  return 0;
}

function normalizeImportRow(rawRow, rowIndex) {
  if (!rawRow || typeof rawRow !== 'object') return null;
  const normalized = {};
  for (const [key, value] of Object.entries(rawRow)) {
    const header = normalizeImportHeader(key);
    if (!header) continue;
    normalized[header] = value;
  }
  const poNumber = String(normalized.po_number_long || normalized.po_number || '').trim();
  if (!poNumber) return null;
  const lineNo = parsePoSeq(normalized.po_line);
  const qty = parseNumeric(normalized.qty);
  const line = {
    po_key: poNumber,
    po_number: poNumber,
    po_date: parseDmyDate(normalized.date_order) || parseDmyDate(poNumber),
    po_seq: parsePoSeq(normalized.po_seq || poNumber),
    currency: String(normalized.currency || normalized.vat_currency || 'EUR').trim() || 'EUR',
    tax_rate: parseNumeric(normalized.vat_rate),
    supplier_name: String(normalized.vendor || '').trim() || null,
    vendor_id: String(normalized.vendor_id || '').trim() || null,
    line_no: lineNo > 0 ? lineNo : (rowIndex + 1) * 10,
    item_code: String(normalized.item_code || normalized.reference || '').trim() || null,
    item_name: String(normalized.description_short || normalized.description || normalized.item_code || '').trim() || null,
    reference: String(normalized.reference || '').trim() || null,
    description_short: String(normalized.description_short || '').trim() || null,
    description: String(normalized.description || normalized.description_short || '').trim() || null,
    quantity: qty !== null ? qty : 0,
    unit: String(normalized.unit || '').trim() || null,
    unit_price: parseNumeric(normalized.unit_price),
    currency_line: String(normalized.currency || normalized.vat_currency || 'EUR').trim() || 'EUR',
    delivery_date: parseDmyDate(normalized.delivery_date),
  };
  return line;
}

function normalizeHistoryRow(rawRow) {
  if (!rawRow || typeof rawRow !== 'object') return null;
  const normalized = {};
  for (const [key, value] of Object.entries(rawRow)) {
    const header = normalizeImportHeader(key);
    if (!header) continue;
    normalized[header] = value;
  }
  const poKey = String(normalized.po_number_long || normalized.po_number || '').replace(/\s+/g, '');
  if (!poKey) return null;
  const lineNo = parsePoSeq(normalized.po_line);
  if (!lineNo) return null;
  return {
    po_key: poKey,
    line_no: lineNo,
    status: normalized.status ? String(normalized.status).trim() : null,
    rest: parseNumeric(normalized.rest),
    qty_partial: parseNumeric(normalized.qty_partial),
    qty_delivered: parseNumeric(normalized.qty_delivered),
    replan_date: parseDmyDate(normalized.replan_date),
    updated_at: parseTimestamp(normalized.date_update),
    notes: normalized.notes ? String(normalized.notes).trim() : null,
  };
}

async function fetchSupplier(pool, { supplierId, orgId }) {
  if (!supplierId) return null;
  const args = [Number(supplierId)];
  let where = 'id=$1';
  if (orgId !== null) {
    args.push(orgId);
    where += ` AND (org_id IS NULL OR org_id=$2)`;
  }
  const r = await pool.query(
    `SELECT id, org_id, name, contact, meta,
            street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code,
            created_at, updated_at
       FROM mod_bom_suppliers WHERE ${where} LIMIT 1`,
    args
  );
  if (!r.rowCount) return null;
  return r.rows[0] || null;
}

async function fetchSupplierPrimaryContact(pool, { supplierId, orgId }) {
  if (!supplierId) return null;
  const args = [Number(supplierId)];
  let where = 'supplier_id=$1';
  if (orgId !== null) {
    args.push(orgId);
    where += ` AND (org_id IS NULL OR org_id=$2)`;
  }
  const r = await pool.query(
    `SELECT id, name, email, phone, role, is_primary
       FROM mod_bom_supplier_contacts
      WHERE ${where}
      ORDER BY is_primary DESC, id ASC
      LIMIT 1`,
    args
  );
  if (!r.rowCount) return null;
  return r.rows[0] || null;
}

async function fetchItems(pool, { itemIds, orgId }) {
  const ids = Array.from(new Set((itemIds || []).map((v) => Number(v)).filter(Boolean)));
  if (!ids.length) return new Map();
  const args = [ids];
  let where = 'id = ANY($1::int[])';
  if (orgId !== null) {
    args.push(orgId);
    where += ` AND (org_id IS NULL OR org_id=$2)`;
  }
  const r = await pool.query(
    `SELECT id, sku, name, uom, unit, reference, description, description_short
       FROM mod_bom_items
      WHERE ${where}`,
    args
  );
  const m = new Map();
  for (const row of r.rows || []) m.set(Number(row.id), row);
  return m;
}

function buildEmail({ poNumber, supplier = {}, toEmail, ourInfo = {}, lines = [], currency, taxRate }) {
  const subject = `[ Ivana Gottvaldova] Purchase Order: ${poNumber}`;
  const vendorName = supplier?.name || '';
  const vendorContact = supplier?.contact || '';
  const vendorEmail = supplier?.email || '';
  const vendorPhone = supplier?.phone || '';
  const vendorAddr = [supplier?.street_address, supplier?.zip, supplier?.city, supplier?.country].filter(Boolean).join(', ');

  const ourCompany = ourInfo?.company || '';
  const ourContact = ourInfo?.contact_name || '';
  const ourAddress = ourInfo?.address || '';
  const ourPhone = ourInfo?.phone || '';
  const ourEmail = ourInfo?.email || '';

  const cur = String(currency || supplier?.currency || '').trim();
  const vatRate = taxRate == null ? null : Number(taxRate);

  const enrichedLines = (lines || []).map((l, idx) => {
    const qty = Number(l.quantity ?? l.qty ?? 0);
    const unitPrice = l.unit_price == null ? null : Number(l.unit_price);
    const hasPrice = unitPrice !== null && Number.isFinite(unitPrice);
    const lineTotal = hasPrice && Number.isFinite(qty) ? qty * unitPrice : null;
    const lineCur = String(l.currency || cur || '').trim();
    return {
      line_no: l.line_no ?? (idx + 1) * 10,
      sku: l.item_sku || l.sku || '',
      reference: l.reference || '',
      description_short: l.description_short || '',
      description: l.description || l.item_name || l.name || '',
      qty: Number.isFinite(qty) ? qty : 0,
      unit: l.unit || '',
      unit_price: hasPrice ? unitPrice : null,
      total: lineTotal,
      currency: lineCur,
      delivery_date: l.delivery_date || null,
    };
  });

  const subtotal = enrichedLines.reduce((acc, l) => acc + (Number.isFinite(l.total) ? l.total : 0), 0);
  const vat = vatRate !== null && Number.isFinite(vatRate) ? subtotal * (vatRate / 100) : null;
  const grandTotal = vat !== null ? subtotal + vat : null;

  const css = `
    body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:0;background:#f5f6f7;}
    .container{max-width:980px;margin:0 auto;padding:18px 12px;}
    .card{background:#fff;border:1px solid #d9d9d9;border-radius:2px;padding:18px 18px 22px 18px;}
    h1{font-size:22px;margin:8px 0 18px 0;text-align:center;}
    .cols{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px;}
    .col{flex:1 1 340px;}
    .h{font-weight:700;margin:6px 0 8px 0;}
    .kv{font-size:13px;line-height:1.45;}
    .kv div{margin:2px 0;}
    .totals{margin-top:12px;font-size:13px;}
    .totals div{margin:4px 0;}
    .footer{margin-top:14px;font-size:12px;color:#666;}
  `;

  const cell = (value, opts = {}) => {
    const { align = 'left', width = null } = opts;
    const style = [
      'border:1px solid #c7c7c7',
      'padding:7px 8px',
      'font-size:12px',
      'vertical-align:top',
      align === 'right' ? 'text-align:right' : '',
      align === 'center' ? 'text-align:center' : '',
      width ? `width:${width}` : '',
    ]
      .filter(Boolean)
      .join(';');
    return `<td style="${style}">${value}</td>`;
  };

  const htmlLines = enrichedLines
    .map((l) => {
      return `
        <tr>
          ${cell(escapeHtml(l.line_no), { align: 'center', width: '6%' })}
          ${cell(escapeHtml(l.sku), { width: '10%' })}
          ${cell(escapeHtml(l.reference), { width: '10%' })}
          ${cell(escapeHtml(l.description_short), { width: '16%' })}
          ${cell(escapeHtml(l.description), { width: '18%' })}
          ${cell(escapeHtml(l.qty), { align: 'right', width: '7%' })}
          ${cell(escapeHtml(l.unit), { align: 'center', width: '6%' })}
          ${cell(l.unit_price == null ? '' : escapeHtml(formatMoney(l.unit_price)), { align: 'right', width: '9%' })}
          ${cell(l.total == null ? '' : escapeHtml(formatMoney(l.total)), { align: 'right', width: '10%' })}
          ${cell(escapeHtml(l.currency), { align: 'center', width: '6%' })}
          ${cell(escapeHtml(l.delivery_date ? formatDateIso(l.delivery_date) : ''), { align: 'center', width: '12%' })}
        </tr>
      `;
    })
    .join('');

  const html = `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>${css}</style>
    </head>
    <body>
      <div class="container">
        <div class="card">
          <h1>Purchase Order: ${escapeHtml(poNumber)}</h1>
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
            <tr>
              <td style="width:50%;vertical-align:top;padding-right:12px;">
                <div class="h">Vendor Information</div>
                <div class="kv">
                  <div><b>Vendor:</b> ${escapeHtml(vendorName)}</div>
                  ${vendorContact ? `<div><b>Contact:</b> ${escapeHtml(vendorContact)}</div>` : ''}
                  ${vendorEmail ? `<div><b>Email:</b> ${escapeHtml(vendorEmail)}</div>` : ''}
                  ${vendorPhone ? `<div><b>Phone:</b> ${escapeHtml(vendorPhone)}</div>` : ''}
                  ${vendorAddr ? `<div><b>Address:</b> ${escapeHtml(vendorAddr)}</div>` : ''}
                </div>
              </td>
              <td style="width:50%;vertical-align:top;padding-left:12px;">
                <div class="h">Your Contact Information</div>
                <div class="kv">
                  ${ourCompany ? `<div><b>Company:</b> ${escapeHtml(ourCompany)}</div>` : ''}
                  ${ourContact ? `<div><b>Contact Name:</b> ${escapeHtml(ourContact)}</div>` : ''}
                  ${ourAddress ? `<div><b>Address:</b> ${escapeHtml(ourAddress)}</div>` : ''}
                  ${ourPhone ? `<div><b>Phone:</b> ${escapeHtml(ourPhone)}</div>` : ''}
                  ${ourEmail ? `<div><b>Email:</b> ${escapeHtml(ourEmail)}</div>` : ''}
                </div>
              </td>
            </tr>
          </table>

          <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:12px;border:1px solid #c7c7c7;table-layout:fixed;">
            <thead>
              <tr>
                <th style="background:#f0f2f5;border:1px solid #c7c7c7;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#333;text-align:center;width:6%;">PO Line</th>
                <th style="background:#f0f2f5;border:1px solid #c7c7c7;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#333;text-align:left;width:10%;">Item Code</th>
                <th style="background:#f0f2f5;border:1px solid #c7c7c7;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#333;text-align:left;width:10%;">Reference</th>
                <th style="background:#f0f2f5;border:1px solid #c7c7c7;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#333;text-align:left;width:16%;">Description (Short)</th>
                <th style="background:#f0f2f5;border:1px solid #c7c7c7;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#333;text-align:left;width:18%;">Description</th>
                <th style="background:#f0f2f5;border:1px solid #c7c7c7;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#333;text-align:right;width:7%;">Quantity</th>
                <th style="background:#f0f2f5;border:1px solid #c7c7c7;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#333;text-align:center;width:6%;">Unit</th>
                <th style="background:#f0f2f5;border:1px solid #c7c7c7;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#333;text-align:right;width:9%;">Unit Price</th>
                <th style="background:#f0f2f5;border:1px solid #c7c7c7;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#333;text-align:right;width:10%;">Total Line</th>
                <th style="background:#f0f2f5;border:1px solid #c7c7c7;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#333;text-align:center;width:6%;">Currency</th>
                <th style="background:#f0f2f5;border:1px solid #c7c7c7;padding:7px 8px;font-size:11px;text-transform:uppercase;color:#333;text-align:center;width:12%;">Delivery Date</th>
              </tr>
            </thead>
            <tbody>
              ${htmlLines || '<tr><td colspan="11" style="text-align:center;color:#666;border:1px solid #c7c7c7;padding:8px;">No lines</td></tr>'}
            </tbody>
          </table>

          <div class="totals">
            <div><b>Total Amount:</b> ${escapeHtml(formatMoney(subtotal))}${cur ? ` ${escapeHtml(cur)}` : ''}</div>
            ${vat !== null ? `<div><b>VAT (${escapeHtml(vatRate)}%):</b> ${escapeHtml(formatMoney(vat))}${cur ? ` ${escapeHtml(cur)}` : ''}</div>` : ''}
            ${grandTotal !== null ? `<div><b>Total with VAT:</b> ${escapeHtml(formatMoney(grandTotal))}${cur ? ` ${escapeHtml(cur)}` : ''}</div>` : ''}
          </div>

          <div class="footer">
            ${toEmail ? `To: ${escapeHtml(toEmail)}` : ''}
          </div>
        </div>
      </div>
    </body>
  </html>`;

  const textLines = enrichedLines
    .map((l) => {
      const total = l.total == null ? '' : ` => ${formatMoney(l.total)} ${l.currency || ''}`.trim();
      return `${l.line_no}. ${l.sku} - ${l.description} | qty ${l.qty} ${l.unit || ''}${l.unit_price == null ? '' : ` @ ${formatMoney(l.unit_price)} ${l.currency || ''}`}${total}`;
    })
    .join('\n');

  const text = [
    `Purchase Order: ${poNumber}`,
    '',
    `Vendor: ${vendorName}`,
    vendorEmail ? `Email: ${vendorEmail}` : '',
    vendorAddr ? `Address: ${vendorAddr}` : '',
    '',
    `Your Contact: ${[ourCompany, ourContact].filter(Boolean).join(' / ')}`,
    ourEmail ? `Email: ${ourEmail}` : '',
    ourPhone ? `Phone: ${ourPhone}` : '',
    ourAddress ? `Address: ${ourAddress}` : '',
    '',
    'Lines:',
    textLines || '(none)',
    '',
    `Total: ${formatMoney(subtotal)} ${cur}`.trim(),
    vat !== null ? `VAT (${vatRate}%): ${formatMoney(vat)} ${cur}`.trim() : '',
    grandTotal !== null ? `Total with VAT: ${formatMoney(grandTotal)} ${cur}`.trim() : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text, totals: { subtotal, vat, total: grandTotal }, currency: cur };
}

async function createOrderWithLines(client, { orgId, supplierId, supplier, primary, toEmail, currency, taxRate, ourInfo, lines }) {
  const poDate = fmtPragueDate();
  const orgKey = orgId === null ? -1 : orgId;
  // Use a monotonically increasing sequence (global across orgs, no daily reset).
  await client.query('LOCK TABLE mod_tools_purchase_orders IN SHARE ROW EXCLUSIVE MODE');
  const r = await client.query(`SELECT COALESCE(MAX(po_seq), 0) AS max_seq FROM mod_tools_purchase_orders`);
  const maxSeq = Number(r.rows?.[0]?.max_seq || 0) || 0;
  const poSeq = maxSeq + 1;
  const poNumber = `${poDate}-${padSeq(poSeq, 5)}`;
  const addrStr = supplierAddressString(supplier);

  const o = await client.query(
    `INSERT INTO mod_tools_purchase_orders
      (org_id, po_date, po_seq, po_number, status,
       supplier_id, supplier_name, supplier_contact, supplier_email, supplier_phone, supplier_address,
       to_email, currency, tax_rate,
       our_company, our_contact_name, our_address, our_phone, our_email,
       created_at, updated_at)
     VALUES
      ($1,$2::date,$3,$4,'draft',
       $5,$6,$7,$8,$9,$10,
       $11,$12,$13,
       $14,$15,$16,$17,$18,
       NOW(),NOW())
     RETURNING id`,
    [
      orgId,
      poDate,
      poSeq,
      poNumber,
      supplierId,
      supplier.name || null,
      primary?.name || supplier.contact || null,
      supplier.email || primary?.email || null,
      supplier.phone || primary?.phone || null,
      addrStr,
      toEmail,
      currency,
      taxRate,
      String(ourInfo.company || '').trim() || null,
      String(ourInfo.contact_name || '').trim() || null,
      String(ourInfo.address || '').trim() || null,
      String(ourInfo.phone || '').trim() || null,
      String(ourInfo.email || '').trim() || null,
    ]
  );
  const orderId = o.rows?.[0]?.id || null;

    for (const l of lines) {
      const qtyDelivered = Math.max(0, Number(l.qty_delivered || 0));
      const restQty = Math.max(0, Number.isFinite(Number(l.quantity)) ? Number(l.quantity) - qtyDelivered : qtyDelivered);
      await client.query(
        `INSERT INTO mod_tools_purchase_order_lines
          (purchase_order_id, org_id, line_no, item_id, item_sku, item_name, reference, description_short, description, quantity, unit, unit_price, currency, delivery_date, status, qty_delivered, rest, created_at, updated_at)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())`,
        [
          orderId,
          orgId,
          l.line_no,
          l.item_id,
          l.item_sku,
          l.item_name,
          l.reference,
          l.description_short,
          l.description,
          l.quantity,
          l.unit,
          l.unit_price,
          l.currency,
          l.delivery_date ? formatDateIso(l.delivery_date) : null,
          l.status || 'not updated',
          qtyDelivered,
          restQty,
        ]
      );
    }

  return { orderId, poDate, poSeq, poNumber };
}

function normalizeLinesFromBody({ bodyLines = [], itemsById, currency }) {
  const out = [];
  const cleaned = Array.isArray(bodyLines) ? bodyLines : [];
  for (let idx = 0; idx < cleaned.length; idx++) {
    const raw = cleaned[idx] || {};
    const itemId = raw.item_id != null ? Number(raw.item_id) : null;
    const item = itemId ? itemsById.get(itemId) : null;
    const qty = Number(raw.qty ?? raw.quantity ?? 0);
    const unitPrice = raw.unit_price === '' || raw.unit_price == null ? null : Number(raw.unit_price);
    const line = {
      line_no: (idx + 1) * 10,
      item_id: itemId || null,
      item_sku: String(item?.sku || raw.sku || raw.item_sku || '').trim() || null,
      item_name: String(item?.name || raw.name || raw.item_name || '').trim() || null,
      reference: String(item?.reference || raw.reference || '').trim() || null,
      description_short: String(item?.description_short || raw.description_short || '').trim() || null,
      description: String(item?.description || raw.description || '').trim() || null,
      quantity: Number.isFinite(qty) ? qty : 0,
      unit: String(item?.uom || item?.unit || raw.unit || '').trim() || null,
      unit_price: unitPrice !== null && Number.isFinite(unitPrice) ? unitPrice : null,
      currency: String(raw.currency || currency || '').trim() || null,
      delivery_date: raw.delivery_date ? String(raw.delivery_date) : null,
      status: raw.status ? String(raw.status || '').trim() : 'not updated',
      qty_delivered: raw.qty_delivered != null ? Number(raw.qty_delivered) : 0,
      rest: raw.rest != null ? Number(raw.rest) : null,
    };
    if ((line.item_id || line.item_sku || line.item_name) && line.quantity > 0) out.push(line);
  }
  return out;
}

function supplierAddressString(supplier) {
  if (!supplier) return null;
  const addr = [supplier.street_address, supplier.zip, supplier.city, supplier.country].filter(Boolean).join(', ');
  return addr || null;
}

export function registerToolsPurchaseOrdersRoutes(app, ctx = {}) {
  const requireAdmin = requireAdminGuard(ctx);
  const pool = ctx.pool;
  const chatLog = ctx.chatLog || (() => {});

  app.get('/api/tools/purchase-orders/__ping', (_req, res) => res.json({ ok: true, module: 'tools', feature: 'purchase-orders' }));

  app.get('/api/tools/purchase-orders', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const orgId = toOrgInt(pickOrgId(req));
      const limit = clampInt(req.query?.limit, { min: 1, max: 200, fallback: 50 });
      const args = [];
      let where = 'WHERE 1=1';
      if (orgId !== null) {
        args.push(orgId);
        where += ` AND (org_id IS NULL OR org_id=$${args.length})`;
      }
      args.push(limit);
      const r = await pool.query(
        `SELECT id, org_id, po_date, po_seq, po_number, status, supplier_id, supplier_name, to_email, currency, tax_rate, drafted_at, created_at, updated_at
           FROM mod_tools_purchase_orders
           ${where}
          ORDER BY id DESC
          LIMIT $${args.length}`,
        args
      );
      return res.json({ ok: true, items: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'list_failed', message: String(e?.message || e) });
    }
  });

  app.post('/api/tools/purchase-orders/import', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const rawRows = Array.isArray(body.rows) ? body.rows : [];
      if (!rawRows.length) return res.status(400).json({ ok: false, error: 'missing_rows' });
      const orgId = toOrgInt(body.org_id ?? pickOrgId(req));
      const parsedRows = rawRows
        .map((row, idx) => normalizeImportRow(row, idx))
        .filter((row) => row && row.po_key);
      if (!parsedRows.length) return res.status(400).json({ ok: false, error: 'invalid_rows' });

      const ordersByKey = new Map();
      const linesByKey = new Map();
      parsedRows.forEach((line) => {
        const key = line.po_key;
        if (!ordersByKey.has(key)) {
          ordersByKey.set(key, {
            po_number: line.po_number,
            po_date: line.po_date,
            po_seq: line.po_seq,
            currency: line.currency,
            tax_rate: line.tax_rate,
            supplier_name: line.supplier_name,
          });
        }
        const bucket = linesByKey.get(key) || [];
        bucket.push(line);
        linesByKey.set(key, bucket);
      });

      const client = await pool.connect();
      let ordersCreated = 0;
      let linesCreated = 0;
      try {
        await client.query('BEGIN');
        const orderKeys = Array.from(ordersByKey.keys());
        const existingOrders = orderKeys.length
          ? await client.query('SELECT id, po_number FROM mod_tools_purchase_orders WHERE po_number = ANY($1::text[])', [orderKeys])
          : { rowCount: 0, rows: [] };
        const orderIdByKey = new Map((existingOrders.rows || []).map((row) => [row.po_number, row.id]));

        const insertOrderSql = `
          INSERT INTO mod_tools_purchase_orders
            (org_id, po_date, po_seq, po_number, status,
             supplier_id, supplier_name, to_email, currency, tax_rate,
             our_company, our_contact_name, our_address, our_phone, our_email,
             created_at, updated_at)
          VALUES
            ($1, $2::date, $3, $4, 'draft',
             NULL, $5, NULL, $6, $7,
             $8, $9, $10, $11, $12,
             NOW(), NOW())
          RETURNING id, po_number
        `;

        for (const [key, orderInfo] of ordersByKey) {
          if (orderIdByKey.has(key)) continue;
          const result = await client.query(insertOrderSql, [
            orgId,
            orderInfo.po_date || fmtPragueDate(),
            orderInfo.po_seq || 0,
            orderInfo.po_number || key,
            orderInfo.supplier_name,
            orderInfo.currency || 'EUR',
            orderInfo.tax_rate,
            HISTORICAL_OUR_INFO.company,
            HISTORICAL_OUR_INFO.contact,
            HISTORICAL_OUR_INFO.address,
            HISTORICAL_OUR_INFO.phone,
            HISTORICAL_OUR_INFO.email,
          ]);
          const createdOrder = result.rows?.[0];
          if (createdOrder?.id) {
            orderIdByKey.set(createdOrder.po_number, createdOrder.id);
            ordersCreated += 1;
          }
        }

        const insertLineSql = `
          INSERT INTO mod_tools_purchase_order_lines
            (purchase_order_id, org_id, line_no,
             item_id, item_sku, item_name, reference, description_short, description,
             quantity, unit, unit_price, currency, delivery_date,
             status, qty_delivered, rest, created_at, updated_at)
          VALUES
            ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'not updated', 0, $14, NOW(), NOW())
          ON CONFLICT (purchase_order_id, line_no) DO NOTHING
        `;
        for (const [key, orderLines] of linesByKey) {
          const orderId = orderIdByKey.get(key);
          if (!orderId) continue;
          for (const line of orderLines) {
            const quantity = Number.isFinite(line.quantity) ? line.quantity : 0;
            const rest = Math.max(0, quantity);
            const currency = line.currency_line || ordersByKey.get(key)?.currency || 'EUR';
            const params = [
              orderId,
              orgId,
              line.line_no,
              line.item_code,
              line.item_name,
              line.reference,
              line.description_short,
              line.description,
              quantity,
              line.unit,
              Number.isFinite(line.unit_price) ? line.unit_price : null,
              currency,
              line.delivery_date,
              rest,
            ];
            const result = await client.query(insertLineSql, params);
            if (result.rowCount) {
              linesCreated += 1;
            }
          }
        }

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      return res.json({ ok: true, imported_orders: ordersCreated, imported_lines: linesCreated });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'import_failed', message: String(e?.message || e) });
    }
  });

  app.post('/api/tools/purchase-orders/import-history', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const orgId = toOrgInt(pickOrgId(req)) ?? toOrgInt(req.body?.org_id);
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      const normalized = rows
        .map((row) => normalizeHistoryRow(row))
        .filter((entry) => entry && entry.po_key && entry.line_no);
      if (!normalized.length) {
        return res.status(400).json({ ok: false, error: 'no_history_rows', message: 'No order line history rows were provided.' });
      }
      const client = await pool.connect();
      let insertedRows = 0;
      let updatedLines = 0;
      let skippedOrders = 0;
      let skippedLines = 0;
      try {
        await client.query('BEGIN');
        const insertSql = `
          INSERT INTO mod_tools_order_line_status_history (
            purchase_order_id,
            purchase_order_line_id,
            org_id,
            status,
            qty_delivered,
            rest,
            qty_partial,
            replan_date,
            notes,
            created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `;
        const updateLineSql = `
          UPDATE mod_tools_purchase_order_lines
            SET status = COALESCE($1, status),
                qty_delivered = COALESCE($2, qty_delivered),
                rest = COALESCE($3, rest)
          WHERE id = $4
        `;
        for (const entry of normalized) {
          const orderArgs = orgId !== null ? [entry.po_key, orgId] : [entry.po_key];
          const orderRow = await client.query(
            `
              SELECT id
                FROM mod_tools_purchase_orders
               WHERE po_number = $1
               ${orgId !== null ? 'AND (org_id IS NULL OR org_id = $2)' : ''}
               LIMIT 1
            `,
            orderArgs
          );
          if (!orderRow.rowCount) {
            skippedOrders += 1;
            continue;
          }
          const orderId = orderRow.rows[0].id;
          const lineRow = await client.query(
            `
              SELECT id, org_id
                FROM mod_tools_purchase_order_lines
               WHERE purchase_order_id = $1 AND line_no = $2
               LIMIT 1
            `,
            [orderId, entry.line_no]
          );
          if (!lineRow.rowCount) {
            skippedLines += 1;
            continue;
          }
          const lineId = lineRow.rows[0].id;
          const lineOrg = lineRow.rows[0].org_id ?? orgId;
          await client.query(insertSql, [
            orderId,
            lineId,
            lineOrg,
            entry.status,
            entry.qty_delivered,
            entry.rest,
            entry.qty_partial,
            entry.replan_date,
            entry.notes,
            entry.updated_at || new Date().toISOString(),
          ]);
          insertedRows += 1;
          const updateResult = await client.query(updateLineSql, [
            entry.status,
            entry.qty_delivered,
            entry.rest,
            lineId,
          ]);
          if (updateResult.rowCount) {
            updatedLines += 1;
          }
        }
        await client.query('COMMIT');
        return res.json({
          ok: true,
          imported_rows: insertedRows,
          updated_lines: updatedLines,
          skipped_orders: skippedOrders,
          skipped_lines: skippedLines,
        });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'history_import_failed', message: String(e?.message || e) });
    }
  });

  app.get('/api/tools/purchase-orders/lines', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const orgId = toOrgInt(pickOrgId(req));
      const limit = clampInt(req.query?.limit, { min: 5, max: 2000, fallback: 400 });
      const q = String(req.query?.q || '').trim();
      const args = [];
      let where = '1=1';
      if (orgId !== null) {
        args.push(orgId);
        where += ` AND (l.org_id IS NULL OR l.org_id=$${args.length})`;
      }
      if (q) {
        args.push(`%${q}%`);
        where += ` AND (o.po_number ILIKE $${args.length} OR l.item_sku ILIKE $${args.length} OR l.item_name ILIKE $${args.length} OR l.reference ILIKE $${args.length})`;
      }
      args.push(limit);
      const r = await pool.query(
        `SELECT l.id AS line_id, o.id AS order_id, o.org_id, o.po_number, l.line_no, l.item_sku, l.item_name,
                l.reference, l.description_short, l.description, l.quantity, l.unit, l.unit_price, l.currency,
                l.status, l.qty_delivered, l.rest, l.delivery_date
           FROM mod_tools_purchase_order_lines l
           JOIN mod_tools_purchase_orders o ON o.id = l.purchase_order_id
          WHERE ${where}
          ORDER BY o.po_date DESC, l.line_no ASC
          LIMIT $${args.length}`,
        args
      );
      return res.json({ ok: true, lines: r.rows || [] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'line_list_failed', message: String(e?.message || e) });
    }
  });

  app.get('/api/tools/purchase-orders/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });
      const orgId = toOrgInt(pickOrgId(req));
      const args = [id];
      let where = 'id=$1';
      if (orgId !== null) {
        args.push(orgId);
        where += ` AND (org_id IS NULL OR org_id=$2)`;
      }
      const o = await pool.query(
        `SELECT * FROM mod_tools_purchase_orders WHERE ${where} LIMIT 1`,
        args
      );
      if (!o.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      const lines = await pool.query(
        `SELECT * FROM mod_tools_purchase_order_lines WHERE purchase_order_id=$1 ORDER BY line_no ASC`,
        [id]
      );
      return res.json({ ok: true, order: o.rows[0], lines: lines.rows || [] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'get_failed', message: String(e?.message || e) });
    }
  });

  app.post('/api/tools/purchase-orders/preview', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = toOrgInt(body.org_id ?? pickOrgId(req));
      const supplierId = body.supplier_id ? Number(body.supplier_id) : null;
      const supplier = await fetchSupplier(pool, { supplierId, orgId });
      const primary = await fetchSupplierPrimaryContact(pool, { supplierId, orgId });
      const toEmail = String(body.to_email || primary?.email || supplier?.email || '').trim() || null;
      const currency = String(body.currency || supplier?.currency || '').trim() || null;
      const taxRate = body.tax_rate != null ? Number(body.tax_rate) : (supplier?.tax_rate != null ? Number(supplier.tax_rate) : null);

      const itemIds = Array.isArray(body.lines) ? body.lines.map((l) => l?.item_id).filter(Boolean) : [];
      const itemsById = await fetchItems(pool, { itemIds, orgId });
      const lines = normalizeLinesFromBody({ bodyLines: body.lines, itemsById, currency });
      if (!lines.length) return res.status(400).json({ ok: false, error: 'missing_lines', message: 'Add at least one line with qty > 0.' });

      const ourInfo = body.our_info && typeof body.our_info === 'object' ? body.our_info : {};
      const poNumber = body.po_number ? String(body.po_number) : `PREVIEW-${fmtPragueDate()}`;
      const preview = buildEmail({ poNumber, supplier: { ...(supplier || {}), contact: primary?.name || supplier?.contact || null, email: supplier?.email || primary?.email || null, phone: supplier?.phone || primary?.phone || null }, toEmail, ourInfo, lines, currency, taxRate });

      return res.json({ ok: true, preview: { ...preview, to: toEmail } });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'preview_failed', message: String(e?.message || e) });
    }
  });

  app.post('/api/tools/purchase-orders/draft', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const orgId = toOrgInt(body.org_id ?? pickOrgId(req));
      const supplierId = body.supplier_id ? Number(body.supplier_id) : null;
      if (!supplierId) return res.status(400).json({ ok: false, error: 'missing_supplier' });

      const supplier = await fetchSupplier(pool, { supplierId, orgId });
      if (!supplier) return res.status(404).json({ ok: false, error: 'supplier_not_found' });
      const primary = await fetchSupplierPrimaryContact(pool, { supplierId, orgId });

      const toEmail = String(body.to_email || primary?.email || supplier?.email || '').trim();
      if (!toEmail) return res.status(400).json({ ok: false, error: 'missing_to_email', message: 'Supplier email (to) is required.' });

      const currency = String(body.currency || supplier?.currency || '').trim() || null;
      const taxRate = body.tax_rate != null ? Number(body.tax_rate) : (supplier?.tax_rate != null ? Number(supplier.tax_rate) : null);

      const itemIds = Array.isArray(body.lines) ? body.lines.map((l) => l?.item_id).filter(Boolean) : [];
      const itemsById = await fetchItems(pool, { itemIds, orgId });
      const lines = normalizeLinesFromBody({ bodyLines: body.lines, itemsById, currency });
      if (!lines.length) return res.status(400).json({ ok: false, error: 'missing_lines', message: 'Add at least one line with qty > 0.' });

      const ourInfo = body.our_info && typeof body.our_info === 'object' ? body.our_info : {};
      const supplierSnapshot = {
        id: supplier.id,
        name: supplier.name,
        contact: primary?.name || supplier.contact || null,
        email: supplier.email || primary?.email || null,
        phone: supplier.phone || primary?.phone || null,
        street_address: supplier.street_address || null,
        zip: supplier.zip || null,
        city: supplier.city || null,
        country: supplier.country || null,
      };

      const client = await pool.connect();
      let created = null;
      try {
        await client.query('BEGIN');
        created = await createOrderWithLines(client, { orgId, supplierId, supplier, primary, toEmail, currency, taxRate, ourInfo, lines });
        await client.query('COMMIT');
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {}
        throw e;
      } finally {
        client.release();
      }

      const poNumber = created?.poNumber;
      const orderId = created?.orderId;
      const preview = buildEmail({ poNumber, supplier: supplierSnapshot, toEmail, ourInfo, lines, currency, taxRate });
      const from = String(ourInfo?.email || '').trim();
      const draft = await createDraft({ ctx, to: toEmail, subject: preview.subject, html: preview.html, text: preview.text, from: from || undefined });

      await pool.query(
        `UPDATE mod_tools_purchase_orders
            SET status='drafted',
                gmail_draft_id=$1,
                gmail_thread_id=$2,
                drafted_at=NOW(),
                updated_at=NOW()
          WHERE id=$3`,
        [String(draft?.id || '') || null, String(draft?.message?.threadId || '') || null, orderId]
      );

      chatLog('tools_purchase_order_draft', {
        po_number: poNumber,
        supplier_id: supplierId,
        lines: lines.length,
        gmail_draft_id: draft?.id || null,
        org_id: orgId,
      });

      return res.json({
        ok: true,
        order: { id: orderId, po_number: poNumber, status: 'drafted', to_email: toEmail },
        draft: { id: draft?.id || '', threadId: draft?.message?.threadId || '' },
        preview: { ...preview, to: toEmail },
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'draft_failed', message: String(e?.message || e) });
    }
  });

  app.patch('/api/tools/purchase-orders/:id/status', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const id = Number(req.params?.id || 0);
      if (!id) return res.status(400).json({ ok: false, error: 'invalid_id' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const status = String(body.status || '').trim();
      if (!status) return res.status(400).json({ ok: false, error: 'missing_status' });
      const statusLower = status.toLowerCase();
      const result = await pool.query(
        `UPDATE mod_tools_purchase_orders
            SET status=$1, updated_at=NOW()
          WHERE id=$2
        RETURNING id, status`,
        [status, id]
      );
      if (!result.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      let linesUpdated = 0;
      if (statusLower === 'canceled') {
        try {
          const lines = await pool.query(
            `UPDATE mod_tools_purchase_order_lines
                SET status='Canceled', updated_at=NOW()
              WHERE purchase_order_id=$1
            RETURNING id, org_id, purchase_order_id, qty_delivered, rest`,
            [id]
          );
          linesUpdated = lines.rowCount || 0;
          if (linesUpdated) {
            try {
              await pool.query(
                `INSERT INTO mod_tools_order_line_status_history
                   (purchase_order_id, purchase_order_line_id, org_id, status, qty_delivered, rest, created_at)
                 SELECT $1, l.id, l.org_id, 'Canceled', l.qty_delivered, l.rest, NOW()
                   FROM mod_tools_purchase_order_lines l
                  WHERE l.purchase_order_id = $1`,
                [id]
              );
            } catch {
              // history insert is best-effort
            }
          }
        } catch {
          // if line cascade fails, keep order status change intact
        }
      }
      return res.json({ ok: true, order: result.rows[0], lines_updated: linesUpdated });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'status_failed', message: String(e?.message || e) });
    }
  });

  app.delete('/api/tools/purchase-orders/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const orderId = Number(req.params?.id || 0);
      if (!orderId) return res.status(400).json({ ok: false, error: 'invalid_id' });
      const result = await pool.query(`DELETE FROM mod_tools_purchase_orders WHERE id=$1 RETURNING id`, [orderId]);
      if (!result.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      return res.json({ ok: true, deleted: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'delete_failed', message: String(e?.message || e) });
    }
  });

  app.patch('/api/tools/purchase-orders/lines/:lineId', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const lineId = Number(req.params?.lineId || 0);
      if (!lineId) return res.status(400).json({ ok: false, error: 'invalid_id' });
      const row = await pool.query(`SELECT id, quantity, purchase_order_id, org_id FROM mod_tools_purchase_order_lines WHERE id=$1 LIMIT 1`, [lineId]);
      if (!row.rowCount) return res.status(404).json({ ok: false, error: 'not_found' });
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const updates = [];
      const args = [];
      if (body.status != null) {
        args.push(String(body.status).trim());
        updates.push(`status=$${args.length}`);
      }
      let qtyDelivered = null;
      if (body.qty_delivered != null) {
        const parsed = Number(body.qty_delivered);
        if (!Number.isFinite(parsed) || parsed < 0) return res.status(400).json({ ok: false, error: 'invalid_qty_delivered' });
        qtyDelivered = parsed;
        args.push(qtyDelivered);
        updates.push(`qty_delivered=$${args.length}`);
        const quantity = Number(row.rows[0].quantity || 0);
        const restVal = Math.max(0, quantity - qtyDelivered);
        args.push(restVal);
        updates.push(`rest=$${args.length}`);
      }
      if (body.delivery_date != null) {
        const dateVal = normalizeIsoDateValue(body.delivery_date);
        args.push(dateVal || null);
        updates.push(`delivery_date=$${args.length}`);
      }
      if (!updates.length) return res.status(400).json({ ok: false, error: 'missing_fields' });
      args.push(lineId);
      const result = await pool.query(
        `UPDATE mod_tools_purchase_order_lines
            SET ${updates.join(', ')}, updated_at=NOW()
          WHERE id=$${args.length}
        RETURNING *`,
        args
      );
      if (result.rowCount) {
        const updatedLine = result.rows[0];
        const restValue = updatedLine?.rest ?? null;
        const qtyDeliveredValue = updatedLine?.qty_delivered ?? null;
        // If a line is marked delivered, bubble status up to the order
        if (body.status && String(body.status).toLowerCase() === 'delivered') {
          try {
            await pool.query(
              `UPDATE mod_tools_purchase_orders
                  SET status='delivered', updated_at=NOW()
                WHERE id=$1`,
              [updatedLine.purchase_order_id]
            );
          } catch {
            // best effort
          }
        }
        const historyArgs = [
          updatedLine.purchase_order_id,
          updatedLine.id,
          updatedLine.org_id,
          updatedLine.status,
          qtyDeliveredValue,
          restValue,
          body.qty_partial != null && !Number.isNaN(Number(body.qty_partial)) ? Number(body.qty_partial) : null,
          normalizeIsoDateValue(body.replan_date),
          body.notes ? String(body.notes).trim() : null,
        ];
        try {
          await pool.query(
            `INSERT INTO mod_tools_order_line_status_history
              (purchase_order_id, purchase_order_line_id, org_id, status, qty_delivered, rest, qty_partial, replan_date, notes, created_at)
             VALUES
              ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
            historyArgs
          );
        } catch {
          // ignore to keep history best-effort
        }
        try {
          chatLog('tools_purchase_order_line_update', {
            line_id: updatedLine.id,
            purchase_order_id: updatedLine.purchase_order_id,
            status: updatedLine.status,
            delivery_date: updatedLine.delivery_date || null,
            qty_delivered: updatedLine.qty_delivered ?? null,
            rest: updatedLine.rest ?? null,
            replan_date: historyArgs[7] || null,
            org_id: updatedLine.org_id ?? null,
          });
        } catch {}
      }
      return res.json({ ok: true, line: result.rows[0] || null });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'line_update_failed', message: String(e?.message || e) });
    }
  });

  app.get('/api/tools/purchase-orders/lines/:lineId/history', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      if (!pool) return res.status(503).json({ ok: false, error: 'db_unavailable' });
      const lineId = Number(req.params?.lineId || 0);
      if (!lineId) return res.status(400).json({ ok: false, error: 'invalid_id' });
      const orgId = toOrgInt(pickOrgId(req));
      const args = [lineId];
      let where = 'purchase_order_line_id=$1';
      if (orgId !== null) {
        args.push(orgId);
        where += ` AND (org_id IS NULL OR org_id=$${args.length})`;
      }
      const h = await pool.query(
        `SELECT status, qty_delivered, rest, qty_partial, replan_date, notes, created_at
           FROM mod_tools_order_line_status_history
          WHERE ${where}
          ORDER BY created_at DESC
          LIMIT 250`,
        args
      );
      return res.json({ ok: true, history: h.rows || [] });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'history_failed', message: String(e?.message || e) });
    }
  });
}
