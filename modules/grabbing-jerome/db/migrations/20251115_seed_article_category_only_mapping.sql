-- Seed a clean category-only mapping for article page type on animo-concept.com
-- Idempotent: inserts a new mapping.tools version; updates unified domain_type_config

DO $do$
DECLARE
  v_domain TEXT := 'animo-concept.com';
  v_page   TEXT := 'article';
  v_next   INTEGER;
  v_config JSONB := $cfg$
  {
    "prefix": "ps_",
    "send": { "generic": true, "images": false, "documents": false, "attributes": false, "features": false },
    "tables": {
      "category": {
        "fields": {
          "active": ["category.active", "config.category_active"],
          "position": ["category.position", "config.category_position"],
          "id_parent": ["category.id_parent", "config.id_parent"],
          "id_shop_default": ["category.id_shop_default", "config.id_shop"]
        }
      },
      "category_lang": {
        "fields": {
          "name": ["category.name", "category_name"],
          "meta_title": ["category.meta_title", "category_meta_title"],
          "description": ["category.description", "category_description"],
          "link_rewrite": ["category.slug", "category_link_rewrite"],
          "meta_keywords": "category.meta_keywords",
          "meta_description": ["category.meta_description", "category_meta_description"],
          "additional_description": "category.additional_description"
        },
        "settings": { "id_langs": [1,2,3,4,5,6,7,8,9,10,11] }
      },
      "category_shop": {
        "fields": { "position": ["category.position", "config.category_position"] }
      },
      "category_group": {
        "fields": { "id_group": "groups" }
      }
    },
    "defaults": { "category": { "active": 1, "position": 0, "id_parent": 2, "id_shop_default": 1 } }
  }
  $cfg$::jsonb;
  v_tables JSONB := $tbl$
  {
    "category": {
      "fields": {
        "active": ["category.active", "config.category_active"],
        "position": ["category.position", "config.category_position"],
        "id_parent": ["category.id_parent", "config.id_parent"],
        "id_shop_default": ["category.id_shop_default", "config.id_shop"]
      }
    },
    "category_lang": {
      "fields": {
        "name": ["category.name", "category_name"],
        "meta_title": ["category.meta_title", "category_meta_title"],
        "description": ["category.description", "category_description"],
        "link_rewrite": ["category.slug", "category_link_rewrite"],
        "meta_keywords": "category.meta_keywords",
        "meta_description": ["category.meta_description", "category_meta_description"],
        "additional_description": "category.additional_description"
      },
      "settings": { "id_langs": [1,2,3,4,5,6,7,8,9,10,11] }
    },
    "category_shop": { "fields": { "position": ["category.position", "config.category_position"] } },
    "category_group": { "fields": { "id_group": "groups" } }
  }
  $tbl$::jsonb;
BEGIN
  -- Next mapping.tools version
  SELECT COALESCE(MAX(version)+1,1) INTO v_next
    FROM public.mod_grabbing_jerome_maping_tools
   WHERE regexp_replace(lower(domain),'^www\.', '') = regexp_replace(lower(v_domain), '^www\.', '')
     AND lower(page_type) = lower(v_page);

  BEGIN
    INSERT INTO public.mod_grabbing_jerome_maping_tools(domain,page_type,version,name,config,enabled,updated_at)
    VALUES (v_domain, v_page, v_next, 'category-only', v_config, true, now());
  EXCEPTION WHEN unique_violation THEN NULL; WHEN others THEN NULL; END;

  -- Mirror into unified domain_type_config (so preview/editor load it immediately)
  BEGIN
    INSERT INTO public.mod_grabbing_jerome_domain_type_config(domain,page_type,config,tables,version,created_at,updated_at)
    VALUES (v_domain, v_page, v_config, v_tables, 1, now(), now())
    ON CONFLICT (domain,page_type)
    DO UPDATE SET config = EXCLUDED.config,
                  tables = EXCLUDED.tables,
                  version = COALESCE(public.mod_grabbing_jerome_domain_type_config.version,1)+1,
                  updated_at = now();
  EXCEPTION WHEN others THEN NULL; END;
END $do$;
