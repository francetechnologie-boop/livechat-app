# Company Chat Module

Purpose
- Conversational access to company data with tools or MCP integrations.

Directory Layout
- frontend/: React pages and components.
- backend/: Add routes/services for tool backends if required.
- db/migrations/: SQL migrations for any schema changes.

Frontend Access
- Default route: `#/company-chat` (top-level tab).

Configuration & JSON
- Org‑scoped JSON in DB. Valid JSON only.

Migrations
- Timestamped SQL with up/down sections under `db/migrations/`.

Deployment
- `sync+deploy.sh` from project root. See `AGENTS.md` for conventions.
This module follows the LiveChat-App module independence rules.

- Canonical rules: see `AGENTS.md` and `modules/MODULE_CHECKLIST.md`.
- API namespace: `/api/company-chat/*`.
