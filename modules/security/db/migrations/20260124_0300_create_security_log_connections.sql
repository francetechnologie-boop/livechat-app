-- up
CREATE TABLE IF NOT EXISTS public.mod_security_log_connections (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  name TEXT NOT NULL,
  ssh_host TEXT NOT NULL DEFAULT '',
  ssh_user TEXT NOT NULL DEFAULT 'root',
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_key_path TEXT NULL,
  log_path TEXT NOT NULL DEFAULT '/var/log/apache2/access_unified_website.log',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Name uniqueness per org (and for global rows where org_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_security_log_connections_org_name
  ON public.mod_security_log_connections (org_id, name)
  WHERE org_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_security_log_connections_global_name
  ON public.mod_security_log_connections (name)
  WHERE org_id IS NULL;

-- One default per org (and at most one global default)
CREATE UNIQUE INDEX IF NOT EXISTS idx_security_log_connections_org_default
  ON public.mod_security_log_connections (org_id)
  WHERE org_id IS NOT NULL AND is_default = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_security_log_connections_global_default
  ON public.mod_security_log_connections ((1))
  WHERE org_id IS NULL AND is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_security_log_connections_org
  ON public.mod_security_log_connections (org_id);
CREATE INDEX IF NOT EXISTS idx_security_log_connections_updated_at
  ON public.mod_security_log_connections (updated_at DESC);

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
      ALTER TABLE public.mod_security_log_connections
        ADD CONSTRAINT fk_security_log_connections_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- down
-- DROP TABLE IF EXISTS public.mod_security_log_connections;
