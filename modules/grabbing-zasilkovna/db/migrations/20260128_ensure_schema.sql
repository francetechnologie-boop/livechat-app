-- Ensure mod_grabbing_zasilkovna schema exists even when earlier migrations ran out of order.

-- 1) Base table with superset of expected columns
DO $$
BEGIN
  IF to_regclass('public.mod_grabbing_zasilkovna') IS NULL THEN
    EXECUTE $$
      CREATE TABLE public.mod_grabbing_zasilkovna (
        id SERIAL PRIMARY KEY,
        submission_number          text NULL,
        order_raw                  text,
        id_order                   text,
        barcode                    text,
        packet_id                  text,
        name                       text,
        surname                    text,
        carrier                    text,
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
        price_currency             text,
        label_format               text,
        label_printed              text,
        label_date                 timestamp NULL,
        recipient_name             text,
        recipient_surname          text,
        pickup_point_or_carrier    text,
        customer_email             text,
        org_id                     text,
        tracking_packeta_url       text,
        tracking_external_url      text,
        courier_tracking_number    text,
        created_at                 timestamp DEFAULT now(),
        updated_at                 timestamp DEFAULT now()
      );
    $$;
  END IF;
END $$;

-- 2) Add any missing columns on existing installs
DO $$
DECLARE
  rec RECORD;
BEGIN
  IF to_regclass('public.mod_grabbing_zasilkovna') IS NULL THEN
    RETURN;
  END IF;

  FOR rec IN SELECT col FROM (VALUES
    ('submission_number'), ('order_raw'), ('id_order'), ('barcode'), ('packet_id'),
    ('name'), ('surname'), ('carrier'), ('sender'), ('cod'), ('currency'),
    ('converted_currency_cod'), ('status'), ('ready_for_pickup_until'),
    ('delivered_on'), ('note'), ('adult_18_plus'), ('consigned_date'),
    ('stored_date'), ('stored_time'), ('weight'), ('phone'), ('email'),
    ('packet_price'), ('price_currency'), ('label_format'), ('label_printed'),
    ('label_date'), ('recipient_name'), ('recipient_surname'),
    ('pickup_point_or_carrier'), ('customer_email'), ('org_id'),
    ('tracking_packeta_url'), ('tracking_external_url'),
    ('courier_tracking_number')
  ) AS cols(col)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'mod_grabbing_zasilkovna'
         AND column_name = rec.col
    ) THEN
      EXECUTE format('ALTER TABLE public.mod_grabbing_zasilkovna ADD COLUMN %I text', rec.col);
    END IF;
  END LOOP;

  -- numeric/timestamp defaults for a few known columns (skip errors for incompatible types)
  BEGIN
    ALTER TABLE public.mod_grabbing_zasilkovna
      ALTER COLUMN cod TYPE numeric USING cod::numeric,
      ALTER COLUMN packet_price TYPE numeric USING packet_price::numeric;
  EXCEPTION WHEN others THEN NULL; END;
END $$;

