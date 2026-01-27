# Grabbing‑Sensorex Module

This module adds end‑to‑end product/category “grabbing” (extraction → mapping → transfer to PrestaShop) to the LiveChat‑App. It ships an isolated backend (HTTP API) and a React‑based frontend. The module is namespaced under `/api/grabbing-sensorex/*` and auto‑loaded by the server’s module loader.

## Overview

- Frontend pages
  - Step 1 – Explore: domain tools, discovered URLs, quick run helpers
  - Step 2 – Extraction: configure extraction tools and run quick tests
  - Step 3 – Mapping & Settings: manage mapping tools (versions), global flags/prefix, table settings, schema helpers
  - Step 4 – Tests & Runs: test URLs and view recent extraction runs with transfer helpers
- Backend
  - Modular route files by concern (domains, urls, extraction, mapping, settings, transfer, logs, MySQL profiles)
  - JSON parser mounted only for methods that carry a body to avoid blocking GETs
  - Single shared log file: `backend/chat.log` (module writes structured one‑liners via `chatLog` helper)

## Directory Layout

```
modules/grabbing-sensorex/
  backend/
    index.js                     # Module entry (registers route groups)
    hooks.js                     # Lifecycle hooks (no-op logging)
    routes/                      # HTTP route groups (one file per concern)
    services/                    # Transfer service (orchestrator) + writers/pipelines
    utils/                       # Ensure helpers (DDL guards), image utilities
  frontend/
    pages/                       # Top-level pages (Explore, Config, Mapping, Main, etc.)
    components/                  # Reusable UI panels and editors
    hooks/                       # Module state management (useGJState)
  config.json, module.config.json
```

## Data Model (PostgreSQL)

This module reads/writes the following tables. DDL is guarded at runtime by `utils/ensure.js`; no SQL migrations run for this module.

- Domains and URLs
  - `public.mod_grabbing_sensorex_domains`
  - `public.mod_grabbing_sensorex_domains_url`
- Extraction
  - `public.mod_grabbing_sensorex_extraction_tools`
  - `public.mod_grabbing_sensorex_extraction_runs`
- Mapping (authoritative configuration)
  - `public.mod_grabbing_sensorex_maping_tools` (versioned)
  - `public.mod_grabbing_sensorex_table_settings` (per‑table settings/mapping cache)
- Transfer audit logs
  - `public.mod_grabbing_sensorex_send_to_presta_error_logs`
  - `public.mod_grabbing_sensorex_send_to_presta_success_logs`
  - `public.mod_grabbing_sensorex_upsert_field_logs`
- Optional
  - `public.mod_grabbing_sensorex_image_map` (content hash mapping for images)

Notes
- org‑scope columns (e.g., `org_key`) and indexes are ensured when present, to keep the module portable across deployments.
- The module avoids long‑running DDL during hot paths; heavy ensures are executed once at startup.

## Backend API (selected)

Health
- GET `/api/grabbing-sensorex/__ping` → `{ ok: true, module: "grabbing-sensorex" }`

Domains & URLs
- GET `/api/grabbing-sensorex/domains?limit=200&full=1&q=`
- GET `/api/grabbing-sensorex/domains/list-lite`
- GET `/api/grabbing-sensorex/domains/:domain/transfert`
- POST `/api/grabbing-sensorex/domains/:domain/transfert` (save mapping JSON without version bump)
- GET `/api/grabbing-sensorex/domains/urls?domain=&limit=&offset=&q=&page_type=&include=&include_runs=&not_in_runs=`
- POST `/api/grabbing-sensorex/domains/urls` (add a discovered URL)
- DELETE `/api/grabbing-sensorex/domains/urls` (delete URLs by id list)
- POST `/api/grabbing-sensorex/domains/urls/reclassify` (bulk set `page_type`)
- POST `/api/grabbing-sensorex/sitemap/seed` (seed discovered URLs from a sitemap index)

