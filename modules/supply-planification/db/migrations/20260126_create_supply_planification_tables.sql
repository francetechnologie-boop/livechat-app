-- Supply Planification tables (idempotent)

CREATE TABLE IF NOT EXISTS public.mod_supply_planification_settings (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Unique per org (NULL org_id behaves like "global" and may have multiple rows; API reads latest)
CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_supply_planification_settings_org_key
  ON public.mod_supply_planification_settings (org_id, key);

CREATE INDEX IF NOT EXISTS idx_mod_supply_planification_settings_org
  ON public.mod_supply_planification_settings(org_id);

CREATE TABLE IF NOT EXISTS public.mod_supply_planification_inventory_batches (
  id UUID PRIMARY KEY,
  org_id INTEGER NULL,
  snapshot_date DATE NOT NULL,
  source TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_supply_planification_inventory_batches_org_date
  ON public.mod_supply_planification_inventory_batches(org_id, snapshot_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mod_supply_planification_inventory_batch_lines (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  batch_id UUID NOT NULL,
  location_code TEXT NOT NULL,
  item_ref TEXT NOT NULL,
  qty NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_supply_planification_inventory_line_batch_item_loc
  ON public.mod_supply_planification_inventory_batch_lines(batch_id, item_ref, location_code);

CREATE INDEX IF NOT EXISTS idx_mod_supply_planification_inventory_lines_org_item
  ON public.mod_supply_planification_inventory_batch_lines(org_id, item_ref);

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_supply_planification_inventory_batch_lines
      ADD CONSTRAINT fk_mod_supply_planification_inventory_lines_batch
      FOREIGN KEY (batch_id) REFERENCES public.mod_supply_planification_inventory_batches(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
END $$;

-- Guarded org_id foreign keys (portable across environments)
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
      ALTER TABLE public.mod_supply_planification_settings
        ADD CONSTRAINT fk_mod_supply_planification_settings_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
    BEGIN
      ALTER TABLE public.mod_supply_planification_inventory_batches
        ADD CONSTRAINT fk_mod_supply_planification_inventory_batches_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
    BEGIN
      ALTER TABLE public.mod_supply_planification_inventory_batch_lines
        ADD CONSTRAINT fk_mod_supply_planification_inventory_batch_lines_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;
