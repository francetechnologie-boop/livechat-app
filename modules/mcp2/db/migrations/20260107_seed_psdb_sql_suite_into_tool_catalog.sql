-- up
-- Seed executable MySQL SQL into mod_mcp2_tool.code for psdb.* tools so there is no runtime fallback.
-- Europe/Prague date: 2026-01-07
DO $mcp2_seed_suite$
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Helper: only update if tool exists (best-effort portability).

  -- psdb.products.search
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  p.id_product,
  p.reference,
  p.price,
  p.active,
  sa.quantity AS stock_quantity,
  pl.name
FROM {{prefix}}product p
LEFT JOIN {{prefix}}product_lang pl
  ON pl.id_product = p.id_product AND pl.id_lang = :id_lang
LEFT JOIN {{prefix}}stock_available sa
  ON sa.id_product = p.id_product AND sa.id_product_attribute = 0
WHERE (:query IS NULL OR pl.name LIKE CONCAT('%', :query, '%'))
  AND (:reference IS NULL OR p.reference LIKE CONCAT('%', :reference, '%'))
  AND (:price_min IS NULL OR p.price >= :price_min)
  AND (:price_max IS NULL OR p.price <= :price_max)
  AND (:available IS NULL OR p.active = CASE WHEN :available THEN 1 ELSE p.active END)
  AND (:category_id IS NULL OR EXISTS (
    SELECT 1 FROM {{prefix}}category_product cp
     WHERE cp.id_product = p.id_product
       AND cp.id_category = :category_id
  ))
ORDER BY
  CASE WHEN :order_by='id' AND :order_dir='asc' THEN p.id_product END ASC,
  CASE WHEN :order_by='id' AND :order_dir='desc' THEN p.id_product END DESC,
  CASE WHEN :order_by='name' AND :order_dir='asc' THEN pl.name END ASC,
  CASE WHEN :order_by='name' AND :order_dir='desc' THEN pl.name END DESC,
  CASE WHEN :order_by='price' AND :order_dir='asc' THEN p.price END ASC,
  CASE WHEN :order_by='price' AND :order_dir='desc' THEN p.price END DESC,
  CASE WHEN :order_by='stock' AND :order_dir='asc' THEN sa.quantity END ASC,
  CASE WHEN :order_by='stock' AND :order_dir='desc' THEN sa.quantity END DESC
LIMIT :page_size OFFSET :offset$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'page',1,
         'page_size',20,
         'query',NULL,
         'reference',NULL,
         'id_lang',1,
         'order_by','id',
         'order_dir','desc',
         'available',NULL,
         'price_min',NULL,
         'price_max',NULL,
         'category_id',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.products.search';

  -- psdb.products.list
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  p.id_product,
  p.reference,
  p.price,
  p.active,
  sa.quantity AS stock_quantity,
  pl.name
FROM {{prefix}}product p
LEFT JOIN {{prefix}}product_lang pl
  ON pl.id_product = p.id_product AND pl.id_lang = :id_lang
LEFT JOIN {{prefix}}stock_available sa
  ON sa.id_product = p.id_product AND sa.id_product_attribute = 0
WHERE (:price_min IS NULL OR p.price >= :price_min)
  AND (:price_max IS NULL OR p.price <= :price_max)
  AND (:available IS NULL OR p.active = CASE WHEN :available THEN 1 ELSE p.active END)
  AND (:category_id IS NULL OR EXISTS (
    SELECT 1 FROM {{prefix}}category_product cp
     WHERE cp.id_product = p.id_product
       AND cp.id_category = :category_id
  ))
