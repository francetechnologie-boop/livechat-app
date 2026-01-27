-- Add org_id column to nohash tables for organization scoping

DO $$ BEGIN
  ALTER TABLE mod_nohash_routes ADD COLUMN IF NOT EXISTS org_id TEXT NULL;
EXCEPTION WHEN duplicate_column THEN END $$;

DO $$ BEGIN
  ALTER TABLE mod_nohash_modules ADD COLUMN IF NOT EXISTS org_id TEXT NULL;
EXCEPTION WHEN duplicate_column THEN END $$;

DO $$ BEGIN
  ALTER TABLE mod_nohash_pages ADD COLUMN IF NOT EXISTS org_id TEXT NULL;
EXCEPTION WHEN duplicate_column THEN END $$;

-- Update uniqueness to include org context
DO $$ BEGIN
  ALTER TABLE mod_nohash_routes DROP CONSTRAINT IF EXISTS mod_nohash_routes_hash_uq;
EXCEPTION WHEN undefined_object THEN END $$;

CREATE UNIQUE INDEX IF NOT EXISTS mod_nohash_routes_hash_uq
  ON mod_nohash_routes (COALESCE(org_id,'org_default'), lower(trim(both from hash)));

DO $$ BEGIN
  ALTER TABLE mod_nohash_modules DROP CONSTRAINT IF EXISTS mod_nohash_modules_module_id_key;
EXCEPTION WHEN undefined_object THEN END $$;

CREATE UNIQUE INDEX IF NOT EXISTS mod_nohash_modules_org_mod_uq
  ON mod_nohash_modules (COALESCE(org_id,'org_default'), module_id);

DO $$ BEGIN
  ALTER TABLE mod_nohash_pages DROP CONSTRAINT IF EXISTS mod_nohash_pages_page_id_key;
EXCEPTION WHEN undefined_object THEN END $$;

CREATE UNIQUE INDEX IF NOT EXISTS mod_nohash_pages_org_page_uq
  ON mod_nohash_pages (COALESCE(org_id,'org_default'), page_id);

