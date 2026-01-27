-- Add per-profile table prefix filter (comma-separated) for db-mysql
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'mod_db_mysql_profiles'
  ) THEN
    BEGIN
      ALTER TABLE mod_db_mysql_profiles
        ADD COLUMN IF NOT EXISTS table_prefixes TEXT NULL;
    EXCEPTION
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

