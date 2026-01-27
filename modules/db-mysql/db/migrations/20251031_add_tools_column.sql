-- Add JSONB tools column to store per-profile tools list
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mod_db_mysql_profiles' AND column_name = 'tools'
  ) THEN
    ALTER TABLE mod_db_mysql_profiles ADD COLUMN tools JSONB NOT NULL DEFAULT '[]'::jsonb;
  END IF;
END $$;

