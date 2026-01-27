-- 20260120_1400_create_fio_banka_accounts.sql

CREATE TABLE IF NOT EXISTS public.mod_fio_banka_accounts (
  id SERIAL PRIMARY KEY,
  org_id INT NULL,
  label TEXT NOT NULL,
  value JSONB NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  fio_account_id TEXT NULL,
  currency TEXT NULL,
  id_to TEXT NULL,
  last_sync_at TIMESTAMPTZ NULL,
  last_sync_from DATE NULL,
  last_sync_to DATE NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mod_fio_banka_accounts UNIQUE(org_id, label)
);

ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS org_id INT NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS value JSONB NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS fio_account_id TEXT NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS currency TEXT NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS id_to TEXT NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS last_sync_from DATE NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS last_sync_to DATE NULL;
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.mod_fio_banka_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- For older environments where the table pre-exists without the UNIQUE constraint
CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_fio_banka_accounts ON public.mod_fio_banka_accounts(org_id, label);

CREATE INDEX IF NOT EXISTS idx_mod_fio_banka_accounts_org ON public.mod_fio_banka_accounts(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_fio_banka_accounts_default_org ON public.mod_fio_banka_accounts (COALESCE(org_id,0)) WHERE is_default;

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
      ALTER TABLE public.mod_fio_banka_accounts
        ADD CONSTRAINT fk_mod_fio_banka_accounts_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;
