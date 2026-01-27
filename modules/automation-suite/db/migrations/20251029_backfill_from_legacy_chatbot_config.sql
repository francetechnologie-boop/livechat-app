-- Backfill legacy public.chatbot_config into mod_automation_suite_chatbots
-- Idempotent and safe to re-run.

-- Ensure destination table exists
CREATE TABLE IF NOT EXISTS mod_automation_suite_chatbots (
  id_bot TEXT PRIMARY KEY,
  org_id INT NULL,
  shop_name TEXT NULL,
  lang_iso TEXT NULL,
  name TEXT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  bot_behavior TEXT NULL,
  instructions TEXT NULL,
  openai_api_key TEXT NULL,
  prompt_id TEXT NULL,
  prompt_version TEXT NULL,
  mcp_enabled BOOLEAN NULL,
  mcp_tools JSONB NULL,
  local_prompt_id TEXT NULL,
  prompt_config_id TEXT NULL,
  mcp_server_name TEXT NULL,
  web_search_enabled BOOLEAN NULL
);

-- Insert/update from legacy table when present
DO $$
DECLARE
  has_legacy BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'chatbot_config'
  ) INTO has_legacy;

  IF has_legacy THEN
    INSERT INTO mod_automation_suite_chatbots (id_bot, org_id, shop_name, lang_iso, name, enabled, created_at, updated_at,
                                               bot_behavior, instructions, openai_api_key, prompt_id, prompt_version,
                                               mcp_enabled, mcp_tools, local_prompt_id, prompt_config_id, mcp_server_name, web_search_enabled)
    SELECT
      c.id_bot::text,
      NULL::int AS org_id,
      c.shop_name::text,
      c.lang_iso::text,
      c.name::text,
      COALESCE(c.enabled, FALSE) AS enabled,
      COALESCE(c.created_at, NOW()),
      COALESCE(c.updated_at, NOW()),
      c.bot_behavior::text,
      c.instructions::text,
      c.openai_api_key::text,
      c.prompt_id::text,
      c.prompt_version::text,
      c.mcp_enabled,
      CASE WHEN c.mcp_tools IS NULL THEN NULL ELSE to_jsonb(c.mcp_tools) END,
      c.local_prompt_id::text,
      c.prompt_config_id::text,
      NULL::text,
      NULL::boolean
    FROM public.chatbot_config c
    ON CONFLICT (id_bot) DO UPDATE SET
      shop_name = EXCLUDED.shop_name,
      lang_iso = EXCLUDED.lang_iso,
      name = EXCLUDED.name,
      enabled = EXCLUDED.enabled,
      updated_at = EXCLUDED.updated_at,
      bot_behavior = COALESCE(EXCLUDED.bot_behavior, mod_automation_suite_chatbots.bot_behavior),
      instructions = COALESCE(EXCLUDED.instructions, mod_automation_suite_chatbots.instructions),
      openai_api_key = COALESCE(EXCLUDED.openai_api_key, mod_automation_suite_chatbots.openai_api_key),
      prompt_id = COALESCE(EXCLUDED.prompt_id, mod_automation_suite_chatbots.prompt_id),
      prompt_version = COALESCE(EXCLUDED.prompt_version, mod_automation_suite_chatbots.prompt_version),
      mcp_enabled = COALESCE(EXCLUDED.mcp_enabled, mod_automation_suite_chatbots.mcp_enabled),
      mcp_tools = COALESCE(EXCLUDED.mcp_tools, mod_automation_suite_chatbots.mcp_tools),
      local_prompt_id = COALESCE(EXCLUDED.local_prompt_id, mod_automation_suite_chatbots.local_prompt_id),
      prompt_config_id = COALESCE(EXCLUDED.prompt_config_id, mod_automation_suite_chatbots.prompt_config_id);
  END IF;
END $$;
