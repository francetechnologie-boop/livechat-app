# LiveChat-App Modules

This repository uses a strict module system. Every feature lives in `modules/<module_id>/` and is fully decoupled from `backend/server.js`.

Key rules (must-have):
- Entrypoint: `modules/<module_id>/backend/index.js` exports `register(app, ctx)` (or `registerRoutes`). The server never wires module routes directly.
- API namespace: all endpoints are under `/api/<module_id>/*` and should include `/api/<module_id>/ping`.
- JSON parsing: mount your own parser inside the module (do not rely on the server mounting one for you).
  - Use `ctx.expressJson` provided by the module loader to avoid importing express in modules: `app.use('/api/<module_id>', ctx.expressJson({ limit: process.env.API_JSON_LIMIT || '50mb', strict: false }))`
  - For non-`/api` endpoints (streams, SSE, raw), perform manual body reads or mount a narrowly scoped parser for that path only.
- WebSockets: handle WS upgrades inside the module using `ctx.extras.server` with a module-scoped path.
- Database: module-owned tables use `mod_<module_id_snake>_*` and include `org_id` where applicable. Provide idempotent, timestamped migrations in `modules/<module_id>/db/migrations/`.
- Manifests: include both `module.config.json` (runtime hooks) and `config.json` (Module Manager discovery).

Quick checklist:
- [ ] `backend/index.js` exports `register` and mounts JSON parser for `/api/<module_id>`
- [ ] Routes live under `/api/<module_id>/*` (plus `/ping`)
- [ ] Migrations in `db/migrations` (idempotent, timestamped)
- [ ] Tables use `mod_<module_id_snake>_*` and include `org_id`
- [ ] `module.config.json` + `config.json` present
- [ ] No server-level coupling in `backend/server.js`

For detailed guidance, see the root `AGENTS.md` and `modules/MODULE_CHECKLIST.md`.
