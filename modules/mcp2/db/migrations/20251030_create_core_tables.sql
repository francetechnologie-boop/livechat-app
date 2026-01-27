-- MCP2 core tables (idempotent)
-- Europe/Prague date: 2025-10-30

-- Kinds
CREATE TABLE IF NOT EXISTS public.mod_mcp2_kind (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NULL,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  org_id      TEXT NULL
);
-- indexes
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_mcp2_kind_org') THEN
  EXECUTE 'CREATE INDEX idx_mcp2_kind_org ON public.mod_mcp2_kind(org_id)';
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='mcp2_kind_code_unique') THEN
  EXECUTE 'CREATE UNIQUE INDEX mcp2_kind_code_unique ON public.mod_mcp2_kind(LOWER(code))';
END IF; END $$;

-- Types
CREATE TABLE IF NOT EXISTS public.mod_mcp2_type (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NULL,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  org_id      TEXT NULL,
  tool_prefix TEXT NULL
);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_mcp2_type_org') THEN
  EXECUTE 'CREATE INDEX idx_mcp2_type_org ON public.mod_mcp2_type(org_id)';
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='mcp2_type_code_unique') THEN
  EXECUTE 'CREATE UNIQUE INDEX mcp2_type_code_unique ON public.mod_mcp2_type(LOWER(code))';
END IF; END $$;

-- Tools catalog
CREATE TABLE IF NOT EXISTS public.mod_mcp2_tool (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT NULL,
  input_schema JSONB NULL,
  code         JSONB NULL,
  version      INTEGER DEFAULT 1,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW(),
  org_id       TEXT NULL
);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_mcp2_tool_org') THEN
  EXECUTE 'CREATE INDEX idx_mcp2_tool_org ON public.mod_mcp2_tool(org_id)';
END IF; END $$;

-- Types ↔ Tools mapping
CREATE TABLE IF NOT EXISTS public.mod_mcp2_type_tool (
  type_id         TEXT NOT NULL,
  tool_id         TEXT NOT NULL,
  created_at      TIMESTAMP DEFAULT NOW(),
  org_id          TEXT NULL,
  PRIMARY KEY (type_id, tool_id)
);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_mcp2_type_tool_org') THEN
  EXECUTE 'CREATE INDEX idx_mcp2_type_tool_org ON public.mod_mcp2_type_tool(org_id)';
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_mcp2_type_tool_tool') THEN
  EXECUTE 'CREATE INDEX idx_mcp2_type_tool_tool ON public.mod_mcp2_type_tool(tool_id)';
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_mcp2_type_tool_type') THEN
  EXECUTE 'CREATE INDEX idx_mcp2_type_tool_type ON public.mod_mcp2_type_tool(type_id)';
END IF; END $$;

-- Servers
CREATE TABLE IF NOT EXISTS public.mod_mcp2_server (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  kind_id    TEXT NULL,
  type_id    TEXT NULL,
  http_base  TEXT NULL,
  ws_url     TEXT NULL,
  token      TEXT NULL,
  enabled    BOOLEAN DEFAULT FALSE,
  options    JSONB NULL,
  notes      TEXT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  org_id     TEXT NULL,
  stream_url TEXT NULL,
  sse_url    TEXT NULL
);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_mcp2_server_kind') THEN
  EXECUTE 'CREATE INDEX idx_mcp2_server_kind ON public.mod_mcp2_server(kind_id)';
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_mcp2_server_type') THEN
  EXECUTE 'CREATE INDEX idx_mcp2_server_type ON public.mod_mcp2_server(type_id)';
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_mcp2_server_org') THEN
  EXECUTE 'CREATE INDEX idx_mcp2_server_org ON public.mod_mcp2_server(org_id)';
END IF; END $$;

-- Server-scoped tools
CREATE TABLE IF NOT EXISTS public.mod_mcp2_server_tool (
  id           TEXT PRIMARY KEY,
  server_id    TEXT NULL,
  name         TEXT NOT NULL,
  description  TEXT NULL,
  input_schema JSONB NULL,
  code         JSONB NULL,
  enabled      BOOLEAN DEFAULT TRUE,
  version      INTEGER DEFAULT 1,
  created_at   TIMESTAMP DEFAULT NOW(),
  updated_at   TIMESTAMP DEFAULT NOW(),
  org_id       TEXT NULL,
  tool_id      TEXT NULL,
  CONSTRAINT mod_mcp2_server_tool_uq UNIQUE (server_id, name)
);
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_mcp2_tool_server') THEN
  EXECUTE 'CREATE INDEX idx_mcp2_tool_server ON public.mod_mcp2_server_tool(server_id)';
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_mcp2_server_tool_tool') THEN
  EXECUTE 'CREATE INDEX idx_mcp2_server_tool_tool ON public.mod_mcp2_server_tool(tool_id)';
END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_mcp2_server_tool_org') THEN
  EXECUTE 'CREATE INDEX idx_mcp2_server_tool_org ON public.mod_mcp2_server_tool(org_id)';
END IF; END $$;

-- Ensure columns that later migrations add exist (idempotent guards)
ALTER TABLE public.mod_mcp2_server ADD COLUMN IF NOT EXISTS stream_url TEXT;
ALTER TABLE public.mod_mcp2_server ADD COLUMN IF NOT EXISTS sse_url    TEXT;
