-- Backfill mapping tool versions from legacy domain_type_config history and current rows
-- Idempotent: uses ON CONFLICT DO NOTHING / guarded blocks

DO $$
BEGIN
  IF to_regclass('public.mod_grabbing_jerome_maping_tools') IS NOT NULL THEN
    BEGIN
      -- 1) From history table -> mapping tools (preserve created_at when available)
      BEGIN
        INSERT INTO public.mod_grabbing_jerome_maping_tools
          (domain, page_type, version, name, config, enabled, org_id, created_at, updated_at)
        SELECT 
          h.domain,
          lower(h.page_type),
          h.version,
          'imported',
          COALESCE(h.config, '{}'::jsonb),
          TRUE,
          NULL,
          COALESCE(h.created_at, NOW()),
          NOW()
        FROM public.mod_grabbing_jerome_domain_type_config_hist h
        ON CONFLICT (domain, page_type, version, org_id) DO NOTHING;
      EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL; END;

      -- 2) From current domain_type_config -> mapping tools (mark as current)
      BEGIN
        INSERT INTO public.mod_grabbing_jerome_maping_tools
          (domain, page_type, version, name, config, enabled, org_id, created_at, updated_at)
        SELECT
          c.domain,
          lower(c.page_type),
          COALESCE(c.version, 1),
          'current',
          COALESCE(c.config, '{}'::jsonb),
          TRUE,
          NULL,
          COALESCE(c.created_at, NOW()),
          NOW()
        FROM public.mod_grabbing_jerome_domain_type_config c
        ON CONFLICT (domain, page_type, version, org_id) DO NOTHING;
      EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL; END;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;

