import crypto from 'crypto';
import { ensureFioBankaAccountsTable } from './fioAccounts.js';

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseNumeric(value) {
  const raw = normalizeSpaces(value);
  if (!raw) return null;
  let s = raw.replace(/\u00A0/g, ' ').replace(/\s/g, '').replace(',', '.');
  // If we ended up with multiple dots (e.g. "1.234,56" -> "1.234.56"), keep only the last as decimal separator.
  const dotCount = (s.match(/\./g) || []).length;
  if (dotCount > 1) {
    const parts = s.split('.');
    const dec = parts.pop();
    const intPart = parts.join('');
    s = `${intPart}.${dec}`;
  }
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : null;
}

function parseDateYmd(value) {
  const raw = normalizeSpaces(value);
  if (!raw) return null;
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) return raw;
  // Fio sometimes returns date with a timezone suffix, e.g. "2025-10-28+0100"
  // or with time, e.g. "2025-10-28T00:00:00+01:00". Keep only the date part.
  const isoPrefix = raw.match(/^([0-9]{4}-[0-9]{2}-[0-9]{2})/);
  if (isoPrefix) return isoPrefix[1];
  // Some Fio exports might use DD.MM.YYYY
  const m = raw.match(/^([0-9]{1,2})\\.([0-9]{1,2})\\.([0-9]{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, '0');
    const mm = String(m[2]).padStart(2, '0');
    const yyyy = String(m[3]);
    return `${yyyy}-${mm}-${dd}`;
  }
  // Last resort: attempt Date parsing
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return null;
}

function toFieldsMap(tx) {
  const out = {};
  if (!tx || typeof tx !== 'object') return out;
  for (const [k, v] of Object.entries(tx)) {
    if (v && typeof v === 'object' && ('name' in v)) {
      const name = normalizeSpaces(v.name);
      if (name) out[name] = v.value ?? null;
      else out[k] = v.value ?? null;
    } else {
      out[k] = v ?? null;
    }
  }
  return out;
}

function findField(fields, candidates) {
  for (const c of candidates) {
    const key = String(c || '').trim();
    if (!key) continue;
    if (fields[key] != null && String(fields[key]).trim() !== '') return fields[key];
  }
  // Try case-insensitive match
  const keys = Object.keys(fields);
  for (const c of candidates) {
    const needle = String(c || '').trim().toLowerCase();
    if (!needle) continue;
    const hit = keys.find((k) => String(k).toLowerCase() === needle);
    if (hit && fields[hit] != null && String(fields[hit]).trim() !== '') return fields[hit];
  }
  return null;
}

function extractIdPohybu(tx, fields) {
  const direct = findField(fields, ['ID pohybu', 'Id pohybu', 'Movement ID', 'Transaction ID']);
  if (direct != null) return normalizeSpaces(direct);
  try {
    for (const v of Object.values(tx || {})) {
      if (!v || typeof v !== 'object') continue;
      const name = String(v.name || '').toLowerCase();
      if (name.includes('pohybu') && name.includes('id')) return normalizeSpaces(v.value);
      if (Number(v.id) === 22) return normalizeSpaces(v.value);
    }
  } catch {}
  return null;
}

function fingerprintFor(fields, { orgId, accountId }) {
  const parts = [
    `org:${orgId}`,
    `acc:${accountId}`,
    `date:${parseDateYmd(findField(fields, ['Datum', 'Date'])) || ''}`,
    `amount:${parseNumeric(findField(fields, ['Objem', 'Amount'])) || ''}`,
    `vs:${normalizeSpaces(findField(fields, ['VS', 'Variabilní symbol', 'Variable symbol']) || '')}`,
    `ss:${normalizeSpaces(findField(fields, ['SS', 'Specifický symbol', 'Specific symbol']) || '')}`,
    `ks:${normalizeSpaces(findField(fields, ['KS', 'Konstantní symbol', 'Constant symbol']) || '')}`,
    `type:${normalizeSpaces(findField(fields, ['Typ', 'Type']) || '')}`,
    `msg:${normalizeSpaces(findField(fields, ['Zpráva pro příjemce', 'Message for recipient', 'Komentář', 'Comment']) || '')}`,
  ];
  return crypto.createHash('sha256').update(parts.join('|'), 'utf8').digest('hex');
}

