DO $$ BEGIN
  -- Shared MCP uploads table used by filedata driver/tools.
  -- Keep idempotent: some installs already have this table created by backend migrations.
  CREATE TABLE IF NOT EXISTS public.mcp_files (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    content_type TEXT,
    size_bytes INTEGER,
    server_name TEXT,
    bot_id TEXT,
    org_id TEXT NULL,
    created_at TIMESTAMP DEFAULT NOW()
  );

  BEGIN
    ALTER TABLE public.mcp_files ADD COLUMN IF NOT EXISTS server_name TEXT;
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    ALTER TABLE public.mcp_files ADD COLUMN IF NOT EXISTS bot_id TEXT;
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    ALTER TABLE public.mcp_files ADD COLUMN IF NOT EXISTS org_id TEXT;
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    ALTER TABLE public.mcp_files ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
  EXCEPTION WHEN others THEN NULL; END;

  BEGIN
    CREATE INDEX IF NOT EXISTS idx_mcp_files_created ON public.mcp_files(created_at DESC);
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_mcp_files_server ON public.mcp_files(server_name);
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_mcp_files_bot ON public.mcp_files(bot_id);
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    CREATE INDEX IF NOT EXISTS idx_mcp_files_org ON public.mcp_files(org_id);
  EXCEPTION WHEN others THEN NULL; END;
END $$;

