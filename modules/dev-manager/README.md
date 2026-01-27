# Module: dev-manager

## Purpose
Dev Manager is a fully independent module for LiveChat-App that includes its own frontend and backend, namespaced API routes, and database migrations.

## Features
- Namespaced API: `/api/dev-manager/*` (no route collisions).
- Backend scaffolding: models, routes, services, utils.
- Frontend scaffolding: components, pages, utils with a clean entry index.
- Installer auto-registers hooks and runs migrations.

## Install

Run the installer from the project root:

```bash
node livechat-app/modules/dev-manager/backend/installer.js
```

This will:
1. Ensure system tables exist.
2. Upsert the module into `modules` (install=1, active from config).
3. Register hooks from `module.config.json` into `hooks`/`hook_module`.
4. Apply pending SQL migrations under `db/migrations/` and log them.

Note: Kanban migrations are schema-only. The legacy JSON backfill has been removed to avoid accidental re-imports on replays.

## Frontend Entry
Import via Vite aliases or relative paths:

```ts
import { Main as DevManagerMain, Settings as DevManagerSettings } from "@modules/dev-manager/frontend";
```

`pages/ExamplePage.tsx` renders a small UI and loads data from `/api/dev-manager/examples`.

## Backend Routes
See `backend/routes/example.routes.ts` which exports `registerDevManagerRoutes(app)` and serves `/api/dev-manager/examples`.

## File Layout

```
modules/dev-manager/
├── backend/
│   ├── hooks.ts
│   ├── installer.ts
│   ├── installer.js
│   ├── models/
│   │   └── example.model.ts
│   ├── routes/
│   │   └── example.routes.ts
│   ├── services/
│   │   └── example.service.ts
│   └── utils/
│       └── example.util.ts
│
├── db/
│   └── migrations/
│       └── 20251019_create_example_table.sql
│
├── frontend/
│   ├── components/
│   │   └── ExampleComponent.tsx
│   ├── pages/
│   │   ├── ExamplePage.tsx
│   │   └── Settings.jsx
│   └── utils/
│       └── example.utils.ts
│
├── module.config.json
└── README.md
```

## Notes
- The module is self-contained and avoids cross-imports outside `modules/` (except for shared types under `modules/types`).
- Ensure the backend integrates route registration for `registerDevManagerRoutes(app)` where modules are loaded.

## Module Independence Checklist

Cross-check before merging changes (see `modules/MODULE_CHECKLIST.md`):

- Backend entry: `modules/dev-manager/backend/index.js` exporting `register(app, ctx)`.
- All HTTP routes under `/api/dev-manager/*` and auto-mounted by the loader.
- Frontend entry exports in `modules/dev-manager/frontend/index.(ts|tsx|js)`.
- Timestamped SQL migrations in `modules/dev-manager/db/migrations/`.
- `module.config.json` present with `enabled` and `hooks`.
