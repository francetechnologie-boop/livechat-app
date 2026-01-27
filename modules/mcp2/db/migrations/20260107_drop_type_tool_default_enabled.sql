-- up
-- Remove type-level default enabled flag; enable/disable is server-scoped.
-- Europe/Prague date: 2026-01-07
DO $$
BEGIN
  IF to_regclass('public.mod_mcp2_type_tool') IS NULL THEN
    RETURN;
  END IF;
  BEGIN
    ALTER TABLE public.mod_mcp2_type_tool DROP COLUMN IF EXISTS default_enabled;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

-- down
-- Re-adding default_enabled would require choosing a default; intentionally omitted.

