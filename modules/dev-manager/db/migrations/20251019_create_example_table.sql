-- up
CREATE TABLE IF NOT EXISTS mod_dev_manager_examples (
  id SERIAL PRIMARY KEY,
  org_id TEXT REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
