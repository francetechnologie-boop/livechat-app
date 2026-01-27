-- Backfill from legacy public.chatbot_welcome_link into module table
-- Idempotent and safe to re-run.

-- Ensure destination tables exist
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO organizations(name)
SELECT 'Default'
WHERE NOT EXISTS (SELECT 1 FROM organizations);

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

CREATE TABLE IF NOT EXISTS mod_automation_suite_welcome_messages (
  id TEXT PRIMARY KEY,
  org_id INT NULL REFERENCES organizations(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  title TEXT NULL,
  content TEXT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mod_automation_suite_chatbot_welcome_link (
  id_bot TEXT PRIMARY KEY REFERENCES mod_automation_suite_chatbots(id_bot) ON DELETE CASCADE,
  welcome_message_id TEXT NOT NULL REFERENCES mod_automation_suite_welcome_messages(id) ON DELETE CASCADE
);

DO $$
DECLARE
  has_legacy BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'chatbot_welcome_link'
  ) INTO has_legacy;

  IF has_legacy THEN
    INSERT INTO mod_automation_suite_chatbot_welcome_link (id_bot, welcome_message_id)
    SELECT l.id_bot, l.welcome_message_id
      FROM public.chatbot_welcome_link l
    ON CONFLICT (id_bot) DO UPDATE SET welcome_message_id = EXCLUDED.welcome_message_id;
  END IF;
END $$;

