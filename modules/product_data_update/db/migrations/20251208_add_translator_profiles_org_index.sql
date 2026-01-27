-- Ensure org index exists on mod_product_data_translator_profiles (compat table)
DO $$
DECLARE
  is_table boolean := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'mod_product_data_translator_profiles' AND c.relkind = 'r'
  ) INTO is_table;

  IF is_table THEN
    BEGIN
      CREATE INDEX IF NOT EXISTS idx_pdu_translator_profiles_org ON public.mod_product_data_translator_profiles((COALESCE(org_id,-1)));
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

