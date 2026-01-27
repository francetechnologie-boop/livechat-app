-- product-search-index module tables
-- Profiles store

CREATE TABLE IF NOT EXISTS public.mod_product_search_index_profiles (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  db_profile_id INTEGER NOT NULL,
  prefix TEXT NOT NULL DEFAULT 'ps_',
  id_shop INTEGER NOT NULL,
  id_langs TEXT NOT NULL DEFAULT '[]', -- JSON array as text
  org_id INTEGER NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_mod_psi_profiles_org ON public.mod_product_search_index_profiles(org_id);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- Guarded foreign key to organizations(id) per AGENTS.md
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
      ALTER TABLE public.mod_product_search_index_profiles
        ADD CONSTRAINT fk_psi_profiles_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

