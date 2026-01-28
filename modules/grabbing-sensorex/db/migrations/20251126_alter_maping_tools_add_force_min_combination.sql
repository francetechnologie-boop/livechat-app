-- Add force_min_combination flag into mapping tools config (idempotent, guarded).
DO $$
DECLARE
  r RECORD;
  cfg JSONB;
BEGIN
  IF to_regclass('public.mod_grabbing_sensorex_maping_tools') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT id, config
      FROM public.mod_grabbing_sensorex_maping_tools
  LOOP
    cfg := COALESCE(r.config, '{}'::jsonb);
    IF jsonb_typeof(cfg) <> 'object' THEN
      cfg := '{}'::jsonb;
    END IF;
    IF jsonb_typeof(cfg->'flags') <> 'object' THEN
      cfg := jsonb_set(cfg, '{flags}', '{}'::jsonb, true);
    END IF;
    IF (cfg->'flags'->>'force_min_combination') IS NULL THEN
      cfg := jsonb_set(cfg, '{flags,force_min_combination}', 'false'::jsonb, true);
      BEGIN
        UPDATE public.mod_grabbing_sensorex_maping_tools
           SET config = cfg,
               updated_at = now()
         WHERE id = r.id;
      EXCEPTION WHEN others THEN NULL; END;
    END IF;
  END LOOP;
END $$;
