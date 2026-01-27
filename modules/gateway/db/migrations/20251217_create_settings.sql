-- Create module-scoped settings table for Gateway
-- Idempotent and guarded per AGENTS.md

CREATE TABLE IF NOT EXISTS public.mod_gateway_settings (
  id BIGSERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  key TEXT NOT NULL,
  value TEXT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_mod_gateway_settings UNIQUE (org_id, key)
);

-- Guarded foreign key to organizations(id)
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
      ALTER TABLE public.mod_gateway_settings
        ADD CONSTRAINT fk_mod_gateway_settings_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mod_gateway_settings_org ON public.mod_gateway_settings (org_id);
CREATE INDEX IF NOT EXISTS idx_mod_gateway_settings_key ON public.mod_gateway_settings (key);

-- Compatibility view for singular name that some tools expect
DO $$ BEGIN
  BEGIN
    CREATE OR REPLACE VIEW public.mod_gateway_setting AS SELECT * FROM public.mod_gateway_settings;
  EXCEPTION WHEN others THEN NULL; END;
END $$;

