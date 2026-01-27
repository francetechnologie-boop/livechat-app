# Tools Module

Purpose
- Utility surface for admin/agent helpers; can host integrations.

Directory Layout
- frontend/: Tools pages/components.
- backend/: Optional tool endpoints.
- db/migrations/: SQL migrations when persisting tool state.

Frontend Access
- Default route: `#/ha` (Tools tab).

Configuration & JSON
- Org‑scoped JSON configuration; valid JSON only.

Migrations
- Timestamped up/down SQL files under `db/migrations/`.

Deployment
- Use `sync+deploy.sh`. Follow `AGENTS.md` guidance.
## Module Independence Checklist

When tools exposes runtime endpoints, follow `modules/MODULE_CHECKLIST.md`:

- Backend entry: `modules/tools/backend/index.js` with `register(app, ctx)`.
- Namespaced API: `/api/tools/*`.
- Frontend entry: `modules/tools/frontend/index.(ts|tsx|js)`.
- Migrations: `modules/tools/db/migrations/` when DB is required.
- `module.config.json` present with `enabled` and `hooks`.

## Backend API
- Entry: `backend/index.js` exports `register(app, ctx)` (mounted by loader).
- JSON parsing: mounted only for methods with a body within `/api/tools`.
- Routes live under `backend/routes/` (no inline `app.get` in index).
- Namespacing: all endpoints prefixed with `/api/tools/*`.
- Health & discovery:
  - GET `/api/tools/__ping` → `{ ok: true, module: "tools" }` (compat: `/ping`)
  - GET `/api/tools/__routes` → `{ ok: true, items: [ ...paths ] }`
- Examples:
  - GET `/api/tools/info` → `{ ok: true, module: "tools", time: "..." }`

## Migrations
- `db/migrations/20251021_create_tools_config.sql` creates `mod_tools_config` with `org_id`, `key`, `value` (JSONB).
- Store org‑scoped configuration as JSON records; no comments, no trailing commas.
