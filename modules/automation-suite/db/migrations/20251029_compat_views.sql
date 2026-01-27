-- Compatibility views exposing module tables under hyphenated, discoverable aliases
-- Idempotent: uses CREATE OR REPLACE VIEW and does not DROP tables.

CREATE OR REPLACE VIEW "MOD_automation-suite__chatbots" AS
  SELECT * FROM mod_automation_suite_chatbots;

CREATE OR REPLACE VIEW "MOD_automation-suite__welcome_messages" AS
  SELECT * FROM mod_automation_suite_welcome_messages;

CREATE OR REPLACE VIEW "MOD_automation-suite__chatbot_welcome_link" AS
  SELECT * FROM mod_automation_suite_chatbot_welcome_link;

CREATE OR REPLACE VIEW "MOD_automation-suite__hub_selection" AS
  SELECT * FROM mod_automation_suite_hub_selection;

CREATE OR REPLACE VIEW "MOD_automation-suite__prompt_config" AS
  SELECT * FROM mod_automation_suite_prompt_config;

CREATE OR REPLACE VIEW "MOD_automation-suite__prompt_test_history" AS
  SELECT * FROM mod_automation_suite_prompt_test_history;

CREATE OR REPLACE VIEW "MOD_automation-suite__prompt_mcp" AS
  SELECT * FROM mod_automation_suite_prompt_mcp;

CREATE OR REPLACE VIEW "MOD_automation-suite__prompt_mcp2" AS
  SELECT * FROM mod_automation_suite_prompt_mcp2;

