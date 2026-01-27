-- up
-- Seed built-in executable SQL into mod_mcp2_tool.code for common psdb tools.
-- This makes tools executable without relying on hardcoded fallbacks.
-- Europe/Prague date: 2026-01-07
DO $mcp2_seed_builtin$
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  WITH defs AS (
    SELECT
      'psdb.orders.list'::text AS name,
      'List recent orders from DB; filter by date range, state_id, customer email'::text AS description,
      jsonb_build_object(
        'type','object',
        'properties', jsonb_build_object(
          'prefix', jsonb_build_object('type','string','default','ps_','description','PrestaShop table prefix (default ps_)'),
          'limit', jsonb_build_object('type','integer','default',20,'minimum',1,'maximum',200),
          'date_from', jsonb_build_object('type','string'),
          'date_to', jsonb_build_object('type','string'),
          'state_id', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
          'id_shop', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','string'), jsonb_build_object('type','null'))),
          'customer_email', jsonb_build_object('type','string'),
          'debug', jsonb_build_object('type','boolean','default',false,'description','Include executed SQL in output')
        )
      ) AS input_schema,
      jsonb_build_object(
        'driver','mysql',
        'sql', $sql_orders_list$SELECT
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
LIMIT :limit$sql_orders_list$,
        'parameters', jsonb_build_object(
          'prefix','ps_',
          'limit',20,
          'date_from',NULL,
          'date_to',NULL,
          'state_id',NULL,
          'id_shop',NULL,
          'customer_email',NULL,
          'debug',false
        )
      ) AS code
    UNION ALL
    SELECT
      'psdb.analytics.best_sellers'::text AS name,
      'Best-selling products by quantity in a period (database)'::text AS description,
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
      ) AS input_schema,
      jsonb_build_object(
        'driver','mysql',
        'sql', $sql_best_sellers$SELECT
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
LIMIT :limit$sql_best_sellers$,
        'parameters', jsonb_build_object(
          'prefix','ps_',
          'limit',20,
          'date_from',NULL,
          'date_to',NULL,
          'id_lang',1,
          'id_shop',NULL,
          'only_valid',1,
          'debug',false
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
END $mcp2_seed_builtin$;

-- down
-- Non-destructive: keep tool definitions.
