CREATE TABLE IF NOT EXISTS mod_grabbing_zasilkovna (
  id SERIAL PRIMARY KEY,
  submission_number TEXT,
  order_raw TEXT UNIQUE,
  id_order BIGINT,
  barcode TEXT,
  packet_id TEXT,
  name TEXT,
  surname TEXT,
  carrier TEXT,
  sender TEXT,
  cod NUMERIC,
  currency TEXT,
  status TEXT,
  ready_for_pickup_until TIMESTAMPTZ,
  delivered_on TIMESTAMPTZ,
  consigned_date TIMESTAMPTZ,
  customer_email TEXT,
  packet_price NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Helpful indexes for lookups used by tools
CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_email_idx ON mod_grabbing_zasilkovna (lower(customer_email));
CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_order_idx ON mod_grabbing_zasilkovna (id_order);
CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_packet_idx ON mod_grabbing_zasilkovna (packet_id);
CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_name_idx ON mod_grabbing_zasilkovna (lower(name), lower(surname));
CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_status_idx ON mod_grabbing_zasilkovna (status);

-- Compatibility view for legacy code/tools that query grabbing_zasilkovna
DO $$ BEGIN
  IF to_regclass('public.grabbing_zasilkovna') IS NULL THEN
    EXECUTE 'CREATE VIEW grabbing_zasilkovna AS SELECT * FROM mod_grabbing_zasilkovna';
  END IF;
END $$;
