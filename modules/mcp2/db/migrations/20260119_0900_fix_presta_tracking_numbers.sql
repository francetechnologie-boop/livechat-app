-- up
-- Remove the missing orders.shipping_number reference from the DHL Presta order tracking tool
-- Europe/Prague date: 2026-01-19
DO $mcp2_fix_dhl_presta_order_tracking_numbers$
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    UPDATE public.mod_mcp2_tool
       SET code = CASE
             WHEN code IS NULL THEN code
             ELSE jsonb_set(
               code,
               '{sql}',
               to_jsonb($sql_order_tn$SELECT
  o.id_order,
  o.reference,
  oc.tracking_number
FROM {{prefix}}orders o
LEFT JOIN {{prefix}}order_carrier oc ON oc.id_order = o.id_order
WHERE o.id_order = :id_order
ORDER BY oc.id_order_carrier DESC
LIMIT 5$sql_order_tn$),
               true
             )
           END,
           updated_at = NOW()
     WHERE lower(name) = lower('dhl.presta.order_tracking_numbers');
  EXCEPTION WHEN others THEN NULL;
  END;
END $mcp2_fix_dhl_presta_order_tracking_numbers$;

-- down
-- Non-destructive.
