-- Ensure mod_mcp2_server has stream_url and sse_url columns
-- Europe/Prague date: 2025-10-28

ALTER TABLE public.mod_mcp2_server
  ADD COLUMN IF NOT EXISTS stream_url TEXT NULL;

ALTER TABLE public.mod_mcp2_server
  ADD COLUMN IF NOT EXISTS sse_url TEXT NULL;

