-- Add mapping-related columns to extraction runs history
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.mod_grabbing_jerome_extraction_runs
      ADD COLUMN IF NOT EXISTS mapping_version INTEGER NULL,
      ADD COLUMN IF NOT EXISTS mapping JSONB NULL,
      ADD COLUMN IF NOT EXISTS transfer JSONB NULL;
  EXCEPTION WHEN others THEN NULL; -- keep migration portable
  END;
END $$;

