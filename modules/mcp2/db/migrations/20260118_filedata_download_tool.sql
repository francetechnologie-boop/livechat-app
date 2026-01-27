DO $$ BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.mod_mcp2_tool WHERE id = 'm2tool_6d5f1a2filedownload') THEN
    INSERT INTO public.mod_mcp2_tool (
      id, name, description, input_schema, code, version, created_at, updated_at, org_id
    ) VALUES (
      'm2tool_6d5f1a2filedownload',
      'filedata.download_file',
      'Return a download URL for an uploaded file (MCP2 filedata driver)',
      '{"type":"object","required":["id"],"properties":{"id":{"type":"string","description":"File identifier (mcp: or app:) from filedata listings"}}}',
      '{"action":"download_file","driver":"filedata","parameters":{"debug":false,"id":null}}',
      1,
      NOW(),
      NOW(),
      'org_default'
    );
  ELSE
    UPDATE public.mod_mcp2_tool
       SET name = 'filedata.download_file',
           description = 'Return a download URL for an uploaded file (MCP2 filedata driver)',
           input_schema = '{"type":"object","required":["id"],"properties":{"id":{"type":"string","description":"File identifier (mcp: or app:) from filedata listings"}}}',
           code = '{"action":"download_file","driver":"filedata","parameters":{"debug":false,"id":null}}',
           version = 1,
           updated_at = NOW()
     WHERE id = 'm2tool_6d5f1a2filedownload';
  END IF;
END $$;
