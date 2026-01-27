DO $$ BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  -- filedata.upload_file
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'filedata',
       'action', 'upload_file',
       'parameters', jsonb_build_object('debug', false, 'filename', NULL, 'content_base64', NULL, 'content_type', NULL, 'bot_id', NULL)
     ),
     updated_at = NOW()
   WHERE lower(name) = lower('filedata.upload_file');

  -- filedata.list_files
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'filedata',
       'action', 'list_files',
       'parameters', jsonb_build_object('debug', false, 'limit', 50, 'bot_id', NULL)
     ),
     updated_at = NOW()
   WHERE lower(name) = lower('filedata.list_files');

  -- filedata.fetch_document
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'filedata',
       'action', 'fetch_document',
       'parameters', jsonb_build_object('debug', false, 'id', NULL)
     ),
     updated_at = NOW()
   WHERE lower(name) = lower('filedata.fetch_document');

  -- filedata.search_documents
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'filedata',
       'action', 'search_documents',
       'parameters', jsonb_build_object('debug', false, 'limit', 10, 'query', NULL)
     ),
     updated_at = NOW()
   WHERE lower(name) = lower('filedata.search_documents');

  -- filedata.openai_upload_file
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'filedata',
       'action', 'openai_upload_file',
       'parameters', jsonb_build_object(
         'debug', false,
         'file_id', NULL,
         'filename', NULL,
         'content_base64', NULL,
         'purpose', 'assistants',
         'vector_store_id', NULL
       )
     ),
     updated_at = NOW()
   WHERE lower(name) = lower('filedata.openai_upload_file');

  -- filedata.list_of_instructions
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'filedata',
       'action', 'list_of_instructions',
       'parameters', jsonb_build_object(
         'debug', false,
         'base_url', NULL,
         'name', NULL,
         'key', NULL,
         'filter_na', true,
         'unique', true,
         'sort', true,
         'timeout_ms', 10000
       )
     ),
     updated_at = NOW()
   WHERE lower(name) = lower('filedata.list_of_instructions');
END $$;

