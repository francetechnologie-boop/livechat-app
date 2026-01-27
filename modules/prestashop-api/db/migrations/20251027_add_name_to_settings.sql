-- 20251027_add_name_to_settings.sql
-- Add 'name' column and indexes for mod_prestashop_api_settings

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_prestashop_api_settings ADD COLUMN IF NOT EXISTS name TEXT NULL;
  EXCEPTION WHEN others THEN
  END;
END $$;

-- Prevent duplicate base_url per org (for convenience)
CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_prestashop_api_settings_org_base
  ON public.mod_prestashop_api_settings (COALESCE(org_id,''), base_url);

-- Prevent duplicate name per org
CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_prestashop_api_settings_org_name
  ON public.mod_prestashop_api_settings (COALESCE(org_id,''), name) WHERE name IS NOT NULL;

