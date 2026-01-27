-- 20260120_1200_create_paypal_api_accounts.sql

CREATE TABLE IF NOT EXISTS public.mod_paypal_api_accounts (
  id SERIAL PRIMARY KEY,
  org_id INT NULL,
  name TEXT NOT NULL,
  value JSONB NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_mod_paypal_api_accounts UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mod_paypal_api_accounts_org ON public.mod_paypal_api_accounts(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_paypal_api_accounts_default_org ON public.mod_paypal_api_accounts (COALESCE(org_id,0)) WHERE is_default;

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
      ALTER TABLE public.mod_paypal_api_accounts
        ADD CONSTRAINT fk_mod_paypal_api_accounts_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

