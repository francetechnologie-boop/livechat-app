-- up
-- Make dhl.track.by_id_order return a minimal payload (tracking_link only) by enabling lite=1.
-- Europe/Prague date: 2026-01-25
DO $mcp2_dhl_track_by_id_order_lite$
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  -- Tool definition lives in mod_mcp2_tool.code (jsonb). Add/override query.lite = "1".
  UPDATE public.mod_mcp2_tool
     SET code = jsonb_set(COALESCE(code, '{}'::jsonb), '{query,lite}', to_jsonb('1'::text), true),
         updated_at = NOW()
   WHERE lower(name) = lower('dhl.track.by_id_order');
END
$mcp2_dhl_track_by_id_order_lite$;

-- down
-- Non-destructive.