ORDER BY
  CASE WHEN :order_by='id' AND :order_dir='asc' THEN p.id_product END ASC,
  CASE WHEN :order_by='id' AND :order_dir='desc' THEN p.id_product END DESC,
  CASE WHEN :order_by='name' AND :order_dir='asc' THEN pl.name END ASC,
  CASE WHEN :order_by='name' AND :order_dir='desc' THEN pl.name END DESC,
  CASE WHEN :order_by='price' AND :order_dir='asc' THEN p.price END ASC,
  CASE WHEN :order_by='price' AND :order_dir='desc' THEN p.price END DESC,
  CASE WHEN :order_by='stock' AND :order_dir='asc' THEN sa.quantity END ASC,
  CASE WHEN :order_by='stock' AND :order_dir='desc' THEN sa.quantity END DESC
LIMIT :page_size OFFSET :offset$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'page',1,
         'page_size',20,
         'id_lang',1,
         'order_by','id',
         'order_dir','desc',
         'available',NULL,
         'price_min',NULL,
         'price_max',NULL,
         'category_id',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.products.list';

  -- psdb.products.get
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  p.id_product,
  p.reference,
  p.price,
  p.active,
  sa.quantity AS stock_quantity,
  pl.name,
  pl.description_short,
  pl.description
FROM {{prefix}}product p
LEFT JOIN {{prefix}}product_lang pl
  ON pl.id_product = p.id_product AND pl.id_lang = :id_lang
LEFT JOIN {{prefix}}stock_available sa
  ON sa.id_product = p.id_product AND sa.id_product_attribute = 0
WHERE (:id IS NOT NULL AND p.id_product = :id)
   OR (:reference IS NOT NULL AND p.reference = :reference)
LIMIT 1$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'id',NULL,
         'reference',NULL,
         'id_lang',1,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.products.get';

  -- psdb.products.update
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', jsonb_build_array(
         $$UPDATE {{prefix}}product
SET
  price = COALESCE(:price, price),
  active = COALESCE(:active, active)
WHERE ((:id IS NOT NULL AND id_product = :id) OR (:reference IS NOT NULL AND reference = :reference))
LIMIT 1$$,
         $$UPDATE {{prefix}}stock_available sa
JOIN {{prefix}}product p ON p.id_product = sa.id_product
SET sa.quantity = COALESCE(:stock_quantity, sa.quantity)
WHERE sa.id_product_attribute = 0
  AND (:stock_quantity IS NOT NULL)
  AND ((:id IS NOT NULL AND p.id_product = :id) OR (:reference IS NOT NULL AND p.reference = :reference))$$
       ),
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'id',NULL,
         'reference',NULL,
         'price',NULL,
         'active',NULL,
         'stock_quantity',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.products.update';

  -- psdb.customers.list
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  c.id_customer,
  c.email,
  c.firstname,
  c.lastname,
  c.date_add,
  c.newsletter,
  c.active,
  (SELECT COUNT(*) FROM {{prefix}}orders o WHERE o.id_customer = c.id_customer) AS orders_count
FROM {{prefix}}customer c
WHERE (:date_from IS NULL OR c.date_add >= :date_from)
  AND (:date_to IS NULL OR c.date_add <= :date_to)
  AND (:subscribed IS NULL OR c.newsletter = :subscribed)
HAVING (:segment IS NULL
        OR (:segment = 'new' AND orders_count = 0)
        OR (:segment = 'returning' AND orders_count > 0))
ORDER BY c.id_customer DESC
LIMIT :limit$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'limit',50,
         'date_from',NULL,
         'date_to',NULL,
         'segment',NULL,
         'subscribed',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.customers.list';

  -- psdb.customers.search
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  c.id_customer,
  c.email,
  c.firstname,
  c.lastname,
  c.date_add,
  c.newsletter,
  c.active
FROM {{prefix}}customer c
WHERE (:id IS NULL OR c.id_customer = :id)
  AND (:email IS NULL OR c.email LIKE CONCAT('%', :email, '%'))
  AND (
    :name IS NULL
    OR CONCAT(c.firstname, ' ', c.lastname) LIKE CONCAT('%', :name, '%')
    OR c.firstname LIKE CONCAT('%', :name, '%')
    OR c.lastname LIKE CONCAT('%', :name, '%')
  )
