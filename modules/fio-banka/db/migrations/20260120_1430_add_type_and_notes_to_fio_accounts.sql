-- 20260120_1430_add_type_and_notes_to_fio_accounts.sql

ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS account_type TEXT NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS notes TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_mod_fio_banka_accounts_org_type ON public.mod_fio_banka_accounts(org_id, account_type);

