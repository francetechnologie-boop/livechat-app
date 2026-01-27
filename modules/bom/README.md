# BOM Module

Purpose: Manage Suppliers, Items, and Bills of Materials (BOMs).

Backend
- Prefix: `/api/bom/*`
- Health: `GET /api/bom/__ping` → `{ ok: true }`
- Suppliers:
  - `GET /api/bom/suppliers?q=&limit=&offset=`
  - `POST /api/bom/suppliers { name, contact?, meta?, org_id? }`
  - `PUT /api/bom/suppliers/:id { name?, contact?, meta?, org_id? }`
  - `DELETE /api/bom/suppliers/:id`
  - Contacts:
    - `GET /api/bom/suppliers/:id/contacts`
    - `POST /api/bom/suppliers/:id/contacts { name?, email?, phone?, role?, is_primary?, meta?, org_id? }`
    - `PUT /api/bom/suppliers/:id/contacts/:cid { name?, email?, phone?, role?, is_primary?, meta?, org_id? }`
    - `DELETE /api/bom/suppliers/:id/contacts/:cid`
  - Import:
    - `POST /api/bom/suppliers/import { mode: 'tsv'|'csv'|'json', text?: string, rows?: object[], org_id? }`
- Items:
  - `GET /api/bom/items?q=&limit=&offset=`
  - `POST /api/bom/items { sku, name, uom?, supplier_id?, attributes?, org_id? }`
  - `PUT /api/bom/items/:id { ...fields }`
  - `DELETE /api/bom/items/:id`
  - Picture serving (optional files on disk):
    - Put item images under `modules/bom/ITEM_Images/`.
    - Recognized names (by item `code` or `sku`):
      - `ITEM_Images/<code>.jpg|jpeg|png|gif`
      - `ITEM_Images/<code>.Picture.*.jpg|jpeg|png|gif`
      - or any `<code>*.(jpg|jpeg|png|gif)`
    - Backend endpoint streams the image: `GET /api/bom/items/:id/picture`.
  - Vendors (many-to-many per item):
    - `GET /api/bom/items/:id/vendors`
    - `POST /api/bom/items/:id/vendors { supplier_id? | supplier_name?, supplier_item_code?, price?, currency?, moq?, lead_time_days?, preferred?, priority?, notes?, org_id? }` (upsert)
    - `PUT /api/bom/items/:id/vendors/:supplierId { supplier_item_code?, price?, currency?, moq?, lead_time_days?, preferred?, priority?, notes?, org_id? }`
    - `DELETE /api/bom/items/:id/vendors/:supplierId`
    - Import links: `POST /api/bom/items/vendors/import` with TSV/CSV/JSON including `item_code` + `VENDORS` + optional fields above.
      - Creates missing items automatically by default; pass `{"create_items": false}` to keep legacy behavior.
  - Vendor import (staging + processing):
    - `POST /api/bom/import/vendors/preview { mode:'csv'|'tsv'|..., text, vendor?, delimiter?, decimalComma?, map? }`
      - Parses and normalizes rows without writing to DB.
      - `map` example:
        ```json
        {
          "item_code": "SKU",
          "supplier_item_code": "Vendor Sku",
          "supplier_name": "VENDOR",
          "price": "PU",
          "currency": "Curr.",
          "moq": "MOQ",
          "lead_time_days": "Lead days",
          "effective_at": "date_new_price"
        }
        ```
    - `POST /api/bom/import/vendors/stage { text|rows, vendor?, source?, org_id?, mode?, delimiter?, decimalComma?, map? }`
      - Stores rows in `mod_bom_import_data_vendors` (dedup by SHA-256 per org/vendor/row).
    - `GET /api/bom/import/vendors?status=pending&vendor=&limit=&offset=` — list staged rows.
    - `POST /api/bom/import/vendors/process { vendor?, org_id?, limit?, dry_run?, create_items? }`
      - Upserts suppliers, links vendors, and records prices from staged rows.
      - When `create_items` is true (default), new items are inserted into `mod_bom_items` before linking vendors.
- Extraction:
  - `POST /api/bom/extract/items { mode: 'csv'|'json', text?, items? }` → parses to a list of items (no DB writes)
