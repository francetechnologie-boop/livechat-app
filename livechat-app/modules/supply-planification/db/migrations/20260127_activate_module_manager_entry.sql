-- Ensure the supply-planification module is marked active/installed in the Module Manager table.

DO $$
DECLARE
  name_col TEXT := 'module_name';
BEGIN
  -- Ensure table exists (compatible with legacy 'modules' schema).
  IF to_regclass('public.mod_module_manager_modules') IS NULL THEN
    CREATE TABLE IF NOT EXISTS public.mod_module_manager_modules (
      id_module   SERIAL PRIMARY KEY,
      module_name VARCHAR(64) NOT NULL UNIQUE,
      active      SMALLINT NOT NULL DEFAULT 0,
      version     VARCHAR(16) NOT NULL DEFAULT '0.0.0',
      install     SMALLINT NOT NULL DEFAULT 0,
      installed_at TIMESTAMP NULL DEFAULT NULL,
      updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
    );
  END IF;

  -- Detect column name used for the module identifier.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mod_module_manager_modules' AND column_name = 'module_name'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mod_module_manager_modules' AND column_name = 'name'
  ) THEN
    name_col := 'name';
  END IF;

  -- Best-effort columns to match expected schema.
  BEGIN EXECUTE 'ALTER TABLE public.mod_module_manager_modules ADD COLUMN IF NOT EXISTS active SMALLINT NOT NULL DEFAULT 0'; EXCEPTION WHEN others THEN NULL; END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_module_manager_modules ADD COLUMN IF NOT EXISTS version VARCHAR(16) NOT NULL DEFAULT ''0.0.0'''; EXCEPTION WHEN others THEN NULL; END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_module_manager_modules ADD COLUMN IF NOT EXISTS install SMALLINT NOT NULL DEFAULT 0'; EXCEPTION WHEN others THEN NULL; END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_module_manager_modules ADD COLUMN IF NOT EXISTS installed_at TIMESTAMP NULL DEFAULT NULL'; EXCEPTION WHEN others THEN NULL; END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_module_manager_modules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()'; EXCEPTION WHEN others THEN NULL; END;

  -- Upsert module row so loader treats it as active.
  EXECUTE format(
    'INSERT INTO public.mod_module_manager_modules (%1$I, version, active, install, installed_at, updated_at)
       VALUES ($1, $2, 1, 1, NOW(), NOW())
     ON CONFLICT (%1$I) DO UPDATE
       SET active = 1, install = 1, version = EXCLUDED.version, updated_at = NOW()',
    name_col
  )
  USING 'supply-planification', '1.0.0';
EXCEPTION WHEN others THEN
  -- Keep migration idempotent/portable.
  NULL;
END $$;
