-- up
-- Backfill missing mod_mcp2_type_tool.name values (prefer mod_mcp2_tool.name)
-- Europe/Prague date: 2026-01-07
DO $$
BEGIN
  IF to_regclass('public.mod_mcp2_type_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Ensure columns exist (idempotent)
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
    IF to_regclass('public.mod_mcp2_tool') IS NOT NULL THEN
      UPDATE public.mod_mcp2_type_tool tt
         SET name = COALESCE(NULLIF(btrim(tt.name), ''), t.name),
             description = COALESCE(tt.description, t.description),
             input_schema = COALESCE(tt.input_schema, t.input_schema),
             code = COALESCE(tt.code, t.code),
             version = COALESCE(tt.version, t.version),
             updated_at = NOW()
        FROM public.mod_mcp2_tool t
       WHERE tt.tool_id = t.id
         AND (tt.name IS NULL OR btrim(tt.name) = '');
    ELSE
      UPDATE public.mod_mcp2_type_tool
         SET name = tool_id,
             updated_at = NOW()
       WHERE (name IS NULL OR btrim(name) = '')
         AND tool_id IS NOT NULL
         AND btrim(tool_id) <> '';
    END IF;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

-- down
-- Non-destructive: keep names as-is.
