-- up
-- Add a convenience tool: dhl.track.by_id_order
-- Europe/Prague date: 2026-01-19
DO $mcp2_add_dhl_track_by_id_order$
DECLARE
  v_type_id TEXT := 'm2type_builtin_dhl';
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Resolve DHL type id when possible (custom DHL_API preferred)
  IF to_regclass('public.mod_mcp2_type') IS NOT NULL THEN
    SELECT id INTO v_type_id
      FROM public.mod_mcp2_type
     WHERE lower(code) IN ('dhl_api', 'dhl')
        OR lower(name) IN ('dhl_api', 'dhl')
     ORDER BY (CASE WHEN lower(code)='dhl_api' THEN 0 WHEN lower(code)='dhl' THEN 1 ELSE 2 END),
              updated_at DESC
     LIMIT 1;
  END IF;

  WITH defs AS (
    SELECT
      'dhl.track.by_id_order'::text AS name,
      'Get DHL tracking link for a PrestaShop order id via /api/dhl/prestashop/order-tracking (uses DHL profile DB + Presta MySQL profile).'::text AS description,
      jsonb_build_object(
        'type','object',
        'required', jsonb_build_array('id_order'),
        'properties', jsonb_build_object(
          'id_order', jsonb_build_object('type','integer','description','PrestaShop id_order'),
          'dhl_profile_id', jsonb_build_object('type','integer','description','Optional; defaults to server origin_profile_id when configured'),
          'org_id', jsonb_build_object('type','string','description','Organization id (optional)'),
          'language', jsonb_build_object('type','string','description','Accept-Language (e.g., fr, en)'),
          'raw', jsonb_build_object('type','integer','default',0,'description','1 to include raw payload'),
          'timeout_ms', jsonb_build_object('type','integer','default',20000,'minimum',100,'maximum',60000)
        )
      ) AS input_schema,
      jsonb_build_object(
        'driver','http',
        'method','GET',
        'path','/api/dhl/prestashop/order-tracking',
        'query', jsonb_build_object(
          'id_order', ':id_order',
          'dhl_profile_id', ':dhl_profile_id',
          'org_id', ':org_id',
          'language', ':language',
          'raw', ':raw'
        ),
        'timeout_ms', 20000
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
    'm2tool_builtin_dhl_track_by_id_order'::text AS id,
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

  -- Link tool to DHL type when type exists
  IF to_regclass('public.mod_mcp2_type_tool') IS NOT NULL AND to_regclass('public.mod_mcp2_type') IS NOT NULL THEN
    IF v_type_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.mod_mcp2_type WHERE id = v_type_id) THEN
      INSERT INTO public.mod_mcp2_type_tool (type_id, tool_id, created_at, org_id)
      SELECT v_type_id, t.id, NOW(), NULL
      FROM public.mod_mcp2_tool t
      WHERE lower(t.name) = lower('dhl.track.by_id_order')
      ON CONFLICT (type_id, tool_id) DO NOTHING;
    END IF;
  END IF;
END $mcp2_add_dhl_track_by_id_order$;

-- down
-- Non-destructive.
