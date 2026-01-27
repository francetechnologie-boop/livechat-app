-- History table: persisted extraction test runs
CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_extraction_runs (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  url TEXT NOT NULL,
  page_type TEXT NOT NULL DEFAULT 'product',
  version INTEGER NULL,
  config_hash TEXT NULL,
  config JSONB NULL,
  result JSONB NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT TRUE,
  error TEXT NULL,
  org_id INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS mod_gj_runs_domain_url_idx ON public.mod_grabbing_jerome_extraction_runs (domain, lower(trim(both from url)));
CREATE INDEX IF NOT EXISTS mod_gj_runs_created_idx ON public.mod_grabbing_jerome_extraction_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS mod_gj_runs_cfg_idx ON public.mod_grabbing_jerome_extraction_runs (config_hash);
CREATE INDEX IF NOT EXISTS mod_gj_runs_org_idx ON public.mod_grabbing_jerome_extraction_runs (org_id);

-- Optional FK to organizations table
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
      ALTER TABLE public.mod_grabbing_jerome_extraction_runs
        ADD CONSTRAINT fk_mod_gj_runs_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;
