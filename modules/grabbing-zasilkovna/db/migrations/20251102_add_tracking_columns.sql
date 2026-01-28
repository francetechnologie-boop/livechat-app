-- Add tracking URL columns to packet table (idempotent)
DO $$ BEGIN
  IF to_regclass('public.mod_grabbing_zasilkovna') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.mod_grabbing_zasilkovna
        ADD COLUMN IF NOT EXISTS tracking_packeta_url TEXT,
        ADD COLUMN IF NOT EXISTS tracking_external_url TEXT;
    EXCEPTION WHEN others THEN NULL; END;

    -- Helpful index if you later query by missing tracking
    IF to_regclass('public.mod_grabbing_zasilkovna_tracking_missing_idx') IS NULL THEN
      EXECUTE 'CREATE INDEX mod_grabbing_zasilkovna_tracking_missing_idx ON public.mod_grabbing_zasilkovna ((tracking_packeta_url IS NULL), (tracking_external_url IS NULL))';
    END IF;
  END IF;
END $$;
