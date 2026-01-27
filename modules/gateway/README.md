# Gateway Module

Independent module that exposes Gateway (Android) endpoints, admin tools, and a small UI surface at `#/gateway`. It is fully decoupled from the Tools module.

## Overview
- Namespace: all HTTP endpoints are prefixed with `/api/gateway/*`.
- UI route: navigate to `#/gateway` (module surface is auto‑loaded; not under `#/tools`).
- Socket.IO: Android client connects to the namespace `/gateway` with the path `/socket` and a bearer/query token.
- Logging: writes diagnostics to the shared server log via the module loader (`backend/chat.log`).

## Backend (ESM)
- Entry: `modules/gateway/backend/index.js`
  - Mounts a JSON parser only for methods that carry a body under `/api/gateway/*` using `ctx.expressJson` (per‑module parsing; no global parser).
  - Registers routes from `modules/gateway/backend/routes/gateway.routes.js`.

- Routes: `modules/gateway/backend/routes/gateway.routes.js`
  - Health: `GET /api/gateway/ping` → `{ "ok": true, "module": "gateway" }`
  - Admin config: `GET /api/admin/gateway/config` → base URL, endpoint templates, token presence.
  - Token admin: `POST /api/admin/gateway/token` (set), `POST /api/admin/gateway/token/regenerate` (rotate).
  - Connection status: `GET /api/admin/gateway/status` → socket presence, since, last activity.
  - Ping test: `POST /api/admin/gateway/test` → sends `server:ping` to the connected phone, expects an ACK.
  - Lines (diagnostics):
    - `GET /api/gateway/lines` (public diagnostics, DB required)
    - `GET /api/admin/gateway/lines` (admin; includes default subscription id)
    - `POST /api/admin/gateway/lines/default` (admin; set default subscription id)
    - `POST /api/admin/gateway/lines/set_msisdn` (admin; upsert MSISDN for a subscription id)
  - Phone HTTP ingress (authorized by `GATEWAY_TOKEN`):
    - `POST /api/gateway/lines` — phone reports SIM lines; upserts into `mod_gateway_lines`.
  - SMS/Calls compatibility (aliases preserved):
    - `POST /api/gateway/sms/incoming`, `POST /api/gateway/sms/status`, `POST|GET /api/gateway/calls`
    - Legacy aliases `/api/sms/*` and `/api/calls` redirect with 307.

## WebSocket
- Namespace: `/gateway` (Socket.IO v4; server allows EIO3 for compatibility).
- Auth: provide the gateway token as either `?token=...`, `Authorization: Bearer ...`, or `handshake.auth.token`.
- Diagnostics: the server exposes `server:ping` (ACK expected) and an echo `client:ping` (optional).

### Socket Events (recommended)
- **Server → phone**
  - `sms:send` `{ message_id, to, message, subscription_id? }` → phone sends SMS and should ACK with `{ ok:true }` or `{ ok:false, error }`
  - `call:make` `{ to, subscription_id? }` → phone places a call (optional)

- **Phone → server**
  - `sms:incoming` `{ message_id?, device_id?, subscription_id?, sim_slot?, from, to?, message }` → stored into `public.mod_gateway_sms_messages`
  - `sms:status` `{ message_id, status?, error? }` → updates `public.mod_gateway_sms_messages` + appends to `public.mod_gateway_sms_status`
  - `call:log` `{ from_number, to_number?, direction?, status?, duration_sec?, started_at?, ended_at?, ... }` → appended to `public.mod_gateway_call_logs`

## Database & Migrations
- Table naming: uses module prefix `mod_gateway_lines` (as required). Columns include `org_id`, `device_id`, `subscription_id`, `sim_slot`, `carrier`, `display_name`, `msisdn`, `last_seen`.
- Migration location: `modules/gateway/db/migrations/`.
  - Example included: `20251216_rename_gateway_lines.sql` (idempotent):
    - Renames legacy `public.gateway_lines` → `public.mod_gateway_lines` when present.
    - Ensures `org_id` column and guarded FK to `public.organizations(id)` with `ON DELETE SET NULL`.
    - Adds helpful indexes and a compatibility view `public.gateway_lines` if needed.

