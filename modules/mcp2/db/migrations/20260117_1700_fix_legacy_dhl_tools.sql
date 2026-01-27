-- up
-- Backfill legacy DHL MCP2 tools created before tool code/config existed.
-- Some installs already have tools like dhl.track_shipment / dhl.track_shipments with NULL code.
-- Europe/Prague date: 2026-01-17
DO $mcp2_fix_legacy_dhl$
DECLARE
  target_type_id TEXT := NULL;
BEGIN
  IF to_regclass('public.mod_mcp2_type') IS NULL
     OR to_regclass('public.mod_mcp2_tool') IS NULL
     OR to_regclass('public.mod_mcp2_type_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Prefer an existing type by code/name
  SELECT id INTO target_type_id
    FROM public.mod_mcp2_type
   WHERE lower(code) IN ('dhl', 'dhl_api')
      OR lower(name) IN ('dhl', 'dhl_api')
   ORDER BY (CASE WHEN lower(code)='dhl_api' THEN 0 WHEN lower(code)='dhl' THEN 1 ELSE 2 END),
            updated_at DESC
   LIMIT 1;

  IF target_type_id IS NULL THEN
    RETURN;
  END IF;

  -- Best-effort: ensure tool_prefix is set so auto-link works
  BEGIN
    UPDATE public.mod_mcp2_type
       SET tool_prefix = COALESCE(NULLIF(tool_prefix,''), 'dhl'),
           updated_at = NOW()
     WHERE id = target_type_id;
  EXCEPTION WHEN others THEN NULL;
  END;

  WITH defs AS (
    SELECT
      'dhl.track_shipment'::text AS name,
      'Track a DHL Express shipment (single AWB) via internal /api/dhl/track (requires DHL profile in DB).'::text AS description,
      jsonb_build_object(
        'type','object',
        'required', jsonb_build_array('tracking_number'),
        'properties', jsonb_build_object(
          'tracking_number', jsonb_build_object('type','string','description','AWB tracking number'),
          'language', jsonb_build_object('type','string','description','Accept-Language header (e.g., en, fr, de)'),
          'dhl_profile_id', jsonb_build_object('type','integer','description','DHL profile id (module dhl)'),
          'org_id', jsonb_build_object('type','string','description','Organization id (optional)'),
          'raw', jsonb_build_object('type','integer','default',0,'description','1 to include raw DHL payload'),
          'timeout_ms', jsonb_build_object('type','integer','default',20000,'minimum',100,'maximum',60000)
        )
      ) AS input_schema,
      jsonb_build_object(
        'driver','http',
        'method','GET',
        'path','/api/dhl/track',
        'query', jsonb_build_object(
          'trackingNumber', ':tracking_number',
          'language', ':language',
          'dhl_profile_id', ':dhl_profile_id',
          'org_id', ':org_id',
          'raw', ':raw'
        ),
        'timeout_ms', 20000
      ) AS code
    UNION ALL
    SELECT
      'dhl.track_shipments'::text AS name,
      'Track multiple DHL shipments (AWB list) via internal /api/dhl/track/batch (requires DHL profile in DB).'::text AS description,
      jsonb_build_object(
        'type','object',
        'required', jsonb_build_array('tracking_numbers'),
        'properties', jsonb_build_object(
          'tracking_numbers', jsonb_build_object('type','array','items',jsonb_build_object('type','string'),'description','List of AWB tracking numbers'),
          'language', jsonb_build_object('type','string'),
          'dhl_profile_id', jsonb_build_object('type','integer'),
          'org_id', jsonb_build_object('type','string'),
          'raw', jsonb_build_object('type','integer','default',0),
          'timeout_ms', jsonb_build_object('type','integer','default',20000,'minimum',100,'maximum',60000)
        )
      ) AS input_schema,
      jsonb_build_object(
        'driver','http',
        'method','POST',
        'path','/api/dhl/track/batch',
        'timeout_ms', 20000
      ) AS code
  ),
  upd AS (
    UPDATE public.mod_mcp2_tool t
       SET description = CASE WHEN t.description IS NULL OR btrim(t.description) = '' THEN d.description ELSE t.description END,
           input_schema = COALESCE(t.input_schema, d.input_schema),
           code = CASE WHEN t.code IS NULL OR (t.code->>'driver') IS NULL THEN d.code ELSE t.code END,
           updated_at = NOW()
      FROM defs d
     WHERE lower(t.name) = lower(d.name)
     RETURNING t.id, t.name
  )
  INSERT INTO public.mod_mcp2_tool (id, name, description, input_schema, code, version, created_at, updated_at, org_id)
  SELECT
    ('m2tool_builtin_' || replace(replace(d.name,'/','_'),'.','_'))::text AS id,
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

  -- Link legacy tools to the resolved type
  INSERT INTO public.mod_mcp2_type_tool (type_id, tool_id, created_at, org_id)
  SELECT target_type_id, t.id, NOW(), NULL
    FROM public.mod_mcp2_tool t
   WHERE lower(t.name) IN (lower('dhl.track_shipment'), lower('dhl.track_shipments'))
  ON CONFLICT (type_id, tool_id) DO NOTHING;
END $mcp2_fix_legacy_dhl$;

-- down
-- Non-destructive.
