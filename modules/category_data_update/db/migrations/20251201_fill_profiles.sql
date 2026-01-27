-- Saved profiles for Category – Fill Missing panel
CREATE TABLE IF NOT EXISTS mod_category_data_update_fill_profiles (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  name VARCHAR(255) NOT NULL,
  profile_id INTEGER NULL,
  prefix VARCHAR(64) NULL,
  fields JSONB NULL,
  scope JSONB NULL,
  prompt_config_id TEXT NULL,
  limits JSONB NULL,
  overwrite BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_cdu_fill_profiles_org ON mod_category_data_update_fill_profiles(org_id);
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- Guarded FK to organizations(id)
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
      ALTER TABLE public.mod_category_data_update_fill_profiles
        ADD CONSTRAINT fk_cdu_fill_profiles_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

