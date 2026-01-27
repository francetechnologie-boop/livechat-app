-- Restore compatibility table for per-table settings expected by UI and auto-check
-- Idempotent recreation with required indexes and unique constraint.

CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_table_settings (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  page_type TEXT NOT NULL,
  table_name TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique guard on (domain,page_type,table_name)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname='public' AND t.relname='mod_grabbing_jerome_table_settings' AND c.conname='uq_mod_gj_tbl_settings'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_grabbing_jerome_table_settings
        ADD CONSTRAINT uq_mod_gj_tbl_settings UNIQUE (domain, page_type, table_name);
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

-- Optional columns used by the module
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_grabbing_jerome_table_settings' AND column_name='mapping'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_grabbing_jerome_table_settings ADD COLUMN mapping JSONB NULL;
    EXCEPTION WHEN duplicate_column THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_grabbing_jerome_table_settings' AND column_name='setting_image'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_grabbing_jerome_table_settings ADD COLUMN setting_image JSONB NULL;
    EXCEPTION WHEN duplicate_column THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

-- Helpful indexes for auto-check and queries
CREATE INDEX IF NOT EXISTS idx_mod_gj_tbl_settings_domain ON public.mod_grabbing_jerome_table_settings (domain);
CREATE INDEX IF NOT EXISTS idx_mod_gj_tbl_settings_page_type ON public.mod_grabbing_jerome_table_settings (page_type);

