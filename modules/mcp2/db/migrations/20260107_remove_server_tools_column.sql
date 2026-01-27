-- Remove server-scoped tool definitions to avoid duplicate tool definitions.
-- Tools are defined in public.mod_mcp2_type_tool; servers store only enable/disable flags in options.tools_enabled.
-- Europe/Prague date: 2026-01-07

DO $$ BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'mod_mcp2_server'
       AND column_name = 'tools'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_mcp2_server RENAME COLUMN tools TO tools_legacy;
    EXCEPTION
      WHEN duplicate_column THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

