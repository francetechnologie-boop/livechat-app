-- 20260120_1500_add_balances_to_paypal_accounts.sql

ALTER TABLE public.mod_paypal_api_accounts ADD COLUMN IF NOT EXISTS last_balance JSONB NULL;
ALTER TABLE public.mod_paypal_api_accounts ADD COLUMN IF NOT EXISTS last_balance_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_accounts_org_balance_at ON public.mod_paypal_api_accounts(org_id, last_balance_at DESC NULLS LAST);

