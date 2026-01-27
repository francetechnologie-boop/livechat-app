-- Create module-owned settings table (per org)
CREATE TABLE IF NOT EXISTS mod_smartsupp_api_settings (
  id SERIAL PRIMARY KEY,
  org_id TEXT DEFAULT 'org_default',
  api_token TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_mod_smartsupp_api_settings_org UNIQUE(org_id)
);

