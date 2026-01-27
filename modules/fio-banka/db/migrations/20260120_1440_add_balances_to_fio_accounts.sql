-- 20260120_1440_add_balances_to_fio_accounts.sql

ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS last_statement_start DATE NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS last_statement_end DATE NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS last_opening_balance NUMERIC NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS last_closing_balance NUMERIC NULL;

CREATE INDEX IF NOT EXISTS idx_mod_fio_banka_accounts_org_statement_end ON public.mod_fio_banka_accounts(org_id, last_statement_end DESC NULLS LAST);