Extraction
- GET `/api/grabbing-sensorex/extraction/tools?domain=&page_type=&limit=`
- GET `/api/grabbing-sensorex/extraction/history?domain=&limit=&offset=&include=full`

Mapping & Settings
- GET `/api/grabbing-sensorex/mapping/tools?domain=&page_type=&limit=&offset=`
- GET `/api/grabbing-sensorex/mapping/tools/versions-lite?domain=&page_type=`
- GET `/api/grabbing-sensorex/mapping/tools/get?domain=&page_type=&version=latest|<n>`
- GET `/api/grabbing-sensorex/mapping/tools/last?domain=&page_type=`
- GET `/api/grabbing-sensorex/settings/global?domain=&page_type=` (latest flags/prefix/shops/langs/profile)
- POST endpoints under `/api/grabbing-sensorex/settings/*` update flags/prefix/shops/langs and persist to `maping_tools`

Transfer (Presta)
- POST `/api/grabbing-sensorex/transfer/prestashop` (send run to Presta; orchestrator)
- POST `/api/grabbing-sensorex/transfer/product` (force `page_type=product` and delegate to orchestrator)
- POST `/api/grabbing-sensorex/transfer/category` (force `page_type=article` and delegate)
- GET `/api/grabbing-sensorex/transfer/prestashop/schema?domain=&profile_id=&prefix=&tables=product,product_shop,...`
- GET `/api/grabbing-sensorex/transfer/prestashop/langs?domain=&profile_id=&prefix=`
- POST `/api/grabbing-sensorex/transfer/prestashop/preview-tables` (dry‑run upsert shape for a run)

Logs (summaries)
- GET `/api/grabbing-sensorex/upsert-summary?run_id=&table=` → per‑field upserts (audit trail)
- GET `/api/grabbing-sensorex/success-summary?run_id=` → aggregated OK counters by table/op/shop/lang

MySQL
- GET `/api/grabbing-sensorex/mysql/profiles?limit=200` → id,name,host,port,database,ssl,is_default

### Curl examples

List domains (lite)
```sh
curl -sS 'http://127.0.0.1:3010/api/grabbing-sensorex/domains?limit=10'
```

List mapping versions (lite)
```sh
curl -sS 'http://127.0.0.1:3010/api/grabbing-sensorex/mapping/tools/versions-lite?domain=example.com&page_type=product'
```

Get Presta schema (selected tables)
```sh
curl -sS 'http://127.0.0.1:3010/api/grabbing-sensorex/transfer/prestashop/schema?domain=example.com&profile_id=1&prefix=ps_&tables=product,product_lang,stock_available'
```

Send a run to Presta (orchestrator)
```sh
curl -sS -X POST 'http://127.0.0.1:3010/api/grabbing-sensorex/transfer/prestashop' \
  -H 'Content-Type: application/json' \
  -d '{
    "run_id": 123,
    "write": true,
    "mapping": { "prefix": "ps_" }
  }'
```

Upsert/Summary
```sh
curl -sS 'http://127.0.0.1:3010/api/grabbing-sensorex/upsert-summary?run_id=123&table=ps_product_lang'
```

## Transfer Orchestrator (how it works)

1) Resolve context
- Load the extraction run by `run_id`, normalize `domain` and page type
- Determine MySQL profile (explicit `profile_id` or from latest mapping tools row for the domain/type)
- Establish MySQL connection (mysql2/promise), derive helpers `q`, `qi`, `hasTable`, `hasColumn`

2) Resolve configuration
- Prefix: from mapping JSON (`mapping.prefix`) or default `ps_`
- Load mapping.tools (latest for domain/page_type) → merge flags/prefix/shops/langs and per‑table settings
- Compute `TSET_*` (per‑table settings) and `MFIELDS` (per‑table mapped fields)
- Flags used by the pipeline:
  - `unified_dynamic` (mapping drives all tables)
  - `strict_mapping_only` (write only mapped fields)
  - `force_min_combination` (force a minimal combination for variants)
  - `id_shops`, `id_langs` (fan‑out targets)

