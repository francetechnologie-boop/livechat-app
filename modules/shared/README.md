# Shared Module Library

Purpose
- Reusable UI components (Sidebar, icons) and small utilities shared across modules.

Directory Layout
- frontend/: Components and utilities imported via alias (e.g., `@shared-modules`).
- backend/: Not used here.

Usage
- Import components in module frontends, avoid app‑specific coupling.

Conventions
- Follow `AGENTS.md` for code style, JSON samples, and safety.
This module follows the LiveChat-App module independence rules.

- Canonical rules: see `AGENTS.md` and `modules/MODULE_CHECKLIST.md`.
- API namespace (when exposing endpoints): `/api/shared/*`.