## Module Files
- Manifest (Module Manager UI): `modules/gateway/config.json`
- Runtime config (loader): `modules/gateway/module.config.json`
- Backend: `backend/index.js`, `backend/routes/gateway.routes.js`, `backend/installer.js`, `backend/hooks.js`
- Frontend: `frontend/index.jsx` (surfaced at `#/gateway`), `frontend/index.js`

## Frontend
- The module provides a compact admin UI at `#/gateway`:
  - View Base URL and endpoint templates.
  - Set/rotate the gateway token.
  - Inspect connection status (socket count, since, last activity) and run a server→device ping.
  - View and manage phone lines (default subscription id, MSISDN edits).

## Security & Secrets
- The gateway uses a shared token `GATEWAY_TOKEN` for both HTTP ingress and Socket.IO.
- Never print or commit secrets. The UI only indicates presence (e.g., “present”) and allows admin‑only rotation.
- When documenting or logging, redact tokens like `****`.

## Independence from Tools
- This module owns its backend and UI; it does not depend on the Tools module. The Tools page may contain a link to `#/gateway`, but configuration and operations live here.

## Android Client Setup (example)
Use the values shown on `#/gateway`. Example Kotlin object (replace token at runtime; do not hardcode in production):

```kotlin
package com.livechat.gateway.core

object Config {
    const val BASE_URL = "https://chat.piscinesondespro.fr"
    const val SOCKET_URL = BASE_URL
    const val SOCKET_PATH = "/socket"
    const val SOCKET_NAMESPACE = "/gateway"

    // Namespaced Gateway HTTP endpoints
    const val API_SMS_INCOMING = "$BASE_URL/api/gateway/sms/incoming"
    const val API_SMS_STATUS   = "$BASE_URL/api/gateway/sms/status"
    const val API_CALL_LOG     = "$BASE_URL/api/gateway/calls"
}
```

Socket.IO connection (pseudocode):

```kotlin
val opts = IO.Options.builder()
    .setPath(Config.SOCKET_PATH)
    .setTransports(arrayOf("websocket"))
    .build()
val url = Config.SOCKET_URL + Config.SOCKET_NAMESPACE + "?token=" + gatewayToken
val socket = IO.socket(url, opts)
socket.on("connect") { /* connected */ }
socket.on("disconnect") { /* disconnected */ }
```

Report phone lines (authorized by token):

```bash
curl -X POST "https://chat.piscinesondespro.fr/api/gateway/lines" \
  -H "Authorization: Bearer ****" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "android-01",
    "lines": [
      { "subscription_id": 1, "sim_slot": 0, "carrier": "Orange", "display_name": "SIM1", "msisdn": "+33..." }
    ]
  }'
```

## Quick Tests
- Health: `curl -sS https://chat.piscinesondespro.fr/api/gateway/ping`
- Status (admin): `curl -sS https://chat.piscinesondespro.fr/api/admin/gateway/status`
- Ping (admin): `curl -sS -X POST https://chat.piscinesondespro.fr/api/admin/gateway/test`
- Lines (admin): `curl -sS https://chat.piscinesondespro.fr/api/admin/gateway/lines`

## Deployment
- Build & deploy from project root:

```bash
FRONTEND_BUILD_FORCE=1 ./deploy.sh && pm2 restart livechat && systemctl reload apache2
```

If the frontend ever shows a blank page after updates, clear stale chunks, rebuild, and retry:

```bash
rm -rf frontend/dist/assets/*
FRONTEND_BUILD_FORCE=1 ./deploy.sh && pm2 restart livechat && systemctl reload apache2
```

## Notes
- Route ownership, per‑module JSON parsing, namespacing, and DB naming follow AGENTS.md.
- All diagnostics should go to `backend/chat.log` through the loader’s logger helper.
