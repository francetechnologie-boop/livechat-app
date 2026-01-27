-- Mapping/Settings history per domain+page_type
CREATE TABLE IF NOT EXISTS public.mod_grabbing_jerome_domain_type_config_hist (
  id BIGSERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  page_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  config JSONB NULL,
  tables JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mod_gj_dt_cfg_hist_key_idx ON public.mod_grabbing_jerome_domain_type_config_hist (domain, page_type, version);

