-- Add numeric version to unified domain/page_type config and bump on change
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='mod_grabbing_jerome_domain_type_config' AND column_name='version'
  ) THEN
    ALTER TABLE public.mod_grabbing_jerome_domain_type_config ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  END IF;
END $$;

-- Backfill any NULLs to 1 for portability
UPDATE public.mod_grabbing_jerome_domain_type_config SET version = 1 WHERE version IS NULL;

