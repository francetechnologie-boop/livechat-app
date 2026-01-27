-- Add google-api driver definition for Gmail search tool
DO $body$
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.mod_mcp2_tool
     SET code = jsonb_build_object(
       'driver', 'google-api',
       'module', 'google-api',
       'endpoint', '/api/google-api/oauth/gmail/messages',
       'method', 'GET',
       'query_params', jsonb_build_array('q','max','scopes','labelIds','use_oauth','impersonate','oauth_user_id','oauth_user_email'),
       'parameters', jsonb_build_object(
         'q', '',
         'max', 20,
         'scopes', 'https://www.googleapis.com/auth/gmail.readonly',
         'labelIds', 'INBOX',
         'use_oauth', true,
         'impersonate', null,
         'oauth_user_id', null,
         'oauth_user_email', null
       )
     ),
     updated_at = NOW()
   WHERE id = 'm2tool_406ce9ed2c8e20e1';
END $body$;

