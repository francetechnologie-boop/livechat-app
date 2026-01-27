-- Rename destination shop column to id_shop_to for clarity.
-- Handles dependent compatibility views and is safe to re-run.

-- 1) Drop compatibility views that select * from the table to avoid dependency errors
DO $$ BEGIN
  BEGIN EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.mod_category_data_translator_profiles CASCADE'; EXCEPTION WHEN others THEN NULL; END;
  BEGIN EXECUTE 'DROP VIEW IF EXISTS public.mod_category_data_translator_profiles CASCADE'; EXCEPTION WHEN others THEN NULL; END;
  BEGIN EXECUTE 'DROP MATERIALIZED VIEW IF EXISTS public.mod_category_data_translator_profiles_old CASCADE'; EXCEPTION WHEN others THEN NULL; END;
  BEGIN EXECUTE 'DROP VIEW IF EXISTS public.mod_category_data_translator_profiles_old CASCADE'; EXCEPTION WHEN others THEN NULL; END;
END $$;

-- 2) Rename column when needed
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_category_data_translator_config' AND column_name='id_shop'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_category_data_translator_config' AND column_name='id_shop_to'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_category_data_translator_config RENAME COLUMN id_shop TO id_shop_to;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;

-- 3) Recreate a materialized compatibility view and index
DO $$ BEGIN
  BEGIN
    CREATE MATERIALIZED VIEW IF NOT EXISTS public.mod_category_data_translator_profiles AS
      SELECT * FROM public.mod_category_data_translator_config;
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_cdu_translator_profiles_org ON public.mod_category_data_translator_profiles(org_id);
  EXCEPTION WHEN others THEN NULL; END;
END $$;

