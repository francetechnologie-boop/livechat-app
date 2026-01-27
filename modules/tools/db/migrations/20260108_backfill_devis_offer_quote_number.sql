-- up
-- Backfill missing/empty quote_number values to avoid unique violations on inserts.
-- Europe/Prague date: 2026-01-08
DO $$
BEGIN
  IF to_regclass('public.mod_tools_devis_offers') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    UPDATE public.mod_tools_devis_offers
       SET quote_number = CONCAT(
             'DEV-',
             TO_CHAR(COALESCE(created_at::date, CURRENT_DATE), 'YYYY-MM-DD'),
             '-',
             id::text
           ),
           updated_at = NOW()
     WHERE quote_number IS NULL OR quote_number = '';
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

-- down
-- Non-destructive: keep values.

