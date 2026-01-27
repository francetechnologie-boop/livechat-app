-- 20260120_1410_create_fio_banka_transactions.sql

CREATE TABLE IF NOT EXISTS public.mod_fio_banka_transactions (
  id BIGSERIAL PRIMARY KEY,
  org_id INT NULL,
  account_id INT NULL,
  fio_tx_uid TEXT NOT NULL,
  fio_id_pohybu TEXT NULL,
  booking_date DATE NULL,
  amount NUMERIC NULL,
  currency TEXT NULL,
  tx_type TEXT NULL,
  counterparty_account TEXT NULL,
  counterparty_bank_code TEXT NULL,
  counterparty_name TEXT NULL,
  vs TEXT NULL,
  ss TEXT NULL,
  ks TEXT NULL,
  message TEXT NULL,
  comment TEXT NULL,
  fields JSONB NULL,
  raw JSONB NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS org_id INT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS account_id INT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS fio_tx_uid TEXT;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS fio_id_pohybu TEXT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS booking_date DATE NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS amount NUMERIC NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS currency TEXT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS tx_type TEXT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS counterparty_account TEXT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS counterparty_bank_code TEXT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS counterparty_name TEXT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS vs TEXT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS ss TEXT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS ks TEXT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS message TEXT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS comment TEXT NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS fields JSONB NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS raw JSONB NULL;
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.mod_fio_banka_transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_fio_banka_tx_org_account_uid ON public.mod_fio_banka_transactions(org_id, account_id, fio_tx_uid);
CREATE INDEX IF NOT EXISTS idx_mod_fio_banka_tx_org_date ON public.mod_fio_banka_transactions(org_id, booking_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_mod_fio_banka_tx_org_account_date ON public.mod_fio_banka_transactions(org_id, account_id, booking_date DESC NULLS LAST);

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
      ALTER TABLE public.mod_fio_banka_transactions
        ADD CONSTRAINT fk_mod_fio_banka_transactions_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_fio_banka_transactions
      ADD CONSTRAINT fk_mod_fio_banka_transactions_account
      FOREIGN KEY (account_id) REFERENCES public.mod_fio_banka_accounts(id) ON DELETE SET NULL;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_table THEN NULL;
    WHEN others THEN NULL;
  END;
END $$;
