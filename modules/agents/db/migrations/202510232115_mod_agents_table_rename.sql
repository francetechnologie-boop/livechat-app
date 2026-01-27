-- Module: agents
-- Purpose: adopt module table naming convention by renaming 'agents' to
--          'mod_agents_agents', add org_id, and expose a compatibility view.
-- Notes:
-- - Idempotent (safe to re-run)
-- - Keeps existing data and constraints
-- - FK constraints that referenced 'agents' follow the renamed table
-- - A read-through view 'agents' preserves legacy code paths

DO $$
BEGIN
  -- Rename legacy table to module-prefixed name
  IF to_regclass('public.mod_agents_agents') IS NULL AND to_regclass('public.agents') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.agents RENAME TO mod_agents_agents';
  END IF;

  -- Ensure required columns exist on the new table
  IF to_regclass('public.mod_agents_agents') IS NOT NULL THEN
    BEGIN EXECUTE 'ALTER TABLE public.mod_agents_agents ADD COLUMN IF NOT EXISTS org_id INT NULL'; EXCEPTION WHEN others THEN END;
    BEGIN EXECUTE 'ALTER TABLE public.mod_agents_agents ADD COLUMN IF NOT EXISTS ui_state JSONB'; EXCEPTION WHEN others THEN END;
    BEGIN EXECUTE 'ALTER TABLE public.mod_agents_agents ADD COLUMN IF NOT EXISTS preferred_lang TEXT'; EXCEPTION WHEN others THEN END;
    BEGIN EXECUTE 'ALTER TABLE public.mod_agents_agents ADD COLUMN IF NOT EXISTS notifications JSONB'; EXCEPTION WHEN others THEN END;
    BEGIN EXECUTE 'ALTER TABLE public.mod_agents_agents ADD COLUMN IF NOT EXISTS theme_color TEXT'; EXCEPTION WHEN others THEN END;
    BEGIN EXECUTE 'ALTER TABLE public.mod_agents_agents ADD COLUMN IF NOT EXISTS theme_color2 TEXT'; EXCEPTION WHEN others THEN END;
    -- Useful index for org scoping
    BEGIN EXECUTE 'CREATE INDEX IF NOT EXISTS idx_mod_agents_agents_org_id ON public.mod_agents_agents(org_id)'; EXCEPTION WHEN others THEN END;
  END IF;
END $$;

-- Back-compat view so existing queries to 'agents' keep working
DO $$
BEGIN
  IF to_regclass('public.mod_agents_agents') IS NOT NULL THEN
    BEGIN
      EXECUTE 'CREATE OR REPLACE VIEW public.agents AS SELECT * FROM public.mod_agents_agents';
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;

