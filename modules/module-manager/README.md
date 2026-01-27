# Module Manager

Purpose
- Discover, install, activate/deactivate modules and manage sidebar entries.

Directory Layout
- frontend/: Module Manager UI (module list, actions, menu builder).
- backend/: REST API under `/api/modules/*` and sidebar management endpoints.
- db/migrations/: Sidebar/table migrations (e.g., `sidebar_entries`).

Frontend Access
- Route: `#/modules` shows the manager; deep links: `#/modules/<id>` or `#/modules/<id>/settings`.

Configuration & JSON
- Persists state in settings and the `modules` table. All configuration is valid JSON, org‑scoped where applicable.

Migrations
- Use timestamped SQL with up/down sections in `db/migrations/`.

Deployment
- `sync+deploy.sh` to apply migrations and redeploy.
- Follow `AGENTS.md` for org support, JSON rules, and safety.
## Module Independence Checklist

Module Manager should also follow the independence pattern (`modules/MODULE_CHECKLIST.md`):

- Backend entry: `modules/module-manager/backend/index.js` exporting `register(app, ctx)`.
- Namespaced API: `/api/module-manager/*`.
- Frontend entry: `modules/module-manager/frontend/index.(ts|tsx|js)`.
- Migrations under `modules/module-manager/db/migrations/`.
- `module.config.json` with `enabled` and `hooks`.

