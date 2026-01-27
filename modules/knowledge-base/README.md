# Knowledge Base Module

Purpose
- Publish searchable help articles for the widget and agents.

Directory Layout
- frontend/: Article management UI.
- backend/: Models, routes, and services as needed.
- db/migrations/: SQL migrations (timestamped).

Frontend Access
- Default route: `#/knowledge-base` (top-level tab).

Configuration & JSON
- Org‑scoped JSON config in DB. Ensure valid JSON (no comments; escape backslashes).

Migrations
- Use up/down sections; see `AGENTS.md`.

Deployment
- `sync+deploy.sh` to deploy and migrate.
This module follows the LiveChat-App module independence rules.

- Canonical rules: see `AGENTS.md` and `modules/MODULE_CHECKLIST.md`.
- API namespace: `/api/knowledge-base/*`.
