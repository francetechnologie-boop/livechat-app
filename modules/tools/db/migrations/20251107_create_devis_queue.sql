CREATE TABLE IF NOT EXISTS mod_tools_devis_queue (
  id SERIAL PRIMARY KEY,
  org_id INT NULL,
  message_id TEXT NOT NULL,
  thread_id TEXT,
  subject TEXT,
  from_email TEXT,
  from_name TEXT,
  to_email TEXT,
  customer_email TEXT,
  customer_first_name TEXT,
  customer_last_name TEXT,
  customer_language TEXT,
  customer_company TEXT,
  customer_phone TEXT,
  body_snippet TEXT,
  body_text TEXT,
  body_html TEXT,
  extraction JSONB,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT uq_mod_tools_devis_queue_message UNIQUE (message_id)
);

CREATE INDEX IF NOT EXISTS idx_mod_tools_devis_queue_org ON mod_tools_devis_queue(org_id);
CREATE INDEX IF NOT EXISTS idx_mod_tools_devis_queue_status ON mod_tools_devis_queue(status);

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
      ALTER TABLE public.mod_tools_devis_queue
        ADD CONSTRAINT fk_mod_tools_devis_queue_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;
