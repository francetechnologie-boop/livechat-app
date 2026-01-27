-- Extend status tool to include packet master data for richer response
DO $body$
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'postgresql',
       'sql', $$
SELECT
  s.packet_id,
  s.status_code,
  s.code_text,
  s.status_text,
  s.status_at,
  s.raw_xml,
  z.submission_number,
  z.order_raw,
  z.id_order,
  z.recipient_name,
  z.recipient_surname,
  z.name AS customer_name,
  z.surname AS customer_surname,
  z.email,
  z.phone,
  z.carrier,
  z.packet_price,
  z.created_at AS packet_created_at,
  z.updated_at AS packet_updated_at,
  z.consigned_date,
  z.delivered_on,
  z.tracking_packeta_url,
  z.tracking_external_url
FROM public.mod_grabbing_zasilkovna_status s
JOIN public.mod_grabbing_zasilkovna z USING (packet_id)
WHERE s.packet_id = :packet_id::text
ORDER BY s.status_at DESC
LIMIT :limit
$$,
       'parameters', jsonb_build_object('packet_id', NULL, 'limit', 1, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_0aeb041af5d7a9';
END $body$;

