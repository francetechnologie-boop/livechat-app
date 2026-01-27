-- Metrics for translator prompt timings (per product x target language)
CREATE TABLE IF NOT EXISTS mod_product_data_translator_prompt_metrics (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  run_id INTEGER NOT NULL REFERENCES mod_product_data_translator_runs(id) ON DELETE CASCADE,
  id_product INTEGER NOT NULL,
  id_lang INTEGER NULL,
  prompt_ms INTEGER NULL,
  rel_prompt_ms INTEGER NULL,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_pdu_tr_metrics_run ON mod_product_data_translator_prompt_metrics(run_id);
    CREATE INDEX IF NOT EXISTS idx_pdu_tr_metrics_lang ON mod_product_data_translator_prompt_metrics(id_lang);
    CREATE INDEX IF NOT EXISTS idx_pdu_tr_metrics_prod ON mod_product_data_translator_prompt_metrics(id_product);
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
      ALTER TABLE public.mod_product_data_translator_prompt_metrics
        ADD CONSTRAINT fk_pdu_tr_metrics_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