ORDER BY c.id_customer DESC
LIMIT :limit$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'id',NULL,
         'name',NULL,
         'email',NULL,
         'limit',50,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.customers.search';

  -- psdb.customers.get
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', jsonb_build_array(
         $$SELECT
  c.id_customer,
  c.email,
  c.firstname,
  c.lastname,
  c.date_add,
  c.newsletter,
  c.active
FROM {{prefix}}customer c
WHERE (:id IS NOT NULL AND c.id_customer = :id)
   OR (:email IS NOT NULL AND c.email = :email)
LIMIT 1$$,
         $$SELECT
  o.id_order,
  o.reference,
  o.current_state AS state_id,
  o.id_shop,
  o.date_add,
  o.total_paid_tax_incl
FROM {{prefix}}orders o
WHERE o.id_customer = (
  SELECT c2.id_customer FROM {{prefix}}customer c2
   WHERE (:id IS NOT NULL AND c2.id_customer = :id)
      OR (:email IS NOT NULL AND c2.email = :email)
   LIMIT 1
)
ORDER BY o.id_order DESC
LIMIT :limit_orders$$,
         $$SELECT
  a.id_address,
  a.alias,
  a.firstname,
  a.lastname,
  a.company,
  a.vat_number,
  a.address1,
  a.address2,
  a.postcode,
  a.city,
  a.phone,
  a.phone_mobile
FROM {{prefix}}address a
WHERE a.id_customer = (
  SELECT c2.id_customer FROM {{prefix}}customer c2
   WHERE (:id IS NOT NULL AND c2.id_customer = :id)
      OR (:email IS NOT NULL AND c2.email = :email)
   LIMIT 1
)
  AND a.deleted = 0
ORDER BY a.id_address DESC
LIMIT 50$$
       ),
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'id',NULL,
         'email',NULL,
         'limit_orders',50,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.customers.get';

  -- psdb.customers.update
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$UPDATE {{prefix}}customer
SET
  newsletter = COALESCE(:newsletter, newsletter),
  active = COALESCE(:active, active)
WHERE ((:id IS NOT NULL AND id_customer = :id) OR (:email IS NOT NULL AND email = :email))
LIMIT 1$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'id',NULL,
         'email',NULL,
         'newsletter',NULL,
         'active',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.customers.update';

  -- psdb.orders.list (refresh / normalize)
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
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
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.orders.list';

  -- psdb.orders.search
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
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
WHERE (:id IS NULL OR o.id_order = :id)
  AND (:reference IS NULL OR o.reference = :reference)
  AND (:customer_email IS NULL OR c.email = :customer_email)
  AND (:date_from IS NULL OR o.date_add >= :date_from)
  AND (:date_to IS NULL OR o.date_add <= :date_to)
ORDER BY o.id_order DESC
LIMIT :limit$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'id',NULL,
         'reference',NULL,
         'customer_email',NULL,
         'date_from',NULL,
         'date_to',NULL,
         'limit',20,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.orders.search';

  -- psdb.orders.get
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', jsonb_build_array(
         $$SELECT
  o.id_order,
  o.reference,
  o.current_state AS state_id,
  o.id_shop,
  o.date_add,
  o.total_paid_tax_incl,
  o.total_paid_tax_excl,
  o.total_products_wt,
  o.id_customer,
  c.email AS customer_email,
  c.firstname,
  c.lastname
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}customer c ON c.id_customer = o.id_customer
WHERE (:id IS NOT NULL AND o.id_order = :id)
   OR (:reference IS NOT NULL AND o.reference = :reference)
LIMIT 1$$,
         $$SELECT
  od.id_order_detail,
  od.product_id AS id_product,
  od.product_attribute_id AS id_product_attribute,
  od.product_name,
  od.product_quantity,
  od.unit_price_tax_incl,
  od.total_price_tax_incl,
  p.reference
