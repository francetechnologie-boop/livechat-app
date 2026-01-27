-- Seed initial suppliers (idempotent). Values derived from provided table.
-- Columns mapped: id_vendor -> vendor_code, COMPANY NAME -> name, NAME -> contact,
-- STREET ADDRESS -> street_address, CITY -> city, COUNTRY -> country, ZIP -> zip,
-- PHONE NUMBER -> phone, EMAIL -> email, TAX RATE -> tax_rate, CURRENCY -> currency.

-- Sensorex s.r.o.
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'Sensorex s.r.o.', 'MARKETA PINCOVA', 'Okružní 2615', 'České Budějovice', 'Czech Republic', '370 01', NULL, 'CZ.Orders@sensorex.com', 21.00, 'EUR', 'Sensorex s.r.o.', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='Sensorex s.r.o.' AND (s.org_id IS NULL));

-- HYDROCAL
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'HYDROCAL', 'JAN WILLEM', 'Wallerstraat 125k,', 'Nijkerk', 'the Netherlands', '3862 CN', '+31 (0)88-8760106', 'janwillem@hydrocal.nl', 0.00, 'EUR', 'HYDROCAL', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='HYDROCAL' AND (s.org_id IS NULL));

-- HAMIZA s.r.o
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'HAMIZA s.r.o', 'Miroslav Zabilka', 'Nová Ves 103', NULL, 'Czech Republic', 'CZ02604736', '+420 602 263 190', 'hamiza@email.cz', 21.00, 'CZK', 'HAMIZA s.r.o', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='HAMIZA s.r.o' AND (s.org_id IS NULL));

-- RWC
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'RWC', NULL, 'Vrbenská 2290', 'České Budějovice', 'Czech Republic', '370 01', '00 420 387 002 040', 'objednavky.cz@rwc.com', 21.00, 'CZK', 'RWC', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='RWC' AND (s.org_id IS NULL));

-- ALI EXPRESS
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'ALI EXPRESS', NULL, NULL, NULL, NULL, NULL, NULL, 'francetechnologie@gmail.com', 0.00, 'EUR', 'ALI EXPRESS', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='ALI EXPRESS' AND (s.org_id IS NULL));

-- shop.elektrosms.cz
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'shop.elektrosms.cz', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 21.00, 'CZK', 'shop.elektrosms.cz', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='shop.elektrosms.cz' AND (s.org_id IS NULL));

-- 3dtiskservice.cz
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, '3dtiskservice.cz', NULL, NULL, NULL, NULL, NULL, NULL, 'francetechnologie@gmail.com', 21.00, 'CZK', '3dtiskservice.cz', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='3dtiskservice.cz' AND (s.org_id IS NULL));

-- prumex.cz
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'prumex.cz', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 21.00, 'CZK', 'prumex.cz', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='prumex.cz' AND (s.org_id IS NULL));

-- obchod-vtp.cz
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'obchod-vtp.cz', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 21.00, 'CZK', 'obchod-vtp.cz', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='obchod-vtp.cz' AND (s.org_id IS NULL));

-- conrad.cz
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'conrad.cz', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, 'EUR', 'conrad.cz', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='conrad.cz' AND (s.org_id IS NULL));

-- imo-ag.biz
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'imo-ag.biz', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, 'EUR', 'imo-ag.biz', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='imo-ag.biz' AND (s.org_id IS NULL));

-- amazon.com
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'amazon.com', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, 'CZK', 'amazon.com', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='amazon.com' AND (s.org_id IS NULL));

-- FARNEL
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'FARNEL', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 21.00, 'CZK', 'FARNEL', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='FARNEL' AND (s.org_id IS NULL));

