-- Tune category_lang field fallbacks for article mapping on animo-concept.com
-- Ensures name/meta/description fields resolve from page meta/title when category.* is missing
-- Idempotent: overrides the fields block in both table_settings.mapping and domain_type_config.config

DO $do$
DECLARE
  v_domain TEXT := 'animo-concept.com';
  v_page   TEXT := 'article';
  v_fields JSONB := $fld$
  {
    "name": ["category.name", "category_name", "meta.title", "$.json_ld.mapped.name", "$.json_ld.raw.name", "title"],
    "meta_title": ["category.meta_title", "category_meta_title", "meta.title", "category.name", "category_name"],
    "description": ["category.description", "category_description", "meta.description"],
    "link_rewrite": ["category.slug", "category_link_rewrite", "category.name", "category_name", "meta.title", "title"],
    "meta_keywords": ["category.meta_keywords"],
    "meta_description": ["category.meta_description", "category_meta_description", "meta.description", "category.description", "category_description"],
    "additional_description": ["category.additional_description"]
  }
  $fld$::jsonb;
BEGIN
  -- Update per-table mapping in table_settings
  UPDATE public.mod_grabbing_jerome_table_settings
     SET mapping = jsonb_set(COALESCE(mapping,'{}'::jsonb), '{fields}', v_fields, true),
         updated_at = now()
   WHERE domain = v_domain AND lower(page_type)=lower(v_page) AND table_name='category_lang';

  -- Update editor/preview config in unified domain_type_config
  UPDATE public.mod_grabbing_jerome_domain_type_config
     SET config = jsonb_set(config, '{tables,category_lang,fields}', v_fields, true),
         updated_at = now()
   WHERE domain = v_domain AND lower(page_type)=lower(v_page);
END $do$;
