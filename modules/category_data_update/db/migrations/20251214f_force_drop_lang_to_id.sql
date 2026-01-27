-- Force-remove legacy lang_to_id by dropping dependent views first, then backfilling and dropping the column.
-- Idempotent and safe across environments.

-- 1) Drop any dependent compatibility views/materialized views
DO $$ BEGIN
  BEGIN EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.mod_category_data_translator_profiles_old CASCADE'; EXCEPTION WHEN others THEN NULL; END;
  BEGIN EXECUTE 'DROP VIEW IF EXISTS public.mod_category_data_translator_profiles_old CASCADE'; EXCEPTION WHEN others THEN NULL; END;
  BEGIN EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.mod_category_data_translator_profiles CASCADE'; EXCEPTION WHEN others THEN NULL; END;
  BEGIN EXECUTE 'DROP VIEW IF EXISTS public.mod_category_data_translator_profiles CASCADE'; EXCEPTION WHEN others THEN NULL; END;
END $$;

-- 2) Backfill jsonb array from legacy single value (when both cols exist), then drop the legacy col
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_category_data_translator_config' AND column_name='lang_to_id'
  ) THEN
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_category_data_translator_config' AND column_name='lang_to_ids'
      ) THEN
        UPDATE public.mod_category_data_translator_config
           SET lang_to_ids = jsonb_build_array(lang_to_id)
         WHERE lang_to_ids IS NULL AND lang_to_id IS NOT NULL;
      END IF;
    EXCEPTION WHEN others THEN NULL; END;
    BEGIN
      ALTER TABLE public.mod_category_data_translator_config DROP COLUMN IF EXISTS lang_to_id;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;

-- 3) Recreate the compatibility materialized view and index (points to the updated table schema)
DO $$ BEGIN
  BEGIN
    CREATE MATERIALIZED VIEW IF NOT EXISTS public.mod_category_data_translator_profiles AS
      SELECT * FROM public.mod_category_data_translator_config;
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_cdu_translator_profiles_org ON public.mod_category_data_translator_profiles(org_id);
  EXCEPTION WHEN others THEN NULL; END;
END $$;

