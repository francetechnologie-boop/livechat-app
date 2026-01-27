-- up
-- Seed psdb tool for chatlive product + accessories lookup from {{prefix}}chatlive_table_products_and_accessory
-- Europe/Prague date: 2026-01-20
DO $mcp2_seed_psdb_chatlive_products$
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
        'psdb.chatlive.products.search'::text AS name,
        'Search products from {{prefix}}chatlive_table_products_and_accessory for a given id_shop/id_lang and return accessories_json (plus marque via manufacturer join).'::text AS description,
        jsonb_build_object(
          'type','object',
          'properties', jsonb_build_object(
            'prefix', jsonb_build_object('type','string','default','ps_','description','PrestaShop table prefix (default ps_)'),
            'id_shop', jsonb_build_object('type','integer','description','Shop id (required)'),
            'id_lang', jsonb_build_object('type','integer','description','Language id (required)'),
            'id_product', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','null'))),
            'query', jsonb_build_object('type','string','description','Search term (name/category/marque/reference)'),
            'reference', jsonb_build_object('type','string','description','Reference search (partial)'),
            'only_with_accessories', jsonb_build_object('type','boolean','default',false),
            'limit', jsonb_build_object('type','integer','default',25,'minimum',1,'maximum',200),
            'debug', jsonb_build_object('type','boolean','default',false,'description','Include executed SQL in output')
          ),
          'required', jsonb_build_array('id_shop','id_lang')
        ) AS input_schema,
        jsonb_build_object(
          'driver','mysql',
          'sql', $sql_psdb_chatlive$SELECT
  v.id_shop,
  v.id_lang,
  v.id_product,
  v.reference,
  v.name,
  v.category,
  m.name AS marque,
  COALESCE(JSON_LENGTH(v.accessories_json), 0) AS accessories_count,
  v.accessories_json
FROM `{{prefix}}chatlive_table_products_and_accessory` v
LEFT JOIN `{{prefix}}product` p ON p.id_product = v.id_product
LEFT JOIN `{{prefix}}manufacturer` m ON m.id_manufacturer = p.id_manufacturer
WHERE v.id_shop = :id_shop
  AND v.id_lang = :id_lang
  AND (:id_product IS NULL OR v.id_product = :id_product)
  AND (:reference IS NULL OR v.reference LIKE CONCAT('%', :reference, '%'))
  AND (
    :query IS NULL
    OR v.name LIKE CONCAT('%', :query, '%')
    OR v.category LIKE CONCAT('%', :query, '%')
    OR v.reference LIKE CONCAT('%', :query, '%')
    OR m.name LIKE CONCAT('%', :query, '%')
  )
  AND (:only_with_accessories = 0 OR COALESCE(JSON_LENGTH(v.accessories_json), 0) > 0)
ORDER BY v.id_product DESC
LIMIT :limit$sql_psdb_chatlive$,
          'parameters', jsonb_build_object(
            'prefix','ps_',
            'id_shop',NULL,
            'id_lang',NULL,
            'id_product',NULL,
            'query',NULL,
            'reference',NULL,
            'only_with_accessories',false,
            'limit',25,
            'debug',false
          ),
          'paramSchema', jsonb_build_object(
            'type','object',
            'properties', jsonb_build_object(
              'prefix', jsonb_build_object('type','string','default','ps_'),
              'id_shop', jsonb_build_object('type','integer'),
              'id_lang', jsonb_build_object('type','integer'),
              'id_product', jsonb_build_object('anyOf', jsonb_build_array(jsonb_build_object('type','integer'), jsonb_build_object('type','null'))),
              'query', jsonb_build_object('type','string'),
              'reference', jsonb_build_object('type','string'),
              'only_with_accessories', jsonb_build_object('type','boolean','default',false),
              'limit', jsonb_build_object('type','integer','default',25),
              'debug', jsonb_build_object('type','boolean','default',false)
            )
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
END $mcp2_seed_psdb_chatlive_products$;

-- Link to psdb type (best-effort)
DO $mcp2_link_psdb_chatlive$
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
  WHERE lower(t.name) = lower('psdb.chatlive.products.search')
  ON CONFLICT (type_id, tool_id) DO NOTHING;
END $mcp2_link_psdb_chatlive$;

-- down
-- Non-destructive: keep tool definition.
