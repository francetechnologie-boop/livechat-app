-- Add procurement_type1 column with constrained allowed values (idempotent)
-- Allowed values: 'Acheté sur commande', 'Sur stock', 'fabriqué', 'sous-ensemble', 'indefini'

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'mod_bom_items'
       AND column_name = 'procurement_type1'
  ) THEN
    ALTER TABLE mod_bom_items ADD COLUMN procurement_type1 TEXT NULL;
  END IF;
END $$;

-- Constrain values (permit NULL for legacy rows)
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_bom_items
      ADD CONSTRAINT ck_bom_items_procurement_type1
      CHECK (
        procurement_type1 IS NULL OR
        procurement_type1 IN (
          'Acheté sur commande',
          'Sur stock',
          'fabriqué',
          'sous-ensemble',
          'indefini',
          'obselete'
        )
      );
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL; -- Keep portable across environments
  END;
END $$;

