-- Add org_id to module tables for multi-organization support (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mod_grabbing_jerome_domains' AND column_name='org_id'
  ) THEN
    ALTER TABLE public.mod_grabbing_jerome_domains ADD COLUMN org_id INTEGER NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mod_grabbing_jerome_domains_url' AND column_name='org_id'
  ) THEN
    ALTER TABLE public.mod_grabbing_jerome_domains_url ADD COLUMN org_id INTEGER NULL;
  END IF;
END $$;

-- Best-effort FK (skip when organizations.id is not a PK/UNIQUE)
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
      ALTER TABLE public.mod_grabbing_jerome_domains
        ADD CONSTRAINT fk_mod_gj_domains_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
    BEGIN
      ALTER TABLE public.mod_grabbing_jerome_domains_url
        ADD CONSTRAINT fk_mod_gj_domains_url_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS mod_gj_domains_org_domain_idx ON public.mod_grabbing_jerome_domains (org_id, domain);
CREATE INDEX IF NOT EXISTS mod_gj_domains_url_org_idx ON public.mod_grabbing_jerome_domains_url (org_id);
