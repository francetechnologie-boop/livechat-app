-- Add JSONB resources and resource_templates columns to store per-profile resources/templates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mod_db_mysql_profiles' AND column_name = 'resources'
  ) THEN
    ALTER TABLE mod_db_mysql_profiles ADD COLUMN resources JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mod_db_mysql_profiles' AND column_name = 'resource_templates'
  ) THEN
    ALTER TABLE mod_db_mysql_profiles ADD COLUMN resource_templates JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

