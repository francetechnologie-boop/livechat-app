-- Ensure expected index exists on translator profiles (table variant)
DO $$ BEGIN
  IF to_regclass('public.mod_category_data_translator_profiles') IS NOT NULL THEN
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_cdu_translator_profiles_org
        ON public.mod_category_data_translator_profiles(org_id);
    EXCEPTION WHEN others THEN NULL; -- portable across environments
    END;
  END IF;
END $$;

