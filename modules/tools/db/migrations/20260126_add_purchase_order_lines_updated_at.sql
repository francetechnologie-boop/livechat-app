-- Ensure mod_tools_purchase_order_lines has updated_at (backend expects it for PATCH updates)

ALTER TABLE IF EXISTS mod_tools_purchase_order_lines
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

UPDATE mod_tools_purchase_order_lines
   SET updated_at = COALESCE(updated_at, created_at, NOW())
 WHERE updated_at IS NULL;

