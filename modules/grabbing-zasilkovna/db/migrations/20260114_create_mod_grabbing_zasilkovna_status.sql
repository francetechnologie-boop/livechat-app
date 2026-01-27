-- Store per-packet status snapshots fetched from Zasilkovna SOAP API (idempotent).
CREATE TABLE IF NOT EXISTS public.mod_grabbing_zasilkovna_status (
  id           SERIAL PRIMARY KEY,
  packet_id    TEXT NOT NULL,
  status_code  TEXT NULL,
  code_text    TEXT NULL,
  status_text  TEXT NULL,
  status_at    TIMESTAMPTZ NULL,
  source       TEXT NULL DEFAULT 'soap.packetStatus',
  raw_xml      TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  org_id       TEXT NULL
);

CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_status_packet_idx
  ON public.mod_grabbing_zasilkovna_status (packet_id);

CREATE INDEX IF NOT EXISTS mod_grabbing_zasilkovna_status_created_idx
  ON public.mod_grabbing_zasilkovna_status (created_at DESC);

-- Compatibility view for a common typo: "STAUS" (unquoted identifiers fold to lowercase).
DO $$ BEGIN
  IF to_regclass('public.mod_grabbing_zasilkovna_staus') IS NULL THEN
    EXECUTE 'CREATE VIEW public.mod_grabbing_zasilkovna_staus AS SELECT * FROM public.mod_grabbing_zasilkovna_status';
  END IF;
END $$;
