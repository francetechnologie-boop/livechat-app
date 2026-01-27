import { pickOrgId, toOrgInt } from './fioOrg.js';

export { pickOrgId, toOrgInt };

export function maskToken(token) {
  const s = String(token || '');
  if (!s) return { has_token: false, last4: null };
  const last4 = s.length >= 4 ? s.slice(-4) : s;
  return { has_token: true, last4 };
}

export async function ensureFioBankaAccountsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.mod_fio_banka_accounts (
      id SERIAL PRIMARY KEY,
      org_id INT NULL,
      label TEXT NOT NULL,
      owner TEXT NULL,
      account_type TEXT NULL,
      notes TEXT NULL,
      value JSONB NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      fio_account_id TEXT NULL,
      currency TEXT NULL,
      id_to TEXT NULL,
      last_sync_at TIMESTAMPTZ NULL,
      last_sync_from DATE NULL,
      last_sync_to DATE NULL,
      last_statement_start DATE NULL,
      last_statement_end DATE NULL,
      last_opening_balance NUMERIC NULL,
      last_closing_balance NUMERIC NULL,
      expected_interest_rate NUMERIC NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_mod_fio_banka_accounts UNIQUE(org_id, label)
    );
  `);
  await pool.query(`ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS owner TEXT NULL;`);
  await pool.query(`ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS account_type TEXT NULL;`);
  await pool.query(`ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS notes TEXT NULL;`);
  await pool.query(`ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS last_statement_start DATE NULL;`);
  await pool.query(`ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS last_statement_end DATE NULL;`);
  await pool.query(`ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS last_opening_balance NUMERIC NULL;`);
  await pool.query(`ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS last_closing_balance NUMERIC NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_fio_banka_accounts_org ON public.mod_fio_banka_accounts(org_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_fio_banka_accounts_org_owner ON public.mod_fio_banka_accounts(org_id, owner);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_fio_banka_accounts_org_type ON public.mod_fio_banka_accounts(org_id, account_type);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_mod_fio_banka_accounts_org_statement_end ON public.mod_fio_banka_accounts(org_id, last_statement_end DESC NULLS LAST);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_fio_banka_accounts_default_org ON public.mod_fio_banka_accounts (COALESCE(org_id,0)) WHERE is_default;`);
  await pool.query(`ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS expected_interest_rate NUMERIC NULL;`);
}

export function sanitizeFioAccountRow(row) {
  const value = row?.value && typeof row.value === 'object' ? row.value : {};
  const token = value.token ? String(value.token) : '';
  const mask = maskToken(token);
  return {
    id: row.id,
    org_id: row.org_id ?? null,
    label: row.label || '',
    owner: row.owner || null,
    account_type: row.account_type || null,
    notes: row.notes || null,
    is_default: !!row.is_default,
    token: { ...mask },
    fio_account_id: row.fio_account_id || null,
    currency: row.currency || null,
    id_to: row.id_to || null,
    last_sync_at: row.last_sync_at || null,
    last_sync_from: row.last_sync_from || null,
    last_sync_to: row.last_sync_to || null,
    last_statement_start: row.last_statement_start || null,
    last_statement_end: row.last_statement_end || null,
    last_opening_balance: row.last_opening_balance ?? null,
    last_closing_balance: row.last_closing_balance ?? null,
    expected_interest_rate: row.expected_interest_rate ?? null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}
