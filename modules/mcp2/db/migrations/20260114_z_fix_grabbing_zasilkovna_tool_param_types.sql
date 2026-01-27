-- Fix PostgreSQL parameter type inference for named params used in IS NULL + ILIKE patterns
DO $body$
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  -- postgresql.get_packetid_by_name
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'postgresql',
       'sql', $$
SELECT
  packet_id,
  order_raw,
  id_order,
  recipient_name,
  recipient_surname,
  name,
  surname,
  tracking_packeta_url,
  tracking_external_url,
  status,
  consigned_date,
  updated_at
FROM public.mod_grabbing_zasilkovna
WHERE
  (:name::text IS NULL OR :name::text = '')
  OR (recipient_name ILIKE '%' || :name::text || '%')
  OR (recipient_surname ILIKE '%' || :name::text || '%')
ORDER BY consigned_date DESC NULLS LAST, updated_at DESC
LIMIT :limit
$$,
       'parameters', jsonb_build_object('name', NULL, 'limit', 5, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_a001831ff5d7a7';

  -- postgresql.get_packetid_by_id_order
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'postgresql',
       'sql', $$
SELECT
  packet_id,
  order_raw,
  id_order,
  recipient_name,
  recipient_surname,
  tracking_packeta_url,
  tracking_external_url,
  status,
  consigned_date,
  updated_at
FROM public.mod_grabbing_zasilkovna
WHERE
  (:id_order::text IS NULL OR :id_order::text = '')
  OR (order_raw = :id_order::text)
  OR (id_order::text = :id_order::text)
ORDER BY consigned_date DESC NULLS LAST, updated_at DESC
LIMIT :limit
$$,
       'parameters', jsonb_build_object('id_order', NULL, 'limit', 5, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_c838ab19f5d7ac';

  -- postgresql.get_packetid_by_email (search both email + customer_email)
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'postgresql',
       'sql', $$
SELECT
  packet_id,
  order_raw,
  id_order,
  recipient_name,
  recipient_surname,
  email,
  tracking_packeta_url,
  tracking_external_url,
  status,
  consigned_date,
  updated_at
FROM public.mod_grabbing_zasilkovna
WHERE
  (:email::text IS NULL OR :email::text = '')
  OR (email ILIKE '%' || :email::text || '%')
  OR (customer_email ILIKE '%' || :email::text || '%')
ORDER BY consigned_date DESC NULLS LAST, updated_at DESC
LIMIT :limit
$$,
       'parameters', jsonb_build_object('email', NULL, 'limit', 5, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_1d982052f5d7b0';

  -- postgresql.get_packetid_by_surname
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'postgresql',
       'sql', $$
SELECT
  packet_id,
  order_raw,
  id_order,
  recipient_name,
  recipient_surname,
  tracking_packeta_url,
  tracking_external_url,
  status,
  consigned_date,
  updated_at
FROM public.mod_grabbing_zasilkovna
WHERE
  (:surname::text IS NULL OR :surname::text = '')
  OR (recipient_surname ILIKE '%' || :surname::text || '%')
ORDER BY consigned_date DESC NULLS LAST, updated_at DESC
LIMIT :limit
$$,
       'parameters', jsonb_build_object('surname', NULL, 'limit', 5, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_ddcf2790f5d7a6';

  -- postgresql.get_status_by_packetid (cast packet_id defensively)
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'postgresql',
       'sql', $$
SELECT
  packet_id,
  status_code,
  code_text,
  status_text,
  status_at,
  raw_xml,
  org_id
FROM public.mod_grabbing_zasilkovna_status
WHERE packet_id = :packet_id::text
ORDER BY status_at DESC NULLS LAST
LIMIT :limit
$$,
       'parameters', jsonb_build_object('packet_id', NULL, 'limit', 1, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_0aeb041af5d7a9';

  -- postgresql.get_date_of_delivery_by_packetid (cast packet_id defensively)
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'postgresql',
       'sql', $$
SELECT
  packet_id,
  delivered_on,
  consigned_date,
  updated_at
FROM public.mod_grabbing_zasilkovna
WHERE packet_id = :packet_id::text
ORDER BY delivered_on DESC NULLS LAST
LIMIT :limit
$$,
       'parameters', jsonb_build_object('packet_id', NULL, 'limit', 1, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_e93dc4ecf5d7a2';
END $body$;

