CREATE TABLE IF NOT EXISTS mod_tools_devis_products (
  id SERIAL PRIMARY KEY,
  org_id INT NULL,
  product_id INT NULL,
  reference VARCHAR(128) NOT NULL,
  name TEXT NOT NULL,
  price_ht NUMERIC(14,4) NOT NULL DEFAULT 0,
  price_ttc NUMERIC(14,4) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'EUR',
  description TEXT,
  description_short TEXT,
  image_url TEXT,
  product_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_tools_devis_products_org ON mod_tools_devis_products(org_id);
CREATE INDEX IF NOT EXISTS idx_mod_tools_devis_products_reference ON mod_tools_devis_products(reference);
CREATE INDEX IF NOT EXISTS idx_mod_tools_devis_products_name ON mod_tools_devis_products(name);

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
      ALTER TABLE public.mod_tools_devis_products
        ADD CONSTRAINT fk_mod_tools_devis_products_org
        FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE SET NULL;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN others THEN NULL;
    END;
  END IF;
END $$;

INSERT INTO mod_tools_devis_products (org_id, product_id, reference, name, price_ht, price_ttc, currency, description_short, image_url, product_url)
SELECT NULL, 101, 'PUMP-101', 'Compact Circulation Pump', 150.00, 180.00, 'EUR', 'Compact circulation pump for small systems.', 'https://example.com/images/pump-101.jpg', 'https://example.com/products/101'
WHERE NOT EXISTS (SELECT 1 FROM mod_tools_devis_products WHERE reference = 'PUMP-101');

INSERT INTO mod_tools_devis_products (org_id, product_id, reference, name, price_ht, price_ttc, currency, description_short, image_url, product_url)
SELECT NULL, 202, 'FILTER-202', 'Ultra Fine Filtration Pack', 320.00, 384.00, 'EUR', 'Replacement filtration pack with activated carbon.', 'https://example.com/images/filter-202.jpg', 'https://example.com/products/202'
WHERE NOT EXISTS (SELECT 1 FROM mod_tools_devis_products WHERE reference = 'FILTER-202');
