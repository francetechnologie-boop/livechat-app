-- Add JSONB column setting_image to per-table settings (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_grabbing_jerome_table_settings' AND column_name='setting_image'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_grabbing_jerome_table_settings ADD COLUMN setting_image JSONB NULL;
    EXCEPTION WHEN duplicate_column THEN NULL; END;
  END IF;
END $$;

