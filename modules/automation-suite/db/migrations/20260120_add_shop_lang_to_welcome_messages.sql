-- Add shop/language scoping to welcome messages (idempotent)
DO $$ BEGIN
  IF to_regclass('public.mod_automation_suite_welcome_messages') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.mod_automation_suite_welcome_messages
        ADD COLUMN IF NOT EXISTS id_shop INT NULL;
      ALTER TABLE public.mod_automation_suite_welcome_messages
        ADD COLUMN IF NOT EXISTS id_lang INT NULL;
    EXCEPTION WHEN others THEN NULL;
    END;

    BEGIN
      CREATE INDEX IF NOT EXISTS mod_as_wm_shop_lang_idx
        ON public.mod_automation_suite_welcome_messages(id_shop, id_lang);
    EXCEPTION WHEN others THEN NULL;
    END;

    -- Refresh the compat view so added columns are visible (appended after the original columns)
    BEGIN
      CREATE OR REPLACE VIEW "MOD_automation-suite__welcome_messages" AS
        SELECT id, org_id, title, content, enabled, created_at, updated_at, id_shop, id_lang
        FROM public.mod_automation_suite_welcome_messages;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

