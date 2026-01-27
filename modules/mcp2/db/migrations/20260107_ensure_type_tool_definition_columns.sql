-- up
-- Ensure mod_mcp2_type_tool stores tool definitions (idempotent)
-- Europe/Prague date: 2026-01-07
DO $$
BEGIN
  IF to_regclass('public.mod_mcp2_type_tool') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    ALTER TABLE public.mod_mcp2_type_tool ADD COLUMN IF NOT EXISTS name TEXT;
    ALTER TABLE public.mod_mcp2_type_tool ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE public.mod_mcp2_type_tool ADD COLUMN IF NOT EXISTS input_schema JSONB;
    ALTER TABLE public.mod_mcp2_type_tool ADD COLUMN IF NOT EXISTS code JSONB;
    ALTER TABLE public.mod_mcp2_type_tool ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
    ALTER TABLE public.mod_mcp2_type_tool ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  EXCEPTION WHEN others THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS mcp2_type_tool_name_uq ON public.mod_mcp2_type_tool(type_id, lower(name)) WHERE name IS NOT NULL';
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

-- down
-- Non-destructive: keep columns and index.

