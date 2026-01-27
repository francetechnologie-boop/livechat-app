CREATE TABLE IF NOT EXISTS public.mod_security_settings (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  key TEXT NOT NULL,
  value TEXT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_security_settings
      ADD CONSTRAINT uq_security_settings_org_key UNIQUE (org_id, key);
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.mod_security_settings
      ADD CONSTRAINT fk_security_settings_org
      FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
  END;
END $$;

CREATE INDEX IF NOT EXISTS idx_security_settings_org ON public.mod_security_settings (org_id);

-- down
-- DROP TABLE IF EXISTS public.mod_security_settings;
