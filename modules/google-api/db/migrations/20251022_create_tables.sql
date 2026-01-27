CREATE TABLE IF NOT EXISTS mod_google_api_settings (
  id SERIAL PRIMARY KEY,
  org_id TEXT DEFAULT 'org_default',
  client_id TEXT,
  client_secret TEXT,
  redirect_uri TEXT,
  scopes TEXT[],
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_mod_google_api_settings_org UNIQUE(org_id)
);

CREATE TABLE IF NOT EXISTS mod_google_api_tokens (
  id SERIAL PRIMARY KEY,
  org_id TEXT DEFAULT 'org_default',
  access_token TEXT,
  refresh_token TEXT,
  token_type TEXT,
  expiry_date BIGINT,
  updated_at TIMESTAMP DEFAULT NOW()
);

