-- Create purchase order tables (mod_tools_purchase_orders + mod_tools_purchase_order_lines)

CREATE TABLE IF NOT EXISTS mod_tools_purchase_orders (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  po_date DATE NOT NULL,
  po_seq INTEGER NOT NULL,
  po_number TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  supplier_id INTEGER NULL,
  supplier_name TEXT NULL,
  supplier_contact TEXT NULL,
  supplier_email TEXT NULL,
  supplier_phone TEXT NULL,
  supplier_address TEXT NULL,
  to_email TEXT NULL,
  currency VARCHAR(8) NULL,
  tax_rate NUMERIC NULL,
  our_company TEXT NULL,
  our_contact_name TEXT NULL,
  our_address TEXT NULL,
  our_phone TEXT NULL,
  our_email TEXT NULL,
  notes TEXT NULL,
  gmail_draft_id TEXT NULL,
  gmail_thread_id TEXT NULL,
  drafted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_tools_purchase_orders_po_number
  ON mod_tools_purchase_orders(po_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_tools_purchase_orders_org_date_seq
  ON mod_tools_purchase_orders(po_date, COALESCE(org_id, -1), po_seq);

CREATE INDEX IF NOT EXISTS idx_mod_tools_purchase_orders_org
  ON mod_tools_purchase_orders(org_id);

CREATE INDEX IF NOT EXISTS idx_mod_tools_purchase_orders_supplier
  ON mod_tools_purchase_orders(supplier_id);

CREATE TABLE IF NOT EXISTS mod_tools_purchase_order_lines (
  id SERIAL PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL,
  org_id INTEGER NULL,
  line_no INTEGER NOT NULL,
  item_id INTEGER NULL,
  item_sku TEXT NULL,
  item_name TEXT NULL,
  reference TEXT NULL,
  description_short TEXT NULL,
  description TEXT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit TEXT NULL,
  unit_price NUMERIC NULL,
  currency VARCHAR(8) NULL,
  delivery_date DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_tools_purchase_order_lines_po_line
  ON mod_tools_purchase_order_lines(purchase_order_id, line_no);

CREATE INDEX IF NOT EXISTS idx_mod_tools_purchase_order_lines_po
  ON mod_tools_purchase_order_lines(purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_mod_tools_purchase_order_lines_org
  ON mod_tools_purchase_order_lines(org_id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_mod_tools_purchase_order_lines_po'
  ) THEN
    ALTER TABLE public.mod_tools_purchase_order_lines
      ADD CONSTRAINT fk_mod_tools_purchase_order_lines_po
      FOREIGN KEY (purchase_order_id) REFERENCES public.mod_tools_purchase_orders(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Guarded org_id foreign keys (only when organizations.id is integer-like)
DO $$
DECLARE
  org_id_type TEXT := NULL;
BEGIN
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
      SELECT data_type INTO org_id_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'organizations'
         AND column_name = 'id'
       LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      org_id_type := NULL;
    END;
    IF org_id_type IN ('integer', 'bigint', 'smallint') THEN
      BEGIN
        ALTER TABLE public.mod_tools_purchase_orders
          ADD CONSTRAINT fk_mod_tools_purchase_orders_org
          FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
      BEGIN
        ALTER TABLE public.mod_tools_purchase_order_lines
          ADD CONSTRAINT fk_mod_tools_purchase_order_lines_org
          FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
    END IF;
  END IF;
END $$;
