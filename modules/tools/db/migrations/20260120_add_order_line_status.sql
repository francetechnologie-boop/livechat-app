-- Add status/qty tracking columns to purchase order lines
ALTER TABLE IF EXISTS mod_tools_purchase_order_lines
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'not updated';
ALTER TABLE IF EXISTS mod_tools_purchase_order_lines
  ADD COLUMN IF NOT EXISTS qty_delivered NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE IF EXISTS mod_tools_purchase_order_lines
  ADD COLUMN IF NOT EXISTS rest NUMERIC NOT NULL DEFAULT 0;

UPDATE mod_tools_purchase_order_lines
   SET rest = COALESCE(quantity, 0)
 WHERE rest IS NULL OR rest <> COALESCE(quantity, 0);
