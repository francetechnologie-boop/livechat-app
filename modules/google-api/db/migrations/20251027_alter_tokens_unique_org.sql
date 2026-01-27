DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_mod_google_api_tokens_org'
  ) THEN
    ALTER TABLE mod_google_api_tokens
      ADD CONSTRAINT uq_mod_google_api_tokens_org UNIQUE (org_id);
  END IF;
END $$;

