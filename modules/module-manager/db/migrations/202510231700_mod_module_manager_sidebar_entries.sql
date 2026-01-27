-- Idempotent migration to rename sidebar_entries to mod_module_manager_sidebar_entries
-- and ensure required columns, indexes, and compatibility view.

DO $$
BEGIN
  -- 1) Rename legacy table if present and new one missing
  IF to_regclass('public.mod_module_manager_sidebar_entries') IS NULL
     AND to_regclass('public.sidebar_entries') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.sidebar_entries RENAME TO mod_module_manager_sidebar_entries';
  END IF;

  -- 2) Create new table if it still does not exist
  IF to_regclass('public.mod_module_manager_sidebar_entries') IS NULL THEN
    EXECUTE $$
      CREATE TABLE public.mod_module_manager_sidebar_entries (
        id BIGSERIAL PRIMARY KEY,
        entry_id TEXT NOT NULL,
        label TEXT NOT NULL,
        hash TEXT NOT NULL,
        position INTEGER DEFAULT 0,
        icon TEXT NULL,
        logo TEXT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        org_id TEXT NULL,
        attached BOOLEAN NOT NULL DEFAULT TRUE,
        level SMALLINT NOT NULL DEFAULT 0,
        parent_entry_id TEXT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    $$;
  END IF;

  -- 3) Non-breaking column additions (for older installs)
  BEGIN
    EXECUTE 'ALTER TABLE public.mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS icon TEXT NULL';
  EXCEPTION WHEN others THEN END;
  BEGIN
    EXECUTE 'ALTER TABLE public.mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS logo TEXT NULL';
  EXCEPTION WHEN others THEN END;
  BEGIN
    EXECUTE 'ALTER TABLE public.mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS attached BOOLEAN NOT NULL DEFAULT TRUE';
  EXCEPTION WHEN others THEN END;
  BEGIN
    EXECUTE 'ALTER TABLE public.mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS level SMALLINT NOT NULL DEFAULT 0';
  EXCEPTION WHEN others THEN END;
  BEGIN
    EXECUTE 'ALTER TABLE public.mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS parent_entry_id TEXT NULL';
  EXCEPTION WHEN others THEN END;
  BEGIN
    EXECUTE 'ALTER TABLE public.mod_module_manager_sidebar_entries ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0';
  EXCEPTION WHEN others THEN END;

  -- 4) Create sequence used by code if missing
  BEGIN
    EXECUTE 'CREATE SEQUENCE IF NOT EXISTS sidebar_entry_id_seq START 1 INCREMENT 1';
  EXCEPTION WHEN others THEN END;

  -- 5) De-duplicate legacy rows and add composite unique constraint
  BEGIN
    EXECUTE $$
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY COALESCE(org_id,''), level, COALESCE(parent_entry_id,''), entry_id
                 ORDER BY id
               ) AS rn
        FROM public.mod_module_manager_sidebar_entries
      )
      DELETE FROM public.mod_module_manager_sidebar_entries s USING ranked r
      WHERE s.id = r.id AND r.rn > 1
    $$;
  EXCEPTION WHEN others THEN END;
  BEGIN
    EXECUTE 'ALTER TABLE public.mod_module_manager_sidebar_entries ADD CONSTRAINT uq_mod_mm_sidebar UNIQUE (org_id, level, parent_entry_id, entry_id)';
  EXCEPTION WHEN others THEN END;

  -- 6) Optional compatibility view (legacy name)
  BEGIN
    EXECUTE 'CREATE OR REPLACE VIEW public.sidebar_entries AS SELECT * FROM public.mod_module_manager_sidebar_entries';
  EXCEPTION WHEN others THEN END;
END $$;

