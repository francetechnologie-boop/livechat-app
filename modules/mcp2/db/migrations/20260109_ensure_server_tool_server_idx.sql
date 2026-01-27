-- up
-- Ensure expected index exists: idx_mcp2_server_tool_server ON public.mod_mcp2_server_tool(server_id)
-- Europe/Prague date: 2026-01-09
DO $mcp2_idx_server_tool_server$
BEGIN
  IF to_regclass('public.mod_mcp2_server_tool') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    CREATE INDEX IF NOT EXISTS idx_mcp2_server_tool_server
      ON public.mod_mcp2_server_tool USING btree (server_id);
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL; -- Keep migration portable across environments
  END;
END
$mcp2_idx_server_tool_server$;

-- down
DO $mcp2_idx_server_tool_server_down$
BEGIN
  BEGIN
    DROP INDEX IF EXISTS public.idx_mcp2_server_tool_server;
  EXCEPTION
    WHEN others THEN NULL;
  END;
END
$mcp2_idx_server_tool_server_down$;
