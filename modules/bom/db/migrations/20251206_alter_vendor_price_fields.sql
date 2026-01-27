-- Add catalog/discount/net price fields to vendor tables (idempotent)

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_import_data_vendors' AND column_name='catalog_price'
  ) THEN
    ALTER TABLE mod_bom_import_data_vendors ADD COLUMN catalog_price NUMERIC NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_import_data_vendors' AND column_name='discount'
  ) THEN
    ALTER TABLE mod_bom_import_data_vendors ADD COLUMN discount NUMERIC NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_import_data_vendors' AND column_name='net_price'
  ) THEN
    ALTER TABLE mod_bom_import_data_vendors ADD COLUMN net_price NUMERIC NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_item_vendors' AND column_name='catalog_price'
  ) THEN
    ALTER TABLE mod_bom_item_vendors ADD COLUMN catalog_price NUMERIC NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_item_vendors' AND column_name='discount'
  ) THEN
    ALTER TABLE mod_bom_item_vendors ADD COLUMN discount NUMERIC NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_item_vendors' AND column_name='net_price'
  ) THEN
    ALTER TABLE mod_bom_item_vendors ADD COLUMN net_price NUMERIC NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_item_vendor_prices' AND column_name='catalog_price'
  ) THEN
    ALTER TABLE mod_bom_item_vendor_prices ADD COLUMN catalog_price NUMERIC NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_item_vendor_prices' AND column_name='discount'
  ) THEN
    ALTER TABLE mod_bom_item_vendor_prices ADD COLUMN discount NUMERIC NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_item_vendor_prices' AND column_name='net_price'
  ) THEN
    ALTER TABLE mod_bom_item_vendor_prices ADD COLUMN net_price NUMERIC NULL;
  END IF;
END $$;

