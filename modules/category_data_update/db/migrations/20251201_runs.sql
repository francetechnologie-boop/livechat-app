-- Runs header table (Category)
CREATE TABLE IF NOT EXISTS mod_category_data_update_runs (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'running', -- running|done|failed
  profile_id INTEGER NULL,
  prefix VARCHAR(64) NULL,
  id_shop INTEGER NULL,
  id_lang INTEGER NULL,
  prompt_config_id TEXT NULL,
  totals JSONB NULL,        -- { requested, done, updated, skipped, errors }
  params JSONB NULL,        -- { fields, limits }
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP DEFAULT NOW(),
  finished_at TIMESTAMP NULL
);

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_cdu_runs_org ON mod_category_data_update_runs(org_id);
    CREATE INDEX IF NOT EXISTS idx_cdu_runs_status ON mod_category_data_update_runs(status);
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- Run items (per category outcome)
CREATE TABLE IF NOT EXISTS mod_category_data_update_run_items (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES mod_category_data_update_runs(id) ON DELETE CASCADE,
  id_category INTEGER NOT NULL,
  updated BOOLEAN DEFAULT FALSE,
  status VARCHAR(32) NULL,  -- updated|ok|skipped|error
  message TEXT NULL,
  meta_title TEXT NULL,
  meta_description TEXT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_cdu_run_items_run ON mod_category_data_update_run_items(run_id);
    CREATE INDEX IF NOT EXISTS idx_cdu_run_items_cat ON mod_category_data_update_run_items(id_category);
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- Guarded FK to organizations(id) on runs
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
      ALTER TABLE public.mod_category_data_update_runs
        ADD CONSTRAINT fk_cdu_runs_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END;
  END IF;
END $$;

