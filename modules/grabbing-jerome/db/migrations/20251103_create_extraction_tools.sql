-- Create extraction tools table: per (domain, page_type, version) with optional org_id
CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_extraction_tools (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  page_type TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  name TEXT,
  config JSONB,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  org_id INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Uniqueness per domain/type/version (org-aware when present)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='uq_mod_gj_extraction'
  ) THEN
    CREATE UNIQUE INDEX uq_mod_gj_extraction ON public.mod_grabbing_jerome_extraction_tools (domain, page_type, version, org_id);
  END IF;
END $$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS mod_gj_extraction_domain_type_idx ON public.mod_grabbing_jerome_extraction_tools (domain, page_type);
CREATE INDEX IF NOT EXISTS mod_gj_extraction_org_idx ON public.mod_grabbing_jerome_extraction_tools (org_id);

-- Best-effort FK to organizations table (guarded + idempotent)
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
      ALTER TABLE public.mod_grabbing_jerome_extraction_tools
        ADD CONSTRAINT fk_mod_gj_extraction_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      -- Type/compatibility mismatches or other issues: skip silently to keep migration portable
      WHEN others THEN NULL;
    END;
  END IF;
END $$;
