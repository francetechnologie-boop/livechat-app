-- Extend mod_automation_suite_chatbots with fields from legacy chatbot_config
-- Idempotent and safe to re-run.

ALTER TABLE IF EXISTS mod_automation_suite_chatbots
  ADD COLUMN IF NOT EXISTS bot_behavior TEXT NULL,
  ADD COLUMN IF NOT EXISTS instructions TEXT NULL,
  ADD COLUMN IF NOT EXISTS openai_api_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS prompt_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS prompt_version TEXT NULL,
  ADD COLUMN IF NOT EXISTS mcp_enabled BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS mcp_tools JSONB NULL,
  ADD COLUMN IF NOT EXISTS local_prompt_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS prompt_config_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS mcp_server_name TEXT NULL,
  ADD COLUMN IF NOT EXISTS web_search_enabled BOOLEAN NULL;

CREATE INDEX IF NOT EXISTS mod_as_chatbots_prompt_cfg_idx ON mod_automation_suite_chatbots(prompt_config_id);