FROM {{prefix}}order_detail od
LEFT JOIN {{prefix}}product p ON p.id_product = od.product_id
WHERE od.id_order = (
  SELECT o2.id_order FROM {{prefix}}orders o2
   WHERE (:id IS NOT NULL AND o2.id_order = :id)
      OR (:reference IS NOT NULL AND o2.reference = :reference)
   LIMIT 1
)
ORDER BY od.id_order_detail ASC$$
       ),
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'id',NULL,
         'reference',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.orders.get';

  -- psdb.orders.update_status
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', jsonb_build_array(
         $$INSERT INTO {{prefix}}order_history (id_employee, id_order, id_order_state, date_add)
VALUES (0, :id_order, :state_id, NOW())$$,
         $$UPDATE {{prefix}}orders
SET current_state = :state_id
WHERE id_order = :id_order
LIMIT 1$$
       ),
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'id_order',NULL,
         'state_id',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.orders.update_status';

  -- psdb.analytics.best_sellers (refresh / normalize)
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
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
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.analytics.best_sellers';

  -- psdb.analytics.sales_report
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  CASE
    WHEN :period = 'week' THEN CONCAT(YEAR(o.date_add), '-W', LPAD(WEEK(o.date_add, 1), 2, '0'))
    WHEN :period = 'month' THEN DATE_FORMAT(o.date_add, '%Y-%m')
    ELSE DATE_FORMAT(o.date_add, '%Y-%m-%d')
  END AS bucket,
  COUNT(*) AS orders_count,
  SUM(o.total_paid_tax_incl) AS total_paid_tax_incl
FROM {{prefix}}orders o
WHERE (:date_from IS NULL OR o.date_add >= :date_from)
  AND (:date_to IS NULL OR o.date_add <= :date_to)
  AND o.valid = 1
GROUP BY bucket
ORDER BY bucket ASC$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'period','day',
         'date_from',NULL,
         'date_to',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.analytics.sales_report';

  -- psdb.analytics.clv
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  c.id_customer,
  c.email,
  c.firstname,
  c.lastname,
  COUNT(o.id_order) AS orders_count,
  SUM(o.total_paid_tax_incl) AS total_spent,
  MIN(o.date_add) AS first_order_at,
  MAX(o.date_add) AS last_order_at
FROM {{prefix}}customer c
JOIN {{prefix}}orders o ON o.id_customer = c.id_customer
WHERE (:date_from IS NULL OR o.date_add >= :date_from)
  AND (:date_to IS NULL OR o.date_add <= :date_to)
  AND o.valid = 1
GROUP BY c.id_customer, c.email, c.firstname, c.lastname
ORDER BY total_spent DESC
LIMIT :limit$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'limit',20,
         'date_from',NULL,
         'date_to',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.analytics.clv';

  -- psdb.order_state_lang.list
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  osl.id_order_state,
  osl.id_lang,
  osl.name
FROM {{prefix}}order_state_lang osl
WHERE (:id_lang IS NULL OR osl.id_lang = :id_lang)
  AND (:id_order_state IS NULL OR osl.id_order_state = :id_order_state)
  AND (:name_like IS NULL OR osl.name LIKE CONCAT('%', :name_like, '%'))
ORDER BY
  CASE WHEN :order='asc' THEN osl.name END ASC,
  CASE WHEN :order='desc' THEN osl.name END DESC
LIMIT :limit$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'limit',200,
         'order','asc',
         'id_lang',NULL,
         'id_order_state',NULL,
         'name_like',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.order_state_lang.list';

  -- psdb.order_state_lang.get
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  osl.id_order_state,
  osl.id_lang,
  osl.name
FROM {{prefix}}order_state_lang osl
WHERE osl.id_order_state = :id_order_state
  AND (:id_lang IS NULL OR osl.id_lang = :id_lang)
