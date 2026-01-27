-- up
-- Backfill mod_mcp2_server_tool from type standard tools and legacy server options.tools_enabled (if present).
-- Europe/Prague date: 2026-01-07
DO $mcp2_backfill_server_tool$
DECLARE
  has_catalog boolean := false;
  has_name_col boolean := false;
  has_id_col boolean := false;
BEGIN
  IF to_regclass('public.mod_mcp2_server') IS NULL
     OR to_regclass('public.mod_mcp2_type_tool') IS NULL
     OR to_regclass('public.mod_mcp2_server_tool') IS NULL THEN
    RETURN;
  END IF;

  has_catalog := to_regclass('public.mod_mcp2_tool') IS NOT NULL;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_mcp2_server_tool' AND column_name='name'
  ) INTO has_name_col;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_mcp2_server_tool' AND column_name='id'
  ) INTO has_id_col;

  -- Insert missing server_tool rows for servers with a type.
  -- Enabled defaults to TRUE unless options.tools_enabled explicitly sets the tool name to false.
  IF has_catalog THEN
    -- Backfill without relying on ON CONFLICT targets (portable across schema variants).
    IF has_name_col THEN
      IF has_id_col THEN
        INSERT INTO public.mod_mcp2_server_tool (id, server_id, name, tool_id, enabled, created_at, updated_at, org_id)
        SELECT
          ('m2st_' || md5(random()::text || clock_timestamp()::text))::text AS id,
          s.id AS server_id,
          t.name AS name,
          tt.tool_id AS tool_id,
          CASE
            WHEN (s.options->'tools_enabled') ? t.name THEN
              lower(COALESCE(s.options->'tools_enabled'->>t.name, 'true')) IN ('true','t','1','yes','y')
            ELSE TRUE
          END AS enabled,
          NOW() AS created_at,
          NOW() AS updated_at,
          COALESCE(s.org_id, tt.org_id, t.org_id) AS org_id
        FROM public.mod_mcp2_server s
        JOIN public.mod_mcp2_type_tool tt ON tt.type_id = s.type_id
        JOIN public.mod_mcp2_tool t ON t.id = tt.tool_id
        WHERE s.type_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.mod_mcp2_server_tool st
             WHERE st.server_id = s.id
               AND (
                 (st.tool_id IS NOT NULL AND st.tool_id = tt.tool_id)
                 OR (st.name IS NOT NULL AND lower(st.name) = lower(t.name))
               )
          );
      ELSE
        INSERT INTO public.mod_mcp2_server_tool (server_id, name, tool_id, enabled, created_at, updated_at, org_id)
        SELECT
          s.id AS server_id,
          t.name AS name,
          tt.tool_id AS tool_id,
          CASE
            WHEN (s.options->'tools_enabled') ? t.name THEN
              lower(COALESCE(s.options->'tools_enabled'->>t.name, 'true')) IN ('true','t','1','yes','y')
            ELSE TRUE
          END AS enabled,
          NOW() AS created_at,
          NOW() AS updated_at,
          COALESCE(s.org_id, tt.org_id, t.org_id) AS org_id
        FROM public.mod_mcp2_server s
        JOIN public.mod_mcp2_type_tool tt ON tt.type_id = s.type_id
        JOIN public.mod_mcp2_tool t ON t.id = tt.tool_id
        WHERE s.type_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.mod_mcp2_server_tool st
             WHERE st.server_id = s.id
               AND (
                 (st.tool_id IS NOT NULL AND st.tool_id = tt.tool_id)
                 OR (st.name IS NOT NULL AND lower(st.name) = lower(t.name))
               )
          );
      END IF;
    ELSE
      INSERT INTO public.mod_mcp2_server_tool (server_id, tool_id, enabled, created_at, updated_at, org_id)
      SELECT
        s.id AS server_id,
        tt.tool_id AS tool_id,
        CASE
          WHEN has_catalog AND (s.options->'tools_enabled') ? t.name THEN
            lower(COALESCE(s.options->'tools_enabled'->>t.name, 'true')) IN ('true','t','1','yes','y')
          ELSE TRUE
        END AS enabled,
        NOW() AS created_at,
        NOW() AS updated_at,
        COALESCE(s.org_id, tt.org_id, t.org_id) AS org_id
      FROM public.mod_mcp2_server s
      JOIN public.mod_mcp2_type_tool tt ON tt.type_id = s.type_id
      JOIN public.mod_mcp2_tool t ON t.id = tt.tool_id
      WHERE s.type_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.mod_mcp2_server_tool st
           WHERE st.server_id = s.id AND st.tool_id = tt.tool_id
        );
    END IF;
  ELSE
    -- No catalog: best-effort insert (enabled defaults to TRUE).
    BEGIN
      INSERT INTO public.mod_mcp2_server_tool (server_id, tool_id, enabled, created_at, updated_at, org_id)
      SELECT
        s.id AS server_id,
        tt.tool_id AS tool_id,
        TRUE AS enabled,
        NOW() AS created_at,
        NOW() AS updated_at,
        COALESCE(s.org_id, tt.org_id) AS org_id
      FROM public.mod_mcp2_server s
      JOIN public.mod_mcp2_type_tool tt ON tt.type_id = s.type_id
      WHERE s.type_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.mod_mcp2_server_tool st
           WHERE st.server_id = s.id AND st.tool_id = tt.tool_id
        );
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  -- Best-effort: remove tools_enabled key from options now that server_tool is canonical.
  BEGIN
    UPDATE public.mod_mcp2_server
       SET options = (options - 'tools_enabled'),
           updated_at = NOW()
     WHERE options ? 'tools_enabled';
  EXCEPTION WHEN others THEN
    NULL;
  END;
END $mcp2_backfill_server_tool$;

-- down
-- Non-destructive: keep server_tool rows.
