# Types Package (Modules Types)

Purpose
- Centralize TypeScript type definitions shared by module backends/frontends.

Directory Layout
- Contains type declaration files only; no runtime.

Conventions
- Keep types small and composable. Avoid runtime coupling.
- Follow `AGENTS.md` and keep JSON examples valid when documenting.
## Module Independence Checklist

This module primarily ships shared types. If adding runtime parts, follow `modules/MODULE_CHECKLIST.md`:

- Keep backend entry minimal (`modules/types/backend/index.js`) if needed; namespace under `/api/types/*`.
- Frontend entry for type-driven helpers at `modules/types/frontend/index.(ts|tsx|js)` when applicable.
- Avoid server wiring in `backend/server.js` — use the loader.

