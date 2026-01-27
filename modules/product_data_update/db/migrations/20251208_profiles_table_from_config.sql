-- Replace compatibility VIEW with a real TABLE for mod_product_data_translator_profiles
-- and keep it synchronized from the canonical table mod_product_data_translator_config.

-- 1) If an object named mod_product_data_translator_profiles exists and is a VIEW, drop it
DO $$
DECLARE
  obj_kind TEXT := NULL;
BEGIN
  SELECT c.relkind::text
    INTO obj_kind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'mod_product_data_translator_profiles';

  IF obj_kind = 'v' THEN
    BEGIN
      EXECUTE 'DROP VIEW IF EXISTS public.mod_product_data_translator_profiles';
    EXCEPTION WHEN others THEN NULL; -- tolerate concurrent access
    END;
  END IF;
END $$;

-- 2) Create the TABLE if it does not exist
CREATE TABLE IF NOT EXISTS public.mod_product_data_translator_profiles (
  id           INTEGER PRIMARY KEY,
  org_id       INTEGER NULL,
  name         VARCHAR(255) NOT NULL,
  profile_id   INTEGER NULL,
  prefix       VARCHAR(64) NULL,
  id_shop      INTEGER NULL,
  lang_from_id INTEGER NULL,
  lang_to_id   INTEGER NULL,
  fields       JSONB NULL,
  prompt_config_id TEXT NULL,
  limits       JSONB NULL,
  overwrite    BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW()
);

-- 3) Ensure org index exists (as required by validators)
DO $$ BEGIN
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_pdu_translator_profiles_org ON public.mod_product_data_translator_profiles((COALESCE(org_id,-1)));
  EXCEPTION WHEN others THEN NULL; END;
END $$;

-- 4) Backfill data from canonical config table for any missing rows
DO $$ BEGIN
  IF to_regclass('public.mod_product_data_translator_config') IS NOT NULL THEN
    BEGIN
      INSERT INTO public.mod_product_data_translator_profiles
        (id, org_id, name, profile_id, prefix, id_shop, lang_from_id, lang_to_id, fields, prompt_config_id, limits, overwrite, created_at, updated_at)
      SELECT c.id, c.org_id, c.name, c.profile_id, c.prefix, c.id_shop, c.lang_from_id, c.lang_to_id, c.fields, c.prompt_config_id, c.limits, c.overwrite, c.created_at, c.updated_at
        FROM public.mod_product_data_translator_config c
       WHERE NOT EXISTS (
              SELECT 1 FROM public.mod_product_data_translator_profiles p WHERE p.id = c.id
            );
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;

-- 5) Create triggers to keep TABLE in sync from CONFIG (one-way, config is canonical)
DO $$
BEGIN
  -- Upsert on INSERT/UPDATE of config
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='pdu_sync_profiles_from_config'
  ) THEN
    CREATE FUNCTION public.pdu_sync_profiles_from_config() RETURNS trigger AS $$
    BEGIN
      INSERT INTO public.mod_product_data_translator_profiles
        (id, org_id, name, profile_id, prefix, id_shop, lang_from_id, lang_to_id, fields, prompt_config_id, limits, overwrite, created_at, updated_at)
      VALUES
        (NEW.id, NEW.org_id, NEW.name, NEW.profile_id, NEW.prefix, NEW.id_shop, NEW.lang_from_id, NEW.lang_to_id, NEW.fields, NEW.prompt_config_id, NEW.limits, NEW.overwrite, COALESCE(NEW.created_at, NOW()), COALESCE(NEW.updated_at, NOW()))
      ON CONFLICT (id) DO UPDATE SET
        org_id = EXCLUDED.org_id,
        name = EXCLUDED.name,
        profile_id = EXCLUDED.profile_id,
        prefix = EXCLUDED.prefix,
        id_shop = EXCLUDED.id_shop,
        lang_from_id = EXCLUDED.lang_from_id,
        lang_to_id = EXCLUDED.lang_to_id,
        fields = EXCLUDED.fields,
        prompt_config_id = EXCLUDED.prompt_config_id,
        limits = EXCLUDED.limits,
        overwrite = EXCLUDED.overwrite,
        created_at = public.mod_product_data_translator_profiles.created_at,
        updated_at = NOW();
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
  END IF;

  -- Delete from profiles when a config row is deleted
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='pdu_delete_profiles_from_config'
  ) THEN
    CREATE FUNCTION public.pdu_delete_profiles_from_config() RETURNS trigger AS $$
    BEGIN
      DELETE FROM public.mod_product_data_translator_profiles WHERE id = OLD.id;
      RETURN OLD;
    END; $$ LANGUAGE plpgsql;
  END IF;

  -- Attach triggers if config exists
  IF to_regclass('public.mod_product_data_translator_config') IS NOT NULL THEN
    -- INSERT/UPDATE trigger
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname='mod_product_data_translator_config' AND t.tgname='tr_pdu_cfg_sync_profiles') THEN
      CREATE TRIGGER tr_pdu_cfg_sync_profiles
        AFTER INSERT OR UPDATE ON public.mod_product_data_translator_config
        FOR EACH ROW EXECUTE FUNCTION public.pdu_sync_profiles_from_config();
    END IF;
    -- DELETE trigger
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname='mod_product_data_translator_config' AND t.tgname='tr_pdu_cfg_del_profiles') THEN
      CREATE TRIGGER tr_pdu_cfg_del_profiles
        AFTER DELETE ON public.mod_product_data_translator_config
        FOR EACH ROW EXECUTE FUNCTION public.pdu_delete_profiles_from_config();
    END IF;
  END IF;
END $$;

