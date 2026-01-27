-- Backfill org_key for grabbing-jerome module tables
-- Idempotent: safe to re-run

-- Ensure columns exist
ALTER TABLE IF EXISTS public.mod_grabbing_jerome_domains
  ADD COLUMN IF NOT EXISTS org_key TEXT NULL;
ALTER TABLE IF EXISTS public.mod_grabbing_jerome_domains_url
  ADD COLUMN IF NOT EXISTS org_key TEXT NULL;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS mod_gj_domains_orgkey_domain_idx
  ON public.mod_grabbing_jerome_domains (org_key, domain);
CREATE INDEX IF NOT EXISTS mod_gj_domains_url_orgkey_idx
  ON public.mod_grabbing_jerome_domains_url (org_key);

-- Backfill to 'org_default' when empty
UPDATE public.mod_grabbing_jerome_domains
   SET org_key = 'org_default'
 WHERE (org_key IS NULL OR btrim(org_key) = '')
   AND EXISTS (
     SELECT 1 FROM public.mod_grabbing_jerome_domains d2
     WHERE d2.domain = mod_grabbing_jerome_domains.domain
   );

UPDATE public.mod_grabbing_jerome_domains_url
   SET org_key = 'org_default'
 WHERE (org_key IS NULL OR btrim(org_key) = '');