export async function ensureFioBankaTransactionsTable(pool) {
  await ensureFioBankaAccountsTable(pool);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.mod_fio_banka_transactions (
      id BIGSERIAL PRIMARY KEY,
      org_id INT NULL,
      account_id INT NULL,
      fio_tx_uid TEXT NOT NULL,
      fio_id_pohybu TEXT NULL,
      booking_date DATE NULL,
      amount NUMERIC NULL,
      currency TEXT NULL,
      tx_type TEXT NULL,
      counterparty_account TEXT NULL,
      counterparty_bank_code TEXT NULL,
      counterparty_name TEXT NULL,
      vs TEXT NULL,
      ss TEXT NULL,
      ks TEXT NULL,
      message TEXT NULL,
      comment TEXT NULL,
      fields JSONB NULL,
      raw JSONB NULL,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_fio_banka_tx_org_account_uid ON public.mod_fio_banka_transactions(org_id, account_id, fio_tx_uid);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_fio_banka_tx_org_date ON public.mod_fio_banka_transactions(org_id, booking_date DESC NULLS LAST);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_fio_banka_tx_org_account_date ON public.mod_fio_banka_transactions(org_id, account_id, booking_date DESC NULLS LAST);`);
}

export async function loadFioAccountsForOrg(pool, orgId) {
  await ensureFioBankaAccountsTable(pool);
  const r = await pool.query(
    `
      SELECT id, label, owner, account_type, currency, is_default, fio_account_id, id_to, last_sync_at, last_sync_from, last_sync_to, updated_at
        FROM public.mod_fio_banka_accounts
       WHERE org_id = $1
       ORDER BY is_default DESC, updated_at DESC, id DESC
    `,
    [orgId]
  );
  return (r.rows || []).map((row) => ({
    id: row.id,
    label: row.label || `#${row.id}`,
    owner: row.owner || null,
    account_type: row.account_type || null,
    is_default: row.is_default === true,
    fio_account_id: row.fio_account_id || null,
    currency: row.currency || null,
    id_to: row.id_to || null,
    last_sync_at: row.last_sync_at || null,
    last_sync_from: row.last_sync_from || null,
    last_sync_to: row.last_sync_to || null,
    updated_at: row.updated_at || null,
  }));
}

export async function listFioTransactions(pool, { orgId, accountId = null, limit = 100, dateAfter = null, dateBefore = null } = {}) {
  const params = [orgId];
  const where = ['org_id=$1'];
  if (Number.isFinite(accountId)) {
    params.push(accountId);
    where.push(`account_id=$${params.length}`);
  }
  if (dateAfter) {
    params.push(dateAfter);
    where.push(`booking_date >= $${params.length}`);
  }
  if (dateBefore) {
    params.push(dateBefore);
    where.push(`booking_date <= $${params.length}`);
  }
  params.push(Math.max(1, Math.min(500, Number(limit || 100))));

  const sql = `
    SELECT id, account_id, fio_tx_uid, fio_id_pohybu, booking_date, amount, currency, tx_type, counterparty_account, counterparty_bank_code, counterparty_name, vs, ss, ks, message
      FROM public.mod_fio_banka_transactions
     WHERE ${where.join(' AND ')}
     ORDER BY booking_date DESC NULLS LAST, id DESC
     LIMIT $${params.length}
  `;
  const r = await pool.query(sql, params);
  return r.rows || [];
}

export async function getFioTransactionStats(pool, { orgId, accountId = null, dateAfter = null, dateBefore = null } = {}) {
  const params = [orgId];
  const where = ['org_id=$1'];
  if (Number.isFinite(accountId)) {
    params.push(accountId);
    where.push(`account_id=$${params.length}`);
  }
  if (dateAfter) {
    params.push(dateAfter);
    where.push(`booking_date >= $${params.length}`);
  }
  if (dateBefore) {
    params.push(dateBefore);
    where.push(`booking_date <= $${params.length}`);
  }

  const r = await pool.query(
    `
      SELECT COUNT(1) AS count_total,
             MIN(booking_date) AS min_date,
             MAX(booking_date) AS max_date
        FROM public.mod_fio_banka_transactions
       WHERE ${where.join(' AND ')}
    `,
    params
  );
  const row = r.rows?.[0] || {};
  return {
    total: Number(row.count_total || 0),
    min_date: row.min_date || null,
    max_date: row.max_date || null,
  };
}

