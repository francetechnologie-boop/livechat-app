-- Rename legacy public.gateway_lines to module-scoped public.mod_gateway_lines
-- and align with AGENTS.md table naming and org_id support.
-- Idempotent: safe to re-run.

DO $$ BEGIN
  -- If legacy table exists and new one does not, rename it
  IF to_regclass('public.gateway_lines') IS NOT NULL AND to_regclass('public.mod_gateway_lines') IS NULL THEN
    BEGIN
      ALTER TABLE public.gateway_lines RENAME TO mod_gateway_lines;
    EXCEPTION WHEN others THEN NULL; -- tolerate permission/env diffs
    END;
  END IF;
END $$;

-- If neither table exists, create mod_gateway_lines with the legacy schema
DO $$ BEGIN
  IF to_regclass('public.mod_gateway_lines') IS NULL THEN
    BEGIN
      CREATE TABLE public.mod_gateway_lines (
        id BIGSERIAL PRIMARY KEY,
        org_id INTEGER NULL,
        device_id TEXT NULL,
        subscription_id INTEGER NULL,
        sim_slot INTEGER NULL,
        carrier TEXT NULL,
        display_name TEXT NULL,
        msisdn TEXT NULL,
        last_seen TIMESTAMP NULL DEFAULT NOW()
      );
    EXCEPTION WHEN duplicate_table THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

-- Ensure org_id column exists after a rename (legacy table had no org_id)
DO $$ BEGIN
  IF to_regclass('public.mod_gateway_lines') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'mod_gateway_lines' AND column_name = 'org_id'
    ) THEN
      BEGIN
        ALTER TABLE public.mod_gateway_lines ADD COLUMN org_id INTEGER NULL;
      EXCEPTION WHEN duplicate_column THEN NULL; WHEN others THEN NULL; END;
    END IF;
  END IF;
END $$;

-- Guarded foreign key to organizations (see AGENTS.md template)
DO $$ BEGIN
  IF to_regclass('public.mod_gateway_lines') IS NOT NULL THEN
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
        ALTER TABLE public.mod_gateway_lines
          ADD CONSTRAINT fk_mod_gateway_lines_org
          FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
    END IF;
  END IF;
END $$;

-- Ensure indexes (module-prefixed). Keep legacy unique semantics on subscription_id
DO $$ BEGIN
  IF to_regclass('public.mod_gateway_lines') IS NOT NULL THEN
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_mod_gateway_lines_last_seen ON public.mod_gateway_lines (last_seen DESC);
      CREATE INDEX IF NOT EXISTS idx_mod_gateway_lines_msisdn ON public.mod_gateway_lines (msisdn);
      -- Legacy was unique per subscription_id (no org scope). Keep behavior for compatibility.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_gateway_lines_sub ON public.mod_gateway_lines (subscription_id);
      -- Helpful filter by org when present
      CREATE INDEX IF NOT EXISTS idx_mod_gateway_lines_org ON public.mod_gateway_lines (org_id);
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;

-- Backwards-compat view: expose legacy name if table does not exist
DO $$ BEGIN
  IF to_regclass('public.gateway_lines') IS NULL AND to_regclass('public.mod_gateway_lines') IS NOT NULL THEN
    BEGIN
      CREATE OR REPLACE VIEW public.gateway_lines AS SELECT * FROM public.mod_gateway_lines;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;

