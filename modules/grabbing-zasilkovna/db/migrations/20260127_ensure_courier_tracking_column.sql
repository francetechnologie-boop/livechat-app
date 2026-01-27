-- Ensure courier tracking number column and index exist (idempotent).
-- Europe/Prague date: 2026-01-27
DO $$
DECLARE
  tbl text;
BEGIN
  -- Align all zasilkovna tables we might keep around during migrations.
  FOR tbl IN SELECT unnest(ARRAY[
    'public.mod_grabbing_zasilkovna',
    'public.mod_grabbing_zasilkovna_new',
    'public.mod_grabbing_zasilkovna_old'
  ]) AS name LOOP
    IF to_regclass(tbl) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I.%I ADD COLUMN IF NOT EXISTS courier_tracking_number TEXT',
        split_part(tbl, '.', 1), split_part(tbl, '.', 2));
    END IF;
  END LOOP;

  -- Primary index on the live table (skip when column missing).
  IF to_regclass('public.mod_grabbing_zasilkovna') IS NOT NULL THEN
    PERFORM 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'mod_grabbing_zasilkovna' AND column_name = 'courier_tracking_number';
    IF FOUND THEN
      PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = 'idx_zasilkovna_courier_tracking_number' AND n.nspname = 'public';
      IF NOT FOUND THEN
        EXECUTE 'CREATE INDEX idx_zasilkovna_courier_tracking_number ON public.mod_grabbing_zasilkovna (courier_tracking_number)';
      END IF;
    END IF;
  END IF;
END $$;

-- down: non-destructive
