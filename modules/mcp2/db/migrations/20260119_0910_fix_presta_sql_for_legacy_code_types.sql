-- up
-- Force-fix DHL Presta SQL tools even on legacy installs where mod_mcp2_tool.code is TEXT/JSON (not JSONB).
-- Europe/Prague date: 2026-01-19
DO $mcp2_fix_dhl_presta_legacy_code_types$
DECLARE
  code_type_tool TEXT := NULL;
  code_type_server_tool TEXT := NULL;
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Detect column types (older installs may have TEXT)
  BEGIN
    SELECT COALESCE(NULLIF(data_type,''), udt_name) INTO code_type_tool
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_mcp2_tool' AND column_name='code'
     LIMIT 1;
  EXCEPTION WHEN others THEN code_type_tool := NULL;
  END;

  BEGIN
    IF to_regclass('public.mod_mcp2_server_tool') IS NOT NULL THEN
      SELECT COALESCE(NULLIF(data_type,''), udt_name) INTO code_type_server_tool
        FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mod_mcp2_server_tool' AND column_name='code'
       LIMIT 1;
    END IF;
  EXCEPTION WHEN others THEN code_type_server_tool := NULL;
  END;

  -- Helper updates for mod_mcp2_tool
  BEGIN
    IF lower(COALESCE(code_type_tool,'')) IN ('jsonb') THEN
      UPDATE public.mod_mcp2_tool
         SET code = CASE
               WHEN code IS NULL THEN code
               ELSE jsonb_set(code, '{sql}', to_jsonb($sql_order_tn$SELECT
  o.id_order,
  o.reference,
  oc.tracking_number
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}order_carrier oc ON oc.id_order = o.id_order
WHERE o.id_order = :id_order
ORDER BY oc.id_order_carrier DESC
LIMIT 5$sql_order_tn$), true)
             END,
             updated_at = NOW()
       WHERE lower(name) = lower('dhl.presta.order_tracking_numbers');

      UPDATE public.mod_mcp2_tool
         SET code = CASE
               WHEN code IS NULL THEN code
               ELSE jsonb_set(code, '{sql}', to_jsonb($sql_find_orders$SELECT
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
LIMIT :limit$sql_find_orders$), true)
             END,
             updated_at = NOW()
       WHERE lower(name) = lower('dhl.presta.orders.find');

    ELSIF lower(COALESCE(code_type_tool,'')) IN ('json') THEN
      UPDATE public.mod_mcp2_tool
         SET code = CASE
               WHEN code IS NULL THEN code
               ELSE (jsonb_set(code::jsonb, '{sql}', to_jsonb($sql_order_tn$SELECT
  o.id_order,
  o.reference,
  oc.tracking_number
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}order_carrier oc ON oc.id_order = o.id_order
WHERE o.id_order = :id_order
ORDER BY oc.id_order_carrier DESC
LIMIT 5$sql_order_tn$), true))::json
             END,
             updated_at = NOW()
       WHERE lower(name) = lower('dhl.presta.order_tracking_numbers');

      UPDATE public.mod_mcp2_tool
         SET code = CASE
               WHEN code IS NULL THEN code
               ELSE (jsonb_set(code::jsonb, '{sql}', to_jsonb($sql_find_orders$SELECT
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
LIMIT :limit$sql_find_orders$), true))::json
             END,
             updated_at = NOW()
       WHERE lower(name) = lower('dhl.presta.orders.find');

    ELSE
      -- TEXT/varchar legacy: cast to jsonb and back to text
      UPDATE public.mod_mcp2_tool
         SET code = CASE
               WHEN code IS NULL THEN code
               ELSE (jsonb_set(code::jsonb, '{sql}', to_jsonb($sql_order_tn$SELECT
  o.id_order,
  o.reference,
  oc.tracking_number
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}order_carrier oc ON oc.id_order = o.id_order
WHERE o.id_order = :id_order
ORDER BY oc.id_order_carrier DESC
LIMIT 5$sql_order_tn$), true))::text
             END,
             updated_at = NOW()
       WHERE lower(name) = lower('dhl.presta.order_tracking_numbers');

      UPDATE public.mod_mcp2_tool
         SET code = CASE
               WHEN code IS NULL THEN code
               ELSE (jsonb_set(code::jsonb, '{sql}', to_jsonb($sql_find_orders$SELECT
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
LIMIT :limit$sql_find_orders$), true))::text
             END,
             updated_at = NOW()
       WHERE lower(name) = lower('dhl.presta.orders.find');
    END IF;
  EXCEPTION WHEN others THEN NULL;
  END;

  -- Also patch server-scoped copies if they exist (some installs execute from mod_mcp2_server_tool)
  BEGIN
    IF to_regclass('public.mod_mcp2_server_tool') IS NOT NULL THEN
      IF lower(COALESCE(code_type_server_tool,'')) IN ('jsonb') THEN
        UPDATE public.mod_mcp2_server_tool
           SET code = CASE
                 WHEN code IS NULL THEN code
                 ELSE jsonb_set(code, '{sql}', to_jsonb($sql_order_tn$SELECT
  o.id_order,
  o.reference,
  oc.tracking_number
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}order_carrier oc ON oc.id_order = o.id_order
WHERE o.id_order = :id_order
ORDER BY oc.id_order_carrier DESC
LIMIT 5$sql_order_tn$), true)
               END,
               updated_at = NOW()
         WHERE lower(name) = lower('dhl.presta.order_tracking_numbers');

        UPDATE public.mod_mcp2_server_tool
           SET code = CASE
                 WHEN code IS NULL THEN code
                 ELSE jsonb_set(code, '{sql}', to_jsonb($sql_find_orders$SELECT
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
LIMIT :limit$sql_find_orders$), true)
               END,
               updated_at = NOW()
         WHERE lower(name) = lower('dhl.presta.orders.find');

      ELSIF lower(COALESCE(code_type_server_tool,'')) IN ('json') THEN
        UPDATE public.mod_mcp2_server_tool
           SET code = CASE
                 WHEN code IS NULL THEN code
                 ELSE (jsonb_set(code::jsonb, '{sql}', to_jsonb($sql_order_tn$SELECT
  o.id_order,
  o.reference,
  oc.tracking_number
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}order_carrier oc ON oc.id_order = o.id_order
WHERE o.id_order = :id_order
ORDER BY oc.id_order_carrier DESC
LIMIT 5$sql_order_tn$), true))::json
               END,
               updated_at = NOW()
         WHERE lower(name) = lower('dhl.presta.order_tracking_numbers');

        UPDATE public.mod_mcp2_server_tool
           SET code = CASE
                 WHEN code IS NULL THEN code
                 ELSE (jsonb_set(code::jsonb, '{sql}', to_jsonb($sql_find_orders$SELECT
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
LIMIT :limit$sql_find_orders$), true))::json
               END,
               updated_at = NOW()
         WHERE lower(name) = lower('dhl.presta.orders.find');

      ELSE
        UPDATE public.mod_mcp2_server_tool
           SET code = CASE
                 WHEN code IS NULL THEN code
                 ELSE (jsonb_set(code::jsonb, '{sql}', to_jsonb($sql_order_tn$SELECT
  o.id_order,
  o.reference,
  oc.tracking_number
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}order_carrier oc ON oc.id_order = o.id_order
WHERE o.id_order = :id_order
ORDER BY oc.id_order_carrier DESC
LIMIT 5$sql_order_tn$), true))::text
               END,
               updated_at = NOW()
         WHERE lower(name) = lower('dhl.presta.order_tracking_numbers');

        UPDATE public.mod_mcp2_server_tool
           SET code = CASE
                 WHEN code IS NULL THEN code
                 ELSE (jsonb_set(code::jsonb, '{sql}', to_jsonb($sql_find_orders$SELECT
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
LIMIT :limit$sql_find_orders$), true))::text
               END,
               updated_at = NOW()
         WHERE lower(name) = lower('dhl.presta.orders.find');
      END IF;
    END IF;
  EXCEPTION WHEN others THEN NULL;
  END;
END $mcp2_fix_dhl_presta_legacy_code_types$;

-- down
-- Non-destructive.
