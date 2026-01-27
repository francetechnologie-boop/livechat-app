-- Image profiles for Category – Image Maker (FTP + base path + prompt)
CREATE TABLE IF NOT EXISTS mod_category_data_update_image_profiles (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  name VARCHAR(255) NOT NULL,
  ftp_host VARCHAR(255) NOT NULL,
  ftp_port INTEGER NOT NULL DEFAULT 21,
  ftp_user VARCHAR(255) NOT NULL,
  ftp_password TEXT NULL,
  ftp_secure BOOLEAN NOT NULL DEFAULT FALSE,
  base_path TEXT NOT NULL,
  prompt_config_id TEXT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_cdu_image_profiles_org ON mod_category_data_update_image_profiles(org_id);
  EXCEPTION WHEN others THEN NULL; -- portable
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
      ALTER TABLE public.mod_category_data_update_image_profiles
        ADD CONSTRAINT fk_cdu_image_profiles_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

