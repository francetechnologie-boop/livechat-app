-- up
-- Add a convenience tool:
--   postgresql.get_tracking_external_url_by_id_order
-- Returns only the first/best tracking_external_url for a given id_order.
-- Europe/Prague date: 2026-01-25
DO $mcp2_add_pg_tracking_external_url_by_id_order$
DECLARE
  v_type_id TEXT := NULL;
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Resolve PostgreSQL type id (prefer explicit DB_postgresql / postgresql code/name).
  IF to_regclass('public.mod_mcp2_type') IS NOT NULL THEN
    SELECT id INTO v_type_id
      FROM public.mod_mcp2_type
     WHERE lower(code) IN ('db_postgresql', 'postgresql', 'db_postgres', 'postgres')
        OR lower(name) IN ('db_postgresql', 'postgresql', 'db_postgres', 'postgres')
     ORDER BY (CASE WHEN lower(code)='db_postgresql' THEN 0 WHEN lower(code)='postgresql' THEN 1 ELSE 2 END),
              updated_at DESC NULLS LAST
     LIMIT 1;

    -- Ensure tool_prefix is set for easier auto-linking of postgresql.* tools.
    IF v_type_id IS NOT NULL THEN
      UPDATE public.mod_mcp2_type
         SET tool_prefix = 'postgresql',
             updated_at = NOW()
       WHERE id = v_type_id
         AND (tool_prefix IS NULL OR btrim(tool_prefix) = '');
    END IF;
  END IF;

  WITH defs AS (
    SELECT
      'postgresql.get_tracking_external_url_by_id_order'::text AS name,
      'Retourne (1 ligne) le numero de suivi + le lien de suivi (tracking_external_url) Packeta/Zasilkovna pour un id_order.'::text AS description,
      jsonb_build_object(
        'type','object',
        'required', jsonb_build_array('id_order'),
        'properties', jsonb_build_object(
          'id_order', jsonb_build_object('type','string','description','Order identifier (matches order_raw/id_order)')
        )
      ) AS input_schema,
      jsonb_build_object(
        'driver','postgresql',
        'sql', $$
WITH params AS (
  SELECT NULLIF(btrim(:id_order::text), '') AS id_order
)
SELECT
  NULLIF(btrim(to_jsonb(z)->>'packet_id'), '') AS numero_suivi,
  NULLIF(btrim(to_jsonb(z)->>'tracking_external_url'), '') AS lien_suivi
  FROM public.mod_grabbing_zasilkovna z
 CROSS JOIN params p
 WHERE p.id_order IS NOT NULL
   AND (z.order_raw = p.id_order OR z.id_order::text = p.id_order)
   AND NULLIF(btrim(to_jsonb(z)->>'tracking_external_url'), '') IS NOT NULL
 ORDER BY z.consigned_date DESC NULLS LAST, z.updated_at DESC NULLS LAST
 LIMIT 1
$$,
        'parameters', jsonb_build_object(
          'id_order', NULL,
          'debug', false
        )
      ) AS code
  ),
  upd AS (
    UPDATE public.mod_mcp2_tool t
       SET description = d.description,
           input_schema = d.input_schema,
           code = d.code,
           version = GREATEST(COALESCE(t.version, 1), 1),
           updated_at = NOW()
      FROM defs d
     WHERE lower(t.name) = lower(d.name)
     RETURNING t.id
  )
  INSERT INTO public.mod_mcp2_tool (id, name, description, input_schema, code, version, created_at, updated_at, org_id)
  SELECT
    'm2tool_builtin_pg_tracking_external_url_by_id_order'::text AS id,
    d.name,
    d.description,
    d.input_schema,
    d.code,
    1,
    NOW(),
    NOW(),
    NULL
  FROM defs d
  WHERE NOT EXISTS (SELECT 1 FROM public.mod_mcp2_tool t WHERE lower(t.name) = lower(d.name));

  -- Link tool to PostgreSQL type when type exists
  IF to_regclass('public.mod_mcp2_type_tool') IS NOT NULL AND to_regclass('public.mod_mcp2_type') IS NOT NULL THEN
    IF v_type_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.mod_mcp2_type WHERE id = v_type_id) THEN
      INSERT INTO public.mod_mcp2_type_tool (type_id, tool_id, created_at, org_id)
      SELECT v_type_id, t.id, NOW(), NULL
        FROM public.mod_mcp2_tool t
       WHERE lower(t.name) = lower('postgresql.get_tracking_external_url_by_id_order')
      ON CONFLICT (type_id, tool_id) DO NOTHING;
    END IF;
  END IF;
END $mcp2_add_pg_tracking_external_url_by_id_order$;

-- down
-- Non-destructive.
