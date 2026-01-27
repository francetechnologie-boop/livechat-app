-- up
-- Move/backfill tool definitions into mod_mcp2_type_tool (type-scoped tool definitions)
-- Europe/Prague date: 2026-01-07
DO $$
BEGIN
  IF to_regclass('public.mod_mcp2_type') IS NULL
     OR to_regclass('public.mod_mcp2_type_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Ensure definition columns exist on mod_mcp2_type_tool
  BEGIN
    ALTER TABLE public.mod_mcp2_type_tool ADD COLUMN IF NOT EXISTS name TEXT;
    ALTER TABLE public.mod_mcp2_type_tool ADD COLUMN IF NOT EXISTS description TEXT;
    ALTER TABLE public.mod_mcp2_type_tool ADD COLUMN IF NOT EXISTS input_schema JSONB;
    ALTER TABLE public.mod_mcp2_type_tool ADD COLUMN IF NOT EXISTS code JSONB;
    ALTER TABLE public.mod_mcp2_type_tool ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
    ALTER TABLE public.mod_mcp2_type_tool ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
  EXCEPTION WHEN others THEN
    -- Keep migration portable across environments
    NULL;
  END;

  -- Optional: keep names unique per type (best-effort)
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='mcp2_type_tool_name_uq') THEN
      EXECUTE 'CREATE UNIQUE INDEX mcp2_type_tool_name_uq ON public.mod_mcp2_type_tool(type_id, lower(name)) WHERE name IS NOT NULL';
    END IF;
  EXCEPTION WHEN others THEN NULL;
  END;

  -- Backfill definitions from legacy mod_mcp2_tool when available
  IF to_regclass('public.mod_mcp2_tool') IS NOT NULL THEN
    BEGIN
      UPDATE public.mod_mcp2_type_tool tt
         SET name = COALESCE(NULLIF(tt.name,''), t.name),
             description = COALESCE(tt.description, t.description),
             input_schema = COALESCE(tt.input_schema, t.input_schema),
             code = COALESCE(tt.code, t.code),
             version = COALESCE(tt.version, t.version),
             org_id = COALESCE(tt.org_id, t.org_id),
             updated_at = NOW()
        FROM public.mod_mcp2_tool t
       WHERE tt.tool_id = t.id
         AND (tt.name IS NULL OR tt.name = '' OR tt.name = tt.tool_id);
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  -- Backfill missing type->tool rows from legacy tool catalog using type.tool_prefix (or type.code fallback)
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  WITH type_prefixes AS (
    SELECT
      t.id AS type_id,
      t.org_id AS type_org_id,
      NULLIF(btrim(COALESCE(t.tool_prefix, '')), '') AS raw_prefix,
      NULLIF(btrim(COALESCE(t.code, '')), '') AS raw_code
    FROM public.mod_mcp2_type t
  ),
  base AS (
    SELECT
      type_id,
      type_org_id,
      COALESCE(raw_prefix, raw_code) AS base0
    FROM type_prefixes
  ),
  norm AS (
    SELECT
      type_id,
      type_org_id,
      CASE
        WHEN base0 IS NULL THEN NULL
        ELSE replace(replace(base0, ' ', '_'), '-', '_')
      END AS base1
    FROM base
  ),
  patterns AS (
    SELECT
      type_id,
      type_org_id,
      CASE
        WHEN base1 IS NULL THEN NULL
        ELSE
          CASE
            WHEN right(replace(base1, '_', '.'), 1) = '.' THEN replace(base1, '_', '.')
            ELSE replace(base1, '_', '.') || '.'
          END
      END AS dot_prefix,
      CASE
        WHEN base1 IS NULL THEN NULL
        ELSE
          CASE
            WHEN right(replace(base1, '.', '_'), 1) = '_' THEN replace(base1, '.', '_')
            ELSE replace(base1, '.', '_') || '_'
          END
      END AS underscore_prefix
    FROM norm
  )
  INSERT INTO public.mod_mcp2_type_tool (type_id, tool_id, created_at, org_id, name, description, input_schema, code, version, updated_at)
  SELECT
    p.type_id,
    tool.id AS tool_id,
    NOW() AS created_at,
    COALESCE(p.type_org_id, tool.org_id) AS org_id,
    tool.name,
    tool.description,
    tool.input_schema,
    tool.code,
    tool.version,
    NOW() AS updated_at
  FROM patterns p
  JOIN public.mod_mcp2_tool tool
    ON (
      (p.dot_prefix IS NOT NULL AND tool.name ILIKE p.dot_prefix || '%')
      OR
      (p.underscore_prefix IS NOT NULL AND tool.name ILIKE p.underscore_prefix || '%')
    )
  WHERE p.dot_prefix IS NOT NULL OR p.underscore_prefix IS NOT NULL
  ON CONFLICT (type_id, tool_id) DO NOTHING;
END $$;

-- down
-- Non-destructive: keep mappings (they may have been edited manually).
