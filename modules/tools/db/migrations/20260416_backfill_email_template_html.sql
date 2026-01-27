-- Backfill mod_tools_email_template from legacy tables (idempotent).
-- Use this when 20260405_unify_email_templates.sql was already applied before HTML sources existed.

-- From legacy unified translations table: template_name/text_subject/html_content
DO $$ BEGIN
  IF to_regclass('public.mod_tools_email_template') IS NOT NULL
     AND to_regclass('public.mod_tools_email_template_translations') IS NOT NULL THEN
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

-- From older multi-table schema: template_name/subject/content_html/signature_html
DO $$ BEGIN
  IF to_regclass('public.mod_tools_email_template') IS NOT NULL
     AND to_regclass('public.mod_tools_email_templates') IS NOT NULL THEN
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

-- From legacy split schema:
--   - public.mod_tools_email_template_sources (HTML by template_type/shop/lang)
--   - public.mod_tools_email_template_types (id -> template_type/name)
--   - public.mod_tools_email_subject_translations (subject by template_type/lang)
--
-- Best-effort & idempotent: environments may vary in column names.
DO $$ BEGIN
  IF to_regclass('public.mod_tools_email_template') IS NOT NULL
     AND to_regclass('public.mod_tools_email_template_sources') IS NOT NULL THEN
  DECLARE
    sources_has_org_id boolean := FALSE;
    sources_has_template_type boolean := FALSE;
    sources_has_template_type_id boolean := FALSE;
    sources_has_id_shop boolean := FALSE;
    sources_has_id_lang boolean := FALSE;
    sources_html_col text := NULL;

    types_name_col text := NULL;

    subj_has_org_id boolean := FALSE;
    subj_has_template_type boolean := FALSE;
    subj_has_template_type_id boolean := FALSE;
    subj_has_id_lang boolean := FALSE;
    subj_subject_col text := NULL;

    org_expr text := 'NULL';
    tt_expr text := NULL;
    shop_expr text := '0';
    lang_expr text := '0';
    html_expr text := NULL;
    join_types_for_sources text := '';

    subject_tt_expr text := NULL;
    subject_lang_expr text := NULL;
    subject_expr text := NULL;
    join_types_for_subjects text := '';

    sql text;
  BEGIN
    -- Detect columns on sources
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mod_tools_email_template_sources' AND column_name='org_id'
    ) INTO sources_has_org_id;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mod_tools_email_template_sources' AND column_name='template_type'
    ) INTO sources_has_template_type;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mod_tools_email_template_sources' AND column_name='template_type_id'
    ) INTO sources_has_template_type_id;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mod_tools_email_template_sources' AND column_name='id_shop'
    ) INTO sources_has_id_shop;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mod_tools_email_template_sources' AND column_name='id_lang'
    ) INTO sources_has_id_lang;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mod_tools_email_template_sources' AND column_name='html_body'
    ) THEN sources_html_col := 'html_body';
    ELSIF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mod_tools_email_template_sources' AND column_name='html_content'
    ) THEN sources_html_col := 'html_content';
    ELSIF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mod_tools_email_template_sources' AND column_name='content_html'
    ) THEN sources_html_col := 'content_html';
    ELSIF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='mod_tools_email_template_sources' AND column_name='html'
    ) THEN sources_html_col := 'html';
    END IF;

    -- Detect columns on types
    IF to_regclass('public.mod_tools_email_template_types') IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_tools_email_template_types' AND column_name='template_type'
      ) THEN types_name_col := 'template_type';
      ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_tools_email_template_types' AND column_name='name'
      ) THEN types_name_col := 'name';
      ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_tools_email_template_types' AND column_name='template_name'
      ) THEN types_name_col := 'template_name';
      END IF;
    END IF;

    -- Choose template_type expression for sources
    IF sources_has_template_type THEN
      tt_expr := 's.template_type';
    ELSIF sources_has_template_type_id AND types_name_col IS NOT NULL THEN
      tt_expr := format('tt.%I', types_name_col);
      join_types_for_sources := 'JOIN public.mod_tools_email_template_types tt ON tt.id = s.template_type_id';
    ELSE
      tt_expr := NULL;
    END IF;

    IF sources_has_org_id THEN org_expr := 's.org_id'; END IF;
    IF sources_has_id_shop THEN shop_expr := 'COALESCE(s.id_shop, 0)'; END IF;
    IF sources_has_id_lang THEN lang_expr := 'COALESCE(s.id_lang, 0)'; END IF;
    IF sources_html_col IS NOT NULL THEN
      html_expr := format('COALESCE(s.%I, '''')', sources_html_col);
    ELSE
      html_expr := NULL;
    END IF;

    IF tt_expr IS NOT NULL AND html_expr IS NOT NULL THEN
    -- Insert HTML rows from sources (org_id IS NULL)
    sql := format($SQL$
      INSERT INTO public.mod_tools_email_template (
        org_id, template_type, id_shop, id_lang, subject, html_body, created_at, updated_at
      )
      SELECT
        %1$s AS org_id,
        %2$s AS template_type,
        %3$s AS id_shop,
        %4$s AS id_lang,
        '' AS subject,
        %5$s AS html_body,
        NOW() AS created_at,
        NOW() AS updated_at
      FROM public.mod_tools_email_template_sources s
      %6$s
      WHERE (%1$s) IS NULL
        AND COALESCE(%2$s, '') <> ''
        AND COALESCE(%5$s, '') <> ''
      ON CONFLICT (template_type, id_shop, id_lang) WHERE org_id IS NULL
      DO UPDATE SET
        html_body = CASE WHEN EXCLUDED.html_body <> '' THEN EXCLUDED.html_body ELSE public.mod_tools_email_template.html_body END,
        updated_at = NOW();
    $SQL$, org_expr, tt_expr, shop_expr, lang_expr, html_expr, join_types_for_sources);
    EXECUTE sql;

    -- Insert HTML rows from sources (org_id IS NOT NULL) if supported
    IF sources_has_org_id THEN
      sql := format($SQL$
        INSERT INTO public.mod_tools_email_template (
          org_id, template_type, id_shop, id_lang, subject, html_body, created_at, updated_at
        )
        SELECT
          %1$s AS org_id,
          %2$s AS template_type,
          %3$s AS id_shop,
          %4$s AS id_lang,
          '' AS subject,
          %5$s AS html_body,
          NOW() AS created_at,
          NOW() AS updated_at
        FROM public.mod_tools_email_template_sources s
        %6$s
        WHERE (%1$s) IS NOT NULL
          AND COALESCE(%2$s, '') <> ''
          AND COALESCE(%5$s, '') <> ''
        ON CONFLICT (org_id, template_type, id_shop, id_lang) WHERE org_id IS NOT NULL
        DO UPDATE SET
          html_body = CASE WHEN EXCLUDED.html_body <> '' THEN EXCLUDED.html_body ELSE public.mod_tools_email_template.html_body END,
          updated_at = NOW();
      $SQL$, org_expr, tt_expr, shop_expr, lang_expr, html_expr, join_types_for_sources);
      EXECUTE sql;
    END IF;
    END IF;

    -- Backfill subjects (optional) from subject translations
    IF to_regclass('public.mod_tools_email_subject_translations') IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_tools_email_subject_translations' AND column_name='org_id'
      ) INTO subj_has_org_id;
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_tools_email_subject_translations' AND column_name='template_type'
      ) INTO subj_has_template_type;
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_tools_email_subject_translations' AND column_name='template_type_id'
      ) INTO subj_has_template_type_id;
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_tools_email_subject_translations' AND column_name='id_lang'
      ) INTO subj_has_id_lang;

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_tools_email_subject_translations' AND column_name='subject'
      ) THEN subj_subject_col := 'subject';
      ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_tools_email_subject_translations' AND column_name='text_subject_translated'
      ) THEN subj_subject_col := 'text_subject_translated';
      ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='mod_tools_email_subject_translations' AND column_name='text_subject'
      ) THEN subj_subject_col := 'text_subject';
      END IF;

      IF subj_has_id_lang AND subj_subject_col IS NOT NULL THEN
        subject_lang_expr := 'st.id_lang';
        subject_expr := format('COALESCE(st.%I, '''')', subj_subject_col);

        IF subj_has_template_type THEN
          subject_tt_expr := 'st.template_type';
        ELSIF subj_has_template_type_id AND types_name_col IS NOT NULL AND to_regclass('public.mod_tools_email_template_types') IS NOT NULL THEN
          subject_tt_expr := format('tt.%I', types_name_col);
          join_types_for_subjects := 'JOIN public.mod_tools_email_template_types tt ON tt.id = st.template_type_id';
        ELSE
          subject_tt_expr := NULL;
        END IF;

        IF subject_tt_expr IS NOT NULL THEN
          -- Update empty subjects using translations (apply to all orgs when translation org_id is NULL)
          sql := format($SQL$
            UPDATE public.mod_tools_email_template t
               SET subject = m.subject,
                   updated_at = NOW()
              FROM (
                SELECT
                  %1$s AS org_id,
                  %2$s AS template_type,
                  %3$s AS id_lang,
                  %4$s AS subject
                FROM public.mod_tools_email_subject_translations st
                %5$s
                WHERE COALESCE(%2$s, '') <> ''
                  AND COALESCE(%4$s, '') <> ''
              ) m
             WHERE t.template_type = m.template_type
               AND t.id_lang = m.id_lang
               AND (m.org_id IS NULL OR t.org_id IS NULL OR t.org_id = m.org_id)
               AND COALESCE(t.subject, '') = '';
          $SQL$,
            CASE WHEN subj_has_org_id THEN 'st.org_id' ELSE 'NULL' END,
            subject_tt_expr,
            subject_lang_expr,
            subject_expr,
            join_types_for_subjects
          );
          EXECUTE sql;
        END IF;
      END IF;
    END IF;
  END;
  END IF;
EXCEPTION
  WHEN others THEN NULL;
END $$;
