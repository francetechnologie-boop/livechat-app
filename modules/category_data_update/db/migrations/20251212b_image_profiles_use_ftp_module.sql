-- Add reference to ftp-connection profiles and deprecate inline FTP fields
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_category_data_update_image_profiles' AND column_name='ftp_profile_id'
  ) THEN
    ALTER TABLE public.mod_category_data_update_image_profiles ADD COLUMN ftp_profile_id INTEGER NULL;
  END IF;
END $$;

-- Guarded FK to public.mod_ftp_connection_profiles(id) if present
DO $$ BEGIN
  IF to_regclass('public.mod_ftp_connection_profiles') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.mod_category_data_update_image_profiles
        ADD CONSTRAINT fk_cdu_image_profiles_ftp_profile
        FOREIGN KEY (ftp_profile_id) REFERENCES public.mod_ftp_connection_profiles(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

