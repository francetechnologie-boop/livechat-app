import { ensurePaypalApiAccountsTable } from './paypalAccounts.js';

export async function ensurePaypalApiTransactionsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.mod_paypal_api_transactions (
      id BIGSERIAL PRIMARY KEY,
      org_id INT NULL,
      account_id INT NULL,
      paypal_transaction_id TEXT NULL,
      kind TEXT NULL,
      status TEXT NULL,
      amount NUMERIC NULL,
      currency TEXT NULL,
      payer_email TEXT NULL,
      payer_id TEXT NULL,
      reference TEXT NULL,
      id_cart BIGINT NULL,
      created_time TIMESTAMPTZ NULL,
      updated_time TIMESTAMPTZ NULL,
      raw JSONB NULL,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS id_cart BIGINT NULL;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_paypal_api_tx_org_account_txid ON public.mod_paypal_api_transactions(org_id, account_id, paypal_transaction_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_tx_org_created ON public.mod_paypal_api_transactions(org_id, created_time DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_tx_org_account_created ON public.mod_paypal_api_transactions(org_id, account_id, created_time DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_tx_org_status ON public.mod_paypal_api_transactions(org_id, status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_tx_reference ON public.mod_paypal_api_transactions(reference);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_tx_id_cart ON public.mod_paypal_api_transactions(id_cart);`);
}

export async function loadPaypalAccountsForOrg(pool, orgId) {
  await ensurePaypalApiAccountsTable(pool);
  const r = await pool.query(
    `
      SELECT id, name, is_default, value, updated_at
        FROM public.mod_paypal_api_accounts
       WHERE org_id = $1
       ORDER BY is_default DESC, updated_at DESC, id DESC
    `,
    [orgId]
  );
  return (r.rows || []).map((row) => {
    const value = row.value && typeof row.value === 'object' ? row.value : {};
    return {
      id: row.id,
      name: row.name || `#${row.id}`,
      is_default: row.is_default === true,
      mode: value.mode || null,
      updated_at: row.updated_at || null,
    };
  });
}

export async function listPaypalTransactions(pool, { orgId, accountId = null, status = null, limit = 50, createdAfter = null, createdBefore = null } = {}) {
  const params = [orgId];
  const where = ['org_id=$1'];

  if (Number.isFinite(accountId)) {
    params.push(accountId);
    where.push(`account_id=$${params.length}`);
  }
  if (status && String(status).trim()) {
    params.push(String(status).trim());
    where.push(`status=$${params.length}`);
  }
  if (createdAfter) {
    params.push(createdAfter);
    where.push(`created_time >= $${params.length}`);
  }
  if (createdBefore) {
    params.push(createdBefore);
    where.push(`created_time <= $${params.length}`);
  }

  params.push(Math.max(1, Math.min(200, Number(limit || 50))));
  const sql = `
    SELECT id, account_id, paypal_transaction_id, kind, status, amount, currency, payer_email, payer_id, reference, id_cart, created_time, updated_time
      FROM public.mod_paypal_api_transactions
     WHERE ${where.join(' AND ')}
     ORDER BY created_time DESC NULLS LAST, id DESC
     LIMIT $${params.length}
  `;
  const r = await pool.query(sql, params);
  return r.rows || [];
}

export async function getPaypalTransactionStats(pool, { orgId, accountId = null, createdAfter = null, createdBefore = null } = {}) {
  const params = [orgId];
  const where = ['org_id=$1'];
  if (Number.isFinite(accountId)) {
    params.push(accountId);
    where.push(`account_id=$${params.length}`);
  }
  if (createdAfter) {
    params.push(createdAfter);
    where.push(`created_time >= $${params.length}`);
  }
  if (createdBefore) {
    params.push(createdBefore);
    where.push(`created_time <= $${params.length}`);
  }
  const r = await pool.query(
    `
      SELECT COUNT(1) AS count_total,
             COUNT(1) FILTER (WHERE status IS NOT NULL) AS count_with_status,
             COUNT(1) FILTER (WHERE amount IS NOT NULL) AS count_with_amount
        FROM public.mod_paypal_api_transactions
       WHERE ${where.join(' AND ')}
    `,
    params
  );
  const row = r.rows?.[0] || {};
  return {
    total: Number(row.count_total || 0),
    with_status: Number(row.count_with_status || 0),
    with_amount: Number(row.count_with_amount || 0),
  };
}

function extractCartId(value) {
  try {
    const s = String(value || '');
    if (!s) return null;
    // Note: custom_field often continues with underscores, e.g. "Cart ID: 53592_Shop name: ..."
    // Also some exports may contain non-breaking spaces; keep it permissive.
    const m = s.match(/Cart ID[^0-9]{0,20}(\d+)/i);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  } catch {
    return null;
  }
}

export async function backfillPaypalIdCart(pool, { orgId, accountId = null } = {}) {
  const params = [orgId];
  let where = 'org_id=$1';
  if (Number.isFinite(accountId)) {
    params.push(accountId);
    where += ` AND account_id=$${params.length}`;
  }

  // Fill from either reference (preferred) or raw.transaction_info.custom_field.
  // substring(.. from ..) returns the first capture group when the pattern contains ().
  const sql = `
    UPDATE public.mod_paypal_api_transactions t
       SET id_cart = COALESCE(
             t.id_cart,
             NULLIF(substring(COALESCE(t.reference, t.raw->'transaction_info'->>'custom_field', '') from 'Cart ID[^0-9]*([0-9]+)'), '')::BIGINT
           ),
           updated_at = NOW()
     WHERE ${where}
       AND t.id_cart IS NULL
       AND COALESCE(t.reference, t.raw->'transaction_info'->>'custom_field', '') ~* 'Cart ID[^0-9]*[0-9]+'
  `;
  const r = await pool.query(sql, params);
  return { updated: r.rowCount || 0 };
}

export function paypalTransactionToRow(detail, { orgId, accountId }) {
  const info = detail?.transaction_info && typeof detail.transaction_info === 'object' ? detail.transaction_info : {};
  const payer = detail?.payer_info && typeof detail.payer_info === 'object' ? detail.payer_info : {};
  const amt = info?.transaction_amount && typeof info.transaction_amount === 'object' ? info.transaction_amount : null;
  const txid = info?.transaction_id ? String(info.transaction_id) : null;
  const status = info?.transaction_status ? String(info.transaction_status) : null;
  const kind = info?.transaction_event_code ? String(info.transaction_event_code) : null;
  const createdTime = info?.transaction_initiation_date ? String(info.transaction_initiation_date) : null;
  const updatedTime = info?.transaction_updated_date ? String(info.transaction_updated_date) : null;
  const amount = (amt && amt.value != null) ? String(amt.value) : null;
  const currency = (amt && amt.currency_code != null) ? String(amt.currency_code) : null;
  const payerEmail = payer?.email_address ? String(payer.email_address) : null;
  const payerId = payer?.payer_id ? String(payer.payer_id) : null;
  const customField = info?.custom_field ? String(info.custom_field) : null;
  const reference = info?.invoice_id ? String(info.invoice_id) : customField;
  const idCart = extractCartId(customField);

  return {
    org_id: orgId,
    account_id: accountId,
    paypal_transaction_id: txid,
    kind,
    status,
    amount,
    currency,
    payer_email: payerEmail,
    payer_id: payerId,
    reference,
    id_cart: idCart,
    created_time: createdTime,
    updated_time: updatedTime,
    raw: detail && typeof detail === 'object' ? detail : null,
  };
}

export async function upsertPaypalTransactionRows(pool, rows) {
  const list = Array.isArray(rows) ? rows : [];
  // IMPORTANT: Deduplicate inside a single INSERT batch.
  // Postgres errors if one INSERT statement would update the same target row twice:
  // "ON CONFLICT DO UPDATE command cannot affect row a second time".
  const byKey = new Map();
  for (const r of list) {
    if (!r || r.org_id == null || r.account_id == null || !r.paypal_transaction_id) continue;
    const key = `${r.org_id}|${r.account_id}|${String(r.paypal_transaction_id)}`;
    byKey.set(key, r);
  }
  const clean = Array.from(byKey.values());
  if (!clean.length) return { upserted: 0 };

  const cols = [
    'org_id',
    'account_id',
    'paypal_transaction_id',
    'kind',
    'status',
    'amount',
    'currency',
    'payer_email',
    'payer_id',
    'reference',
    'id_cart',
    'created_time',
    'updated_time',
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
    INSERT INTO public.mod_paypal_api_transactions (
      ${cols.join(', ')},
      inserted_at,
      updated_at
    )
    VALUES
      ${valuesSql.join(',\n      ')}
    ON CONFLICT (org_id, account_id, paypal_transaction_id)
    DO UPDATE SET
      kind = EXCLUDED.kind,
      status = EXCLUDED.status,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency,
      payer_email = EXCLUDED.payer_email,
      payer_id = EXCLUDED.payer_id,
      reference = EXCLUDED.reference,
      id_cart = COALESCE(EXCLUDED.id_cart, public.mod_paypal_api_transactions.id_cart),
      created_time = COALESCE(EXCLUDED.created_time, public.mod_paypal_api_transactions.created_time),
      updated_time = COALESCE(EXCLUDED.updated_time, public.mod_paypal_api_transactions.updated_time),
      raw = EXCLUDED.raw,
      updated_at = NOW()
  `;

  const r = await pool.query(sql, params);
  return { upserted: r.rowCount || 0 };
}

export async function getLatestPaypalTransactionTime(pool, { orgId, accountId }) {
  const r = await pool.query(
    `
      SELECT MAX(created_time) AS max_created
        FROM public.mod_paypal_api_transactions
       WHERE org_id=$1 AND account_id=$2
    `,
    [orgId, accountId]
  );
  const v = r.rows?.[0]?.max_created || null;
  return v ? String(v) : null;
}
