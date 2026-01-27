-- Add id_shop and id_lang for category source selection in prompts
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_category_data_update_image_profiles' AND column_name='id_shop'
  ) THEN
    ALTER TABLE public.mod_category_data_update_image_profiles ADD COLUMN id_shop INTEGER NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_category_data_update_image_profiles' AND column_name='id_lang'
  ) THEN
    ALTER TABLE public.mod_category_data_update_image_profiles ADD COLUMN id_lang INTEGER NULL;
  END IF;
END $$;

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_cdu_image_profiles_shop ON public.mod_category_data_update_image_profiles(id_shop);
  EXCEPTION WHEN others THEN NULL; END;
END $$;

