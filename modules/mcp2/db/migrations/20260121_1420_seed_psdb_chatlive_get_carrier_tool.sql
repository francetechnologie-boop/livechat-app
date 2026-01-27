-- up
-- Seed psdb tool to retrieve carrier/status info from ps_chatlive_table_get_carrier
-- Europe/Prague date: 2026-01-21
DO $mcp2_seed_psdb_chatlive_get_carrier$
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

  -- Build cast expressions for portability (older installs may have json/jsonb/text)
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
        'List latest PrestaShop orders carrier/status info from {{prefix}}chatlive_table_get_carrier (view/table). Supports optional filters and limit.'::text AS description,
        jsonb_build_object(
          'type','object',
          'properties', jsonb_build_object(
            'prefix', jsonb_build_object('type','string','default','ps_','description','PrestaShop table prefix (default ps_)'),
            'id_order', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','null'))),
            'reference', jsonb_build_object('type','string','description','Order reference (optional; partial match)'),
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
  AND (:email IS NULL OR `email` LIKE CONCAT('%', :email, '%'))
  AND (:carrier_name IS NULL OR `carrier_name` = :carrier_name)
ORDER BY `id_order` DESC
LIMIT :limit$sql_psdb_carrier$,
          'parameters', jsonb_build_object(
            'prefix','ps_',
            'id_order',NULL,
            'reference',NULL,
            'email',NULL,
            'id_shop',NULL,
            'carrier_name',NULL,
            'limit',1000,
            'debug',false
          )
        ) AS code
    )
    , upd AS (
      UPDATE public.mod_mcp2_tool t
         SET description = d.description,
             input_schema = __INPUT_EXPR__,
             code = __CODE_EXPR__,
             version = GREATEST(COALESCE(t.version, 1), 1),
             updated_at = NOW()
        FROM defs d
       WHERE lower(t.name) = lower(d.name)
       RETURNING t.id
    )
    INSERT INTO public.mod_mcp2_tool (id, name, description, input_schema, code, version, created_at, updated_at, org_id)
    SELECT
      ('m2tool_builtin_' || replace(replace(d.name,'/','_'),'.','_'))::text AS id,
      d.name,
      d.description,
      __INPUT_EXPR__,
      __CODE_EXPR__,
      1,
      NOW(),
      NOW(),
      NULL
    FROM defs d
    WHERE NOT EXISTS (SELECT 1 FROM public.mod_mcp2_tool t WHERE lower(t.name) = lower(d.name));
  $mcp2_sql$;

  EXECUTE replace(replace(sql_template, '__INPUT_EXPR__', input_expr), '__CODE_EXPR__', code_expr);
END $mcp2_seed_psdb_chatlive_get_carrier$;

-- Link to psdb type (best-effort)
DO $mcp2_link_psdb_chatlive_get_carrier$
DECLARE
  target_type_id TEXT := NULL;
BEGIN
  IF to_regclass('public.mod_mcp2_type') IS NULL
     OR to_regclass('public.mod_mcp2_type_tool') IS NULL
     OR to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO target_type_id
    FROM public.mod_mcp2_type
   WHERE lower(code) = 'psdb'
      OR lower(name) = 'psdb'
      OR lower(COALESCE(tool_prefix,'')) = 'psdb'
   ORDER BY updated_at DESC
   LIMIT 1;

  IF target_type_id IS NULL THEN
    target_type_id := 'm2type_builtin_psdb';
    INSERT INTO public.mod_mcp2_type (id, code, name, description, tool_prefix, created_at, updated_at, org_id)
    VALUES (target_type_id, 'psdb', 'PrestaShop DB', 'PrestaShop MySQL helper tools (psdb.*)', 'psdb', NOW(), NOW(), NULL)
    ON CONFLICT (id) DO UPDATE SET updated_at = NOW();
  END IF;

  BEGIN
    UPDATE public.mod_mcp2_type
       SET tool_prefix = COALESCE(NULLIF(tool_prefix,''), 'psdb'),
           updated_at = NOW()
     WHERE id = target_type_id;
  EXCEPTION WHEN others THEN NULL;
  END;

  INSERT INTO public.mod_mcp2_type_tool (type_id, tool_id, created_at, org_id)
  SELECT target_type_id, t.id, NOW(), NULL
  FROM public.mod_mcp2_tool t
  WHERE lower(t.name) = lower('psdb.chatlive.carrier.list')
  ON CONFLICT (type_id, tool_id) DO NOTHING;
END $mcp2_link_psdb_chatlive_get_carrier$;

-- down
-- Non-destructive: keep tool definition.
