-- 20260120_1500_add_balances_to_stripe_api_keys.sql

ALTER TABLE public.mod_stripe_api_keys ADD COLUMN IF NOT EXISTS last_balance JSONB NULL;
ALTER TABLE public.mod_stripe_api_keys ADD COLUMN IF NOT EXISTS last_balance_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_keys_org_balance_at ON public.mod_stripe_api_keys(org_id, last_balance_at DESC NULLS LAST);

