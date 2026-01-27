-- up
-- Recreate mod_mcp2_server_tool as the server-level enable/disable mapping table.
-- Tool definitions live only in mod_mcp2_tool.
-- Europe/Prague date: 2026-01-07
DO $$
BEGIN
  IF to_regclass('public.mod_mcp2_server_tool') IS NULL THEN
    BEGIN
      CREATE TABLE public.mod_mcp2_server_tool (
        server_id  TEXT NOT NULL,
        tool_id    TEXT NOT NULL,
        enabled    BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        org_id     TEXT NULL,
        PRIMARY KEY (server_id, tool_id)
      );
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  -- Indexes (best-effort)
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mcp2_server_tool_server ON public.mod_mcp2_server_tool(server_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mcp2_server_tool_tool ON public.mod_mcp2_server_tool(tool_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mcp2_server_tool_org ON public.mod_mcp2_server_tool(org_id)';
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

-- down
-- Non-destructive: keep table.

