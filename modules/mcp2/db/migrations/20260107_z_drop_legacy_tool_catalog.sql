-- Destructive cleanup: remove legacy tool catalog + server tool tables/columns.
-- NOTE (2026-01-07): keep public.mod_mcp2_tool as the canonical tool catalog; mod_mcp2_type_tool links tools to types.
-- Europe/Prague date: 2026-01-07

-- Drop legacy compatibility views if present
DROP VIEW IF EXISTS public.mcp2_tool;
DROP VIEW IF EXISTS public.mcp2_server_tool;

-- Do NOT drop public.mod_mcp2_server_tool (canonical per-server enable/disable mapping).
-- Do NOT drop public.mod_mcp2_tool (canonical tool catalog).

-- Drop legacy server column (renamed from tools)
ALTER TABLE public.mod_mcp2_server DROP COLUMN IF EXISTS tools_legacy;
