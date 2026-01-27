-- Create JSON config table for automation-suite (idempotent)
CREATE TABLE IF NOT EXISTS mod_automation_suite_config (
  id SERIAL PRIMARY KEY,
  org_id TEXT NULL,
  key TEXT NOT NULL,
  value JSONB NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_mod_automation_suite_config UNIQUE (org_id, key)
);

-- Optional: welcome messages table (compatibility view with JSON store)
CREATE TABLE IF NOT EXISTS mod_automation_suite_welcome_messages (
  id TEXT PRIMARY KEY,
  org_id TEXT NULL,
  title TEXT NULL,
  content TEXT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

