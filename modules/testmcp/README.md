# Test MCP Module

A minimal MCP-like server module that exposes a newline-delimited JSON stream and a tiny tools protocol with no token.

- Stream (preferred): `/api/testmcp/stream` (bypasses SPA fallback)
- Aliases: `/testmcp/stream` and `/mcp/testMCP/stream` (may be shadowed by SPA fallback)
- Message (no token): `POST /testmcp/message` or `POST /api/testmcp/message`
- Admin tools list: `GET /api/testmcp/tools` (requires admin)
- Recent events: `GET /api/testmcp/events/recent` (requires admin)

Database tables (PostgreSQL):
- `mod_testmcp_tool` — optional registry of tools with `org_id`.
- `mod_testmcp_events` — log of tool calls / messages with `org_id`.

This module mounts its own JSON parser at `/api/testmcp` and does not rely on server-level parsers.
