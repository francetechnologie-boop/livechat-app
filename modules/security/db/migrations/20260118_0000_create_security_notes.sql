-- up
CREATE TABLE IF NOT EXISTS public.mod_security_notes (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  tab TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- If an early revision created full-table UNIQUE constraints, drop them.
ALTER TABLE public.mod_security_notes DROP CONSTRAINT IF EXISTS uq_security_notes_global_tab;
ALTER TABLE public.mod_security_notes DROP CONSTRAINT IF EXISTS uq_security_notes_org_tab;

-- Helpful indexes (partial to avoid NULL uniqueness quirks)
CREATE UNIQUE INDEX IF NOT EXISTS idx_security_notes_org_tab
  ON public.mod_security_notes (org_id, tab) WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_security_notes_global_tab
  ON public.mod_security_notes (tab) WHERE org_id IS NULL;

-- Guarded org_id foreign key (portable)
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
      ALTER TABLE public.mod_security_notes
        ADD CONSTRAINT fk_security_notes_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- down
-- DROP TABLE IF EXISTS public.mod_security_notes;
