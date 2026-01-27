-- up
-- Ensure mod_mcp2_server has no "tools" JSON column (tools are per-server in mod_mcp2_server_tool).
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
END $$;

-- down
-- Non-destructive: column is not re-added.

