-- 20260105_gateway_table_prefix.sql
-- Purpose: Align legacy gateway tables with `mod_gateway_*` naming convention.
-- Notes:
--  - Safe/idempotent: guarded renames + compatibility views.
--  - This migration does NOT drop data.

DO $$ BEGIN
  -- sms_conversation -> mod_gateway_sms_conversation
  IF to_regclass('public.sms_conversation') IS NOT NULL
     AND to_regclass('public.mod_gateway_sms_conversation') IS NULL THEN
    BEGIN
      ALTER TABLE public.sms_conversation RENAME TO mod_gateway_sms_conversation;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  -- sms_status -> mod_gateway_sms_status
  IF to_regclass('public.sms_status') IS NOT NULL
     AND to_regclass('public.mod_gateway_sms_status') IS NULL THEN
    BEGIN
      ALTER TABLE public.sms_status RENAME TO mod_gateway_sms_status;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  -- call_logs -> mod_gateway_call_logs
  IF to_regclass('public.call_logs') IS NOT NULL
     AND to_regclass('public.mod_gateway_call_logs') IS NULL THEN
    BEGIN
      ALTER TABLE public.call_logs RENAME TO mod_gateway_call_logs;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- Compatibility views (keep legacy names readable for old tooling)
DO $$ BEGIN
  IF to_regclass('public.sms_conversation') IS NULL
     AND to_regclass('public.mod_gateway_sms_conversation') IS NOT NULL THEN
    BEGIN
      CREATE VIEW public.sms_conversation AS
        SELECT * FROM public.mod_gateway_sms_conversation;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  IF to_regclass('public.sms_status') IS NULL
     AND to_regclass('public.mod_gateway_sms_status') IS NOT NULL THEN
    BEGIN
      CREATE VIEW public.sms_status AS
        SELECT * FROM public.mod_gateway_sms_status;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  IF to_regclass('public.call_logs') IS NULL
     AND to_regclass('public.mod_gateway_call_logs') IS NOT NULL THEN
    BEGIN
      CREATE VIEW public.call_logs AS
        SELECT * FROM public.mod_gateway_call_logs;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- Ensure indexes exist on renamed tables (best-effort)
DO $$ BEGIN
  BEGIN
    IF to_regclass('public.mod_gateway_call_logs') IS NOT NULL THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mod_gateway_call_logs_created ON public.mod_gateway_call_logs (created_at DESC)';
    END IF;
  EXCEPTION WHEN others THEN NULL;
  END;

  BEGIN
    IF to_regclass('public.mod_gateway_sms_status') IS NOT NULL THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mod_gateway_sms_status_created ON public.mod_gateway_sms_status (created_at DESC)';
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mod_gateway_sms_status_msg ON public.mod_gateway_sms_status (message_id)';
    END IF;
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

