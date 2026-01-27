-- Drop useless id_shop and id_lang columns from translator runs
DO $$ BEGIN
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mod_category_data_translator_runs' AND column_name='id_lang'
    ) THEN
      ALTER TABLE public.mod_category_data_translator_runs DROP COLUMN IF EXISTS id_lang;
    END IF;
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mod_category_data_translator_runs' AND column_name='id_shop'
    ) THEN
      ALTER TABLE public.mod_category_data_translator_runs DROP COLUMN IF EXISTS id_shop;
    END IF;
  EXCEPTION WHEN others THEN NULL; END;
END $$;

