-- Agents: extend organization table with advanced fields (idempotent)
DO $$
BEGIN
  IF to_regclass('public.mod_agents_orgs') IS NULL THEN
    EXECUTE 'CREATE TABLE public.mod_agents_orgs (
      org_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '''',
      contact_email TEXT NULL,
      logo_url TEXT NULL,
      locale TEXT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )';
  END IF;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS timezone TEXT'; EXCEPTION WHEN others THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS default_lang TEXT'; EXCEPTION WHEN others THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS brand_logo_light TEXT'; EXCEPTION WHEN others THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS brand_logo_dark TEXT'; EXCEPTION WHEN others THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS favicon_url TEXT'; EXCEPTION WHEN others THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS theme_primary TEXT'; EXCEPTION WHEN others THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS theme_accent TEXT'; EXCEPTION WHEN others THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS allowed_email_domains TEXT[]'; EXCEPTION WHEN others THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS ip_allowlist TEXT[]'; EXCEPTION WHEN others THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS sso_required BOOLEAN'; EXCEPTION WHEN others THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS invite_policy TEXT'; EXCEPTION WHEN others THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS data_retention_days INT'; EXCEPTION WHEN others THEN END;
  BEGIN EXECUTE 'ALTER TABLE public.mod_agents_orgs ADD COLUMN IF NOT EXISTS audit_log_enabled BOOLEAN'; EXCEPTION WHEN others THEN END;
END $$;

