# Module Checklist — Routes & Migrations

This checklist is mandatory for any change that adds HTTP routes or modifies the database schema in a module under `modules/<id>`.

## Route Mounting (Backend)
- Ownership
  - Define all HTTP endpoints under `modules/<id>/backend/routes/*.js`.
  - Export route registrars with explicit names (e.g., `register<Id><Area>Routes(app, ctx)`), and call them from `modules/<id>/backend/index.js` inside `register(app, ctx)` (or `registerRoutes`).
- Namespacing
  - Prefix every endpoint with your module id: `/api/<id>/*`.
  - Add a fast health route: `GET /api/<id>/__ping` returning `{ ok: true }`.
- JSON body parser
  - Mount JSON parsing inside the module, not globally:
    - `app.use('/api/<id>', ctx.expressJson({ limit: process.env.API_JSON_LIMIT || '50mb', strict: false }))` for methods that carry a body.
- “Mountable” contract (what makes a route discoverable and callable)
  - Ensure your `backend/index.js` imports and calls each route file.
  - Keep ESM default/named exports consistent with what `index.js` is importing (mismatches silently skip mounting).
  - Avoid side‑effects at import time; do all `app.get/.post/...` inside `register(app, ctx)`.
- Hot‑mount without restart (dev/admin only)
  - You can mount (or re‑mount) at runtime via Module Manager API:
    - `POST /api/module-manager/mount { "id": "<id>" }`
  - Use for quick verification; for production, prefer a clean restart.
- Post‑deploy verification (must do)
  - List mounted routes for your module:
    - `curl -sS http://127.0.0.1:3010/api/module-manager/routes?id=<id> | jq`
  - Or the module’s own inspector if present:
    - `curl -sS http://127.0.0.1:3010/api/<id>/__routes_open | jq`
  - Test one GET and one POST endpoint with small payloads.
- Troubleshooting (if route isn’t visible)
  - Check pm2 logs for module load errors (missing export names, syntax errors): `pm2 logs livechat --lines 200`.
  - Confirm `backend/index.js` actually calls your new route registrar.
  - Restart: `pm2 restart livechat`, then re‑check `__routes_open`.
  - If proxies return HTML, add `-i` to curl and verify `Content-Type: application/json`.

## Database Changes (Schema)
- Use migrations for all schema changes in shared tables
  - New table, column, index, or constraint → add a migration.
  - Name: `YYYYmmddHHMM_<short_description>.sql` under either:
    - Global: `migrations/` (for server‑level tables), or
    - Module: `modules/<id>/db/migrations/` (module‑owned tables).
- Migration content
  - Provide both `up` (apply) and `down` (revert) or make it idempotent SQL with guards.
  - Guarded FKs: follow AGENTS.md template (check table/PK exists, `ON DELETE SET NULL`).
  - Idempotency: wrap `ALTER TABLE ADD COLUMN` / `CREATE INDEX` in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_* THEN NULL; END $$;`.
- When “ensures” are acceptable
  - For modules that intentionally do not run migrations in some environments, add idempotent ensure helpers under `modules/<id>/backend/utils/ensure.js` and call them in `backend/index.js` (and/or on first route access) to bridge missing columns.
  - Even then, prefer a real migration in the repo so deploys are predictable.
- Post‑deploy verification (must do)
  - Confirm new columns/tables:
    - `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='<table>';`
  - Validate endpoints that depend on the new schema return JSON with expected fields.

## Release & Ops
- After merging route or schema changes:
  - Deploy: `./deploy.sh` (runs pending migrations) and restart: `pm2 restart livechat`.
  - If you hot‑mounted routes during development, still perform a clean restart post‑deploy to avoid partial state.
- Quick health checks
  - `curl -sS --max-time 5 http://127.0.0.1:3010/health`
  - `curl -sS --max-time 5 http://127.0.0.1:3010/api/module-manager/routes | jq`

## PR Checklist (copy into your MR)
- [ ] New routes are under `modules/<id>/backend/routes/*.js` and called from `backend/index.js`.
- [ ] Namespaced under `/api/<id>/*` with a `__ping` route.
- [ ] JSON parser mounted at module scope.
- [ ] Post‑deploy curl checks added to the PR description.
- [ ] Migration added for any schema change (or ensure helper with rationale).
- [ ] Guarded FKs and idempotent DDL where applicable.

---

## Common Pitfalls & How To Avoid “Route not mounted”

- ESM/CommonJS export mismatch
  - Symptom: pm2 logs show “does not provide an export named …” and Module Manager → “Monter routes” returns mount_failed.
  - Fix: ensure route files use ESM named export matching what backend/index.js imports (e.g., `export function registerFooRoutes`). If you also need CJS support, keep `module.exports = { registerFooRoutes }` in addition to the ESM export.

- Route registrar not called from backend/index.js
  - Symptom: File exists but paths never appear in `/api/module-manager/routes`.
  - Fix: import your route file and call its registrar inside `register(app, ctx)` (or `registerRoutes`). Keep calls in try/catch but also log errors so failures are visible.

- Relying on hot-mount for new routes
  - Symptom: Works on some endpoints (compat) but new paths 404 until restart.
  - Fix: after adding/renaming exports or files, perform a clean restart (`pm2 restart livechat`). Use `/api/module-manager/mount` only for dev checks; it won’t fix export name mismatches.

- JSON parser not mounted on module prefix
  - Symptom: POSTs hit the route but `req.body` is empty behind proxies; server returns HTML or 400.
  - Fix: mount `ctx.expressJson` under your module prefix for methods with body. For critical endpoints, add a raw-body fallback reader for environments that drop headers.

- Wrong deploy root (code edited in a different tree)
  - Symptom: local changes present on disk but server returns old behavior; “Monter routes” doesn’t reflect edits.
  - Fix: verify the server uses `/root/livechat-app`. After deploy, check route list via `/api/module-manager/routes?id=<id>` and watch pm2 boots logs to confirm your file paths are loaded.

- Post-deploy verification skipped
  - Symptom: issues discovered only when UI calls endpoints.
  - Fix: always run:
    - `curl -sS http://127.0.0.1:3010/api/module-manager/routes?id=<id> | jq`
    - `curl -sS http://127.0.0.1:3010/api/<id>/__routes_open | jq`
    - Probe one GET and one POST (with small JSON).
