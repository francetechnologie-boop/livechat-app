-- Generic job queue for product_data_update (async processing)
CREATE TABLE IF NOT EXISTS mod_product_data_jobs (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  run_id INTEGER NULL REFERENCES mod_product_data_translator_runs(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL
);

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_pdu_jobs_status ON mod_product_data_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_pdu_jobs_type ON mod_product_data_jobs(type);
    CREATE INDEX IF NOT EXISTS idx_pdu_jobs_run ON mod_product_data_jobs(run_id);
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- Guarded FK to organizations(id)
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
      ALTER TABLE public.mod_product_data_jobs
        ADD CONSTRAINT fk_pdu_jobs_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

