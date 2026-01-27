# Agents Module

Purpose
- Manage agent profile and organization preferences.
- Sidebar is no longer configurable per agent: it is globally managed by Module Manager and is identical for all users and orgs.

Directory Layout
- frontend/: React pages/components for settings.
- backend/: Add routes/services here if needed.
- db/migrations/: SQL migrations with timestamped filenames.

- Frontend Access
- Default route: `#/agents` (top-level tab in the app).
- Deep links should use hash routing only.

Backend/API
- Add HTTP routes under `backend/routes/` and mount via module hooks if applicable.

Configuration & JSON
- Store org‑scoped config in DB as JSON (no comments, no trailing commas, escape backslashes).
- The sidebar is not controlled here.

Database Migrations
- Place migrations in `db/migrations/` named like `YYYYMMDDHHmm_add_table.sql`.
- This module adopts a short table prefix `mod_a_*` (e.g., `mod_a_agents`). A migration provides
  compatibility views for legacy names `mod_agents_agents` and `agents` during transition.

Development & Deployment
- Run `sync+deploy.sh` at repo root to sync, migrate, and redeploy.
- Follow AGENTS.md for timezone, safety, and org support.
This module follows the LiveChat-App module independence rules.

- Canonical rules: see `AGENTS.md` and `modules/MODULE_CHECKLIST.md`.
- API namespace: `/api/agents/*`.
