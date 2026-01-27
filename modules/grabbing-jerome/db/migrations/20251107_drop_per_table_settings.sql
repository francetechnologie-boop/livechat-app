DO $$
BEGIN
  IF to_regclass('public.mod_grabbing_jerome_table_settings') IS NOT NULL THEN
    -- Archive current rows before drop
    BEGIN
      EXECUTE 'CREATE TABLE IF NOT EXISTS public._archive_mod_grabbing_jerome_table_settings AS SELECT * FROM public.mod_grabbing_jerome_table_settings WITH NO DATA';
    EXCEPTION WHEN duplicate_table THEN NULL; END;

    INSERT INTO public._archive_mod_grabbing_jerome_table_settings
    SELECT * FROM public.mod_grabbing_jerome_table_settings;

    -- Drop the legacy table now that unified storage exists
    DROP TABLE public.mod_grabbing_jerome_table_settings;
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

