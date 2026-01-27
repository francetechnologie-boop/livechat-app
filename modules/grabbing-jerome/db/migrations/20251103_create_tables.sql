-- Create module tables for grabbing-jerome (idempotent)
CREATE TABLE IF NOT EXISTS mod_grabbing_jerome_domains (
  domain TEXT PRIMARY KEY,
  sitemap_url TEXT,
  sitemaps JSONB,
  selected_sitemaps JSONB,
  sitemap_total_urls INTEGER DEFAULT 0,
  config JSONB,
  config_transfert JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mod_grabbing_jerome_domains_url (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT,
  title TEXT,
  page_type TEXT,
  meta JSONB,
  product JSONB,
  explored TIMESTAMPTZ,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mod_grabbing_jerome_domains_url_domain_idx ON mod_grabbing_jerome_domains_url (domain);
CREATE UNIQUE INDEX IF NOT EXISTS mod_grabbing_jerome_domains_url_uq ON mod_grabbing_jerome_domains_url (domain, lower(trim(both from url)));

