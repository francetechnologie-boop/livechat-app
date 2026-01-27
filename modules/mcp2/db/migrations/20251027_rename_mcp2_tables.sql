-- Rename legacy MCP2 tables to module-scoped names and create compatibility views
-- Timestamp: 2025-10-27 (Europe/Prague)

-- Rename only if source is a TABLE ('r') and target does not already exist
DO $$ DECLARE src_is_table boolean; BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='mcp2_kind' AND c.relkind='r'
  ) INTO src_is_table;
  IF src_is_table AND to_regclass('public.mod_mcp2_kind') IS NULL THEN
    ALTER TABLE public.mcp2_kind RENAME TO mod_mcp2_kind;
  END IF;
END $$;

DO $$ DECLARE src_is_table boolean; BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='mcp2_type' AND c.relkind='r'
  ) INTO src_is_table;
  IF src_is_table AND to_regclass('public.mod_mcp2_type') IS NULL THEN
    ALTER TABLE public.mcp2_type RENAME TO mod_mcp2_type;
  END IF;
END $$;

DO $$ DECLARE src_is_table boolean; BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='mcp2_server' AND c.relkind='r'
  ) INTO src_is_table;
  IF src_is_table AND to_regclass('public.mod_mcp2_server') IS NULL THEN
    ALTER TABLE public.mcp2_server RENAME TO mod_mcp2_server;
  END IF;
END $$;

DO $$ DECLARE src_is_table boolean; BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='mcp2_tool' AND c.relkind='r'
  ) INTO src_is_table;
  IF src_is_table AND to_regclass('public.mod_mcp2_tool') IS NULL THEN
    ALTER TABLE public.mcp2_tool RENAME TO mod_mcp2_tool;
  END IF;
END $$;

DO $$ DECLARE src_is_table boolean; BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='mcp2_type_tool' AND c.relkind='r'
  ) INTO src_is_table;
  IF src_is_table AND to_regclass('public.mod_mcp2_type_tool') IS NULL THEN
    ALTER TABLE public.mcp2_type_tool RENAME TO mod_mcp2_type_tool;
  END IF;
END $$;

DO $$ DECLARE src_is_table boolean; BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relname='mcp2_server_tool' AND c.relkind='r'
  ) INTO src_is_table;
  IF src_is_table AND to_regclass('public.mod_mcp2_server_tool') IS NULL THEN
    ALTER TABLE public.mcp2_server_tool RENAME TO mod_mcp2_server_tool;
  END IF;
END $$;

-- Optional compatibility read-through views (create only if name is free)
DO $$ BEGIN
  IF to_regclass('public.mcp2_kind') IS NULL THEN
    EXECUTE 'CREATE VIEW public.mcp2_kind AS SELECT * FROM public.mod_mcp2_kind';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.mcp2_type') IS NULL THEN
    EXECUTE 'CREATE VIEW public.mcp2_type AS SELECT * FROM public.mod_mcp2_type';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.mcp2_server') IS NULL THEN
    EXECUTE 'CREATE VIEW public.mcp2_server AS SELECT * FROM public.mod_mcp2_server';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.mcp2_tool') IS NULL THEN
    EXECUTE 'CREATE VIEW public.mcp2_tool AS SELECT * FROM public.mod_mcp2_tool';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.mcp2_type_tool') IS NULL THEN
    EXECUTE 'CREATE VIEW public.mcp2_type_tool AS SELECT * FROM public.mod_mcp2_type_tool';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass('public.mcp2_server_tool') IS NULL THEN
    EXECUTE 'CREATE VIEW public.mcp2_server_tool AS SELECT * FROM public.mod_mcp2_server_tool';
  END IF;
END $$;
