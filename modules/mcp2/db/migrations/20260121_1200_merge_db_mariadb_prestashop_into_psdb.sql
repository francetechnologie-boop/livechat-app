-- Merge legacy type DB_mariadb_prestashop into psdb (PrestaShop DB)
-- Europe/Prague date: 2026-01-21

DO $$
DECLARE
  v_psdb_id TEXT := NULL;
  v_old_id  TEXT := NULL;
BEGIN
  IF to_regclass('public.mod_mcp2_type') IS NULL THEN
    RETURN;
  END IF;

  -- Prefer the builtin psdb id if present, otherwise any psdb type.
  SELECT id INTO v_psdb_id
    FROM public.mod_mcp2_type
   WHERE id = 'm2type_builtin_psdb'
   LIMIT 1;

  IF v_psdb_id IS NULL THEN
    SELECT id INTO v_psdb_id
      FROM public.mod_mcp2_type
     WHERE lower(code) = 'psdb'
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  -- Ensure psdb tool_prefix is set (used for auto-linking tools).
  IF v_psdb_id IS NOT NULL THEN
    UPDATE public.mod_mcp2_type
       SET tool_prefix = 'psdb',
           updated_at = NOW()
     WHERE id = v_psdb_id
       AND (tool_prefix IS NULL OR btrim(tool_prefix) = '');
  END IF;

  -- Find legacy mariadb prestashop type.
  SELECT id INTO v_old_id
    FROM public.mod_mcp2_type
   WHERE lower(code) = 'db_mariadb_prestashop'
   LIMIT 1;

  IF v_psdb_id IS NULL OR v_old_id IS NULL OR v_psdb_id = v_old_id THEN
    RETURN;
  END IF;

  -- Re-point servers to psdb.
  IF to_regclass('public.mod_mcp2_server') IS NOT NULL THEN
    UPDATE public.mod_mcp2_server
       SET type_id = v_psdb_id,
           updated_at = NOW()
     WHERE type_id = v_old_id;
  END IF;

  -- Merge type↔tool mappings.
  IF to_regclass('public.mod_mcp2_type_tool') IS NOT NULL THEN
    INSERT INTO public.mod_mcp2_type_tool (type_id, tool_id, created_at, org_id)
    SELECT v_psdb_id, tt.tool_id, COALESCE(tt.created_at, NOW()), tt.org_id
      FROM public.mod_mcp2_type_tool tt
     WHERE tt.type_id = v_old_id
    ON CONFLICT (type_id, tool_id) DO NOTHING;

    DELETE FROM public.mod_mcp2_type_tool
     WHERE type_id = v_old_id;
  END IF;

  -- Finally remove the legacy type row.
  DELETE FROM public.mod_mcp2_type
   WHERE id = v_old_id;
END
$$;

