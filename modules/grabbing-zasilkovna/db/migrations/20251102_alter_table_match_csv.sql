-- Align mod_grabbing_zasilkovna columns with current CSV export fields (idempotent)
DO $$ BEGIN
  IF to_regclass('public.mod_grabbing_zasilkovna') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.mod_grabbing_zasilkovna
        ADD COLUMN IF NOT EXISTS label_format               text,
        ADD COLUMN IF NOT EXISTS label_printed              text,
        ADD COLUMN IF NOT EXISTS label_date                 timestamp NULL,
        ADD COLUMN IF NOT EXISTS recipient_name             text,
        ADD COLUMN IF NOT EXISTS recipient_surname          text,
        ADD COLUMN IF NOT EXISTS pickup_point_or_carrier    text,
        ADD COLUMN IF NOT EXISTS converted_currency_cod     numeric,
        ADD COLUMN IF NOT EXISTS note                       text,
        ADD COLUMN IF NOT EXISTS adult_18_plus              boolean,
        ADD COLUMN IF NOT EXISTS stored_date                timestamp NULL,
        ADD COLUMN IF NOT EXISTS stored_time                text,
        ADD COLUMN IF NOT EXISTS weight                     numeric,
        ADD COLUMN IF NOT EXISTS phone                      text,
        ADD COLUMN IF NOT EXISTS email                      text;
    EXCEPTION WHEN others THEN NULL; END;

    -- Optional: quick index to search by email (CSV email). Existing index is on lower(customer_email)
    IF to_regclass('public.mod_grabbing_zasilkovna_email2_idx') IS NULL THEN
      EXECUTE 'CREATE INDEX mod_grabbing_zasilkovna_email2_idx ON public.mod_grabbing_zasilkovna (lower(email))';
    END IF;
  END IF;
END $$;
