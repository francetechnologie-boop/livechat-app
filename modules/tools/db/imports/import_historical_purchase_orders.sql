-- Import helper for the historical purchase order dump shared during the session.
-- Usage:
--   1. Save the tab-delimited data you provided as e.g. /tmp/purchase-orders.tsv with a header row matching
--      the column names described below.
--   2. Run this script from psql: `psql -d livechat-app -f modules/tools/db/imports/import_historical_purchase_orders.sql`
--      Before running the script, issue:
--        \copy tmp_tools_purchase_order_import FROM '/tmp/purchase-orders.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '');
--      (the temporary import table will still exist when the script continues).
--
-- The script deduplicates on po_number (using the long form) and populates the module tables with ON CONFLICT DO NOTHING,
-- so it is safe to run multiple times without duplicating records.

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS tmp_tools_purchase_order_import (
  po_number TEXT,
  po_number_long TEXT,
  po_line TEXT,
  date_order TEXT,
  item_code TEXT,
  reference TEXT,
  description_short TEXT,
  description TEXT,
  qty TEXT,
  unit TEXT,
  unit_price TEXT,
  total_line TEXT,
  currency TEXT,
  delivery_date TEXT,
  vendor_id TEXT,
  vendor TEXT,
  vat_rate TEXT,
  vat_currency TEXT
);

COMMENT ON TABLE tmp_tools_purchase_order_import IS 'Drop this placeholder table and copy the TSV using psql before running the rest of the script.';

-- Insert unique orders into mod_tools_purchase_orders.
WITH normalized_orders AS (
  SELECT DISTINCT ON (po_key)
    po_key,
    COALESCE(
      NULLIF(REGEXP_REPLACE(po_number_long, '\s+', '', 'g'), ''),
      NULLIF(REGEXP_REPLACE(po_number, '\s+', '', 'g'), '')
    ) AS po_number_key,
    TO_DATE(NULLIF(TRIM(date_order), ''), 'DD/MM/YYYY') AS po_date,
    COALESCE(
      NULLIF(REGEXP_REPLACE(po_number, '[^0-9]+', '', 'g'), ''),
      '0'
    )::INTEGER AS po_seq,
    COALESCE(NULLIF(TRIM(currency), ''), 'EUR') AS currency_code,
    GREATEST(0, NULLIF(REGEXP_REPLACE(vat_rate, '[^0-9.-]+', '', 'g'), '')::NUMERIC) AS tax_rate,
    vendor AS supplier_name,
    COALESCE(
      NULLIF(REGEXP_REPLACE(vendor, '[^A-Za-z0-9\s.-]', '', 'g'), ''),
      'Unnamed vendor'
    ) AS supplier_clean
  FROM (
    SELECT *,
      COALESCE(
        NULLIF(REGEXP_REPLACE(po_number_long, '\s+', '', 'g'), ''),
        NULLIF(REGEXP_REPLACE(po_number, '\s+', '', 'g'), '')
      ) AS po_key
    FROM tmp_tools_purchase_order_import
  ) t
  WHERE TRIM(COALESCE(po_number_long, po_number, '')) <> ''
  ORDER BY po_key, date_order DESC
)
INSERT INTO mod_tools_purchase_orders (
  org_id,
  po_date,
  po_seq,
  po_number,
  status,
  supplier_name,
  currency,
  tax_rate,
  our_company,
  our_contact_name,
  our_address,
  our_phone,
  our_email,
  created_at,
  updated_at
)
SELECT
  NULL,
  COALESCE(po_date, CURRENT_DATE),
  po_seq,
  po_number_key,
  'draft',
  supplier_name,
  currency_code,
  tax_rate,
  'Ivana Gottvaldova',
  'Olivier Michaud',
  'Dobrovodská 21, 370 06 České Budějovice',
  '+420 602 429 381',
  'francetechnologie@gmail.com',
  NOW(),
  NOW()
FROM normalized_orders
ON CONFLICT ON CONSTRAINT uq_mod_tools_purchase_orders_po_number DO NOTHING;

-- Insert matching lines.
WITH order_map AS (
  SELECT id, po_number
  FROM mod_tools_purchase_orders
), normalized_lines AS (
  SELECT
    COALESCE(
      NULLIF(REGEXP_REPLACE(po_number_long, '\s+', '', 'g'), ''),
      NULLIF(REGEXP_REPLACE(po_number, '\s+', '', 'g'), '')
    ) AS po_key,
    COALESCE(NULLIF(REGEXP_REPLACE(po_line, '[^0-9]+', '', 'g'), ''), '0')::INTEGER AS line_no,
    item_code,
    reference,
    description_short,
    description,
    NULLIF(REGEXP_REPLACE(qty, '[^0-9.-]+', '', 'g'), '')::NUMERIC AS quantity,
    unit,
    NULLIF(REGEXP_REPLACE(unit_price, '[^0-9.-]+', '', 'g'), '')::NUMERIC AS unit_price,
    COALESCE(NULLIF(TRIM(currency), ''), 'EUR') AS currency_code,
    TO_DATE(NULLIF(TRIM(delivery_date), ''), 'DD/MM/YYYY') AS delivery_date
  FROM tmp_tools_purchase_order_import
  WHERE COALESCE(NULLIF(REGEXP_REPLACE(po_number_long, '\s+', '', 'g'), ''), NULLIF(REGEXP_REPLACE(po_number, '\s+', '', 'g'), '')) IS NOT NULL
)
INSERT INTO mod_tools_purchase_order_lines (
  purchase_order_id,
  org_id,
  line_no,
  item_sku,
  item_name,
  reference,
  description_short,
  description,
  quantity,
  unit,
  unit_price,
  currency,
  delivery_date,
  status,
  qty_delivered,
  rest,
  created_at
)
SELECT
  o.id,
  NULL,
  COALESCE(n.line_no, ROW_NUMBER() OVER (PARTITION BY n.po_key ORDER BY n.line_no)),
  n.item_code,
  n.item_code,
  n.reference,
  n.description_short,
  n.description,
  COALESCE(n.quantity, 0),
  n.unit,
  n.unit_price,
  n.currency_code,
  n.delivery_date,
  'not updated',
  0,
  COALESCE(n.quantity, 0),
  NOW()
FROM normalized_lines n
JOIN order_map o ON o.po_number = n.po_key
ON CONFLICT (purchase_order_id, line_no) DO NOTHING;

COMMIT;

-- Cleanup
DROP TABLE IF EXISTS tmp_tools_purchase_order_import;
