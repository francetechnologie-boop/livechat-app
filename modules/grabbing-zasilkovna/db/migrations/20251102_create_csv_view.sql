-- View exposing mod_grabbing_zasilkovna columns in the exact CSV order
-- Note: SQL requires unique column names, so the second CSV "Currency" is exposed as "Price currency".
DO $$ BEGIN
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
