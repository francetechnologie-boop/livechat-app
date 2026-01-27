-- up
-- Update tool:
--   postgresql.get_tracking_external_url_by_id_order
-- To return ONLY mod_grabbing_zasilkovna.tracking_external_url (first/best match) for an id_order.
-- Europe/Prague date: 2026-01-25
DO $mcp2_upd_pg_tracking_external_url_by_id_order$
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.mod_mcp2_tool
     SET description = 'Retourne uniquement tracking_external_url (1 ligne) pour un id_order depuis mod_grabbing_zasilkovna.',
         input_schema = jsonb_build_object(
           'type','object',
           'required', jsonb_build_array('id_order'),
           'properties', jsonb_build_object(
             'id_order', jsonb_build_object('type','string','description','Order identifier (matches order_raw/id_order)')
           )
         ),
         code = jsonb_build_object(
           'driver','postgresql',
           'sql', $$
WITH params AS (
  SELECT NULLIF(btrim(:id_order::text), '') AS id_order
)
SELECT NULLIF(btrim(to_jsonb(z)->>'tracking_external_url'), '') AS tracking_external_url
  FROM public.mod_grabbing_zasilkovna z
 CROSS JOIN params p
 WHERE p.id_order IS NOT NULL
   AND (z.order_raw = p.id_order OR z.id_order::text = p.id_order)
   AND NULLIF(btrim(to_jsonb(z)->>'tracking_external_url'), '') IS NOT NULL
 ORDER BY z.consigned_date DESC NULLS LAST, z.updated_at DESC NULLS LAST
 LIMIT 1
$$,
           'parameters', jsonb_build_object(
             'id_order', NULL,
             'debug', false
           )
         ),
         updated_at = NOW()
   WHERE lower(name) = lower('postgresql.get_tracking_external_url_by_id_order');
END
$mcp2_upd_pg_tracking_external_url_by_id_order$;

-- down
-- Non-destructive.

