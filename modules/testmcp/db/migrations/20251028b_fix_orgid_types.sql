-- Ensure org_id columns are TEXT to avoid FK type mismatch (safe to re-run)
DO $$
DECLARE col_type TEXT;
BEGIN
  -- mod_testmcp_tool.org_id
  IF to_regclass('public.mod_testmcp_tool') IS NOT NULL THEN
    SELECT data_type INTO col_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'mod_testmcp_tool' AND column_name = 'org_id' LIMIT 1;
    IF col_type IS NOT NULL AND col_type <> 'text' THEN
      -- Drop FK if it exists before type change
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_testmcp_tool_org') THEN
        ALTER TABLE mod_testmcp_tool DROP CONSTRAINT fk_testmcp_tool_org;
      END IF;
      ALTER TABLE mod_testmcp_tool ALTER COLUMN org_id TYPE TEXT USING org_id::text;
    END IF;
  END IF;

  -- mod_testmcp_events.org_id
  IF to_regclass('public.mod_testmcp_events') IS NOT NULL THEN
    SELECT data_type INTO col_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'mod_testmcp_events' AND column_name = 'org_id' LIMIT 1;
    IF col_type IS NOT NULL AND col_type <> 'text' THEN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_testmcp_events_org') THEN
        ALTER TABLE mod_testmcp_events DROP CONSTRAINT fk_testmcp_events_org;
      END IF;
      ALTER TABLE mod_testmcp_events ALTER COLUMN org_id TYPE TEXT USING org_id::text;
    END IF;
  END IF;
END $$;

