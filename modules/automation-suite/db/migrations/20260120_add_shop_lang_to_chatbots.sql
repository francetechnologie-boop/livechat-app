-- Add shop/language numeric ids to chatbots (idempotent)
DO $$ BEGIN
  IF to_regclass('public.mod_automation_suite_chatbots') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.mod_automation_suite_chatbots
        ADD COLUMN IF NOT EXISTS id_shop INT NULL;
      ALTER TABLE public.mod_automation_suite_chatbots
        ADD COLUMN IF NOT EXISTS id_lang INT NULL;
    EXCEPTION WHEN others THEN NULL;
    END;

    BEGIN
      CREATE INDEX IF NOT EXISTS mod_as_chatbots_shop_lang_idx
        ON public.mod_automation_suite_chatbots(id_shop, id_lang);
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

