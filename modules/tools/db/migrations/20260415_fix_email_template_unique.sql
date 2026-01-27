-- Fix mod_tools_email_template unique constraints for NULL org_id.
-- Replaces expression-based unique index with two partial unique indexes so ON CONFLICT can work.

DO $$ BEGIN
  IF to_regclass('public.mod_tools_email_template') IS NOT NULL THEN
    -- Old (invalid for ON CONFLICT inference): COALESCE(org_id,0) expression index
    BEGIN
      DROP INDEX IF EXISTS public.uq_mod_tools_email_template_scope;
    EXCEPTION
      WHEN others THEN NULL;
    END;

    -- Unique for global templates (org_id IS NULL)
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_tools_email_template_scope_global
      ON public.mod_tools_email_template (template_type, id_shop, id_lang)
      WHERE org_id IS NULL;

    -- Unique for org-scoped templates (org_id IS NOT NULL)
    CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_tools_email_template_scope_org
      ON public.mod_tools_email_template (org_id, template_type, id_shop, id_lang)
      WHERE org_id IS NOT NULL;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

