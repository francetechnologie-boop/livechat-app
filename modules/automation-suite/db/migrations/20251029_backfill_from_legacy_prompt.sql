-- Backfill legacy prompt_* tables into module-prefixed equivalents
-- Tables covered: prompt_config, prompt_test_history, prompt_config_mcp, prompt_config_mcp2
-- Idempotent and safe to re-run.

-- Ensure organizations table and default org
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO organizations(name)
SELECT 'Default'
WHERE NOT EXISTS (SELECT 1 FROM organizations);

-- Destination: prompt configs (module)
CREATE TABLE IF NOT EXISTS mod_automation_suite_prompt_config (
  id TEXT PRIMARY KEY,
  org_id INT NULL REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  name TEXT NULL,
  dev_message TEXT NULL,
  messages JSONB NULL,
  tools JSONB NULL,
  openai_api_key TEXT NULL,
  prompt_id TEXT NULL,
  prompt_version TEXT NULL,
  model TEXT NULL,
  vector_store_id TEXT NULL,
  vector_store_ids JSON NULL,
  metadata JSONB NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mod_as_prompt_config_org_idx ON mod_automation_suite_prompt_config(org_id);

-- Destination: prompt test history
CREATE TABLE IF NOT EXISTS mod_automation_suite_prompt_test_history (
  id TEXT PRIMARY KEY,
  prompt_config_id TEXT NOT NULL REFERENCES mod_automation_suite_prompt_config(id) ON DELETE CASCADE,
  input TEXT NULL,
  output TEXT NULL,
  request JSONB NULL,
  response JSONB NULL,
  ms INTEGER NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Destination: mapping to MCP server tables (global)
CREATE TABLE IF NOT EXISTS mod_automation_suite_prompt_mcp (
  prompt_config_id TEXT NOT NULL REFERENCES mod_automation_suite_prompt_config(id) ON DELETE CASCADE,
  mcp_server_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (prompt_config_id, mcp_server_id)
);

CREATE TABLE IF NOT EXISTS mod_automation_suite_prompt_mcp2 (
  prompt_config_id TEXT NOT NULL REFERENCES mod_automation_suite_prompt_config(id) ON DELETE CASCADE,
  mcp2_server_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (prompt_config_id, mcp2_server_id)
);

DO $$
DECLARE
  has_cfg BOOLEAN := FALSE;
  has_hist BOOLEAN := FALSE;
  has_mcp BOOLEAN := FALSE;
  has_mcp2 BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'prompt_config'
  ) INTO has_cfg;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'prompt_test_history'
  ) INTO has_hist;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'prompt_config_mcp'
  ) INTO has_mcp;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'prompt_config_mcp2'
  ) INTO has_mcp2;

  IF has_cfg THEN
    INSERT INTO mod_automation_suite_prompt_config (id, org_id, name, dev_message, messages, tools, openai_api_key, prompt_id, prompt_version, model, vector_store_id, vector_store_ids, metadata, created_at, updated_at)
    SELECT
      (p.id)::text AS id,
      CASE WHEN p.org_id::text ~ '^[0-9]+$' THEN p.org_id::int ELSE NULL END AS org_id,
      p.name,
      p.dev_message,
      p.messages::jsonb,
      p.tools::jsonb,
      p.openai_api_key,
      p.prompt_id,
      p.prompt_version,
      p.model,
      p.vector_store_id,
      p.vector_store_ids,
      NULL::jsonb AS metadata,
      COALESCE(p.created_at, NOW()),
      COALESCE(p.updated_at, NOW())
    FROM public.prompt_config p
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      dev_message = EXCLUDED.dev_message,
      messages = EXCLUDED.messages,
      tools = EXCLUDED.tools,
      openai_api_key = EXCLUDED.openai_api_key,
      prompt_id = EXCLUDED.prompt_id,
      prompt_version = EXCLUDED.prompt_version,
      model = EXCLUDED.model,
      vector_store_id = EXCLUDED.vector_store_id,
      vector_store_ids = EXCLUDED.vector_store_ids,
      updated_at = EXCLUDED.updated_at;
  END IF;

  IF has_hist THEN
    INSERT INTO mod_automation_suite_prompt_test_history (id, prompt_config_id, input, output, request, response, ms, created_at)
    SELECT h.id::text, h.prompt_config_id::text, h.input, h.output, h.request::jsonb, h.response::jsonb, NULLIF(h.ms::text,'')::int, COALESCE(h.created_at, NOW())
    FROM public.prompt_test_history h
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF has_mcp THEN
    INSERT INTO mod_automation_suite_prompt_mcp (prompt_config_id, mcp_server_id, created_at)
    SELECT x.prompt_config_id::text, x.mcp_server_id::text, COALESCE(x.created_at, NOW())
    FROM public.prompt_config_mcp x
    ON CONFLICT (prompt_config_id, mcp_server_id) DO NOTHING;
  END IF;

  IF has_mcp2 THEN
    INSERT INTO mod_automation_suite_prompt_mcp2 (prompt_config_id, mcp2_server_id, created_at)
    SELECT x.prompt_config_id::text, x.mcp2_server_id::text, COALESCE(x.created_at, NOW())
    FROM public.prompt_config_mcp2 x
    ON CONFLICT (prompt_config_id, mcp2_server_id) DO NOTHING;
  END IF;
END $$;
