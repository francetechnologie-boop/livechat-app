-- 20260120_1300_create_paypal_api_transactions.sql

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

ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS org_id INT NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS account_id INT NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS paypal_transaction_id TEXT NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS kind TEXT NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS status TEXT NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS amount NUMERIC NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS currency TEXT NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS payer_email TEXT NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS payer_id TEXT NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS reference TEXT NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS id_cart BIGINT NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS created_time TIMESTAMPTZ NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS updated_time TIMESTAMPTZ NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS raw JSONB NULL;
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.mod_paypal_api_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_tx_org_created ON public.mod_paypal_api_transactions(org_id, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_tx_org_account_created ON public.mod_paypal_api_transactions(org_id, account_id, created_time DESC);
CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_tx_org_status ON public.mod_paypal_api_transactions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_tx_reference ON public.mod_paypal_api_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_tx_id_cart ON public.mod_paypal_api_transactions(id_cart);

DO $$ BEGIN
  IF to_regclass('public.organizations') IS NOT NULL AND EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
     WHERE n.nspname = 'public' AND t.relname = 'organizations'
       AND i.indisunique = TRUE
       AND array_length(i.indkey,1) = 1
       AND a.attname = 'id'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_paypal_api_transactions
        ADD CONSTRAINT fk_mod_paypal_api_transactions_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_paypal_api_transactions
      ADD CONSTRAINT fk_mod_paypal_api_transactions_account
      FOREIGN KEY (account_id) REFERENCES public.mod_paypal_api_accounts(id) ON DELETE SET NULL;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_table THEN NULL;
    WHEN others THEN NULL;
  END;
END $$;
