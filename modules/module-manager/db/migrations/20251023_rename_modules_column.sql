-- Rename 'name' column to 'module_name' and enforce uniqueness

DO $$ BEGIN
  IF to_regclass('public.mod_module_manager_modules') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mod_module_manager_modules' AND column_name = 'name'
  ) THEN
    ALTER TABLE mod_module_manager_modules RENAME COLUMN name TO module_name;
  END IF;
END $$;

-- Guarded unique constraint (PostgreSQL does not support ADD CONSTRAINT IF NOT EXISTS)
DO $$ BEGIN
  IF to_regclass('public.mod_module_manager_modules') IS NOT NULL THEN
    BEGIN
      ALTER TABLE mod_module_manager_modules
        ADD CONSTRAINT uq_mod_mm_modules_name UNIQUE (module_name);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;
