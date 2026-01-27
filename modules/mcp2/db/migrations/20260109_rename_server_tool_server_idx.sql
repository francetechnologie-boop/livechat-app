-- up
-- Schema checker expects: idx_mcp2_server_tool_server ON public.mod_mcp2_server_tool(server_id)
-- Some environments have the same index named idx_mcp2_tool_server; rename it to satisfy the expectation.
-- Europe/Prague date: 2026-01-09
DO $mcp2_rename_idx$
BEGIN
  IF to_regclass('public.mod_mcp2_server_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Prefer renaming the existing server_id index if present.
  IF to_regclass('public.idx_mcp2_server_tool_server') IS NULL
     AND to_regclass('public.idx_mcp2_tool_server') IS NOT NULL THEN
    BEGIN
      ALTER INDEX public.idx_mcp2_tool_server RENAME TO idx_mcp2_server_tool_server;
    EXCEPTION
      WHEN others THEN NULL;
    END;
  END IF;

  -- If still missing, create it (best-effort).
  IF to_regclass('public.idx_mcp2_server_tool_server') IS NULL THEN
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_mcp2_server_tool_server
        ON public.mod_mcp2_server_tool USING btree (server_id);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END
$mcp2_rename_idx$;

-- down
DO $mcp2_rename_idx_down$
BEGIN
  -- Optional: restore old name if needed.
  IF to_regclass('public.idx_mcp2_tool_server') IS NULL
     AND to_regclass('public.idx_mcp2_server_tool_server') IS NOT NULL THEN
    BEGIN
      ALTER INDEX public.idx_mcp2_server_tool_server RENAME TO idx_mcp2_tool_server;
    EXCEPTION
      WHEN others THEN NULL;
    END;
  END IF;
END
$mcp2_rename_idx_down$;
