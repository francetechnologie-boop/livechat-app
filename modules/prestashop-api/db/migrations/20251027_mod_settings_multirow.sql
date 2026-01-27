-- 20251027_mod_settings_multirow.sql
-- Allow multiple rows per org in mod_prestashop_api_settings

-- Drop legacy unique constraint on (org_id)
ALTER TABLE public.mod_prestashop_api_settings DROP CONSTRAINT IF EXISTS uq_mod_prestashop_api_settings;

-- Ensure helpful indexes
CREATE INDEX IF NOT EXISTS idx_mod_prestashop_api_settings_org_id ON public.mod_prestashop_api_settings(org_id);

-- Avoid duplicate base_url per org; coalesce org_id to enforce uniqueness even when NULL
CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_prestashop_api_settings_org_base
  ON public.mod_prestashop_api_settings (COALESCE(org_id, ''), base_url);

