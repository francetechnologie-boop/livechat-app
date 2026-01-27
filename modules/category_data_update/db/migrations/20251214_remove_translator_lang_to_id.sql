-- Remove legacy lang_to_id column; we always use lang_to_ids (jsonb)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mod_category_data_translator_config' AND column_name = 'lang_to_id'
  ) THEN
    -- Drop dependent compatibility relations first (both VIEW and MATERIALIZED VIEW variants)
    BEGIN
      DROP MATERIALIZED VIEW IF EXISTS public.mod_category_data_translator_profiles;
    EXCEPTION WHEN others THEN NULL; END;
    BEGIN
      DROP VIEW IF EXISTS public.mod_category_data_translator_profiles;
    EXCEPTION WHEN others THEN NULL; END;
    BEGIN
      DROP MATERIALIZED VIEW IF EXISTS public.mod_category_data_translator_profiles_old;
    EXCEPTION WHEN others THEN NULL; END;
    BEGIN
      DROP VIEW IF EXISTS public.mod_category_data_translator_profiles_old;
    EXCEPTION WHEN others THEN NULL; END;

    -- Best-effort backfill: copy single value into jsonb array when lang_to_ids is NULL
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'mod_category_data_translator_config' AND column_name = 'lang_to_ids'
      ) THEN
        UPDATE public.mod_category_data_translator_config
           SET lang_to_ids = jsonb_build_array(lang_to_id)
         WHERE lang_to_ids IS NULL AND lang_to_id IS NOT NULL;
      END IF;
    EXCEPTION WHEN others THEN NULL; END;

    -- Drop the legacy column
    BEGIN
      ALTER TABLE public.mod_category_data_translator_config DROP COLUMN IF EXISTS lang_to_id;
    EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL; END;

    -- Recreate compatibility relation as MATERIALIZED VIEW over updated table
    BEGIN
      CREATE MATERIALIZED VIEW IF NOT EXISTS public.mod_category_data_translator_profiles AS
        SELECT * FROM public.mod_category_data_translator_config;
    EXCEPTION WHEN others THEN NULL; END;
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_cdu_translator_profiles_org
        ON public.mod_category_data_translator_profiles(org_id);
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;
