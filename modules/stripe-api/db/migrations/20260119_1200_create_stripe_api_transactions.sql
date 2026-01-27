-- 20260119_1200_create_stripe_api_transactions.sql

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
  raw JSONB NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mod_stripe_api_transactions UNIQUE(org_id, key_id, charge_id)
);

CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_org_created ON public.mod_stripe_api_transactions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_org_key_created ON public.mod_stripe_api_transactions(org_id, key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_org_status ON public.mod_stripe_api_transactions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_org_refunded ON public.mod_stripe_api_transactions(org_id, refunded);
CREATE INDEX IF NOT EXISTS idx_mod_stripe_api_tx_org_dispute ON public.mod_stripe_api_transactions(org_id, dispute_id);

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
      ALTER TABLE public.mod_stripe_api_transactions
        ADD CONSTRAINT fk_mod_stripe_api_transactions_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.mod_stripe_api_keys') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.mod_stripe_api_transactions
        ADD CONSTRAINT fk_mod_stripe_api_transactions_key
        FOREIGN KEY (key_id) REFERENCES public.mod_stripe_api_keys(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

