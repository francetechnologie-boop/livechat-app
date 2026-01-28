-- Create normalized tables for Automation Suite and backfill from legacy JSON config
-- Safe, idempotent: guarded DDL and INSERT ... ON CONFLICT

-- Ensure organizations table exists (app-level dependency)
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO organizations(name)
SELECT 'Default'
WHERE NOT EXISTS (SELECT 1 FROM organizations);

-- Chatbots table
CREATE TABLE IF NOT EXISTS mod_automation_suite_chatbots (
  id_bot TEXT PRIMARY KEY,
  org_id INT NULL REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  shop_name TEXT NULL,
  lang_iso TEXT NULL,
  name TEXT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mod_as_chatbots_org_idx ON mod_automation_suite_chatbots(org_id);

-- Welcome messages table (kept consistent with earlier migration name)
CREATE TABLE IF NOT EXISTS mod_automation_suite_welcome_messages (
  id TEXT PRIMARY KEY,
  org_id INT NULL REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  title TEXT NULL,
  content TEXT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mod_as_wm_org_idx ON mod_automation_suite_welcome_messages(org_id);

-- Link: chatbot -> welcome message
CREATE TABLE IF NOT EXISTS mod_automation_suite_chatbot_welcome_link (
  id_bot TEXT PRIMARY KEY REFERENCES mod_automation_suite_chatbots(id_bot) ON DELETE CASCADE,
  welcome_message_id TEXT NOT NULL REFERENCES mod_automation_suite_welcome_messages(id) ON DELETE CASCADE
);

-- Conversation Hub selections
CREATE TABLE IF NOT EXISTS mod_automation_suite_hub_selection (
  org_id INT NULL REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  id_bot TEXT NOT NULL REFERENCES mod_automation_suite_chatbots(id_bot) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (org_id, id_bot)
);
CREATE INDEX IF NOT EXISTS mod_as_hub_org_idx ON mod_automation_suite_hub_selection(org_id);

-- Backfill from legacy JSON config (mod_automation_suite_config)
-- Chatbots
DO $$
DECLARE
  org_id_type TEXT := NULL;
  org_expr TEXT := 'NULL::int';
BEGIN
  SELECT data_type INTO org_id_type
    FROM information_schema.columns
   WHERE table_schema = current_schema()
     AND table_name = 'organizations'
     AND column_name = 'id'
   LIMIT 1;
  IF org_id_type IN ('integer','bigint','smallint') THEN
    org_expr := 'CASE WHEN c.org_id ~ ''^[0-9]+$'' THEN CAST(c.org_id AS INT) ELSE NULL END';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='mod_automation_suite_config') THEN
    -- Insert chatbots from JSON array value when key='chatbots'
    EXECUTE format($SQL$
      INSERT INTO mod_automation_suite_chatbots (id_bot, org_id, shop_name, lang_iso, name, enabled, created_at, updated_at)
      SELECT DISTINCT
        COALESCE((elem->>'id_bot'), (elem->>'id'))::text AS id_bot,
        %s AS org_id,
        (elem->>'shop_name')::text AS shop_name,
        (elem->>'lang_iso')::text AS lang_iso,
        NULLIF((elem->>'name')::text, '') AS name,
        COALESCE((elem->>'enabled')::boolean, TRUE) AS enabled,
        NOW(), NOW()
      FROM mod_automation_suite_config c
      JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.value)='array' THEN c.value ELSE '[]'::jsonb END) AS elem ON TRUE
      WHERE c.key = 'chatbots'
      ON CONFLICT (id_bot) DO NOTHING;
    $SQL$, org_expr);

    -- Insert welcome messages
    EXECUTE format($SQL$
      INSERT INTO mod_automation_suite_welcome_messages (id, org_id, title, content, enabled, created_at, updated_at)
      SELECT DISTINCT
        (elem->>'id')::text AS id,
        %s AS org_id,
        NULLIF((elem->>'title')::text, '') AS title,
        (elem->>'content')::text AS content,
        COALESCE((elem->>'enabled')::boolean, TRUE) AS enabled,
        NOW(), NOW()
      FROM mod_automation_suite_config c
      JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.value)='array' THEN c.value ELSE '[]'::jsonb END) AS elem ON TRUE
      WHERE c.key = 'welcome_messages'
      ON CONFLICT (id) DO NOTHING;
    $SQL$, org_expr);

    -- Insert hub selections
    EXECUTE format($SQL$
      INSERT INTO mod_automation_suite_hub_selection (org_id, id_bot, created_at)
      SELECT DISTINCT %s AS org_id, x AS id_bot, NOW()
        FROM mod_automation_suite_config c,
             LATERAL jsonb_array_elements_text(COALESCE(c.value->'ids', '[]'::jsonb)) AS x
       WHERE c.key = 'conversation_hub'
      ON CONFLICT DO NOTHING;
    $SQL$, org_expr);
  END IF;
END $$;
