# Module: module-template

## Purpose
A ready-to-use boilerplate for creating new modules in the LiveChat-App ecosystem.
It includes backend scaffolding, TypeScript types, automatic hook registration, and migration management.

---

## Features
- Auto-registers in the `modules` table (install=1, active per config)
- Auto-migration execution from `db/migrations` with logging
- Hook registration via `hooks` + `hook_module`
- Type stubs for hook payloads
 - Frontend pages and components scaffold

---

## Installation

Run the installer (JavaScript version works without TypeScript tooling):

```bash
node modules/module-template/backend/installer.js
```

If your environment supports TypeScript loaders, you can also run:

```bash
node modules/module-template/backend/installer.ts
```

What happens:

1. Creates/updates the module record in `modules` (install=1, active from config)
2. Registers declared hooks into `hooks`/`hook_module`
3. Runs all pending `.sql` migrations under `db/migrations/`
4. Logs each applied migration in `migrations_log`

---

## Hooks

| Hook               | Description                          |
| ------------------ | ------------------------------------ |
| `onModuleLoaded`   | Runs when the module is initialized. |
| `onModuleDisabled` | Runs when the module is disabled.    |

---

## File Layout

```
modules/module-template/
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
├── module.config.json
└── README.md
```

---

## Notes
- The installer aligns with the existing Module Manager schema (`modules` table with `active` and `install` columns).
- Migrations are executed in a transaction and logged in `migrations_log` per module/filename.
- The installer loads DB settings from `backend/.env` when available; otherwise it uses standard PG env vars or `DATABASE_URL`.

---

## Frontend Usage
- Import components in the app with Vite aliases:

```js
import { ModuleTemplate, ModuleTemplateSettings } from "@modules/module-template/frontend";
```

- Then render in your routes or tab views as needed:

```jsx
<ModuleTemplate />
// or
<ModuleTemplateSettings />
```

---

## Example Prompt for Codex

> Generate a billing module following the structure and standards in `modules/module-template/README.md`.

---

## Uninstall Support
If you want uninstall support (rollback hooks and module-specific migrations), let’s add a companion `uninstall.js/ts` that reverses `hook_module` bindings and reads `--down` sections or explicit down files.
## Module Independence Checklist

Before changes, verify `modules/MODULE_CHECKLIST.md`:

- Backend entry: `modules/logs2/backend/index.js` exporting `register(app, ctx)`.
- API routes under `/api/logs2/*`; do not wire in `backend/server.js`.
- Frontend entry at `modules/logs2/frontend/index.(ts|tsx|js)`.
- Migrations in `modules/logs2/db/migrations/` (timestamped).
- `module.config.json` present with `enabled` and `hooks`.
