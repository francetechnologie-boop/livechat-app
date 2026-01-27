-- DHL module profiles (per org): stores DHL API key and default Presta/MySQL settings
-- Note: org_id is TEXT (aligns with core organizations.id in this codebase).

CREATE TABLE IF NOT EXISTS public.mod_dhl_profiles (
  id SERIAL PRIMARY KEY,
  org_id TEXT NULL,
  name TEXT NOT NULL DEFAULT '',
  api_key TEXT NULL,
  mysql_profile_id INTEGER NULL,
  presta_prefix TEXT NOT NULL DEFAULT 'ps_',
  language TEXT NULL,
  service TEXT NULL,
  origin_country_code TEXT NULL,
  requester_country_code TEXT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_dhl_profiles_org ON public.mod_dhl_profiles(org_id);
CREATE INDEX IF NOT EXISTS idx_mod_dhl_profiles_default ON public.mod_dhl_profiles(org_id, is_default);

-- Guarded FK to organizations(id) when available and compatible
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
      ALTER TABLE public.mod_dhl_profiles
        ADD CONSTRAINT fk_mod_dhl_profiles_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

