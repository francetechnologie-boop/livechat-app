CREATE TABLE IF NOT EXISTS mod_tools_devis_translations (
  id SERIAL PRIMARY KEY,
  org_id INT NULL,
  shop_id INT NOT NULL,
  lang_id INT NOT NULL,
  iso_code TEXT NULL,
  locale TEXT NULL,
  vendor JSONB NOT NULL DEFAULT '{}'::jsonb,
  labels JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_tools_devis_translations_org ON mod_tools_devis_translations(org_id);
CREATE INDEX IF NOT EXISTS idx_mod_tools_devis_translations_shop_lang ON mod_tools_devis_translations(shop_id, lang_id);

-- Enforce one default row (org_id IS NULL) per (shop_id, lang_id)
DO $$ BEGIN
  BEGIN
    CREATE UNIQUE INDEX uq_mod_tools_devis_translations_default
      ON mod_tools_devis_translations (shop_id, lang_id)
      WHERE org_id IS NULL;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
  END;
END $$;

-- Enforce one org-scoped row per (org_id, shop_id, lang_id)
DO $$ BEGIN
  BEGIN
    CREATE UNIQUE INDEX uq_mod_tools_devis_translations_org
      ON mod_tools_devis_translations (org_id, shop_id, lang_id)
      WHERE org_id IS NOT NULL;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN others THEN NULL;
  END;
END $$;

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
      ALTER TABLE public.mod_tools_devis_translations
        ADD CONSTRAINT fk_mod_tools_devis_translations_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