-- ITM (url as company)
INSERT INTO mod_bom_suppliers (org_id, name, contact, street_address, city, country, zip, phone, email, tax_rate, currency, vendor_code, meta, created_at, updated_at)
SELECT NULL, 'https://itm-components.co.uk/', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0.00, 'CZK', 'ITM', '{}'::jsonb, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM mod_bom_suppliers s WHERE s.name='https://itm-components.co.uk/' AND (s.org_id IS NULL));

-- Optional primary contacts when email/phone/name exist
-- Sensorex contact
INSERT INTO mod_bom_supplier_contacts (org_id, supplier_id, name, email, phone, role, is_primary, meta, created_at, updated_at)
SELECT NULL, s.id, 'MARKETA PINCOVA', 'CZ.Orders@sensorex.com', NULL, NULL, TRUE, '{}'::jsonb, NOW(), NOW()
FROM mod_bom_suppliers s
WHERE s.name='Sensorex s.r.o.' AND (s.org_id IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM mod_bom_supplier_contacts c WHERE c.supplier_id = s.id AND c.email='CZ.Orders@sensorex.com'
  );

-- HYDROCAL contact
INSERT INTO mod_bom_supplier_contacts (org_id, supplier_id, name, email, phone, role, is_primary, meta, created_at, updated_at)
SELECT NULL, s.id, 'JAN WILLEM', 'janwillem@hydrocal.nl', '+31 (0)88-8760106', NULL, TRUE, '{}'::jsonb, NOW(), NOW()
FROM mod_bom_suppliers s
WHERE s.name='HYDROCAL' AND (s.org_id IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM mod_bom_supplier_contacts c WHERE c.supplier_id = s.id AND c.email='janwillem@hydrocal.nl'
  );

-- HAMIZA contact
INSERT INTO mod_bom_supplier_contacts (org_id, supplier_id, name, email, phone, role, is_primary, meta, created_at, updated_at)
SELECT NULL, s.id, 'Miroslav Zabilka', 'hamiza@email.cz', '+420 602 263 190', NULL, TRUE, '{}'::jsonb, NOW(), NOW()
FROM mod_bom_suppliers s
WHERE s.name='HAMIZA s.r.o' AND (s.org_id IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM mod_bom_supplier_contacts c WHERE c.supplier_id = s.id AND c.email='hamiza@email.cz'
  );

-- RWC contact
INSERT INTO mod_bom_supplier_contacts (org_id, supplier_id, name, email, phone, role, is_primary, meta, created_at, updated_at)
SELECT NULL, s.id, NULL, 'objednavky.cz@rwc.com', '00 420 387 002 040', NULL, TRUE, '{}'::jsonb, NOW(), NOW()
FROM mod_bom_suppliers s
WHERE s.name='RWC' AND (s.org_id IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM mod_bom_supplier_contacts c WHERE c.supplier_id = s.id AND c.email='objednavky.cz@rwc.com'
  );

-- ALI EXPRESS contact
INSERT INTO mod_bom_supplier_contacts (org_id, supplier_id, name, email, phone, role, is_primary, meta, created_at, updated_at)
SELECT NULL, s.id, NULL, 'francetechnologie@gmail.com', NULL, NULL, TRUE, '{}'::jsonb, NOW(), NOW()
FROM mod_bom_suppliers s
WHERE s.name='ALI EXPRESS' AND (s.org_id IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM mod_bom_supplier_contacts c WHERE c.supplier_id = s.id AND c.email='francetechnologie@gmail.com'
  );

-- 3dtiskservice.cz contact
INSERT INTO mod_bom_supplier_contacts (org_id, supplier_id, name, email, phone, role, is_primary, meta, created_at, updated_at)
SELECT NULL, s.id, NULL, 'francetechnologie@gmail.com', NULL, NULL, TRUE, '{}'::jsonb, NOW(), NOW()
FROM mod_bom_suppliers s
WHERE s.name='3dtiskservice.cz' AND (s.org_id IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM mod_bom_supplier_contacts c WHERE c.supplier_id = s.id AND c.email='francetechnologie@gmail.com'
  );