-- 3) Indexes and uniqueness (skip if columns missing)
DO $$
BEGIN
  IF to_regclass('public.mod_grabbing_zasilkovna') IS NULL THEN
    RETURN;
  END IF;

  -- helpers: only create index when all referenced columns exist
  PERFORM 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='order_raw';
  IF FOUND AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='grabbing_zasilkovna_order_raw_unique') THEN
    BEGIN
      CREATE UNIQUE INDEX grabbing_zasilkovna_order_raw_unique ON public.mod_grabbing_zasilkovna (order_raw);
    EXCEPTION WHEN others THEN NULL; END;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='org_id') THEN
    IF to_regclass('public.idx_grabbing_zasilkovna_org') IS NULL THEN
      EXECUTE 'CREATE INDEX idx_grabbing_zasilkovna_org ON public.mod_grabbing_zasilkovna (org_id)';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='id_order') THEN
    IF to_regclass('public.idx_zasilkovna_id_order') IS NULL THEN
      EXECUTE 'CREATE INDEX idx_zasilkovna_id_order ON public.mod_grabbing_zasilkovna (id_order)';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='packet_id') THEN
    IF to_regclass('public.idx_zasilkovna_packet_id') IS NULL THEN
      EXECUTE 'CREATE INDEX idx_zasilkovna_packet_id ON public.mod_grabbing_zasilkovna (packet_id)';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='submission_number') THEN
    IF to_regclass('public.idx_zasilkovna_submission_number') IS NULL THEN
      EXECUTE 'CREATE INDEX idx_zasilkovna_submission_number ON public.mod_grabbing_zasilkovna (submission_number)';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='status') THEN
    IF to_regclass('public.mod_grabbing_zasilkovna_status_idx') IS NULL THEN
      EXECUTE 'CREATE INDEX mod_grabbing_zasilkovna_status_idx ON public.mod_grabbing_zasilkovna (status)';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='customer_email') THEN
    IF to_regclass('public.mod_grabbing_zasilkovna_email_idx') IS NULL THEN
      EXECUTE 'CREATE INDEX mod_grabbing_zasilkovna_email_idx ON public.mod_grabbing_zasilkovna (lower(customer_email))';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='email') THEN
    IF to_regclass('public.mod_grabbing_zasilkovna_email2_idx') IS NULL THEN
      EXECUTE 'CREATE INDEX mod_grabbing_zasilkovna_email2_idx ON public.mod_grabbing_zasilkovna (lower(email))';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='name')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='surname') THEN
    IF to_regclass('public.mod_grabbing_zasilkovna_name_idx') IS NULL THEN
      EXECUTE 'CREATE INDEX mod_grabbing_zasilkovna_name_idx ON public.mod_grabbing_zasilkovna (lower(name), lower(surname))';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='tracking_packeta_url')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='tracking_external_url') THEN
    IF to_regclass('public.mod_grabbing_zasilkovna_tracking_missing_idx') IS NULL THEN
      EXECUTE 'CREATE INDEX mod_grabbing_zasilkovna_tracking_missing_idx ON public.mod_grabbing_zasilkovna ((tracking_packeta_url IS NULL), (tracking_external_url IS NULL))';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='mod_grabbing_zasilkovna' AND column_name='courier_tracking_number') THEN
    IF to_regclass('public.idx_zasilkovna_courier_tracking_number') IS NULL THEN
      EXECUTE 'CREATE INDEX idx_zasilkovna_courier_tracking_number ON public.mod_grabbing_zasilkovna (courier_tracking_number)';
    END IF;
  END IF;
END $$;

-- 4) CSV view (only if table exists)
DO $$
BEGIN
  IF to_regclass('public.mod_grabbing_zasilkovna') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW public.vw_mod_grabbing_zasilkovna_csv AS
      SELECT
        label_format                   AS "Label format",
        submission_number             AS "Submission number",
        label_printed                 AS "Label printed?",
        label_date                    AS "Date",
        order_raw                     AS "Order",
        barcode                       AS "Barcode",
        COALESCE(recipient_name, name)         AS "Recipient's name",
        COALESCE(recipient_surname, surname)   AS "Recipient's surname",
        COALESCE(pickup_point_or_carrier, carrier) AS "Pick up point or carrier",
        sender                        AS "Sender",
        cod                           AS "COD",
        currency                      AS "Currency",
        converted_currency_cod        AS "Converted currency COD",
        status                        AS "Status",
        ready_for_pickup_until        AS "Ready for pick up until",
        delivered_on                  AS "Delivered on",
        note                          AS "Note",
        adult_18_plus                 AS "18+",
        consigned_date                AS "Consigned Date",
        stored_date                   AS "Stored date",
        stored_time                   AS "Stored time",
        weight                        AS "Weight",
        phone                         AS "Phone",
        COALESCE(email, customer_email) AS "Email",
        packet_price                  AS "Packet price",
        currency                      AS "Price currency"
      FROM public.mod_grabbing_zasilkovna;
    $v$;
  END IF;
END $$;
