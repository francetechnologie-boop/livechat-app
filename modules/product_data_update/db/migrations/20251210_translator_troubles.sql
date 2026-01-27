-- Troubles table to persist per-language failures for later retry
CREATE TABLE IF NOT EXISTS public.mod_product_data_translator_troubles (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  run_id INTEGER NULL,
  id_product INTEGER NOT NULL,
  id_lang INTEGER NOT NULL,
  id_shop INTEGER NOT NULL,
  code TEXT NULL,
  message TEXT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open|queued|resolved
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_pdu_troubles_org ON public.mod_product_data_translator_troubles((COALESCE(org_id,-1)));
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_pdu_troubles_key ON public.mod_product_data_translator_troubles(id_product, id_lang, id_shop);
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_pdu_troubles_run ON public.mod_product_data_translator_troubles(run_id);
  EXCEPTION WHEN others THEN NULL; END;
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
      ALTER TABLE public.mod_product_data_translator_troubles
        ADD CONSTRAINT fk_pdu_troubles_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

