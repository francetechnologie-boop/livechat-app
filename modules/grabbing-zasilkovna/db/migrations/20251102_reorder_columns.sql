-- Reorder columns in public.mod_grabbing_zasilkovna to match current CSV order.
-- Approach: create a new table with desired column order, copy data, swap names, recreate indexes.
-- Idempotent: skips when an old-swapped table exists.

-- IMPORTANT: avoid nested dollar-quoting inside a DO body (syntax error).
DO $do$
DECLARE
  has_old boolean := (to_regclass('public.mod_grabbing_zasilkovna_old') IS NOT NULL);
  has_tbl boolean := (to_regclass('public.mod_grabbing_zasilkovna') IS NOT NULL);
  has_new boolean := (to_regclass('public.mod_grabbing_zasilkovna_new') IS NOT NULL);
BEGIN
  IF NOT has_tbl OR has_old THEN
    -- Either table missing or already swapped once; nothing to do
    RETURN;
  END IF;

  IF has_new THEN
    -- Clean up any stale new table from a failed run
    EXECUTE 'DROP TABLE public.mod_grabbing_zasilkovna_new';
  END IF;

  -- Create new table in desired column order (CSV-aligned first), then legacy columns, timestamps, org
  EXECUTE $sql$
    CREATE TABLE public.mod_grabbing_zasilkovna_new (
      label_format               text,
      submission_number          text NOT NULL,
      label_printed              text,
      label_date                 timestamp NULL,
      order_raw                  text,
      barcode                    text,
      recipient_name             text,
      recipient_surname          text,
      pickup_point_or_carrier    text,
      sender                     text,
      cod                        numeric,
      currency                   text,
      converted_currency_cod     numeric,
      status                     text,
      ready_for_pickup_until     timestamp NULL,
      delivered_on               timestamp NULL,
      note                       text,
      adult_18_plus              boolean,
      consigned_date             timestamp NULL,
      stored_date                timestamp NULL,
      stored_time                text,
      weight                     numeric,
      phone                      text,
      email                      text,
      packet_price               numeric,
      -- The CSV repeats 'Currency' for price column; we keep a DB-safe name
      price_currency             text,
      -- Legacy/internal columns after CSV block
      packet_id                  text,
      name                       text,
      surname                    text,
      carrier                    text,
      customer_email             text,
      id_order                   text,
      created_at                 timestamp DEFAULT now(),
      updated_at                 timestamp DEFAULT now(),
      org_id                     text
    )
  $sql$;

  -- Copy data with sensible fallbacks
  EXECUTE $sql$
    INSERT INTO public.mod_grabbing_zasilkovna_new (
      label_format, submission_number, label_printed, label_date, order_raw, barcode,
      recipient_name, recipient_surname, pickup_point_or_carrier, sender, cod, currency,
      converted_currency_cod, status, ready_for_pickup_until, delivered_on, note, adult_18_plus,
      consigned_date, stored_date, stored_time, weight, phone, email, packet_price, price_currency,
      packet_id, name, surname, carrier, customer_email, id_order, created_at, updated_at, org_id
    )
    SELECT
      label_format,
      submission_number,
      label_printed,
      label_date,
      order_raw,
      barcode,
      COALESCE(recipient_name, name),
      COALESCE(recipient_surname, surname),
      COALESCE(pickup_point_or_carrier, carrier),
      sender,
      cod,
      currency,
      converted_currency_cod,
      status,
      ready_for_pickup_until,
      delivered_on,
      note,
      adult_18_plus,
      consigned_date,
      stored_date,
      stored_time,
      weight,
      phone,
      COALESCE(email, customer_email),
      packet_price,
      currency AS price_currency,
      packet_id,
      name,
      surname,
      carrier,
      customer_email,
      id_order,
      created_at,
      updated_at,
      org_id
    FROM public.mod_grabbing_zasilkovna
  $sql$;

  -- Swap names
  EXECUTE 'ALTER TABLE public.mod_grabbing_zasilkovna RENAME TO mod_grabbing_zasilkovna_old';
  EXECUTE 'ALTER TABLE public.mod_grabbing_zasilkovna_new RENAME TO mod_grabbing_zasilkovna';

  -- Recreate indexes (names preserved)
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS grabbing_zasilkovna_order_raw_unique ON public.mod_grabbing_zasilkovna (order_raw)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_grabbing_zasilkovna_org ON public.mod_grabbing_zasilkovna (org_id)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_zasilkovna_id_order ON public.mod_grabbing_zasilkovna (id_order)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_zasilkovna_packet_id ON public.mod_grabbing_zasilkovna (packet_id)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_zasilkovna_submission_number ON public.mod_grabbing_zasilkovna (submission_number)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_email2_idx ON public.mod_grabbing_zasilkovna (lower(email))';
  EXECUTE 'CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_email_idx ON public.mod_grabbing_zasilkovna (lower(customer_email))';
  EXECUTE 'CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_name_idx ON public.mod_grabbing_zasilkovna (lower(name), lower(surname))';
  EXECUTE 'CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_order_idx ON public.mod_grabbing_zasilkovna (id_order)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_packet_idx ON public.mod_grabbing_zasilkovna (packet_id)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_status_idx ON public.mod_grabbing_zasilkovna (status)';

  -- Optional: drop the old table after successful swap (comment out to keep a safety copy)
  -- EXECUTE 'DROP TABLE public.mod_grabbing_zasilkovna_old';
END $do$;
