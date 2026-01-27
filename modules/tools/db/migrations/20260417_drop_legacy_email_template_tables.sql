-- Drop legacy email template tables (Tools module).
-- These tables are deprecated and replaced by public.mod_tools_email_template.

DROP TABLE IF EXISTS public.mod_tools_email_template_sources CASCADE;
DROP TABLE IF EXISTS public.mod_tools_email_template_types CASCADE;
DROP TABLE IF EXISTS public.mod_tools_email_subject_translations CASCADE;

