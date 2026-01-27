-- Many-to-many: items <-> suppliers (vendors)
CREATE TABLE IF NOT EXISTS mod_bom_item_vendors (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  item_id INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL,
  supplier_item_code TEXT NULL,
  price NUMERIC NULL,
  currency TEXT NULL,
  moq INTEGER NULL,
  lead_time_days INTEGER NULL,
  preferred BOOLEAN NOT NULL DEFAULT FALSE,
  priority INTEGER NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bom_item_vendors_pair ON mod_bom_item_vendors(item_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_bom_item_vendors_org ON mod_bom_item_vendors(org_id);
CREATE INDEX IF NOT EXISTS idx_bom_item_vendors_item ON mod_bom_item_vendors(item_id);
CREATE INDEX IF NOT EXISTS idx_bom_item_vendors_supplier ON mod_bom_item_vendors(supplier_id);

-- Guarded FK to organizations
DO $$ BEGIN
  IF to_regclass('public.organizations') IS NOT NULL AND EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
     WHERE n.nspname = 'public' AND t.relname = 'organizations'
       AND i.indisunique = TRUE
       AND array_length(i.indkey,1) = 1
       AND a.attname = 'id'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_bom_item_vendors
        ADD CONSTRAINT fk_bom_item_vendors_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

-- FKs to module tables
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_bom_item_vendors
      ADD CONSTRAINT fk_bom_item_vendors_item
      FOREIGN KEY (item_id) REFERENCES public.mod_bom_items(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  BEGIN
    ALTER TABLE public.mod_bom_item_vendors
      ADD CONSTRAINT fk_bom_item_vendors_supplier
      FOREIGN KEY (supplier_id) REFERENCES public.mod_bom_suppliers(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
END $$;

