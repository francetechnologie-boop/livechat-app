-- Create testmcp tables (idempotent)
-- Date: 2025-10-28 (Europe/Prague)

-- Tools registry (optional, used to override/extend static tools)
CREATE TABLE IF NOT EXISTS mod_testmcp_tool (
  name TEXT PRIMARY KEY,
  description TEXT,
  org_id TEXT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
-- Add FK only if organizations exists and has a PK/unique on id
DO $$
DECLARE has_orgs boolean; has_pk boolean; has_fk boolean; id_type TEXT;
BEGIN
  SELECT to_regclass('public.organizations') IS NOT NULL INTO has_orgs;
  IF has_orgs THEN
    -- Detect data type of organizations.id to ensure compatibility
    SELECT data_type INTO id_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='organizations' AND column_name='id'
      LIMIT 1;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name   = 'organizations'
        AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
        AND kcu.column_name = 'id'
    ) INTO has_pk;
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_testmcp_tool_org'
    ) INTO has_fk;
    -- Only create FK when types are compatible (TEXT or VARCHAR)
    IF has_pk AND NOT has_fk AND id_type IN ('text','character varying') THEN
      ALTER TABLE mod_testmcp_tool
        ADD CONSTRAINT fk_testmcp_tool_org
        FOREIGN KEY (org_id) REFERENCES organizations(id)
        ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
    END IF;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_testmcp_tool_org ON mod_testmcp_tool(org_id);

-- Events log (captures tool calls and messages)
CREATE TABLE IF NOT EXISTS mod_testmcp_events (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  payload JSONB,
  org_id TEXT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
DO $$
DECLARE has_orgs boolean; has_pk boolean; has_fk boolean; id_type TEXT;
BEGIN
  SELECT to_regclass('public.organizations') IS NOT NULL INTO has_orgs;
  IF has_orgs THEN
    SELECT data_type INTO id_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='organizations' AND column_name='id'
      LIMIT 1;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name   = 'organizations'
        AND tc.constraint_type IN ('PRIMARY KEY','UNIQUE')
        AND kcu.column_name = 'id'
    ) INTO has_pk;
    SELECT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'fk_testmcp_events_org'
    ) INTO has_fk;
    IF has_pk AND NOT has_fk AND id_type IN ('text','character varying') THEN
      ALTER TABLE mod_testmcp_events
        ADD CONSTRAINT fk_testmcp_events_org
        FOREIGN KEY (org_id) REFERENCES organizations(id)
        ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
    END IF;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_testmcp_events_org ON mod_testmcp_events(org_id);
CREATE INDEX IF NOT EXISTS idx_testmcp_events_created ON mod_testmcp_events(created_at DESC);

-- Seed a few default tools when empty
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM mod_testmcp_tool) THEN
    INSERT INTO mod_testmcp_tool (name, description) VALUES
      ('ping', 'Responds with ok:true'),
      ('time.now', 'Returns ISO timestamp'),
      ('random.int', 'Random integer in [min,max]'),
      ('echo', 'Echo back a message')
    ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;
