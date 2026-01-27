-- Index customer_email for fast "history by email" lookup (idempotent)
-- Europe/Prague date: 2026-01-22

DO $$
BEGIN
  IF to_regclass('public.mod_conversation_hub_visitors') IS NOT NULL THEN
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_mod_ch_visitors_customer_email_lower
        ON public.mod_conversation_hub_visitors (lower(customer_email))
        WHERE customer_email IS NOT NULL AND btrim(customer_email) <> '';
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

