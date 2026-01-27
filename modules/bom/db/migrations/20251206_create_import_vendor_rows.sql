-- Staging table for heterogeneous vendor import rows (idempotent)

CREATE TABLE IF NOT EXISTS mod_bom_import_data_vendors (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  vendor_name TEXT NULL,
  source TEXT NULL,
  header JSONB NULL,
  row_number INTEGER NULL,
  raw_line TEXT NULL,
  parsed JSONB NULL,
  mapped JSONB NULL,
  item_code TEXT NULL,
  supplier_item_code TEXT NULL,
  supplier_name TEXT NULL,
  supplier_id INTEGER NULL,
  item_id INTEGER NULL,
  price NUMERIC NULL,
  currency TEXT NULL,
  moq INTEGER NULL,
  lead_time_days INTEGER NULL,
  effective_at TIMESTAMP NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|processed|skipped|error
  error TEXT NULL,
  dedup_sha256 TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS idx_bom_import_vendors_status ON mod_bom_import_data_vendors(status);
CREATE INDEX IF NOT EXISTS idx_bom_import_vendors_org ON mod_bom_import_data_vendors(org_id);
CREATE INDEX IF NOT EXISTS idx_bom_import_vendors_vendor ON mod_bom_import_data_vendors(vendor_name);
CREATE INDEX IF NOT EXISTS idx_bom_import_vendors_item_code ON mod_bom_import_data_vendors(item_code);
CREATE INDEX IF NOT EXISTS idx_bom_import_vendors_supplier_name ON mod_bom_import_data_vendors(supplier_name);

DO $$ BEGIN
  BEGIN
    CREATE UNIQUE INDEX uq_bom_import_vendors_dedup ON mod_bom_import_data_vendors(COALESCE(org_id, -1), COALESCE(vendor_name, ''), COALESCE(dedup_sha256, ''));
  EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END;
END $$;

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
      ALTER TABLE public.mod_bom_import_data_vendors
        ADD CONSTRAINT fk_bom_import_vendors_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

