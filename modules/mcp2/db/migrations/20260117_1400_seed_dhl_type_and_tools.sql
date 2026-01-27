-- up
-- Seed DHL type + tools into MCP2 catalog
-- Europe/Prague date: 2026-01-17
DO $mcp2_seed_dhl$
DECLARE
  v_type_id TEXT := 'm2type_builtin_dhl';
BEGIN
  IF to_regclass('public.mod_mcp2_type') IS NULL OR to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Type
  BEGIN
    -- Prefer existing custom type like code/name = DHL_API; otherwise use builtin "dhl".
    SELECT id INTO v_type_id
      FROM public.mod_mcp2_type
     WHERE lower(code) IN ('dhl_api', 'dhl')
        OR lower(name) IN ('dhl_api', 'dhl')
     ORDER BY (CASE WHEN lower(code)='dhl_api' THEN 0 WHEN lower(code)='dhl' THEN 1 ELSE 2 END),
              updated_at DESC
     LIMIT 1;

    IF v_type_id IS NULL THEN
      v_type_id := 'm2type_builtin_dhl';
      INSERT INTO public.mod_mcp2_type (id, code, name, description, tool_prefix, created_at, updated_at, org_id)
      VALUES (v_type_id, 'dhl', 'DHL', 'DHL tracking + Presta order helpers', 'dhl', NOW(), NOW(), NULL)
      ON CONFLICT (id) DO UPDATE SET
        code=EXCLUDED.code,
        name=EXCLUDED.name,
        description=EXCLUDED.description,
        tool_prefix=EXCLUDED.tool_prefix,
        updated_at=NOW();
    END IF;

    -- Ensure tool_prefix is present for future auto-linking
    UPDATE public.mod_mcp2_type
       SET tool_prefix = COALESCE(NULLIF(tool_prefix,''), 'dhl'),
           updated_at = NOW()
     WHERE id = v_type_id;
  EXCEPTION WHEN others THEN
    NULL;
  END;

  -- Tools
  WITH defs AS (
    -- Calls the internal DHL module endpoint (uses DHL profile DB; no API key stored in MCP2).
    SELECT
      'dhl.track'::text AS name,
      'Track a DHL shipment via the internal /api/dhl/track endpoint (supports dhl_profile_id, raw=1).'::text AS description,
      jsonb_build_object(
        'type','object',
        'properties', jsonb_build_object(
          'trackingNumber', jsonb_build_object('type','string','description','DHL tracking number or reference'),
          'language', jsonb_build_object('type','string','description','Accept-Language (e.g., en, fr)'),
          'dhl_profile_id', jsonb_build_object('type','integer','description','DHL profile id (module dhl)'),
          'org_id', jsonb_build_object('type','string','description','Organization id (optional)'),
          'raw', jsonb_build_object('type','integer','default',0,'description','1 to include raw payload'),
          'timeout_ms', jsonb_build_object('type','integer','default',20000,'minimum',100,'maximum',60000)
        ),
        'required', jsonb_build_array('trackingNumber')
      ) AS input_schema,
      jsonb_build_object(
        'driver','http',
        'method','GET',
        'path','/api/dhl/track',
        'query', jsonb_build_object(
          'trackingNumber', ':trackingNumber',
          'language', ':language',
          'dhl_profile_id', ':dhl_profile_id',
          'org_id', ':org_id',
          'raw', ':raw'
        ),
        'timeout_ms', 20000
      ) AS code
    UNION ALL
    SELECT
      'dhl.presta.order_customer'::text AS name,
      'Get Presta customer email/name/company for an order id (MySQL). Requires server.options.origin_profile_id.'::text AS description,
      jsonb_build_object(
        'type','object',
        'properties', jsonb_build_object(
          'prefix', jsonb_build_object('type','string','default','ps_','description','PrestaShop table prefix'),
          'id_order', jsonb_build_object('type','integer','description','Presta id_order'),
          'debug', jsonb_build_object('type','boolean','default',false)
        ),
        'required', jsonb_build_array('id_order')
      ) AS input_schema,
      jsonb_build_object(
        'driver','mysql',
        'sql', $sql_order_customer$SELECT
  o.id_order,
  o.reference,
  c.email,
  c.firstname,
  c.lastname,
  NULLIF(TRIM(COALESCE(ai.company, ad.company, '')), '') AS company
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}customer c ON c.id_customer = o.id_customer
LEFT JOIN {{prefix}}address ai ON ai.id_address = o.id_address_invoice
LEFT JOIN {{prefix}}address ad ON ad.id_address = o.id_address_delivery
WHERE o.id_order = :id_order
LIMIT 1$sql_order_customer$,
        'parameters', jsonb_build_object(
          'prefix','ps_',
          'id_order', NULL,
          'debug', false
        ),
        'paramSchema', jsonb_build_object(
          'type','object',
          'properties', jsonb_build_object(
            'prefix', jsonb_build_object('type','string','default','ps_'),
            'id_order', jsonb_build_object('type','integer'),
            'debug', jsonb_build_object('type','boolean','default',false)
          ),
          'required', jsonb_build_array('id_order')
        )
      ) AS code
    UNION ALL
    SELECT
      'dhl.presta.order_tracking_numbers'::text AS name,
      'Get tracking numbers for an order from Presta (order_carrier.tracking_number).'::text AS description,
      jsonb_build_object(
        'type','object',
        'properties', jsonb_build_object(
          'prefix', jsonb_build_object('type','string','default','ps_','description','PrestaShop table prefix'),
          'id_order', jsonb_build_object('type','integer','description','Presta id_order'),
          'debug', jsonb_build_object('type','boolean','default',false)
        ),
        'required', jsonb_build_array('id_order')
      ) AS input_schema,
      jsonb_build_object(
        'driver','mysql',
        'sql', $sql_order_tn$SELECT
  o.id_order,
  o.reference,
  oc.tracking_number
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}order_carrier oc ON oc.id_order = o.id_order
WHERE o.id_order = :id_order
ORDER BY oc.id_order_carrier DESC
LIMIT 5$sql_order_tn$,
        'parameters', jsonb_build_object(
          'prefix','ps_',
          'id_order', NULL,
          'debug', false
        ),
        'paramSchema', jsonb_build_object(
          'type','object',
          'properties', jsonb_build_object(
            'prefix', jsonb_build_object('type','string','default','ps_'),
            'id_order', jsonb_build_object('type','integer'),
            'debug', jsonb_build_object('type','boolean','default',false)
          ),
          'required', jsonb_build_array('id_order')
        )
      ) AS code
  )
  , upd AS (
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

  -- Link tools to type
  IF to_regclass('public.mod_mcp2_type_tool') IS NOT NULL THEN
    INSERT INTO public.mod_mcp2_type_tool (type_id, tool_id, created_at, org_id)
    SELECT v_type_id, t.id, NOW(), NULL
    FROM public.mod_mcp2_tool t
    WHERE t.name IN ('dhl.track', 'dhl.presta.order_customer', 'dhl.presta.order_tracking_numbers')
    ON CONFLICT (type_id, tool_id) DO NOTHING;
  END IF;
END $mcp2_seed_dhl$;

-- down
-- Non-destructive: keep seeded definitions.
