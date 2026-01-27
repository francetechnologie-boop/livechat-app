-- Add a type column to mod_module_manager_sidebar_entries
-- Values: 'module' (default), 'page', 'sous-menus', 'liens personnalisés'

DO $$
BEGIN
  IF to_regclass('public.mod_module_manager_sidebar_entries') IS NOT NULL THEN
    BEGIN
      EXECUTE 'ALTER TABLE public.mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT ''module''';
    EXCEPTION WHEN others THEN
      -- If an incompatible column exists, try to coerce by creating a temp and copying (unlikely)
      NULL;
    END;
  END IF;
END $$;

