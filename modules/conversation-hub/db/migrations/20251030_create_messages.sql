-- Module-owned messages table for Conversation Hub (idempotent)
-- Prefix: mod_conversation_hub_messages

CREATE TABLE IF NOT EXISTS mod_conversation_hub_messages (
  id SERIAL PRIMARY KEY,
  org_id INT NULL,
  visitor_id TEXT NOT NULL,
  sender TEXT NOT NULL,                -- 'visitor' | 'agent'
  content TEXT NULL,
  content_html TEXT NULL,
  agent_id INT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Helpful indexes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_mod_ch_messages_visitor_ts'
  ) THEN
    EXECUTE 'CREATE INDEX idx_mod_ch_messages_visitor_ts ON mod_conversation_hub_messages(visitor_id, created_at)';
  END IF;
END $$;

