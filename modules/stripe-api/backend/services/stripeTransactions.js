import { stripeRequest } from './stripeHttp.js';

const ZERO_DECIMALS = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
const MAX_LIST_LIMIT = 20000;

// Restrict sync window (user timezone Europe/Prague): 2025-01-01T00:00:00+01:00
export const STRIPE_SYNC_CREATED_GTE_EPOCH = 1735686000;
export const STRIPE_SYNC_CREATED_GTE_LABEL = '2025-01-01';

export function centsToAmount(cents, currency) {
  const c = Number(cents || 0);
  const cur = String(currency || '').toLowerCase();
  const div = ZERO_DECIMALS.has(cur) ? 1 : 100;
  return c / div;
}

function toIsoFromEpochSeconds(epochSeconds) {
  try {
    const n = Number(epochSeconds);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(Math.trunc(n) * 1000).toISOString();
  } catch {
    return null;
  }
}

function pickDisputeId(charge) {
  try {
    const d = charge?.dispute;
    if (!d) return null;
    if (typeof d === 'string') return d;
    if (typeof d === 'object' && typeof d.id === 'string') return d.id;
    return null;
  } catch {
    return null;
  }
}

function pickCustomerEmail(charge) {
  try {
    const email = charge?.billing_details?.email || charge?.receipt_email || null;
    if (!email) return null;
    const s = String(email).trim();
    return s ? s : null;
  } catch {
    return null;
  }
}

function pickRefundCreatedEpoch(charge) {
  try {
    if (!charge?.refunded) return null;
    const list = charge?.refunds?.data;
    if (!Array.isArray(list) || !list.length) return null;
    let max = null;
    for (const r of list) {
      const c = r?.created != null ? Number(r.created) : null;
      if (!Number.isFinite(c)) continue;
      if (max == null || c > max) max = c;
    }
    return max;
  } catch {
    return null;
  }
}

function pickPaymentMethodDetails(charge) {
  try {
    const pmd = charge?.payment_method_details;
    if (!pmd || typeof pmd !== 'object') return { type: null, brand: null, last4: null };
    const type = pmd.type ? String(pmd.type) : null;
    if (type === 'card' && pmd.card && typeof pmd.card === 'object') {
      const brand = pmd.card.brand ? String(pmd.card.brand) : null;
      const last4 = pmd.card.last4 ? String(pmd.card.last4) : null;
      return { type, brand, last4 };
    }
    return { type, brand: null, last4: null };
  } catch {
    return { type: null, brand: null, last4: null };
  }
}

export async function ensureKeysTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.mod_stripe_api_keys (
      id SERIAL PRIMARY KEY,
      org_id INT NULL,
      name TEXT NOT NULL,
      value JSONB NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      last_balance JSONB NULL,
      last_balance_at TIMESTAMPTZ NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT uq_mod_stripe_api_keys UNIQUE(org_id, name)
    );
  `);
  await pool.query(`ALTER TABLE public.mod_stripe_api_keys ADD COLUMN IF NOT EXISTS last_balance JSONB NULL;`);
  await pool.query(`ALTER TABLE public.mod_stripe_api_keys ADD COLUMN IF NOT EXISTS last_balance_at TIMESTAMPTZ NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_keys_org ON public.mod_stripe_api_keys(org_id);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_stripe_api_keys_default_org ON public.mod_stripe_api_keys (COALESCE(org_id,0)) WHERE is_default;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_keys_org_balance_at ON public.mod_stripe_api_keys(org_id, last_balance_at DESC NULLS LAST);`);
}


export async function ensureTransactionsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.mod_stripe_api_transactions (
      id BIGSERIAL PRIMARY KEY,
      org_id INT NULL,
      key_id INT NULL,
      stripe_account_id TEXT NULL,
      charge_id TEXT NOT NULL,
      payment_intent_id TEXT NULL,
      created_epoch BIGINT NULL,
      created_at TIMESTAMPTZ NULL,
      amount_cents BIGINT NULL,
      currency TEXT NULL,
      status TEXT NULL,
      paid BOOLEAN NULL,
      captured BOOLEAN NULL,
      refunded BOOLEAN NULL,
      amount_refunded_cents BIGINT NULL,
      refund_created_epoch BIGINT NULL,
      refund_created_at TIMESTAMPTZ NULL,
      dispute_id TEXT NULL,
      failure_code TEXT NULL,
      failure_message TEXT NULL,
      description TEXT NULL,
      customer_id TEXT NULL,
      customer_email TEXT NULL,
      payment_method_type TEXT NULL,
      payment_method_brand TEXT NULL,
      payment_method_last4 TEXT NULL,
      livemode BOOLEAN NULL,
      reference TEXT NULL,
      order_id TEXT NULL,
      cart_id TEXT NULL,
      raw JSONB NULL,
      inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_mod_stripe_api_transactions UNIQUE(org_id, key_id, charge_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_org_created ON public.mod_stripe_api_transactions(org_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_org_key_created ON public.mod_stripe_api_transactions(org_id, key_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_org_status ON public.mod_stripe_api_transactions(org_id, status);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_org_refunded ON public.mod_stripe_api_transactions(org_id, refunded);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_org_dispute ON public.mod_stripe_api_transactions(org_id, dispute_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_reference ON public.mod_stripe_api_transactions(reference);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_order ON public.mod_stripe_api_transactions(order_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_cart ON public.mod_stripe_api_transactions(cart_id);`);
}

