-- up
-- Fix DHL/Presta MCP2 tool definitions after initial deployment:
-- - Remove orders.shipping_number from SQL (not present in some Presta versions)
-- - Make dhl_profile_id optional for dhl.presta.order.track (server provides origin_profile_id)
-- Europe/Prague date: 2026-01-17
DO $mcp2_fix_dhl_presta_tools$
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  -- dhl.presta.order_tracking_numbers (remove o.shipping_number)
  BEGIN
    UPDATE public.mod_mcp2_tool
       SET description = COALESCE(NULLIF(description,''), 'Get tracking numbers for an order from Presta (order_carrier.tracking_number).'),
           code = CASE
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
  EXCEPTION WHEN others THEN NULL;
  END;

  -- dhl.presta.orders.find (remove o.shipping_number)
  BEGIN
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
  EXCEPTION WHEN others THEN NULL;
  END;

  -- dhl.presta.order.track: make dhl_profile_id optional in input_schema
  BEGIN
    UPDATE public.mod_mcp2_tool
       SET input_schema = jsonb_set(
          COALESCE(input_schema, '{}'::jsonb),
          '{required}',
          to_jsonb(ARRAY['id_order']::text[]),
          true
       ),
       updated_at = NOW()
     WHERE lower(name) = lower('dhl.presta.order.track');
  EXCEPTION WHEN others THEN NULL;
  END;
END $mcp2_fix_dhl_presta_tools$;

-- down
-- Non-destructive.

