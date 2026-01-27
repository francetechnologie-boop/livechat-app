-- Backfill Conversation Hub visitor fields from payload log (best-effort, idempotent)
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

  -- Ensure expected columns exist (idempotent; safe across environments)
  BEGIN
    ALTER TABLE public.mod_conversation_hub_visitors
      ADD COLUMN IF NOT EXISTS id_shop INT NULL,
      ADD COLUMN IF NOT EXISTS id_lang INT NULL,
      ADD COLUMN IF NOT EXISTS shop_name TEXT NULL,
      ADD COLUMN IF NOT EXISTS lang_iso TEXT NULL,
      ADD COLUMN IF NOT EXISTS lang_name TEXT NULL,
      ADD COLUMN IF NOT EXISTS currency TEXT NULL,
      ADD COLUMN IF NOT EXISTS cart_total NUMERIC NULL,
      ADD COLUMN IF NOT EXISTS chatbot_id TEXT NULL,
      ADD COLUMN IF NOT EXISTS current_url TEXT NULL;
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

  -- If this install uses `id` as primary key, some rows may have visitor_id NULL.
  IF ('id' = ANY(cols)) AND ('visitor_id' = ANY(cols)) THEN
    BEGIN
      EXECUTE 'UPDATE public.mod_conversation_hub_visitors SET visitor_id = id WHERE visitor_id IS NULL AND id IS NOT NULL';
    EXCEPTION WHEN others THEN NULL;
    END;
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

  -- Build a SET clause only for columns that exist in the target table.
  IF 'id_shop' = ANY(cols) THEN
    set_sql := set_sql || ', id_shop = COALESCE(v.id_shop, (CASE WHEN (l.payload->>''id_shop'') ~ ''^\\d+$'' THEN (l.payload->>''id_shop'')::int ELSE NULL END))';
  END IF;
  IF 'id_lang' = ANY(cols) THEN
    set_sql := set_sql || ', id_lang = COALESCE(v.id_lang, (CASE WHEN (l.payload->>''id_lang'') ~ ''^\\d+$'' THEN (l.payload->>''id_lang'')::int ELSE NULL END))';
  END IF;
  IF 'shop_name' = ANY(cols) THEN
    set_sql := set_sql || ', shop_name = COALESCE(v.shop_name, NULLIF(COALESCE(l.payload->>''shop_name'', l.payload->>''shopName''), ''''))';
  END IF;
  IF 'lang_iso' = ANY(cols) THEN
    set_sql := set_sql || ', lang_iso = COALESCE(v.lang_iso, NULLIF(COALESCE(l.payload->>''shop_lang_iso'', l.payload->>''lang_iso'', l.payload->>''langIso''), ''''))';
  END IF;
  IF 'lang_name' = ANY(cols) THEN
    set_sql := set_sql || ', lang_name = COALESCE(v.lang_name, NULLIF(COALESCE(l.payload->>''shop_lang_name'', l.payload->>''lang_name''), ''''))';
  END IF;
  IF 'currency' = ANY(cols) THEN
    set_sql := set_sql || ', currency = COALESCE(v.currency, NULLIF(l.payload->>''currency'', ''''))';
  END IF;
  IF 'cart_total' = ANY(cols) THEN
    set_sql := set_sql || ', cart_total = COALESCE(v.cart_total, (CASE WHEN (l.payload->>''cart_total'') ~ ''^-?\\d+(\\.\\d+)?$'' THEN (l.payload->>''cart_total'')::numeric ELSE NULL END))';
  END IF;
  IF 'chatbot_id' = ANY(cols) THEN
    set_sql := set_sql || ', chatbot_id = COALESCE(v.chatbot_id, NULLIF(COALESCE(l.payload->>''chatbot_id'', l.payload->>''chatbotId''), ''''))';
  END IF;
  IF 'assistant_id' = ANY(cols) THEN
    set_sql := set_sql || ', assistant_id = COALESCE(v.assistant_id, NULLIF(l.payload->>''assistant_id'', ''''))';
  END IF;
  IF 'current_url' = ANY(cols) THEN
    set_sql := set_sql || ', current_url = COALESCE(v.current_url, NULLIF(COALESCE(l.payload->>''current_url'', l.payload->>''currentUrl''), ''''))';
  END IF;
  IF 'customer_email' = ANY(cols) THEN
    set_sql := set_sql || ', customer_email = COALESCE(v.customer_email, NULLIF(COALESCE(l.payload->>''customer_email'', l.payload->>''email''), ''''))';
  END IF;
  IF 'customer_firstname' = ANY(cols) THEN
    set_sql := set_sql || ', customer_firstname = COALESCE(v.customer_firstname, NULLIF(COALESCE(l.payload->>''customer_firstname'', l.payload->>''firstname''), ''''))';
  END IF;
  IF 'customer_lastname' = ANY(cols) THEN
    set_sql := set_sql || ', customer_lastname = COALESCE(v.customer_lastname, NULLIF(COALESCE(l.payload->>''customer_lastname'', l.payload->>''lastname''), ''''))';
  END IF;
  IF 'orders_count' = ANY(cols) THEN
    set_sql := set_sql || ', orders_count = COALESCE(v.orders_count, (CASE WHEN (l.payload->>''orders_count'') ~ ''^\\d+$'' THEN (l.payload->>''orders_count'')::int ELSE NULL END))';
  END IF;
  IF 'orders_amount' = ANY(cols) THEN
    set_sql := set_sql || ', orders_amount = COALESCE(v.orders_amount, (CASE WHEN (l.payload->>''orders_amount'') ~ ''^-?\\d+(\\.\\d+)?$'' THEN (l.payload->>''orders_amount'')::numeric ELSE NULL END))';
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