export async function loadStripeKeysForOrg(pool, orgId, keyId = null) {
  const params = [orgId];
  let where = 'org_id=$1';
  if (Number.isFinite(keyId)) {
    where += ' AND id=$2';
    params.push(keyId);
  }
  const r = await pool.query(
    `
      SELECT id, name, is_default, value, updated_at
        FROM public.mod_stripe_api_keys
       WHERE ${where}
       ORDER BY is_default DESC, updated_at DESC, id DESC
    `,
    params
  );
  const items = [];
  for (const row of (r.rows || [])) {
    const value = row.value && typeof row.value === 'object' ? row.value : {};
    const secretKey = value.secret_key ? String(value.secret_key) : '';
    if (!secretKey) continue;
    items.push({
      id: row.id,
      name: row.name,
      is_default: row.is_default === true,
      secretKey,
      account_id: value.account_id || null,
      mode: value.mode || null,
      updated_at: row.updated_at || null,
    });
  }
  return items;
}

export function chargeToRow(charge, { orgId, keyId, stripeAccountId }) {
  const paymentIntent = (charge && typeof charge.payment_intent === 'object' && charge.payment_intent) ? charge.payment_intent : null;
  const paymentIntentId = paymentIntent?.id ? String(paymentIntent.id) : (charge?.payment_intent ? String(charge.payment_intent) : null);
  const createdEpoch = charge?.created != null ? Number(charge.created) : null;
  const createdAtIso = toIsoFromEpochSeconds(createdEpoch);
  const refundCreatedEpoch = pickRefundCreatedEpoch(charge);
  const refundCreatedAtIso = toIsoFromEpochSeconds(refundCreatedEpoch);
  const { type: pmType, brand: pmBrand, last4: pmLast4 } = pickPaymentMethodDetails(charge);
  const descFromPi = paymentIntent?.description ? String(paymentIntent.description) : null;
  const descFromCharge = charge?.description ? String(charge.description) : null;
  const bestDescription = (descFromPi && descFromPi.trim()) ? descFromPi.trim() : ((descFromCharge && descFromCharge.trim()) ? descFromCharge.trim() : null);
  const descSegments = parseDescriptionSegments(bestDescription);
  const { reference, orderId, cartId } = extractChargeMetadata(charge, descSegments);

  return {
    org_id: orgId,
    key_id: keyId,
    stripe_account_id: stripeAccountId || null,
    charge_id: String(charge?.id || '').trim(),
    payment_intent_id: paymentIntentId,
    created_epoch: Number.isFinite(createdEpoch) ? Math.trunc(createdEpoch) : null,
    created_at: createdAtIso,
    amount_cents: charge?.amount != null ? Number(charge.amount) : null,
    currency: charge?.currency ? String(charge.currency) : null,
    status: charge?.status ? String(charge.status) : null,
    paid: charge?.paid === true,
    captured: charge?.captured === true,
    refunded: charge?.refunded === true,
    amount_refunded_cents: charge?.amount_refunded != null ? Number(charge.amount_refunded) : null,
    refund_created_epoch: Number.isFinite(refundCreatedEpoch) ? Math.trunc(refundCreatedEpoch) : null,
    refund_created_at: refundCreatedAtIso,
    dispute_id: pickDisputeId(charge),
    failure_code: charge?.failure_code ? String(charge.failure_code) : null,
    failure_message: charge?.failure_message ? String(charge.failure_message) : null,
    description: bestDescription,
    customer_id: charge?.customer ? String(charge.customer) : null,
    customer_email: pickCustomerEmail(charge),
    payment_method_type: pmType,
    payment_method_brand: pmBrand,
    payment_method_last4: pmLast4,
    livemode: charge?.livemode === true,
    reference: reference,
    order_id: orderId,
    cart_id: cartId,
    raw: charge && typeof charge === 'object' ? charge : null,
  };
}

