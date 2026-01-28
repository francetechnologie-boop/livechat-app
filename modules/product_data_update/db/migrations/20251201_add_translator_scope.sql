-- Persist translator scope in profiles (product IDs list, range, optional WHERE)
DO $$ BEGIN
  IF to_regclass('public.mod_product_data_translator_config') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mod_product_data_translator_config' AND column_name = 'scope_list'
  ) THEN
    ALTER TABLE public.mod_product_data_translator_config ADD COLUMN scope_list text NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mod_product_data_translator_config' AND column_name = 'scope_from'
  ) THEN
    ALTER TABLE public.mod_product_data_translator_config ADD COLUMN scope_from int4 NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mod_product_data_translator_config' AND column_name = 'scope_to'
  ) THEN
    ALTER TABLE public.mod_product_data_translator_config ADD COLUMN scope_to int4 NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mod_product_data_translator_config' AND column_name = 'scope_where'
  ) THEN
    ALTER TABLE public.mod_product_data_translator_config ADD COLUMN scope_where text NULL;
  END IF;
END $$;
