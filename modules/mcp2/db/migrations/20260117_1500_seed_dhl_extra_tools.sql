-- up
-- Seed additional DHL/Presta helper tools into MCP2 catalog
-- Europe/Prague date: 2026-01-17
DO $mcp2_seed_dhl_more$
DECLARE
  v_type_id TEXT := 'm2type_builtin_dhl';
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;
  IF to_regclass('public.mod_mcp2_type') IS NOT NULL THEN
    -- Prefer existing custom type like DHL_API; otherwise builtin "dhl"; otherwise skip linking.
    SELECT id INTO v_type_id
      FROM public.mod_mcp2_type
     WHERE lower(code) IN ('dhl_api', 'dhl')
        OR lower(name) IN ('dhl_api', 'dhl')
     ORDER BY (CASE WHEN lower(code)='dhl_api' THEN 0 WHEN lower(code)='dhl' THEN 1 ELSE 2 END),
              updated_at DESC
     LIMIT 1;
  END IF;

  WITH defs AS (
    -- Search orders by email/name/reference/id_order and return tracking numbers + customer/company
    SELECT
      'dhl.presta.orders.find'::text AS name,
      'Find Presta orders by email/name/reference/id_order and return tracking numbers + customer/company (MySQL). Requires server.options.origin_profile_id (DHL profile).'::text AS description,
      jsonb_build_object(
        'type','object',
        'properties', jsonb_build_object(
          'prefix', jsonb_build_object('type','string','default','ps_','description','PrestaShop table prefix'),
          'limit', jsonb_build_object('type','integer','default',20,'minimum',1,'maximum',200),
          'id_order', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
          'reference', jsonb_build_object('type','string','description','Order reference (exact/partial)'),
          'email', jsonb_build_object('type','string','description','Customer email (exact/partial)'),
          'firstname', jsonb_build_object('type','string','description','Customer first name (partial)'),
          'lastname', jsonb_build_object('type','string','description','Customer last name (partial)'),
          'company', jsonb_build_object('type','string','description','Company (partial)'),
          'debug', jsonb_build_object('type','boolean','default',false)
        )
      ) AS input_schema,
      jsonb_build_object(
        'driver','mysql',
        'sql', $sql_find_orders$SELECT
  o.id_order,
  o.reference,
  o.date_add,
  o.current_state,
  c.email,
  c.firstname,
  c.lastname,
  NULLIF(TRIM(COALESCE(ai.company, ad.company, '')), '') AS company,
  oc.tracking_number
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}customer c ON c.id_customer = o.id_customer
LEFT JOIN {{prefix}}address ai ON ai.id_address = o.id_address_invoice
LEFT JOIN {{prefix}}address ad ON ad.id_address = o.id_address_delivery
LEFT JOIN {{prefix}}order_carrier oc ON oc.id_order = o.id_order
WHERE (:id_order IS NULL OR o.id_order = :id_order)
  AND (:reference IS NULL OR o.reference LIKE CONCAT('%', :reference, '%'))
  AND (:email IS NULL OR c.email LIKE CONCAT('%', :email, '%'))
  AND (:firstname IS NULL OR c.firstname LIKE CONCAT('%', :firstname, '%'))
  AND (:lastname IS NULL OR c.lastname LIKE CONCAT('%', :lastname, '%'))
  AND (:company IS NULL OR (COALESCE(ai.company, ad.company, '') LIKE CONCAT('%', :company, '%')))
ORDER BY o.id_order DESC, oc.id_order_carrier DESC
LIMIT :limit$sql_find_orders$,
        'parameters', jsonb_build_object(
          'prefix','ps_',
          'limit',20,
          'id_order',NULL,
          'reference',NULL,
          'email',NULL,
          'firstname',NULL,
          'lastname',NULL,
          'company',NULL,
          'debug',false
        ),
        'paramSchema', jsonb_build_object(
          'type','object',
          'properties', jsonb_build_object(
            'prefix', jsonb_build_object('type','string','default','ps_'),
            'limit', jsonb_build_object('type','integer','default',20),
            'id_order', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
            'reference', jsonb_build_object('type','string'),
            'email', jsonb_build_object('type','string'),
            'firstname', jsonb_build_object('type','string'),
            'lastname', jsonb_build_object('type','string'),
            'company', jsonb_build_object('type','string'),
            'debug', jsonb_build_object('type','boolean','default',false)
          )
        )
      ) AS code
    UNION ALL
    -- Track by Presta order id using the internal DHL module endpoint (returns status + delivered + events + customer)
    SELECT
      'dhl.presta.order.track'::text AS name,
      'Track shipment for a Presta order id via internal /api/dhl/prestashop/order-tracking (uses DHL profile DB).'::text AS description,
      jsonb_build_object(
        'type','object',
        'properties', jsonb_build_object(
          'id_order', jsonb_build_object('type','integer'),
          'dhl_profile_id', jsonb_build_object('type','integer','description','Optional; defaults to server origin_profile_id (when origin_module=dhl)'),
          'org_id', jsonb_build_object('type','string','description','Organization id (optional)'),
          'language', jsonb_build_object('type','string'),
          'raw', jsonb_build_object('type','integer','default',0),
          'timeout_ms', jsonb_build_object('type','integer','default',20000,'minimum',100,'maximum',60000)
        ),
        'required', jsonb_build_array('id_order')
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

  -- Link tools to DHL type when type exists
  IF to_regclass('public.mod_mcp2_type_tool') IS NOT NULL AND to_regclass('public.mod_mcp2_type') IS NOT NULL THEN
    IF v_type_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.mod_mcp2_type WHERE id = v_type_id) THEN
      INSERT INTO public.mod_mcp2_type_tool (type_id, tool_id, created_at, org_id)
      SELECT v_type_id, t.id, NOW(), NULL
      FROM public.mod_mcp2_tool t
      WHERE t.name IN ('dhl.presta.orders.find', 'dhl.presta.order.track')
      ON CONFLICT (type_id, tool_id) DO NOTHING;
    END IF;
  END IF;
END $mcp2_seed_dhl_more$;

-- down
-- Non-destructive: keep seeded definitions.
