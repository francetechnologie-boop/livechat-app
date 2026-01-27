# Grabbing Jerome – Domain Selector and Presta Validation (Step 3)

This module provides domain discovery, extraction tooling, and PrestaShop transfer. This page documents two recurring operational points:

- Keeping the Domain Selector responsive and healthy
- Verifying Presta IDs with the Step 3 validation endpoint before upserting

## Domain Selector – Health Checklist

- Routes are defined inside the backend entry `backend/index.js` in `register(app, ctx)`. Avoid top‑level `app.get(...)` definitions.
- Add fast health routes before any parser:
  - `GET /api/grabbing-jerome/__ping` → `{ "ok": true, "module": "grabbing-jerome" }`
  - `GET /api/grabbing-jerome/ping` → same
- Mount JSON parser only for body methods to avoid stalling GETs:
  - `app.use('/api/grabbing-jerome', (req, res, next) => (['POST','PUT','PATCH'].includes(req.method) ? ctx.expressJson({ limit: process.env.API_JSON_LIMIT || '50mb', strict: false })(req,res,next) : next()));`
- Domain endpoints:
  - `GET /api/grabbing-jerome/domains?limit=200` → list from `public.mod_grabbing_jerome_domains`
  - `POST /api/grabbing-jerome/domains { domain, sitemap_url? }` → upsert
  - `DELETE /api/grabbing-jerome/domains/:domain` → delete

### Quick tests

```sh
curl -sS --max-time 5 http://127.0.0.1:3010/api/grabbing-jerome/__ping
curl -sS --max-time 5 'http://127.0.0.1:3010/api/grabbing-jerome/domains?limit=5'
```

If a GET hangs:
- Ensure the guarded JSON parser is used (only POST/PUT/PATCH are parsed).
- Confirm the module is mounted. If needed, reload modules or restart the process:

```sh
curl -sS --max-time 5 http://127.0.0.1:3010/api/module-manager/modules
# optional: reload (requires admin token if configured)
# curl -sS -X POST http://127.0.0.1:3010/api/module-manager/reload -H 'X-Admin-Token: <token>'
```

## Step 3 – Validate Presta IDs

Before writing to Presta tables, validate that referenced IDs exist in your Presta DB:

Endpoint:
`POST /api/grabbing-jerome/transfer/prestashop/validate-mapping`

Request example:

```json
{
  "domain": "animo-concept.com",
  "page_type": "product",
  "profile_id": 1,
  "mapping": {
    "prefix": "ps_",
    "id_shops": [3,5,6,7,8,9,10],
    "id_shop_default": 3,
    "id_supplier": 0,
    "id_manufacturer": 1,
    "id_category_default": 273,
    "id_tax_rules_group": 26
  }
}
```

Response fields:
- `tables` → booleans for required Presta tables
- `check` → booleans/arrays indicating whether IDs exist (supplier, manufacturer, category_default, shop_default, shops[], tax_rules_group)

Fix any invalid or missing IDs before running the actual transfer.

## Image Permissions (PrestaShop)

When sending product images to PrestaShop, the module sets safe permissions and ownership on the destination folder and files:

- Folder: `755` and owned by `www-data:www-data` (Debian/Ubuntu default)
- Image files: `644` and owned by `www-data:www-data`

Notes:
- You can override ownership via environment variables: set `PRESTA_IMG_OWNER` and `PRESTA_IMG_GROUP` (for example, to `apache` on CentOS) or via the per‑table `setting_image` config (`owner`, `group`, `file_mode`, `dir_mode`, `set_perms`).
- The pipeline applies `chmod` on the folder and files, then runs `chown` on the folder and each image file. Failures are logged but do not stop the transfer.
- On Windows, `chown` is skipped automatically.

Example `setting_image` snippet:

```json
{
  "set_perms": true,
  "dir_mode": 493,
  "file_mode": 420,
  "owner": "www-data",
  "group": "www-data"
}
```

The numeric modes above correspond to `755` (493) and `644` (420).
