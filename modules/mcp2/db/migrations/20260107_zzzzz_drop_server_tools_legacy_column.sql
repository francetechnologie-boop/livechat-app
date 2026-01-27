-- up
-- Final cleanup: ensure mod_mcp2_server has no leftover server-scoped tool JSON columns.
-- Tools are defined in public.mod_mcp2_tool and enabled per-server in public.mod_mcp2_server_tool.
-- Europe/Prague date: 2026-01-07
DO $$
BEGIN
  IF to_regclass('public.mod_mcp2_server') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    ALTER TABLE public.mod_mcp2_server DROP COLUMN IF EXISTS tools;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  BEGIN
    ALTER TABLE public.mod_mcp2_server DROP COLUMN IF EXISTS tools_legacy;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

-- down
-- Non-destructive: columns are not re-added.

