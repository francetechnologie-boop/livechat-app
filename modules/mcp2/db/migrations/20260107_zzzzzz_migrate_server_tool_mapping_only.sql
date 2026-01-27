-- up
-- Migrate mod_mcp2_server_tool to mapping-only schema (server_id, tool_id, enabled, timestamps, org_id),
-- preserving existing enabled flags and mapping legacy name -> tool_id via mod_mcp2_tool when possible.
-- Europe/Prague date: 2026-01-07
DO $$
DECLARE
  has_name_col boolean := false;
  has_tool_id_col boolean := false;
BEGIN
  IF to_regclass('public.mod_mcp2_server_tool') IS NULL THEN
    -- Create fresh mapping-only table
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
    EXCEPTION WHEN others THEN NULL;
    END;
    RETURN;
  END IF;

  -- Detect legacy columns (best-effort)
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_mcp2_server_tool' AND column_name='name'
  ) INTO has_name_col;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_mcp2_server_tool' AND column_name='tool_id'
  ) INTO has_tool_id_col;

  -- Create new mapping-only table
  BEGIN
    DROP TABLE IF EXISTS public.mod_mcp2_server_tool__new;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    CREATE TABLE public.mod_mcp2_server_tool__new (
      server_id  TEXT NOT NULL,
      tool_id    TEXT NOT NULL,
      enabled    BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      org_id     TEXT NULL,
      PRIMARY KEY (server_id, tool_id)
    );
  EXCEPTION WHEN others THEN NULL;
  END;

  -- Copy data:
  -- - Prefer existing tool_id when present.
  -- - Else map name -> mod_mcp2_tool.id when catalog exists.
  IF has_tool_id_col THEN
    IF to_regclass('public.mod_mcp2_tool') IS NOT NULL AND has_name_col THEN
      INSERT INTO public.mod_mcp2_server_tool__new (server_id, tool_id, enabled, created_at, updated_at, org_id)
      SELECT
        COALESCE(NULLIF(btrim(st.server_id),''), '') AS server_id,
        COALESCE(NULLIF(btrim(st.tool_id),''), t.id) AS tool_id,
        COALESCE(st.enabled, TRUE) AS enabled,
        COALESCE(st.created_at, NOW()) AS created_at,
        COALESCE(st.updated_at, NOW()) AS updated_at,
        st.org_id
      FROM public.mod_mcp2_server_tool st
      LEFT JOIN public.mod_mcp2_tool t ON lower(t.name) = lower(st.name)
      WHERE COALESCE(NULLIF(btrim(st.server_id),''), '') <> ''
        AND COALESCE(NULLIF(btrim(st.tool_id),''), t.id) IS NOT NULL
      ON CONFLICT (server_id, tool_id) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            updated_at = NOW();
    ELSE
      INSERT INTO public.mod_mcp2_server_tool__new (server_id, tool_id, enabled, created_at, updated_at, org_id)
      SELECT
        COALESCE(NULLIF(btrim(st.server_id),''), '') AS server_id,
        st.tool_id AS tool_id,
        COALESCE(st.enabled, TRUE) AS enabled,
        COALESCE(st.created_at, NOW()) AS created_at,
        COALESCE(st.updated_at, NOW()) AS updated_at,
        st.org_id
      FROM public.mod_mcp2_server_tool st
      WHERE COALESCE(NULLIF(btrim(st.server_id),''), '') <> ''
        AND NULLIF(btrim(st.tool_id), '') IS NOT NULL
      ON CONFLICT (server_id, tool_id) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            updated_at = NOW();
    END IF;
  ELSIF to_regclass('public.mod_mcp2_tool') IS NOT NULL AND has_name_col THEN
    INSERT INTO public.mod_mcp2_server_tool__new (server_id, tool_id, enabled, created_at, updated_at, org_id)
    SELECT
      COALESCE(NULLIF(btrim(st.server_id),''), '') AS server_id,
      t.id AS tool_id,
      COALESCE(st.enabled, TRUE) AS enabled,
      COALESCE(st.created_at, NOW()) AS created_at,
      COALESCE(st.updated_at, NOW()) AS updated_at,
      st.org_id
    FROM public.mod_mcp2_server_tool st
    JOIN public.mod_mcp2_tool t ON lower(t.name) = lower(st.name)
    WHERE COALESCE(NULLIF(btrim(st.server_id),''), '') <> ''
    ON CONFLICT (server_id, tool_id) DO UPDATE
      SET enabled = EXCLUDED.enabled,
          updated_at = NOW();
  END IF;

  -- Swap tables
  BEGIN
    DROP TABLE public.mod_mcp2_server_tool;
  EXCEPTION WHEN others THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.mod_mcp2_server_tool__new RENAME TO mod_mcp2_server_tool;
  EXCEPTION WHEN others THEN NULL;
  END;

  -- Indexes (best-effort)
  BEGIN
    -- Keep legacy index name for compatibility with older installs + schema scanners
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mcp2_tool_server ON public.mod_mcp2_server_tool(server_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mcp2_server_tool_server ON public.mod_mcp2_server_tool(server_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mcp2_server_tool_tool ON public.mod_mcp2_server_tool(tool_id)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mcp2_server_tool_org ON public.mod_mcp2_server_tool(org_id)';
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- down
-- Non-destructive: keep mapping-only table.
