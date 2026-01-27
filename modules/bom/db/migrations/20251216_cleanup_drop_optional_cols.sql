-- Cleanup optional columns not required by the UI/logic
-- - mod_bom_item_vendor_prices: drop catalog_price, discount, net_price
-- - mod_bom_import_data_vendors: drop catalog_price, discount, net_price
-- Idempotent and safe across environments

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_bom_item_vendor_prices
      DROP COLUMN IF EXISTS catalog_price,
      DROP COLUMN IF EXISTS discount,
      DROP COLUMN IF EXISTS net_price;
  EXCEPTION WHEN others THEN NULL; END;
END $$;

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_bom_import_data_vendors
      DROP COLUMN IF EXISTS catalog_price,
      DROP COLUMN IF EXISTS discount,
      DROP COLUMN IF EXISTS net_price;
  EXCEPTION WHEN others THEN NULL; END;
END $$;

