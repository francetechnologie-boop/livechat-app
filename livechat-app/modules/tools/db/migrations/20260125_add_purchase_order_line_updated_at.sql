-- Add updated_at timestamp to purchase order lines so PATCH updates succeed

ALTER TABLE IF EXISTS mod_tools_purchase_order_lines
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

UPDATE mod_tools_purchase_order_lines
   SET updated_at = NOW()
 WHERE updated_at IS NULL;
