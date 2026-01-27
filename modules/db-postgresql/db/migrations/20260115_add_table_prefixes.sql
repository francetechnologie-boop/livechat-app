-- Add per-profile table prefix filter (comma-separated) for db-postgresql
ALTER TABLE mod_db_postgresql_profiles
  ADD COLUMN IF NOT EXISTS table_prefixes TEXT NULL;

