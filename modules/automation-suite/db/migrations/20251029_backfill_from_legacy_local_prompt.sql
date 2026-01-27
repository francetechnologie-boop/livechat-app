-- Backfill legacy public.local_prompt into module prompt_config table
-- Idempotent and safe to re-run.

CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO organizations(name)
SELECT 'Default'
WHERE NOT EXISTS (SELECT 1 FROM organizations);

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

DO $$
DECLARE
  has_local BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'local_prompt'
  ) INTO has_local;

  IF has_local THEN
    INSERT INTO mod_automation_suite_prompt_config (id, org_id, name, dev_message, messages, tools, openai_api_key, prompt_id, prompt_version, model, vector_store_id, vector_store_ids, metadata, created_at, updated_at)
    SELECT
      (lp.id)::text AS id,
      NULL::int AS org_id,
      lp.name,
      lp.dev_message,
      lp.messages::jsonb,
      lp.tools::jsonb,
      NULL::text AS openai_api_key,
      NULL::text AS prompt_id,
      NULL::text AS prompt_version,
      lp.model,
      lp.vector_store_id,
      NULL::json AS vector_store_ids,
      NULL::jsonb AS metadata,
      COALESCE(lp.created_at, NOW()) AS created_at,
      COALESCE(lp.updated_at, NOW()) AS updated_at
    FROM public.local_prompt lp
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

