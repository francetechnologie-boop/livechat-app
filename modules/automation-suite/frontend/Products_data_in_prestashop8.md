Here is a fairly comprehensive list of the kinds of information (fields, associations, metadata) that a product in PrestaShop 8 can have (core + common extensions). Depending on modules or customizations you may have extras, but this covers what PrestaShop provides (or is commonly used) out of the box or via official extension points.

Core product data / fields & properties

Below are the main data points for a “product” in PrestaShop 8 (classic / non-customized). Many are multilingual or multistore variants.

Category	Field / Property	Description / notes
Identification & basic	id_product	internal unique ID
	reference / SKU	product reference / stock keeping unit
	name	product name (per language)
	slug / friendly URL	URL alias / rewrite (per language)
	description / description_short	long description & short description (per language)
	active / enabled	whether product is published / visible
	type of product	classic, virtual (downloadable), pack, etc.
	condition	new / used / refurbished (if supported)
	supplier reference(s)	references or codes from suppliers
	manufacturer / brand	association with a manufacturer / brand
Associations / categories / context	categories	which categories the product belongs to
	default category	one “primary” category
	related / accessory products	cross-sells / upsells / accessories
	pack composition	if the product is a pack, which products and quantities it contains
	combinations / product variants	attribute combinations (size, color, etc.)
Pricing & cost	base price (tax excluded / included)	standard price
	wholesale / cost price	cost to merchant
	specific / promotional prices	special prices (date ranges, quantity discounts, customer group, etc.)
	price per unit (unit price)	e.g. price per liter, per kg, etc.
	tax rules / tax class	which tax rule applies
	ecological / environmental fees	if any additional fees
Inventory / stock	quantity in stock	current available quantity
	minimal quantity	minimal quantity to order
	stock status / out-of-stock behavior	e.g. allow order when out-of-stock or disable attribute
	advanced stock options	e.g. manage stock by warehouses, etc.
Shipping / delivery	dimensions (width / height / depth)	product physical dimensions (for shipping)
	weight	product weight
	additional shipping cost	extra cost for shipping this product
	carriers restrictions	which carriers can deliver this product
	delivery options / lead time	estimated delivery time or handling delay
Images & media	product images	one or more images; cover / primary image
	image captions / alt text	per language captions or alternative text
	image ordering / position	ordering of images
Files (for virtual products)	downloadable file(s)	file(s) associated with the product if virtual
	number of downloads allowed	limits on how many times a file can be downloaded
	expiration days	validity period after purchase
SEO / metadata	meta title (per language)	SEO title
	meta description (per language)	SEO description
	meta keywords (if used)	SEO keywords (if enabled)
	canonical URL / redirect	canonicalization or redirect settings
Features / technical specs	features / characteristics	e.g. “Material: cotton”, “Power: 100W” (informational, non-variant)
	feature values	the values for each feature
Product options / customization	customization fields	e.g. text input, file upload fields that customers can fill before ordering
	customizable via modules	additional custom fields added via modules
Visibility & access	available for order	whether purchasing is allowed
	show price	whether to show price to all or specific customer groups
	visibility options	everywhere, catalog only, search only, etc.
Multishop / multistore	shop-specific settings	overrides per shop (e.g. price, quantity, etc.)
	shared / local scope	whether a field is shared or independent per shop
Multilanguage	translations	for name, descriptions, captions, metadata, etc.
Customer group / pricing segmentation	group-specific price / discounts	e.g. special price for wholesale or certain groups
Tags / labeling	tags	keywords or labels associated with product
Attachments / files	attachments	PDF, manuals, spec sheets associated with the product
Date / timestamps	date_add / date_upd	when the product was created / last updated
Data for analytics / stats	number of views	how many times product page was viewed (if tracked)
	sales count	number of sales (if tracked)
Others / flags	reference / barcode / EAN / UPC	unique codes (barcodes)
	pack / virtual flags	flags to indicate special product types
	redirect / 301 options	when product is removed or URL changed
	“on sale” flag / discount flag	whether currently on promotion
	pack / combination flags	whether it has variants or is itself a pack
	customizable text fields	if enabled, custom text fields for product
	wholesale price / unit price	separate price lines
	low stock threshold / warning	threshold to display low stock message
	display remaining quantities threshold	when to show “last items in stock” message
	reference to supplier(s) / supply chain / purchase info	supplier association, supplier pricing, supplier references
Combination (variant)–specific data

When a product has variants / combinations, each variant (combination) has its own data:

id_product_attribute (identifier for the combination)

specific combination reference / SKU

combination attributes (e.g. “Size = M”, “Color = Blue”)

additional price / impact (price difference relative to base)

weight impact

unit impact

default on / default combination

quantity for that combination

minimal quantity for that combination

availability / active for that combination

combination images (override / associated images)

combination-specific wholesale / cost price (if allowed)

combination-specific supplier reference

combination-specific barcode / EAN / UPC

combination-specific minimal quantity / out-of-stock behavior

Custom / extension data & hookable fields

Beyond the core, PrestaShop allows extensions (modules) or custom code to define additional custom fields or tabs on the product page. These might include:

arbitrary extra text / HTML blocks

extra numeric, date, select, checkbox fields

custom specifications per product

warranty info, certifications, guarantee period

extra tabs (e.g. technical specs, user manual, video)

custom labels (e.g. “Best Seller”, “Eco Friendly”)

fields for B2B (e.g. company-specific price, net price, volume discounts)

extra associations (e.g. with “lookbook”, “collections” modules)

promotional banners or badges

file uploads (e.g. PDFs, datasheets)

custom modules may hook into displayAdminProducts… hooks to add fields. 
PrestaShop

🧱 Core Product Tables and Their Columns
ps_product

Main table — 1 row = 1 product (base data).

Column	Type	Description
id_product	INT(10)	Primary key
id_supplier	INT(10)	Supplier ID (foreign key to ps_supplier)
id_manufacturer	INT(10)	Brand/manufacturer
id_category_default	INT(10)	Default category
id_shop_default	INT(10)	Default shop (multistore)
id_tax_rules_group	INT(10)	Tax rule
on_sale	TINYINT(1)	“On sale” flag
online_only	TINYINT(1)	Online only
ean13	VARCHAR(13)	EAN-13 barcode
isbn	VARCHAR(32)	ISBN code
upc	VARCHAR(12)	UPC code
mpn	VARCHAR(64)	Manufacturer Part Number
ecotax	DECIMAL(20,6)	Environmental tax
quantity	INT(10)	(deprecated in 1.7+, replaced by stock tables)
minimal_quantity	INT(10)	Minimum order qty
price	DECIMAL(20,6)	Base price excl. tax
wholesale_price	DECIMAL(20,6)	Cost price
unity	VARCHAR(255)	Unit name (e.g. “kg”)
unit_price_ratio	DECIMAL(20,6)	Unit price ratio
additional_shipping_cost	DECIMAL(20,6)	Additional shipping
reference	VARCHAR(64)	SKU / product reference
supplier_reference	VARCHAR(64)	Supplier reference
location	VARCHAR(255)	Warehouse location
width, height, depth, weight	DECIMAL(20,6)	Physical dimensions
out_of_stock	TINYINT(1)	Behavior when OOS
quantity_discount	TINYINT(1)	Allow quantity discounts
customizable	TINYINT(1)	Whether product can be customized
uploadable_files	INT(10)	Number of upload fields
text_fields	INT(10)	Number of text fields
active	TINYINT(1)	Product active
redirect_type	ENUM('','404','301-product','302-product','301-category','302-category')	Redirect on disable
id_type_redirected	INT(10)	Target ID for redirect
available_for_order	TINYINT(1)	Whether it can be ordered
available_date	DATE	Availability date
date_add, date_upd	DATETIME	Creation / update timestamps
show_price	TINYINT(1)	Show price to visitors
indexed	TINYINT(1)	Indexed for search
visibility	ENUM('both','catalog','search','none')	Visibility scope
cache_is_pack, cache_has_attachments, is_virtual	TINYINT(1)	Cached flags
cache_default_attribute	INT(10)	Default combination ID
advanced_stock_management	TINYINT(1)	Uses ASM system
pack_stock_type	INT(11)	Stock type behavior for packs
ps_product_lang

Language-specific data (one row per language × product).

Column	Type	Description
id_product	INT(10)	Product ID
id_lang	INT(10)	Language ID
id_shop	INT(10)	Shop ID
description, description_short	TEXT	Full and short description
link_rewrite	VARCHAR(128)	Friendly URL
meta_description, meta_keywords, meta_title	VARCHAR(512)	SEO metadata
name	VARCHAR(128)	Product name
available_now, available_later	VARCHAR(255)	Availability messages
delivery_in_stock, delivery_out_stock	VARCHAR(255)	Delivery text (in/out of stock)
ps_product_shop

Shop-specific overrides in multistore setups.

Contains nearly the same columns as ps_product, but scoped per shop:

id_product, id_shop

All price, quantity, availability, active, visibility, etc.

ps_product_attribute

Combination (variant) master table.

Column	Type	Description
id_product_attribute	INT(10)	Primary key
id_product	INT(10)	Parent product
reference, supplier_reference, location	VARCHAR(64/255)	Identifiers
ean13, isbn, upc, mpn	VARCHAR	Barcodes
wholesale_price, price, ecotax, weight, unit_price_impact	DECIMAL	Impacts relative to base product
default_on	TINYINT(1)	Default combination
minimal_quantity	INT	Minimal order for that combination
low_stock_threshold	INT	Threshold for “low stock” warning
low_stock_alert	TINYINT(1)	Enable low-stock alert
available_date	DATE	Availability for that combination
ps_product_attribute_combination

Links each combination (id_product_attribute) to attributes (id_attribute).

ps_attribute, ps_attribute_lang, ps_attribute_group, ps_attribute_group_lang

Hold attributes (Color, Size…) and their translatable names.

ps_feature, ps_feature_lang, ps_feature_value, ps_feature_value_lang, ps_feature_product

Static product features and their values (e.g. “Material = Cotton”).

ps_image, ps_image_lang, ps_image_shop

Product images and captions.

Column	Type	Description
id_image	INT	Primary key
id_product	INT	Product ID
position	INT	Sort order
cover	TINYINT(1)	Is main image
legend (in ps_image_lang)	VARCHAR(255)	Caption per language
ps_category_product

Many-to-many relation between products and categories.

ps_specific_price

Promotions and special prices.

Fields	Description
id_product, id_shop, id_cart, id_currency, id_country, id_group, id_customer, id_product_attribute	Context scope
price, reduction, reduction_type	Fixed or percentage
from_quantity, from, to	Quantity or date ranges
ps_stock_available

Current stock quantities per product / combination / shop / warehouse.

Column	Description
id_product, id_product_attribute, id_shop, id_shop_group	Keys
quantity, reserved_quantity	Actual stock
depends_on_stock	Whether using advanced stock
out_of_stock	Out-of-stock behavior
ps_product_tag

Links to ps_tag for keywords.

ps_accessory

Self-relation table (product ↔ accessory).

ps_product_download

For virtual/downloadable products.

Column	Description
id_product_download	Primary key
id_product	Product ID
display_filename, filename, date_deposit	File info
date_expiration, nb_days_accessible, nb_downloadable	Access limits
active	Whether file is active
is_shareable	Can customer share?
ps_customization_field, ps_customized_data

Custom text/file fields configured per product and the actual customer inputs.

ps_supplier, ps_product_supplier

Suppliers and supplier pricing per product × currency × combination.

ps_product_attachment

Links to ps_attachment (PDFs, manuals, etc.).

ps_cart_product

Products in customer carts (temporary relation).

ps_product_comment (if module installed)

Product reviews and ratings (module table, not core).

🧭 Auxiliary & Index Tables
Table	Purpose
ps_layered_product_attribute	Used by faceted search
ps_search_index, ps_search_word	Full-text search indexing
ps_product_sale	Sales statistics (quantity sold, date of last sale, etc.)
ps_product_country_tax	Tax overrides by country
ps_product_shop, ps_product_lang, etc.	Multishop, multilingual data
🧩 Relations Summary (Diagram Overview)
ps_product
 ├─ ps_product_lang                      (names, descriptions, SEO, translations)
 ├─ ps_product_shop                      (shop-specific overrides)
 ├─ ps_product_attribute                  (product combinations / variants)
 │   ├─ ps_product_attribute_shop             (shop-specific variant data)
 │   ├─ ps_product_attribute_combination      (attribute-value link)
 │   │   ├─ ps_attribute                      (actual attribute value, e.g. “Blue”)
 │   │   │   ├─ ps_attribute_lang             (translated attribute names)
 │   │   └─ ps_attribute_group                (attribute group, e.g. “Color”)
 │   │       └─ ps_attribute_group_lang
 │   ├─ ps_product_attribute_image            (variant-specific images)
 │   ├─ ps_stock_available                    (stock per combination)
 │   ├─ ps_product_supplier                   (supplier price per combination)
 │   ├─ ps_specific_price                     (discounts per combination)
 │   └─ ps_specific_price_priority            (discount priority rules)
 ├─ ps_stock_available                    (stock per product if no combination)
 ├─ ps_stock_mvt                          (stock movements log)
 ├─ ps_warehouse_product_location         (product ↔ warehouse mapping)
 │   ├─ ps_warehouse
 │   ├─ ps_warehouse_shop
 │   └─ ps_warehouse_carrier
 ├─ ps_feature_product                    (static features / characteristics)
 │   ├─ ps_feature_value                   (feature value)
 │   │   └─ ps_feature_value_lang
 │   └─ ps_feature                         (feature definition)
 │       └─ ps_feature_lang
 ├─ ps_image                              (images)
 │   ├─ ps_image_lang                     (captions)
 │   └─ ps_image_shop
 ├─ ps_category_product                   (category association)
 │   └─ ps_category
 │       ├─ ps_category_lang
 │       └─ ps_category_shop
 ├─ ps_specific_price                     (discount rules, combinations or global)
 ├─ ps_specific_price_priority             (rule precedence)
 ├─ ps_group_reduction                    (discounts per customer group)
 ├─ ps_product_download                   (virtual products, downloadable files)
 ├─ ps_product_supplier                    (supplier links and prices)
 │   └─ ps_supplier
 │       └─ ps_supplier_lang
 ├─ ps_product_attachment                 (attachments like manuals)
 │   └─ ps_attachment
 │       └─ ps_attachment_lang
 ├─ ps_product_tag                        (keywords/tags)
 │   └─ ps_tag
 ├─ ps_accessory                          (self-link for related products)
 ├─ ps_customization_field                (customizable fields for customers)
 │   ├─ ps_customization_field_lang
 │   └─ ps_customized_data                (customer’s actual input)
 │       └─ ps_customization
 ├─ ps_pack                               (packs/bundles)
 │   ├─ ps_product                         (referenced product)
 │   └─ quantity
 ├─ ps_stock_mvt_reason                   (reason for stock movement)
 ├─ ps_product_comment (module)           (reviews)
 │   ├─ ps_product_comment_grade
 │   ├─ ps_product_comment_criterion
 │   └─ ps_product_comment_usefulness
 ├─ ps_product_sale                       (sales stats, total sold)
 ├─ ps_layered_product_attribute          (faceted search index)
 ├─ ps_search_index                       (search keywords)
 │   └─ ps_search_word
 ├─ ps_tag_lang                           (localized tags)
 ├─ ps_tax_rules_group                    (tax rules applied)
 │   └─ ps_tax_rule
 ├─ ps_cart_product                       (cart contents)
 ├─ ps_product_group_reduction_cache      (precomputed reductions)
 ├─ ps_cart_rule                          (coupons)
 ├─ ps_order_detail                       (sales history)
 ├─ ps_product_country_tax                (country-based tax overrides)
 ├─ ps_product_shop, ps_product_lang, ps_lang, ps_currency, ps_country
 └─ ps_product_comment_report (module)    (reported abusive comments)





ps_product
 └─ ps_product_attribute
     ├─ ps_product_attribute_combination ──> ps_attribute ──> ps_attribute_group
     ├─ ps_product_attribute_image ──> ps_image
     ├─ ps_stock_available
     ├─ ps_specific_price
     ├─ ps_product_supplier ──> ps_supplier
     └─ ps_product_attribute_shop



attachment-related tables

ps_product
   │
   ├───< ps_product_attachment >───┬──> ps_attachment
   │                                │
   │                                ├──> ps_attachment_lang (id_lang)
   │                                └──> ps_attachment_shop (id_shop)
   │
   └──> ps_product_lang (other localized product data)




