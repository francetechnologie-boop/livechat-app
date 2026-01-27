-- 20260120_1420_add_owner_currency_interest_to_fio_accounts.sql

ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS owner TEXT NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS expected_interest_rate NUMERIC NULL;

-- currency already exists; keep idempotent just in case older envs differ
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS currency TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_mod_fio_banka_accounts_org_owner ON public.mod_fio_banka_accounts(org_id, owner);