export async function upsertTransactionRows(pool, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { upserted: 0 };

  const cols = [
    'org_id',
    'key_id',
    'stripe_account_id',
    'charge_id',
    'payment_intent_id',
    'created_epoch',
    'created_at',
    'amount_cents',
    'currency',
    'status',
    'paid',
    'captured',
    'refunded',
    'amount_refunded_cents',
    'refund_created_epoch',
    'refund_created_at',
    'dispute_id',
    'failure_code',
    'failure_message',
    'description',
    'customer_id',
    'customer_email',
    'payment_method_type',
    'payment_method_brand',
    'payment_method_last4',
    'livemode',
    'reference',
    'order_id',
    'cart_id',
    'raw',
  ];

  const values = [];
  const chunks = [];
  const rowSize = cols.length;

  for (let i = 0; i < list.length; i++) {
    const base = i * rowSize;
    const placeholders = cols.map((_, j) => `$${base + j + 1}`);
    chunks.push(`(${placeholders.join(',')})`);
    for (const c of cols) values.push(list[i]?.[c] ?? null);
  }

  const sql = `
    INSERT INTO public.mod_stripe_api_transactions (${cols.join(',')})
    VALUES ${chunks.join(',')}
    ON CONFLICT (org_id, key_id, charge_id) DO UPDATE SET
      stripe_account_id = EXCLUDED.stripe_account_id,
      payment_intent_id = EXCLUDED.payment_intent_id,
      created_epoch = EXCLUDED.created_epoch,
      created_at = EXCLUDED.created_at,
      amount_cents = EXCLUDED.amount_cents,
      currency = EXCLUDED.currency,
      status = EXCLUDED.status,
      paid = EXCLUDED.paid,
      captured = EXCLUDED.captured,
      refunded = EXCLUDED.refunded,
      amount_refunded_cents = EXCLUDED.amount_refunded_cents,
      refund_created_epoch = EXCLUDED.refund_created_epoch,
      refund_created_at = EXCLUDED.refund_created_at,
      dispute_id = EXCLUDED.dispute_id,
      failure_code = EXCLUDED.failure_code,
      failure_message = EXCLUDED.failure_message,
      description = EXCLUDED.description,
      customer_id = EXCLUDED.customer_id,
      customer_email = EXCLUDED.customer_email,
      payment_method_type = EXCLUDED.payment_method_type,
      payment_method_brand = EXCLUDED.payment_method_brand,
      payment_method_last4 = EXCLUDED.payment_method_last4,
      livemode = EXCLUDED.livemode,
      reference = EXCLUDED.reference,
      order_id = EXCLUDED.order_id,
      cart_id = EXCLUDED.cart_id,
      raw = EXCLUDED.raw,
      updated_at = NOW()
  `;

  await pool.query(sql, values);
  return { upserted: list.length };
}

async function getLatestStoredCreatedEpoch(pool, { orgId, keyId }) {
  try {
    const r = await pool.query(
      `
        SELECT MAX(created_epoch)::bigint AS max_created
        FROM public.mod_stripe_api_transactions
        WHERE org_id=$1 AND key_id=$2
      `,
      [orgId, keyId]
    );
    const n = Number(r.rows?.[0]?.max_created);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  } catch {
    return null;
  }
}

