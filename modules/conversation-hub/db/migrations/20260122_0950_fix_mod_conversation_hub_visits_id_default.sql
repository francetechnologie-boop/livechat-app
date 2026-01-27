-- Fix mod_conversation_hub_visits.id default/sequence (idempotent)
-- Some installs created the table manually with a missing `visits_id_seq`, causing inserts to fail silently.
-- Europe/Prague date: 2026-01-22

DO $$
DECLARE
  has_id BOOLEAN := FALSE;
  is_identity BOOLEAN := FALSE;
  id_type TEXT := NULL;
  max_id BIGINT := 0;
BEGIN
  IF to_regclass('public.mod_conversation_hub_visits') IS NULL THEN
    RETURN;
  END IF;

  SELECT TRUE,
         (a.attidentity <> '') AS is_identity,
         format_type(a.atttypid, a.atttypmod) AS id_type
    INTO has_id, is_identity, id_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname = 'mod_conversation_hub_visits'
     AND a.attname = 'id'
     AND a.attnum > 0
     AND NOT a.attisdropped
   LIMIT 1;

  IF NOT has_id OR is_identity THEN
    RETURN;
  END IF;

  -- Only attempt to fix integer-like ids (serial semantics).
  IF id_type IS NULL OR id_type NOT IN ('integer', 'bigint', 'int4', 'int8') THEN
    RETURN;
  END IF;

  -- Ensure a known-good sequence exists.
  BEGIN
    EXECUTE 'CREATE SEQUENCE IF NOT EXISTS public.mod_conversation_hub_visits_id_seq';
  EXCEPTION WHEN others THEN NULL;
  END;

  -- Ensure column default uses this sequence.
  BEGIN
    EXECUTE 'ALTER TABLE public.mod_conversation_hub_visits ALTER COLUMN id SET DEFAULT nextval(''public.mod_conversation_hub_visits_id_seq''::regclass)';
  EXCEPTION WHEN others THEN NULL;
  END;

  -- Make ownership explicit (helps dumps/migrations).
  BEGIN
    EXECUTE 'ALTER SEQUENCE public.mod_conversation_hub_visits_id_seq OWNED BY public.mod_conversation_hub_visits.id';
  EXCEPTION WHEN others THEN NULL;
  END;

  -- Align sequence position with current max(id) to avoid duplicates.
  BEGIN
    EXECUTE 'SELECT COALESCE(MAX(id), 0) FROM public.mod_conversation_hub_visits' INTO max_id;
    EXECUTE format('SELECT setval(%L::regclass, %s, false)', 'public.mod_conversation_hub_visits_id_seq', (max_id + 1));
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