- BOMs:
  - `GET /api/bom/boms?q=&limit=&offset=`
  - `POST /api/bom/boms { name, description?, org_id? }`
  - `PUT /api/bom/boms/:id { name?, description?, org_id? }`
  - `DELETE /api/bom/boms/:id`
  - `GET /api/bom/boms/:id/items`
  - `POST /api/bom/boms/:id/items { item_id, quantity, position?, org_id? }`
  - `PUT /api/bom/boms/:id/items/:itemId { quantity?, position?, org_id? }`
  - `DELETE /api/bom/boms/:id/items/:itemId`
  - Explode (multi-level):
    - `GET /api/bom/boms/:id/explode?depth=2&aggregate=1` — returns lines (with lvl, qty, ext_qty) and aggregate (summed ext_qty per SKU). Sub-assemblies are resolved when a BOM exists whose `name` equals the component SKU.

## Presta Integration (Product Margin)

- Endpoints (uses a MySQL profile from `mod_db_mysql_profiles`):
  - `GET /api/bom/presta/__ping` → `{ ok: true }`
  - `GET /api/bom/presta/profiles` → list available MySQL profiles (org‑scoped)
  - `GET /api/bom/presta/profile` → `{ ok:true, profile_id }` (org-scoped)
  - `POST /api/bom/presta/profile { profile_id }` → persists selection per org
  - `GET /api/bom/presta/margins?profile_id=&q=&limit=100` → lists products and joins BOM cost by `BOM_name`.
    - Price source: per-product default shop (`ps_product.id_shop_default`), price = `ps_product_shop.price` + `ps_product_attribute_shop.price` (impact) for that shop. If missing, fallback to global `PS_SHOP_DEFAULT` or first active shop.
    - Output fields: `id_product, id_product_attribute, shop_default, shop_name, name, reference, supplier_reference, bom_name, final_price, active, bom_cost_total, margin`.

- Frontend panel: Product Margin — select profile id, search, and list products with computed BOM costs.

### BOM Associator

- Endpoints (use the same MySQL profile mechanism):
  - `GET /api/bom/presta/shops?profile_id=` → list `ps_shop`
  - `GET /api/bom/presta/langs?profile_id=&id_shop=` → list `ps_lang` (marks `in_shop` when filtering by shop)
  - `GET /api/bom/presta/associator/search?profile_id=&id_shop=&id_lang=&id_product=&reference=&supplier_reference=&limit=200`
    - Returns products for the selected shop/lang and tries to match a BOM when `mod_bom_boms.name` is contained in the product `name` (case‑insensitive).
    - Output fields: `id_product, name, reference, supplier_reference, matched_bom_name, matched_bom_id`.

- Frontend panel: BOM Associator — choose profile, shop and language, apply optional filters (id_product, reference, supplier reference), and list matched BOMs by product name.

Database
- Tables (module-owned):
  - `mod_bom_suppliers` (org_id, name, contact, meta)
  - `mod_bom_supplier_contacts` (org_id, supplier_id, name, email, phone, role, is_primary, meta)
  - `mod_bom_items` (org_id, supplier_id, sku, name, uom, attributes, code, reference, description, description_short, picture, unit, procurement_type)
  - `mod_bom_boms` (org_id, name, description)
  - `mod_bom_bom_items` (org_id, bom_id, item_id, quantity, position)
  - `mod_bom_item_vendors` (org_id, item_id, supplier_id, supplier_item_code, price, currency, moq, lead_time_days, preferred, priority, notes)
  - `mod_bom_item_vendor_prices` (org_id, item_id, supplier_id?, price, currency?, effective_at, source?, notes?, created_at, updated_at)
- Migrations are idempotent and include guarded FKs to `organizations(id)` with `ON DELETE SET NULL`.

Frontend
- Export: `modules/bom/frontend/index.js` → `Main` (BomPage)
- Sections (panels): Suppliers, Extract Items Data, Items, Bill of Material
  - Prices (history per item/vendor):
    - `GET /api/bom/items/:id/prices` (optional `supplier_id`)
    - `POST /api/bom/items/:id/prices { price, effective_at, supplier_id?, currency?, source?, notes?, org_id? }`
    - Import: `POST /api/bom/items/prices/import` (TSV/CSV/JSON with `item_code`, `price`, `date_new_price`, optional `vendor`, `currency`) — assigns the first vendor for the item when vendor is omitted.
