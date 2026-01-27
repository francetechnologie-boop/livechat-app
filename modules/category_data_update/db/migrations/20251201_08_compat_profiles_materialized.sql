-- Ensure compatibility relation supports indexing: replace simple VIEW with MATERIALIZED VIEW when needed
DO $$
DECLARE
  rel_oid oid := NULL;
  relkind char := NULL; -- 'r'=table, 'v'=view, 'm'=matview
BEGIN
  SELECT c.oid, c.relkind
    INTO rel_oid, relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'mod_category_data_translator_profiles'
   LIMIT 1;

  IF rel_oid IS NOT NULL THEN
    -- If it is a plain VIEW, recreate as MATERIALIZED VIEW
    IF relkind = 'v' THEN
      BEGIN
        DROP VIEW IF EXISTS public.mod_category_data_translator_profiles;
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN
        CREATE MATERIALIZED VIEW public.mod_category_data_translator_profiles AS
          SELECT * FROM public.mod_category_data_translator_config;
      EXCEPTION WHEN others THEN NULL; END;
    END IF;
  ELSE
    -- Nothing exists → create MATERIALIZED VIEW
    BEGIN
      CREATE MATERIALIZED VIEW public.mod_category_data_translator_profiles AS
        SELECT * FROM public.mod_category_data_translator_config;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;

  -- Try to create the compatibility index (works for table or materialized view)
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_cdu_translator_profiles_org
      ON public.mod_category_data_translator_profiles(org_id);
  EXCEPTION WHEN others THEN NULL; END;
END $$;

