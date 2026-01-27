-- up
-- Update psdb.chatlive.carrier.list to support search by reference/company/firstname/lastname/email and return id_order
-- Europe/Prague date: 2026-01-21
DO $mcp2_update_psdb_chatlive_get_carrier$
DECLARE
  code_type_tool TEXT := NULL;
  input_type_tool TEXT := NULL;
  code_expr TEXT := NULL;
  input_expr TEXT := NULL;
  sql_template TEXT := NULL;
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Detect column types (older installs may have TEXT/JSON)
  BEGIN
    SELECT COALESCE(NULLIF(data_type,''), udt_name) INTO code_type_tool
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_mcp2_tool' AND column_name='code'
     LIMIT 1;
  EXCEPTION WHEN others THEN code_type_tool := NULL;
  END;

  BEGIN
    SELECT COALESCE(NULLIF(data_type,''), udt_name) INTO input_type_tool
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_mcp2_tool' AND column_name='input_schema'
     LIMIT 1;
  EXCEPTION WHEN others THEN input_type_tool := NULL;
  END;

  input_expr := CASE
    WHEN lower(COALESCE(input_type_tool,'')) IN ('jsonb') THEN 'd.input_schema'
    WHEN lower(COALESCE(input_type_tool,'')) IN ('json') THEN 'd.input_schema::json'
    ELSE 'd.input_schema::text'
  END;
  code_expr := CASE
    WHEN lower(COALESCE(code_type_tool,'')) IN ('jsonb') THEN 'd.code'
    WHEN lower(COALESCE(code_type_tool,'')) IN ('json') THEN 'd.code::json'
    ELSE 'd.code::text'
  END;

  sql_template := $mcp2_sql$
    WITH defs AS (
      SELECT
        'psdb.chatlive.carrier.list'::text AS name,
        'Search latest PrestaShop orders carrier/status info from {{prefix}}chatlive_table_get_carrier by reference/company/firstname/lastname/email (returns id_order).'::text AS description,
        jsonb_build_object(
          'type','object',
          'properties', jsonb_build_object(
            'prefix', jsonb_build_object('type','string','default','ps_','description','PrestaShop table prefix (default ps_)'),
            'id_order', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','null'))),
            'reference', jsonb_build_object('type','string','description','Order reference (optional; partial match)'),
            'company', jsonb_build_object('type','string','description','Company (optional; partial match)'),
            'firstname', jsonb_build_object('type','string','description','Customer first name (optional; partial match)'),
            'lastname', jsonb_build_object('type','string','description','Customer last name (optional; partial match)'),
            'email', jsonb_build_object('type','string','description','Customer email (optional; partial match)'),
            'id_shop', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','null'))),
            'carrier_name', jsonb_build_object('type','string','description','Carrier name (e.g. DHL, zasilkovana)'),
            'limit', jsonb_build_object('type','integer','default',1000,'minimum',1,'maximum',5000),
            'debug', jsonb_build_object('type','boolean','default',false,'description','Include executed SQL in output')
          )
        ) AS input_schema,
        jsonb_build_object(
          'driver','mysql',
          'sql', $sql_psdb_carrier$SELECT
  `id_order`,
  `reference`,
  `id_lang`,
  `id_shop`,
  `company`,
  `firstname`,
  `lastname`,
  `email`,
  `carrier_name`,
  `name_status`
FROM `{{prefix}}chatlive_table_get_carrier`
WHERE (:id_order IS NULL OR `id_order` = :id_order)
  AND (:id_shop IS NULL OR `id_shop` = :id_shop)
  AND (:reference IS NULL OR `reference` LIKE CONCAT('%', :reference, '%'))
  AND (:company IS NULL OR `company` LIKE CONCAT('%', :company, '%'))
  AND (:firstname IS NULL OR `firstname` LIKE CONCAT('%', :firstname, '%'))
  AND (:lastname IS NULL OR `lastname` LIKE CONCAT('%', :lastname, '%'))
  AND (:email IS NULL OR `email` LIKE CONCAT('%', :email, '%'))
  AND (:carrier_name IS NULL OR `carrier_name` = :carrier_name)
ORDER BY `id_order` DESC
LIMIT :limit$sql_psdb_carrier$,
          'parameters', jsonb_build_object(
            'prefix','ps_',
            'id_order',NULL,
            'reference',NULL,
            'company',NULL,
            'firstname',NULL,
            'lastname',NULL,
            'email',NULL,
            'id_shop',NULL,
            'carrier_name',NULL,
            'limit',1000,
            'debug',false
          )
        ) AS code
    )
    UPDATE public.mod_mcp2_tool t
       SET description = d.description,
           input_schema = __INPUT_EXPR__,
           code = __CODE_EXPR__,
           version = GREATEST(COALESCE(t.version, 1), 1),
           updated_at = NOW()
      FROM defs d
     WHERE lower(t.name) = lower(d.name);
  $mcp2_sql$;

  EXECUTE replace(replace(sql_template, '__INPUT_EXPR__', input_expr), '__CODE_EXPR__', code_expr);
END $mcp2_update_psdb_chatlive_get_carrier$;

-- down
-- Non-destructive.
