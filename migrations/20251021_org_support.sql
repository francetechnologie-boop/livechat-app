-- up
-- Organization support + org_id columns (idempotent, non-destructive)

-- 1) Organizations table
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Ensure at least one default row exists (single-tenant safety)
INSERT INTO organizations (name)
SELECT 'Default'
WHERE NOT EXISTS (SELECT 1 FROM organizations);

-- 2) Add org_id columns (nullable) to existing tables if missing
-- Messages
ALTER TABLE IF EXISTS messages ADD COLUMN IF NOT EXISTS org_id INT;
CREATE INDEX IF NOT EXISTS idx_messages_org ON messages(org_id);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_messages_org'
  ) THEN
    ALTER TABLE messages
    ADD CONSTRAINT fk_messages_org FOREIGN KEY (org_id)
      REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- Visitors
ALTER TABLE IF EXISTS visitors ADD COLUMN IF NOT EXISTS org_id INT;
CREATE INDEX IF NOT EXISTS idx_visitors_org ON visitors(org_id);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_visitors_org'
  ) THEN
    ALTER TABLE visitors
    ADD CONSTRAINT fk_visitors_org FOREIGN KEY (org_id)
      REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- Visits
ALTER TABLE IF EXISTS visits ADD COLUMN IF NOT EXISTS org_id INT;
CREATE INDEX IF NOT EXISTS idx_visits_org ON visits(org_id);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_visits_org'
  ) THEN
    ALTER TABLE visits
    ADD CONSTRAINT fk_visits_org FOREIGN KEY (org_id)
      REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- Agents
ALTER TABLE IF EXISTS agents ADD COLUMN IF NOT EXISTS org_id INT;
CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_agents_org'
  ) THEN
    ALTER TABLE agents
    ADD CONSTRAINT fk_agents_org FOREIGN KEY (org_id)
      REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- Auto messages (if present)
ALTER TABLE IF EXISTS auto_messages ADD COLUMN IF NOT EXISTS org_id INT;
CREATE INDEX IF NOT EXISTS idx_auto_messages_org ON auto_messages(org_id);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_auto_messages_org'
  ) THEN
    ALTER TABLE auto_messages
    ADD CONSTRAINT fk_auto_messages_org FOREIGN KEY (org_id)
      REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- Prompt repositories
ALTER TABLE IF EXISTS prompt_config ADD COLUMN IF NOT EXISTS org_id INT;
CREATE INDEX IF NOT EXISTS idx_prompt_config_org ON prompt_config(org_id);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_prompt_config_org'
  ) THEN
    ALTER TABLE prompt_config
    ADD CONSTRAINT fk_prompt_config_org FOREIGN KEY (org_id)
      REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

ALTER TABLE IF EXISTS local_prompt ADD COLUMN IF NOT EXISTS org_id INT;
CREATE INDEX IF NOT EXISTS idx_local_prompt_org ON local_prompt(org_id);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_local_prompt_org'
  ) THEN
    ALTER TABLE local_prompt
    ADD CONSTRAINT fk_local_prompt_org FOREIGN KEY (org_id)
      REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- MCP server config (optional tenancy)
ALTER TABLE IF EXISTS mcp_server_config ADD COLUMN IF NOT EXISTS org_id INT;
CREATE INDEX IF NOT EXISTS idx_mcp_server_config_org ON mcp_server_config(org_id);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_mcp_server_config_org'
  ) THEN
    ALTER TABLE mcp_server_config
    ADD CONSTRAINT fk_mcp_server_config_org FOREIGN KEY (org_id)
      REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- (Add similar blocks per table as needed; this script is designed to be safe to re-run.)

-- down
-- Non-destructive: we do not drop columns or organizations to preserve data.

