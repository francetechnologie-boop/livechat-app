-- Conversation Hub OpenAI log (idempotent)
-- Stores assistant request/response snapshots for debugging.
-- Prefix: mod_conversation_hub_*
-- Europe/Prague date: 2026-01-21

CREATE TABLE IF NOT EXISTS public.mod_conversation_hub_openai_log (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  visitor_id TEXT NULL,
  id_bot TEXT NULL,
  prompt_config_id TEXT NULL,
  request JSONB NULL,
  response JSONB NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Guarded org_id foreign key (portable)
DO $$ BEGIN
  IF to_regclass('public.organizations') IS NOT NULL AND EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
     WHERE n.nspname = 'public' AND t.relname = 'organizations'
       AND i.indisunique = TRUE
       AND array_length(i.indkey,1) = 1
       AND a.attname = 'id'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_conversation_hub_openai_log
        ADD CONSTRAINT fk_mod_conversation_hub_openai_log_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- Helpful indexes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_mod_ch_openai_visitor_ts'
  ) THEN
    EXECUTE 'CREATE INDEX idx_mod_ch_openai_visitor_ts ON public.mod_conversation_hub_openai_log(visitor_id, created_at DESC)';
  END IF;
END $$;

