Module Conventions — Grabbing‑Jerome

Purpose
- Keep the module strictly modular: all HTTP routes under `backend/routes/`, business logic under `backend/services/`, helpers under `backend/utils/`. The module entry (`backend/index.js`) only wires ensures, JSON parser for the namespace, and registers route groups.

Hard Rules (enforced in reviews)
- Do NOT register HTTP endpoints in `backend/index.js`.
  - Disallowed: any `app.get/post/put/delete('/api/grabbing-jerome/*', ...)` in `backend/index.js`.
  - Allowed: calling `register*Routes(app, ctx, utils)` from `backend/routes/*.routes.js`.
- Each route group lives in its own file: `backend/routes/<group>.routes.js` and exports a `register*Routes(app, ctx, utils)` function.
- JSON parser must be mounted only inside the module namespace and only for methods that carry a body:
  - `app.use('/api/grabbing-jerome', (req,res,next)=> wantsBody ? ctx.expressJson({limit: process.env.API_JSON_LIMIT || '50mb', strict:false})(req,res,next) : next())`
- Services implement business logic: `backend/services/**`. Route files should be thin adapters that delegate to services.
- Utilities belong in `backend/utils/**` and must not perform IO side‑effects on import.
- Namespacing: Every endpoint path starts with `/api/grabbing-jerome/*`.

Index Entrypoint (backend/index.js)
- Allowed:
  - Ensure/migration helpers wiring (e.g., `makeEnsureHelpers(pool)`).
  - Module JSON parser guard for the `/api/grabbing-jerome` prefix.
  - Route registration only:
    - `registerGrabbingJeromeDomainsRoutes(app, ctx, utils)`
    - `registerGrabbingJeromeTableSettingsRoutes(app, ctx, utils)`
    - `registerGrabbingJeromeTransferRoutes(app, ctx, utils)`
    - `registerGrabbingJeromeExtractionRoutes(app, ctx, utils)`
    - `registerGrabbingJeromeUrlsRoutes(app, ctx, utils)`
    - `registerGrabbingJeromeHealthRoutes(app, ctx)`
- Disallowed:
  - Defining `app.get/post/...('/api/grabbing-jerome/*', ...)` directly in `index.js`.
  - Implementing business logic in `index.js`.

Services Layout
- `backend/services/transfer.service.js` orchestrates Send‑to‑Presta and delegates to split services:
  - `backend/services/transfer/mysql.js` (connection + helpers)
  - `backend/services/transfer/mapping.js` (profile/prefix/settings)
  - `backend/services/transfer/images.pipeline.js` (images DB + files)
  - `backend/services/transfer/attributes.js` (combinations/variants)
  - `backend/services/transfer/features.js` (features + values)
  - `backend/services/transfer/generic-writer.js` (extra tables from mapping)

Route Health
- Add fast health route in `backend/routes/health.routes.js`:
  - `GET /api/grabbing-jerome/__ping` → `{ ok: true }`.
  - Admin route dump: `GET /api/grabbing-jerome/__routes` lists mounted module routes.

Validation (quick checks)
- No inline routes in `index.js`:
  - `grep -n "app\.(get\|post\|put\|delete)('/api/grabbing-jerome" backend/index.js` → should return 0.
- Routes present:
  - `curl -s http://127.0.0.1:3010/api/grabbing-jerome/__routes | jq .items`
- JSON parser not stalling GETs: only applied for `POST|PUT|PATCH` under the module prefix.

Examples
- Route file:
```js
// backend/routes/example.routes.js
export function registerGrabbingJeromeExampleRoutes(app, ctx = {}, utils = {}) {
  const { pool } = utils;
  app.get('/api/grabbing-jerome/examples', async (_req, res) => {
    if (!pool) return res.status(503).json({ ok:false, error:'db_unavailable' });
    return res.json({ ok:true, items: [] });
  });
}
```
- Service delegation from route:
```js
import { sendToPresta } from '../services/transfer.service.js';
export function registerGrabbingJeromeTransferRoutes(app, ctx = {}, utils = {}) {
  app.post('/api/grabbing-jerome/transfer/prestashop', (req, res) => sendToPresta(req, res, ctx, utils));
}
```

Review Gate
- PRs touching `backend/index.js` must not add any `app.*('/api/grabbing-jerome/*'...)` definitions.
- PRs should place new endpoints under `backend/routes/*.routes.js` and logic under `backend/services/**`.

