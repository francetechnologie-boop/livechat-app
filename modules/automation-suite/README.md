# Automation Suite Module

Purpose
- Configure workflows, canned responses, and chatbots for automation.

Directory Layout
- frontend/: Module UI (builder, settings, etc.).
- backend/: Services and HTTP routes.
- db/migrations/: SQL migrations with timestamped filenames.

Frontend Access
- Default route: `#/automations` (top-level tab).

Backend/API
- Mount routes via a module hook in `backend/hooks.(js|ts)` and declare in `module.config.json`.

Configuration & JSON
- Org‑scoped JSON config in DB. No comments, escape backslashes, no trailing commas.
```json
{
  "org_id": "acme",
  "automations": [{ "id": "welcome", "pattern": "^hi$" }]
}
```

Database Migrations
- Use `migrations/` with `up` and `down` sections per AGENTS.md.

Development & Deployment
- `sync+deploy.sh` to deploy and run migrations.
- See root `AGENTS.md` for conventions.
This module follows the LiveChat-App module independence rules.

- Canonical rules: see `AGENTS.md` and `modules/MODULE_CHECKLIST.md`.
- API namespace: `/api/automation-suite/*`.
