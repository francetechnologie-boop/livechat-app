-- up
-- Fix MariaDB/MySQL prepared-statement incompatibility with arithmetic around placeholders in OFFSET.
-- Tools should use `OFFSET :offset` and let the executor compute offset from page/page_size.
-- Europe/Prague date: 2026-01-08
DO $mcp2_fix_offset$
BEGIN
  IF to_regclass('public.mod_mcp2_tool') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.mod_mcp2_tool
     SET code = jsonb_set(
       code,
       '{sql}',
       to_jsonb(
         regexp_replace(
           code->>'sql',
           'OFFSET\\s*\\(\\(:page\\s*-\\s*1\\)\\s*\\*\\s*:page_size\\)',
           'OFFSET :offset',
           'g'
         )
       ),
       true
     ),
     updated_at = NOW()
   WHERE name IN ('psdb.products.search', 'psdb.products.list')
     AND code IS NOT NULL
     AND (code->>'sql') ~ 'OFFSET\\s*\\(\\(:page\\s*-\\s*1\\)\\s*\\*\\s*:page_size\\)';
END $mcp2_fix_offset$;

-- down
-- Non-destructive: keep updated definitions.
