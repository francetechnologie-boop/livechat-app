-- Add tracking URL columns to packet table (idempotent)
ALTER TABLE public.mod_grabbing_zasilkovna
  ADD COLUMN IF NOT EXISTS tracking_packeta_url TEXT,
  ADD COLUMN IF NOT EXISTS tracking_external_url TEXT;

-- Helpful index if you later query by missing tracking
DO $$ BEGIN
  IF to_regclass('public.mod_grabbing_zasilkovna_tracking_missing_idx') IS NULL THEN
    EXECUTE 'CREATE INDEX mod_grabbing_zasilkovna_tracking_missing_idx ON public.mod_grabbing_zasilkovna ((tracking_packeta_url IS NULL), (tracking_external_url IS NULL))';
  END IF;
END $$;

