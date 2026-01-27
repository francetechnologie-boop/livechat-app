-- up
-- Drop legacy compatibility views that can block destructive table rebuilds.
-- These views were created during renames (e.g. mcp2_server_tool -> mod_mcp2_server_tool).
-- Europe/Prague date: 2026-01-07

DROP VIEW IF EXISTS public.mcp2_server_tool;
DROP VIEW IF EXISTS public.mcp2_type_tool;
DROP VIEW IF EXISTS public.mcp2_tool;
DROP VIEW IF EXISTS public.mcp2_server;
DROP VIEW IF EXISTS public.mcp2_type;
DROP VIEW IF EXISTS public.mcp2_kind;

-- down
-- Non-destructive: views are not recreated.

