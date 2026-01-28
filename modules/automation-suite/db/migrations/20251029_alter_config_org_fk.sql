-- Idempotent migration: convert mod_automation_suite_config.org_id from TEXT to INT
-- and add a proper foreign key to organizations(id). Also re-establish the
-- uniqueness on (org_id, key). Safe to re-run.

DO $$
DECLARE
  has_table BOOLEAN := FALSE;
  has_org_col BOOLEAN := FALSE;
  org_col_is_text BOOLEAN := FALSE;
  default_id INTEGER := NULL;
  org_id_type TEXT := NULL;
BEGIN
  -- Ensure target table exists (created by earlier migration)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'mod_automation_suite_config'
  ) INTO has_table;
  IF NOT has_table THEN
    -- Create minimal table if missing (module bootstrap)
    EXECUTE 'CREATE TABLE IF NOT EXISTS mod_automation_suite_config (
      id SERIAL PRIMARY KEY,
      org_id INT NULL,
      key TEXT NOT NULL,
      value JSONB NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )';
  END IF;

  -- organizations table should exist at app level; ensure presence for safety
  PERFORM 1 FROM information_schema.tables WHERE table_name = 'organizations';
  IF NOT FOUND THEN
    EXECUTE 'CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )';
  END IF;

  -- Detect organizations.id type; skip conversion when not an integer-like id
  SELECT data_type INTO org_id_type
    FROM information_schema.columns
   WHERE table_schema = current_schema()
     AND table_name = 'organizations'
     AND column_name = 'id'
   LIMIT 1;
  IF org_id_type IN ('integer','bigint','smallint') THEN
    -- Ensure a default organization exists and fetch its id
    SELECT id INTO default_id FROM organizations ORDER BY id ASC LIMIT 1;
    IF default_id IS NULL THEN
      INSERT INTO organizations(name) VALUES('Default') RETURNING id INTO default_id;
    END IF;

    -- Check current org_id column type
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='mod_automation_suite_config' AND column_name='org_id'
    ) INTO has_org_col;

    IF has_org_col THEN
      SELECT (data_type IN ('text','character varying'))
      INTO org_col_is_text
      FROM information_schema.columns
      WHERE table_name='mod_automation_suite_config' AND column_name='org_id'
      LIMIT 1;
    END IF;

    -- Prepare new INT column for data migration
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name='mod_automation_suite_config' AND column_name='org_id_int'
    ) THEN
      EXECUTE 'ALTER TABLE mod_automation_suite_config ADD COLUMN org_id_int INT';
    END IF;

    -- Fill conversion safely: digits -> int, default aliases -> default org, others stay NULL
    EXECUTE 'UPDATE mod_automation_suite_config SET org_id_int = NULL';

    IF org_col_is_text THEN
      -- Normalize org_id to digits only; blank -> NULL
      EXECUTE 'UPDATE mod_automation_suite_config SET org_id = NULLIF(regexp_replace(org_id::text, ''[^0-9]'','''',''g''), '''')';

      -- Best-effort numeric conversion after normalization
      EXECUTE 'UPDATE mod_automation_suite_config SET org_id_int = org_id::INT WHERE org_id ~ ''^[0-9]+$''';

      -- Default aliases / empty / non-digits → default org
      EXECUTE format(
        'UPDATE mod_automation_suite_config SET org_id_int = %s WHERE org_id_int IS NULL',
        default_id
      );
    ELSE
      -- If already INT, keep existing values
      NULL;
    END IF;

    -- Guard: if org_id_int references a non-existing org, map to default
    EXECUTE format(
      'UPDATE mod_automation_suite_config a
         SET org_id_int = %s
       WHERE org_id_int IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = a.org_id_int)',
      default_id
    );

    -- Drop old unique constraint if present
    BEGIN
      EXECUTE 'ALTER TABLE mod_automation_suite_config DROP CONSTRAINT uq_mod_automation_suite_config';
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;

    -- De-duplicate rows on (org_id_int, key): keep highest id
    EXECUTE $SQL$
      DELETE FROM mod_automation_suite_config a
        USING mod_automation_suite_config b
       WHERE a.key = b.key
         AND COALESCE(a.org_id_int, -1) = COALESCE(b.org_id_int, -1)
         AND a.id < b.id
    $SQL$;

    -- Swap columns if legacy TEXT exists
    IF org_col_is_text THEN
      -- Preserve legacy text as org_id_text if not already present
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='mod_automation_suite_config' AND column_name='org_id_text'
      ) THEN
        EXECUTE 'ALTER TABLE mod_automation_suite_config RENAME COLUMN org_id TO org_id_text';
      END IF;
      -- Rename new int column to org_id if not present
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='mod_automation_suite_config' AND column_name='org_id'
      ) THEN
        EXECUTE 'ALTER TABLE mod_automation_suite_config RENAME COLUMN org_id_int TO org_id';
      END IF;
    ELSE
      -- If already INT and helper column exists, drop helper
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='mod_automation_suite_config' AND column_name='org_id_int'
      ) THEN
        -- Keep helper only if needed; drop when primary org_id already integer
        PERFORM 1 FROM information_schema.columns
         WHERE table_name='mod_automation_suite_config' AND column_name='org_id' AND data_type='integer';
        IF FOUND THEN
          EXECUTE 'ALTER TABLE mod_automation_suite_config DROP COLUMN org_id_int';
        END IF;
      END IF;
    END IF;

    -- Add FK (nullable, on delete set null)
    BEGIN
      EXECUTE 'ALTER TABLE mod_automation_suite_config
                ADD CONSTRAINT fk_mod_automation_suite_config_org
                FOREIGN KEY (org_id) REFERENCES organizations(id)
                ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED';
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;

    -- Re-create unique constraint on (org_id, key)
    BEGIN
      EXECUTE 'ALTER TABLE mod_automation_suite_config
                ADD CONSTRAINT uq_mod_automation_suite_config UNIQUE (org_id, key)';
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;
