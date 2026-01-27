-- Add executable PostgreSQL SQL to grabbing-zasilkovna MCP2 tools
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
  (:name IS NULL)
  OR (recipient_name ILIKE '%' || :name || '%')
  OR (recipient_surname ILIKE '%' || :name || '%')
ORDER BY consigned_date DESC NULLS LAST, updated_at DESC
LIMIT :limit
$$,
       'parameters', jsonb_build_object('name', NULL, 'limit', 5, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_a001831ff5d7a7';

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
  (:id_order IS NULL)
  OR (order_raw = :id_order)
  OR (id_order::TEXT = :id_order::TEXT)
ORDER BY consigned_date DESC NULLS LAST, updated_at DESC
LIMIT :limit
$$,
       'parameters', jsonb_build_object('id_order', NULL, 'limit', 5, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_c838ab19f5d7ac';

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
  (:email IS NULL)
  OR (email ILIKE '%' || :email || '%')
ORDER BY consigned_date DESC NULLS LAST, updated_at DESC
LIMIT :limit
$$,
       'parameters', jsonb_build_object('email', NULL, 'limit', 5, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_1d982052f5d7b0';

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
WHERE packet_id = :packet_id
ORDER BY status_at DESC NULLS LAST
LIMIT :limit
$$,
       'parameters', jsonb_build_object('packet_id', NULL, 'limit', 1, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_0aeb041af5d7a9';

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
WHERE packet_id = :packet_id
ORDER BY delivered_on DESC NULLS LAST
LIMIT :limit
$$,
       'parameters', jsonb_build_object('packet_id', NULL, 'limit', 1, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_e93dc4ecf5d7a2';

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
  (:surname IS NULL)
  OR (recipient_surname ILIKE '%' || :surname || '%')
ORDER BY consigned_date DESC NULLS LAST, updated_at DESC
LIMIT :limit
$$,
       'parameters', jsonb_build_object('surname', NULL, 'limit', 5, 'debug', false)
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_ddcf2790f5d7a6';
END $body$;
