-- Re-run only INSERT backfills for prompt_* after fix_schema created tables
-- Safe to re-run multiple times (ON CONFLICT guards)

DO $$
DECLARE
  has_cfg BOOLEAN := FALSE;
  has_hist BOOLEAN := FALSE;
  has_mcp BOOLEAN := FALSE;
  has_mcp2 BOOLEAN := FALSE;
BEGIN
  -- Check legacy sources
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='prompt_config') INTO has_cfg;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='prompt_test_history') INTO has_hist;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='prompt_config_mcp') INTO has_mcp;
  SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='prompt_config_mcp2') INTO has_mcp2;

  IF has_cfg THEN
    INSERT INTO mod_automation_suite_prompt_config (id, org_id, name, dev_message, messages, tools, openai_api_key, prompt_id, prompt_version, model, vector_store_id, vector_store_ids, metadata, created_at, updated_at)
    SELECT
      (p.id)::text AS id,
      CASE WHEN p.org_id::text ~ '^[0-9]+$' THEN p.org_id::int ELSE NULL END AS org_id,
      p.name,
      p.dev_message,
      CASE WHEN pg_typeof(p.messages)::text IN ('json','jsonb') THEN p.messages::jsonb ELSE NULL END,
      CASE WHEN pg_typeof(p.tools)::text IN ('json','jsonb') THEN p.tools::jsonb ELSE NULL END,
      p.openai_api_key,
      p.prompt_id,
      p.prompt_version,
      p.model,
      p.vector_store_id,
      p.vector_store_ids,
      NULL::jsonb AS metadata,
      COALESCE(p.created_at, NOW()),
      COALESCE(p.updated_at, NOW())
    FROM public.prompt_config p
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF has_hist THEN
    INSERT INTO mod_automation_suite_prompt_test_history (id, prompt_config_id, input, output, request, response, ms, created_at)
    SELECT h.id::text, h.prompt_config_id::text, h.input, h.output,
           CASE WHEN pg_typeof(h.request)::text IN ('json','jsonb') THEN h.request::jsonb ELSE NULL END,
           CASE WHEN pg_typeof(h.response)::text IN ('json','jsonb') THEN h.response::jsonb ELSE NULL END,
           NULLIF(h.ms::text,'')::int, COALESCE(h.created_at, NOW())
    FROM public.prompt_test_history h
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF has_mcp THEN
    INSERT INTO mod_automation_suite_prompt_mcp (prompt_config_id, mcp_server_id, created_at)
    SELECT x.prompt_config_id::text, x.mcp_server_id::text, COALESCE(x.created_at, NOW())
    FROM public.prompt_config_mcp x
    ON CONFLICT (prompt_config_id, mcp_server_id) DO NOTHING;
  END IF;

  IF has_mcp2 THEN
    INSERT INTO mod_automation_suite_prompt_mcp2 (prompt_config_id, mcp2_server_id, created_at)
    SELECT x.prompt_config_id::text, x.mcp2_server_id::text, COALESCE(x.created_at, NOW())
    FROM public.prompt_config_mcp2 x
    ON CONFLICT (prompt_config_id, mcp2_server_id) DO NOTHING;
  END IF;
END $$;
