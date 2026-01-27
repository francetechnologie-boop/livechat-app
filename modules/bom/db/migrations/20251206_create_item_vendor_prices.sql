-- Price history per item/vendor
CREATE TABLE IF NOT EXISTS mod_bom_item_vendor_prices (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  item_id INTEGER NOT NULL,
  supplier_id INTEGER NULL,
  price NUMERIC NOT NULL,
  currency TEXT NULL,
  effective_at TIMESTAMP NOT NULL,
  source TEXT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bom_item_vendor_prices_item ON mod_bom_item_vendor_prices(item_id);
CREATE INDEX IF NOT EXISTS idx_bom_item_vendor_prices_supplier ON mod_bom_item_vendor_prices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_bom_item_vendor_prices_effective ON mod_bom_item_vendor_prices(effective_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bom_item_vendor_prices ON mod_bom_item_vendor_prices(item_id, COALESCE(supplier_id, -1), effective_at, price);

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
      ALTER TABLE public.mod_bom_item_vendor_prices
        ADD CONSTRAINT fk_bom_item_vendor_prices_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

-- FKs to module tables
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_bom_item_vendor_prices
      ADD CONSTRAINT fk_bom_item_vendor_prices_item
      FOREIGN KEY (item_id) REFERENCES public.mod_bom_items(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  BEGIN
    ALTER TABLE public.mod_bom_item_vendor_prices
      ADD CONSTRAINT fk_bom_item_vendor_prices_supplier
      FOREIGN KEY (supplier_id) REFERENCES public.mod_bom_suppliers(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
END $$;

