CREATE TABLE IF NOT EXISTS mod_cron_management_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  schedule TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mod_cron_management_logs (
  id SERIAL PRIMARY KEY,
  job_id TEXT,
  status TEXT,
  message TEXT,
  ran_at TIMESTAMP DEFAULT NOW()
);