export async function getLatestFioBookingDate(pool, { orgId, accountId }) {
  const r = await pool.query(
    `SELECT MAX(booking_date) AS max_date FROM public.mod_fio_banka_transactions WHERE org_id=$1 AND account_id=$2`,
    [orgId, accountId]
  );
  const max = r.rows?.[0]?.max_date || null;
  if (!max) return null;
  try {
    const d = new Date(max);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

export function fioTransactionToRow(tx, { orgId, accountId, currency = null } = {}) {
  const fields = toFieldsMap(tx);
  const idPohybu = extractIdPohybu(tx, fields);
  const bookingDate = parseDateYmd(findField(fields, ['Datum', 'Date']));
  const amount = parseNumeric(findField(fields, ['Objem', 'Amount']));

  const cpAcc = normalizeSpaces(findField(fields, ['Protiúčet', 'Counterparty account', 'Account']) || '');
  const cpBank = normalizeSpaces(findField(fields, ['Kód banky', 'Bank code']) || '');
  const cpName = normalizeSpaces(findField(fields, ['Název protiúčtu', 'Counterparty name', 'Name']) || '');
  const txType = normalizeSpaces(findField(fields, ['Typ', 'Type']) || '');
  const vs = normalizeSpaces(findField(fields, ['VS', 'Variabilní symbol', 'Variable symbol']) || '');
  const ss = normalizeSpaces(findField(fields, ['SS', 'Specifický symbol', 'Specific symbol']) || '');
  const ks = normalizeSpaces(findField(fields, ['KS', 'Konstantní symbol', 'Constant symbol']) || '');
  const message = normalizeSpaces(findField(fields, ['Zpráva pro příjemce', 'Message for recipient', 'Zprava pro prijemce']) || '');
  const comment = normalizeSpaces(findField(fields, ['Komentář', 'Comment']) || '');

  const uid = idPohybu || fingerprintFor(fields, { orgId, accountId });

  return {
    org_id: orgId,
    account_id: accountId,
    fio_tx_uid: uid,
    fio_id_pohybu: idPohybu,
    booking_date: bookingDate,
    amount,
    currency: currency ? String(currency) : null,
    tx_type: txType || null,
    counterparty_account: cpAcc || null,
    counterparty_bank_code: cpBank || null,
    counterparty_name: cpName || null,
    vs: vs || null,
    ss: ss || null,
    ks: ks || null,
    message: message || null,
    comment: comment || null,
    fields,
    raw: tx && typeof tx === 'object' ? tx : null,
  };
}

export async function upsertFioTransactionRows(pool, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byKey = new Map();
  for (const r of list) {
    if (!r || r.org_id == null || r.account_id == null || !r.fio_tx_uid) continue;
    const key = `${r.org_id}|${r.account_id}|${String(r.fio_tx_uid)}`;
    byKey.set(key, r);
  }
  const clean = Array.from(byKey.values());
  if (!clean.length) return { upserted: 0 };

  const cols = [
    'org_id',
    'account_id',
    'fio_tx_uid',
    'fio_id_pohybu',
    'booking_date',
    'amount',
    'currency',
    'tx_type',
    'counterparty_account',
    'counterparty_bank_code',
    'counterparty_name',
    'vs',
    'ss',
    'ks',
    'message',
    'comment',
    'fields',
    'raw',
  ];

  const params = [];
  const valuesSql = clean.map((row) => {
    const ph = [];
    for (const c of cols) {
      params.push(row[c] ?? null);
      ph.push(`$${params.length}`);
    }
    return `(${ph.join(', ')}, NOW(), NOW())`;
  });

  const sql = `
    INSERT INTO public.mod_fio_banka_transactions (
      ${cols.join(', ')},
      inserted_at,
      updated_at
    ) VALUES
      ${valuesSql.join(',\n')}
    ON CONFLICT (org_id, account_id, fio_tx_uid) DO UPDATE SET
      fio_id_pohybu = EXCLUDED.fio_id_pohybu,
      booking_date = EXCLUDED.booking_date,
      amount = EXCLUDED.amount,
      currency = COALESCE(EXCLUDED.currency, public.mod_fio_banka_transactions.currency),
      tx_type = EXCLUDED.tx_type,
      counterparty_account = EXCLUDED.counterparty_account,
      counterparty_bank_code = EXCLUDED.counterparty_bank_code,
      counterparty_name = EXCLUDED.counterparty_name,
      vs = EXCLUDED.vs,
      ss = EXCLUDED.ss,
      ks = EXCLUDED.ks,
      message = EXCLUDED.message,
      comment = EXCLUDED.comment,
      fields = EXCLUDED.fields,
      raw = EXCLUDED.raw,
      updated_at = NOW()
  `;
  const r = await pool.query(sql, params);
  return { upserted: r.rowCount || 0 };
}
