-- Remove deprecated 'category_ids' key from scope in fill profiles
DO $$ BEGIN
  BEGIN
    UPDATE public.mod_category_data_update_fill_profiles
       SET scope = CASE
         WHEN scope ? 'category_ids' THEN scope - 'category_ids'
         ELSE scope
       END;
  EXCEPTION WHEN others THEN NULL; END;
END $$;

