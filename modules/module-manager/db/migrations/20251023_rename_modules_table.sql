-- Idempotent migration: rename legacy 'modules' table to
-- 'mod_module_manager_modules' and create the new table if missing.

DO $$ BEGIN
  IF to_regclass('public.mod_module_manager_modules') IS NULL THEN
    IF to_regclass('public.modules') IS NOT NULL THEN
      ALTER TABLE public.modules RENAME TO mod_module_manager_modules;
    END IF;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS mod_module_manager_modules (
  id_module   SERIAL PRIMARY KEY,
  name        VARCHAR(64) NOT NULL UNIQUE,
  active      SMALLINT NOT NULL DEFAULT 0,
  version     VARCHAR(8) NOT NULL DEFAULT '0.0.0',
  install     SMALLINT NOT NULL DEFAULT 0,
  installed_at TIMESTAMP NULL DEFAULT NULL,
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
