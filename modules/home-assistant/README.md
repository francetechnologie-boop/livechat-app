# Home Assistant Module

Purpose
- Browse entities and call services from a Home Assistant instance.

Directory Layout
- frontend/: UI for entities/services.
- backend/: Connector endpoints if used.
- db/migrations/: SQL migrations for any persisted config.

Frontend Access
- Default route: `#/home-assistant` (also accessible via the Tools tab if desired).

Configuration & JSON
- Keep secrets out of logs. Store org‑scoped JSON config in DB.

Migrations
- Timestamped SQL files with up/down sections.

Deployment
- Use `sync+deploy.sh`. See `AGENTS.md` for safety and org support.
This module follows the LiveChat-App module independence rules.

- Canonical rules: see `AGENTS.md` and `modules/MODULE_CHECKLIST.md`.
- API namespace: `/api/home-assistant/*`.
