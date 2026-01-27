-- up
-- Ensure built-in executable SQL is present in mod_mcp2_tool.code for common psdb tools.
-- This is a follow-up "repair" migration that updates existing rows (even if name has whitespace differences),
-- then inserts missing tools if needed.
-- Europe/Prague date: 2026-01-07
DO $mcp2_seed_builtin_update$
DECLARE
  updated_orders_list INT := 0;
  updated_best_sellers INT := 0;
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  -- psdb.orders.list
  BEGIN
    UPDATE public.mod_mcp2_tool
       SET description = 'List recent orders from DB; filter by date range, state_id, customer email',
           input_schema = jsonb_build_object(
             'type','object',
             'properties', jsonb_build_object(
               'prefix', jsonb_build_object('type','string','default','ps_','description','PrestaShop table prefix (default ps_)'),
               'limit', jsonb_build_object('type','integer','default',20,'minimum',1,'maximum',200),
               'date_from', jsonb_build_object('type','string'),
               'date_to', jsonb_build_object('type','string'),
               'state_id', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
               'status', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','string'), jsonb_build_object('type','array','items',jsonb_build_object('type','string')))),
               'id_shop', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
               'customer_email', jsonb_build_object('type','string'),
               'debug', jsonb_build_object('type','boolean','default',false,'description','Include executed SQL in output')
             )
           ),
           code = jsonb_build_object(
             'driver','mysql',
             'sql', $$SELECT
  o.id_order,
  o.reference,
  o.current_state AS state_id,
  o.id_shop,
  o.date_add,
  o.total_paid_tax_incl,
  o.id_customer,
  c.email AS customer_email,
  c.firstname,
  c.lastname
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}customer c ON c.id_customer = o.id_customer
WHERE (:date_from IS NULL OR o.date_add >= :date_from)
  AND (:date_to IS NULL OR o.date_add <= :date_to)
  AND (:state_id IS NULL OR o.current_state = :state_id)
  AND (:id_shop IS NULL OR o.id_shop = :id_shop)
  AND (:customer_email IS NULL OR c.email = :customer_email)
