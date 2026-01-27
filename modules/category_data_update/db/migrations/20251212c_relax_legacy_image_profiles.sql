-- Relax legacy inline FTP columns to allow nulls when using external ftp-connection profiles
DO $$ BEGIN
  IF to_regclass('public.mod_category_data_update_image_profiles') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.mod_category_data_update_image_profiles ALTER COLUMN ftp_host DROP NOT NULL;
    EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL; END;
    BEGIN
      ALTER TABLE public.mod_category_data_update_image_profiles ALTER COLUMN ftp_user DROP NOT NULL;
    EXCEPTION WHEN undefined_column THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

