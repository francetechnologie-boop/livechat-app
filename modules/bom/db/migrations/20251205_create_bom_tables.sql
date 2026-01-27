-- Create tables for BOM module (idempotent)

-- Suppliers
CREATE TABLE IF NOT EXISTS mod_bom_suppliers (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  name TEXT NOT NULL,
  contact TEXT NULL,
  meta JSONB NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bom_suppliers_org ON mod_bom_suppliers(org_id);

-- Items
CREATE TABLE IF NOT EXISTS mod_bom_items (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  supplier_id INTEGER NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  uom TEXT NOT NULL DEFAULT 'pcs',
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bom_items_org ON mod_bom_items(org_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_supplier ON mod_bom_items(supplier_id);
-- Unique SKU per org (allow NULL org_id duplicates)
DO $$ BEGIN
  BEGIN
    CREATE UNIQUE INDEX uq_bom_items_org_sku ON mod_bom_items(org_id, sku);
  EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END;
END $$;

-- BOMs
CREATE TABLE IF NOT EXISTS mod_bom_boms (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  name TEXT NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bom_boms_org ON mod_bom_boms(org_id);

-- BOM Items (junction)
CREATE TABLE IF NOT EXISTS mod_bom_bom_items (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  bom_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  position INTEGER NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bom_bom_items_pair ON mod_bom_bom_items(bom_id, item_id);
CREATE INDEX IF NOT EXISTS idx_bom_bom_items_org ON mod_bom_bom_items(org_id);
CREATE INDEX IF NOT EXISTS idx_bom_bom_items_bom ON mod_bom_bom_items(bom_id);
CREATE INDEX IF NOT EXISTS idx_bom_bom_items_item ON mod_bom_bom_items(item_id);

-- Guarded FKs to organizations
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
      ALTER TABLE public.mod_bom_suppliers
        ADD CONSTRAINT fk_bom_suppliers_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
    BEGIN
      ALTER TABLE public.mod_bom_items
        ADD CONSTRAINT fk_bom_items_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
    BEGIN
      ALTER TABLE public.mod_bom_boms
        ADD CONSTRAINT fk_bom_boms_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
    BEGIN
      ALTER TABLE public.mod_bom_bom_items
        ADD CONSTRAINT fk_bom_bom_items_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

-- FKs within module (safe to add idempotently)
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_bom_items
      ADD CONSTRAINT fk_bom_items_supplier
      FOREIGN KEY (supplier_id) REFERENCES public.mod_bom_suppliers(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  BEGIN
    ALTER TABLE public.mod_bom_bom_items
      ADD CONSTRAINT fk_bom_bom_items_bom
      FOREIGN KEY (bom_id) REFERENCES public.mod_bom_boms(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  BEGIN
    ALTER TABLE public.mod_bom_bom_items
      ADD CONSTRAINT fk_bom_bom_items_item
      FOREIGN KEY (item_id) REFERENCES public.mod_bom_items(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
END $$;

