-- Import order line status history at once.
-- Steps:
--   1. Save your history TSV/CSV somewhere (e.g., /tmp/order-line-history.tsv) with headers like
--        po_number, po_number_long, po_line, status, date_update, reste, "Qty Partiel", replan
--   2. Run the script manually, and in the same session bulk-load the file into the temp table:
--        \copy tmp_order_line_status_history FROM '/tmp/order-line-history.tsv' WITH (FORMAT csv, DELIMITER E'\t', HEADER true, NULL '');
--   3. Continue running this script (the temp table exists until the session ends) to populate the module table.

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS tmp_order_line_status_history (
  po_number TEXT,
  po_number_long TEXT,
  po_line TEXT,
  status TEXT,
  date_update TEXT,
  reste TEXT,
  qty_partiel TEXT,
  replan TEXT,
  notes TEXT
);

COMMENT ON TABLE tmp_order_line_status_history IS 'Temporary staging table for order line status history imports.';

WITH normalized_history AS (
  SELECT
    COALESCE(
      NULLIF(REGEXP_REPLACE(po_number_long, '\s+', '', 'g'), ''),
      NULLIF(REGEXP_REPLACE(po_number, '\s+', '', 'g'), '')
    ) AS po_key,
    COALESCE(NULLIF(REGEXP_REPLACE(po_line, '[^0-9]+', '', 'g'), ''), '0')::INTEGER AS line_no,
    NULLIF(TRIM(status), '') AS status,
    CASE
      WHEN TRIM(date_update) = '' THEN NULL
      ELSE TO_TIMESTAMP(NULLIF(TRIM(date_update), ''), 'DD/MM/YYYY HH24:MI:SS')
    END AS updated_at,
    NULLIF(TO_DATE(NULLIF(TRIM(replan), ''), 'DD/MM/YYYY'), DATE '0001-01-01') AS replan_date,
    NULLIF(REGEXP_REPLACE(reste, '[^0-9.-]+', '', 'g'), '')::NUMERIC AS rest,
    NULLIF(REGEXP_REPLACE(qty_partiel, '[^0-9.-]+', '', 'g'), '')::NUMERIC AS qty_partial,
    notes
  FROM tmp_order_line_status_history
)
INSERT INTO mod_tools_order_line_status_history (
  purchase_order_id, purchase_order_line_id, org_id, status, rest, qty_partial, replan_date, notes, created_at
)
SELECT
  o.id,
  l.id,
  l.org_id,
  normalized_history.status,
  normalized_history.rest,
  normalized_history.qty_partial,
  normalized_history.replan_date,
  normalized_history.notes,
  COALESCE(normalized_history.updated_at, NOW())
FROM normalized_history
JOIN mod_tools_purchase_orders o ON o.po_number = normalized_history.po_key
JOIN mod_tools_purchase_order_lines l ON l.purchase_order_id = o.id AND l.line_no = normalized_history.line_no;

COMMIT;

DROP TABLE IF EXISTS tmp_order_line_status_history;
