-- Seed Smart Settings + Table mapping for animo-concept.com (page_type=product)
-- Idempotent: safe to re-run; only upserts the desired values

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='mod_grabbing_jerome_domains'
  ) THEN
    CREATE TABLE public.mod_grabbing_jerome_domains (
      domain text primary key,
      sitemap_url text,
      sitemaps jsonb,
      selected_sitemaps jsonb,
      sitemap_total_urls integer default 0,
      config jsonb,
      config_transfert jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  END IF;
END $$;

-- Ensure domain row exists
INSERT INTO public.mod_grabbing_jerome_domains(domain, updated_at)
VALUES ('animo-concept.com', now())
ON CONFLICT (domain) DO UPDATE SET updated_at = now();

-- Mapping JSON per-table (same shape UI persists into table-settings.mapping)
-- Upsert per-table mappings (inline JSON; avoid CTE scope issues across statements)
INSERT INTO public.mod_grabbing_jerome_table_settings(domain, page_type, table_name, settings, mapping, created_at, updated_at)
SELECT 'animo-concept.com','product','product', '{}'::jsonb,
       $$
       {
         "fields": {
           "price": ["product.price"],
           "reference": ["product.sku", "json_ld.mapped.mpn"],
           "ean13": ["json_ld.mapped.gtin13"],
           "mpn": ["json_ld.mapped.mpn"],
           "width": ["json_ld.mapped.width"],
           "height": ["json_ld.mapped.height"],
           "depth": ["json_ld.mapped.depth"],
           "weight": ["json_ld.mapped.weight"]
         },
         "defaults": {}
       }
       $$::jsonb,
       now(), now()
ON CONFLICT (domain, page_type, table_name)
DO UPDATE SET mapping = EXCLUDED.mapping, updated_at = now();

INSERT INTO public.mod_grabbing_jerome_table_settings(domain, page_type, table_name, settings, mapping, created_at, updated_at)
SELECT 'animo-concept.com','product','product_shop', jsonb_build_object('id_shops', jsonb_build_array(3,5,6,7,8,9,10)),
       $$
       {
         "fields": {
           "price": ["product.price"],
           "visibility": ["product.visibility"],
           "condition": ["product.condition"],
           "available_for_order": ["product.available_for_order"],
           "show_price": ["product.show_price"],
           "indexed": ["product.indexed"]
         },
         "defaults": {}
       }
       $$::jsonb,
       now(), now()
ON CONFLICT (domain, page_type, table_name)
DO UPDATE SET settings = EXCLUDED.settings, mapping = EXCLUDED.mapping, updated_at = now();

INSERT INTO public.mod_grabbing_jerome_table_settings(domain, page_type, table_name, settings, mapping, created_at, updated_at)
SELECT 'animo-concept.com','product','product_lang','{}'::jsonb,
       $$
       {
         "fields": {
           "name": ["product.name", "meta.title"],
           "description": ["product.description_html", "product.description", "meta.description"],
           "link_rewrite": ["product.slug", "product.name"],
           "meta_title": ["meta.title"],
           "meta_description": ["meta.description"]
         },
         "defaults": {}
       }
       $$::jsonb,
       now(), now()
ON CONFLICT (domain, page_type, table_name)
DO UPDATE SET mapping = EXCLUDED.mapping, updated_at = now();

INSERT INTO public.mod_grabbing_jerome_table_settings(domain, page_type, table_name, settings, mapping, created_at, updated_at)
SELECT 'animo-concept.com','product','stock_available','{}'::jsonb,
       $$
       {
         "fields": {
           "quantity": ["stock.quantity", "product.quantity"],
           "out_of_stock": ["stock.out_of_stock"]
         },
         "defaults": {}
       }
       $$::jsonb,
       now(), now()
ON CONFLICT (domain, page_type, table_name)
DO UPDATE SET mapping = EXCLUDED.mapping, updated_at = now();

-- Also store the consolidated mapping under the domain config_transfert.mappings.product (inline JSON)
UPDATE public.mod_grabbing_jerome_domains d
SET config_transfert = jsonb_set(
      coalesce(d.config_transfert,'{}'::jsonb),
      '{mappings,product}',
      $$
      {
        "prefix": "ps_",
        "id_lang": 1,
        "match_by": ["reference","sku","name"],
        "defaults": {
          "product": { "visibility": "both", "condition": "new", "available_for_order": 1, "show_price": 1, "indexed": 1 },
          "product_shop": { "visibility": "both", "condition": "new", "available_for_order": 1, "show_price": 1, "indexed": 1 },
          "stock": { "out_of_stock": 0 }
        },
        "tables": {}
      }
      $$::jsonb
    ),
    updated_at = now()
WHERE d.domain = 'animo-concept.com';
