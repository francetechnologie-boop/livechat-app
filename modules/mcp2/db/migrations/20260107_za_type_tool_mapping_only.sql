-- up
-- Make mod_mcp2_type_tool a pure mapping table (type_id, tool_id, created_at, org_id).
-- Tool definitions live only in mod_mcp2_tool.
-- Europe/Prague date: 2026-01-07
DO $$
BEGIN
  IF to_regclass('public.mod_mcp2_type_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Drop legacy/experimental columns if present
  BEGIN
    ALTER TABLE public.mod_mcp2_type_tool DROP COLUMN IF EXISTS name;
    ALTER TABLE public.mod_mcp2_type_tool DROP COLUMN IF EXISTS description;
    ALTER TABLE public.mod_mcp2_type_tool DROP COLUMN IF EXISTS input_schema;
    ALTER TABLE public.mod_mcp2_type_tool DROP COLUMN IF EXISTS code;
    ALTER TABLE public.mod_mcp2_type_tool DROP COLUMN IF EXISTS version;
    ALTER TABLE public.mod_mcp2_type_tool DROP COLUMN IF EXISTS updated_at;
    ALTER TABLE public.mod_mcp2_type_tool DROP COLUMN IF EXISTS default_enabled;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  -- Drop the old unique index that depended on name, if it exists
  BEGIN
    DROP INDEX IF EXISTS public.mcp2_type_tool_name_uq;
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $$;

-- down
-- Non-destructive: columns are not re-added.

