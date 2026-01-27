-- Cleanup redundant indexes on Conversation Hub tables (safe/idempotent)
-- Europe/Prague date: 2026-01-22

DO $$
BEGIN
  -- `visitors_visitor_id_unique` is redundant if `visitor_id` is already a PRIMARY KEY.
  IF to_regclass('public.visitors_visitor_id_unique') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DROP INDEX public.visitors_visitor_id_unique';
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