"TABLE_NAME"	"INDEX_NAME"	"NON_UNIQUE"	"SEQ_IN_INDEX"	"COLUMN_NAME"	"SUB_PART"
"ps_access"	"PRIMARY"	"0"	"1"	"id_profile"	\N
"ps_access"	"PRIMARY"	"0"	"2"	"id_authorization_role"	\N
"ps_accessory"	"accessory_product"	"1"	"1"	"id_product_1"	\N
"ps_accessory"	"accessory_product"	"1"	"2"	"id_product_2"	\N
"ps_address"	"address_customer"	"1"	"1"	"id_customer"	\N
"ps_address"	"id_country"	"1"	"1"	"id_country"	\N
"ps_address"	"id_manufacturer"	"1"	"1"	"id_manufacturer"	\N
"ps_address"	"id_state"	"1"	"1"	"id_state"	\N
"ps_address"	"id_supplier"	"1"	"1"	"id_supplier"	\N
"ps_address"	"id_warehouse"	"1"	"1"	"id_warehouse"	\N
"ps_address"	"PRIMARY"	"0"	"1"	"id_address"	\N
"ps_address_format"	"PRIMARY"	"0"	"1"	"id_country"	\N
"ps_admin_filter"	"admin_filter_search_id_idx"	"0"	"1"	"employee"	\N
"ps_admin_filter"	"admin_filter_search_id_idx"	"0"	"2"	"shop"	\N
"ps_admin_filter"	"admin_filter_search_id_idx"	"0"	"3"	"controller"	\N
"ps_admin_filter"	"admin_filter_search_id_idx"	"0"	"4"	"action"	\N
"ps_admin_filter"	"admin_filter_search_id_idx"	"0"	"5"	"filter_id"	\N
"ps_admin_filter"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_advice"	"PRIMARY"	"0"	"1"	"id_advice"	\N
"ps_advice_lang"	"PRIMARY"	"0"	"1"	"id_advice"	\N
"ps_advice_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_aeuc_cmsrole_email"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_aeuc_email"	"PRIMARY"	"0"	"1"	"id_mail"	\N
"ps_ajaxzoom360"	"PRIMARY"	"0"	"1"	"id_360"	\N
"ps_ajaxzoom360set"	"PRIMARY"	"0"	"1"	"id_360set"	\N
"ps_ajaxzoomimagehotspots"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_ajaxzoomproducts"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_ajaxzoomproductsettings"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_ajaxzoomproductsimages"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_ajaxzoomvideo"	"id_product"	"1"	"1"	"id_product"	\N
"ps_ajaxzoomvideo"	"PRIMARY"	"0"	"1"	"id_video"	\N
"ps_ajaxzoomvideo"	"uid"	"1"	"1"	"uid"	\N
"ps_alcamultifaqs"	"PRIMARY"	"0"	"1"	"id_alcamultifaqs"	\N
"ps_alcamultifaqs_lang"	"id_lang"	"1"	"1"	"id_lang"	\N
"ps_alcamultifaqs_lang"	"id_lang"	"1"	"2"	"id_shop"	\N
"ps_alcamultifaqs_lang"	"id_lang"	"1"	"3"	"id_alcamultifaqs"	\N
"ps_alias"	"alias"	"0"	"1"	"alias"	\N
"ps_alias"	"PRIMARY"	"0"	"1"	"id_alias"	\N
"ps_amazon_configuration"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_amazon_configuration"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_amazon_configuration"	"name"	"1"	"1"	"name"	\N
"ps_amazon_configuration"	"PRIMARY"	"0"	"1"	"id_configuration"	\N
"ps_amazon_configuration_lang"	"PRIMARY"	"0"	"1"	"id_configuration"	\N
"ps_amazon_configuration_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_amazon_shipping_service"	"mp_order_id"	"1"	"1"	"mp_order_id"	\N
"ps_amazon_shipping_service"	"PRIMARY"	"0"	"1"	"id_order"	\N
"ps_amazon_valid_values_custom"	"IDX1"	"1"	"1"	"region"	\N
"ps_amazon_valid_values_custom"	"IDX1"	"1"	"2"	"universe"	\N
"ps_amazon_valid_values_custom"	"IDX1"	"1"	"3"	"product_type"	\N
"ps_amazon_vidr_shipment"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_amazon_vidr_shipment_order"	"PRIMARY"	"0"	"1"	"id_shipment_order"	\N
"ps_amazon_vidr_shipment_order"	"ps_amazon_vidr_shipment_order_mp_order_id"	"1"	"1"	"mp_order_id"	\N
"ps_amazon_vidr_shipment_order"	"ps_amazon_vidr_shipment_order_shipment_id"	"1"	"1"	"shipment_id"	\N
"ps_angarbanners"	"PRIMARY"	"0"	"1"	"id_item"	\N
"ps_angarslider"	"PRIMARY"	"0"	"1"	"id_angarslider_slides"	\N
"ps_angarslider"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_angarslider_slides"	"PRIMARY"	"0"	"1"	"id_angarslider_slides"	\N
"ps_angarslider_slides_lang"	"PRIMARY"	"0"	"1"	"id_angarslider_slides"	\N
"ps_angarslider_slides_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_api_access"	"IDX_6E064442D8BFF738"	"1"	"1"	"id_authorized_application"	\N
"ps_api_access"	"PRIMARY"	"0"	"1"	"id_api_access"	\N
"ps_attachment"	"PRIMARY"	"0"	"1"	"id_attachment"	\N
"ps_attachment_lang"	"PRIMARY"	"0"	"1"	"id_attachment"	\N
"ps_attachment_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_attribute"	"attribute_group"	"1"	"1"	"id_attribute_group"	\N
"ps_attribute"	"PRIMARY"	"0"	"1"	"id_attribute"	\N
"ps_attribute_group"	"PRIMARY"	"0"	"1"	"id_attribute_group"	\N
"ps_attribute_group_lang"	"IDX_4653726C67A664FB"	"1"	"1"	"id_attribute_group"	\N
"ps_attribute_group_lang"	"IDX_4653726CBA299860"	"1"	"1"	"id_lang"	\N
"ps_attribute_group_lang"	"PRIMARY"	"0"	"1"	"id_attribute_group"	\N
"ps_attribute_group_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_attribute_group_shop"	"IDX_DB30BAAC274A50A0"	"1"	"1"	"id_shop"	\N
"ps_attribute_group_shop"	"IDX_DB30BAAC67A664FB"	"1"	"1"	"id_attribute_group"	\N
"ps_attribute_group_shop"	"PRIMARY"	"0"	"1"	"id_attribute_group"	\N
"ps_attribute_group_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_attribute_impact"	"id_product"	"0"	"1"	"id_product"	\N
"ps_attribute_impact"	"id_product"	"0"	"2"	"id_attribute"	\N
"ps_attribute_impact"	"PRIMARY"	"0"	"1"	"id_attribute_impact"	\N
"ps_attribute_lang"	"IDX_3ABE46A77A4F53DC"	"1"	"1"	"id_attribute"	\N
"ps_attribute_lang"	"IDX_3ABE46A7BA299860"	"1"	"1"	"id_lang"	\N
"ps_attribute_lang"	"PRIMARY"	"0"	"1"	"id_attribute"	\N
"ps_attribute_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_attribute_shop"	"IDX_A7DD8E67274A50A0"	"1"	"1"	"id_shop"	\N
"ps_attribute_shop"	"IDX_A7DD8E677A4F53DC"	"1"	"1"	"id_attribute"	\N
"ps_attribute_shop"	"PRIMARY"	"0"	"1"	"id_attribute"	\N
"ps_attribute_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_authorization_role"	"PRIMARY"	"0"	"1"	"id_authorization_role"	\N
"ps_authorization_role"	"slug"	"0"	"1"	"slug"	\N
"ps_authorized_application"	"PRIMARY"	"0"	"1"	"id_authorized_application"	\N
"ps_authorized_application"	"UNIQ_475B9BA55E237E06"	"0"	"1"	"name"	\N
"ps_badge"	"PRIMARY"	"0"	"1"	"id_badge"	\N
"ps_badge_lang"	"PRIMARY"	"0"	"1"	"id_badge"	\N
"ps_badge_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_binshopsrest_reset_pass_tokens"	"PRIMARY"	"0"	"1"	"id_pass_tokens"	\N
"ps_blmod_xml_access_log"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_affiliate_price"	"PRIMARY"	"0"	"1"	"affiliate_id"	\N
"ps_blmod_xml_block"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_category_map"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_feeds"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_feeds_cache"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_feed_search_query"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_fields"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_gender_map"	"feed_id"	"1"	"1"	"feed_id"	\N
"ps_blmod_xml_gender_map"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_g_cat"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_product_list"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_product_list_product"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_product_property_map"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_product_property_map_value"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_product_settings"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_product_settings_package"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blmod_xml_statistics"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_blockwishlist_statistics"	"PRIMARY"	"0"	"1"	"id_statistics"	\N
"ps_bridgeconnector_failed_login"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_bridgeconnector_ma_failed_login"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_bridgeconnector_ma_push_notifications"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_bridgeconnector_ma_tokens"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_bridgeconnector_ma_tokens"	"UNIQUE_KEY_BRIDGECONNECTOR_MA_USER_ID"	"0"	"1"	"user_id"	\N
"ps_bridgeconnector_ma_users"	"PRIMARY"	"0"	"1"	"user_id"	\N
"ps_bridgeconnector_ma_users"	"UNQ_MOB_USER"	"0"	"1"	"username"	\N
"ps_bridgeconnector_session_keys"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_carrier"	"deleted"	"1"	"1"	"deleted"	\N
"ps_carrier"	"deleted"	"1"	"2"	"active"	\N
"ps_carrier"	"PRIMARY"	"0"	"1"	"id_carrier"	\N
"ps_carrier"	"reference"	"1"	"1"	"id_reference"	\N
"ps_carrier"	"reference"	"1"	"2"	"deleted"	\N
"ps_carrier"	"reference"	"1"	"3"	"active"	\N
"ps_carrier_group"	"PRIMARY"	"0"	"1"	"id_carrier"	\N
"ps_carrier_group"	"PRIMARY"	"0"	"2"	"id_group"	\N
"ps_carrier_lang"	"PRIMARY"	"0"	"1"	"id_lang"	\N
"ps_carrier_lang"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_carrier_lang"	"PRIMARY"	"0"	"3"	"id_carrier"	\N
"ps_carrier_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_carrier_shop"	"PRIMARY"	"0"	"1"	"id_carrier"	\N
"ps_carrier_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_carrier_tax_rules_group_shop"	"PRIMARY"	"0"	"1"	"id_carrier"	\N
"ps_carrier_tax_rules_group_shop"	"PRIMARY"	"0"	"2"	"id_tax_rules_group"	\N
"ps_carrier_tax_rules_group_shop"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_carrier_zone"	"PRIMARY"	"0"	"1"	"id_carrier"	\N
"ps_carrier_zone"	"PRIMARY"	"0"	"2"	"id_zone"	\N
"ps_cart"	"cart_customer"	"1"	"1"	"id_customer"	\N
"ps_cart"	"id_address_delivery"	"1"	"1"	"id_address_delivery"	\N
"ps_cart"	"id_address_invoice"	"1"	"1"	"id_address_invoice"	\N
"ps_cart"	"id_carrier"	"1"	"1"	"id_carrier"	\N
"ps_cart"	"id_currency"	"1"	"1"	"id_currency"	\N
"ps_cart"	"id_guest"	"1"	"1"	"id_guest"	\N
"ps_cart"	"id_lang"	"1"	"1"	"id_lang"	\N
"ps_cart"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_cart"	"id_shop"	"1"	"2"	"date_add"	\N
"ps_cart"	"id_shop_2"	"1"	"1"	"id_shop"	\N
"ps_cart"	"id_shop_2"	"1"	"2"	"date_upd"	\N
"ps_cart"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_cart"	"PRIMARY"	"0"	"1"	"id_cart"	\N
"ps_cart_cart_rule"	"id_cart_rule"	"1"	"1"	"id_cart_rule"	\N
"ps_cart_cart_rule"	"PRIMARY"	"0"	"1"	"id_cart"	\N
"ps_cart_cart_rule"	"PRIMARY"	"0"	"2"	"id_cart_rule"	\N
"ps_cart_product"	"id_cart_order"	"1"	"1"	"id_cart"	\N
"ps_cart_product"	"id_cart_order"	"1"	"2"	"date_add"	\N
"ps_cart_product"	"id_cart_order"	"1"	"3"	"id_product"	\N
"ps_cart_product"	"id_cart_order"	"1"	"4"	"id_product_attribute"	\N
"ps_cart_product"	"id_product_attribute"	"1"	"1"	"id_product_attribute"	\N
"ps_cart_product"	"PRIMARY"	"0"	"1"	"id_cart"	\N
"ps_cart_product"	"PRIMARY"	"0"	"2"	"id_product"	\N
"ps_cart_product"	"PRIMARY"	"0"	"3"	"id_product_attribute"	\N
"ps_cart_product"	"PRIMARY"	"0"	"4"	"id_customization"	\N
"ps_cart_product"	"PRIMARY"	"0"	"5"	"id_address_delivery"	\N
"ps_cart_rule"	"date_from"	"1"	"1"	"date_from"	\N
"ps_cart_rule"	"date_to"	"1"	"1"	"date_to"	\N
"ps_cart_rule"	"group_restriction"	"1"	"1"	"group_restriction"	\N
"ps_cart_rule"	"group_restriction"	"1"	"2"	"active"	\N
"ps_cart_rule"	"group_restriction"	"1"	"3"	"date_to"	\N
"ps_cart_rule"	"group_restriction_2"	"1"	"1"	"group_restriction"	\N
"ps_cart_rule"	"group_restriction_2"	"1"	"2"	"active"	\N
"ps_cart_rule"	"group_restriction_2"	"1"	"3"	"highlight"	\N
"ps_cart_rule"	"group_restriction_2"	"1"	"4"	"date_to"	\N
"ps_cart_rule"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_cart_rule"	"id_customer"	"1"	"2"	"active"	\N
"ps_cart_rule"	"id_customer"	"1"	"3"	"date_to"	\N
"ps_cart_rule"	"id_customer_2"	"1"	"1"	"id_customer"	\N
"ps_cart_rule"	"id_customer_2"	"1"	"2"	"active"	\N
"ps_cart_rule"	"id_customer_2"	"1"	"3"	"highlight"	\N
"ps_cart_rule"	"id_customer_2"	"1"	"4"	"date_to"	\N
"ps_cart_rule"	"PRIMARY"	"0"	"1"	"id_cart_rule"	\N
"ps_cart_rule_carrier"	"PRIMARY"	"0"	"1"	"id_cart_rule"	\N
"ps_cart_rule_carrier"	"PRIMARY"	"0"	"2"	"id_carrier"	\N
"ps_cart_rule_combination"	"id_cart_rule_1"	"1"	"1"	"id_cart_rule_1"	\N
"ps_cart_rule_combination"	"id_cart_rule_2"	"1"	"1"	"id_cart_rule_2"	\N
"ps_cart_rule_combination"	"PRIMARY"	"0"	"1"	"id_cart_rule_1"	\N
"ps_cart_rule_combination"	"PRIMARY"	"0"	"2"	"id_cart_rule_2"	\N
"ps_cart_rule_country"	"PRIMARY"	"0"	"1"	"id_cart_rule"	\N
"ps_cart_rule_country"	"PRIMARY"	"0"	"2"	"id_country"	\N
"ps_cart_rule_group"	"PRIMARY"	"0"	"1"	"id_cart_rule"	\N
"ps_cart_rule_group"	"PRIMARY"	"0"	"2"	"id_group"	\N
"ps_cart_rule_lang"	"PRIMARY"	"0"	"1"	"id_cart_rule"	\N
"ps_cart_rule_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cart_rule_product_rule"	"PRIMARY"	"0"	"1"	"id_product_rule"	\N
"ps_cart_rule_product_rule_group"	"PRIMARY"	"0"	"1"	"id_product_rule_group"	\N
"ps_cart_rule_product_rule_value"	"PRIMARY"	"0"	"1"	"id_product_rule"	\N
"ps_cart_rule_product_rule_value"	"PRIMARY"	"0"	"2"	"id_item"	\N
"ps_cart_rule_shop"	"PRIMARY"	"0"	"1"	"id_cart_rule"	\N
"ps_cart_rule_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_category"	"activenleft"	"1"	"1"	"active"	\N
"ps_category"	"activenleft"	"1"	"2"	"nleft"	\N
"ps_category"	"activenright"	"1"	"1"	"active"	\N
"ps_category"	"activenright"	"1"	"2"	"nright"	\N
"ps_category"	"category_parent"	"1"	"1"	"id_parent"	\N
"ps_category"	"level_depth"	"1"	"1"	"level_depth"	\N
"ps_category"	"nleftrightactive"	"1"	"1"	"nleft"	\N
"ps_category"	"nleftrightactive"	"1"	"2"	"nright"	\N
"ps_category"	"nleftrightactive"	"1"	"3"	"active"	\N
"ps_category"	"nright"	"1"	"1"	"nright"	\N
"ps_category"	"PRIMARY"	"0"	"1"	"id_category"	\N
"ps_category_group"	"id_category"	"1"	"1"	"id_category"	\N
"ps_category_group"	"id_group"	"1"	"1"	"id_group"	\N
"ps_category_group"	"PRIMARY"	"0"	"1"	"id_category"	\N
"ps_category_group"	"PRIMARY"	"0"	"2"	"id_group"	\N
"ps_category_lang"	"category_name"	"1"	"1"	"name"	\N
"ps_category_lang"	"PRIMARY"	"0"	"1"	"id_category"	\N
"ps_category_lang"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_category_lang"	"PRIMARY"	"0"	"3"	"id_lang"	\N
"ps_category_product"	"id_category"	"1"	"1"	"id_category"	\N
"ps_category_product"	"id_category"	"1"	"2"	"position"	\N
"ps_category_product"	"id_product"	"1"	"1"	"id_product"	\N
"ps_category_product"	"PRIMARY"	"0"	"1"	"id_category"	\N
"ps_category_product"	"PRIMARY"	"0"	"2"	"id_product"	\N
"ps_category_shop"	"PRIMARY"	"0"	"1"	"id_category"	\N
"ps_category_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cdc_gtm_datalayer"	"event"	"1"	"1"	"event"	\N
"ps_cdc_gtm_datalayer"	"PRIMARY"	"0"	"1"	"id_cdc_gtm_datalayer"	\N
"ps_cdc_gtm_order_log"	"id_order"	"1"	"1"	"id_order"	\N
"ps_cdc_gtm_order_log"	"PRIMARY"	"0"	"1"	"id_cdc_gtm_order_log"	\N
"ps_classy_faq_category"	"PRIMARY"	"0"	"1"	"id_classy_faq_category"	\N
"ps_classy_faq_category_lang"	"PRIMARY"	"0"	"1"	"id_classy_faq_category"	\N
"ps_classy_faq_category_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_classy_faq_question_answer"	"PRIMARY"	"0"	"1"	"id_classy_faq_question_answer"	\N
"ps_classy_faq_question_answer_lang"	"PRIMARY"	"0"	"1"	"id_classy_faq_question_answer"	\N
"ps_classy_faq_question_answer_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cms"	"PRIMARY"	"0"	"1"	"id_cms"	\N
"ps_cms_category"	"category_parent"	"1"	"1"	"id_parent"	\N
"ps_cms_category"	"PRIMARY"	"0"	"1"	"id_cms_category"	\N
"ps_cms_category_lang"	"category_name"	"1"	"1"	"name"	\N
"ps_cms_category_lang"	"PRIMARY"	"0"	"1"	"id_cms_category"	\N
"ps_cms_category_lang"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cms_category_lang"	"PRIMARY"	"0"	"3"	"id_lang"	\N
"ps_cms_category_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_cms_category_shop"	"PRIMARY"	"0"	"1"	"id_cms_category"	\N
"ps_cms_category_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cms_lang"	"PRIMARY"	"0"	"1"	"id_cms"	\N
"ps_cms_lang"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cms_lang"	"PRIMARY"	"0"	"3"	"id_lang"	\N
"ps_cms_role"	"name"	"0"	"1"	"name"	\N
"ps_cms_role"	"PRIMARY"	"0"	"1"	"id_cms_role"	\N
"ps_cms_role"	"PRIMARY"	"0"	"2"	"id_cms"	\N
"ps_cms_role_lang"	"PRIMARY"	"0"	"1"	"id_cms_role"	\N
"ps_cms_role_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cms_role_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_cms_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_cms_shop"	"PRIMARY"	"0"	"1"	"id_cms"	\N
"ps_cms_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_condition"	"PRIMARY"	"0"	"1"	"id_condition"	\N
"ps_condition"	"PRIMARY"	"0"	"2"	"id_ps_condition"	\N
"ps_condition_advice"	"PRIMARY"	"0"	"1"	"id_condition"	\N
"ps_condition_advice"	"PRIMARY"	"0"	"2"	"id_advice"	\N
"ps_condition_badge"	"PRIMARY"	"0"	"1"	"id_condition"	\N
"ps_condition_badge"	"PRIMARY"	"0"	"2"	"id_badge"	\N
"ps_configuration"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_configuration"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_configuration"	"name"	"1"	"1"	"name"	\N
"ps_configuration"	"PRIMARY"	"0"	"1"	"id_configuration"	\N
"ps_configuration_copy"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_configuration_copy"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_configuration_copy"	"name"	"1"	"1"	"name"	\N
"ps_configuration_copy"	"PRIMARY"	"0"	"1"	"id_configuration"	\N
"ps_configuration_kpi"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_configuration_kpi"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_configuration_kpi"	"name"	"1"	"1"	"name"	\N
"ps_configuration_kpi"	"PRIMARY"	"0"	"1"	"id_configuration_kpi"	\N
"ps_configuration_kpi_lang"	"PRIMARY"	"0"	"1"	"id_configuration_kpi"	\N
"ps_configuration_kpi_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_configuration_lang"	"PRIMARY"	"0"	"1"	"id_configuration"	\N
"ps_configuration_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_connections"	"date_add"	"1"	"1"	"date_add"	\N
"ps_connections"	"id_guest"	"1"	"1"	"id_guest"	\N
"ps_connections"	"id_page"	"1"	"1"	"id_page"	\N
"ps_connections"	"PRIMARY"	"0"	"1"	"id_connections"	\N
"ps_connections_page"	"PRIMARY"	"0"	"1"	"id_connections"	\N
"ps_connections_page"	"PRIMARY"	"0"	"2"	"id_page"	\N
"ps_connections_page"	"PRIMARY"	"0"	"3"	"time_start"	\N
"ps_connections_source"	"connections"	"1"	"1"	"id_connections"	\N
"ps_connections_source"	"http_referer"	"1"	"1"	"http_referer"	\N
"ps_connections_source"	"orderby"	"1"	"1"	"date_add"	\N
"ps_connections_source"	"PRIMARY"	"0"	"1"	"id_connections_source"	\N
"ps_connections_source"	"request_uri"	"1"	"1"	"request_uri"	\N
"ps_contact"	"PRIMARY"	"0"	"1"	"id_contact"	\N
"ps_contact_lang"	"PRIMARY"	"0"	"1"	"id_contact"	\N
"ps_contact_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_contact_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_contact_shop"	"PRIMARY"	"0"	"1"	"id_contact"	\N
"ps_contact_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_country"	"country_"	"1"	"1"	"id_zone"	\N
"ps_country"	"country_iso_code"	"1"	"1"	"iso_code"	\N
"ps_country"	"PRIMARY"	"0"	"1"	"id_country"	\N
"ps_country_lang"	"PRIMARY"	"0"	"1"	"id_country"	\N
"ps_country_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_country_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_country_shop"	"PRIMARY"	"0"	"1"	"id_country"	\N
"ps_country_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cpcategorylist"	"PRIMARY"	"0"	"1"	"id_cpcategorylist"	\N
"ps_cpcmsbanner1info"	"PRIMARY"	"0"	"1"	"id_cpcmsbanner1info"	\N
"ps_cpcmsbanner1info_lang"	"PRIMARY"	"0"	"1"	"id_cpcmsbanner1info"	\N
"ps_cpcmsbanner1info_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpcmsbanner1info_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_cpcmsbanner1info_shop"	"PRIMARY"	"0"	"1"	"id_cpcmsbanner1info"	\N
"ps_cpcmsbanner1info_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cpcmsbanner2info"	"PRIMARY"	"0"	"1"	"id_cpcmsbanner2info"	\N
"ps_cpcmsbanner2info_lang"	"PRIMARY"	"0"	"1"	"id_cpcmsbanner2info"	\N
"ps_cpcmsbanner2info_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpcmsbanner2info_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_cpcmsbanner2info_shop"	"PRIMARY"	"0"	"1"	"id_cpcmsbanner2info"	\N
"ps_cpcmsbanner2info_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cpcmsbanner3info"	"PRIMARY"	"0"	"1"	"id_cpcmsbanner3info"	\N
"ps_cpcmsbanner3info_lang"	"PRIMARY"	"0"	"1"	"id_cpcmsbanner3info"	\N
"ps_cpcmsbanner3info_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpcmsbanner3info_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_cpcmsbanner3info_shop"	"PRIMARY"	"0"	"1"	"id_cpcmsbanner3info"	\N
"ps_cpcmsbanner3info_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cpcouponpop"	"PRIMARY"	"0"	"1"	"id_cpcouponpop"	\N
"ps_cpcouponpop_lang"	"PRIMARY"	"0"	"1"	"id_cpcouponpop"	\N
"ps_cpcouponpop_lang"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cpcouponpop_lang"	"PRIMARY"	"0"	"3"	"id_lang"	\N
"ps_cpcouponpop_shop"	"PRIMARY"	"0"	"1"	"id_cpcouponpop"	\N
"ps_cpcouponpop_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cpfootercms1blockinfo"	"PRIMARY"	"0"	"1"	"id_cpfootercms1blockinfo"	\N
"ps_cpfootercms1blockinfo_lang"	"PRIMARY"	"0"	"1"	"id_cpfootercms1blockinfo"	\N
"ps_cpfootercms1blockinfo_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpfootercms1blockinfo_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_cpfootercms1blockinfo_shop"	"PRIMARY"	"0"	"1"	"id_cpfootercms1blockinfo"	\N
"ps_cpfootercms1blockinfo_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cpheadercms1blockinfo"	"PRIMARY"	"0"	"1"	"id_cpheadercms1blockinfo"	\N
"ps_cpheadercms1blockinfo_lang"	"PRIMARY"	"0"	"1"	"id_cpheadercms1blockinfo"	\N
"ps_cpheadercms1blockinfo_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpheadercms1blockinfo_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_cpheadercms1blockinfo_shop"	"PRIMARY"	"0"	"1"	"id_cpheadercms1blockinfo"	\N
"ps_cpheadercms1blockinfo_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cpheadercms2blockinfo"	"PRIMARY"	"0"	"1"	"id_cpheadercms2blockinfo"	\N
"ps_cpheadercms2blockinfo_lang"	"PRIMARY"	"0"	"1"	"id_cpheadercms2blockinfo"	\N
"ps_cpheadercms2blockinfo_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpheadercms2blockinfo_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_cpheadercms2blockinfo_shop"	"PRIMARY"	"0"	"1"	"id_cpheadercms2blockinfo"	\N
"ps_cpheadercms2blockinfo_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cphomeslider"	"PRIMARY"	"0"	"1"	"id_cphomeslider_slides"	\N
"ps_cphomeslider"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cphomeslider_slides"	"PRIMARY"	"0"	"1"	"id_cphomeslider_slides"	\N
"ps_cphomeslider_slides_lang"	"PRIMARY"	"0"	"1"	"id_cphomeslider_slides"	\N
"ps_cphomeslider_slides_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpleftbanner1"	"PRIMARY"	"0"	"1"	"id_cpleftbanner1_slides"	\N
"ps_cpleftbanner1"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cpleftbanner1_slides"	"PRIMARY"	"0"	"1"	"id_cpleftbanner1_slides"	\N
"ps_cpleftbanner1_slides_lang"	"PRIMARY"	"0"	"1"	"id_cpleftbanner1_slides"	\N
"ps_cpleftbanner1_slides_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpproductpaymentlogoinfo"	"PRIMARY"	"0"	"1"	"id_cpproductpaymentlogoinfo"	\N
"ps_cpproductpaymentlogoinfo_lang"	"PRIMARY"	"0"	"1"	"id_cpproductpaymentlogoinfo"	\N
"ps_cpproductpaymentlogoinfo_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpproductpaymentlogoinfo_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_cpproductpaymentlogoinfo_shop"	"PRIMARY"	"0"	"1"	"id_cpproductpaymentlogoinfo"	\N
"ps_cpproductpaymentlogoinfo_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cpserviceblockinfo"	"PRIMARY"	"0"	"1"	"id_cpserviceblockinfo"	\N
"ps_cpserviceblockinfo_lang"	"PRIMARY"	"0"	"1"	"id_cpserviceblockinfo"	\N
"ps_cpserviceblockinfo_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpserviceblockinfo_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_cpserviceblockinfo_shop"	"PRIMARY"	"0"	"1"	"id_cpserviceblockinfo"	\N
"ps_cpserviceblockinfo_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cpshippingcmsblockinfo"	"PRIMARY"	"0"	"1"	"id_cpshippingcmsblockinfo"	\N
"ps_cpshippingcmsblockinfo_lang"	"PRIMARY"	"0"	"1"	"id_cpshippingcmsblockinfo"	\N
"ps_cpshippingcmsblockinfo_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpshippingcmsblockinfo_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_cpshippingcmsblockinfo_shop"	"PRIMARY"	"0"	"1"	"id_cpshippingcmsblockinfo"	\N
"ps_cpshippingcmsblockinfo_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cpsideverticalmenu"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_cpsideverticalmenu"	"PRIMARY"	"0"	"1"	"id_cpsideverticalmenu"	\N
"ps_cpsideverticalmenu_lang"	"id_cpsideverticalmenu"	"1"	"1"	"id_cpsideverticalmenu"	\N
"ps_cpsideverticalmenu_lang"	"id_cpsideverticalmenu"	"1"	"2"	"id_lang"	\N
"ps_cpsideverticalmenu_lang"	"id_cpsideverticalmenu"	"1"	"3"	"id_shop"	\N
"ps_cpsizechartcmsblockinfo"	"PRIMARY"	"0"	"1"	"id_cpsizechartcmsblockinfo"	\N
"ps_cpsizechartcmsblockinfo_lang"	"PRIMARY"	"0"	"1"	"id_cpsizechartcmsblockinfo"	\N
"ps_cpsizechartcmsblockinfo_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpsizechartcmsblockinfo_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_cpsizechartcmsblockinfo_shop"	"PRIMARY"	"0"	"1"	"id_cpsizechartcmsblockinfo"	\N
"ps_cpsizechartcmsblockinfo_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cptestimonial"	"PRIMARY"	"0"	"1"	"id_cptestimonial_slides"	\N
"ps_cptestimonial"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_cptestimonial_slides"	"PRIMARY"	"0"	"1"	"id_cptestimonial_slides"	\N
"ps_cptestimonial_slides_lang"	"PRIMARY"	"0"	"1"	"id_cptestimonial_slides"	\N
"ps_cptestimonial_slides_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_cpverticalmenu"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_cpverticalmenu"	"PRIMARY"	"0"	"1"	"id_cpverticalmenu"	\N
"ps_cpverticalmenu_lang"	"id_cpverticalmenu"	"1"	"1"	"id_cpverticalmenu"	\N
"ps_cpverticalmenu_lang"	"id_cpverticalmenu"	"1"	"2"	"id_lang"	\N
"ps_cpverticalmenu_lang"	"id_cpverticalmenu"	"1"	"3"	"id_shop"	\N
"ps_criteo_advertiser"	"advertiserId"	"1"	"1"	"advertiserId"	\N
"ps_criteo_advertiser"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_criteo_advertiser"	"iso_country"	"1"	"1"	"iso_country"	\N
"ps_criteo_advertiser"	"iso_currency"	"1"	"1"	"iso_currency"	\N
"ps_criteo_advertiser"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_criteo_campaign"	"advertiserId"	"1"	"1"	"advertiserId"	\N
"ps_criteo_campaign"	"audienceType"	"1"	"1"	"audienceType"	\N
"ps_criteo_campaign"	"partnerId"	"1"	"1"	"partnerId"	\N
"ps_criteo_campaign"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_criteo_partner"	"advertiserId"	"1"	"1"	"partnerId"	\N
"ps_criteo_partner"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_criteo_partner"	"iso_lang"	"1"	"1"	"iso_lang"	\N
"ps_criteo_partner"	"partnerId"	"1"	"1"	"partnerId"	\N
"ps_criteo_partner"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_currency"	"currency_iso_code"	"1"	"1"	"iso_code"	\N
"ps_currency"	"PRIMARY"	"0"	"1"	"id_currency"	\N
"ps_currency_lang"	"PRIMARY"	"0"	"1"	"id_currency"	\N
"ps_currency_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_currency_lang_copy2"	"PRIMARY"	"0"	"1"	"id_currency"	\N
"ps_currency_lang_copy2"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_currency_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_currency_shop"	"PRIMARY"	"0"	"1"	"id_currency"	\N
"ps_currency_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_customer"	"customer_email"	"1"	"1"	"email"	\N
"ps_customer"	"customer_login"	"1"	"1"	"email"	\N
"ps_customer"	"customer_login"	"1"	"2"	"passwd"	\N
"ps_customer"	"id_customer_passwd"	"1"	"1"	"id_customer"	\N
"ps_customer"	"id_customer_passwd"	"1"	"2"	"passwd"	\N
"ps_customer"	"id_gender"	"1"	"1"	"id_gender"	\N
"ps_customer"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_customer"	"id_shop"	"1"	"2"	"date_add"	\N
"ps_customer"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_customer"	"PRIMARY"	"0"	"1"	"id_customer"	\N
"ps_customer_beforepassword_update"	"customer_email"	"1"	"1"	"email"	\N
"ps_customer_beforepassword_update"	"customer_login"	"1"	"1"	"email"	\N
"ps_customer_beforepassword_update"	"customer_login"	"1"	"2"	"passwd"	\N
"ps_customer_beforepassword_update"	"id_customer_passwd"	"1"	"1"	"id_customer"	\N
"ps_customer_beforepassword_update"	"id_customer_passwd"	"1"	"2"	"passwd"	\N
"ps_customer_beforepassword_update"	"id_gender"	"1"	"1"	"id_gender"	\N
"ps_customer_beforepassword_update"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_customer_beforepassword_update"	"id_shop"	"1"	"2"	"date_add"	\N
"ps_customer_beforepassword_update"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_customer_beforepassword_update"	"PRIMARY"	"0"	"1"	"id_customer"	\N
"ps_customer_copy"	"customer_email"	"1"	"1"	"email"	\N
"ps_customer_copy"	"customer_login"	"1"	"1"	"email"	\N
"ps_customer_copy"	"customer_login"	"1"	"2"	"passwd"	\N
"ps_customer_copy"	"id_customer_passwd"	"1"	"1"	"id_customer"	\N
"ps_customer_copy"	"id_customer_passwd"	"1"	"2"	"passwd"	\N
"ps_customer_copy"	"id_gender"	"1"	"1"	"id_gender"	\N
"ps_customer_copy"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_customer_copy"	"id_shop"	"1"	"2"	"date_add"	\N
"ps_customer_copy"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_customer_copy"	"PRIMARY"	"0"	"1"	"id_customer"	\N
"ps_customer_group"	"customer_login"	"1"	"1"	"id_group"	\N
"ps_customer_group"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_customer_group"	"PRIMARY"	"0"	"1"	"id_customer"	\N
"ps_customer_group"	"PRIMARY"	"0"	"2"	"id_group"	\N
"ps_customer_message"	"id_customer_thread"	"1"	"1"	"id_customer_thread"	\N
"ps_customer_message"	"id_employee"	"1"	"1"	"id_employee"	\N
"ps_customer_message"	"PRIMARY"	"0"	"1"	"id_customer_message"	\N
"ps_customer_message_sync_imap"	"md5_header_index"	"1"	"1"	"md5_header"	"4"
"ps_customer_old"	"customer_email"	"1"	"1"	"email"	"191"
"ps_customer_old"	"customer_login"	"1"	"1"	"email"	"191"
"ps_customer_old"	"customer_login"	"1"	"2"	"passwd"	"191"
"ps_customer_old"	"id_customer_passwd"	"1"	"1"	"id_customer"	\N
"ps_customer_old"	"id_customer_passwd"	"1"	"2"	"passwd"	"191"
"ps_customer_old"	"id_gender"	"1"	"1"	"id_gender"	\N
"ps_customer_old"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_customer_old"	"id_shop"	"1"	"2"	"date_add"	\N
"ps_customer_old"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_customer_old"	"PRIMARY"	"0"	"1"	"id_customer"	\N
"ps_customer_session"	"PRIMARY"	"0"	"1"	"id_customer_session"	\N
"ps_customer_thread"	"id_contact"	"1"	"1"	"id_contact"	\N
"ps_customer_thread"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_customer_thread"	"id_lang"	"1"	"1"	"id_lang"	\N
"ps_customer_thread"	"id_order"	"1"	"1"	"id_order"	\N
"ps_customer_thread"	"id_product"	"1"	"1"	"id_product"	\N
"ps_customer_thread"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_customer_thread"	"PRIMARY"	"0"	"1"	"id_customer_thread"	\N
"ps_customization"	"id_cart_product"	"1"	"1"	"id_cart"	\N
"ps_customization"	"id_cart_product"	"1"	"2"	"id_product"	\N
"ps_customization"	"id_cart_product"	"1"	"3"	"id_product_attribute"	\N
"ps_customization"	"id_product_attribute"	"1"	"1"	"id_product_attribute"	\N
"ps_customization"	"PRIMARY"	"0"	"1"	"id_customization"	\N
"ps_customization"	"PRIMARY"	"0"	"2"	"id_cart"	\N
"ps_customization"	"PRIMARY"	"0"	"3"	"id_product"	\N
"ps_customization"	"PRIMARY"	"0"	"4"	"id_address_delivery"	\N
"ps_customization_field"	"id_product"	"1"	"1"	"id_product"	\N
"ps_customization_field"	"PRIMARY"	"0"	"1"	"id_customization_field"	\N
"ps_customization_field_lang"	"PRIMARY"	"0"	"1"	"id_customization_field"	\N
"ps_customization_field_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_customization_field_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_customized_data"	"PRIMARY"	"0"	"1"	"id_customization"	\N
"ps_customized_data"	"PRIMARY"	"0"	"2"	"type"	\N
"ps_customized_data"	"PRIMARY"	"0"	"3"	"index"	\N
"ps_data_request"	"PRIMARY"	"0"	"1"	"id_data_request"	\N
"ps_date_range"	"PRIMARY"	"0"	"1"	"id_date_range"	\N
"ps_delivery"	"id_carrier"	"1"	"1"	"id_carrier"	\N
"ps_delivery"	"id_carrier"	"1"	"2"	"id_zone"	\N
"ps_delivery"	"id_range_price"	"1"	"1"	"id_range_price"	\N
"ps_delivery"	"id_range_weight"	"1"	"1"	"id_range_weight"	\N
"ps_delivery"	"id_zone"	"1"	"1"	"id_zone"	\N
"ps_delivery"	"PRIMARY"	"0"	"1"	"id_delivery"	\N
"ps_dhlexpresscommerce"	"PRIMARY"	"0"	"1"	"id_dhlexpresscommerce"	\N
"ps_dhlexpresscommerce_service"	"PRIMARY"	"0"	"1"	"id_dhlexpresscommerce_service"	\N
"ps_doofinder_product"	"PRIMARY"	"0"	"1"	"id_doofinder_product"	\N
"ps_doofinder_product"	"uc_shop_product"	"0"	"1"	"id_shop"	\N
"ps_doofinder_product"	"uc_shop_product"	"0"	"2"	"id_product"	\N
"ps_emailsubscription"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_employee"	"employee_login"	"1"	"1"	"email"	\N
"ps_employee"	"employee_login"	"1"	"2"	"passwd"	\N
"ps_employee"	"id_employee_passwd"	"1"	"1"	"id_employee"	\N
"ps_employee"	"id_employee_passwd"	"1"	"2"	"passwd"	\N
"ps_employee"	"id_profile"	"1"	"1"	"id_profile"	\N
"ps_employee"	"PRIMARY"	"0"	"1"	"id_employee"	\N
"ps_employee_account"	"PRIMARY"	"0"	"1"	"id_employee_account"	\N
"ps_employee_session"	"PRIMARY"	"0"	"1"	"id_employee_session"	\N
"ps_employee_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_employee_shop"	"PRIMARY"	"0"	"1"	"id_employee"	\N
"ps_employee_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_ets_trans_cache"	"cache_type"	"1"	"1"	"cache_type"	\N
"ps_ets_trans_cache"	"cache_type"	"1"	"2"	"name"	\N
"ps_ets_trans_cache"	"cache_type"	"1"	"3"	"status"	\N
"ps_ets_trans_cache"	"cache_type"	"1"	"4"	"id_shop"	\N
"ps_ets_trans_cache"	"cache_type"	"1"	"5"	"is_oneclick"	\N
"ps_ets_trans_cache"	"PRIMARY"	"0"	"1"	"id_ets_trans_cache"	\N
"ps_ets_trans_log"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_ets_trans_log"	"id_shop"	"1"	"2"	"status"	\N
"ps_ets_trans_log"	"id_shop"	"1"	"3"	"page_type"	\N
"ps_ets_trans_log"	"PRIMARY"	"0"	"1"	"id_ets_trans_log"	\N
"ps_eventbus_deleted_objects"	"PRIMARY"	"0"	"1"	"type"	\N
"ps_eventbus_deleted_objects"	"PRIMARY"	"0"	"2"	"id_object"	\N
"ps_eventbus_deleted_objects"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_eventbus_incremental_sync"	"PRIMARY"	"0"	"1"	"type"	\N
"ps_eventbus_incremental_sync"	"PRIMARY"	"0"	"2"	"id_object"	\N
"ps_eventbus_incremental_sync"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_eventbus_incremental_sync"	"PRIMARY"	"0"	"4"	"lang_iso"	\N
"ps_eventbus_live_sync"	"PRIMARY"	"0"	"1"	"shop_content"	\N
"ps_fb_category_match"	"id_category"	"1"	"1"	"id_category"	\N
"ps_fb_category_match"	"id_category"	"1"	"2"	"google_category_id"	\N
"ps_fb_category_match"	"PRIMARY"	"0"	"1"	"id_category"	\N
"ps_fb_category_match"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_feature"	"PRIMARY"	"0"	"1"	"id_feature"	\N
"ps_feature_flag"	"PRIMARY"	"0"	"1"	"id_feature_flag"	\N
"ps_feature_flag"	"UNIQ_91700F175E237E06"	"0"	"1"	"name"	\N
"ps_feature_lang"	"id_lang"	"1"	"1"	"id_lang"	\N
"ps_feature_lang"	"id_lang"	"1"	"2"	"name"	\N
"ps_feature_lang"	"PRIMARY"	"0"	"1"	"id_feature"	\N
"ps_feature_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_feature_product"	"id_feature_value"	"1"	"1"	"id_feature_value"	\N
"ps_feature_product"	"id_product"	"1"	"1"	"id_product"	\N
"ps_feature_product"	"PRIMARY"	"0"	"1"	"id_feature"	\N
"ps_feature_product"	"PRIMARY"	"0"	"2"	"id_product"	\N
"ps_feature_product"	"PRIMARY"	"0"	"3"	"id_feature_value"	\N
"ps_feature_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_feature_shop"	"PRIMARY"	"0"	"1"	"id_feature"	\N
"ps_feature_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_feature_value"	"feature"	"1"	"1"	"id_feature"	\N
"ps_feature_value"	"PRIMARY"	"0"	"1"	"id_feature_value"	\N
"ps_feature_value_lang"	"PRIMARY"	"0"	"1"	"id_feature_value"	\N
"ps_feature_value_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_ganalytics"	"id_order"	"1"	"1"	"id_order"	\N
"ps_ganalytics"	"PRIMARY"	"0"	"1"	"id_google_analytics"	\N
"ps_ganalytics"	"sent"	"1"	"1"	"sent"	\N
"ps_ganalytics_data"	"PRIMARY"	"0"	"1"	"id_cart"	\N
"ps_gdpr_activity_log"	"PRIMARY"	"0"	"1"	"id_gdpr_activity_log"	\N
"ps_gdpr_custom_script"	"PRIMARY"	"0"	"1"	"id_gdpr_custom_script"	\N
"ps_gender"	"PRIMARY"	"0"	"1"	"id_gender"	\N
"ps_gender_lang"	"id_gender"	"1"	"1"	"id_gender"	\N
"ps_gender_lang"	"PRIMARY"	"0"	"1"	"id_gender"	\N
"ps_gender_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_group"	"PRIMARY"	"0"	"1"	"id_group"	\N
"ps_group_lang"	"PRIMARY"	"0"	"1"	"id_group"	\N
"ps_group_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_group_reduction"	"id_group"	"0"	"1"	"id_group"	\N
"ps_group_reduction"	"id_group"	"0"	"2"	"id_category"	\N
"ps_group_reduction"	"PRIMARY"	"0"	"1"	"id_group_reduction"	\N
"ps_group_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_group_shop"	"PRIMARY"	"0"	"1"	"id_group"	\N
"ps_group_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_guest"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_guest"	"id_operating_system"	"1"	"1"	"id_operating_system"	\N
"ps_guest"	"id_web_browser"	"1"	"1"	"id_web_browser"	\N
"ps_guest"	"PRIMARY"	"0"	"1"	"id_guest"	\N
"ps_hicookieconsent"	"PRIMARY"	"0"	"1"	"id_consent"	\N
"ps_hicookietype"	"PRIMARY"	"0"	"1"	"id_type"	\N
"ps_hicookietypemodule"	"PRIMARY"	"0"	"1"	"id_type"	\N
"ps_hicookietypemodule"	"PRIMARY"	"0"	"2"	"id_module"	\N
"ps_hicookietype_lang"	"PRIMARY"	"0"	"1"	"id_type"	\N
"ps_hicookietype_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_hicookietype_shop"	"PRIMARY"	"0"	"1"	"id_type"	\N
"ps_hicookietype_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_homeslider"	"PRIMARY"	"0"	"1"	"id_homeslider_slides"	\N
"ps_homeslider"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_homeslider_slides"	"PRIMARY"	"0"	"1"	"id_homeslider_slides"	\N
"ps_homeslider_slides_lang"	"PRIMARY"	"0"	"1"	"id_homeslider_slides"	\N
"ps_homeslider_slides_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_hook"	"hook_name"	"0"	"1"	"name"	\N
"ps_hook"	"PRIMARY"	"0"	"1"	"id_hook"	\N
"ps_hook_alias"	"alias"	"0"	"1"	"alias"	\N
"ps_hook_alias"	"PRIMARY"	"0"	"1"	"id_hook_alias"	\N
"ps_hook_module"	"id_hook"	"1"	"1"	"id_hook"	\N
"ps_hook_module"	"id_module"	"1"	"1"	"id_module"	\N
"ps_hook_module"	"position"	"1"	"1"	"id_shop"	\N
"ps_hook_module"	"position"	"1"	"2"	"position"	\N
"ps_hook_module"	"PRIMARY"	"0"	"1"	"id_module"	\N
"ps_hook_module"	"PRIMARY"	"0"	"2"	"id_hook"	\N
"ps_hook_module"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_hook_module_exceptions"	"id_hook"	"1"	"1"	"id_hook"	\N
"ps_hook_module_exceptions"	"id_module"	"1"	"1"	"id_module"	\N
"ps_hook_module_exceptions"	"PRIMARY"	"0"	"1"	"id_hook_module_exceptions"	\N
"ps_idoklad_pair"	"id_order_state"	"0"	"1"	"id_order_state"	\N
"ps_image"	"idx_product_image"	"0"	"1"	"id_image"	\N
"ps_image"	"idx_product_image"	"0"	"2"	"id_product"	\N
"ps_image"	"idx_product_image"	"0"	"3"	"cover"	\N
"ps_image"	"id_product_cover"	"0"	"1"	"id_product"	\N
"ps_image"	"id_product_cover"	"0"	"2"	"cover"	\N
"ps_image"	"image_product"	"1"	"1"	"id_product"	\N
"ps_image"	"PRIMARY"	"0"	"1"	"id_image"	\N
"ps_image_lang"	"id_image"	"1"	"1"	"id_image"	\N
"ps_image_lang"	"PRIMARY"	"0"	"1"	"id_image"	\N
"ps_image_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_image_shop"	"id_product"	"0"	"1"	"id_product"	\N
"ps_image_shop"	"id_product"	"0"	"2"	"id_shop"	\N
"ps_image_shop"	"id_product"	"0"	"3"	"cover"	\N
"ps_image_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_image_shop"	"PRIMARY"	"0"	"1"	"id_image"	\N
"ps_image_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_image_type"	"image_type_name"	"1"	"1"	"name"	\N
"ps_image_type"	"PRIMARY"	"0"	"1"	"id_image_type"	\N
"ps_import_match"	"PRIMARY"	"0"	"1"	"id_import_match"	\N
"ps_info"	"PRIMARY"	"0"	"1"	"id_info"	\N
"ps_info2"	"PRIMARY"	"0"	"1"	"id_info2"	\N
"ps_info2_lang"	"PRIMARY"	"0"	"1"	"id_info2"	\N
"ps_info2_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_info3"	"PRIMARY"	"0"	"1"	"id_info3"	\N
"ps_info3_lang"	"PRIMARY"	"0"	"1"	"id_info3"	\N
"ps_info3_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_info_lang"	"PRIMARY"	"0"	"1"	"id_info"	\N
"ps_info_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_info_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_info_shop"	"PRIMARY"	"0"	"1"	"id_info"	\N
"ps_info_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_jm_pagecache"	"deleted"	"1"	"1"	"deleted"	\N
"ps_jm_pagecache"	"id_context"	"1"	"1"	"id_context"	\N
"ps_jm_pagecache"	"id_controller"	"1"	"1"	"id_controller"	\N
"ps_jm_pagecache"	"id_controller_last_gen"	"1"	"1"	"id_controller"	\N
"ps_jm_pagecache"	"id_controller_last_gen"	"1"	"2"	"last_gen"	\N
"ps_jm_pagecache"	"id_controller_object"	"1"	"1"	"id_controller"	\N
"ps_jm_pagecache"	"id_controller_object"	"1"	"2"	"id_object"	\N
"ps_jm_pagecache"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_jm_pagecache"	"last_gen"	"1"	"1"	"last_gen"	\N
"ps_jm_pagecache"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_jm_pagecache"	"url_id_context"	"0"	"1"	"url"	\N
"ps_jm_pagecache"	"url_id_context"	"0"	"2"	"id_context"	\N
"ps_jm_pagecache_bl"	"backlink_key"	"1"	"1"	"backlink_key"	\N
"ps_jm_pagecache_bl"	"id"	"1"	"1"	"id"	\N
"ps_jm_pagecache_contexts"	"context_key"	"0"	"1"	"context_key"	\N
"ps_jm_pagecache_contexts"	"idx_active_context"	"1"	"1"	"active"	\N
"ps_jm_pagecache_contexts"	"idx_find_context"	"1"	"1"	"id_shop"	\N
"ps_jm_pagecache_contexts"	"idx_find_context"	"1"	"2"	"id_lang"	\N
"ps_jm_pagecache_contexts"	"idx_find_context"	"1"	"3"	"id_currency"	\N
"ps_jm_pagecache_contexts"	"idx_find_context"	"1"	"4"	"id_fake_customer"	\N
"ps_jm_pagecache_contexts"	"idx_find_context"	"1"	"5"	"id_device"	\N
"ps_jm_pagecache_contexts"	"idx_find_context"	"1"	"6"	"id_country"	\N
"ps_jm_pagecache_contexts"	"idx_find_context"	"1"	"7"	"id_tax_csz"	\N
"ps_jm_pagecache_contexts"	"idx_find_context"	"1"	"8"	"id_specifics"	\N
"ps_jm_pagecache_contexts"	"idx_find_context_full"	"0"	"1"	"id_shop"	\N
"ps_jm_pagecache_contexts"	"idx_find_context_full"	"0"	"2"	"id_lang"	\N
"ps_jm_pagecache_contexts"	"idx_find_context_full"	"0"	"3"	"id_currency"	\N
"ps_jm_pagecache_contexts"	"idx_find_context_full"	"0"	"4"	"id_fake_customer"	\N
"ps_jm_pagecache_contexts"	"idx_find_context_full"	"0"	"5"	"id_device"	\N
"ps_jm_pagecache_contexts"	"idx_find_context_full"	"0"	"6"	"id_country"	\N
"ps_jm_pagecache_contexts"	"idx_find_context_full"	"0"	"7"	"id_tax_csz"	\N
"ps_jm_pagecache_contexts"	"idx_find_context_full"	"0"	"8"	"id_specifics"	\N
"ps_jm_pagecache_contexts"	"idx_find_context_full"	"0"	"9"	"v_css"	\N
"ps_jm_pagecache_contexts"	"idx_find_context_full"	"0"	"10"	"v_js"	\N
"ps_jm_pagecache_contexts"	"idx_order_context"	"1"	"1"	"used_by_cw"	\N
"ps_jm_pagecache_contexts"	"idx_order_context"	"1"	"2"	"date_add"	\N
"ps_jm_pagecache_contexts"	"idx_uniq_key"	"0"	"1"	"uniq_key"	\N
"ps_jm_pagecache_contexts"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_jm_pagecache_details"	"details_md5"	"1"	"1"	"details_md5"	\N
"ps_jm_pagecache_details"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_jm_pagecache_mods"	"id_module"	"1"	"1"	"id_module"	\N
"ps_jm_pagecache_mods"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_jm_pagecache_mods"	"PRIMARY"	"0"	"2"	"id_module"	\N
"ps_jm_pagecache_perfs"	"date_add_idx"	"1"	"1"	"date_add"	\N
"ps_jm_pagecache_perfs"	"day_add_idx"	"1"	"1"	"day_add"	\N
"ps_jm_pagecache_perfs"	"idx_sd"	"1"	"1"	"id_shop"	\N
"ps_jm_pagecache_perfs"	"idx_sd"	"1"	"2"	"day_add"	\N
"ps_jm_pagecache_perfs"	"idx_sdc"	"1"	"1"	"id_shop"	\N
"ps_jm_pagecache_perfs"	"idx_sdc"	"1"	"2"	"day_add"	\N
"ps_jm_pagecache_perfs"	"idx_sdc"	"1"	"3"	"id_controller"	\N
"ps_jm_pagecache_perfs"	"id_shop_idx"	"1"	"1"	"id_shop"	\N
"ps_jm_pagecache_perfs"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_jm_pagecache_prof"	"PRIMARY"	"0"	"1"	"id_profiling"	\N
"ps_jm_pagecache_sp"	"idxfrom"	"1"	"1"	"date_from"	\N
"ps_jm_pagecache_sp"	"idxto"	"1"	"1"	"date_to"	\N
"ps_jm_pagecache_sp"	"PRIMARY"	"0"	"1"	"id_specific_price"	\N
"ps_lang"	"PRIMARY"	"0"	"1"	"id_lang"	\N
"ps_lang_shop"	"IDX_2F43BFC7274A50A0"	"1"	"1"	"id_shop"	\N
"ps_lang_shop"	"IDX_2F43BFC7BA299860"	"1"	"1"	"id_lang"	\N
"ps_lang_shop"	"PRIMARY"	"0"	"1"	"id_lang"	\N
"ps_lang_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_layered_category"	"id_category"	"1"	"1"	"id_category"	\N
"ps_layered_category"	"id_category"	"1"	"2"	"type"	\N
"ps_layered_category"	"id_category_shop"	"1"	"1"	"id_category"	\N
"ps_layered_category"	"id_category_shop"	"1"	"2"	"id_shop"	\N
"ps_layered_category"	"id_category_shop"	"1"	"3"	"type"	\N
"ps_layered_category"	"id_category_shop"	"1"	"4"	"id_value"	\N
"ps_layered_category"	"id_category_shop"	"1"	"5"	"position"	\N
"ps_layered_category"	"PRIMARY"	"0"	"1"	"id_layered_category"	\N
"ps_layered_filter"	"PRIMARY"	"0"	"1"	"id_layered_filter"	\N
"ps_layered_filter_block"	"PRIMARY"	"0"	"1"	"hash"	\N
"ps_layered_filter_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_layered_filter_shop"	"PRIMARY"	"0"	"1"	"id_layered_filter"	\N
"ps_layered_filter_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_layered_indexable_attribute_group"	"PRIMARY"	"0"	"1"	"id_attribute_group"	\N
"ps_layered_indexable_attribute_group_lang_value"	"PRIMARY"	"0"	"1"	"id_attribute_group"	\N
"ps_layered_indexable_attribute_group_lang_value"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_layered_indexable_attribute_lang_value"	"PRIMARY"	"0"	"1"	"id_attribute"	\N
"ps_layered_indexable_attribute_lang_value"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_layered_indexable_feature"	"PRIMARY"	"0"	"1"	"id_feature"	\N
"ps_layered_indexable_feature_lang_value"	"PRIMARY"	"0"	"1"	"id_feature"	\N
"ps_layered_indexable_feature_lang_value"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_layered_indexable_feature_value_lang_value"	"PRIMARY"	"0"	"1"	"id_feature_value"	\N
"ps_layered_indexable_feature_value_lang_value"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_layered_price_index"	"id_currency"	"1"	"1"	"id_currency"	\N
"ps_layered_price_index"	"price_max"	"1"	"1"	"price_max"	\N
"ps_layered_price_index"	"price_min"	"1"	"1"	"price_min"	\N
"ps_layered_price_index"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_layered_price_index"	"PRIMARY"	"0"	"2"	"id_currency"	\N
"ps_layered_price_index"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_layered_price_index"	"PRIMARY"	"0"	"4"	"id_country"	\N
"ps_layered_product_attribute"	"id_attribute_group"	"0"	"1"	"id_attribute_group"	\N
"ps_layered_product_attribute"	"id_attribute_group"	"0"	"2"	"id_attribute"	\N
"ps_layered_product_attribute"	"id_attribute_group"	"0"	"3"	"id_product"	\N
"ps_layered_product_attribute"	"id_attribute_group"	"0"	"4"	"id_shop"	\N
"ps_layered_product_attribute"	"PRIMARY"	"0"	"1"	"id_attribute"	\N
"ps_layered_product_attribute"	"PRIMARY"	"0"	"2"	"id_product"	\N
"ps_layered_product_attribute"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_linksmenutop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_linksmenutop"	"PRIMARY"	"0"	"1"	"id_linksmenutop"	\N
"ps_linksmenutop_lang"	"id_linksmenutop"	"1"	"1"	"id_linksmenutop"	\N
"ps_linksmenutop_lang"	"id_linksmenutop"	"1"	"2"	"id_lang"	\N
"ps_linksmenutop_lang"	"id_linksmenutop"	"1"	"3"	"id_shop"	\N
"ps_link_block"	"PRIMARY"	"0"	"1"	"id_link_block"	\N
"ps_link_block_lang"	"PRIMARY"	"0"	"1"	"id_link_block"	\N
"ps_link_block_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_link_block_shop"	"PRIMARY"	"0"	"1"	"id_link_block"	\N
"ps_link_block_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_livechat_api"	"PRIMARY"	"0"	"1"	"id_api"	\N
"ps_livechat_api"	"uniq_shop_name"	"0"	"1"	"id_shop"	\N
"ps_livechat_api"	"uniq_shop_name"	"0"	"2"	"name"	\N
"ps_livechat_export"	"PRIMARY"	"0"	"1"	"id_export"	\N
"ps_livechat_export"	"uniq_shop_name"	"0"	"1"	"id_shop"	\N
"ps_livechat_export"	"uniq_shop_name"	"0"	"2"	"name"	\N
"ps_livechat_socket"	"PRIMARY"	"0"	"1"	"id_socket"	\N
"ps_livechat_socket"	"uniq_shop_socket"	"0"	"1"	"id_shop"	\N
"ps_log"	"PRIMARY"	"0"	"1"	"id_log"	\N
"ps_mail"	"PRIMARY"	"0"	"1"	"id_mail"	\N
"ps_mail"	"recipient"	"1"	"1"	"recipient"	"10"
"ps_mailalert_customer_oos"	"PRIMARY"	"0"	"1"	"id_customer"	\N
"ps_mailalert_customer_oos"	"PRIMARY"	"0"	"2"	"customer_email"	\N
"ps_mailalert_customer_oos"	"PRIMARY"	"0"	"3"	"id_product"	\N
"ps_mailalert_customer_oos"	"PRIMARY"	"0"	"4"	"id_product_attribute"	\N
"ps_mailalert_customer_oos"	"PRIMARY"	"0"	"5"	"id_shop"	\N
"ps_manufacturer"	"PRIMARY"	"0"	"1"	"id_manufacturer"	\N
"ps_manufacturer_lang"	"PRIMARY"	"0"	"1"	"id_manufacturer"	\N
"ps_manufacturer_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_manufacturer_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_manufacturer_shop"	"PRIMARY"	"0"	"1"	"id_manufacturer"	\N
"ps_manufacturer_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_marketplace_orders"	"mp_order_id"	"1"	"1"	"mp_order_id"	\N
"ps_marketplace_orders"	"PRIMARY"	"0"	"1"	"id_order"	\N
"ps_marketplace_order_address"	"date_idx"	"1"	"1"	"date"	\N
"ps_marketplace_order_address"	"mp_order_id_idx"	"0"	"1"	"mp_order_id"	\N
"ps_marketplace_order_items"	"id_order_idx"	"1"	"1"	"id_order"	\N
"ps_marketplace_order_items"	"mp_order_id_idx"	"1"	"1"	"mp_order_id"	\N
"ps_marketplace_order_items"	"order_items_idx"	"0"	"1"	"mp_order_id"	\N
"ps_marketplace_order_items"	"order_items_idx"	"0"	"2"	"order_item_id"	\N
"ps_marketplace_product_action"	"id_lang"	"1"	"1"	"id_lang"	\N
"ps_marketplace_product_action"	"id_lang"	"1"	"2"	"marketplace"	\N
"ps_marketplace_product_action"	"id_product"	"0"	"1"	"id_product"	\N
"ps_marketplace_product_action"	"id_product"	"0"	"2"	"id_lang"	\N
"ps_marketplace_product_action"	"id_product"	"0"	"3"	"marketplace"	\N
"ps_marketplace_product_action"	"id_product"	"0"	"4"	"action"	\N
"ps_marketplace_product_option"	"ASIN"	"1"	"1"	"asin1"	\N
"ps_marketplace_product_option"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_marketplace_product_option"	"PRIMARY"	"0"	"2"	"id_product_attribute"	\N
"ps_marketplace_product_option"	"PRIMARY"	"0"	"3"	"id_lang"	\N
"ps_marketplace_stats"	"order"	"0"	"1"	"marketplace"	\N
"ps_marketplace_stats"	"order"	"0"	"2"	"mp_order_id"	\N
"ps_marketplace_strategies"	"id_product"	"1"	"1"	"id_product"	\N
"ps_marketplace_strategies"	"id_product_lang"	"1"	"1"	"id_product"	\N
"ps_marketplace_strategies"	"id_product_lang"	"1"	"2"	"id_lang"	\N
"ps_marketplace_strategies"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_marketplace_taxes"	"lang_index"	"1"	"1"	"lang"	\N
"ps_marketplace_taxes"	"PRIMARY"	"0"	"1"	"ptc"	\N
"ps_marketplace_taxes"	"PRIMARY"	"0"	"2"	"lang"	\N
"ps_marketplace_vat_report"	"order"	"0"	"1"	"marketplace"	\N
"ps_marketplace_vat_report"	"order"	"0"	"2"	"mp_order_id"	\N
"ps_mbo_api_config"	"PRIMARY"	"0"	"1"	"id_mbo_api_config"	\N
"ps_memcached_servers"	"PRIMARY"	"0"	"1"	"id_memcached_server"	\N
"ps_message"	"id_cart"	"1"	"1"	"id_cart"	\N
"ps_message"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_message"	"id_employee"	"1"	"1"	"id_employee"	\N
"ps_message"	"message_order"	"1"	"1"	"id_order"	\N
"ps_message"	"PRIMARY"	"0"	"1"	"id_message"	\N
"ps_message_readed"	"PRIMARY"	"0"	"1"	"id_message"	\N
"ps_message_readed"	"PRIMARY"	"0"	"2"	"id_employee"	\N
"ps_meta"	"page"	"0"	"1"	"page"	\N
"ps_meta"	"PRIMARY"	"0"	"1"	"id_meta"	\N
"ps_meta_lang"	"id_lang"	"1"	"1"	"id_lang"	\N
"ps_meta_lang"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_meta_lang"	"PRIMARY"	"0"	"1"	"id_meta"	\N
"ps_meta_lang"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_meta_lang"	"PRIMARY"	"0"	"3"	"id_lang"	\N
"ps_migrationpro_configuration"	"name"	"0"	"1"	"name"	\N
"ps_migrationpro_configuration"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_migrationpro_data"	"PRIMARY"	"0"	"1"	"id_data"	\N
"ps_migrationpro_data"	"type"	"1"	"1"	"type"	\N
"ps_migrationpro_data"	"type_source_id"	"0"	"1"	"type"	\N
"ps_migrationpro_data"	"type_source_id"	"0"	"2"	"source_id"	\N
"ps_migrationpro_error_logs"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_migrationpro_mapping"	"PRIMARY"	"0"	"1"	"id_mapping"	\N
"ps_migrationpro_migrated_data"	"entity_type_source_id"	"0"	"1"	"entity_type"	\N
"ps_migrationpro_migrated_data"	"entity_type_source_id"	"0"	"2"	"source_id"	\N
"ps_migrationpro_migrated_data"	"PRIMARY"	"0"	"1"	"id_data"	\N
"ps_migrationpro_pass"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_migrationpro_process"	"PRIMARY"	"0"	"1"	"id_process"	\N
"ps_migrationpro_save_mapping"	"PRIMARY"	"0"	"1"	"id_mapping"	\N
"ps_migrationpro_warning_logs"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_mobassistantconnector_accounts"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_mobassistantconnector_accounts"	"UNQ_MOB_ACCOUNT"	"0"	"1"	"account_email"	\N
"ps_mobassistantconnector_devices"	"PRIMARY"	"0"	"1"	"device_unique_id"	\N
"ps_mobassistantconnector_devices"	"UNQ_MOB_DEV_ID"	"0"	"1"	"device_unique"	\N
"ps_mobassistantconnector_devices"	"UNQ_MOB_DEV_ID"	"0"	"2"	"account_id"	\N
"ps_mobassistantconnector_failed_login"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_mobassistantconnector_push_notifications"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_mobassistantconnector_session_keys"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_mobassistantconnector_session_keys"	"UNQ_MOB_USER_ID"	"0"	"1"	"user_id"	\N
"ps_mobassistantconnector_users"	"PRIMARY"	"0"	"1"	"user_id"	\N
"ps_mobassistantconnector_users"	"UNQ_MOB_USER"	"0"	"1"	"username"	\N
"ps_module"	"name"	"1"	"1"	"name"	\N
"ps_module"	"name_UNIQUE"	"0"	"1"	"name"	\N
"ps_module"	"PRIMARY"	"0"	"1"	"id_module"	\N
"ps_module_access"	"PRIMARY"	"0"	"1"	"id_profile"	\N
"ps_module_access"	"PRIMARY"	"0"	"2"	"id_authorization_role"	\N
"ps_module_carrier"	"id_module"	"1"	"1"	"id_module"	\N
"ps_module_carrier"	"id_module"	"1"	"2"	"id_shop"	\N
"ps_module_carrier"	"id_module"	"1"	"3"	"id_reference"	\N
"ps_module_carrier1"	"PRIMARY"	"0"	"1"	"id_module"	\N
"ps_module_carrier1"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_module_carrier1"	"PRIMARY"	"0"	"3"	"id_reference"	\N
"ps_module_country"	"PRIMARY"	"0"	"1"	"id_module"	\N
"ps_module_country"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_module_country"	"PRIMARY"	"0"	"3"	"id_country"	\N
"ps_module_currency"	"id_module"	"1"	"1"	"id_module"	\N
"ps_module_currency"	"PRIMARY"	"0"	"1"	"id_module"	\N
"ps_module_currency"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_module_currency"	"PRIMARY"	"0"	"3"	"id_currency"	\N
"ps_module_group"	"PRIMARY"	"0"	"1"	"id_module"	\N
"ps_module_group"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_module_group"	"PRIMARY"	"0"	"3"	"id_group"	\N
"ps_module_history"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_module_preference"	"employee_module"	"0"	"1"	"id_employee"	\N
"ps_module_preference"	"employee_module"	"0"	"2"	"module"	\N
"ps_module_preference"	"PRIMARY"	"0"	"1"	"id_module_preference"	\N
"ps_module_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_module_shop"	"PRIMARY"	"0"	"1"	"id_module"	\N
"ps_module_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_my_livechat_api"	"PRIMARY"	"0"	"1"	"id_api"	\N
"ps_my_livechat_api"	"uniq_shop_name"	"0"	"1"	"id_shop"	\N
"ps_my_livechat_api"	"uniq_shop_name"	"0"	"2"	"name"	\N
"ps_my_livechat_chatbots_settings"	"PRIMARY"	"0"	"1"	"id_setting"	\N
"ps_my_livechat_chatbots_settings"	"uniq_shop_lang_chatbots_settings"	"0"	"1"	"id_shop"	\N
"ps_my_livechat_chatbots_settings"	"uniq_shop_lang_chatbots_settings"	"0"	"2"	"id_lang"	\N
"ps_my_livechat_export"	"PRIMARY"	"0"	"1"	"id_export"	\N
"ps_my_livechat_export"	"uniq_shop_name"	"0"	"1"	"id_shop"	\N
"ps_my_livechat_export"	"uniq_shop_name"	"0"	"2"	"name"	\N
"ps_my_livechat_socket"	"PRIMARY"	"0"	"1"	"id_socket"	\N
"ps_my_livechat_socket"	"uniq_shop_socket"	"0"	"1"	"id_shop"	\N
"ps_operating_system"	"PRIMARY"	"0"	"1"	"id_operating_system"	\N
"ps_opwebhooks"	"PRIMARY"	"0"	"1"	"id_opwebhooks"	\N
"ps_opwebhooks_debug_log"	"PRIMARY"	"0"	"1"	"id_opwebhooks_debug_log"	\N
"ps_op_paraphraselog"	"PRIMARY"	"0"	"1"	"id_op_paraphraselog"	\N
"ps_orders"	"current_state"	"1"	"1"	"current_state"	\N
"ps_orders"	"date_add"	"1"	"1"	"date_add"	\N
"ps_orders"	"id_address_delivery"	"1"	"1"	"id_address_delivery"	\N
"ps_orders"	"id_address_invoice"	"1"	"1"	"id_address_invoice"	\N
"ps_orders"	"id_carrier"	"1"	"1"	"id_carrier"	\N
"ps_orders"	"id_cart"	"1"	"1"	"id_cart"	\N
"ps_orders"	"id_currency"	"1"	"1"	"id_currency"	\N
"ps_orders"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_orders"	"id_lang"	"1"	"1"	"id_lang"	\N
"ps_orders"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_orders"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_orders"	"invoice_number"	"1"	"1"	"invoice_number"	\N
"ps_orders"	"PRIMARY"	"0"	"1"	"id_order"	\N
"ps_orders"	"reference"	"1"	"1"	"reference"	\N
"ps_orders_copy"	"current_state"	"1"	"1"	"current_state"	\N
"ps_orders_copy"	"date_add"	"1"	"1"	"date_add"	\N
"ps_orders_copy"	"id_address_delivery"	"1"	"1"	"id_address_delivery"	\N
"ps_orders_copy"	"id_address_invoice"	"1"	"1"	"id_address_invoice"	\N
"ps_orders_copy"	"id_carrier"	"1"	"1"	"id_carrier"	\N
"ps_orders_copy"	"id_cart"	"1"	"1"	"id_cart"	\N
"ps_orders_copy"	"id_currency"	"1"	"1"	"id_currency"	\N
"ps_orders_copy"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_orders_copy"	"id_lang"	"1"	"1"	"id_lang"	\N
"ps_orders_copy"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_orders_copy"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_orders_copy"	"invoice_number"	"1"	"1"	"invoice_number"	\N
"ps_orders_copy"	"PRIMARY"	"0"	"1"	"id_order"	\N
"ps_orders_copy"	"reference"	"1"	"1"	"reference"	\N
"ps_orders_copy2"	"current_state"	"1"	"1"	"current_state"	\N
"ps_orders_copy2"	"date_add"	"1"	"1"	"date_add"	\N
"ps_orders_copy2"	"id_address_delivery"	"1"	"1"	"id_address_delivery"	\N
"ps_orders_copy2"	"id_address_invoice"	"1"	"1"	"id_address_invoice"	\N
"ps_orders_copy2"	"id_carrier"	"1"	"1"	"id_carrier"	\N
"ps_orders_copy2"	"id_cart"	"1"	"1"	"id_cart"	\N
"ps_orders_copy2"	"id_currency"	"1"	"1"	"id_currency"	\N
"ps_orders_copy2"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_orders_copy2"	"id_lang"	"1"	"1"	"id_lang"	\N
"ps_orders_copy2"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_orders_copy2"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_orders_copy2"	"invoice_number"	"1"	"1"	"invoice_number"	\N
"ps_orders_copy2"	"PRIMARY"	"0"	"1"	"id_order"	\N
"ps_orders_copy2"	"reference"	"1"	"1"	"reference"	\N
"ps_order_carrier"	"id_carrier"	"1"	"1"	"id_carrier"	\N
"ps_order_carrier"	"id_order"	"1"	"1"	"id_order"	\N
"ps_order_carrier"	"id_order_invoice"	"1"	"1"	"id_order_invoice"	\N
"ps_order_carrier"	"PRIMARY"	"0"	"1"	"id_order_carrier"	\N
"ps_order_cart_rule"	"id_cart_rule"	"1"	"1"	"id_cart_rule"	\N
"ps_order_cart_rule"	"id_order"	"1"	"1"	"id_order"	\N
"ps_order_cart_rule"	"PRIMARY"	"0"	"1"	"id_order_cart_rule"	\N
"ps_order_detail"	"id_order_id_order_detail"	"1"	"1"	"id_order"	\N
"ps_order_detail"	"id_order_id_order_detail"	"1"	"2"	"id_order_detail"	\N
"ps_order_detail"	"id_tax_rules_group"	"1"	"1"	"id_tax_rules_group"	\N
"ps_order_detail"	"order_detail_order"	"1"	"1"	"id_order"	\N
"ps_order_detail"	"PRIMARY"	"0"	"1"	"id_order_detail"	\N
"ps_order_detail"	"product_attribute_id"	"1"	"1"	"product_attribute_id"	\N
"ps_order_detail"	"product_id"	"1"	"1"	"product_id"	\N
"ps_order_detail"	"product_id"	"1"	"2"	"product_attribute_id"	\N
"ps_order_detail_tax"	"id_order_detail"	"1"	"1"	"id_order_detail"	\N
"ps_order_detail_tax"	"id_tax"	"1"	"1"	"id_tax"	\N
"ps_order_history"	"id_employee"	"1"	"1"	"id_employee"	\N
"ps_order_history"	"id_order_state"	"1"	"1"	"id_order_state"	\N
"ps_order_history"	"order_history_order"	"1"	"1"	"id_order"	\N
"ps_order_history"	"PRIMARY"	"0"	"1"	"id_order_history"	\N
"ps_order_invoice"	"id_order"	"1"	"1"	"id_order"	\N
"ps_order_invoice"	"PRIMARY"	"0"	"1"	"id_order_invoice"	\N
"ps_order_invoice_payment"	"id_order"	"1"	"1"	"id_order"	\N
"ps_order_invoice_payment"	"order_payment"	"1"	"1"	"id_order_payment"	\N
"ps_order_invoice_payment"	"PRIMARY"	"0"	"1"	"id_order_invoice"	\N
"ps_order_invoice_payment"	"PRIMARY"	"0"	"2"	"id_order_payment"	\N
"ps_order_invoice_tax"	"id_tax"	"1"	"1"	"id_tax"	\N
"ps_order_message"	"PRIMARY"	"0"	"1"	"id_order_message"	\N
"ps_order_message_lang"	"PRIMARY"	"0"	"1"	"id_order_message"	\N
"ps_order_message_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_order_payment"	"order_reference"	"1"	"1"	"order_reference"	\N
"ps_order_payment"	"PRIMARY"	"0"	"1"	"id_order_payment"	\N
"ps_order_return"	"id_order"	"1"	"1"	"id_order"	\N
"ps_order_return"	"order_return_customer"	"1"	"1"	"id_customer"	\N
"ps_order_return"	"PRIMARY"	"0"	"1"	"id_order_return"	\N
"ps_order_return_detail"	"PRIMARY"	"0"	"1"	"id_order_return"	\N
"ps_order_return_detail"	"PRIMARY"	"0"	"2"	"id_order_detail"	\N
"ps_order_return_detail"	"PRIMARY"	"0"	"3"	"id_customization"	\N
"ps_order_return_state"	"PRIMARY"	"0"	"1"	"id_order_return_state"	\N
"ps_order_return_state_lang"	"PRIMARY"	"0"	"1"	"id_order_return_state"	\N
"ps_order_return_state_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_order_slip"	"id_order"	"1"	"1"	"id_order"	\N
"ps_order_slip"	"order_slip_customer"	"1"	"1"	"id_customer"	\N
"ps_order_slip"	"PRIMARY"	"0"	"1"	"id_order_slip"	\N
"ps_order_slip_detail"	"PRIMARY"	"0"	"1"	"id_order_slip"	\N
"ps_order_slip_detail"	"PRIMARY"	"0"	"2"	"id_order_detail"	\N
"ps_order_slip_detail_tax"	"id_order_slip_detail"	"1"	"1"	"id_order_slip_detail"	\N
"ps_order_slip_detail_tax"	"id_tax"	"1"	"1"	"id_tax"	\N
"ps_order_state"	"module_name"	"1"	"1"	"module_name"	\N
"ps_order_state"	"PRIMARY"	"0"	"1"	"id_order_state"	\N
"ps_order_state_lang"	"PRIMARY"	"0"	"1"	"id_order_state"	\N
"ps_order_state_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_pack"	"PRIMARY"	"0"	"1"	"id_product_pack"	\N
"ps_pack"	"PRIMARY"	"0"	"2"	"id_product_item"	\N
"ps_pack"	"PRIMARY"	"0"	"3"	"id_product_attribute_item"	\N
"ps_pack"	"product_item"	"1"	"1"	"id_product_item"	\N
"ps_pack"	"product_item"	"1"	"2"	"id_product_attribute_item"	\N
"ps_packetery_address_delivery"	"PRIMARY"	"0"	"1"	"id_carrier"	\N
"ps_packetery_branch"	"PRIMARY"	"0"	"1"	"id_branch"	\N
"ps_packetery_order"	"id_cart"	"0"	"1"	"id_cart"	\N
"ps_packetery_order"	"id_order"	"0"	"1"	"id_order"	\N
"ps_packetery_payment"	"PRIMARY"	"0"	"1"	"module_name"	\N
"ps_packlink_entity"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_page"	"id_object"	"1"	"1"	"id_object"	\N
"ps_page"	"id_page_type"	"1"	"1"	"id_page_type"	\N
"ps_page"	"PRIMARY"	"0"	"1"	"id_page"	\N
"ps_pagenotfound"	"date_add"	"1"	"1"	"date_add"	\N
"ps_pagenotfound"	"PRIMARY"	"0"	"1"	"id_pagenotfound"	\N
"ps_page_type"	"name"	"1"	"1"	"name"	\N
"ps_page_type"	"PRIMARY"	"0"	"1"	"id_page_type"	\N
"ps_page_viewed"	"PRIMARY"	"0"	"1"	"id_page"	\N
"ps_page_viewed"	"PRIMARY"	"0"	"2"	"id_date_range"	\N
"ps_page_viewed"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_paypal_capture"	"PRIMARY"	"0"	"1"	"id_paypal_capture"	\N
"ps_paypal_ipn"	"PRIMARY"	"0"	"1"	"id_paypal_ipn"	\N
"ps_paypal_order"	"PRIMARY"	"0"	"1"	"id_paypal_order"	\N
"ps_paypal_processlogger"	"PRIMARY"	"0"	"1"	"id_paypal_processlogger"	\N
"ps_paypal_vaulting"	"PRIMARY"	"0"	"1"	"id_paypal_vaulting"	\N
"ps_paypal_webhook"	"PRIMARY"	"0"	"1"	"id_paypal_webhook"	\N
"ps_ph_con_employee_token"	"id_employee"	"0"	"1"	"id_employee"	\N
"ps_ph_con_employee_token"	"PRIMARY"	"0"	"1"	"id_ph_con_employee_token"	\N
"ps_pluginhiveshipping"	"PRIMARY"	"0"	"1"	"id_pluginhiveshipping"	\N
"ps_pluginhive_cache"	"PRIMARY"	"0"	"1"	"id_ph_cache"	\N
"ps_pluginhive_orders"	"order_id"	"1"	"1"	"order_id"	\N
"ps_pluginhive_orders"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_pluginhive_shipping"	"PRIMARY"	"0"	"1"	"id_ph_service"	\N
"ps_presmobic_categories_menu"	"PRIMARY"	"0"	"1"	"id_category_menu"	\N
"ps_prestablog_antispam"	"actif"	"1"	"1"	"actif"	\N
"ps_prestablog_antispam"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_prestablog_antispam"	"PRIMARY"	"0"	"1"	"id_prestablog_antispam"	\N
"ps_prestablog_antispam_lang"	"PRIMARY"	"0"	"1"	"id_prestablog_antispam"	\N
"ps_prestablog_antispam_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_prestablog_author"	"PRIMARY"	"0"	"1"	"id_author"	\N
"ps_prestablog_categorie"	"actif"	"1"	"1"	"actif"	\N
"ps_prestablog_categorie"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_prestablog_categorie"	"parent"	"1"	"1"	"parent"	\N
"ps_prestablog_categorie"	"PRIMARY"	"0"	"1"	"id_prestablog_categorie"	\N
"ps_prestablog_categorie_group"	"id_group"	"1"	"1"	"id_group"	\N
"ps_prestablog_categorie_group"	"id_prestablog_categorie"	"1"	"1"	"id_prestablog_categorie"	\N
"ps_prestablog_categorie_lang"	"PRIMARY"	"0"	"1"	"id_prestablog_categorie"	\N
"ps_prestablog_categorie_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_prestablog_categorie_popuplink"	"PRIMARY"	"0"	"1"	"id_prestablog_categorie_popuplink"	\N
"ps_prestablog_color"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_prestablog_commentnews"	"actif"	"1"	"1"	"actif"	\N
"ps_prestablog_commentnews"	"news"	"1"	"1"	"news"	\N
"ps_prestablog_commentnews"	"PRIMARY"	"0"	"1"	"id_prestablog_commentnews"	\N
"ps_prestablog_commentnews_abo"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_prestablog_commentnews_abo"	"news"	"1"	"1"	"news"	\N
"ps_prestablog_commentnews_abo"	"PRIMARY"	"0"	"1"	"id_prestablog_commentnews_abo"	\N
"ps_prestablog_correspondancecategorie"	"categorie"	"1"	"1"	"categorie"	\N
"ps_prestablog_correspondancecategorie"	"news"	"1"	"1"	"news"	\N
"ps_prestablog_correspondancecategorie"	"PRIMARY"	"0"	"1"	"id_prestablog_correspondancecategorie"	\N
"ps_prestablog_correspondancecategorie1"	"categorie"	"1"	"1"	"categorie"	\N
"ps_prestablog_correspondancecategorie1"	"news"	"1"	"1"	"news"	\N
"ps_prestablog_correspondancecategorie1"	"PRIMARY"	"0"	"1"	"id_prestablog_correspondancecategorie"	\N
"ps_prestablog_lookbook"	"PRIMARY"	"0"	"1"	"id_prestablog_lookbook"	\N
"ps_prestablog_lookbook_lang"	"PRIMARY"	"0"	"1"	"id_prestablog_lookbook"	\N
"ps_prestablog_lookbook_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_prestablog_lookbook_product"	"PRIMARY"	"0"	"1"	"id_prestablog_lookbook_product"	\N
"ps_prestablog_news"	"actif"	"1"	"1"	"actif"	\N
"ps_prestablog_news"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_prestablog_news"	"PRIMARY"	"0"	"1"	"id_prestablog_news"	\N
"ps_prestablog_news_lang"	"PRIMARY"	"0"	"1"	"id_prestablog_news"	\N
"ps_prestablog_news_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_prestablog_news_lookbook"	"PRIMARY"	"0"	"1"	"id_prestablog_news_lookbook"	\N
"ps_prestablog_news_newslink"	"id_prestablog_news"	"1"	"1"	"id_prestablog_news"	\N
"ps_prestablog_news_newslink"	"id_prestablog_newslink"	"1"	"1"	"id_prestablog_newslink"	\N
"ps_prestablog_news_newslink"	"PRIMARY"	"0"	"1"	"id_prestablog_news_newslink"	\N
"ps_prestablog_news_popuplink"	"PRIMARY"	"0"	"1"	"id_prestablog_news_popuplink"	\N
"ps_prestablog_news_product"	"id_prestablog_news"	"1"	"1"	"id_prestablog_news"	\N
"ps_prestablog_news_product"	"id_product"	"1"	"1"	"id_product"	\N
"ps_prestablog_news_product"	"PRIMARY"	"0"	"1"	"id_prestablog_news_product"	\N
"ps_prestablog_popup"	"PRIMARY"	"0"	"1"	"id_prestablog_popup"	\N
"ps_prestablog_popup_group"	"PRIMARY"	"0"	"1"	"id_prestablog_popup"	\N
"ps_prestablog_popup_group"	"PRIMARY"	"0"	"2"	"id_group"	\N
"ps_prestablog_popup_lang"	"PRIMARY"	"0"	"1"	"id_prestablog_popup"	\N
"ps_prestablog_popup_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_prestablog_popup_shop"	"PRIMARY"	"0"	"1"	"id_prestablog_popup"	\N
"ps_prestablog_popup_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_prestablog_rate"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_prestablog_slide"	"PRIMARY"	"0"	"1"	"id_slide"	\N
"ps_prestablog_slide_lang"	"PRIMARY"	"0"	"1"	"id_slide"	\N
"ps_prestablog_slide_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_prestablog_subblock"	"actif"	"1"	"1"	"actif"	\N
"ps_prestablog_subblock"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_prestablog_subblock"	"PRIMARY"	"0"	"1"	"id_prestablog_subblock"	\N
"ps_prestablog_subblock_categories"	"PRIMARY"	"0"	"1"	"id_prestablog_subblock"	\N
"ps_prestablog_subblock_categories"	"PRIMARY"	"0"	"2"	"categorie"	\N
"ps_prestablog_subblock_lang"	"PRIMARY"	"0"	"1"	"id_prestablog_subblock"	\N
"ps_prestablog_subblock_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_prestafraud_carrier"	"PRIMARY"	"0"	"1"	"id_carrier"	\N
"ps_prestafraud_carrier"	"PRIMARY"	"0"	"2"	"id_prestafraud_carrier_type"	\N
"ps_prestafraud_carts"	"PRIMARY"	"0"	"1"	"id_cart"	\N
"ps_prestafraud_carts"	"PRIMARY"	"0"	"2"	"ip_address"	\N
"ps_prestafraud_orders"	"PRIMARY"	"0"	"1"	"id_order"	\N
"ps_prestafraud_payment"	"PRIMARY"	"0"	"1"	"id_module"	\N
"ps_prestafraud_payment"	"PRIMARY"	"0"	"2"	"id_prestafraud_payment_type"	\N
"ps_product"	"date_add"	"1"	"1"	"date_add"	\N
"ps_product"	"id_category_default"	"1"	"1"	"id_category_default"	\N
"ps_product"	"indexed"	"1"	"1"	"indexed"	\N
"ps_product"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_product"	"product_manufacturer"	"1"	"1"	"id_manufacturer"	\N
"ps_product"	"product_manufacturer"	"1"	"2"	"id_product"	\N
"ps_product"	"product_supplier"	"1"	"1"	"id_supplier"	\N
"ps_product"	"reference_idx"	"1"	"1"	"reference"	\N
"ps_product"	"state"	"1"	"1"	"state"	\N
"ps_product"	"state"	"1"	"2"	"date_upd"	\N
"ps_product"	"supplier_reference_idx"	"1"	"1"	"supplier_reference"	\N
"ps_product_attachment"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_product_attachment"	"PRIMARY"	"0"	"2"	"id_attachment"	\N
"ps_product_attribute"	"id_product_id_product_attribute"	"1"	"1"	"id_product_attribute"	\N
"ps_product_attribute"	"id_product_id_product_attribute"	"1"	"2"	"id_product"	\N
"ps_product_attribute"	"PRIMARY"	"0"	"1"	"id_product_attribute"	\N
"ps_product_attribute"	"product_attribute_product"	"1"	"1"	"id_product"	\N
"ps_product_attribute"	"product_default"	"0"	"1"	"id_product"	\N
"ps_product_attribute"	"product_default"	"0"	"2"	"default_on"	\N
"ps_product_attribute"	"reference"	"1"	"1"	"reference"	\N
"ps_product_attribute"	"supplier_reference"	"1"	"1"	"supplier_reference"	\N
"ps_product_attribute_combination"	"id_product_attribute"	"1"	"1"	"id_product_attribute"	\N
"ps_product_attribute_combination"	"PRIMARY"	"0"	"1"	"id_attribute"	\N
"ps_product_attribute_combination"	"PRIMARY"	"0"	"2"	"id_product_attribute"	\N
"ps_product_attribute_image"	"id_image"	"1"	"1"	"id_image"	\N
"ps_product_attribute_image"	"PRIMARY"	"0"	"1"	"id_product_attribute"	\N
"ps_product_attribute_image"	"PRIMARY"	"0"	"2"	"id_image"	\N
"ps_product_attribute_lang"	"PRIMARY"	"0"	"1"	"id_product_attribute"	\N
"ps_product_attribute_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_product_attribute_shop"	"id_product"	"0"	"1"	"id_product"	\N
"ps_product_attribute_shop"	"id_product"	"0"	"2"	"id_shop"	\N
"ps_product_attribute_shop"	"id_product"	"0"	"3"	"default_on"	\N
"ps_product_attribute_shop"	"PRIMARY"	"0"	"1"	"id_product_attribute"	\N
"ps_product_attribute_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_product_carrier"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_product_carrier"	"PRIMARY"	"0"	"2"	"id_carrier_reference"	\N
"ps_product_carrier"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_product_comment"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_product_comment"	"id_guest"	"1"	"1"	"id_guest"	\N
"ps_product_comment"	"id_product"	"1"	"1"	"id_product"	\N
"ps_product_comment"	"PRIMARY"	"0"	"1"	"id_product_comment"	\N
"ps_product_comment_criterion"	"PRIMARY"	"0"	"1"	"id_product_comment_criterion"	\N
"ps_product_comment_criterion_category"	"id_category"	"1"	"1"	"id_category"	\N
"ps_product_comment_criterion_category"	"PRIMARY"	"0"	"1"	"id_product_comment_criterion"	\N
"ps_product_comment_criterion_category"	"PRIMARY"	"0"	"2"	"id_category"	\N
"ps_product_comment_criterion_lang"	"PRIMARY"	"0"	"1"	"id_product_comment_criterion"	\N
"ps_product_comment_criterion_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_product_comment_criterion_product"	"id_product_comment_criterion"	"1"	"1"	"id_product_comment_criterion"	\N
"ps_product_comment_criterion_product"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_product_comment_criterion_product"	"PRIMARY"	"0"	"2"	"id_product_comment_criterion"	\N
"ps_product_comment_grade"	"id_product_comment_criterion"	"1"	"1"	"id_product_comment_criterion"	\N
"ps_product_comment_grade"	"PRIMARY"	"0"	"1"	"id_product_comment"	\N
"ps_product_comment_grade"	"PRIMARY"	"0"	"2"	"id_product_comment_criterion"	\N
"ps_product_comment_report"	"PRIMARY"	"0"	"1"	"id_product_comment"	\N
"ps_product_comment_report"	"PRIMARY"	"0"	"2"	"id_customer"	\N
"ps_product_comment_usefulness"	"PRIMARY"	"0"	"1"	"id_product_comment"	\N
"ps_product_comment_usefulness"	"PRIMARY"	"0"	"2"	"id_customer"	\N
"ps_product_country_tax"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_product_country_tax"	"PRIMARY"	"0"	"2"	"id_country"	\N
"ps_product_download"	"PRIMARY"	"0"	"1"	"id_product_download"	\N
"ps_product_group_reduction_cache"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_product_group_reduction_cache"	"PRIMARY"	"0"	"2"	"id_group"	\N
"ps_product_lang"	"id_lang"	"1"	"1"	"id_lang"	\N
"ps_product_lang"	"name"	"1"	"1"	"name"	\N
"ps_product_lang"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_product_lang"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_product_lang"	"PRIMARY"	"0"	"3"	"id_lang"	\N
"ps_product_sale"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_product_sale"	"quantity"	"1"	"1"	"quantity"	\N
"ps_product_shop"	"date_add"	"1"	"1"	"date_add"	\N
"ps_product_shop"	"date_add"	"1"	"2"	"active"	\N
"ps_product_shop"	"date_add"	"1"	"3"	"visibility"	\N
"ps_product_shop"	"id_category_default"	"1"	"1"	"id_category_default"	\N
"ps_product_shop"	"indexed"	"1"	"1"	"indexed"	\N
"ps_product_shop"	"indexed"	"1"	"2"	"active"	\N
"ps_product_shop"	"indexed"	"1"	"3"	"id_product"	\N
"ps_product_shop"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_product_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_product_supplier"	"id_product"	"0"	"1"	"id_product"	\N
"ps_product_supplier"	"id_product"	"0"	"2"	"id_product_attribute"	\N
"ps_product_supplier"	"id_product"	"0"	"3"	"id_supplier"	\N
"ps_product_supplier"	"id_supplier"	"1"	"1"	"id_supplier"	\N
"ps_product_supplier"	"id_supplier"	"1"	"2"	"id_product"	\N
"ps_product_supplier"	"PRIMARY"	"0"	"1"	"id_product_supplier"	\N
"ps_product_tag"	"id_lang"	"1"	"1"	"id_lang"	\N
"ps_product_tag"	"id_lang"	"1"	"2"	"id_tag"	\N
"ps_product_tag"	"id_tag"	"1"	"1"	"id_tag"	\N
"ps_product_tag"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_product_tag"	"PRIMARY"	"0"	"2"	"id_tag"	\N
"ps_profile"	"PRIMARY"	"0"	"1"	"id_profile"	\N
"ps_profile_lang"	"PRIMARY"	"0"	"1"	"id_profile"	\N
"ps_profile_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_pscheckout_authorization"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_pscheckout_capture"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_pscheckout_cart"	"PRIMARY"	"0"	"1"	"id_pscheckout_cart"	\N
"ps_pscheckout_customer"	"PRIMARY"	"0"	"1"	"id_customer"	\N
"ps_pscheckout_customer"	"PRIMARY"	"0"	"2"	"paypal_customer_id"	\N
"ps_pscheckout_funding_source"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_pscheckout_funding_source"	"PRIMARY"	"0"	"1"	"name"	\N
"ps_pscheckout_funding_source"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_pscheckout_order"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_pscheckout_order_matrice"	"PRIMARY"	"0"	"1"	"id_order_matrice"	\N
"ps_pscheckout_payment_token"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_pscheckout_payment_token"	"token_id_merchant_id_paypal_customer_id"	"0"	"1"	"token_id"	\N
"ps_pscheckout_payment_token"	"token_id_merchant_id_paypal_customer_id"	"0"	"2"	"merchant_id"	\N
"ps_pscheckout_payment_token"	"token_id_merchant_id_paypal_customer_id"	"0"	"3"	"paypal_customer_id"	\N
"ps_pscheckout_purchase_unit"	"PRIMARY"	"0"	"1"	"reference_id"	\N
"ps_pscheckout_purchase_unit"	"PRIMARY"	"0"	"2"	"id_order"	\N
"ps_pscheckout_refund"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_psgdpr_consent"	"PRIMARY"	"0"	"1"	"id_gdpr_consent"	\N
"ps_psgdpr_consent"	"PRIMARY"	"0"	"2"	"id_module"	\N
"ps_psgdpr_consent_lang"	"PRIMARY"	"0"	"1"	"id_gdpr_consent"	\N
"ps_psgdpr_consent_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_psgdpr_consent_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_psgdpr_log"	"idx_id_customer"	"1"	"1"	"id_customer"	\N
"ps_psgdpr_log"	"idx_id_customer"	"1"	"2"	"id_guest"	\N
"ps_psgdpr_log"	"idx_id_customer"	"1"	"3"	"client_name"	\N
"ps_psgdpr_log"	"idx_id_customer"	"1"	"4"	"id_module"	\N
"ps_psgdpr_log"	"idx_id_customer"	"1"	"5"	"date_add"	\N
"ps_psgdpr_log"	"idx_id_customer"	"1"	"6"	"date_upd"	\N
"ps_psgdpr_log"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_psgdpr_log"	"PRIMARY"	"0"	"1"	"id_gdpr_log"	\N
"ps_psreassurance"	"PRIMARY"	"0"	"1"	"id_psreassurance"	\N
"ps_psreassurance_lang"	"PRIMARY"	"0"	"1"	"id_psreassurance"	\N
"ps_psreassurance_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_psxdesign_color"	"id_palette"	"1"	"1"	"id_palette"	\N
"ps_psxdesign_color"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_psxdesign_colors_palette"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_psxdesign_fonts"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_psxdesign_logo"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_quick_access"	"PRIMARY"	"0"	"1"	"id_quick_access"	\N
"ps_quick_access_lang"	"PRIMARY"	"0"	"1"	"id_quick_access"	\N
"ps_quick_access_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_range_price"	"id_carrier"	"0"	"1"	"id_carrier"	\N
"ps_range_price"	"id_carrier"	"0"	"2"	"delimiter1"	\N
"ps_range_price"	"id_carrier"	"0"	"3"	"delimiter2"	\N
"ps_range_price"	"PRIMARY"	"0"	"1"	"id_range_price"	\N
"ps_range_weight"	"id_carrier"	"0"	"1"	"id_carrier"	\N
"ps_range_weight"	"id_carrier"	"0"	"2"	"delimiter1"	\N
"ps_range_weight"	"id_carrier"	"0"	"3"	"delimiter2"	\N
"ps_range_weight"	"PRIMARY"	"0"	"1"	"id_range_weight"	\N
"ps_reassurance"	"PRIMARY"	"0"	"1"	"id_reassurance"	\N
"ps_reassurance_lang"	"PRIMARY"	"0"	"1"	"id_reassurance"	\N
"ps_reassurance_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_referrer"	"PRIMARY"	"0"	"1"	"id_referrer"	\N
"ps_referrer_cache"	"PRIMARY"	"0"	"1"	"id_connections_source"	\N
"ps_referrer_cache"	"PRIMARY"	"0"	"2"	"id_referrer"	\N
"ps_referrer_shop"	"PRIMARY"	"0"	"1"	"id_referrer"	\N
"ps_referrer_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_request_sql"	"PRIMARY"	"0"	"1"	"id_request_sql"	\N
"ps_required_field"	"object_name"	"1"	"1"	"object_name"	\N
"ps_required_field"	"PRIMARY"	"0"	"1"	"id_required_field"	\N
"ps_risk"	"PRIMARY"	"0"	"1"	"id_risk"	\N
"ps_risk_lang"	"id_risk"	"1"	"1"	"id_risk"	\N
"ps_risk_lang"	"PRIMARY"	"0"	"1"	"id_risk"	\N
"ps_risk_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_search_engine"	"PRIMARY"	"0"	"1"	"id_search_engine"	\N
"ps_search_index"	"id_product"	"1"	"1"	"id_product"	\N
"ps_search_index"	"id_product"	"1"	"2"	"weight"	\N
"ps_search_index"	"PRIMARY"	"0"	"1"	"id_word"	\N
"ps_search_index"	"PRIMARY"	"0"	"2"	"id_product"	\N
"ps_search_word"	"id_lang"	"0"	"1"	"id_lang"	\N
"ps_search_word"	"id_lang"	"0"	"2"	"id_shop"	\N
"ps_search_word"	"id_lang"	"0"	"3"	"word"	\N
"ps_search_word"	"PRIMARY"	"0"	"1"	"id_word"	\N
"ps_sekeyword"	"PRIMARY"	"0"	"1"	"id_sekeyword"	\N
"ps_sfkhreflang"	"PRIMARY"	"0"	"1"	"id_sfkhreflang"	\N
"ps_sfkhreflang_lang"	"id_sfkhreflang"	"1"	"1"	"id_sfkhreflang"	\N
"ps_sfkhreflang_lang"	"PRIMARY"	"0"	"1"	"id_sfkhreflang"	\N
"ps_sfkhreflang_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_shop"	"IDX_CBDFBB9EF5C9E40"	"1"	"1"	"id_shop_group"	\N
"ps_shop"	"PRIMARY"	"0"	"1"	"id_shop"	\N
"ps_shop_group"	"PRIMARY"	"0"	"1"	"id_shop_group"	\N
"ps_shop_url"	"IDX_279F19DA274A50A0"	"1"	"1"	"id_shop"	\N
"ps_shop_url"	"PRIMARY"	"0"	"1"	"id_shop_url"	\N
"ps_smarty_cache"	"cache_id"	"1"	"1"	"cache_id"	\N
"ps_smarty_cache"	"modified"	"1"	"1"	"modified"	\N
"ps_smarty_cache"	"name"	"1"	"1"	"name"	\N
"ps_smarty_cache"	"PRIMARY"	"0"	"1"	"id_smarty_cache"	\N
"ps_smarty_last_flush"	"PRIMARY"	"0"	"1"	"type"	\N
"ps_smarty_lazy_cache"	"PRIMARY"	"0"	"1"	"template_hash"	\N
"ps_smarty_lazy_cache"	"PRIMARY"	"0"	"2"	"cache_id"	\N
"ps_smarty_lazy_cache"	"PRIMARY"	"0"	"3"	"compile_id"	\N
"ps_specific_price"	"from"	"1"	"1"	"from"	\N
"ps_specific_price"	"from_quantity"	"1"	"1"	"from_quantity"	\N
"ps_specific_price"	"id_cart"	"1"	"1"	"id_cart"	\N
"ps_specific_price"	"id_country"	"1"	"1"	"id_country"	\N
"ps_specific_price"	"id_country"	"1"	"2"	"to"	\N
"ps_specific_price"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_specific_price"	"id_group"	"1"	"1"	"id_group"	\N
"ps_specific_price"	"id_group"	"1"	"2"	"to"	\N
"ps_specific_price"	"id_product"	"1"	"1"	"id_product"	\N
"ps_specific_price"	"id_product"	"1"	"2"	"id_shop"	\N
"ps_specific_price"	"id_product"	"1"	"3"	"id_currency"	\N
"ps_specific_price"	"id_product"	"1"	"4"	"id_country"	\N
"ps_specific_price"	"id_product"	"1"	"5"	"id_group"	\N
"ps_specific_price"	"id_product"	"1"	"6"	"id_customer"	\N
"ps_specific_price"	"id_product"	"1"	"7"	"from_quantity"	\N
"ps_specific_price"	"id_product"	"1"	"8"	"from"	\N
"ps_specific_price"	"id_product"	"1"	"9"	"to"	\N
"ps_specific_price"	"id_product_2"	"0"	"1"	"id_product"	\N
"ps_specific_price"	"id_product_2"	"0"	"2"	"id_product_attribute"	\N
"ps_specific_price"	"id_product_2"	"0"	"3"	"id_customer"	\N
"ps_specific_price"	"id_product_2"	"0"	"4"	"id_cart"	\N
"ps_specific_price"	"id_product_2"	"0"	"5"	"from"	\N
"ps_specific_price"	"id_product_2"	"0"	"6"	"to"	\N
"ps_specific_price"	"id_product_2"	"0"	"7"	"id_shop"	\N
"ps_specific_price"	"id_product_2"	"0"	"8"	"id_shop_group"	\N
"ps_specific_price"	"id_product_2"	"0"	"9"	"id_currency"	\N
"ps_specific_price"	"id_product_2"	"0"	"10"	"id_country"	\N
"ps_specific_price"	"id_product_2"	"0"	"11"	"id_group"	\N
"ps_specific_price"	"id_product_2"	"0"	"12"	"from_quantity"	\N
"ps_specific_price"	"id_product_2"	"0"	"13"	"id_specific_price_rule"	\N
"ps_specific_price"	"id_product_attribute"	"1"	"1"	"id_product_attribute"	\N
"ps_specific_price"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_specific_price"	"id_specific_price_rule"	"1"	"1"	"id_specific_price_rule"	\N
"ps_specific_price"	"PRIMARY"	"0"	"1"	"id_specific_price"	\N
"ps_specific_price"	"to"	"1"	"1"	"to"	\N
"ps_specific_price_priority"	"id_product"	"0"	"1"	"id_product"	\N
"ps_specific_price_priority"	"PRIMARY"	"0"	"1"	"id_specific_price_priority"	\N
"ps_specific_price_priority"	"PRIMARY"	"0"	"2"	"id_product"	\N
"ps_specific_price_rule"	"id_country"	"1"	"1"	"id_country"	\N
"ps_specific_price_rule"	"id_country"	"1"	"2"	"to"	\N
"ps_specific_price_rule"	"id_group"	"1"	"1"	"id_group"	\N
"ps_specific_price_rule"	"id_group"	"1"	"2"	"to"	\N
"ps_specific_price_rule"	"id_product"	"1"	"1"	"id_shop"	\N
"ps_specific_price_rule"	"id_product"	"1"	"2"	"id_currency"	\N
"ps_specific_price_rule"	"id_product"	"1"	"3"	"id_country"	\N
"ps_specific_price_rule"	"id_product"	"1"	"4"	"id_group"	\N
"ps_specific_price_rule"	"id_product"	"1"	"5"	"from_quantity"	\N
"ps_specific_price_rule"	"id_product"	"1"	"6"	"from"	\N
"ps_specific_price_rule"	"id_product"	"1"	"7"	"to"	\N
"ps_specific_price_rule"	"PRIMARY"	"0"	"1"	"id_specific_price_rule"	\N
"ps_specific_price_rule_condition"	"id_specific_price_rule_condition_group"	"1"	"1"	"id_specific_price_rule_condition_group"	\N
"ps_specific_price_rule_condition"	"PRIMARY"	"0"	"1"	"id_specific_price_rule_condition"	\N
"ps_specific_price_rule_condition_group"	"PRIMARY"	"0"	"1"	"id_specific_price_rule_condition_group"	\N
"ps_specific_price_rule_condition_group"	"PRIMARY"	"0"	"2"	"id_specific_price_rule"	\N
"ps_state"	"id_country"	"1"	"1"	"id_country"	\N
"ps_state"	"id_zone"	"1"	"1"	"id_zone"	\N
"ps_state"	"name"	"1"	"1"	"name"	\N
"ps_state"	"PRIMARY"	"0"	"1"	"id_state"	\N
"ps_statssearch"	"PRIMARY"	"0"	"1"	"id_statssearch"	\N
"ps_stfeature_compare"	"PRIMARY"	"0"	"1"	"id_compare"	\N
"ps_stfeature_compare_product"	"PRIMARY"	"0"	"1"	"id_compare"	\N
"ps_stfeature_compare_product"	"PRIMARY"	"0"	"2"	"id_product"	\N
"ps_stfeature_product_review"	"id_customer"	"1"	"1"	"id_customer"	\N
"ps_stfeature_product_review"	"id_guest"	"1"	"1"	"id_guest"	\N
"ps_stfeature_product_review"	"id_product"	"1"	"1"	"id_product"	\N
"ps_stfeature_product_review"	"PRIMARY"	"0"	"1"	"id_product_review"	\N
"ps_stfeature_product_review_criterion"	"PRIMARY"	"0"	"1"	"id_product_review_criterion"	\N
"ps_stfeature_product_review_criterion_category"	"id_category"	"1"	"1"	"id_category"	\N
"ps_stfeature_product_review_criterion_category"	"PRIMARY"	"0"	"1"	"id_product_review_criterion"	\N
"ps_stfeature_product_review_criterion_category"	"PRIMARY"	"0"	"2"	"id_category"	\N
"ps_stfeature_product_review_criterion_lang"	"PRIMARY"	"0"	"1"	"id_product_review_criterion"	\N
"ps_stfeature_product_review_criterion_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_stfeature_product_review_criterion_product"	"id_product_review_criterion"	"1"	"1"	"id_product_review_criterion"	\N
"ps_stfeature_product_review_criterion_product"	"PRIMARY"	"0"	"1"	"id_product"	\N
"ps_stfeature_product_review_criterion_product"	"PRIMARY"	"0"	"2"	"id_product_review_criterion"	\N
"ps_stfeature_product_review_grade"	"id_product_review_criterion"	"1"	"1"	"id_product_review_criterion"	\N
"ps_stfeature_product_review_grade"	"PRIMARY"	"0"	"1"	"id_product_review"	\N
"ps_stfeature_product_review_grade"	"PRIMARY"	"0"	"2"	"id_product_review_criterion"	\N
"ps_stfeature_product_review_report"	"PRIMARY"	"0"	"1"	"id_product_review"	\N
"ps_stfeature_product_review_report"	"PRIMARY"	"0"	"2"	"id_customer"	\N
"ps_stfeature_product_review_usefulness"	"PRIMARY"	"0"	"1"	"id_product_review"	\N
"ps_stfeature_product_review_usefulness"	"PRIMARY"	"0"	"2"	"id_customer"	\N
"ps_stfeature_wishlist"	"PRIMARY"	"0"	"1"	"id_wishlist"	\N
"ps_stfeature_wishlist_product"	"PRIMARY"	"0"	"1"	"id_wishlist_product"	\N
"ps_stock"	"id_product"	"1"	"1"	"id_product"	\N
"ps_stock"	"id_product_attribute"	"1"	"1"	"id_product_attribute"	\N
"ps_stock"	"id_warehouse"	"1"	"1"	"id_warehouse"	\N
"ps_stock"	"PRIMARY"	"0"	"1"	"id_stock"	\N
"ps_stock_available"	"id_product"	"1"	"1"	"id_product"	\N
"ps_stock_available"	"id_product_attribute"	"1"	"1"	"id_product_attribute"	\N
"ps_stock_available"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_stock_available"	"id_shop_group"	"1"	"1"	"id_shop_group"	\N
"ps_stock_available"	"PRIMARY"	"0"	"1"	"id_stock_available"	\N
"ps_stock_available"	"product_sqlstock"	"0"	"1"	"id_product"	\N
"ps_stock_available"	"product_sqlstock"	"0"	"2"	"id_product_attribute"	\N
"ps_stock_available"	"product_sqlstock"	"0"	"3"	"id_shop"	\N
"ps_stock_available"	"product_sqlstock"	"0"	"4"	"id_shop_group"	\N
"ps_stock_mvt"	"id_stock"	"1"	"1"	"id_stock"	\N
"ps_stock_mvt"	"id_stock_mvt_reason"	"1"	"1"	"id_stock_mvt_reason"	\N
"ps_stock_mvt"	"PRIMARY"	"0"	"1"	"id_stock_mvt"	\N
"ps_stock_mvt_reason"	"PRIMARY"	"0"	"1"	"id_stock_mvt_reason"	\N
"ps_stock_mvt_reason_lang"	"PRIMARY"	"0"	"1"	"id_stock_mvt_reason"	\N
"ps_stock_mvt_reason_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_store"	"PRIMARY"	"0"	"1"	"id_store"	\N
"ps_store_lang"	"PRIMARY"	"0"	"1"	"id_store"	\N
"ps_store_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_store_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_store_shop"	"PRIMARY"	"0"	"1"	"id_store"	\N
"ps_store_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_stripe_capture"	"PRIMARY"	"0"	"1"	"id_stripe_capture"	\N
"ps_stripe_customer"	"PRIMARY"	"0"	"1"	"id_stripe_customer"	\N
"ps_stripe_event"	"ix_id_payment_intentstatus"	"0"	"1"	"id_payment_intent"	\N
"ps_stripe_event"	"ix_id_payment_intentstatus"	"0"	"2"	"status"	\N
"ps_stripe_event"	"PRIMARY"	"0"	"1"	"id_stripe_event"	\N
"ps_stripe_idempotency_key"	"PRIMARY"	"0"	"1"	"id_idempotency_key"	\N
"ps_stripe_lock_keys"	"PRIMARY"	"0"	"1"	"key_id"	\N
"ps_stripe_official_processlogger"	"PRIMARY"	"0"	"1"	"id_stripe_official_processlogger"	\N
"ps_stripe_payment"	"PRIMARY"	"0"	"1"	"id_payment"	\N
"ps_stripe_payment_intent"	"PRIMARY"	"0"	"1"	"id_stripe_payment_intent"	\N
"ps_stripe_webhook"	"PRIMARY"	"0"	"1"	"id_stripe_account_details"	\N
"ps_supplier"	"PRIMARY"	"0"	"1"	"id_supplier"	\N
"ps_supplier_lang"	"PRIMARY"	"0"	"1"	"id_supplier"	\N
"ps_supplier_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_supplier_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_supplier_shop"	"PRIMARY"	"0"	"1"	"id_supplier"	\N
"ps_supplier_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_supply_order"	"id_supplier"	"1"	"1"	"id_supplier"	\N
"ps_supply_order"	"id_warehouse"	"1"	"1"	"id_warehouse"	\N
"ps_supply_order"	"PRIMARY"	"0"	"1"	"id_supply_order"	\N
"ps_supply_order"	"reference"	"1"	"1"	"reference"	\N
"ps_supply_order_detail"	"id_product_attribute"	"1"	"1"	"id_product_attribute"	\N
"ps_supply_order_detail"	"id_product_product_attribute"	"1"	"1"	"id_product"	\N
"ps_supply_order_detail"	"id_product_product_attribute"	"1"	"2"	"id_product_attribute"	\N
"ps_supply_order_detail"	"id_supply_order"	"1"	"1"	"id_supply_order"	\N
"ps_supply_order_detail"	"id_supply_order"	"1"	"2"	"id_product"	\N
"ps_supply_order_detail"	"PRIMARY"	"0"	"1"	"id_supply_order_detail"	\N
"ps_supply_order_history"	"id_employee"	"1"	"1"	"id_employee"	\N
"ps_supply_order_history"	"id_state"	"1"	"1"	"id_state"	\N
"ps_supply_order_history"	"id_supply_order"	"1"	"1"	"id_supply_order"	\N
"ps_supply_order_history"	"PRIMARY"	"0"	"1"	"id_supply_order_history"	\N
"ps_supply_order_receipt_history"	"id_supply_order_detail"	"1"	"1"	"id_supply_order_detail"	\N
"ps_supply_order_receipt_history"	"id_supply_order_state"	"1"	"1"	"id_supply_order_state"	\N
"ps_supply_order_receipt_history"	"PRIMARY"	"0"	"1"	"id_supply_order_receipt_history"	\N
"ps_supply_order_state"	"PRIMARY"	"0"	"1"	"id_supply_order_state"	\N
"ps_supply_order_state_lang"	"PRIMARY"	"0"	"1"	"id_supply_order_state"	\N
"ps_supply_order_state_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_tab"	"PRIMARY"	"0"	"1"	"id_tab"	\N
"ps_tab1"	"PRIMARY"	"0"	"1"	"id_tab"	\N
"ps_tablewatcher_get_product"	"id_product"	"1"	"1"	"id_product"	\N
"ps_tablewatcher_get_product"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_tablewatcher_get_product"	"product_type"	"1"	"1"	"product_type"	\N
"ps_tablewatcher_get_product"	"reference"	"1"	"1"	"reference"	\N
"ps_tablewatcher_product_type"	"PRIMARY"	"0"	"1"	"id"	\N
"ps_tab_advice"	"PRIMARY"	"0"	"1"	"id_tab"	\N
"ps_tab_advice"	"PRIMARY"	"0"	"2"	"id_advice"	\N
"ps_tab_lang"	"IDX_CFD9262DBA299860"	"1"	"1"	"id_lang"	\N
"ps_tab_lang"	"IDX_CFD9262DED47AB56"	"1"	"1"	"id_tab"	\N
"ps_tab_lang"	"PRIMARY"	"0"	"1"	"id_tab"	\N
"ps_tab_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_tab_module_preference"	"employee_module"	"0"	"1"	"id_employee"	\N
"ps_tab_module_preference"	"employee_module"	"0"	"2"	"id_tab"	\N
"ps_tab_module_preference"	"employee_module"	"0"	"3"	"module"	\N
"ps_tab_module_preference"	"PRIMARY"	"0"	"1"	"id_tab_module_preference"	\N
"ps_tag"	"id_lang"	"1"	"1"	"id_lang"	\N
"ps_tag"	"PRIMARY"	"0"	"1"	"id_tag"	\N
"ps_tag"	"tag_name"	"1"	"1"	"name"	\N
"ps_tag_count"	"id_group"	"1"	"1"	"id_group"	\N
"ps_tag_count"	"id_group"	"1"	"2"	"id_lang"	\N
"ps_tag_count"	"id_group"	"1"	"3"	"id_shop"	\N
"ps_tag_count"	"id_group"	"1"	"4"	"counter"	\N
"ps_tag_count"	"PRIMARY"	"0"	"1"	"id_group"	\N
"ps_tag_count"	"PRIMARY"	"0"	"2"	"id_tag"	\N
"ps_tax"	"PRIMARY"	"0"	"1"	"id_tax"	\N
"ps_tax_lang"	"PRIMARY"	"0"	"1"	"id_tax"	\N
"ps_tax_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_tax_rule"	"category_getproducts"	"1"	"1"	"id_tax_rules_group"	\N
"ps_tax_rule"	"category_getproducts"	"1"	"2"	"id_country"	\N
"ps_tax_rule"	"category_getproducts"	"1"	"3"	"id_state"	\N
"ps_tax_rule"	"category_getproducts"	"1"	"4"	"zipcode_from"	\N
"ps_tax_rule"	"id_tax"	"1"	"1"	"id_tax"	\N
"ps_tax_rule"	"id_tax_rules_group"	"1"	"1"	"id_tax_rules_group"	\N
"ps_tax_rule"	"PRIMARY"	"0"	"1"	"id_tax_rule"	\N
"ps_tax_rules_group"	"PRIMARY"	"0"	"1"	"id_tax_rules_group"	\N
"ps_tax_rules_group_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_tax_rules_group_shop"	"PRIMARY"	"0"	"1"	"id_tax_rules_group"	\N
"ps_tax_rules_group_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_timezone"	"PRIMARY"	"0"	"1"	"id_timezone"	\N
"ps_translation"	"IDX_ADEBEB36BA299860"	"1"	"1"	"id_lang"	\N
"ps_translation"	"key"	"1"	"1"	"domain"	\N
"ps_translation"	"PRIMARY"	"0"	"1"	"id_translation"	\N
"ps_ultimatedatabaseoptimizer_backups"	"PRIMARY"	"0"	"1"	"id_ultimatedatabaseoptimizer_backups"	\N
"ps_ultimatedatabaseoptimizer_logs"	"PRIMARY"	"0"	"1"	"id_ultimatedatabaseoptimizer_logs"	\N
"ps_url_video"	"PRIMARY"	"0"	"1"	"id_video"	\N
"ps_velsof_abd_cart"	"id_cart"	"0"	"1"	"id_cart"	\N
"ps_velsof_abd_cart"	"id_cart_2"	"1"	"1"	"id_cart"	\N
"ps_velsof_abd_cart"	"id_cart_2"	"1"	"2"	"id_customer"	\N
"ps_velsof_abd_cart"	"PRIMARY"	"0"	"1"	"id_abandon"	\N
"ps_warehouse"	"PRIMARY"	"0"	"1"	"id_warehouse"	\N
"ps_warehouse_carrier"	"id_carrier"	"1"	"1"	"id_carrier"	\N
"ps_warehouse_carrier"	"id_warehouse"	"1"	"1"	"id_warehouse"	\N
"ps_warehouse_carrier"	"PRIMARY"	"0"	"1"	"id_warehouse"	\N
"ps_warehouse_carrier"	"PRIMARY"	"0"	"2"	"id_carrier"	\N
"ps_warehouse_product_location"	"id_product"	"0"	"1"	"id_product"	\N
"ps_warehouse_product_location"	"id_product"	"0"	"2"	"id_product_attribute"	\N
"ps_warehouse_product_location"	"id_product"	"0"	"3"	"id_warehouse"	\N
"ps_warehouse_product_location"	"PRIMARY"	"0"	"1"	"id_warehouse_product_location"	\N
"ps_warehouse_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_warehouse_shop"	"id_warehouse"	"1"	"1"	"id_warehouse"	\N
"ps_warehouse_shop"	"PRIMARY"	"0"	"1"	"id_warehouse"	\N
"ps_warehouse_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_webservice_account"	"key"	"1"	"1"	"key"	\N
"ps_webservice_account"	"PRIMARY"	"0"	"1"	"id_webservice_account"	\N
"ps_webservice_account_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_webservice_account_shop"	"PRIMARY"	"0"	"1"	"id_webservice_account"	\N
"ps_webservice_account_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_webservice_permission"	"id_webservice_account"	"1"	"1"	"id_webservice_account"	\N
"ps_webservice_permission"	"method"	"1"	"1"	"method"	\N
"ps_webservice_permission"	"PRIMARY"	"0"	"1"	"id_webservice_permission"	\N
"ps_webservice_permission"	"resource"	"1"	"1"	"resource"	\N
"ps_webservice_permission"	"resource_2"	"0"	"1"	"resource"	\N
"ps_webservice_permission"	"resource_2"	"0"	"2"	"method"	\N
"ps_webservice_permission"	"resource_2"	"0"	"3"	"id_webservice_account"	\N
"ps_web_browser"	"PRIMARY"	"0"	"1"	"id_web_browser"	\N
"ps_wishlist"	"PRIMARY"	"0"	"1"	"id_wishlist"	\N
"ps_wishlist_product"	"PRIMARY"	"0"	"1"	"id_wishlist_product"	\N
"ps_wk_amp_menu"	"PRIMARY"	"0"	"1"	"id_wk_amp_menu"	\N
"ps_wk_amp_menu_lang"	"PRIMARY"	"0"	"1"	"id_wk_amp_menu"	\N
"ps_wk_amp_menu_lang"	"PRIMARY"	"0"	"2"	"id_lang"	\N
"ps_wk_amp_menu_lang"	"PRIMARY"	"0"	"3"	"id_shop"	\N
"ps_wk_amp_menu_shop"	"PRIMARY"	"0"	"1"	"id_wk_amp_menu"	\N
"ps_wk_amp_menu_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
"ps_zone"	"PRIMARY"	"0"	"1"	"id_zone"	\N
"ps_zone_shop"	"id_shop"	"1"	"1"	"id_shop"	\N
"ps_zone_shop"	"PRIMARY"	"0"	"1"	"id_zone"	\N
"ps_zone_shop"	"PRIMARY"	"0"	"2"	"id_shop"	\N
