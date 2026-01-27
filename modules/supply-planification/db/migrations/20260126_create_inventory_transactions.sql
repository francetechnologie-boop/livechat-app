-- Inventory transactions (entries + adjustments)

CREATE TABLE IF NOT EXISTS public.mod_supply_planification_inventory_transactions (
  id UUID PRIMARY KEY,
  org_id INTEGER NULL,
  kind TEXT NOT NULL, -- 'entry' | 'adjustment'
  item_ref TEXT NOT NULL,
  location_code TEXT NOT NULL DEFAULT 'default',
  qty_delta NUMERIC NOT NULL,
  reason TEXT NULL,
  source TEXT NULL, -- e.g. 'po-line' | 'ui'
  source_po_id INTEGER NULL,
  source_po_line_id INTEGER NULL,
  snapshot_batch_id UUID NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_supply_planification_inv_tx_org_created
  ON public.mod_supply_planification_inventory_transactions(org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mod_supply_planification_inv_tx_item
  ON public.mod_supply_planification_inventory_transactions(item_ref, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mod_supply_planification_inv_tx_kind
  ON public.mod_supply_planification_inventory_transactions(kind, created_at DESC);

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_supply_planification_inventory_transactions
      ADD CONSTRAINT fk_mod_supply_planification_inv_tx_batch
      FOREIGN KEY (snapshot_batch_id) REFERENCES public.mod_supply_planification_inventory_batches(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
END $$;

-- Guarded org_id foreign key (portable across environments)
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
      ALTER TABLE public.mod_supply_planification_inventory_transactions
        ADD CONSTRAINT fk_mod_supply_planification_inv_tx_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

