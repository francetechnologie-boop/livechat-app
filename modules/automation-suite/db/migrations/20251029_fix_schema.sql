-- Normalize module schema to expected shapes and indexes
-- - Ensure missing prompt tables exist
-- - Ensure org_id columns are INT where required
-- - Create expected indexes
-- Idempotent and safe to re-run.

-- 0) Organizations safety (do not alter existing types; just ensure presence of a default row)
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO organizations(name)
SELECT 'Default'
WHERE NOT EXISTS (SELECT 1 FROM organizations);

-- 1) Ensure prompt tables
CREATE TABLE IF NOT EXISTS mod_automation_suite_prompt_config (
  id TEXT PRIMARY KEY,
  org_id INT NULL,
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

CREATE TABLE IF NOT EXISTS mod_automation_suite_prompt_test_history (
  id TEXT PRIMARY KEY,
  prompt_config_id TEXT NOT NULL,
  input TEXT NULL,
  output TEXT NULL,
  request JSONB NULL,
  response JSONB NULL,
  ms INTEGER NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mod_automation_suite_prompt_mcp (
  prompt_config_id TEXT NOT NULL,
  mcp_server_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (prompt_config_id, mcp_server_id)
);

CREATE TABLE IF NOT EXISTS mod_automation_suite_prompt_mcp2 (
  prompt_config_id TEXT NOT NULL,
  mcp2_server_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (prompt_config_id, mcp2_server_id)
);

-- 2) Ensure chatbots table index
CREATE INDEX IF NOT EXISTS mod_as_chatbots_org_idx ON mod_automation_suite_chatbots(org_id);

-- 3) Ensure welcome_messages org_id is INT and indexed
DO $$
DECLARE
  t TEXT;
  is_text BOOLEAN := FALSE;
BEGIN
  SELECT data_type INTO t
    FROM information_schema.columns
   WHERE table_name='mod_automation_suite_welcome_messages' AND column_name='org_id'
   LIMIT 1;
  IF t IS NOT NULL THEN
    is_text := (t ILIKE 'text' OR t ILIKE 'character varying');
  END IF;
  IF is_text THEN
    -- Add helper column and migrate
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name='mod_automation_suite_welcome_messages' AND column_name='org_id_int'
    ) THEN
      EXECUTE 'ALTER TABLE mod_automation_suite_welcome_messages ADD COLUMN org_id_int INT';
    END IF;
    -- Populate numeric values, default others to NULL
    EXECUTE 'UPDATE mod_automation_suite_welcome_messages SET org_id_int = NULL';
    EXECUTE 'UPDATE mod_automation_suite_welcome_messages SET org_id_int = CAST(org_id AS INT) WHERE org_id ~ ''^[0-9]+$''';
    -- Swap
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name='mod_automation_suite_welcome_messages' AND column_name='org_id_text'
    ) THEN
      EXECUTE 'ALTER TABLE mod_automation_suite_welcome_messages RENAME COLUMN org_id TO org_id_text';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_name='mod_automation_suite_welcome_messages' AND column_name='org_id'
    ) THEN
      EXECUTE 'ALTER TABLE mod_automation_suite_welcome_messages RENAME COLUMN org_id_int TO org_id';
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS mod_as_wm_org_idx ON mod_automation_suite_welcome_messages(org_id);

-- 4) Ensure hub_selection index
CREATE INDEX IF NOT EXISTS mod_as_hub_org_idx ON mod_automation_suite_hub_selection(org_id);

