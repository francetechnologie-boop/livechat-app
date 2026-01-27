-- Backfill created_at for inventory lines (requested baseline)
-- Set existing rows to 2026-01-01 to normalize historical imports.

UPDATE public.mod_supply_planification_inventory_batch_lines
   SET created_at = TIMESTAMP '2026-01-01 00:00:00'
 WHERE created_at IS DISTINCT FROM TIMESTAMP '2026-01-01 00:00:00';

