-- Add `attached` column used by the sidebar tree.
-- This migration is idempotent and works across legacy table names.

DO $do$
BEGIN
  IF to_regclass('public.mod_module_manager_sidebar_entries') IS NOT NULL THEN
    BEGIN
      EXECUTE 'ALTER TABLE public.mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS attached BOOLEAN NOT NULL DEFAULT TRUE';
    EXCEPTION WHEN others THEN NULL; END;
    BEGIN
      EXECUTE 'UPDATE public.mod_module_manager_sidebar_entries SET attached = TRUE WHERE attached IS NULL';
    EXCEPTION WHEN others THEN NULL; END;
  ELSIF to_regclass('public.sidebar_entries') IS NOT NULL THEN
    BEGIN
      EXECUTE 'ALTER TABLE public.sidebar_entries ADD COLUMN IF NOT EXISTS attached BOOLEAN NOT NULL DEFAULT TRUE';
    EXCEPTION WHEN others THEN NULL; END;
    BEGIN
      EXECUTE 'UPDATE public.sidebar_entries SET attached = TRUE WHERE attached IS NULL';
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $do$;

