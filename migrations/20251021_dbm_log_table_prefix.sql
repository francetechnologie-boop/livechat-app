-- up
-- Rename DB Manager change log table to module-prefixed name and add compatibility views.

DO $$ BEGIN
  IF to_regclass('public.mod_db_manager_view_change_log') IS NULL THEN
    IF to_regclass('public.dbm_view_change_log') IS NOT NULL THEN
      ALTER TABLE public.dbm_view_change_log RENAME TO mod_db_manager_view_change_log;
    ELSE
      -- Create if neither exists
      CREATE TABLE public.mod_db_manager_view_change_log (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER,
        schema_name TEXT NOT NULL,
        view_name TEXT NOT NULL,
        action TEXT NOT NULL,
        body_before TEXT,
        body_after TEXT,
        statement TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    END IF;
  END IF;
END $$;

-- Ensure index exists on new table
CREATE INDEX IF NOT EXISTS idx_mod_dbm_view_change_log_view
  ON public.mod_db_manager_view_change_log (schema_name, view_name, created_at DESC);

-- Compatibility views: legacy name and requested alias with hyphen (quoted)
CREATE OR REPLACE VIEW public.dbm_view_change_log AS
  SELECT * FROM public.mod_db_manager_view_change_log;

CREATE OR REPLACE VIEW public."MOD_db-manager__view_change_log" AS
  SELECT * FROM public.mod_db_manager_view_change_log;

-- down
-- No-op (do not drop objects to avoid data loss)

