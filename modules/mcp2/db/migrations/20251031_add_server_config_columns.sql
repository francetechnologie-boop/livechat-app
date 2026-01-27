-- Add server-scoped configuration columns to materialize MCP definitions
-- Europe/Prague date: 2025-10-31

ALTER TABLE public.mod_mcp2_server
  ADD COLUMN IF NOT EXISTS tools JSONB,
  ADD COLUMN IF NOT EXISTS resources JSONB,
  ADD COLUMN IF NOT EXISTS resource_templates JSONB;

-- Shapes (informational):
-- tools:              [ { "name": "...", "description": "...", "inputSchema": { ... }, "enabled": true } ]
-- resources:          [ { "uri": "...", "name": "...", "description": "...", "mimeType": "...", "enabled": true } ]
-- resource_templates: [ { "name": "...", "description": "...", "inputSchema": { ... }, "enabled": true } ]

-- Indexes are not necessary; arrays are small and filtered application-side.

