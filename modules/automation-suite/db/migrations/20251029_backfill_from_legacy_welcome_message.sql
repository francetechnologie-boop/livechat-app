-- Backfill from legacy public.welcome_message into mod_automation_suite_welcome_messages
-- Idempotent and safe to re-run.

-- Ensure organizations table and default row exist
CREATE TABLE IF NOT EXISTS organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
INSERT INTO organizations(name)
SELECT 'Default'
WHERE NOT EXISTS (SELECT 1 FROM organizations);

DO $$
DECLARE
  default_id INTEGER := NULL;
  has_legacy BOOLEAN := FALSE;
BEGIN
  SELECT id INTO default_id FROM organizations ORDER BY id ASC LIMIT 1;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'welcome_message'
  ) INTO has_legacy;

  IF has_legacy THEN
    -- Create destination table if needed
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

    -- Insert or update rows from legacy table
    INSERT INTO mod_automation_suite_welcome_messages (id, org_id, title, content, enabled, created_at, updated_at)
    SELECT
      wm.id_message AS id,
      CASE
        WHEN wm.org_id ~ '^[0-9]+$' THEN CAST(wm.org_id AS INT)
        WHEN wm.org_id IS NULL OR wm.org_id = '' OR lower(wm.org_id) IN ('org_default','default') THEN default_id
        ELSE default_id
      END AS org_id,
      wm.title,
      wm.content,
      COALESCE(wm.enabled, FALSE) AS enabled,
      COALESCE(wm.created_at, NOW()) AS created_at,
      COALESCE(wm.updated_at, NOW()) AS updated_at
    FROM public.welcome_message wm
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      enabled = EXCLUDED.enabled,
      updated_at = EXCLUDED.updated_at;

    -- Ensure org_id references an existing row; fallback to default
    UPDATE mod_automation_suite_welcome_messages m
       SET org_id = default_id
     WHERE m.org_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = m.org_id);
  END IF;
END $$;

