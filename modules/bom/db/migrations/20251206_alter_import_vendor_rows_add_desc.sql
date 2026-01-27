-- Extend staging table with descriptive fields (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='mod_bom_import_data_vendors' AND column_name='description'
  ) THEN
    ALTER TABLE mod_bom_import_data_vendors ADD COLUMN description TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='mod_bom_import_data_vendors' AND column_name='description_short'
  ) THEN
    ALTER TABLE mod_bom_import_data_vendors ADD COLUMN description_short TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='mod_bom_import_data_vendors' AND column_name='unit'
  ) THEN
    ALTER TABLE mod_bom_import_data_vendors ADD COLUMN unit TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='mod_bom_import_data_vendors' AND column_name='reference'
  ) THEN
    ALTER TABLE mod_bom_import_data_vendors ADD COLUMN reference TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='mod_bom_import_data_vendors' AND column_name='name'
  ) THEN
    ALTER TABLE mod_bom_import_data_vendors ADD COLUMN name TEXT NULL;
  END IF;
END $$;

