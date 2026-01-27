-- Dedupe mapping: merge per-table mapping from mod_grabbing_sensorex_table_settings
-- into mod_grabbing_sensorex_maping_tools.config and clear table_settings.mapping.
-- Idempotent and safe to re-run.

DO $$
DECLARE
  r RECORD;
  mt_id BIGINT;
  mt_row RECORD;
  cfg JSONB;
  tname TEXT;
  mf JSONB;
  md JSONB;
  fields JSONB;
  tbl JSONB;
BEGIN
  FOR r IN
    SELECT ts.id, ts.domain, ts.page_type, ts.table_name, ts.mapping, ts.mapping_tools_id, ts.mapping_version
      FROM public.mod_grabbing_sensorex_table_settings ts
     WHERE ts.mapping IS NOT NULL
       AND jsonb_typeof(ts.mapping) = 'object'
  LOOP
    -- Resolve target mapping_tools row
    mt_id := r.mapping_tools_id;
    IF mt_id IS NULL THEN
      IF r.mapping_version IS NOT NULL THEN
        SELECT id INTO mt_id
          FROM public.mod_grabbing_sensorex_maping_tools
         WHERE regexp_replace(lower(domain),'^www\.', '') = regexp_replace(lower(r.domain),'^www\.', '')
           AND lower(page_type) = lower(r.page_type)
           AND version = r.mapping_version
         ORDER BY updated_at DESC
         LIMIT 1;
      ELSE
        SELECT id INTO mt_id
          FROM public.mod_grabbing_sensorex_maping_tools
         WHERE regexp_replace(lower(domain),'^www\.', '') = regexp_replace(lower(r.domain),'^www\.', '')
           AND lower(page_type) = lower(r.page_type)
         ORDER BY version DESC, updated_at DESC
         LIMIT 1;
      END IF;
    END IF;
    IF mt_id IS NULL THEN CONTINUE; END IF;

    SELECT id, version, config INTO mt_row FROM public.mod_grabbing_sensorex_maping_tools WHERE id = mt_id LIMIT 1;
    IF NOT FOUND THEN CONTINUE; END IF;

    cfg := COALESCE(mt_row.config, '{}'::jsonb);
    IF COALESCE(jsonb_typeof(cfg->'tables'), 'null') <> 'object' THEN
      cfg := cfg || jsonb_build_object('tables', '{}'::jsonb);
    END IF;
    tname := r.table_name;

    -- Extract mapping fields/defaults
    mf := COALESCE(r.mapping->'fields', '{}'::jsonb);
    IF jsonb_typeof(mf) <> 'object' THEN mf := '{}'::jsonb; END IF;
    md := COALESCE(r.mapping->'defaults', '{}'::jsonb);
    IF jsonb_typeof(md) <> 'object' THEN md := '{}'::jsonb; END IF;

    -- Merge defaults as explicit constants
    fields := mf;
    IF md <> '{}'::jsonb THEN
      FOR mt_row IN SELECT key, value FROM jsonb_each(md)
      LOOP
        IF mt_row.value::text = '""' THEN
          -- empty default
          IF tname ~* '_group$' THEN
            -- skip for *_group tables
            NULL;
          ELSE
            fields := fields || jsonb_build_object(mt_row.key, ''::jsonb);
          END IF;
        ELSE
          fields := fields || jsonb_build_object(mt_row.key, (('=' || (mt_row.value::text))::jsonb));
        END IF;
      END LOOP;
    END IF;

    -- Sanitize *_group: drop legacy empty markers
    IF tname ~* '_group$' THEN
      fields := (
        SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
        FROM (
          SELECT key AS k, value AS v
            FROM jsonb_each(fields)
           WHERE value::text NOT IN ('""','"="')
        ) s
      );
    END IF;

    -- Merge into cfg.tables[tname].fields
    tbl := COALESCE(cfg#>'{tables,'||tname||'}', '{}'::jsonb);
    IF jsonb_typeof(tbl) <> 'object' THEN tbl := '{}'::jsonb; END IF;
    tbl := tbl || jsonb_build_object('fields', (COALESCE(tbl->'fields','{}'::jsonb) || fields));
    cfg := jsonb_set(cfg, ARRAY['tables', tname], tbl, true);

    -- Persist updated config
    BEGIN
      UPDATE public.mod_grabbing_sensorex_maping_tools
         SET config = cfg,
             updated_at = now()
       WHERE id = mt_id;
    EXCEPTION WHEN others THEN NULL; END;

    -- Clear duplicated mapping from table_settings
    BEGIN
      UPDATE public.mod_grabbing_sensorex_table_settings
         SET mapping = NULL,
             updated_at = now()
       WHERE id = r.id;
    EXCEPTION WHEN others THEN NULL; END;
  END LOOP;
END $$;

