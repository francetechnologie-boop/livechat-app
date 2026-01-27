-- up
-- Add courierTrackingNumber storage (last-mile carrier tracking number from SOAP packetInfo).
-- Europe/Prague date: 2026-01-25
ALTER TABLE public.mod_grabbing_zasilkovna
  ADD COLUMN IF NOT EXISTS courier_tracking_number TEXT;

-- Optional index for lookups / debugging
DO $$ BEGIN
  IF to_regclass('public.idx_zasilkovna_courier_tracking_number') IS NULL THEN
    EXECUTE 'CREATE INDEX idx_zasilkovna_courier_tracking_number ON public.mod_grabbing_zasilkovna (courier_tracking_number)';
  END IF;
END $$;

-- down
-- Non-destructive.

