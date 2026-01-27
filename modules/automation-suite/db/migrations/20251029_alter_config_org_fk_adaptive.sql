-- Adaptive migration to enforce FK on mod_automation_suite_config.org_id
-- to organizations(id) regardless of whether organizations.id is TEXT or INT.
-- Idempotent and safe to re-run.

DO $$
DECLARE
  org_id_type TEXT := NULL;
  cfg_org_type TEXT := NULL;
  has_cfg BOOLEAN := FALSE;
  has_fk BOOLEAN := FALSE;
  has_unique BOOLEAN := FALSE;
  has_idx BOOLEAN := FALSE;
  default_int INTEGER := NULL;
BEGIN
  -- Detect organizations.id type
  SELECT data_type INTO org_id_type
  FROM information_schema.columns
  WHERE table_schema = current_schema() AND table_name='organizations' AND column_name='id'
  LIMIT 1;

  -- Ensure config table exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'mod_automation_suite_config'
  ) INTO has_cfg;
  IF NOT has_cfg THEN
    -- Minimal bootstrap table mirrors existing runtime ensureTables shape (INT org)
    EXECUTE 'CREATE TABLE IF NOT EXISTS mod_automation_suite_config (
      id SERIAL PRIMARY KEY,
      org_id INT NULL,
      key TEXT NOT NULL,
      value JSONB NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )';
  END IF;

  -- Detect current config org_id column type
  SELECT data_type INTO cfg_org_type
  FROM information_schema.columns
  WHERE table_name='mod_automation_suite_config' AND column_name='org_id'
  LIMIT 1;

  -- Drop previous constraints if present to avoid type conflicts on swap
  BEGIN
    EXECUTE 'ALTER TABLE mod_automation_suite_config DROP CONSTRAINT fk_mod_automation_suite_config_org';
  EXCEPTION WHEN undefined_object THEN NULL; END;
  BEGIN
    EXECUTE 'ALTER TABLE mod_automation_suite_config DROP CONSTRAINT uq_mod_automation_suite_config';
  EXCEPTION WHEN undefined_object THEN NULL; END;

  IF org_id_type IN ('text','character varying') THEN
    -- organizations.id is TEXT → ensure config.org_id is TEXT as well
    IF cfg_org_type NOT IN ('text','character varying') THEN
      -- Add helper TEXT column
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='mod_automation_suite_config' AND column_name='org_id_text'
      ) THEN
        EXECUTE 'ALTER TABLE mod_automation_suite_config ADD COLUMN org_id_text TEXT';
      END IF;
      -- Populate helper from existing INT org_id
      EXECUTE 'UPDATE mod_automation_suite_config SET org_id_text = CASE WHEN org_id IS NULL THEN NULL ELSE org_id::text END';
      -- Swap names: keep a copy of old INT as org_id_int (for traceability), move TEXT into org_id
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='mod_automation_suite_config' AND column_name='org_id_int'
      ) THEN
        EXECUTE 'ALTER TABLE mod_automation_suite_config RENAME COLUMN org_id TO org_id_int';
      END IF;
      -- If org_id column name is free now, rename text helper in place
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='mod_automation_suite_config' AND column_name='org_id'
      ) THEN
        EXECUTE 'ALTER TABLE mod_automation_suite_config RENAME COLUMN org_id_text TO org_id';
      END IF;
    END IF;

    -- Ensure referenced organizations exist for any used org_id values
    -- Create a default text org if none matches 'org_default'
    IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = 'org_default') THEN
      BEGIN
        INSERT INTO organizations(id, name, created_at, updated_at)
        VALUES ('org_default','Default', NOW(), NOW());
      EXCEPTION WHEN unique_violation THEN NULL;
      WHEN others THEN NULL;
      END;
    END IF;

    -- Upsert any unknown org ids appearing in config
    BEGIN
      INSERT INTO organizations(id, name, created_at, updated_at)
      SELECT DISTINCT c.org_id::text, 'Imported ' || c.org_id::text, NOW(), NOW()
        FROM mod_automation_suite_config c
       WHERE c.org_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = c.org_id::text);
    EXCEPTION WHEN unique_violation THEN NULL;
    WHEN others THEN NULL;
    END;

    -- Add FK (nullable)
    BEGIN
      EXECUTE 'ALTER TABLE mod_automation_suite_config
                 ADD CONSTRAINT fk_mod_automation_suite_config_org
                 FOREIGN KEY (org_id) REFERENCES organizations(id)
                 ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED';
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    -- Unique (org_id, key)
    BEGIN
      EXECUTE 'ALTER TABLE mod_automation_suite_config
                 ADD CONSTRAINT uq_mod_automation_suite_config UNIQUE (org_id, key)';
    EXCEPTION WHEN duplicate_object THEN NULL; END;

    -- Index on org_id
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS mod_as_config_org_idx ON mod_automation_suite_config(org_id)';
    END;

  ELSE
    -- organizations.id is INT → ensure config.org_id is INT and FK'ed
    -- Prepare helper INT column if needed
    IF cfg_org_type IN ('text','character varying') THEN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='mod_automation_suite_config' AND column_name='org_id_int'
      ) THEN
        EXECUTE 'ALTER TABLE mod_automation_suite_config ADD COLUMN org_id_int INT';
      END IF;
      -- Map numeric strings to INT; map others (including org_default/default/empty) to default org id
      SELECT id INTO default_int FROM organizations ORDER BY id ASC LIMIT 1;
      IF default_int IS NULL THEN
        BEGIN
          INSERT INTO organizations(name) VALUES('Default');
        EXCEPTION WHEN others THEN NULL;
        END;
        SELECT id INTO default_int FROM organizations ORDER BY id ASC LIMIT 1;
      END IF;
      EXECUTE 'UPDATE mod_automation_suite_config SET org_id_int = NULL';
      EXECUTE 'UPDATE mod_automation_suite_config SET org_id_int = CAST(org_id AS INT) WHERE org_id ~ ''^[0-9]+$''';
      EXECUTE format(
        'UPDATE mod_automation_suite_config SET org_id_int = %s WHERE org_id_int IS NULL',
        default_int
      );
      -- Swap to make INT primary column
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='mod_automation_suite_config' AND column_name='org_id_text'
      ) THEN
        EXECUTE 'ALTER TABLE mod_automation_suite_config RENAME COLUMN org_id TO org_id_text';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='mod_automation_suite_config' AND column_name='org_id'
      ) THEN
        EXECUTE 'ALTER TABLE mod_automation_suite_config RENAME COLUMN org_id_int TO org_id';
      END IF;
    END IF;

    -- Guard any invalid references
    EXECUTE 'UPDATE mod_automation_suite_config a SET org_id = (
              SELECT id FROM organizations ORDER BY id ASC LIMIT 1
            ) WHERE org_id IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM organizations o WHERE o.id = a.org_id
            )';

    -- Add FK and index/unique
    BEGIN
      EXECUTE 'ALTER TABLE mod_automation_suite_config
                 ADD CONSTRAINT fk_mod_automation_suite_config_org
                 FOREIGN KEY (org_id) REFERENCES organizations(id)
                 ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED';
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      EXECUTE 'ALTER TABLE mod_automation_suite_config
                 ADD CONSTRAINT uq_mod_automation_suite_config UNIQUE (org_id, key)';
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS mod_as_config_org_idx ON mod_automation_suite_config(org_id)';
    END;
  END IF;
END $$;
