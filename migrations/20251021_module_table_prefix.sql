-- up
-- Rename legacy module tables to new prefixed names: mod_<module_id_snake>_<name>

-- Tools: tools_config -> mod_tools_config
DO $$ BEGIN
  IF to_regclass('public.tools_config') IS NOT NULL AND to_regclass('public.mod_tools_config') IS NULL THEN
    ALTER TABLE public.tools_config RENAME TO mod_tools_config;
    -- Rename unique constraint/index names if they conflict later (optional)
    -- Names auto-update for table namespace; keep as-is unless needed.
  END IF;
END $$;

-- Logs2 examples -> mod_logs2_examples
DO $$ BEGIN
  IF to_regclass('public.examples') IS NOT NULL AND to_regclass('public.mod_logs2_examples') IS NULL THEN
    -- Only rename when this 'examples' table looks like logs2 demo (heuristic: has column 'name')
    -- In ambiguous environments, adjust manually.
    PERFORM 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='examples' AND column_name='name';
    IF FOUND THEN
      ALTER TABLE public.examples RENAME TO mod_logs2_examples;
    END IF;
  END IF;
END $$;

-- Module-template examples -> mod_module_template_examples
DO $$ BEGIN
  IF to_regclass('public.mod_module_template_examples') IS NULL THEN
    IF to_regclass('public.examples') IS NOT NULL THEN
      -- If another examples table remains (e.g., from template), move it too
      ALTER TABLE public.examples RENAME TO mod_module_template_examples;
    END IF;
  END IF;
END $$;

-- down
-- No down (avoid data loss and ambiguity in legacy naming)

