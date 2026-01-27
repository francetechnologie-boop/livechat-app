export function pickOrgId(req) {
  try {
    const raw = req.body?.org_id ?? req.headers['x-org-id'] ?? req.query?.org_id;
    if (raw === null || raw === undefined) return null;
    const trimmed = String(raw).trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export function toOrgInt(value) {
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

export function requireAdminGuard(ctx = {}) {
  if (typeof ctx.requireAdmin === 'function') return ctx.requireAdmin;
  return () => true;
}

export function normalizeMode(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (m === 'sandbox') return 'sandbox';
  return 'live';
}

export function maskClientId(clientId) {
  const s = String(clientId || '');
  if (!s) return { present: false, last6: null };
  const last6 = s.length >= 6 ? s.slice(-6) : s;
  return { present: true, last6 };
}

export function maskSecret(secret) {
  const s = String(secret || '');
  if (!s) return { has_secret: false, last4: null };
  const last4 = s.length >= 4 ? s.slice(-4) : s;
  return { has_secret: true, last4 };
}

export async function ensurePaypalApiAccountsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.mod_paypal_api_accounts (
      id SERIAL PRIMARY KEY,
      org_id INT NULL,
      name TEXT NOT NULL,
      value JSONB NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      last_balance JSONB NULL,
      last_balance_at TIMESTAMPTZ NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      CONSTRAINT uq_mod_paypal_api_accounts UNIQUE(org_id, name)
    );
  `);
  await pool.query(`ALTER TABLE public.mod_paypal_api_accounts ADD COLUMN IF NOT EXISTS last_balance JSONB NULL;`);
  await pool.query(`ALTER TABLE public.mod_paypal_api_accounts ADD COLUMN IF NOT EXISTS last_balance_at TIMESTAMPTZ NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_accounts_org ON public.mod_paypal_api_accounts(org_id);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_paypal_api_accounts_default_org ON public.mod_paypal_api_accounts (COALESCE(org_id,0)) WHERE is_default;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_accounts_org_balance_at ON public.mod_paypal_api_accounts(org_id, last_balance_at DESC NULLS LAST);`);
}

export function sanitizePaypalAccountRow(row) {
  const value = row?.value && typeof row.value === 'object' ? row.value : {};
  const clientId = value.client_id ? String(value.client_id) : '';
  const clientSecret = value.client_secret ? String(value.client_secret) : '';
  const cid = maskClientId(clientId);
  const sec = maskSecret(clientSecret);
  return {
    id: row.id,
    org_id: row.org_id ?? null,
    name: row.name || '',
    is_default: !!row.is_default,
    mode: normalizeMode(value.mode),
    app_id: value.app_id || null,
    scope: value.scope || null,
    client_id_last6: cid.last6,
    has_secret: sec.has_secret,
    secret_last4: sec.last4,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}
