-- Rename legacy tables to module-prefixed names for Conversation Hub
-- Idempotent and safe to re-run. Creates optional compatibility views.

DO $$
BEGIN
  -- visitors -> mod_conversation_hub_visitors
  IF to_regclass('public.mod_conversation_hub_visitors') IS NULL THEN
    IF to_regclass('public.visitors') IS NOT NULL THEN
      EXECUTE 'ALTER TABLE public.visitors RENAME TO mod_conversation_hub_visitors';
    END IF;
  END IF;
  -- visits -> mod_conversation_hub_visits
  IF to_regclass('public.mod_conversation_hub_visits') IS NULL THEN
    IF to_regclass('public.visits') IS NOT NULL THEN
      EXECUTE 'ALTER TABLE public.visits RENAME TO mod_conversation_hub_visits';
    END IF;
  END IF;
  -- visitor_visits -> mod_conversation_hub_visitor_visits (if such a linking table exists)
  IF to_regclass('public.mod_conversation_hub_visitor_visits') IS NULL THEN
    IF to_regclass('public.visitor_visits') IS NOT NULL THEN
      EXECUTE 'ALTER TABLE public.visitor_visits RENAME TO mod_conversation_hub_visitor_visits';
    END IF;
  END IF;
END $$;

-- Optional compatibility views (only if legacy names are now free)
DO $$
BEGIN
  IF to_regclass('public.visitors') IS NULL AND to_regclass('public.mod_conversation_hub_visitors') IS NOT NULL THEN
    EXECUTE 'CREATE VIEW public.visitors AS SELECT * FROM public.mod_conversation_hub_visitors';
  END IF;
  IF to_regclass('public.visits') IS NULL AND to_regclass('public.mod_conversation_hub_visits') IS NOT NULL THEN
    EXECUTE 'CREATE VIEW public.visits AS SELECT * FROM public.mod_conversation_hub_visits';
  END IF;
  IF to_regclass('public.visitor_visits') IS NULL AND to_regclass('public.mod_conversation_hub_visitor_visits') IS NOT NULL THEN
    EXECUTE 'CREATE VIEW public.visitor_visits AS SELECT * FROM public.mod_conversation_hub_visitor_visits';
  END IF;
END $$;

