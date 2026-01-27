CREATE TABLE IF NOT EXISTS public.mod_security_commands (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE public.mod_security_commands
  ADD CONSTRAINT IF NOT EXISTS uq_security_commands_org_name UNIQUE (org_id, name);

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_commands_global
  ON public.mod_security_commands (name)
  WHERE org_id IS NULL;

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
      ALTER TABLE public.mod_security_commands
        ADD CONSTRAINT fk_security_commands_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_security_commands_org ON public.mod_security_commands (org_id);

-- down
-- DROP TABLE IF EXISTS public.mod_security_commands;