export async function syncChargesForKey({
  pool,
  orgId,
  key,
  limit: limitOverride,
  pages: pagesOverride,
  chunkMonths = 0,
  createdGte = null,
  createdLte = null,
  incremental = true,
}) {
  const limit = Math.min(100, Math.max(1, Number((limitOverride ?? key?.limit) || 50)));
  const pages = Math.min(24, Math.max(1, Number((pagesOverride ?? key?.pages) || 1)));
  const secretKey = String(key?.secretKey || '').trim();
  if (!secretKey) return { fetched: 0, upserted: 0 };

  const minCreated = STRIPE_SYNC_CREATED_GTE_EPOCH;
  let effectiveGte = Number.isFinite(createdGte) ? Math.trunc(createdGte) : null;
  const effectiveLte = Number.isFinite(createdLte) ? Math.trunc(createdLte) : null;

  if (effectiveGte == null && incremental) {
    const latest = await getLatestStoredCreatedEpoch(pool, { orgId, keyId: key.id });
    if (Number.isFinite(latest)) {
      // overlap to account for out-of-order settlement/refunds
      effectiveGte = Math.max(minCreated, latest - 7 * 24 * 3600);
    }
  }
  if (effectiveGte == null) effectiveGte = minCreated;
  if (effectiveGte < minCreated) effectiveGte = minCreated;

  if (!Number.isFinite(chunkMonths) || chunkMonths <= 0) {
    const items = await fetchChargesWindow({ secretKey, limit, pages, createdGte: effectiveGte, createdLte: effectiveLte });
    const rows = items
      .map((charge) => chargeToRow(charge, { orgId, keyId: key.id, stripeAccountId: key.account_id }))
      .filter((row) => row && row.charge_id);
    const { upserted } = await upsertTransactionRows(pool, rows);
    return { fetched: items.length, upserted };
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  const windowEndEpoch = effectiveLte != null ? effectiveLte : nowEpoch;
  const windows = buildMonthlyWindows(effectiveGte, windowEndEpoch, chunkMonths);
  let totalFetched = 0;
  let totalUpserted = 0;
  for (const win of windows) {
    const items = await fetchChargesWindow({ secretKey, limit, pages, createdGte: win.start, createdLte: win.end });
    if (!items.length) continue;
    const rows = items
      .map((charge) => chargeToRow(charge, { orgId, keyId: key.id, stripeAccountId: key.account_id }))
      .filter((row) => row && row.charge_id);
    const { upserted } = await upsertTransactionRows(pool, rows);
    totalFetched += items.length;
    totalUpserted += upserted;
  }
  return { fetched: totalFetched, upserted: totalUpserted };
}

function pickMetaValue(meta, keys) {
  try {
    const obj = (meta && typeof meta === 'object') ? meta : null;
    if (!obj) return null;
    for (const k of keys) {
      const v = obj[k];
      if (v == null) continue;
      const s = String(v).trim();
      if (s) return s;
    }
    return null;
  } catch {
    return null;
  }
}

function buildDescriptionDisplay({ description, metaReference, metaOrder, metaCart }) {
  const base = String(description || '').trim();
  const parts = [];
  if (base) parts.push(base);
  if (metaReference) parts.push(`Reference: ${metaReference}`);
  if (metaOrder) parts.push(`Order: ${metaOrder}`);
  else if (metaCart) parts.push(`Cart: ${metaCart}`);
  return parts.join(' / ') || null;
}

function parseDescriptionSegments(value) {
  try {
    const desc = String(value || '');
    if (!desc) return {};
    const normalize = (s) => s.replace(/[\\s]+/g, ' ').trim();
    const matchValue = (label) => {
      const regex = new RegExp(`${label}:\\s*([^/]+)`, 'i');
      const found = desc.match(regex);
      if (!found) return null;
      return normalize(found[1]);
    };
    return {
      reference: matchValue('Reference'),
      order: matchValue('Order'),
      cart: matchValue('Cart'),
    };
  } catch {
    return {};
  }
}

function buildMonthlyWindows(fromEpoch, toEpoch, months) {
  const chunkMonths = Math.max(1, Math.trunc(months || 1));
  const windows = [];
  const startEpoch = Math.max(Math.floor(fromEpoch), STRIPE_SYNC_CREATED_GTE_EPOCH);
  const finalEpoch = Math.max(Math.floor(toEpoch), startEpoch);
  let cursor = startEpoch;
  while (cursor <= finalEpoch) {
    const startDate = new Date(cursor * 1000);
    startDate.setUTCMinutes(0, 0, 0);
    const monthAnchor = new Date(startDate);
    monthAnchor.setUTCDate(1);
    monthAnchor.setUTCHours(0, 0, 0, 0);
    const next = new Date(monthAnchor);
    next.setUTCMonth(next.getUTCMonth() + chunkMonths);
    next.setUTCDate(1);
    next.setUTCHours(0, 0, 0, 0);
    let windowEnd = Math.min(finalEpoch, Math.floor(next.getTime() / 1000) - 1);
    if (windowEnd < cursor) windowEnd = finalEpoch;
    windows.push({ start: cursor, end: windowEnd });
    if (windowEnd >= finalEpoch) break;
    cursor = windowEnd + 1;
  }
  return windows;
}

async function fetchChargesWindow({ secretKey, limit, pages, createdGte, createdLte }) {
  const all = [];
  let startingAfter = null;
  for (let page = 0; page < pages; page++) {
    const params = { limit, 'created[gte]': createdGte, 'expand[]': 'data.payment_intent' };
    if (createdLte != null) params['created[lte]'] = createdLte;
    if (startingAfter) params.starting_after = startingAfter;
    const r = await stripeRequest({ secretKey, method: 'GET', path: '/v1/charges', params });
    const items = Array.isArray(r.data?.data) ? r.data.data : [];
    for (const it of items) {
      const created = it?.created != null ? Number(it.created) : null;
      if (Number.isFinite(created) && created < createdGte) continue;
      if (createdLte != null && Number.isFinite(created) && created > createdLte) continue;
      all.push(it);
    }
    if (!items.length) break;
    startingAfter = items[items.length - 1]?.id || null;
    if (!r.data?.has_more) break;
  }
  return all;
}

function extractChargeMetadata(charge, descSegments = {}) {
  const metadata = (charge?.payment_intent && typeof charge.payment_intent === 'object' ? charge.payment_intent.metadata : null) || charge?.metadata || null;
  const reference = pickMetaValue(metadata, ['reference', 'order_reference', 'ref', 'reference_id', 'orderRef', 'order_ref']) || descSegments.reference || null;
  const orderId = pickMetaValue(metadata, ['id_order', 'order_id', 'order', 'prestashop_order_id', 'ps_order_id']) || descSegments.order || null;
  const cartId = pickMetaValue(metadata, ['id_cart', 'cart_id', 'cart', 'prestashop_cart_id', 'ps_cart_id']) || descSegments.cart || null;
  return { reference, orderId, cartId };
}

export async function listTransactions(pool, { orgId, keyId = null, status = null, limit = 25, createdAfter = null, createdBefore = null }) {
  const lim = Math.min(MAX_LIST_LIMIT, Math.max(1, Number(limit || 25)));
  const params = [orgId];
  let where = `t.org_id=$1`;

  if (Number.isFinite(keyId)) {
    params.push(keyId);
    where += ` AND t.key_id=$${params.length}`;
  }

  if (Number.isFinite(createdAfter)) {
    params.push(createdAfter);
    where += ` AND t.created_epoch >= $${params.length}`;
  }
  if (Number.isFinite(createdBefore)) {
    params.push(createdBefore);
    where += ` AND t.created_epoch <= $${params.length}`;
  }

  const st = String(status || '').trim().toLowerCase();
  if (st === 'succeeded') where += ` AND t.status='succeeded'`;
  else if (st === 'refunded') where += ` AND t.refunded IS TRUE`;
  else if (st === 'disputed') where += ` AND (t.dispute_id IS NOT NULL AND t.dispute_id <> '')`;
  else if (st === 'failed') where += ` AND (t.status='failed' OR t.failure_code IS NOT NULL)`;
  else if (st === 'uncaptured') where += ` AND t.captured IS FALSE`;

  params.push(lim);
  const r = await pool.query(
    `
      SELECT
        t.*,
        k.name AS key_name,
        (k.value->>'mode') AS key_mode,
        (k.value->>'account_id') AS key_account_id
      FROM public.mod_stripe_api_transactions t
      LEFT JOIN public.mod_stripe_api_keys k ON k.id = t.key_id
      WHERE ${where}
      ORDER BY t.created_at DESC NULLS LAST, t.id DESC
      LIMIT $${params.length}
    `,
    params
  );

  const items = (r.rows || []).map((row) => {
    const descSegments = parseDescriptionSegments(row.description);
    const rawPayload = row.raw && typeof row.raw === 'object' ? row.raw : null;
    const payloadMeta = (rawPayload?.payment_intent && typeof rawPayload.payment_intent === 'object'
      ? rawPayload.payment_intent.metadata
      : null) || rawPayload?.metadata || null;
    const metaReference = pickMetaValue(payloadMeta, ['reference', 'order_reference', 'ref', 'reference_id', 'orderRef', 'order_ref']) || descSegments.reference;
    const metaOrder = pickMetaValue(payloadMeta, ['id_order', 'order_id', 'order', 'prestashop_order_id', 'ps_order_id']) || descSegments.order;
    const metaCart = pickMetaValue(payloadMeta, ['id_cart', 'cart_id', 'cart', 'prestashop_cart_id', 'ps_cart_id']) || descSegments.cart;
    return {
      id: row.charge_id,
      key_id: row.key_id,
      key_name: row.key_name || null,
      key_mode: row.key_mode || null,
      key_account_id: row.key_account_id || row.stripe_account_id || null,
      created: row.created_epoch != null ? Number(row.created_epoch) : null,
      created_at: row.created_at || null,
      amount: centsToAmount(row.amount_cents, row.currency),
      amount_cents: row.amount_cents != null ? Number(row.amount_cents) : null,
      currency: row.currency || null,
      status: row.status || null,
      paid: row.paid === true,
      captured: row.captured === true,
      refunded: row.refunded === true,
      amount_refunded: centsToAmount(row.amount_refunded_cents, row.currency),
      amount_refunded_cents: row.amount_refunded_cents != null ? Number(row.amount_refunded_cents) : null,
      refund_created: row.refund_created_epoch != null ? Number(row.refund_created_epoch) : null,
      dispute_id: row.dispute_id || null,
      description: row.description || null,
      payment_intent_id: row.payment_intent_id || null,
      customer_email: row.customer_email || null,
      payment_method_type: row.payment_method_type || null,
      payment_method_brand: row.payment_method_brand || null,
      payment_method_last4: row.payment_method_last4 || null,
      failure_code: row.failure_code || null,
      livemode: row.livemode === true,
      client_name: (() => {
        try {
          const name = rawPayload?.billing_details?.name || rawPayload?.shipping?.name || null;
          if (!name) return null;
          const s = String(name).trim();
          return s ? s : null;
        } catch {
          return null;
        }
      })(),
      receipt_url: (() => {
        try {
          const u = rawPayload?.receipt_url || null;
          if (!u) return null;
          const s = String(u).trim();
          return s ? s : null;
        } catch {
          return null;
        }
      })(),
      statement_descriptor: (() => {
        try {
          const v = rawPayload?.calculated_statement_descriptor || rawPayload?.statement_descriptor || rawPayload?.statement_descriptor_suffix || null;
          if (!v) return null;
          const s = String(v).trim();
          return s ? s : null;
        } catch {
          return null;
        }
      })(),
      meta_reference: metaReference,
      meta_order: metaOrder,
      meta_cart: metaCart,
      description_display: (() => {
        const descMetaReference = metaReference;
        const descMetaOrder = metaOrder;
        const descMetaCart = metaCart;
        return buildDescriptionDisplay({
          description: row.description || null,
          metaReference: descMetaReference,
          metaOrder: descMetaOrder,
          metaCart: descMetaCart,
        });
      })(),
    };
  });

  return items;
}

export async function getTransactionStats(pool, { orgId, keyId = null, createdAfter = null, createdBefore = null }) {
  const params = [orgId];
  let where = `org_id=$1`;
  if (Number.isFinite(keyId)) {
    params.push(keyId);
    where += ` AND key_id=$${params.length}`;
  }
  if (Number.isFinite(createdAfter)) {
    params.push(createdAfter);
    where += ` AND created_epoch >= $${params.length}`;
  }
  if (Number.isFinite(createdBefore)) {
    params.push(createdBefore);
    where += ` AND created_epoch <= $${params.length}`;
  }
  const r = await pool.query(
    `
      SELECT
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE status='succeeded')::bigint AS succeeded,
        COUNT(*) FILTER (WHERE refunded IS TRUE)::bigint AS refunded,
        COUNT(*) FILTER (WHERE dispute_id IS NOT NULL AND dispute_id <> '')::bigint AS disputed,
        COUNT(*) FILTER (WHERE status='failed' OR failure_code IS NOT NULL)::bigint AS failed,
        COUNT(*) FILTER (WHERE captured IS FALSE)::bigint AS uncaptured
      FROM public.mod_stripe_api_transactions
      WHERE ${where}
    `,
    params
  );
  const row = r.rows?.[0] || {};
  const toN = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    total: toN(row.total),
    succeeded: toN(row.succeeded),
    refunded: toN(row.refunded),
    disputed: toN(row.disputed),
    failed: toN(row.failed),
    uncaptured: toN(row.uncaptured),
  };
}
