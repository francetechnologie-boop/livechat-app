-- 20251027_create_settings_table.sql
-- Create settings table for PrestaShop API integration

DO $$ BEGIN
  -- Create table if not exists
  IF to_regclass('public.mod_prestashop_api_settings') IS NULL THEN
    CREATE TABLE public.mod_prestashop_api_settings (
      id SERIAL PRIMARY KEY,
      org_id TEXT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  END IF;
END $$;

-- Ensure unique and index
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_prestashop_api_settings
      ADD CONSTRAINT uq_mod_prestashop_api_settings UNIQUE (org_id);
  EXCEPTION WHEN others THEN
    -- constraint may already exist
  END;
END $$;

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_mod_prestashop_api_settings_org_id
      ON public.mod_prestashop_api_settings(org_id);
  EXCEPTION WHEN others THEN
  END;
END $$;

-- Create connections table to support multiple connections per org
DO $$ BEGIN
  IF to_regclass('public.mod_prestashop_api_connections') IS NULL THEN
    CREATE TABLE public.mod_prestashop_api_connections (
      id SERIAL PRIMARY KEY,
      org_id TEXT NULL,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      api_key TEXT NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  END IF;
END $$;

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_prestashop_api_connections
      ADD CONSTRAINT uq_mod_prestashop_api_connections_name UNIQUE (org_id, name);
  EXCEPTION WHEN others THEN
  END;
END $$;

DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_mod_prestashop_api_connections_org_id
      ON public.mod_prestashop_api_connections(org_id);
  EXCEPTION WHEN others THEN
  END;
END $$;

-- Optional data migration: seed one connection from settings if present and none exist
DO $$ DECLARE
  has_settings INT := 0;
  has_connections INT := 0;
BEGIN
  BEGIN SELECT 1 INTO has_settings FROM public.mod_prestashop_api_settings LIMIT 1; EXCEPTION WHEN others THEN has_settings := 0; END;
  BEGIN SELECT 1 INTO has_connections FROM public.mod_prestashop_api_connections LIMIT 1; EXCEPTION WHEN others THEN has_connections := 0; END;
  IF has_settings = 1 AND has_connections = 0 THEN
    INSERT INTO public.mod_prestashop_api_connections(org_id, name, base_url, api_key, is_default, created_at, updated_at)
    SELECT s.org_id, COALESCE(NULLIF(TRIM(s.org_id), ''), 'default'), s.base_url, s.api_key, TRUE, NOW(), NOW()
    FROM public.mod_prestashop_api_settings s
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
