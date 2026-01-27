-- Consolidate legacy mod_conversation_hub_visitor_visits into mod_conversation_hub_visits
-- Idempotent: safe to re-run. Preserves data and exposes a compatibility view.

-- 1) Ensure target table exists (best-effort); if not, create a minimal one
CREATE TABLE IF NOT EXISTS public.mod_conversation_hub_visits (
  id SERIAL PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  page_url TEXT NULL,
  title TEXT NULL,
  origin TEXT NULL,
  referrer TEXT NULL,
  utm_source TEXT NULL,
  utm_medium TEXT NULL,
  utm_campaign TEXT NULL,
  utm_term TEXT NULL,
  utm_content TEXT NULL,
  occurred_at TIMESTAMP DEFAULT NOW() NULL,
  org_id TEXT NULL
);

-- 2) Backfill from legacy table if it exists (table only)
DO $migration$
DECLARE
  legacy_is_table BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'mod_conversation_hub_visitor_visits'
      AND c.relkind = 'r' -- ordinary table
  ) INTO legacy_is_table;

  IF legacy_is_table THEN
    EXECUTE $insert$
      INSERT INTO public.mod_conversation_hub_visits (
        visitor_id, page_url, title, origin, referrer,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        occurred_at
      )
      SELECT v.visitor_id, v.page_url, v.title, v.origin, v.referrer,
             v.utm_source, v.utm_medium, v.utm_campaign, v.utm_term, v.utm_content,
             v.occurred_at
      FROM public.mod_conversation_hub_visitor_visits v
      LEFT JOIN public.mod_conversation_hub_visits t
        ON t.visitor_id = v.visitor_id
       AND COALESCE(t.page_url,'') = COALESCE(v.page_url,'')
       AND COALESCE(t.occurred_at, 'epoch'::timestamp) = v.occurred_at
      WHERE t.id IS NULL
    $insert$;

    EXECUTE 'DROP TABLE public.mod_conversation_hub_visitor_visits';
  END IF;
END $migration$;

-- 3) Ensure helpful indexes on the target table
CREATE INDEX IF NOT EXISTS idx_visits_vid_time
ON public.mod_conversation_hub_visits(visitor_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_visits_org
ON public.mod_conversation_hub_visits(org_id);

-- 4) Replace legacy table with a compatibility view (always re-create to keep schema fresh)
CREATE OR REPLACE VIEW public.mod_conversation_hub_visitor_visits AS
SELECT
  id::bigint AS id,
  visitor_id,
  occurred_at,
  page_url,
  title,
  referrer,
  origin,
  NULL::text AS "path",
  utm_source,
  utm_medium,
  utm_campaign,
  utm_term,
  utm_content
FROM public.mod_conversation_hub_visits;
