-- Add lang_to_ids (jsonb) to translator config to persist multiple target languages
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mod_product_data_translator_config' AND column_name = 'lang_to_ids'
  ) THEN
    ALTER TABLE public.mod_product_data_translator_config ADD COLUMN lang_to_ids jsonb NULL;
  END IF;
END $$;

