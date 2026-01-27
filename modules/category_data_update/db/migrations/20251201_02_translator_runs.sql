-- Translator runs header table (Category)
CREATE TABLE IF NOT EXISTS mod_category_data_translator_runs (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'running',
  profile_id INTEGER NULL,
  prefix VARCHAR(64) NULL,
  id_shop INTEGER NULL,
  id_lang INTEGER NULL, -- target language
  prompt_config_id TEXT NULL,
  totals JSONB NULL,
  params JSONB NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP NULL
);

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_cdu_tr_runs_org ON mod_category_data_translator_runs(org_id);
    CREATE INDEX IF NOT EXISTS idx_cdu_tr_runs_status ON mod_category_data_translator_runs(status);
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- Translator run items
CREATE TABLE IF NOT EXISTS mod_category_data_translator_run_items (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES mod_category_data_translator_runs(id) ON DELETE CASCADE,
  id_category INTEGER NOT NULL,
  updated BOOLEAN DEFAULT FALSE,
  status VARCHAR(32) NULL,
  message TEXT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_cdu_tr_run_items_run ON mod_category_data_translator_run_items(run_id);
    CREATE INDEX IF NOT EXISTS idx_cdu_tr_run_items_cat ON mod_category_data_translator_run_items(id_category);
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

