-- Extend mod_bom_items to store richer item data
DO $$ BEGIN
  IF to_regclass('public.mod_bom_items') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_items' AND column_name='code'
  ) THEN
    ALTER TABLE mod_bom_items ADD COLUMN code TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_items' AND column_name='reference'
  ) THEN
    ALTER TABLE mod_bom_items ADD COLUMN reference TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_items' AND column_name='description'
  ) THEN
    ALTER TABLE mod_bom_items ADD COLUMN description TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_items' AND column_name='description_short'
  ) THEN
    ALTER TABLE mod_bom_items ADD COLUMN description_short TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_items' AND column_name='picture'
  ) THEN
    ALTER TABLE mod_bom_items ADD COLUMN picture TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_items' AND column_name='unit'
  ) THEN
    ALTER TABLE mod_bom_items ADD COLUMN unit TEXT NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='mod_bom_items' AND column_name='procurement_type'
  ) THEN
    ALTER TABLE mod_bom_items ADD COLUMN procurement_type TEXT NULL;
  END IF;
END $$;

-- Helpful indexes for lookups
CREATE INDEX IF NOT EXISTS idx_bom_items_code ON mod_bom_items(code);
CREATE INDEX IF NOT EXISTS idx_bom_items_reference ON mod_bom_items(reference);
