-- Create per-table settings storage for grabbing-jerome Step 5
-- Idempotent and safe to re-run

CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_table_settings (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  page_type TEXT NOT NULL,
  table_name TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique row per domain+page_type+table_name
DO $$ BEGIN
  ALTER TABLE public.mod_grabbing_jerome_table_settings
    ADD CONSTRAINT uq_mod_gj_tbl_settings UNIQUE (domain, page_type, table_name);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_mod_gj_tbl_settings_domain ON public.mod_grabbing_jerome_table_settings (domain);
CREATE INDEX IF NOT EXISTS idx_mod_gj_tbl_settings_page_type ON public.mod_grabbing_jerome_table_settings (page_type);

