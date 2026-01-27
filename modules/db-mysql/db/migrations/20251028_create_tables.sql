-- Create module-specific profiles table for MySQL/MariaDB
CREATE TABLE IF NOT EXISTS mod_db_mysql_profiles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 3306,
  database VARCHAR(255) NOT NULL,
  db_user VARCHAR(255) NOT NULL,
  db_password TEXT NULL,
  ssl BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  org_id TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_db_mysql_profiles_org ON mod_db_mysql_profiles(org_id);

