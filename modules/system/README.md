# System Module

Purpose
- Workspace settings, environment info, and developer tools.

Directory Layout
- frontend/: Settings / Development pages.
- backend/: Add system routes/services if required.
- db/migrations/: Place any system‑related migrations here.

Frontend Access
- Default routes: `#/modules/system`, or mapped to app Settings/Development tabs.

Configuration & JSON
- Use org‑scoped JSON records per `AGENTS.md` rules.

Migrations
- Timestamped up/down SQL files under `db/migrations/`.

Deployment
- `sync+deploy.sh` to deploy and run migrations.
This module follows the LiveChat-App module independence rules.

- Canonical rules: see `AGENTS.md` and `modules/MODULE_CHECKLIST.md`.
- API namespace: `/api/system/*`.
