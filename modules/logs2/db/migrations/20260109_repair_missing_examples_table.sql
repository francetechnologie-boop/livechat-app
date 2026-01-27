-- up
-- Repair migration history mismatch: 20251019_create_example_table.sql may be marked applied even if the table is missing.
-- This migration is idempotent and recreates the expected table if absent.
-- Europe/Prague date: 2026-01-09
DO $logs2_repair_examples$
BEGIN
  IF to_regclass('public.mod_logs2_examples') IS NULL THEN
    CREATE TABLE IF NOT EXISTS public.mod_logs2_examples (
      id SERIAL PRIMARY KEY,
      org_id TEXT NULL,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Guarded org_id foreign key (portable across envs)
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
          ALTER TABLE public.mod_logs2_examples
            ADD CONSTRAINT fk_logs2_examples_org
            FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
        EXCEPTION
          WHEN duplicate_object THEN NULL;
          WHEN others THEN NULL;
        END;
      END IF;
    EXCEPTION
      WHEN others THEN NULL;
    END;
  END IF;
END
$logs2_repair_examples$;

-- down
-- Non-destructive: keep table.