ORDER BY osl.id_lang ASC$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'id_order_state',NULL,
         'id_lang',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.order_state_lang.get';

  -- psdb.order_states.labels
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  os.id_order_state,
  os.delivery,
  os.shipped,
  os.paid,
  os.logable,
  os.invoice,
  os.color,
  os.hidden,
  os.unremovable,
  osl.id_lang,
  osl.name
FROM {{prefix}}order_state os
JOIN {{prefix}}order_state_lang osl ON osl.id_order_state = os.id_order_state
WHERE (:id_lang IS NULL OR osl.id_lang = :id_lang)
  AND (:id_order_state IS NULL OR os.id_order_state = :id_order_state)
  AND (:name_like IS NULL OR osl.name LIKE CONCAT('%', :name_like, '%'))
ORDER BY
  CASE WHEN :order='asc' THEN osl.name END ASC,
  CASE WHEN :order='desc' THEN osl.name END DESC
LIMIT :limit$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'limit',500,
         'order','asc',
         'id_lang',NULL,
         'id_order_state',NULL,
         'name_like',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.order_states.labels';

  -- psdb.stock.get
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  p.id_product,
  p.reference,
  pl.name,
  sa.quantity AS stock_quantity
FROM {{prefix}}product p
JOIN {{prefix}}stock_available sa
  ON sa.id_product = p.id_product AND sa.id_product_attribute = 0
LEFT JOIN {{prefix}}product_lang pl
  ON pl.id_product = p.id_product AND pl.id_lang = :id_lang
WHERE (:product_id IS NULL OR p.id_product = :product_id)
  AND (:category_id IS NULL OR EXISTS (
    SELECT 1 FROM {{prefix}}category_product cp
     WHERE cp.id_product = p.id_product
       AND cp.id_category = :category_id
  ))
ORDER BY p.id_product DESC
LIMIT :limit$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'limit',200,
         'id_lang',1,
         'product_id',NULL,
         'category_id',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.stock.get';

  -- psdb.stock.low
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  p.id_product,
  p.reference,
  pl.name,
  sa.quantity AS stock_quantity
FROM {{prefix}}product p
JOIN {{prefix}}stock_available sa
  ON sa.id_product = p.id_product AND sa.id_product_attribute = 0
LEFT JOIN {{prefix}}product_lang pl
  ON pl.id_product = p.id_product AND pl.id_lang = :id_lang
WHERE sa.quantity <= :threshold
ORDER BY sa.quantity ASC
LIMIT :limit$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'limit',50,
         'id_lang',1,
         'threshold',5,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.stock.low';

  -- psdb.stock.update
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$UPDATE {{prefix}}stock_available
SET quantity = CASE
  WHEN :mode IN ('delta') THEN quantity + :quantity
  WHEN :mode IN ('increment') THEN quantity + ABS(:quantity)
  WHEN :mode IN ('decrement') THEN quantity - ABS(:quantity)
  ELSE :quantity
END
WHERE id_product = :product_id
  AND id_product_attribute = COALESCE(:product_attribute_id, 0)
LIMIT 1$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'mode','set',
         'product_id',NULL,
         'product_attribute_id',NULL,
         'quantity',NULL,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.stock.update';

  -- psdb.carts.abandoned
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver','mysql',
       'sql', $$SELECT
  c.id_cart,
  c.id_customer,
  c.id_guest,
  c.id_shop,
  c.date_add,
  c.date_upd
FROM {{prefix}}cart c
LEFT JOIN {{prefix}}orders o ON o.id_cart = c.id_cart
WHERE o.id_order IS NULL
  AND c.date_add < (NOW() - INTERVAL :minutes_ago MINUTE)
ORDER BY c.date_add DESC
LIMIT :limit$$,
       'parameters', jsonb_build_object(
         'prefix','ps_',
         'limit',50,
         'minutes_ago',60,
         'debug',false
       )
     ),
     updated_at = NOW()
   WHERE name = 'psdb.carts.abandoned';
END $mcp2_seed_suite$;

-- down
-- Non-destructive: keep tool definitions.
