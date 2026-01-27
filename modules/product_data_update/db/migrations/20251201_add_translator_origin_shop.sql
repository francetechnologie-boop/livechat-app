-- Persist origin shop for translator profiles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mod_product_data_translator_config' AND column_name = 'id_shop_from'
  ) THEN
    ALTER TABLE public.mod_product_data_translator_config ADD COLUMN id_shop_from int4 NULL;
  END IF;
END $$;

