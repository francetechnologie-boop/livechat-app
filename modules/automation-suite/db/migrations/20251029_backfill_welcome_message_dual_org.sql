-- Backfill welcome_message into mod_automation_suite_welcome_messages
-- and support dual org columns: org_id_text (TEXT) + org_id (INT)
-- Idempotent and safe to re-run.

-- Ensure destination table exists with both org_id_text (TEXT) and org_id (INT)
CREATE TABLE IF NOT EXISTS mod_automation_suite_welcome_messages (
  id TEXT PRIMARY KEY,
  org_id_text TEXT NULL,
  title TEXT NULL,
  content TEXT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  org_id INT NULL
);

-- Add missing columns if table already exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='mod_automation_suite_welcome_messages' AND column_name='org_id_text'
  ) THEN
    EXECUTE 'ALTER TABLE mod_automation_suite_welcome_messages ADD COLUMN org_id_text TEXT NULL';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name='mod_automation_suite_welcome_messages' AND column_name='org_id'
  ) THEN
    EXECUTE 'ALTER TABLE mod_automation_suite_welcome_messages ADD COLUMN org_id INT NULL';
  END IF;
END $$;

-- Ensure index on INT org_id to match expected schema
CREATE INDEX IF NOT EXISTS mod_as_wm_org_idx ON mod_automation_suite_welcome_messages(org_id);

-- Add a compatible FK depending on organizations.id type
DO $$
DECLARE
  org_id_type TEXT;
BEGIN
  SELECT data_type INTO org_id_type
    FROM information_schema.columns
   WHERE table_name='organizations' AND column_name='id'
   LIMIT 1;
  -- Try FK on matching type only; ignore errors if already present
  IF org_id_type ILIKE 'text' OR org_id_type ILIKE 'character varying' THEN
    BEGIN
      EXECUTE 'ALTER TABLE mod_automation_suite_welcome_messages
                 ADD CONSTRAINT fk_mod_as_wm_org_text
                 FOREIGN KEY (org_id_text) REFERENCES organizations(id)
                 ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED';
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END;
  ELSIF org_id_type ILIKE 'integer' THEN
    BEGIN
      EXECUTE 'ALTER TABLE mod_automation_suite_welcome_messages
                 ADD CONSTRAINT fk_mod_as_wm_org
                 FOREIGN KEY (org_id) REFERENCES organizations(id)
                 ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED';
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_table THEN NULL; END;
  END IF;
END $$;

-- Backfill from legacy public.welcome_message when present
DO $$
DECLARE
  has_legacy BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='welcome_message'
  ) INTO has_legacy;

  IF has_legacy THEN
    INSERT INTO mod_automation_suite_welcome_messages (id, org_id_text, title, content, enabled, created_at, updated_at, org_id)
    SELECT
      wm.id_message::text AS id,
      NULLIF(TRIM(wm.org_id::text), '') AS org_id_text,
      wm.title,
      wm.content,
      COALESCE(wm.enabled, FALSE) AS enabled,
      COALESCE(wm.created_at, NOW()),
      COALESCE(wm.updated_at, NOW()),
      CASE WHEN wm.org_id::text ~ '^[0-9]+$' THEN wm.org_id::int ELSE NULL END AS org_id
    FROM public.welcome_message wm
    ON CONFLICT (id) DO UPDATE SET
      org_id_text = EXCLUDED.org_id_text,
      title = EXCLUDED.title,
      content = EXCLUDED.content,
      enabled = EXCLUDED.enabled,
      updated_at = EXCLUDED.updated_at,
      org_id = EXCLUDED.org_id;
  END IF;
END $$;

