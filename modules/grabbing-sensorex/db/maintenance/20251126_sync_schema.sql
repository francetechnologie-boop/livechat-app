-- Grabbing‑Sensorex — Schema Sync (idempotent)
-- Date: 2025-11-26
-- Purpose: align DB with current module behavior by adding missing columns,
--          dropping unused ones, ensuring optional helper tables and indexes.

-- 1) Domains: add missing config_transfert JSONB (used by backend fallbacks)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_domains' AND column_name='config_transfert'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_grabbing_sensorex_domains
        ADD COLUMN config_transfert JSONB NULL;
    EXCEPTION WHEN duplicate_column THEN NULL; END;
  END IF;
END $$;

-- 2) Domains: drop columns not used by the module (keeps sitemaps JSON + updated_at)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_domains' AND column_name='selected_sitemaps'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_grabbing_sensorex_domains DROP COLUMN selected_sitemaps;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_grabbing_sensorex_domains' AND column_name='sitemap_total_urls'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_grabbing_sensorex_domains DROP COLUMN sitemap_total_urls;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;

-- 3) Optional (recommended): image content hash mapping used by images pipeline
CREATE TABLE IF NOT EXISTS public.mod_grabbing_sensorex_image_map (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  product_id BIGINT NOT NULL,
  source_url TEXT,
  url_hash TEXT,
  content_sha1 TEXT NOT NULL,
  id_image BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS mod_gs_img_map_uq
  ON public.mod_grabbing_sensorex_image_map (domain, product_id, content_sha1);

-- 4) Remove legacy module migrations log (unused by the current module)
DROP TABLE IF EXISTS public.mod_grabbing_sensorex_migrations_log;

-- 5) Sanity checks: keep critical indexes (add if missing)
DO $$
BEGIN
  -- Domains listing performance
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='i' AND c.relname='idx_mod_gs_domains_updated_at_desc_domain_asc'
  ) THEN
    CREATE INDEX idx_mod_gs_domains_updated_at_desc_domain_asc
      ON public.mod_grabbing_sensorex_domains (updated_at DESC, domain ASC);
  END IF;

  -- Re-expose the domains_url btree unique index as a named constraint (portable)
  IF to_regclass('public.mod_grabbing_sensorex_domains_url') IS NOT NULL THEN
    IF to_regclass('public.mod_grabbing_sensorex_domains_url_uq') IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname='mod_gs_domains_url_uqc'
           AND conrelid='public.mod_grabbing_sensorex_domains_url'::regclass
      ) THEN
        BEGIN
          ALTER TABLE public.mod_grabbing_sensorex_domains_url
            ADD CONSTRAINT mod_gs_domains_url_uqc
            UNIQUE USING INDEX mod_grabbing_sensorex_domains_url_uq;
        EXCEPTION WHEN others THEN NULL; END;
      END IF;
    END IF;
  END IF;
END $$;

-- End of sync

