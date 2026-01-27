-- Settings store for BOM module (org-scoped), idempotent
CREATE TABLE IF NOT EXISTS mod_bom_settings (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- Unique key per org
DO $$ BEGIN
  BEGIN
    CREATE UNIQUE INDEX uq_bom_settings_org_key ON mod_bom_settings(org_id, key);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END;
END $$;

-- Guard org_id FK
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
      ALTER TABLE public.mod_bom_settings
        ADD CONSTRAINT fk_bom_settings_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

