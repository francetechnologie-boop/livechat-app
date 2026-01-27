-- Unified email templates stored in Postgres (Tools module)
-- Table: mod_tools_email_template
-- Columns: org_id, template_type, id_shop, id_lang, subject, html_body

CREATE TABLE IF NOT EXISTS public.mod_tools_email_template (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NULL,
  template_type TEXT NOT NULL,
  id_shop INTEGER NOT NULL DEFAULT 0,
  id_lang INTEGER NOT NULL DEFAULT 0,
  subject TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
);

-- Guarded FK to organizations(id) with ON DELETE SET NULL (keep migration portable)
DO $$ BEGIN
  IF to_regclass('public.organizations') IS NOT NULL AND EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class t ON t.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (i.indkey)
     WHERE n.nspname = 'public' AND t.relname = 'organizations'
       AND i.indisunique = TRUE
       AND array_length(i.indkey,1) = 1
       AND a.attname = 'id'
  ) THEN
    BEGIN
      ALTER TABLE public.mod_tools_email_template
        ADD CONSTRAINT fk_mod_tools_email_template_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- Uniqueness:
-- - For org_id IS NULL ("global templates"): unique by (template_type, id_shop, id_lang)
-- - For org_id IS NOT NULL: unique by (org_id, template_type, id_shop, id_lang)
CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_tools_email_template_scope_global
  ON public.mod_tools_email_template (template_type, id_shop, id_lang)
  WHERE org_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mod_tools_email_template_scope_org
  ON public.mod_tools_email_template (org_id, template_type, id_shop, id_lang)
  WHERE org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mod_tools_email_template_org
  ON public.mod_tools_email_template (org_id);

CREATE INDEX IF NOT EXISTS idx_mod_tools_email_template_shop_lang
  ON public.mod_tools_email_template (id_shop, id_lang);

CREATE INDEX IF NOT EXISTS idx_mod_tools_email_template_type
  ON public.mod_tools_email_template (template_type);

-- Best-effort backfill from legacy unified templates table (if present).
-- Source columns: template_name, text_subject, html_content
DO $$ BEGIN
  IF to_regclass('public.mod_tools_email_template_translations') IS NOT NULL THEN
    -- org_id IS NULL
    INSERT INTO public.mod_tools_email_template (
      org_id, template_type, id_shop, id_lang, subject, html_body, created_at, updated_at
    )
    SELECT
      NULL AS org_id,
      t.template_name AS template_type,
      COALESCE(t.id_shop, 0) AS id_shop,
      COALESCE(t.id_lang, 0) AS id_lang,
      COALESCE(t.text_subject, '') AS subject,
      COALESCE(t.html_content, '') AS html_body,
      COALESCE(t.created_at, NOW()) AS created_at,
      COALESCE(t.updated_at, NOW()) AS updated_at
    FROM public.mod_tools_email_template_translations t
    WHERE t.org_id IS NULL AND COALESCE(t.template_name, '') <> ''
    ON CONFLICT (template_type, id_shop, id_lang) WHERE org_id IS NULL
    DO UPDATE SET
      subject = CASE WHEN EXCLUDED.subject <> '' THEN EXCLUDED.subject ELSE public.mod_tools_email_template.subject END,
      html_body = CASE WHEN EXCLUDED.html_body <> '' THEN EXCLUDED.html_body ELSE public.mod_tools_email_template.html_body END,
      updated_at = NOW();

    -- org_id IS NOT NULL
    INSERT INTO public.mod_tools_email_template (
      org_id, template_type, id_shop, id_lang, subject, html_body, created_at, updated_at
    )
    SELECT
      t.org_id,
      t.template_name AS template_type,
      COALESCE(t.id_shop, 0) AS id_shop,
      COALESCE(t.id_lang, 0) AS id_lang,
      COALESCE(t.text_subject, '') AS subject,
      COALESCE(t.html_content, '') AS html_body,
      COALESCE(t.created_at, NOW()) AS created_at,
      COALESCE(t.updated_at, NOW()) AS updated_at
    FROM public.mod_tools_email_template_translations t
    WHERE t.org_id IS NOT NULL AND COALESCE(t.template_name, '') <> ''
    ON CONFLICT (org_id, template_type, id_shop, id_lang) WHERE org_id IS NOT NULL
    DO UPDATE SET
      subject = CASE WHEN EXCLUDED.subject <> '' THEN EXCLUDED.subject ELSE public.mod_tools_email_template.subject END,
      html_body = CASE WHEN EXCLUDED.html_body <> '' THEN EXCLUDED.html_body ELSE public.mod_tools_email_template.html_body END,
      updated_at = NOW();
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;

