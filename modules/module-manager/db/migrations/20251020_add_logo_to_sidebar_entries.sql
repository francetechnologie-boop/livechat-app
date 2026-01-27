DO $$
BEGIN
  IF to_regclass('public.sidebar_entries') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.sidebar_entries ADD COLUMN IF NOT EXISTS logo TEXT NULL;
    EXCEPTION WHEN others THEN NULL; END;
    BEGIN
      ALTER TABLE public.sidebar_entries ADD COLUMN IF NOT EXISTS icon TEXT NULL;
    EXCEPTION WHEN others THEN NULL; END;
  END IF;
END $$;