3) Execute writers
- Generic writer: writes mapped fields into allowed tables in a deterministic order
- Attributes writer: creates variant groups/attributes/combinations and links product_attribute rows
- Features writer: creates/links features as needed
- Images pipeline: downloads images (staging), produces variants, writes `ps_image*` and moves files to Presta image folders
- Documents pipeline: downloads attachments and links them via `ps_attachment*` and `ps_product_attachment`
- Per‑field upserts are logged to `mod_grabbing_sensorex_upsert_field_logs`. Aggregated successes go to `*_success_logs`.

4) Result
- Returns `{ ok, product_id, updated, details }` with summary of executed steps and context (shops/langs/mapping version/prefix)

## Frontend Flow

- Domain selector (top): establishes the working `domain` and `page_type`
- Explore: sitemap seeding, lightweight domains/urls lists, URL reclassify and queue tools
- Extraction: configure and test extraction; recent runs table with helper actions
- Mapping & Settings: manage mapping versions, edit global flags/prefix/shops/langs, edit per‑table schema/mapping
- Tests & Runs: quick test panel (URL → run), recent runs table with resend/update helpers, upsert summary panel

## Logging

- All diagnostics write to `backend/chat.log` as single‑line JSON (prefixed with `[grabbing-sensorex]`)
- Sensitive values (passwords/tokens) are redacted before write

## Configuration & Environment

- Body parser: mounted on `/api/grabbing-sensorex` only for POST/PUT/PATCH/DELETE
- Limits
  - `API_JSON_LIMIT` (default `50mb`)
  - MySQL connect timeout: `MYSQL_CONNECT_TIMEOUT_MS` (default 15000)
- Optional environment
  - `PRESTA_ROOT` (image/doc root discovery helpers)
  - `GS_DISABLE_BACKFILL`, `GS_DISABLE_URLS`, `GS_DISABLE_EXTRACTION_WRITES` (coarse toggles)

## Security & Org Support

- `org_key` columns and indexes are ensured when present; requests may pass `X-Org-Id`/`org_id` where implemented (e.g., MySQL profiles list)
- No admin/compat endpoints are exposed in this module (intentionally removed for a lean surface)

## Health & Diagnostics

- Health: `GET /api/grabbing-sensorex/__ping` returns `{ ok: true }`
- Route listings and admin diagnostics have been removed as part of module cleanup

## Notes on Removed/Legacy Endpoints

Removed for clarity and reduced surface:
- Admin routes (`/api/grabbing-sensorex/admin/*`)
- Compatibility routes (legacy aliases)
- Images verify route (`/transfer/prestashop/images/verify`)
- Validate mapping route (`/transfer/prestashop/validate-mapping`)

## Development

- The module is auto‑registered by the server. No extra wiring in `backend/server.js`.
- Migrations are disabled for this module; schema changes are applied by idempotent ensure helpers at runtime.
- Logs go to `backend/chat.log`. Keep the file writable by the server process.

## Troubleshooting

- Health
  ```sh
  curl -sS --max-time 5 http://127.0.0.1:3010/api/grabbing-sensorex/__ping
  ```
- MySQL profiles (lightweight)
  ```sh
  curl -sS 'http://127.0.0.1:3010/api/grabbing-sensorex/mysql/profiles?limit=10'
  ```
- Mapping versions (lite)
  ```sh
  curl -sS 'http://127.0.0.1:3010/api/grabbing-sensorex/mapping/tools/versions-lite?domain=example.com&page_type=product'
  ```

---

For questions or to extend the module (new writers, extra routes), follow the established route/service split: keep routes thin, put business logic under `backend/services`, and use `utils/ensure.js` for portable DDL guards.

