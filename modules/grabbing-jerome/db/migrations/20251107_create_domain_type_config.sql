-- Rationalized unified config per domain/page_type
CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_domain_type_config (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  page_type TEXT NOT NULL,
  config JSONB NULL,
  tables JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'mod_grabbing_jerome_domain_type_config'
       AND c.conname = 'uq_mod_gj_domain_type_cfg'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_grabbing_jerome_domain_type_config
        ADD CONSTRAINT uq_mod_gj_domain_type_cfg UNIQUE (domain, page_type);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- Backfill from domains.config_transfert.mappings
INSERT INTO public.mod_grabbing_jerome_domain_type_config(domain, page_type, config, created_at, updated_at)
SELECT d.domain,
       k.key AS page_type,
       (d.config_transfert->'mappings'->(k.key)) AS config,
       NOW(), NOW()
  FROM public.mod_grabbing_jerome_domains d
  CROSS JOIN LATERAL (
    SELECT key FROM jsonb_object_keys(COALESCE(d.config_transfert->'mappings', '{}'::jsonb)) AS key
  ) k
ON CONFLICT (domain, page_type) DO UPDATE
  SET config = COALESCE(EXCLUDED.config, public.mod_grabbing_jerome_domain_type_config.config),
      updated_at = NOW();

-- Backfill legacy single mapping (assume product when missing)
INSERT INTO public.mod_grabbing_jerome_domain_type_config(domain, page_type, config, created_at, updated_at)
SELECT d.domain,
       'product' AS page_type,
       (d.config_transfert->'mapping') AS config,
       NOW(), NOW()
  FROM public.mod_grabbing_jerome_domains d
 WHERE (d.config_transfert ? 'mapping')
ON CONFLICT (domain, page_type) DO NOTHING;

-- Aggregate per-table settings into unified tables JSON
WITH agg AS (
  SELECT s.domain,
         s.page_type,
         jsonb_object_agg(s.table_name,
           jsonb_build_object(
             'settings', COALESCE(s.settings,'{}'::jsonb),
             'mapping', COALESCE(s.mapping,'{}'::jsonb),
             'setting_image', COALESCE(s.setting_image,'{}'::jsonb)
           )
         ) AS tables
    FROM public.mod_grabbing_jerome_table_settings s
   GROUP BY s.domain, s.page_type
)
INSERT INTO public.mod_grabbing_jerome_domain_type_config(domain, page_type, tables, created_at, updated_at)
SELECT a.domain, a.page_type, a.tables, NOW(), NOW()
  FROM agg a
ON CONFLICT (domain, page_type) DO UPDATE
  SET tables = COALESCE(public.mod_grabbing_jerome_domain_type_config.tables,'{}'::jsonb) || EXCLUDED.tables,
      updated_at = NOW();