ORDER BY o.id_order DESC
LIMIT :limit$$,
             'parameters', jsonb_build_object(
               'prefix','ps_',
               'limit',20,
               'date_from',NULL,
               'date_to',NULL,
               'state_id',NULL,
               'id_shop',NULL,
               'customer_email',NULL,
               'debug',false
             ),
             'paramSchema', jsonb_build_object(
               'type','object',
               'properties', jsonb_build_object(
                 'prefix', jsonb_build_object('type','string','default','ps_'),
                 'limit', jsonb_build_object('type','integer','default',20,'minimum',1,'maximum',200),
                 'date_from', jsonb_build_object('type','string'),
                 'date_to', jsonb_build_object('type','string'),
                 'state_id', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
                 'status', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','string'), jsonb_build_object('type','array','items',jsonb_build_object('type','string')))),
                 'id_shop', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
                 'customer_email', jsonb_build_object('type','string'),
                 'debug', jsonb_build_object('type','boolean','default',false)
               )
             )
           ),
           version = GREATEST(COALESCE(version,1), 2),
           updated_at = NOW()
     WHERE lower(btrim(name)) = lower('psdb.orders.list');
    GET DIAGNOSTICS updated_orders_list = ROW_COUNT;
  EXCEPTION WHEN others THEN
    updated_orders_list := 0;
  END;

  IF updated_orders_list = 0 THEN
    BEGIN
      INSERT INTO public.mod_mcp2_tool (id, name, description, input_schema, code, version, created_at, updated_at, org_id)
      VALUES (
        'm2tool_builtin_psdb_orders_list',
        'psdb.orders.list',
        'List recent orders from DB; filter by date range, state_id, customer email',
        jsonb_build_object(
          'type','object',
          'properties', jsonb_build_object(
            'prefix', jsonb_build_object('type','string','default','ps_','description','PrestaShop table prefix (default ps_)'),
            'limit', jsonb_build_object('type','integer','default',20,'minimum',1,'maximum',200),
            'date_from', jsonb_build_object('type','string'),
            'date_to', jsonb_build_object('type','string'),
            'state_id', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
            'status', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','string'), jsonb_build_object('type','array','items',jsonb_build_object('type','string')))),
            'id_shop', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
            'customer_email', jsonb_build_object('type','string'),
            'debug', jsonb_build_object('type','boolean','default',false,'description','Include executed SQL in output')
          )
        ),
        jsonb_build_object(
          'driver','mysql',
          'sql', $$SELECT
  o.id_order,
  o.reference,
  o.current_state AS state_id,
  o.id_shop,
  o.date_add,
  o.total_paid_tax_incl,
  o.id_customer,
  c.email AS customer_email,
  c.firstname,
  c.lastname
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}customer c ON c.id_customer = o.id_customer
WHERE (:date_from IS NULL OR o.date_add >= :date_from)
  AND (:date_to IS NULL OR o.date_add <= :date_to)
  AND (:state_id IS NULL OR o.current_state = :state_id)
  AND (:id_shop IS NULL OR o.id_shop = :id_shop)
  AND (:customer_email IS NULL OR c.email = :customer_email)
ORDER BY o.id_order DESC
LIMIT :limit$$,
          'parameters', jsonb_build_object(
            'prefix','ps_',
            'limit',20,
            'date_from',NULL,
            'date_to',NULL,
            'state_id',NULL,
            'id_shop',NULL,
            'customer_email',NULL,
            'debug',false
          ),
          'paramSchema', jsonb_build_object(
            'type','object',
            'properties', jsonb_build_object(
              'prefix', jsonb_build_object('type','string','default','ps_'),
              'limit', jsonb_build_object('type','integer','default',20,'minimum',1,'maximum',200),
              'date_from', jsonb_build_object('type','string'),
              'date_to', jsonb_build_object('type','string'),
              'state_id', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
              'status', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','string'), jsonb_build_object('type','array','items',jsonb_build_object('type','string')))),
              'id_shop', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
              'customer_email', jsonb_build_object('type','string'),
              'debug', jsonb_build_object('type','boolean','default',false)
            )
          )
        ),
        2,
        NOW(),
        NOW(),
        NULL
      );
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;

  -- psdb.analytics.best_sellers
  BEGIN
    UPDATE public.mod_mcp2_tool
       SET description = 'Best-selling products by quantity in a period (database)',
           input_schema = jsonb_build_object(
             'type','object',
             'properties', jsonb_build_object(
               'prefix', jsonb_build_object('type','string','default','ps_','description','PrestaShop table prefix (default ps_)'),
               'limit', jsonb_build_object('type','integer','default',20,'minimum',1,'maximum',200),
               'date_from', jsonb_build_object('type','string'),
               'date_to', jsonb_build_object('type','string'),
               'id_lang', jsonb_build_object('type','integer','default',1),
               'id_shop', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
               'only_valid', jsonb_build_object('type','integer','default',1,'description','1 = only validated orders'),
               'debug', jsonb_build_object('type','boolean','default',false,'description','Include executed SQL in output')
             )
           ),
           code = jsonb_build_object(
             'driver','mysql',
             'sql', $$SELECT
  od.product_id AS id_product,
  p.reference,
  pl.name,
  SUM(od.product_quantity) AS quantity
FROM {{prefix}}order_detail od
JOIN {{prefix}}orders o ON o.id_order = od.id_order
LEFT JOIN {{prefix}}product p ON p.id_product = od.product_id
LEFT JOIN {{prefix}}product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = :id_lang
WHERE (:date_from IS NULL OR o.date_add >= :date_from)
  AND (:date_to IS NULL OR o.date_add <= :date_to)
  AND (:id_shop IS NULL OR o.id_shop = :id_shop)
  AND (:only_valid = 0 OR o.valid = 1)
GROUP BY od.product_id, p.reference, pl.name
ORDER BY quantity DESC
LIMIT :limit$$,
             'parameters', jsonb_build_object(
               'prefix','ps_',
               'limit',20,
               'date_from',NULL,
               'date_to',NULL,
               'id_lang',1,
               'id_shop',NULL,
               'only_valid',1,
               'debug',false
             ),
             'paramSchema', jsonb_build_object(
               'type','object',
               'properties', jsonb_build_object(
                 'prefix', jsonb_build_object('type','string','default','ps_'),
                 'limit', jsonb_build_object('type','integer','default',20,'minimum',1,'maximum',200),
                 'date_from', jsonb_build_object('type','string'),
                 'date_to', jsonb_build_object('type','string'),
                 'id_lang', jsonb_build_object('type','integer','default',1),
                 'id_shop', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
                 'only_valid', jsonb_build_object('type','integer','default',1),
                 'debug', jsonb_build_object('type','boolean','default',false)
               )
             )
           ),
           version = GREATEST(COALESCE(version,1), 2),
           updated_at = NOW()
     WHERE lower(btrim(name)) = lower('psdb.analytics.best_sellers');
    GET DIAGNOSTICS updated_best_sellers = ROW_COUNT;
  EXCEPTION WHEN others THEN
    updated_best_sellers := 0;
  END;

  IF updated_best_sellers = 0 THEN
    BEGIN
      INSERT INTO public.mod_mcp2_tool (id, name, description, input_schema, code, version, created_at, updated_at, org_id)
      VALUES (
        'm2tool_builtin_psdb_analytics_best_sellers',
        'psdb.analytics.best_sellers',
        'Best-selling products by quantity in a period (database)',
        jsonb_build_object(
          'type','object',
          'properties', jsonb_build_object(
            'prefix', jsonb_build_object('type','string','default','ps_','description','PrestaShop table prefix (default ps_)'),
            'limit', jsonb_build_object('type','integer','default',20,'minimum',1,'maximum',200),
            'date_from', jsonb_build_object('type','string'),
            'date_to', jsonb_build_object('type','string'),
            'id_lang', jsonb_build_object('type','integer','default',1),
            'id_shop', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
            'only_valid', jsonb_build_object('type','integer','default',1,'description','1 = only validated orders'),
            'debug', jsonb_build_object('type','boolean','default',false,'description','Include executed SQL in output')
          )
        ),
        jsonb_build_object(
          'driver','mysql',
          'sql', $$SELECT
  od.product_id AS id_product,
  p.reference,
  pl.name,
  SUM(od.product_quantity) AS quantity
FROM {{prefix}}order_detail od
JOIN {{prefix}}orders o ON o.id_order = od.id_order
LEFT JOIN {{prefix}}product p ON p.id_product = od.product_id
LEFT JOIN {{prefix}}product_lang pl ON pl.id_product = p.id_product AND pl.id_lang = :id_lang
WHERE (:date_from IS NULL OR o.date_add >= :date_from)
  AND (:date_to IS NULL OR o.date_add <= :date_to)
  AND (:id_shop IS NULL OR o.id_shop = :id_shop)
  AND (:only_valid = 0 OR o.valid = 1)
GROUP BY od.product_id, p.reference, pl.name
ORDER BY quantity DESC
LIMIT :limit$$,
          'parameters', jsonb_build_object(
            'prefix','ps_',
            'limit',20,
            'date_from',NULL,
            'date_to',NULL,
            'id_lang',1,
            'id_shop',NULL,
            'only_valid',1,
            'debug',false
          ),
          'paramSchema', jsonb_build_object(
            'type','object',
            'properties', jsonb_build_object(
              'prefix', jsonb_build_object('type','string','default','ps_'),
              'limit', jsonb_build_object('type','integer','default',20,'minimum',1,'maximum',200),
              'date_from', jsonb_build_object('type','string'),
              'date_to', jsonb_build_object('type','string'),
              'id_lang', jsonb_build_object('type','integer','default',1),
              'id_shop', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
              'only_valid', jsonb_build_object('type','integer','default',1),
              'debug', jsonb_build_object('type','boolean','default',false)
            )
          )
        ),
        2,
        NOW(),
        NOW(),
        NULL
      );
    EXCEPTION WHEN others THEN
      NULL;
    END;
  END IF;
END $mcp2_seed_builtin_update$;

-- down
-- Non-destructive: keep tool definitions.
