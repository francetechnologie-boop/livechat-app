-- Supplier contacts table (multiple contacts per supplier)
CREATE TABLE IF NOT EXISTS mod_bom_supplier_contacts (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  supplier_id INTEGER NOT NULL,
  name TEXT NULL,
  email TEXT NULL,
  phone TEXT NULL,
  role TEXT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  meta JSONB NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bom_supplier_contacts_supplier ON mod_bom_supplier_contacts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_bom_supplier_contacts_org ON mod_bom_supplier_contacts(org_id);

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
      ALTER TABLE public.mod_bom_supplier_contacts
        ADD CONSTRAINT fk_bom_supplier_contacts_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

-- FK to suppliers (guarded: skip when suppliers table missing)
DO $$ BEGIN
  IF to_regclass('public.mod_bom_suppliers') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.mod_bom_supplier_contacts
        ADD CONSTRAINT fk_bom_supplier_contacts_supplier
        FOREIGN KEY (supplier_id) REFERENCES public.mod_bom_suppliers(id) ON DELETE CASCADE;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;
