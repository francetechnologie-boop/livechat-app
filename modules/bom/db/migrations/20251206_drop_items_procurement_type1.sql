-- Drop procurement_type1 from mod_bom_items (idempotent)

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_bom_items
      DROP CONSTRAINT IF EXISTS ck_bom_items_procurement_type1;
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    ALTER TABLE public.mod_bom_items
      DROP COLUMN IF EXISTS procurement_type1;
  EXCEPTION WHEN others THEN NULL; END;
END $$;

