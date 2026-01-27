-- Improve performance of domains listing and search for Grabbing-Jerome
-- Idempotent indexes and optional pg_trgm extension

-- Enable pg_trgm extension if available (best-effort)
DO $$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION
    WHEN others THEN NULL;
  END;
END $$;

-- Index to accelerate ORDER BY updated_at DESC with LIMIT
CREATE INDEX IF NOT EXISTS idx_mod_gj_domains_updated_at_desc
  ON public.mod_grabbing_jerome_domains (updated_at DESC);

-- Trigram indexes to speed up ILIKE/contains search on domain and sitemap_url
-- Note: lower(domain) and lower(coalesce(sitemap_url,'')) are used in queries.
CREATE INDEX IF NOT EXISTS idx_mod_gj_domains_domain_trgm
  ON public.mod_grabbing_jerome_domains
  USING GIN ((lower(domain)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_mod_gj_domains_sitemap_trgm
  ON public.mod_grabbing_jerome_domains
  USING GIN ((lower(coalesce(sitemap_url,''))) gin_trgm_ops);
