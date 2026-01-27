-- Backfill Conversation Hub visitor analytics fields from payload log (best-effort, idempotent)
-- Europe/Prague date: 2026-01-22

DO $$
DECLARE
  cols TEXT[];
  set_sql TEXT := '';
  where_sql TEXT := '';
BEGIN
  IF to_regclass('public.mod_conversation_hub_visitors') IS NULL THEN
    RETURN;
  END IF;
  IF to_regclass('public.mod_conversation_hub_payload_log') IS NULL THEN
    RETURN;
  END IF;

  -- Ensure common analytics columns exist on older installs (safe / idempotent)
  BEGIN
    ALTER TABLE public.mod_conversation_hub_visitors
      ADD COLUMN IF NOT EXISTS time_zone TEXT NULL,
      ADD COLUMN IF NOT EXISTS screen_w INT NULL,
      ADD COLUMN IF NOT EXISTS screen_h INT NULL,
      ADD COLUMN IF NOT EXISTS screen_dpr NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS language TEXT NULL,
      ADD COLUMN IF NOT EXISTS origin TEXT NULL,
      ADD COLUMN IF NOT EXISTS referrer TEXT NULL,
      ADD COLUMN IF NOT EXISTS page_url_last TEXT NULL,
      ADD COLUMN IF NOT EXISTS title TEXT NULL;
  EXCEPTION WHEN others THEN NULL;
  END;

  SELECT array_agg(column_name::text)
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'mod_conversation_hub_visitors';

  IF cols IS NULL THEN
    RETURN;
  END IF;

  IF ('id' = ANY(cols)) AND ('visitor_id' = ANY(cols)) THEN
    where_sql := '(v.visitor_id = l.visitor_id OR v.id = l.visitor_id)';
  ELSIF ('visitor_id' = ANY(cols)) THEN
    where_sql := 'v.visitor_id = l.visitor_id';
  ELSIF ('id' = ANY(cols)) THEN
    where_sql := 'v.id = l.visitor_id';
  ELSE
    RETURN;
  END IF;

  -- Only fill missing values (COALESCE(existing, payload_value)).
  IF 'language' = ANY(cols) THEN
    set_sql := set_sql || ', language = COALESCE(v.language, NULLIF(l.payload->>''language'', ''''))';
  END IF;
  IF 'time_zone' = ANY(cols) THEN
    set_sql := set_sql || ', time_zone = COALESCE(v.time_zone, NULLIF(l.payload->>''time_zone'', ''''))';
  END IF;
  IF 'screen_w' = ANY(cols) THEN
    set_sql := set_sql || ', screen_w = COALESCE(v.screen_w, (CASE WHEN (l.payload->>''screen_w'') ~ ''^\\d+$'' THEN (l.payload->>''screen_w'')::int ELSE NULL END))';
  END IF;
  IF 'screen_h' = ANY(cols) THEN
    set_sql := set_sql || ', screen_h = COALESCE(v.screen_h, (CASE WHEN (l.payload->>''screen_h'') ~ ''^\\d+$'' THEN (l.payload->>''screen_h'')::int ELSE NULL END))';
  END IF;
  IF 'screen_dpr' = ANY(cols) THEN
    set_sql := set_sql || ', screen_dpr = COALESCE(v.screen_dpr, (CASE WHEN (l.payload->>''screen_dpr'') ~ ''^-?\\d+(\\.\\d+)?$'' THEN (l.payload->>''screen_dpr'')::numeric ELSE NULL END))';
  END IF;
  IF 'origin' = ANY(cols) THEN
    set_sql := set_sql || ', origin = COALESCE(v.origin, NULLIF(l.payload->>''origin'', ''''))';
  END IF;
  IF 'referrer' = ANY(cols) THEN
    set_sql := set_sql || ', referrer = COALESCE(v.referrer, NULLIF(l.payload->>''referrer'', ''''))';
  END IF;
  IF 'title' = ANY(cols) THEN
    set_sql := set_sql || ', title = COALESCE(v.title, NULLIF(l.payload->>''title'', ''''))';
  END IF;
  IF 'page_url_last' = ANY(cols) THEN
    set_sql := set_sql || ', page_url_last = COALESCE(v.page_url_last, NULLIF(COALESCE(l.payload->>''page_url_last'', l.payload->>''page_url'', l.payload->>''current_url''), ''''))';
  END IF;
  IF 'current_url' = ANY(cols) THEN
    set_sql := set_sql || ', current_url = COALESCE(v.current_url, NULLIF(COALESCE(l.payload->>''current_url'', l.payload->>''currentUrl''), ''''))';
  END IF;

  set_sql := ltrim(set_sql, ', ');
  IF set_sql IS NULL OR btrim(set_sql) = '' THEN
    RETURN;
  END IF;

  EXECUTE format($q$
    WITH latest AS (
      SELECT DISTINCT ON (visitor_id)
        visitor_id,
        payload
      FROM public.mod_conversation_hub_payload_log
      WHERE direction = 'received'
        AND event = 'visitor_hello'
        AND visitor_id IS NOT NULL
        AND payload IS NOT NULL
      ORDER BY visitor_id, created_at DESC
    )
    UPDATE public.mod_conversation_hub_visitors v
       SET %s
      FROM latest l
     WHERE %s
  $q$, set_sql, where_sql);
END $$;