-- Best-effort backfill from older multi-table schema (if present).
-- Source columns: template_name, subject, content_html, signature_html
DO $$ BEGIN
  IF to_regclass('public.mod_tools_email_templates') IS NOT NULL THEN
    -- org_id IS NULL
    INSERT INTO public.mod_tools_email_template (
      org_id, template_type, id_shop, id_lang, subject, html_body, created_at, updated_at
    )
    SELECT
      NULL AS org_id,
      x.template_name AS template_type,
      COALESCE(x.id_shop, 0) AS id_shop,
      COALESCE(x.id_lang, 0) AS id_lang,
      COALESCE(x.subject, '') AS subject,
      COALESCE(x.html_body, '') AS html_body,
      COALESCE(x.created_at, NOW()) AS created_at,
      COALESCE(x.updated_at, NOW()) AS updated_at
    FROM (
      SELECT
        t.*,
        CASE
          WHEN COALESCE(t.content_html, '') <> '' AND COALESCE(t.signature_html, '') <> '' THEN (t.content_html || '<br />' || t.signature_html)
          WHEN COALESCE(t.content_html, '') <> '' THEN t.content_html
          ELSE COALESCE(t.signature_html, '')
        END AS html_body,
        ROW_NUMBER() OVER (
          PARTITION BY t.template_name, t.id_shop, t.id_lang
          ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.id DESC
        ) AS rn
      FROM public.mod_tools_email_templates t
      WHERE t.org_id IS NULL AND COALESCE(t.template_name, '') <> ''
    ) x
    WHERE x.rn = 1
    ON CONFLICT (template_type, id_shop, id_lang) WHERE org_id IS NULL
    DO UPDATE SET
      subject = CASE WHEN EXCLUDED.subject <> '' THEN EXCLUDED.subject ELSE public.mod_tools_email_template.subject END,
      html_body = CASE WHEN EXCLUDED.html_body <> '' THEN EXCLUDED.html_body ELSE public.mod_tools_email_template.html_body END,
      updated_at = NOW();

    -- org_id IS NOT NULL
    INSERT INTO public.mod_tools_email_template (
      org_id, template_type, id_shop, id_lang, subject, html_body, created_at, updated_at
    )
    SELECT
      x.org_id,
      x.template_name AS template_type,
      COALESCE(x.id_shop, 0) AS id_shop,
      COALESCE(x.id_lang, 0) AS id_lang,
      COALESCE(x.subject, '') AS subject,
      COALESCE(x.html_body, '') AS html_body,
      COALESCE(x.created_at, NOW()) AS created_at,
      COALESCE(x.updated_at, NOW()) AS updated_at
    FROM (
      SELECT
        t.*,
        CASE
          WHEN COALESCE(t.content_html, '') <> '' AND COALESCE(t.signature_html, '') <> '' THEN (t.content_html || '<br />' || t.signature_html)
          WHEN COALESCE(t.content_html, '') <> '' THEN t.content_html
          ELSE COALESCE(t.signature_html, '')
        END AS html_body,
        ROW_NUMBER() OVER (
          PARTITION BY t.org_id, t.template_name, t.id_shop, t.id_lang
          ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST, t.id DESC
        ) AS rn
      FROM public.mod_tools_email_templates t
      WHERE t.org_id IS NOT NULL AND COALESCE(t.template_name, '') <> ''
    ) x
    WHERE x.rn = 1
    ON CONFLICT (org_id, template_type, id_shop, id_lang) WHERE org_id IS NOT NULL
    DO UPDATE SET
      subject = CASE WHEN EXCLUDED.subject <> '' THEN EXCLUDED.subject ELSE public.mod_tools_email_template.subject END,
      html_body = CASE WHEN EXCLUDED.html_body <> '' THEN EXCLUDED.html_body ELSE public.mod_tools_email_template.html_body END,
      updated_at = NOW();
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;
