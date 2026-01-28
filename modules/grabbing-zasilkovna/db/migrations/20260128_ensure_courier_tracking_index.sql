-- Ensure courier tracking number index exists (idempotent, guarded).
DO $$ BEGIN
  IF to_regclass('public.mod_grabbing_zasilkovna') IS NULL THEN
    RETURN;
  END IF;

  -- Add column if missing (some installs skipped earlier migration)
  BEGIN
    ALTER TABLE public.mod_grabbing_zasilkovna ADD COLUMN IF NOT EXISTS courier_tracking_number TEXT;
  EXCEPTION WHEN others THEN NULL; END;

  -- Create index if absent
  IF to_regclass('public.idx_zasilkovna_courier_tracking_number') IS NULL THEN
    EXECUTE 'CREATE INDEX idx_zasilkovna_courier_tracking_number ON public.mod_grabbing_zasilkovna (courier_tracking_number)';
  END IF;
END $$;
