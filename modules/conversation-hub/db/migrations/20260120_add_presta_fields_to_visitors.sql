-- Add Presta visitor_hello fields to Conversation Hub visitors table (idempotent)
-- This lets Visitor Details show shop/lang IDs and chatbot id even after reload.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'mod_conversation_hub_visitors'
       AND c.relkind = 'r'
  ) THEN
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

    BEGIN
      CREATE INDEX IF NOT EXISTS idx_mod_ch_visitors_shop_lang
        ON public.mod_conversation_hub_visitors(id_shop, id_lang);
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

