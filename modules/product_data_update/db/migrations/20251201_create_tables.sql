-- Create config table for product_data_update module
CREATE TABLE IF NOT EXISTS mod_product_data_update_config (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  default_profile_id INTEGER NULL,
  default_prefix VARCHAR(64) NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Optional index for faster org lookups
DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_product_data_update_config_org ON mod_product_data_update_config(org_id);
  EXCEPTION WHEN others THEN NULL; -- portable
  END;
END $$;

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
      ALTER TABLE public.mod_product_data_update_config
        ADD CONSTRAINT fk_product_data_update_config_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

