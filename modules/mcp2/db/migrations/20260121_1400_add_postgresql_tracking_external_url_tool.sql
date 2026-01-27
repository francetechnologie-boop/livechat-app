-- up
-- Add a convenience tool:
--   postgresql.get_tracking_external_url_by_recipient_name_recipient_surname_email_id_order_customer_email
-- Europe/Prague date: 2026-01-21
DO $mcp2_add_pg_tracking_external_url$
DECLARE
  v_type_id TEXT := NULL;
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Resolve PostgreSQL type id (prefer explicit DB_postgresql / postgresql code/name).
  IF to_regclass('public.mod_mcp2_type') IS NOT NULL THEN
    SELECT id INTO v_type_id
      FROM public.mod_mcp2_type
     WHERE lower(code) IN ('db_postgresql', 'postgresql', 'db_postgres', 'postgres')
        OR lower(name) IN ('db_postgresql', 'postgresql', 'db_postgres', 'postgres')
     ORDER BY (CASE WHEN lower(code)='db_postgresql' THEN 0 WHEN lower(code)='postgresql' THEN 1 ELSE 2 END),
              updated_at DESC NULLS LAST
     LIMIT 1;

    -- Ensure tool_prefix is set for easier auto-linking of postgresql.* tools.
    IF v_type_id IS NOT NULL THEN
      UPDATE public.mod_mcp2_type
         SET tool_prefix = 'postgresql',
             updated_at = NOW()
       WHERE id = v_type_id
         AND (tool_prefix IS NULL OR btrim(tool_prefix) = '');
    END IF;
  END IF;

  WITH defs AS (
    SELECT
      'postgresql.get_tracking_external_url_by_recipient_name_recipient_surname_email_id_order_customer_email'::text AS name,
      'Find Packeta/Zasilkovna tracking_external_url using recipient name/surname, email/customer_email, and/or id_order. Returns best matches ordered by score.'::text AS description,
      jsonb_build_object(
        'type','object',
        'properties', jsonb_build_object(
          'recipient_name', jsonb_build_object('type','string','description','Recipient first name (optional)'),
          'recipient_surname', jsonb_build_object('type','string','description','Recipient last name (optional)'),
          'email', jsonb_build_object('type','string','description','Recipient email (optional)'),
          'customer_email', jsonb_build_object('type','string','description','Customer email (optional)'),
          'id_order', jsonb_build_object('type','string','description','Order identifier (matches order_raw/id_order)'),
          'limit', jsonb_build_object('type','integer','default',5,'minimum',1,'maximum',50,'description','Max rows')
        ),
        'anyOf', jsonb_build_array(
          jsonb_build_object('required', jsonb_build_array('id_order')),
          jsonb_build_object('required', jsonb_build_array('email')),
          jsonb_build_object('required', jsonb_build_array('customer_email')),
          jsonb_build_object('required', jsonb_build_array('recipient_name')),
          jsonb_build_object('required', jsonb_build_array('recipient_surname'))
        )
      ) AS input_schema,
      jsonb_build_object(
        'driver','postgresql',
        'sql', $$
WITH params AS (
  SELECT
    NULLIF(btrim(:recipient_name::text), '') AS recipient_name,
    NULLIF(btrim(:recipient_surname::text), '') AS recipient_surname,
    NULLIF(btrim(:email::text), '') AS email,
    NULLIF(btrim(:customer_email::text), '') AS customer_email,
    NULLIF(btrim(:id_order::text), '') AS id_order,
    GREATEST(1, LEAST(COALESCE(:limit::int, 5), 50)) AS lim
),
q AS (
  SELECT
    z.packet_id,
    z.order_raw,
    z.id_order,
    z.recipient_name,
    z.recipient_surname,
    z.email,
    z.customer_email,
    z.tracking_packeta_url,
    z.tracking_external_url,
    z.status,
    z.consigned_date,
    z.delivered_on,
    z.updated_at,
    (
      CASE WHEN p.id_order IS NOT NULL AND (z.order_raw = p.id_order OR z.id_order::text = p.id_order) THEN 8 ELSE 0 END +
      CASE WHEN p.customer_email IS NOT NULL AND z.customer_email ILIKE '%' || p.customer_email || '%' THEN 4 ELSE 0 END +
      CASE WHEN p.email IS NOT NULL AND z.email ILIKE '%' || p.email || '%' THEN 4 ELSE 0 END +
      CASE WHEN p.recipient_surname IS NOT NULL AND z.recipient_surname ILIKE '%' || p.recipient_surname || '%' THEN 2 ELSE 0 END +
      CASE WHEN p.recipient_name IS NOT NULL AND z.recipient_name ILIKE '%' || p.recipient_name || '%' THEN 2 ELSE 0 END
    ) AS score
  FROM public.mod_grabbing_zasilkovna z
  CROSS JOIN params p
  WHERE (
    p.id_order IS NOT NULL
    OR p.customer_email IS NOT NULL
    OR p.email IS NOT NULL
    OR p.recipient_name IS NOT NULL
    OR p.recipient_surname IS NOT NULL
  )
  AND (
    (p.id_order IS NOT NULL AND (z.order_raw = p.id_order OR z.id_order::text = p.id_order))
    OR (p.customer_email IS NOT NULL AND z.customer_email ILIKE '%' || p.customer_email || '%')
    OR (p.email IS NOT NULL AND z.email ILIKE '%' || p.email || '%')
    OR (p.recipient_name IS NOT NULL AND z.recipient_name ILIKE '%' || p.recipient_name || '%')
    OR (p.recipient_surname IS NOT NULL AND z.recipient_surname ILIKE '%' || p.recipient_surname || '%')
  )
)
SELECT *
  FROM q
 ORDER BY score DESC, consigned_date DESC NULLS LAST, updated_at DESC NULLS LAST
 LIMIT (SELECT lim FROM params)
$$,
        'parameters', jsonb_build_object(
          'recipient_name', NULL,
          'recipient_surname', NULL,
          'email', NULL,
          'customer_email', NULL,
          'id_order', NULL,
          'limit', 5,
          'debug', false
        )
      ) AS code
  ),
  upd AS (
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
    'm2tool_builtin_pg_tracking_external_url'::text AS id,
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

  -- Link tool to PostgreSQL type when type exists
  IF to_regclass('public.mod_mcp2_type_tool') IS NOT NULL AND to_regclass('public.mod_mcp2_type') IS NOT NULL THEN
    IF v_type_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.mod_mcp2_type WHERE id = v_type_id) THEN
      INSERT INTO public.mod_mcp2_type_tool (type_id, tool_id, created_at, org_id)
      SELECT v_type_id, t.id, NOW(), NULL
        FROM public.mod_mcp2_tool t
       WHERE lower(t.name) = lower('postgresql.get_tracking_external_url_by_recipient_name_recipient_surname_email_id_order_customer_email')
      ON CONFLICT (type_id, tool_id) DO NOTHING;
    END IF;
  END IF;
END $mcp2_add_pg_tracking_external_url$;

-- down
-- Non-destructive.

