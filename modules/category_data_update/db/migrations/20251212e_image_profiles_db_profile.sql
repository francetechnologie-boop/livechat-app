-- Add db_profile_id to image profiles to link a MySQL profile
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_category_data_update_image_profiles' AND column_name='db_profile_id'
  ) THEN
    ALTER TABLE public.mod_category_data_update_image_profiles ADD COLUMN db_profile_id INTEGER NULL;
  END IF;
END $$;

-- Optional FK to mod_db_mysql_profiles(id) if it exists
DO $$ BEGIN
  IF to_regclass('public.mod_db_mysql_profiles') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.mod_category_data_update_image_profiles
        ADD CONSTRAINT fk_cdu_image_profiles_db_profile
        FOREIGN KEY (db_profile_id) REFERENCES public.mod_db_mysql_profiles(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

