-- Add missing status index for mod_grabbing_zasilkovna (idempotent)
DO $$ BEGIN
  IF to_regclass('public.mod_grabbing_zasilkovna') IS NOT NULL THEN
    IF to_regclass('public.mod_grabbing_zasilkovna_status_idx') IS NULL THEN
      EXECUTE 'CREATE INDEX mod_grabbing_zasilkovna_status_idx ON public.mod_grabbing_zasilkovna (status)';
    END IF;
  END IF;
END $$;
