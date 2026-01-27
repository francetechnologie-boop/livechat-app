-- Add detail columns to suppliers
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_suppliers' AND column_name='street_address'
  ) THEN
    ALTER TABLE mod_bom_suppliers ADD COLUMN street_address TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_suppliers' AND column_name='city'
  ) THEN
    ALTER TABLE mod_bom_suppliers ADD COLUMN city TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_suppliers' AND column_name='country'
  ) THEN
    ALTER TABLE mod_bom_suppliers ADD COLUMN country TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_suppliers' AND column_name='zip'
  ) THEN
    ALTER TABLE mod_bom_suppliers ADD COLUMN zip TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_suppliers' AND column_name='phone'
  ) THEN
    ALTER TABLE mod_bom_suppliers ADD COLUMN phone TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_suppliers' AND column_name='email'
  ) THEN
    ALTER TABLE mod_bom_suppliers ADD COLUMN email TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_suppliers' AND column_name='tax_rate'
  ) THEN
    ALTER TABLE mod_bom_suppliers ADD COLUMN tax_rate NUMERIC NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_suppliers' AND column_name='currency'
  ) THEN
    ALTER TABLE mod_bom_suppliers ADD COLUMN currency TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_suppliers' AND column_name='vendor_code'
  ) THEN
    ALTER TABLE mod_bom_suppliers ADD COLUMN vendor_code TEXT NULL;
  END IF;
END $$;

