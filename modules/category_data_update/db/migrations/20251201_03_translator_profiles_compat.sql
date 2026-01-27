-- Consolidate translator profiles for Category: prefer single canonical table mod_category_data_translator_config
-- and expose a compatibility view mod_category_data_translator_profiles.

DO $$
DECLARE
  has_config boolean := FALSE;
  has_profiles boolean := FALSE;
BEGIN
  SELECT (to_regclass('public.mod_category_data_translator_config') IS NOT NULL) INTO has_config;
  SELECT (to_regclass('public.mod_category_data_translator_profiles') IS NOT NULL) INTO has_profiles;

  -- Case 1: Only legacy table exists → rename to canonical name
  IF has_profiles AND NOT has_config THEN
    BEGIN
      ALTER TABLE public.mod_category_data_translator_profiles RENAME TO mod_category_data_translator_config;
    EXCEPTION WHEN others THEN NULL; -- tolerate if busy/locked, re-run later
    END;
    -- Mark flags for following steps
    has_config := TRUE;
    has_profiles := (to_regclass('public.mod_category_data_translator_profiles') IS NOT NULL);
  END IF;

  -- Case 2: Both exist → copy missing rows into config and keep a compatibility view
  IF has_profiles AND has_config THEN
    BEGIN
      -- Create (org_id, name) helper index on config to speed NOT EXISTS checks
      PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname='idx_cdu_translator_config_org_name';
      IF NOT FOUND THEN
        BEGIN
          CREATE INDEX idx_cdu_translator_config_org_name ON public.mod_category_data_translator_config((COALESCE(org_id,-1)), name);
        EXCEPTION WHEN others THEN NULL;
        END;
      END IF;

      -- Copy rows that are not present by (org_id, name)
      -- If config still has legacy lang_to_id, include it; otherwise copy remaining columns only
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='mod_category_data_translator_config' AND column_name='lang_to_id'
        ) THEN
          INSERT INTO public.mod_category_data_translator_config
            (org_id, name, profile_id, prefix, id_shop, lang_from_id, lang_to_id, fields, prompt_config_id, limits, overwrite, created_at, updated_at)
          SELECT p.org_id, p.name, p.profile_id, p.prefix, p.id_shop, p.lang_from_id, p.lang_to_id,
                 p.fields, p.prompt_config_id, p.limits, p.overwrite, p.created_at, p.updated_at
            FROM public.mod_category_data_translator_profiles p
           WHERE NOT EXISTS (
                  SELECT 1 FROM public.mod_category_data_translator_config c
                   WHERE COALESCE(c.org_id,-1) = COALESCE(p.org_id,-1)
                     AND c.name = p.name
                );
        ELSE
          INSERT INTO public.mod_category_data_translator_config
            (org_id, name, profile_id, prefix, id_shop, lang_from_id, fields, prompt_config_id, limits, overwrite, created_at, updated_at)
          SELECT p.org_id, p.name, p.profile_id, p.prefix, p.id_shop, p.lang_from_id,
                 p.fields, p.prompt_config_id, p.limits, p.overwrite, p.created_at, p.updated_at
            FROM public.mod_category_data_translator_profiles p
           WHERE NOT EXISTS (
                  SELECT 1 FROM public.mod_category_data_translator_config c
                   WHERE COALESCE(c.org_id,-1) = COALESCE(p.org_id,-1)
                     AND c.name = p.name
                );
        END IF;
      EXCEPTION WHEN others THEN NULL; END;
    EXCEPTION WHEN others THEN NULL;
    END;

    -- Rename legacy table aside and create a compatibility view
    BEGIN
      ALTER TABLE public.mod_category_data_translator_profiles RENAME TO mod_category_data_translator_profiles_old;
    EXCEPTION WHEN undefined_table THEN NULL; WHEN others THEN NULL;
    END;
    BEGIN
      DROP VIEW IF EXISTS public.mod_category_data_translator_profiles;
    EXCEPTION WHEN others THEN NULL;
    END;
    BEGIN
      CREATE VIEW public.mod_category_data_translator_profiles AS
        SELECT * FROM public.mod_category_data_translator_config;
    EXCEPTION WHEN others THEN NULL;
    END;
  ELSIF has_config AND NOT has_profiles THEN
    -- Only config exists → ensure a compatibility view is present
    BEGIN
      DROP VIEW IF EXISTS public.mod_category_data_translator_profiles;
    EXCEPTION WHEN others THEN NULL;
    END;
    BEGIN
      CREATE VIEW public.mod_category_data_translator_profiles AS
        SELECT * FROM public.mod_category_data_translator_config;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;
